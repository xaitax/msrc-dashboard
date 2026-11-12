// Sync engine: baseline once, cheap poll every 2 min, full sweep
// every 6 h. Writes cases/messages/events to IndexedDB and returns only the
// events that are new. All network access goes through the injected SyncApi.
import { extractCves, msrcNamedCves, type CveRef } from "../core/cve";
import { creditedTo, creditNames, publicCveFrom, resolvePublicCves, type CveLinks, type PublicCve, type PublicMeta } from "../core/publicCves";
import { MSRC_SENDER } from "../core/derive";
import { cveEvents, diffCase, IGNORED_FIELDS, messageEvents, stableStringify } from "../core/diff";
import { statusHistoryFrom, statusTimeFrom, type StatusHistory } from "../core/history";
import { isGuid } from "../shared/ids";
import type { SyncProgress } from "../shared/protocol";
import type { CaseRecord, ChangeEvent, DraftRef, FileRecord, ReportDetail, ReportListItem, ThreadMessage, VulnId } from "../shared/types";
import { addEvents, commitPoll, getAllCases, getMessages, getMeta, META, putCases, putMessages, setMeta } from "../store/db";
import { errorText } from "../shared/protocol";

export interface SyncApi {
  listReports(): Promise<ReportListItem[]>;
  getReportDetail(rn: VulnId): Promise<ReportDetail | null>;
  messagesNewestFirst(skip: number): Promise<ThreadMessage[]>;
  listFiles(reportId: string): Promise<FileRecord[]>;
  /** Notification feed (status changes with exact times). Optional; fetched only when needed. */
  listNotifications?(): Promise<Record<string, unknown>[]>;
  /** Public Security Update Guide credits since a date (no token). Optional. */
  publicCredits?(sinceIso: string): Promise<Record<string, unknown>[]>;
  /** One public CVE record (no token). Optional. */
  publicCve?(cve: string): Promise<Record<string, unknown> | null>;
}

const PAGE = 100;
const MAX_POLL_PAGES = 50;
const MAX_BASELINE_PAGES = 500;
const OWN_FILE_WINDOW_MS = 10 * 60_000;
const SWEEP_PAUSE_MS = 250;



const DAY_MS = 86_400_000;
/** Re-read this much before the last check: credits can be added to a CVE after its release. */
const PUBLIC_OVERLAP_MS = 45 * DAY_MS;
const DRAFT = "DRAFT";

/** Drafts are the researcher's own unsent work: listed, never diffed. */
function splitDrafts(all: ReportListItem[]): { items: ReportListItem[]; drafts: DraftRef[] } {
  const drafts = all
    .filter((i) => i.status === DRAFT)
    .map((i) => ({ id: i.id, reportNumber: i.reportNumber, title: i.title, createdOn: i.createdOn, lastActivityOn: i.lastActivityOn }));
  return { items: all.filter((i) => i.status !== DRAFT), drafts };
}

function listFingerprint(item: ReportListItem): string {
  const raw = Object.fromEntries(Object.entries(item.raw).filter(([k]) => !IGNORED_FIELDS.has(k)));
  return stableStringify(raw);
}

/** Re-checks per case while its details disagree with its list row; the
 *  6-hour sweep refetches everything regardless. 30 polls = about an hour. */
export const MAX_RECHECKS = 30;

const timeOf = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
/** api.ts turns "" into null on list rows; do the same for the details. */
const val = (v: unknown) => (v === undefined || v === "" ? null : v);

/** MSRC's list can move before the report details do (seen live: the bounty
 *  went to "Awarded" in the list while the details still said pending). */
export function detailLags(c: CaseRecord): boolean {
  const d = c.detail;
  if (!d) return false;
  const l = c.list;
  if ("status" in d && val(d["status"]) !== val(l.status)) return true;
  if ("statusReason" in d && val(d["statusReason"]) !== val(l.statusReason)) return true;
  if ("bounty" in d && val((d["bounty"] as Record<string, unknown> | null)?.["status"]) !== val(l.bountyStatus)) return true;
  const a = timeOf(d["lastActivityOn"]);
  const b = timeOf(l.lastActivityOn);
  return !Number.isNaN(a) && !Number.isNaN(b) && a !== b;
}

/** The list row moved since the last fetch (or there is nothing stored yet). */
function listMoved(prev: CaseRecord | undefined, item: ReportListItem): boolean {
  if (!prev || !prev.detail) return true;
  const p = prev.list;
  return (
    p.status !== item.status ||
    p.statusReason !== item.statusReason ||
    p.bountyStatus !== item.bountyStatus ||
    p.lastActivityOn !== item.lastActivityOn ||
    p.unreadMessageCount !== item.unreadMessageCount ||
    listFingerprint(p) !== listFingerprint(item)
  );
}

const recheckDue = (prev: CaseRecord | undefined) => !!prev && detailLags(prev) && (prev.recheck ?? 0) < MAX_RECHECKS;

export function createSync(
  api: SyncApi,
  now: () => Date,
  broadcast: () => void,
  pause = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  onProgress: (p: SyncProgress | null) => void = () => {},
) {
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  /** `rechecks`: re-checks already spent on the current disagreement (0 after a list move). */
  async function fetchCase(item: ReportListItem, prev?: CaseRecord, rechecks = 0): Promise<CaseRecord> {
    const detail = await api.getReportDetail(item.reportNumber);
    const files = isGuid(item.id) ? await api.listFiles(item.id) : [];
    const next: CaseRecord = { reportNumber: item.reportNumber, list: item, detail, files, detailFetchedAt: now().getTime(), rev: (prev?.rev ?? 0) + 1 };
    if (detailLags(next)) next.recheck = rechecks + 1;
    return next;
  }

  /** Reads the public guide and keeps the CVEs that credit the researcher. The
   *  first successful run only records; later runs announce new ones on the
   *  linked or suggested case. Never throws: an outage keeps the old record. */
  async function publicStep(
    cases: CaseRecord[],
    cvesByCase: Record<string, string[]>,
    ctx: { nowIso: string; ticketOf: (rn: VulnId) => string | null },
  ): Promise<{ meta: PublicMeta; events: ChangeEvent[] }> {
    const prev = await getMeta<PublicMeta>(META.publicCves);
    const kept: PublicMeta = prev ?? { checkedAt: 0, items: [] };
    if (!api.publicCredits) return { meta: kept, events: [] };
    // Mark the check as begun: if the worker dies mid-request, the next
    // regular poll doesn't start it again (the sweep will).
    if (!prev) await setMeta(META.publicCves, kept);
    try {
      const names = creditNames(cases);
      if (names.length === 0) return { meta: kept, events: [] };
      const first = kept.checkedAt === 0;
      const nowMs = now().getTime();
      const created = cases.map((c) => Date.parse(c.list.createdOn ?? "")).filter((t) => !Number.isNaN(t));
      const since = first ? (created.length ? Math.min(...created) : nowMs - 365 * DAY_MS) : kept.checkedAt - PUBLIC_OVERLAP_MS;
      const rows = await api.publicCredits(new Date(since).toISOString());
      const have = new Map(kept.items.map((i) => [i.cve, i]));
      // A record lookup that failed earlier leaves an item without any record
      // fields; try it again (it decides severity, CWE and the suggestion).
      if (api.publicCve) {
        for (const [cve, item] of have) {
          if (item.severity !== null || item.baseScore !== null || item.cwe.length > 0) continue;
          const record = await api.publicCve(cve).catch(() => null);
          const again = record ? publicCveFrom({ cveNumber: cve, cveTitle: item.title, releaseDate: item.releaseDate }, record) : null;
          if (again) have.set(cve, again);
        }
      }
      const fresh: PublicCve[] = [];
      for (const row of rows) {
        const cve = String(row["cveNumber"] ?? "");
        if (have.has(cve) || fresh.some((f) => f.cve === cve) || !creditedTo(String(row["ackText"] ?? ""), names)) continue;
        const record = api.publicCve ? await api.publicCve(cve).catch(() => null) : null;
        const item = publicCveFrom(row, record);
        if (item) fresh.push(item);
      }
      const events: ChangeEvent[] = [];
      if (!first && fresh.length) {
        const links = (await getMeta<CveLinks>(META.cveLinks)) ?? {};
        const r = resolvePublicCves(cases, fresh, links, cvesByCase);
        // A fact only where the researcher linked it or MSRC named it; on a guessed
        // case the announcement asks instead (and goes if the researcher says no).
        const targets: [VulnId, PublicCve, boolean][] = [
          ...Object.entries(r.byCase).flatMap(([rn, list]) => list.map((x) => [rn, x.item, true] as [VulnId, PublicCve, boolean])),
          ...r.unlinked.filter((u) => u.suggestion).map((u) => [u.suggestion!, u.item, false] as [VulnId, PublicCve, boolean]),
        ];
        for (const [rn, item, sure] of targets) {
          const at = Date.parse(item.releaseDate);
          events.push({
            key: `pubcve|${item.cve}`,
            reportNumber: rn,
            ticketNumber: ctx.ticketOf(rn),
            type: "cve",
            field: "publicCve",
            newValue: item.cve,
            summary: sure ? `${item.cve} is public: ${item.title}` : `${item.cve} is public and credits you (${item.title}). Possibly this case: confirm it on the Cases page`,
            occurredAt: Number.isNaN(at) ? ctx.nowIso : new Date(at).toISOString(),
            detectedAt: ctx.nowIso,
            seen: false,
            own: false,
            sourceId: item.cve,
          });
        }
      }
      return { meta: { checkedAt: nowMs, items: [...have.values(), ...fresh] }, events };
    } catch (e) {
      console.warn("MSRC Dashboard: public CVE check failed", e);
      return { meta: kept, events: [] };
    }
  }


  async function record<T>(work: () => Promise<T>): Promise<T> {
    try {
      const out = await work();
      await setMeta(META.lastSyncAt, now().getTime());
      await setMeta(META.lastError, null);
      return out;
    } catch (e) {
      await setMeta(META.lastError, errorText(e));
      throw e;
    } finally {
      onProgress(null);
      broadcast();
    }
  }

  async function baseline(): Promise<void> {
    const { items, drafts } = splitDrafts(await api.listReports());
    await setMeta(META.drafts, drafts);
    const cases: CaseRecord[] = [];
    onProgress({ phase: "cases", done: 0, total: items.length });
    for (const item of items) {
      cases.push(await fetchCase(item));
      onProgress({ phase: "cases", done: cases.length, total: items.length });
    }
    await putCases(cases);

    const all: ThreadMessage[] = [];
    for (let page = 0; page < MAX_BASELINE_PAGES; page++) {
      const batch = await api.messagesNewestFirst(page * PAGE);
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    onProgress({ phase: "messages", done: all.length, total: null });
    await putMessages(all);

    // History for the feed and timelines — recorded as already seen.
    const ticket = new Map(items.map((i) => [i.reportNumber, i.ticketNumber]));
    const history = messageEvents(all, { now: now().toISOString(), ticketOf: (rn) => ticket.get(rn) ?? null }).map((e) => ({ ...e, seen: true }));
    await addEvents(history);
    const cves = extractCves(all);
    await setMeta(META.cveSnapshot, cves);
    if (api.listNotifications) await setMeta(META.statusHistory, statusHistoryFrom(await api.listNotifications()));
    await setMeta(META.baselineDone, true);
    // After the baseline is safe: a slow public guide can't undo it.
    if (api.publicCredits) await setMeta(META.publicCves, (await publicStep(cases, msrcNamedCves(cves), { nowIso: now().toISOString(), ticketOf: (rn) => ticket.get(rn) ?? null })).meta);
  }

  async function poll(full: boolean): Promise<ChangeEvent[]> {
    const nowIso = now().toISOString();
    const { items, drafts } = splitDrafts(await api.listReports());
    // Drafts stored as cases by older versions (or before this split) go away.
    const storedCases = await getAllCases();
    const stale = storedCases.filter((c) => c.list.status === DRAFT).map((c) => c.reportNumber);
    const prevCases = new Map(storedCases.filter((c) => c.list.status !== DRAFT).map((c) => [c.reportNumber, c]));

    // Messages: newest first until we reach one we already know. Nothing is
    // written until the very end (commitPoll), so a failure loses nothing.
    const stored = await getMessages();
    const known = new Set(stored.map((m) => m.id));
    const fetched: ThreadMessage[] = [];
    for (let page = 0; page < MAX_POLL_PAGES; page++) {
      const batch = await api.messagesNewestFirst(page * PAGE);
      fetched.push(...batch);
      if (batch.length < PAGE || batch.some((m) => known.has(m.id))) break;
    }
    const freshById = new Map(fetched.filter((m) => !known.has(m.id)).map((m) => [m.id, m]));
    const fresh = [...freshById.values()];
    const freshReports = new Set(fresh.map((m) => m.reportNumber));

    // Exact status times: read the notification feed only when a status moved
    // (or on the sweep), so a quiet poll stays at two requests.
    const statusMoved = items.some((it) => {
      const p = prevCases.get(it.reportNumber);
      return !!p && (p.list.status !== it.status || p.list.statusReason !== it.statusReason);
    });
    let history: StatusHistory | null = null;
    if (api.listNotifications && (full || statusMoved)) history = statusHistoryFrom(await api.listNotifications());
    const statusTime = statusTimeFrom(history ?? (await getMeta<StatusHistory>(META.statusHistory)) ?? {});

    const events: ChangeEvent[] = [];
    const nextCases: CaseRecord[] = [];
    let swept = 0;
    for (const item of items) {
      if (full) onProgress({ phase: "sweep", done: swept++, total: items.length });
      const prev = prevCases.get(item.reportNumber);
      const moved = listMoved(prev, item);
      if (full || freshReports.has(item.reportNumber) || moved || recheckDue(prev)) {
        if (full) await pause(SWEEP_PAUSE_MS);
        const next = await fetchCase(item, prev, moved ? 0 : (prev?.recheck ?? 0));
        events.push(...diffCase(prev, next, { now: nowIso, statusTime }));
        nextCases.push(next);
      } else if (prev) {
        nextCases.push({ ...prev, list: item });
      }
    }

    const ticket = new Map(items.map((i) => [i.reportNumber, i.ticketNumber]));
    const ticketOf = (rn: VulnId) => ticket.get(rn) ?? null;
    events.push(...messageEvents(fresh, { now: nowIso, ticketOf }));

    const allMsgs = [...stored, ...fresh];
    markOwnUploads(events, allMsgs, nextCases);

    const before = (await getMeta<Record<VulnId, CveRef[]>>(META.cveSnapshot)) ?? {};
    const after = extractCves(allMsgs);
    const msgTime = new Map(allMsgs.map((m) => [m.id, m.createdOn]));
    events.push(...cveEvents(before, after, { now: nowIso, ticketOf, msgTime: (id) => msgTime.get(id) }));


    const newEvents = await commitPoll({
      cases: nextCases,
      messages: fetched,
      events,
      meta: { [META.cveSnapshot]: after, [META.drafts]: drafts, ...(history ? { [META.statusHistory]: history } : {}) },
      removeCases: stale,
    });

    // Public CVEs: on the sweep, or once on an install that has never checked.
    // Runs after the poll is committed, so a slow guide can't lose its work.
    if (api.publicCredits && (full || !(await getMeta<PublicMeta>(META.publicCves)))) {
      const pub = await publicStep(nextCases, msrcNamedCves(after), { nowIso, ticketOf });
      await setMeta(META.publicCves, pub.meta);
      newEvents.push(...(await addEvents(pub.events)));
    }
    return newEvents;
  }

  return {
    /** Baseline if none exists yet, else poll/sweep — decided inside the queue
     *  so overlapping triggers (alarm + install + button) never double-baseline. */
    runAuto: (kind: "poll" | "sweep") =>
      serial(() =>
        record(async (): Promise<ChangeEvent[]> => {
          if ((await getMeta<boolean>(META.baselineDone)) !== true) {
            await baseline();
            return [];
          }
          return poll(kind === "sweep");
        }),
      ),
    runBaseline: () => serial(() => record(baseline)),
    runPoll: () => serial(() => record(() => poll(false))),
    runSweep: () => serial(() => record(() => poll(true))),
  };
}

/** Files that arrive within minutes of the researcher's own message (or the
 *  submission itself) are the researcher's uploads: recorded, but silent. */
function markOwnUploads(events: ChangeEvent[], msgs: ThreadMessage[], cases: CaseRecord[]): void {
  const created = new Map(cases.map((c) => [c.reportNumber, c.list.createdOn]));
  // Live: file.createdBy is always the upload service account and
  // submittedById is the report owner, so neither identifies the uploader.
  for (const e of events) {
    if (e.type !== "file_added") continue;
    const at = Date.parse(e.occurredAt);
    const near = (iso: string | null | undefined) => !!iso && Math.abs(Date.parse(iso) - at) <= OWN_FILE_WINDOW_MS;
    const own = near(created.get(e.reportNumber)) || msgs.some((m) => m.reportNumber === e.reportNumber && m.senderName !== MSRC_SENDER && near(m.createdOn));
    if (own) {
      e.own = true;
      e.seen = true;
    }
  }
}
