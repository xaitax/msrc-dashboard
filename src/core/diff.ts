// Change detection: old vs new snapshots of a case → typed, timestamped,
// deduplicable events. Pure; the sync engine decides what to diff and when.
import { bountyLabel, formatUsd } from "./awards";
import type { CaseRecord, ChangeEvent, EventType, ThreadMessage, VulnId } from "../shared/types";
import type { CveRef } from "./cve";
import { caseTitle, humanizeEnum, isAutomatic, MSRC_SENDER } from "./derive";
import { summarizeMsrcMessage } from "./msrcText";

/** Fields whose churn never means anything to the researcher. */
export const IGNORED_FIELDS: ReadonlySet<string> = new Set([
  "lastActivityOn",
  "unreadMessageCount",
  "hasUnread",
  "modifiedOn",
  "csatSurveyLink",
  "changeLog", // source of timestamps, not an event itself
  "id",
  "reportNumber",
  "raw",
]);

/** Changes the researcher made themselves: recorded, but pre-seen and silent. */
const OWN_FIELDS: ReadonlySet<string> = new Set(["isFlagged"]);

const SPECIAL: ReadonlySet<string> = new Set(["status", "statusReason", "bounty", "disclosureEventList"]);

type Draft = Omit<ChangeEvent, "key" | "detectedAt" | "seen" | "own" | "occurredAt"> & {
  occurredAt?: string | null;
  own?: boolean;
  gen?: number;
};

export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

const same = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);

export function eventKey(e: Pick<ChangeEvent, "type" | "reportNumber" | "sourceId" | "field" | "newValue"> & { gen?: number }): string {
  // CVE events from the structured field and from message bodies share a key.
  const src = e.type === "cve" ? "cve" : (e.sourceId ?? e.field ?? "");
  // State changes carry the revision they were diffed against: re-diffing the
  // same snapshot gives the same key, a later flip back gets a new one.
  const gen = e.gen === undefined ? "" : `@${e.gen}`;
  return `${e.type}|${e.reportNumber}|${src}${gen}|${stableStringify(e.newValue)}`;
}

function finish(d: Draft, now: string): ChangeEvent {
  const own = d.own ?? false;
  const { occurredAt, gen: _gen, ...rest } = d;
  return { ...rest, key: eventKey(d), occurredAt: occurredAt || now, detectedAt: now, own, seen: own };
}

function changeLogTime(detail: Record<string, unknown> | null, field: string, newValue: unknown): string | null {
  const log = detail?.["changeLog"];
  if (!Array.isArray(log)) return null;
  let best: string | null = null;
  for (const entry of log as Record<string, unknown>[]) {
    const set = entry?.["changeSet"];
    if (!Array.isArray(set)) continue;
    const hit = (set as Record<string, unknown>[]).some((s) => {
      if (String(s?.["key"] ?? "").toLowerCase() !== field.toLowerCase()) return false;
      const nv = (s?.["value"] as Record<string, unknown> | undefined)?.["newValue"];
      return nv === undefined || nv === null || String(nv).toLowerCase() === String(newValue ?? "").toLowerCase();
    });
    const t = typeof entry["activityTime"] === "string" ? (entry["activityTime"] as string) : null;
    if (hit && t && (!best || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best;
}

function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function short(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return null;
  const s = String(v);
  return s.length <= 60 ? s : null;
}

function bountySummary(a: Record<string, unknown> | null, b: Record<string, unknown> | null): string {
  const parts: string[] = [];
  const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? formatUsd(v) : short(v));
  if (!same(a?.["status"], b?.["status"])) parts.push(`Bounty ${bountyLabel(a?.["status"] as string | null) || "—"} → ${bountyLabel(b?.["status"] as string | null) || "—"}`);
  if (!same(a?.["amount"], b?.["amount"])) parts.push(`Bounty amount ${money(a?.["amount"])} → ${money(b?.["amount"])}`);
  if (!same(a?.["program"], b?.["program"])) parts.push(`Bounty program → ${short(b?.["program"])}`);
  return parts.join(" · ") || "Bounty changed";
}

export function diffCase(
  prev: CaseRecord | undefined,
  next: CaseRecord,
  ctx: { now: string; statusTime?: (rn: VulnId, status: string) => string | null },
): ChangeEvent[] {
  const rn = next.reportNumber;
  const ticketNumber = next.list.ticketNumber;
  const title = caseTitle(next);
  if (!prev) {
    return [finish({ reportNumber: rn, ticketNumber, type: "case_added", summary: `Case added: ${title}`, newValue: rn, own: true }, ctx.now)];
  }

  // Only compare like with like: full details on both sides, else list rows.
  const useDetail = !!prev.detail && !!next.detail;
  const a = (useDetail ? prev.detail : prev.list.raw) as Record<string, unknown>;
  const b = (useDetail ? next.detail : next.list.raw) as Record<string, unknown>;
  const detail = next.detail as Record<string, unknown> | null;
  const out: Draft[] = [];
  const base = { reportNumber: rn, ticketNumber };
  const gen = prev.rev ?? 0; // for state-like events (status, reason, bounty, fields)

  if (!same(a["status"], b["status"])) {
    out.push({
      ...base,
      type: "status",
      field: "status",
      oldValue: a["status"] ?? null,
      newValue: b["status"] ?? null,
      summary: `Status ${humanizeEnum(a["status"] as string) || "—"} → ${humanizeEnum(b["status"] as string) || "—"}`,
      occurredAt: changeLogTime(detail, "status", b["status"]) ?? (typeof b["status"] === "string" ? (ctx.statusTime?.(rn, b["status"]) ?? null) : null),
      gen,
    });
  }
  if (!same(a["statusReason"], b["statusReason"])) {
    out.push({
      ...base,
      type: "status_reason",
      field: "statusReason",
      oldValue: a["statusReason"] ?? null,
      newValue: b["statusReason"] ?? null,
      summary: `Status reason ${humanizeEnum(a["statusReason"] as string) || "—"} → ${humanizeEnum(b["statusReason"] as string) || "—"}`,
      occurredAt: changeLogTime(detail, "statusReason", b["statusReason"]),
      gen,
    });
  }
  if (!same(a["bounty"], b["bounty"])) {
    const ob = (a["bounty"] ?? null) as Record<string, unknown> | null;
    const nb = (b["bounty"] ?? null) as Record<string, unknown> | null;
    out.push({ ...base, type: "bounty", field: "bounty", oldValue: ob, newValue: nb, summary: bountySummary(ob, nb), occurredAt: changeLogTime(detail, "bounty", undefined), gen });
  }
  const oldDisc = new Set(((a["disclosureEventList"] as Record<string, unknown>[] | null) ?? []).map((d) => stableStringify(d?.["id"] ?? d)));
  for (const d of (b["disclosureEventList"] as Record<string, unknown>[] | null) ?? []) {
    const id = stableStringify(d?.["id"] ?? d);
    if (oldDisc.has(id)) continue;
    out.push({ ...base, type: "disclosure_event", field: "disclosureEventList", sourceId: String(d?.["id"] ?? id), newValue: d, summary: `Disclosure event: ${short(d?.["name"]) ?? "new"}${d?.["date"] ? ` (${String(d["date"]).slice(0, 10)})` : ""}` });
  }

  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (IGNORED_FIELDS.has(k) || SPECIAL.has(k) || same(a[k], b[k])) continue;
    const o = short(a[k]);
    const n = short(b[k]);
    out.push({
      ...base,
      type: "field_changed",
      field: k,
      oldValue: a[k] ?? null,
      newValue: b[k] ?? null,
      summary: o !== null && n !== null ? `${fieldLabel(k)}: ${o} → ${n}` : `${fieldLabel(k)} changed`,
      occurredAt: changeLogTime(detail, k, b[k]),
      own: OWN_FIELDS.has(k),
      gen,
    });
  }

  const oldFiles = new Set(prev.files.map((f) => f.id));
  for (const f of next.files) {
    if (oldFiles.has(f.id)) continue;
    out.push({ ...base, type: "file_added", sourceId: f.id, newValue: f.name, summary: `File added: ${f.name}`, occurredAt: f.createdOn });
  }

  // Researchers get no changeLog; the case's lastActivityOn moving is the best
  // evidence of when a change really happened (e.g. while the browser was closed).
  const moved = next.list.lastActivityOn && next.list.lastActivityOn !== prev.list.lastActivityOn ? next.list.lastActivityOn : null;
  return out.map((d) => finish({ ...d, occurredAt: d.occurredAt || moved }, ctx.now));
}

export function messageEvents(newMsgs: ThreadMessage[], ctx: { now: string; ticketOf: (rn: VulnId) => string | null }): ChangeEvent[] {
  return newMsgs.map((m) => {
    const fromMsrc = m.senderName === MSRC_SENDER;
    const type: EventType = fromMsrc ? "msrc_message" : "own_message";
    const automatic = isAutomatic(m);
    return finish(
      {
        reportNumber: m.reportNumber,
        ticketNumber: ctx.ticketOf(m.reportNumber),
        type,
        sourceId: m.id,
        summary: fromMsrc ? (summarizeMsrcMessage(m.body) ?? (automatic ? "MSRC sent an update" : "MSRC replied")) : "You replied",
        occurredAt: m.createdOn,
        own: !fromMsrc,
      },
      ctx.now,
    );
  });
}

export function cveEvents(
  before: Record<VulnId, CveRef[]>,
  after: Record<VulnId, CveRef[]>,
  ctx: { now: string; ticketOf: (rn: VulnId) => string | null; msgTime: (id: string) => string | undefined },
): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  for (const [rn, refs] of Object.entries(after)) {
    const known = new Set((before[rn] ?? []).map((r) => r.cve));
    for (const r of refs) {
      if (known.has(r.cve) || r.source !== "message") continue;
      out.push(
        finish(
          {
            reportNumber: rn,
            ticketNumber: ctx.ticketOf(rn),
            type: "cve",
            field: "cve",
            newValue: r.cve,
            summary: `CVE assigned: ${r.cve}`,
            occurredAt: r.messageId ? ctx.msgTime(r.messageId) : null,
          },
          ctx.now,
        ),
      );
    }
  }
  return out;
}
