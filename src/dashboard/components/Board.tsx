import { useRef } from "preact/hooks";
import { humanizeEnum, isUnseen } from "../../core/derive";
import { boardColumns, type CaseSort, type Strip } from "../board";
import { sortedTags } from "../../core/annotations";
import type { ChangeEvent, DraftRef } from "../../shared/types";
import type { CaseRow } from "../data";
import { caseLabel, shortWhen, when } from "../format";
import { CardClock } from "./CaseTime";
import { StatusPill } from "./StageRail";

export function CaseCard({ row, onOpen, showStatus }: { row: CaseRow; onOpen: (rn: string) => void; showStatus?: boolean }) {
  const tags = sortedTags(row.annotation.tags).join(", ");
  const hasNote = !!row.annotation.note.trim();
  return (
    <a class={["card", "card--case", row.unseen ? "is-unseen" : "", row.closed ? "is-closed" : "", row.actionNeeded ? "is-action" : ""].join(" ")}
      href={`#case=${row.reportNumber}`} onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen(row.reportNumber);
      }}>
      <span class="card__top">
        <span class="card__num">{caseLabel(row)}</span>
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
            {hasNote && <span class="card__note" title="Private note saved"><BoardIcon name="note" /><span class="sr-only">Private note saved</span></span>}
          </span>
        )}
      </span>
      <span class="card__title" title={row.title || undefined}>{row.title || row.reportNumber}</span>
      <CardClock clock={row.clock} published={row.publicCves.length > 0} />
      <span class="card__foot">
        <span class="card__last" title={row.lastChange?.summary}>
          {row.lastChange?.summary ?? (row.lastChangeAt ? "Last portal activity" : "No activity recorded")}
        </span>
        {row.lastChangeAt && <time class="card__activity-time" dateTime={row.lastChangeAt} title={new Date(row.lastChangeAt).toLocaleString()}>{shortWhen(row.lastChangeAt)}</time>}
      </span>
    </a>
  );
}

const BOARD_ICONS = {
  inbox: "M5 5h14l3 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5l3-8Zm-3 8h6l2 2h4l2-2h6",
  check: "M5 12l4 4L19 6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  message: "M20 6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V6ZM8 9h8m-8 3h5",
  status: "M5 7h14m-4-4 4 4-4 4M19 17H5m4-4-4 4 4 4",
  file: "M8 13l6-6a2.2 2.2 0 1 1 3.1 3.1l-8 8a4 4 0 1 1-5.7-5.7l9-9",
  flag: "M5 21V4h12l-2.5 4 2.5 4H5",
  note: "M8 10V7a4 4 0 0 1 8 0v3M6 10h12v10H6zM12 14v2",
  update: "M5 6h14M5 12h14M5 18h8",
} as const;

function BoardIcon({ name }: { name: keyof typeof BOARD_ICONS }) {
  return (
    <svg class="board-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={BOARD_ICONS[name]} />
    </svg>
  );
}

function updateIcon(event: ChangeEvent): keyof typeof BOARD_ICONS {
  if (event.field === "isFlagged") return "flag";
  switch (event.type) {
    case "msrc_message":
    case "own_message":
      return "message";
    case "status":
    case "status_reason":
      return "status";
    case "file_added":
      return "file";
    default:
      return "update";
  }
}

export function SinceStrip({ strip, onOpen, onAll, onMarkSeen }: { strip: Strip; onOpen: (rn: string) => void; onAll: () => void; onMarkSeen: () => void }) {
  const activityLink = useRef<HTMLButtonElement>(null);
  const caseCount = strip.unseenCases;
  const hasUpdates = strip.total > 0;
  return (
    <section class={`since${hasUpdates ? " since--unseen" : ""}`} aria-labelledby="latest-changes-title">
      <div class="since__head">
        <div class="since__label">
          <span class="since__signal"><BoardIcon name={hasUpdates ? "inbox" : "check"} /></span>
          <h2 class="since__title" id="latest-changes-title">Latest changes</h2>
          <span class="since__sub" role="status">
            {hasUpdates ? `${strip.total} new ${strip.total === 1 ? "update" : "updates"} · ${caseCount} ${caseCount === 1 ? "case" : "cases"}` : strip.cards.length ? "You’re caught up" : "No activity yet"}
          </span>
        </div>
        <div class="since__actions">
          {hasUpdates && (
            <button type="button" class="link since__mark" onClick={() => {
              activityLink.current?.focus();
              onMarkSeen();
            }}>Mark all seen</button>
          )}
          <button type="button" class="link since__activity" ref={activityLink} onClick={onAll}>
            View activity <BoardIcon name="arrow" />
          </button>
        </div>
      </div>
      {strip.cards.length > 0 && (
        <ul class="since__row" aria-label="Recent case updates">
          {strip.cards.map((c) => (
            <li key={c.reportNumber}>
              <button type="button" class={`chg${isUnseen(c.latest) ? " chg--unseen" : ""}`} onClick={() => onOpen(c.reportNumber)}>
                <span class="chg__icon"><BoardIcon name={updateIcon(c.latest)} /></span>
                <span class="chg__info">
                  <span class="chg__label">
                    <b>{caseLabel(c)}</b>
                    {c.count > 1 && <span class="chg__more" title={`${c.count - 1} more changes on this case`}>+{c.count - 1}</span>}
                  </span>
                  <span class="chg__what" title={c.latest.summary}>{c.latest.summary}</span>
                </span>
                <time class="chg__time" dateTime={c.latest.occurredAt} title={when(c.latest.occurredAt)}>{shortWhen(c.latest.occurredAt)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftCard({ title, meta, when: at, onOpen }: { title: string; meta: string; when: string | null; onOpen: () => void }) {
  return (
    <button class="card card--draft" onClick={onOpen}>
      <span class="card__top">
        <span class="card__num">{meta}</span>
        <span class="card__when">{at ? shortWhen(at) : ""}</span>
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
      <h2 id="closed-cases-title" tabIndex={-1}><span class="swatch swatch--complete" aria-hidden="true" />Closed cases <span>{rows.length}</span></h2>
      <div class="closed-register__table">
        <table aria-labelledby="closed-cases-title">
          <thead><tr><th scope="col">Case</th><th scope="col">Outcome</th><th scope="col">CVE</th><th scope="col">Last activity</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const summary = row.lastChange?.summary ?? (row.lastChangeAt ? "Last portal activity" : "No activity recorded");
              const cve = row.cves.join(", ");
              const outcome = row.stage.duplicate ? "Duplicate" : row.status === "COMPLETE_RESOLVED" ? "Resolved" : humanizeEnum(row.status) || "Closed";
              const date = row.lastChangeAt ? <time dateTime={row.lastChangeAt} title={new Date(row.lastChangeAt).toLocaleString()}>{shortWhen(row.lastChangeAt)}</time> : null;
              return (
                <tr key={row.reportNumber}>
                  <th scope="row">
                    <a class="closed-register__case" href={`#case=${row.reportNumber}`}>
                      <span class="closed-register__id">{caseLabel(row)}</span>
                      <span class="closed-register__title" title={row.title || undefined}>{row.title || row.reportNumber}</span>
                    </a>
                    <span class="closed-register__compact">
                      {cve && <span>{cve}</span>}
                      <span title={summary}>{summary}</span>
                      {date}
                    </span>
                  </th>
                  <td><StatusPill stage={row.stage} text={outcome} /></td>
                  <td class="closed-register__cve" title={cve || undefined}>{cve || "—"}</td>
                  <td class="closed-register__activity"><div><span title={summary}>{summary}</span>{date}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Board({ rows, onOpen, searching, sort }: { rows: CaseRow[]; onOpen: (rn: string) => void; searching: boolean; sort: CaseSort }) {
  const { columns, closed, offBoard } = boardColumns(rows, sort);
  return (
    <div class="boardwrap">
      <div class="board">
        {columns.map((c) => (
          <section key={c.key} class={`col col--${c.key}`} aria-label={`${c.label}: ${c.rows.length}`}>
            <h2 class="col__head">
              <span class="swatch" aria-hidden="true" />
              {c.label}
              <span class="col__n">{c.rows.length}</span>
            </h2>
            <div class="col__cards">
              {c.rows.length === 0 && <p class="col__empty">{searching ? "No matches" : "Nothing here"}</p>}
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
