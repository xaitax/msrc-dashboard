import { DISCLOSURE_DAYS, deadlineTag, quietTag, type CaseClock, type Deadline, type Quiet } from "../../core/caseClock";
import { dayDate } from "../format";

// How long a case has been with MSRC: its day against the 90-day mark and how
// long MSRC has been silent. Tags on the board card, a bar on the case page.

const DAY_MS = 86_400_000;
const count = (k: number, unit: string) => `${k} ${unit}${k === 1 ? "" : "s"}`;

function markText(d: Deadline, now: Date): string {
  if (d.daysLeft > 0) return `The ${DISCLOSURE_DAYS}-day mark is ${dayDate(d.at, now)}, in ${count(d.daysLeft, "day")}.`;
  if (d.daysLeft === 0) return `The ${DISCLOSURE_DAYS}-day mark is today.`;
  return `The ${DISCLOSURE_DAYS}-day mark passed on ${dayDate(d.at, now)}, ${count(-d.daysLeft, "day")} ago.`;
}

const unansweredText = (iso: string, now: Date) => `You wrote on ${dayDate(iso, now)} and haven't had a reply.`;

function quietTitle(q: Quiet, now: Date): string {
  const lead = q.kind === "since-submission" ? "Nothing from MSRC since the automatic receipt." : q.kind === "silent" ? `MSRC last wrote or changed the status on ${dayDate(q.since, now)}.` : "";
  return [lead, q.unansweredSince ? unansweredText(q.unansweredSince, now) : ""].filter(Boolean).join(" ");
}

/** Board card: shown only near or past the mark, or when MSRC has gone quiet. */
export function CardClock({ clock, now = new Date() }: { clock: CaseClock; now?: Date }) {
  const d = clock.deadline && clock.deadline.state !== "running" ? clock.deadline : null;
  const q = clock.quiet;
  if (!d && !q) return null;
  return (
    <span class="card__clock">
      {d && (
        <span class={`tag tag--${d.state}`} title={markText(d, now)}>
          {deadlineTag(d)}
        </span>
      )}
      {d && q && " "}
      {q && (
        <span class="tag tag--quiet" title={quietTitle(q, now)}>
          {quietTag(q)}
        </span>
      )}
    </span>
  );
}

/** Case page: the day count with a bar to the mark, and MSRC's last word. */
export function CaseTime({ clock, now = new Date() }: { clock: CaseClock; now?: Date }) {
  if (!clock.open) return null;
  const d = clock.deadline;
  const ago = (iso: string) => {
    const k = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
    return k <= 0 ? "today" : k === 1 ? "yesterday" : `${k} days ago`;
  };
  const tone = d?.state === "past" ? "past" : d?.state === "soon" ? "soon" : clock.quiet ? "quiet" : "calm";
  const span = d ? Math.max(d.day, DISCLOSURE_DAYS) : 0;
  const pct = (x: number) => `${Math.round((x / span) * 1000) / 10}%`;
  const msrc = !clock.lastMsrcAt
    ? "MSRC hasn't written yet."
    : clock.onlyReceipt
      ? "Nothing from MSRC since the automatic receipt when you submitted."
      : /^(today|yesterday)$/.test(ago(clock.lastMsrcAt))
        ? `MSRC last wrote or changed the status ${ago(clock.lastMsrcAt)}.`
        : `MSRC last wrote or changed the status on ${dayDate(clock.lastMsrcAt, now)}, ${ago(clock.lastMsrcAt)}.`;
  const unanswered = clock.lastOwnAt && (!clock.lastMsrcAt || Date.parse(clock.lastOwnAt) > Date.parse(clock.lastMsrcAt)) ? unansweredText(clock.lastOwnAt, now) : "";

  return (
    <section class={`ctime ctime--${tone}`} aria-label="Time with MSRC">
      {d && (
        <>
          <p class="ctime__head">
            {d.day === 0 ? "Submitted today. " : <><b>Day {d.day}</b> since you submitted. </>}
            {markText(d, now)}
          </p>
          <div class="ctime__bar" aria-hidden="true">
            <span class="ctime__fill" style={{ width: pct(d.day) }} />
            <span class="ctime__mark" style={{ left: pct(DISCLOSURE_DAYS) }} />
          </div>
        </>
      )}
      <p class="ctime__msrc">{[msrc, unanswered].filter(Boolean).join(" ")}</p>
    </section>
  );
}
