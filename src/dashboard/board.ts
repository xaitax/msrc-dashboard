// View helpers for layout A: the "Since your last visit" strip and the
// pipeline board columns.
import type { ChangeEvent, VulnId } from "../shared/types";
import { byRecency, newestFirst, type CaseRow } from "./data";
import { isUnseen, PIPELINE, type StageKey } from "../core/derive";
import { compareTagNames, sortedTags } from "../core/annotations";

export interface StripCard {
  reportNumber: VulnId;
  ticketNumber: string | null;
  latest: ChangeEvent;
  count: number;
}

export interface Strip {
  cards: StripCard[];
  unseenCases: number;
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

/** One preview per case, with unseen updates first and recent history filling any free slots. */
export function sinceStrip(events: ChangeEvent[], max = 3): Strip {
  const unseen = events.filter(isUnseen);
  const newCards = group(unseen);
  const cards = newCards.slice(0, max);
  if (cards.length < max) {
    const previewed = new Set(cards.map((card) => card.reportNumber));
    cards.push(...group(events.filter((event) => !previewed.has(event.reportNumber))).slice(0, max - cards.length));
  }
  return { cards, unseenCases: newCards.length, total: unseen.length };
}

export interface Column {
  key: Exclude<StageKey, "complete">;
  label: string;
  rows: CaseRow[];
}

export type CaseSort = "recent" | "tag" | "title";

export function compareCases(a: CaseRow, b: CaseRow, sort: CaseSort): number {
  if (sort === "title") return compareTagNames(a.title, b.title) || byRecency(a, b);
  if (sort === "tag") {
    const firstA = sortedTags(a.annotation.tags)[0];
    const firstB = sortedTags(b.annotation.tags)[0];
    if (!firstA) return firstB ? 1 : byRecency(a, b);
    if (!firstB) return -1;
    return compareTagNames(firstA, firstB) || byRecency(a, b);
  }
  return byRecency(a, b);
}

/** The open stages; Complete is folded away below the board. */
const COLS = PIPELINE.slice(0, 4).map((s, i) => [s.key as Column["key"], s.label, i] as const);

/** Open cases by stage (New only when it has cases), newest change first; closed apart. */
export function boardColumns(rows: CaseRow[], sort: CaseSort = "recent"): { columns: Column[]; closed: CaseRow[]; offBoard: CaseRow[] } {
  const open = rows.filter((r) => !r.closed);
  const columns = COLS.map(([key, label, i]) => ({ key, label, rows: open.filter((r) => r.stage.index === i).sort((a, b) => compareCases(a, b, sort)) })).filter(
    (c) => c.key !== "new" || c.rows.length > 0,
  );
  return {
    columns,
    closed: rows.filter((r) => r.closed).sort((a, b) => compareCases(a, b, sort)),
    offBoard: open.filter((r) => r.stage.index < 0).sort((a, b) => compareCases(a, b, sort)), // drafts / unknown statuses
  };
}
