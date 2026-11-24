import { DISCLOSURE_DAYS, type CaseClock, type Deadline, type Quiet } from "../../core/caseClock";
import { dayDate, shortWhen } from "../format";
import type { ComponentChildren } from "preact";
import { BoardDate } from "./BoardDate";

// How long a case has been with MSRC: its day against the 90-day mark and how
// long MSRC has been silent. Two scan-friendly metrics on the board card, a bar on the case page.

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

/** Open cards use the same two slots for case age and MSRC activity. */
export function CardClock({ clock, published, now = new Date() }: { clock: CaseClock; published: boolean; now?: Date }) {
  if (!clock.open) return null;
  const d = clock.deadline;
  const q = clock.quiet;
  let ageLabel = published ? "90-day clock stopped" : "Submission date";
  if (d) {
    if (d.state === "running") ageLabel = "Since submission";
    else if (d.daysLeft === 0) ageLabel = "At the 90-day mark";
    else if (d.daysLeft > 0) ageLabel = `90-day mark in ${count(d.daysLeft, "day")}`;
    else ageLabel = "Past the 90-day mark";
  }
  let activity: ComponentChildren = "No update yet";
  let activityLabel = "MSRC activity";
  if (q?.kind === "since-submission") {
    activity = "No update";
    activityLabel = "Since submission";
  } else if (q) {
    activity = count(q.days, "day");
    activityLabel = q.kind === "unanswered" ? "Awaiting MSRC reply" : "Since MSRC activity";
  } else if (clock.onlyReceipt) {
    activity = "Receipt only";
  } else if (clock.lastMsrcAt) {
    activity = <BoardDate at={clock.lastMsrcAt} label={shortWhen(clock.lastMsrcAt, now)} />;
    activityLabel = "Last MSRC activity";
  }
  return (
    <span class="card__clock">
      <span class={`card-clock__metric${d ? ` card-clock__metric--${d.state}` : ""}`} title={d ? markText(d, now) : undefined}>
        <strong>{d ? `Day ${d.day}` : published ? "CVE public" : "Unavailable"}</strong>
        <small>{ageLabel}</small>
      </span>
      <span class="card-clock__metric card-clock__metric--msrc" title={q ? quietTitle(q, now) : clock.lastMsrcAt ? dayDate(clock.lastMsrcAt, now) : undefined}>
        <strong>{activity}</strong>
        <small>{activityLabel}</small>
      </span>
    </span>
  );
}

/** Case page: the day count with a bar to the mark, and MSRC's last word. */
export function CaseTime({ clock, now = new Date() }: { clock: CaseClock; now?: Date }) {
  if (!clock.open) return null;
  const d = clock.deadline;
  const ago = (iso: string) => {
    const k = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
    return k <= 0 ? "Today" : k === 1 ? "Yesterday" : `${k} days ago`;
  };
  const tone = d?.state === "past" ? "past" : d?.state === "soon" ? "soon" : clock.quiet ? "quiet" : "calm";
  const span = d ? Math.max(d.day, DISCLOSURE_DAYS) : 0;
  const pct = (x: number) => `${Math.round((x / span) * 1000) / 10}%`;
  const unanswered = clock.lastOwnAt && (!clock.lastMsrcAt || Date.parse(clock.lastOwnAt) > Date.parse(clock.lastMsrcAt)) ? clock.lastOwnAt : null;

  return (
    <section class={`ctime ctime--${tone}`} aria-label="Time with MSRC">
      {d && (
        <>
          <div class="ctime__metrics">
            <div class="ctime__metric">
              <b class="ctime__elapsed">Day {Math.max(0, d.day)}</b>
              <span>Since submission</span>
            </div>
            <div class="ctime__metric">
              <b class="ctime__remaining">{d.daysLeft === 0 ? "Today" : count(Math.abs(d.daysLeft), "day")}</b>
              <span>{d.daysLeft > 0 ? "Until the mark" : d.daysLeft < 0 ? "Past the mark" : "At the mark"}</span>
            </div>
          </div>
          <div class="ctime__bar" aria-hidden="true">
            <span class="ctime__fill" style={{ width: pct(Math.max(0, d.day)) }} />
            <span class="ctime__mark" style={{ left: pct(DISCLOSURE_DAYS) }} />
          </div>
          <div class="ctime__deadline" title={markText(d, now)}>
            <span>90-day mark</span><time dateTime={d.at}>{dayDate(d.at, now)}</time>
          </div>
        </>
      )}
      <div class="ctime__signals">
        <div class="ctime__msrc">
          <span>Last MSRC activity</span>
          {clock.lastMsrcAt
            ? <time dateTime={clock.lastMsrcAt} title={dayDate(clock.lastMsrcAt, now)}>{clock.onlyReceipt ? "Receipt only" : ago(clock.lastMsrcAt)}</time>
            : <strong>No update yet</strong>}
        </div>
        {unanswered && (
          <div class="ctime__unanswered"><span>Awaiting a reply</span><time dateTime={unanswered}>Since {dayDate(unanswered, now)}</time></div>
        )}
      </div>
    </section>
  );
}
