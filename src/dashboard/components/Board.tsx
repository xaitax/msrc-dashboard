import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { humanizeEnum } from "../../core/derive";
import { changeTextParts } from "../../core/changeText";
import { sinceStrip, type boardColumns } from "../board";
import { sortedTags } from "../../core/annotations";
import type { ChangeEvent, DraftRef } from "../../shared/types";
import type { CaseRow } from "../data";
import { clock, dayLabel } from "../format";
import { BoardDate } from "./BoardDate";
import { CardClock } from "./CaseTime";
import { CaseIcon } from "./CaseIcon";
import { ChangeParts, ChangeText } from "./ChangeText";
import { activityIcon, boardCaseLabel, previewSummary } from "./eventStyle";
import { StatusPill } from "./StageRail";

export function CaseCard({ row, onOpen, showStatus }: { row: CaseRow; onOpen: (rn: string) => void; showStatus?: boolean }) {
  const tags = sortedTags(row.annotation.tags).join(", ");
  const hasNote = !!row.annotation.note.trim();
  const lastChange = row.lastChange;
  const eventIcon = lastChange && activityIcon(lastChange);
  return (
    <a class={["card", "card--case", row.unseen ? "is-unseen" : "", row.closed ? "is-closed" : "", row.actionNeeded ? "is-action" : ""].join(" ")}
      href={`#case=${row.reportNumber}`} onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen(row.reportNumber);
      }}>
      <span class="card__top">
        <span class="card__num">{boardCaseLabel(row)}</span>
        {row.unseen && <span class="card__new" title="New since your last visit" />}
        {showStatus && <StatusPill stage={row.stage} text={humanizeEnum(row.status)} />}
        {row.actionNeeded && (
          <span class="card__action" title="MSRC has put this case on hold until you reply">
            Reply needed
          </span>
        )}
        {row.cves[0] && (
          <span class="cve" title={row.cves.join(", ")}>
            {row.cves[0]}
          </span>
        )}
        {(tags || hasNote) && (
          <span class="card__meta">
            {tags && <span class="card__meta-tags" title={`Tags: ${tags}`}>{tags}</span>}
            {hasNote && <span class="card__note" title="Private note saved"><NoteIcon /><span class="sr-only">Private note saved</span></span>}
          </span>
        )}
      </span>
      <span class="card__title" title={row.title || undefined}>{row.title || row.reportNumber}</span>
      <CardClock clock={row.clock} published={row.publicCves.length > 0} />
      <span class="card__foot">
        <span>{lastChange ? "Latest update" : row.lastChangeAt ? "Last portal activity" : "No activity recorded"}</span>
        {row.lastChangeAt && <BoardDate className="card__activity-time" at={row.lastChangeAt} title={new Date(row.lastChangeAt).toLocaleString()} />}
        {lastChange && eventIcon && (
          <span class="card__update">
            <span class={`card__event-icon chg__icon--${eventIcon}`}><CaseIcon name={eventIcon} /></span>
            <span class="card__last" title={changeTextParts(lastChange).join(" to ")}>
              <ChangeText event={lastChange} text={previewSummary(lastChange)} />
            </span>
          </span>
        )}
      </span>
    </a>
  );
}

function NoteIcon() {
  return (
    <svg class="board-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 10V7a4 4 0 0 1 8 0v3M6 10h12v10H6zM12 14v2" />
    </svg>
  );
}

export function SinceStrip({ events, rows, stageCount, onMarkSeen }: { events: ChangeEvent[]; rows: CaseRow[]; stageCount: number; onMarkSeen: () => void }) {
  const activityLink = useRef<HTMLAnchorElement>(null);
  const section = useRef<HTMLElement>(null);
  const [availableTracks, setAvailableTracks] = useState(1);
  const lanes = Math.min(availableTracks, stageCount);
  const previewColumns = lanes * Math.floor(availableTracks / lanes);
  const capacity = previewColumns === 1 ? 2 : previewColumns;
  const strip = useMemo(() => sinceStrip(events), [events]);
  const cases = useMemo(() => new Map(rows.map(row => [row.reportNumber, row])), [rows]);
  const now = new Date();

  useLayoutEffect(() => {
    const el = section.current;
    if (!el) return;
    const measure = () => {
      // The section measures how many stage-width tracks fit, including empty ones.
      setAvailableTracks(getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section class="since" ref={section} aria-labelledby="latest-changes-title">
      <div class="board-heading since__head">
        <h2 class="since__title" id="latest-changes-title">Latest changes</h2>
        <div class="since__actions">
          {strip.total > 0 && (
            <button type="button" class="link since__mark" onClick={() => {
              activityLink.current?.focus();
              onMarkSeen();
            }}>Mark all seen</button>
          )}
          <a class="link" ref={activityLink} href="#activity">All activity <CaseIcon name="next" /></a>
        </div>
        <span class="sr-only" role="status">{strip.total} unseen updates</span>
      </div>
      <ol class="since__row" style={{ "--preview-columns": previewColumns }} role="list">
        {strip.entries.length === 0 && <li class="since__empty">No activity yet</li>}
        {strip.entries.slice(0, capacity).map(({ event, unseen }) => {
          const date = new Date(event.occurredAt);
          const row = cases.get(event.reportNumber);
          const icon = activityIcon(event);
          return (
            <li key={event.reportNumber}>
              <a class={`chg${unseen ? " is-unseen" : ""}`} href={`#case=${event.reportNumber}`} title={[row?.title, changeTextParts(event).join(" to "), date.toLocaleString()].filter(Boolean).join("\n")}>
                <span class={`chg__icon chg__icon--${icon}`} aria-hidden="true"><CaseIcon name={icon} /></span>
                <span class="chg__what">{unseen && <span class="sr-only">Unseen updates. </span>}<ChangeText event={event} text={previewSummary(event)} /></span>
                <span class="chg__context">
                  <BoardDate className="chg__time" at={event.occurredAt} label={`${dayLabel(date, now)} ${clock(event.occurredAt)}`} />
                  <span aria-hidden="true">·</span>
                  <span class="chg__case">{boardCaseLabel(row ?? event)}</span>
                  {row?.title && <span class="sr-only chg__report">{row.title}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DraftCard({ title, meta, when: at, onOpen }: { title: string; meta: string; when: string | null; onOpen: () => void }) {
  return (
    <button class="card card--draft" onClick={onOpen}>
      <span class="card__top">
        <span class="card__num">{meta}</span>
        {at && <BoardDate className="card__when" at={at} />}
      </span>
      <span class="card__title">{title}</span>
    </button>
  );
}

export function Drafts({ drafts, unsavedNew, onOpenDraft, onNew }: { drafts: DraftRef[]; unsavedNew: string | null; onOpenDraft: (id: string) => void; onNew: () => void }) {
  if (drafts.length === 0 && unsavedNew === null) return null;
  return (
    <section class="closed drafts">
      <h2 class="closed__head">
        Drafts <span class="col__n">{drafts.length + (unsavedNew === null ? 0 : 1)}</span>
      </h2>
      <div class="closed__grid">
        {unsavedNew !== null && <DraftCard title={unsavedNew.trim() || "Untitled report"} meta="Not on MSRC yet" when={null} onOpen={onNew} />}
        {drafts.map((d) => (
          <DraftCard key={d.id} title={d.title.trim() || "Untitled draft"} meta={`Draft · ${d.reportNumber}`} when={d.lastActivityOn ?? d.createdOn} onOpen={() => onOpenDraft(d.id)} />
        ))}
      </div>
    </section>
  );
}

function ClosedCases({ rows }: { rows: CaseRow[] }) {
  if (!rows.length) return null;
  return (
    <section class="closed-register" aria-labelledby="closed-cases-title">
      <h2 class="board-heading" id="closed-cases-title" tabIndex={-1}>Closed cases <span>{rows.length}</span></h2>
      <div class="closed-register__table">
        <table aria-labelledby="closed-cases-title">
          <thead><tr><th scope="col">Case</th><th scope="col">Outcome</th><th scope="col">CVE</th><th scope="col">Last activity</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const summary = row.lastChange ? changeTextParts(row.lastChange) : [row.lastChangeAt ? "Last portal activity" : "No activity recorded"];
              const update = <span title={summary.join(" to ")}><ChangeParts parts={summary} /></span>;
              const cve = row.cves.join(", ");
              const outcome = row.stage.duplicate ? "Duplicate" : row.status === "COMPLETE_RESOLVED" ? "Resolved" : humanizeEnum(row.status) || "Closed";
              const date = row.lastChangeAt ? <BoardDate at={row.lastChangeAt} title={new Date(row.lastChangeAt).toLocaleString()} /> : null;
              return (
                <tr key={row.reportNumber}>
                  <th scope="row">
                    <a class="closed-register__case" href={`#case=${row.reportNumber}`}>
                      <span class="closed-register__id">{boardCaseLabel(row)}</span>
                      <span class="closed-register__title" title={row.title || undefined}>{row.title || row.reportNumber}</span>
                    </a>
                    <span class="closed-register__compact">
                      {cve && <span>{cve}</span>}
                      {update}
                      {date}
                    </span>
                  </th>
                  <td><StatusPill stage={row.stage} text={outcome} /></td>
                  <td class="closed-register__cve" title={cve || undefined}>{cve || "—"}</td>
                  <td class="closed-register__activity"><div>{update}{date}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Board({ board, onOpen, searching }: { board: ReturnType<typeof boardColumns>; onOpen: (rn: string) => void; searching: boolean }) {
  const { columns, closed, offBoard } = board;
  return (
    <div class="boardwrap">
      <div class="board">
        {columns.map((c) => (
          <section key={c.key} class={`col col--${c.key}`} aria-label={`${c.label}: ${c.rows.length}`}>
            <h2 class="board-heading col__head">
              {c.label}
              <span class="col__n">{c.rows.length}</span>
            </h2>
            <div class="col__cards">
              {c.rows.length === 0 && <p class="col__empty">{searching ? "No matching cases" : "No cases in this stage"}</p>}
              {c.rows.map((r) => (
                <CaseCard key={r.reportNumber} row={r} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {offBoard.length > 0 && (
        <section class="closed">
          <h2 class="closed__head">Other</h2>
          <div class="closed__grid">
            {offBoard.map((r) => (
              <CaseCard key={r.reportNumber} row={r} onOpen={onOpen} showStatus />
            ))}
          </div>
        </section>
      )}
      <ClosedCases rows={closed} />
    </div>
  );
}
