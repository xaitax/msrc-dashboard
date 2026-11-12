import { useState } from "preact/hooks";
import { humanizeEnum } from "../../core/derive";
import { boardColumns, type Strip } from "../board";
import type { DraftRef } from "../../shared/types";
import type { CaseRow } from "../data";
import { caseLabel, shortWhen, when } from "../format";
import { TYPE_CLASS } from "./eventStyle";
import { StatusPill } from "./StageRail";

export function CaseCard({ row, onOpen, showStatus }: { row: CaseRow; onOpen: (rn: string) => void; showStatus?: boolean }) {
  return (
    <button class={["card", row.unseen ? "is-unseen" : "", row.closed ? "is-closed" : ""].join(" ")} onClick={() => onOpen(row.reportNumber)}>
      <span class="card__top">
        {row.unseen && <span class="card__new" title="New since your last visit" />}
        <span class="card__num">{caseLabel(row)}</span>
        {showStatus && <StatusPill stage={row.stage} text={humanizeEnum(row.status)} />}
        {row.cves[0] && (
          <span class="cve" title={row.cves.join(", ")}>
            {row.cves[0]}
          </span>
        )}
        <span class="card__when" title={row.lastChangeAt ? new Date(row.lastChangeAt).toLocaleString() : ""}>
          {shortWhen(row.lastChangeAt)}
        </span>
      </span>
      <span class="card__title">{row.title || row.reportNumber}</span>
      <span class="card__foot">
        {row.lastChange && <span class={`dot dot--${TYPE_CLASS[row.lastChange.type]}`} aria-hidden="true" />}
        <span class="card__last" title={row.lastChange?.summary ?? ""}>
          {row.lastChange?.summary ?? ""}
        </span>
      </span>
    </button>
  );
}

/** "Since your last visit": at most `cards` per-case cards; overflow becomes a "+N more" card. */
export function SinceStrip({ strip, onOpen, onAll, onMarkSeen }: { strip: Strip; onOpen: (rn: string) => void; onAll: () => void; onMarkSeen: () => void }) {
  return (
    <section class={`since since--${strip.mode}`} aria-label="Since your last visit">
      <div class="since__head">
        <h2 class="since__title">{strip.mode === "new" ? "Since your last visit" : "Latest changes"}</h2>
        <span class="since__sub">
          {strip.mode === "new" ? `${strip.total} new ${strip.total === 1 ? "change" : "changes"} on ${strip.cards.length + strip.more} ${strip.cards.length + strip.more === 1 ? "case" : "cases"}` : "Nothing new since your last visit"}
        </span>
        <span class="top__grow" />
        {strip.mode === "new" && (
          <button class="link" onClick={onMarkSeen}>
            Mark all seen
          </button>
        )}
        <button class="link" onClick={onAll}>
          All activity
        </button>
      </div>
      <div class="since__row">
        {strip.cards.map((c) => (
          <button key={c.reportNumber} class="chg" onClick={() => onOpen(c.reportNumber)}>
            <span class={`dot dot--${TYPE_CLASS[c.latest.type]}`} aria-hidden="true" />
            <span class="chg__body">
              <span class="chg__what">
                <b>{caseLabel(c)}</b> {c.latest.summary}
              </span>
              <span class="chg__meta">
                {when(c.latest.occurredAt)}
                {c.count > 1 && <span class="chg__more"> · +{c.count - 1} more</span>}
              </span>
            </span>
          </button>
        ))}
        {strip.more > 0 && (
          <button class="chg chg--more" onClick={onAll}>
            <b>+{strip.more}</b> more {strip.more === 1 ? "case" : "cases"} changed
          </button>
        )}
      </div>
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

export function Board({ rows, onOpen, searching }: { rows: CaseRow[]; onOpen: (rn: string) => void; searching: boolean }) {
  const [showClosed, setShowClosed] = useState(false);
  const { columns, closed, offBoard } = boardColumns(rows);
  const closedOpen = showClosed || searching;
  return (
    <div class="boardwrap">
      <div class="board" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(17rem, 1fr))` }}>
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
      <section class="closed">
        <button class="closed__toggle" aria-expanded={closedOpen} onClick={() => setShowClosed((v) => !v)}>
          <span class="swatch swatch--complete" aria-hidden="true" />
          Closed <span class="col__n">{closed.length}</span>
          <span class="closed__chev" aria-hidden="true">
            {closedOpen ? "▾" : "▸"}
          </span>
        </button>
        {closedOpen && (
          <div class="closed__grid">
            {closed.map((r) => (
              <CaseCard key={r.reportNumber} row={r} onOpen={onOpen} showStatus />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
