// View helpers for the latest changes and pipeline board columns.
import type { ChangeEvent } from "../shared/types";
import { byRecency, casePreviewOrder, type CaseRow } from "./data";
import { isUnseen, PIPELINE, type StageKey } from "../core/derive";
import { compareTagNames, sortedTags } from "../core/annotations";

interface StripEntry {
  event: ChangeEvent;
  unseen: boolean;
}

export interface Strip {
  entries: StripEntry[];
  total: number; // unseen changes overall
}

/** One preview per case, ordered by the latest event's actual time. */
export function sinceStrip(events: ChangeEvent[]): Strip {
  const entries = new Map<ChangeEvent["reportNumber"], StripEntry>();
  const recent = events.filter((event) => Number.isFinite(Date.parse(event.occurredAt))).sort(casePreviewOrder);
  for (const event of recent) {
    const unseen = isUnseen(event);
    const entry = entries.get(event.reportNumber);
    if (entry) entry.unseen ||= unseen;
    else entries.set(event.reportNumber, { event, unseen });
  }
  return { entries: [...entries.values()], total: events.filter(isUnseen).length };
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
