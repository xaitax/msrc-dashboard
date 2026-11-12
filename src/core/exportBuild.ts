// Lossless, LLM-friendly export of submissions. Pure: the
// dashboard feeds it what is in IndexedDB and downloads the result as JSON.
// Never receives auth material, so it cannot leak tokens.
import type { CaseRecord, ChangeEvent, ThreadMessage, VulnId } from "../shared/types";
import { extractCves, type CveRef } from "./cve";
import { publicCveUrl, type PublicCve } from "./publicCves";
import { caseStatus, caseTitle, humanizeEnum, isAutomatic, MSRC_SENDER } from "./derive";
import { summarizeMsrcMessage } from "./msrcText";
import { htmlToText } from "./text";
import type { StatusHistory } from "./history";
import { buildTimeline } from "./timeline";

export const SCHEMA_VERSION = 1;

const REPORT_TEXT_FIELDS = [
  "abstract",
  "description",
  "reproductionSteps",
  "attackScenario",
  "callstack",
  "recommendedSolution",
  "analysisNotes",
  "acknowledgement",
  "acknowledgements",
  "linkList",
  "targetList",
  "versionTested",
  "devChannelRepro",
  "variantCaseOrSubmission",
  "variantOrRelatedCVE",
] as const;

/** Plain-English description of every per-case key, for the consuming LLM. */
export const FIELD_GUIDE = {
  ids: "Identifiers. ticketNumber is the MSRC case number used in correspondence and in local folder names (MSRC-Case-<ticketNumber>-…); reportNumber is the portal id (VULN-…); id is the internal GUID.",
  summary: "Current state, human-readable: title, status (raw enum and label), severity, impact, bounty, CVSS, CWE, products, dates, CVEs named in MSRC's messages, public CVEs from Microsoft's Security Update Guide that are tied to this case (linkedBy 'msrc' = MSRC named it on the case, 'researcher' = the researcher confirmed it), unread count in the portal.",
  originalReport: "The report as submitted (Markdown text fields as written by the researcher) plus product/target lists, links and the researcher's related CVE.",
  timeline: "Everything in chronological order (oldest first): submission, file uploads, every message (MSRC or researcher) and every change this extension detected.",
  messages: "Every thread message with metadata. bodyText is readable plain text; bodyOriginal is exactly what the API returned. milestone summarises MSRC template mails (e.g. 'Fix planned: …').",
  statusHistory: "Status changes with exact timestamps from MSRC's notification feed (source 'notification'), or, when the feed has none, changes this extension detected itself (source 'detected').",
  files: "Files attached to the report (metadata only — the researcher API does not allow downloading them).",
  localEvents: "Raw change events recorded by this extension, with seen state.",
  raw: "Untouched API payloads (list row, full report, files, messages) for anything the fields above do not cover.",
  publicCvesNotLinked: "Top level: public CVEs whose Security Update Guide credit names the researcher but that no case claims yet. guessedReportNumber is the dashboard's guess (same impact, matching weakness, awaiting a fix), not a fact. A selected export lists only those guessed for a selected case.",
} as const;

export interface ExportOptions {
  scope: "all" | "selected";
  selected?: VulnId[];
  generator: string;
  now: string;
}

export interface ExportCase {
  ids: { reportNumber: VulnId; ticketNumber: string | null; externalId: string | null; id: string; casePoint: unknown };
  summary: {
    title: string;
    status: string | null;
    statusLabel: string;
    statusReason: string | null;
    severity: unknown;
    securityImpact: unknown;
    bounty: unknown;
    cvssVectorString: unknown;
    cweList: unknown;
    products: unknown;
    disclosureEvents: unknown;
    createdOn: string | null;
    lastActivityOn: string | null;
    cves: CveRef[];
    publicCves: (PublicCve & { linkedBy: "researcher" | "msrc"; url: string })[];
    unreadInPortal: number | null;
  };
  originalReport: Record<string, unknown>;
  timeline: { at: string; kind: string; from?: string; milestone?: string; text: string }[];
  messages: {
    id: string;
    createdOn: string;
    from: "msrc" | "you";
    senderName: string;
    milestone: string | null;
    automatic: boolean;
    isResponseRequired: unknown;
    read: unknown;
    isFlagged: unknown;
    topicList: unknown;
    bodyText: string;
    bodyOriginal: string;
  }[];
  statusHistory: { at: string; from: unknown; to: unknown; source: string }[];
  files: { id: string; name: string; createdOn: string | null; uploadStatus: unknown; downloadable: false }[];
  localEvents: ChangeEvent[];
  raw: { list: unknown; detail: unknown; files: unknown[]; messages: unknown[] };
}

export interface ExportDoc {
  schemaVersion: number;
  exportedAt: string;
  generator: string;
  scope: "all" | "selected";
  caseCount: number;
  fieldGuide: typeof FIELD_GUIDE;
  cases: ExportCase[];
  publicCvesNotLinked: (PublicCve & { url: string; guessedReportNumber: VulnId | null })[];
}

function ticketOrder(t: string | null): number {
  const n = t ? Number.parseInt(t, 10) : Number.NaN;
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function buildExport(
  input: {
    cases: CaseRecord[];
    messages: ThreadMessage[];
    events: ChangeEvent[];
    history?: StatusHistory;
    publicCves?: Record<string, { item: PublicCve; by: "you" | "msrc" }[]>;
    publicUnlinked?: { item: PublicCve; suggestion: VulnId | null }[];
  },
  opts: ExportOptions,
): ExportDoc {
  const wanted = opts.scope === "selected" ? new Set(opts.selected ?? []) : null;
  const chosen = input.cases
    .filter((c) => !wanted || wanted.has(c.reportNumber))
    .sort((a, b) => ticketOrder(a.list.ticketNumber) - ticketOrder(b.list.ticketNumber) || a.reportNumber.localeCompare(b.reportNumber));

  // CVE extraction needs every message (boilerplate rule spans reports).
  const cves = extractCves(input.messages);

  const cases = chosen.map((c): ExportCase => {
    const d = (c.detail ?? {}) as Record<string, unknown>;
    const msgs = input.messages.filter((m) => m.reportNumber === c.reportNumber).sort((a, b) => Date.parse(a.createdOn) - Date.parse(b.createdOn));
    const evs = input.events.filter((e) => e.reportNumber === c.reportNumber).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const status = caseStatus(c);
    return {
      ids: { reportNumber: c.reportNumber, ticketNumber: c.list.ticketNumber, externalId: c.list.externalId, id: c.list.id, casePoint: d["casePoint"] ?? c.list.raw["casePoint"] ?? null },
      summary: {
        title: caseTitle(c),
        status,
        statusLabel: humanizeEnum(status),
        statusReason: (d["statusReason"] as string | null | undefined) ?? c.list.statusReason,
        severity: d["severity"] ?? c.list.severity,
        securityImpact: d["securityImpact"] ?? c.list.securityImpact,
        bounty: d["bounty"] ?? c.list.raw["bounty"] ?? null,
        cvssVectorString: d["cvssVectorString"] ?? null,
        cweList: d["cweList"] ?? null,
        products: d["targetList"] ?? c.list.raw["targetList"] ?? null,
        disclosureEvents: d["disclosureEventList"] ?? null,
        createdOn: c.list.createdOn,
        lastActivityOn: c.list.lastActivityOn,
        cves: cves[c.reportNumber] ?? [],
        publicCves: (input.publicCves?.[c.reportNumber] ?? []).map(({ item, by }) => ({ ...item, linkedBy: by === "you" ? ("researcher" as const) : ("msrc" as const), url: publicCveUrl(item.cve) })),
        unreadInPortal: c.list.unreadMessageCount,
      },
      originalReport: Object.fromEntries(REPORT_TEXT_FIELDS.map((k) => [k, d[k] ?? null])),
      timeline: buildTimeline(c, msgs, evs, input.history?.[c.reportNumber] ?? []).map((i) => ({ at: i.at, kind: i.kind, ...(i.from ? { from: i.from } : {}), ...(i.label ? { milestone: i.label } : {}), text: i.text })),
      messages: msgs.map((m) => {
        const topics = m.raw["topicList"];
        const fromMsrc = m.senderName === MSRC_SENDER;
        return {
          id: m.id,
          createdOn: m.createdOn,
          from: fromMsrc ? "msrc" : "you",
          senderName: m.senderName,
          milestone: fromMsrc ? summarizeMsrcMessage(m.body) : null,
          automatic: isAutomatic(m),
          isResponseRequired: m.raw["isResponseRequired"] ?? null,
          read: m.raw["read"] ?? null,
          isFlagged: m.raw["isFlagged"] ?? null,
          topicList: topics ?? null,
          bodyText: htmlToText(m.body),
          bodyOriginal: m.body,
        };
      }),
      statusHistory: input.history?.[c.reportNumber]?.length
        ? input.history[c.reportNumber]!.map((h, i, all) => ({ at: h.at, from: i > 0 ? all[i - 1]!.status : null, to: h.status, source: "notification" }))
        : evs.filter((e) => e.type === "status").map((e) => ({ at: e.occurredAt, from: e.oldValue ?? null, to: e.newValue ?? null, source: "detected" })),
      files: c.files.map((f) => ({ id: f.id, name: f.name, createdOn: f.createdOn, uploadStatus: f.raw["uploadStatus"] ?? null, downloadable: false as const })),
      localEvents: evs,
      raw: { list: c.list.raw, detail: c.detail, files: c.files.map((f) => f.raw), messages: msgs.map((m) => m.raw) },
    };
  });

  const publicCvesNotLinked = (input.publicUnlinked ?? [])
    .filter(({ suggestion }) => !wanted || (suggestion !== null && wanted.has(suggestion)))
    .map(({ item, suggestion }) => ({ ...item, url: publicCveUrl(item.cve), guessedReportNumber: suggestion }));
  return { schemaVersion: SCHEMA_VERSION, exportedAt: opts.now, generator: opts.generator, scope: opts.scope, caseCount: cases.length, fieldGuide: FIELD_GUIDE, cases, publicCvesNotLinked };
}

export function exportFileName(nowIso: string): string {
  const d = new Date(nowIso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `msrc-export-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
