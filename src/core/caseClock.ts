// How long a case has been with MSRC: its day against the 90-day mark common in
// coordinated disclosure, and how long MSRC has been silent on it. MSRC itself
// sets no fixed deadline; the 90 days are the researcher's yardstick.

export const DISCLOSURE_DAYS = 90;
/** The board starts showing the mark this many days before it. */
export const SOON_DAYS = 14;
/** MSRC silent this long on an open case is worth showing. */
export const QUIET_DAYS = 30;
/** A researcher's message unanswered this long is worth showing. */
export const UNANSWERED_DAYS = 14;
/** MSRC activity this close to submission is the automatic receipt and triage. */
const RECEIPT_MS = 2 * 86_400_000;
const DAY_MS = 86_400_000;

export interface Deadline {
  /** Whole days since submission. */
  day: number;
  /** ISO time of the 90-day mark. */
  at: string;
  /** Days until the mark; negative once past. */
  daysLeft: number;
  state: "running" | "soon" | "past";
}

export interface Quiet {
  /** since-submission: nothing from MSRC after the receipt; silent: nothing for a while;
   *  unanswered: MSRC was active, but hasn't answered the researcher's newer message. */
  kind: "since-submission" | "silent" | "unanswered";
  days: number;
  since: string;
  /** The researcher's newest message, when MSRC hasn't answered it. */
  unansweredSince: string | null;
}

export interface CaseClock {
  open: boolean;
  submittedAt: string | null;
  deadline: Deadline | null;
  lastMsrcAt: string | null;
  lastOwnAt: string | null;
  quiet: Quiet | null;
  /** MSRC's only activity so far is the automatic receipt and triage. */
  onlyReceipt: boolean;
}

export interface ClockInput {
  submittedAt: string | null;
  /** Not complete or closed. */
  open: boolean;
  /** A public CVE is tied to the case, so the fix is out. */
  fixedPublicly: boolean;
  /** MSRC is waiting on the researcher, so its silence is expected. */
  actionNeeded: boolean;
  /** MSRC's messages and status changes. */
  msrcTimes: readonly string[];
  /** The researcher's messages. */
  ownTimes: readonly string[];
}

function newest(times: readonly string[]): number | null {
  let best: number | null = null;
  for (const t of times) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function caseClock(input: ClockInput, now: Date): CaseClock {
  const t = now.getTime();
  const days = (ms: number) => Math.floor((t - ms) / DAY_MS);
  const submitted = input.submittedAt ? Date.parse(input.submittedAt) : NaN;
  const hasSubmitted = Number.isFinite(submitted);
  const lastMsrc = newest(input.msrcTimes);
  const lastOwn = newest(input.ownTimes);

  const onlyReceipt = hasSubmitted && lastMsrc !== null && lastMsrc - submitted < RECEIPT_MS;

  let deadline: Deadline | null = null;
  if (hasSubmitted && input.open && !input.fixedPublicly) {
    const day = days(submitted);
    const daysLeft = DISCLOSURE_DAYS - day;
    deadline = { day, at: new Date(submitted + DISCLOSURE_DAYS * DAY_MS).toISOString(), daysLeft, state: daysLeft <= 0 ? "past" : daysLeft <= SOON_DAYS ? "soon" : "running" };
  }

  let quiet: Quiet | null = null;
  const base = lastMsrc ?? (hasSubmitted ? submitted : null);
  if (input.open && !input.actionNeeded && base !== null) {
    const unanswered = lastOwn !== null && lastOwn > base ? lastOwn : null;
    const silentDays = days(base);
    if (silentDays >= QUIET_DAYS) {
      quiet = { kind: lastMsrc === null || onlyReceipt ? "since-submission" : "silent", days: silentDays, since: iso(base)!, unansweredSince: iso(unanswered) };
    } else if (unanswered !== null && days(unanswered) >= UNANSWERED_DAYS) {
      quiet = { kind: "unanswered", days: days(unanswered), since: iso(unanswered)!, unansweredSince: iso(unanswered) };
    }
  }

  return { open: input.open, submittedAt: hasSubmitted ? iso(submitted) : null, deadline, lastMsrcAt: iso(lastMsrc), lastOwnAt: iso(lastOwn), quiet, onlyReceipt };
}

/** Short text for a board card. */
export function deadlineTag(d: Deadline): string {
  return d.state === "past" ? `Day ${d.day}, past ${DISCLOSURE_DAYS}` : `Day ${d.day} of ${DISCLOSURE_DAYS}`;
}

export function quietTag(q: Quiet): string {
  if (q.kind === "since-submission") return "MSRC silent since submission";
  if (q.kind === "unanswered") return `No reply for ${q.days} days`;
  return `MSRC silent for ${q.days} days`;
}
