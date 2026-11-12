// View helpers for layout A: the "Since your last visit" strip and the
// pipeline board columns.
import type { ChangeEvent, VulnId } from "../shared/types";
import { byRecency, newestFirst, type CaseRow } from "./data";
import { isUnseen, PIPELINE, type StageKey } from "../core/derive";

export interface StripCard {
  reportNumber: VulnId;
  ticketNumber: string | null;
  latest: ChangeEvent;
  count: number;
}

export interface Strip {
  mode: "new" | "latest";
  cards: StripCard[];
  more: number; // further cases beyond the cards shown
  total: number; // unseen changes overall
}

function group(events: ChangeEvent[]): StripCard[] {
  const byCase = new Map<VulnId, StripCard>();
  for (const e of [...events].sort(newestFirst)) {
    const card = byCase.get(e.reportNumber);
    if (card) card.count += 1;
    else byCase.set(e.reportNumber, { reportNumber: e.reportNumber, ticketNumber: e.ticketNumber, latest: e, count: 1 });
  }
  return [...byCase.values()];
}

/** One card per case, newest first, capped; the rest is counted, never dropped. */
export function sinceStrip(events: ChangeEvent[], max = 4): Strip {
  const unseen = events.filter(isUnseen);
  if (unseen.length > 0) {
    const cards = group(unseen);
    return { mode: "new", cards: cards.slice(0, max), more: Math.max(0, cards.length - max), total: unseen.length };
  }
  const cards = group(events);
  return { mode: "latest", cards: cards.slice(0, max), more: 0, total: 0 };
}

export interface Column {
  key: Exclude<StageKey, "complete">;
  label: string;
  rows: CaseRow[];
}

/** The open stages; Complete is folded away below the board. */
const COLS = PIPELINE.slice(0, 4).map((s, i) => [s.key as Column["key"], s.label, i] as const);

/** Open cases by stage (New only when it has cases), newest change first; closed apart. */
export function boardColumns(rows: CaseRow[]): { columns: Column[]; closed: CaseRow[]; offBoard: CaseRow[] } {
  const open = rows.filter((r) => !r.closed);
  const columns = COLS.map(([key, label, i]) => ({ key, label, rows: open.filter((r) => r.stage.index === i).sort(byRecency) })).filter(
    (c) => c.key !== "new" || c.rows.length > 0,
  );
  return {
    columns,
    closed: rows.filter((r) => r.closed).sort(byRecency),
    offBoard: open.filter((r) => r.stage.index < 0), // drafts / unknown statuses
  };
}
