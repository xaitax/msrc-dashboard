// View model for the dashboard: pure derivation from the store's contents.
import { awardSummary, type AwardSummary } from "../core/awards";
import { caseClock, type CaseClock } from "../core/caseClock";
import { extractCves, msrcNamedCves } from "../core/cve";
import { resolvePublicCves, type CveLinks, type PublicCve, type PublicMeta } from "../core/publicCves";
import { caseStatus, caseStatusReason, caseTitle, isClosed, isUnseen, MSRC_SENDER, PIPELINE } from "../core/derive";
import { needsAction } from "../core/statusGuide";
import type { StatusHistory } from "../core/history";
import { send, type AppState } from "../shared/protocol";
import type { CaseRecord, ChangeEvent, DraftRef, ThreadMessage, VulnId } from "../shared/types";
import { getAllCases, getEvents, getMessages, getMeta, META } from "../store/db";
import { dayLabel } from "./format";



export interface Stage {
  index: number; // -1 = not on the rail (draft/submitted/unknown)
  duplicate: boolean;
}

export function stageOf(status: string | null | undefined): Stage {
  const s = status ?? "";
  const index = PIPELINE.findIndex(({ prefix: p }) => s === p || s.startsWith(p + "_"));
  return { index, duplicate: s.endsWith("_DUPLICATE") };
}

export interface CaseRow {
  reportNumber: VulnId;
  ticketNumber: string | null;
  title: string;
  status: string | null;
  statusReason: string | null;
  /** MSRC put the case on hold until the researcher replies. */
  actionNeeded: boolean;
  prevStatus?: string;
  stage: Stage;
  prevStage?: Stage;
  lastChange: ChangeEvent | null;
  lastChangeAt: string | null;
  cves: string[];
  unseen: boolean;
  closed: boolean;
  points: number;
  /** Public CVEs tied to this case (by MSRC naming it, or by the researcher). */
  publicCves: { item: PublicCve; by: "you" | "msrc" }[];
  /** The case's day against the 90-day mark, and MSRC's silence on it. */
  clock: CaseClock;
  record: CaseRecord;
}

export type FeedItem = ChangeEvent & { count: number };

export interface FeedGroup {
  label: string;
  events: FeedItem[];
}


export interface PointsSummary {
  total: number;
  cases: number;
  byQuarter: { year: number; quarter: number; points: number; cases: number }[];
}

export interface ViewModel {
  points: PointsSummary;
  awards: AwardSummary;
  history: StatusHistory;
  rows: CaseRow[];
  state: AppState;
  messages: ThreadMessage[];
  events: ChangeEvent[];
  drafts: DraftRef[]; // portal drafts, newest edit first
  unseen: number; // changes the researcher hasn't seen (Activity badge and page)
  /** Public CVEs crediting the researcher that no case claims yet, with a guess. */
  publicUnlinked: { item: PublicCve; suggestion: VulnId | null }[];
  /** Public CVEs the researcher marked "not mine". */
  publicDismissed: PublicCve[];
}


/** Events newest first. */
export const newestFirst = (a: { occurredAt: string }, b: { occurredAt: string }) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
/** Cases by their latest change, newest first. */
export const byRecency = (a: CaseRow, b: CaseRow) => Date.parse(b.lastChangeAt ?? "0") - Date.parse(a.lastChangeAt ?? "0");

/** Events grouped by local day, newest first; identical same-day lines on one
 *  case fold into one item with a count. `days` = null keeps everything. */
export function groupFeed(events: ChangeEvent[], now: Date, days: number | null): FeedGroup[] {
  const cutoff = days === null ? -Infinity : now.getTime() - days * 86_400_000;
  const feed: FeedGroup[] = [];
  for (const e of [...events].filter((e) => Date.parse(e.occurredAt) >= cutoff).sort(newestFirst)) {
    const label = dayLabel(new Date(e.occurredAt), now);
    let group = feed[feed.length - 1];
    if (!group || group.label !== label) feed.push((group = { label, events: [] }));
    // Only identical lines fold, so a different milestone is never hidden.
    const twin = group.events.find((x) => x.reportNumber === e.reportNumber && x.type === e.type && x.summary === e.summary);
    if (twin) {
      twin.count += 1;
      twin.seen = twin.seen && e.seen;
    } else group.events.push({ ...e, count: 1 });
  }
  return feed;
}

function pointsOf(c: CaseRecord): number {
  const v = c.detail?.["casePoint"] ?? c.list.raw["casePoint"];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Recognition points MSRC stores per case (casePoint), totalled by the quarter
 *  the case was submitted in (an approximation of how the rankings count). */
export function pointsSummary(rows: CaseRow[]): PointsSummary {
  const q = new Map<string, { year: number; quarter: number; points: number; cases: number }>();
  for (const r of rows) {
    if (r.points <= 0) continue;
    const d = new Date(r.record.list.createdOn ?? r.lastChangeAt ?? 0);
    const year = d.getUTCFullYear();
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    const k = year + "-" + quarter;
    const e = q.get(k) ?? { year, quarter, points: 0, cases: 0 };
    e.points += r.points;
    e.cases += 1;
    q.set(k, e);
  }
  const byQuarter = [...q.values()].sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  return { total: byQuarter.reduce((s, x) => s + x.points, 0), cases: byQuarter.reduce((s, x) => s + x.cases, 0), byQuarter };
}

export function buildView(
  cases: CaseRecord[],
  msgs: ThreadMessage[],
  events: ChangeEvent[],
  state: AppState,
  history: StatusHistory = {},
  drafts: DraftRef[] = [],
  pub: { publicCves?: PublicCve[]; cveLinks?: CveLinks } = {},
  now: Date = new Date(),
): ViewModel {
  const eventsByCase = new Map<VulnId, ChangeEvent[]>();
  for (const e of [...events].sort(newestFirst)) eventsByCase.set(e.reportNumber, [...(eventsByCase.get(e.reportNumber) ?? []), e]);
  const msgsByCase = new Map<VulnId, ThreadMessage[]>();
  for (const m of msgs) msgsByCase.set(m.reportNumber, [...(msgsByCase.get(m.reportNumber) ?? []), m]);
  const cves = extractCves(msgs);
  const publicCves = resolvePublicCves(cases, pub.publicCves ?? [], pub.cveLinks ?? {}, msrcNamedCves(cves));

  const rows: CaseRow[] = cases.map((c) => {
    const evs = eventsByCase.get(c.reportNumber) ?? [];
    const unseen = evs.filter(isUnseen);
    const status = caseStatus(c);
    const statusReason = caseStatusReason(c);
    const statusChange = unseen.find((e) => e.type === "status");
    const prevStatus = statusChange && typeof statusChange.oldValue === "string" ? statusChange.oldValue : undefined;
    const lastChange = evs[0] ?? null;
    const closed = isClosed(status) || status === "CLOSED";
    const caseMsgs = msgsByCase.get(c.reportNumber) ?? [];
    const casePublic = publicCves.byCase[c.reportNumber] ?? [];
    const clock = caseClock(
      {
        submittedAt: c.list.createdOn,
        open: !closed,
        fixedPublicly: casePublic.length > 0,
        actionNeeded: needsAction(statusReason),
        msrcTimes: [...caseMsgs.filter((m) => m.senderName === MSRC_SENDER).map((m) => m.createdOn), ...(history[c.reportNumber] ?? []).map((p) => p.at)],
        ownTimes: caseMsgs.filter((m) => m.senderName !== MSRC_SENDER).map((m) => m.createdOn),
      },
      now,
    );
    return {
      reportNumber: c.reportNumber,
      ticketNumber: c.list.ticketNumber,
      title: caseTitle(c),
      status,
      statusReason,
      actionNeeded: needsAction(statusReason),
      prevStatus,
      stage: stageOf(status),
      prevStage: prevStatus ? stageOf(prevStatus) : undefined,
      lastChange,
      lastChangeAt: lastChange?.occurredAt ?? c.list.lastActivityOn,
      cves: Array.from(new Set([...(cves[c.reportNumber] ?? []).map((r) => r.cve), ...(publicCves.byCase[c.reportNumber] ?? []).map((x) => x.item.cve)])),
      publicCves: casePublic,
      clock,
      unseen: unseen.length > 0,
      closed: isClosed(status),
      points: pointsOf(c),
      record: c,
    };
  });
  rows.sort(byRecency);



  const byEdit = (d: DraftRef) => Date.parse(d.lastActivityOn ?? d.createdOn ?? "0") || 0;
  return { rows, state, unseen: events.filter(isUnseen).length, messages: msgs, events, points: pointsSummary(rows), awards: awardSummary(cases), publicUnlinked: publicCves.unlinked, publicDismissed: publicCves.dismissed, history, drafts: [...drafts].sort((a, b) => byEdit(b) - byEdit(a)) };
}

/** The panel keeps showing as "new" what was unseen when the case was opened,
 *  even though opening it marks everything seen in the store. */
export function pinUnseen(events: ChangeEvent[], pinned: ReadonlySet<string>): ChangeEvent[] {
  return pinned.size ? events.map((e) => (pinned.has(e.key) ? { ...e, seen: false } : e)) : events;
}

const EMPTY_STATE: AppState = { auth: "signed_out", lastSyncAt: null, lastError: null, syncing: false, baselineDone: false, progress: null, sessionExpiresAt: null, sessionStartedAt: null, lastSessionLengthMs: null };

export async function loadView(): Promise<ViewModel> {
  const [cases, msgs, events, history, drafts, publicMeta, cveLinks, state] = await Promise.all([
    getAllCases(),
    getMessages(),
    getEvents(),
    getMeta<StatusHistory>(META.statusHistory),
    getMeta<DraftRef[]>(META.drafts),
    getMeta<PublicMeta>(META.publicCves),
    getMeta<CveLinks>(META.cveLinks),
    send<AppState>({ type: "state:get" }),
  ]);
  return buildView(cases, msgs, events, state ?? EMPTY_STATE, history ?? {}, drafts ?? [], { publicCves: publicMeta?.items ?? [], cveLinks: cveLinks ?? {} });
}
