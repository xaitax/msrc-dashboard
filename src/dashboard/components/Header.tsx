import type { AppState } from "../../shared/protocol";
import { formatUsd } from "../../core/awards";
import { ago, sessionLine } from "../format";
import { CaseIcon } from "./CaseIcon";
import { Progress } from "./Progress";

export type Page = "cases" | "activity" | "recognition" | "profile";

interface Props {
  state: AppState;
  page: Page | "case" | "new" | "draft" | "internals";
  onPage: (p: Page) => void;
  /** The title: back to the cases board, search cleared. */
  onHome: () => void;
  unseen: number;
  recognitionTotals?: { points: number; awarded: number };
  query: string;
  onQuery: (q: string) => void;
  searchRef: { current: HTMLInputElement | null };
  onSync: () => void;
  onExport: () => void;
  onNew: () => void;
}

export const NAV: [Page, string][] = [
  ["cases", "Cases"],
  ["activity", "Activity"],
  ["recognition", "Recognition"],
  ["profile", "Profile"],
];

const ICON_PATHS = {
  cases: "M4 5h16v14H4zM9 5v14m6-14v14",
  activity: "M3 12h4l3-6 4 12 3-6h4",
  recognition: "M8 14a6 6 0 1 1 8 0l1 7-5-3-5 3z",
  profile: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 4 6 6",
  sync: "M20 6v5h-5M4 18v-5h5M5 9a7.5 7.5 0 0 1 12.4-2.4L20 11M4 13l2.6 4.4A7.5 7.5 0 0 0 19 15",
  export: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  add: "M12 5v14M5 12h14",
} as const;

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg class="top__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function Header(p: Props) {
  const s = p.state;
  const lastSync = s.lastSyncAt === null ? "Not synced yet" : `Synced ${Date.now() - s.lastSyncAt < 60_000 ? "just now" : ago(s.lastSyncAt)}`;
  const status = s.syncing ? "Syncing…" : s.lastError ? "Sync failed" : lastSync;
  const syncTitle = [
    "Sync now",
    s.lastError,
    s.lastSyncAt ? `Last sync ${new Date(s.lastSyncAt).toLocaleString()}` : null,
    sessionLine(s),
  ].filter(Boolean).join("\n");
  const active = p.page === "case" ? "cases" : p.page === "new" || p.page === "draft" || p.page === "internals" ? null : p.page;
  return (
    <header class="top">
      <a
        class="brand"
        href="#cases"
        title="All cases"
        onClick={(e) => {
          e.preventDefault();
          p.onHome();
        }}
      >
        <span class="brand__mark" aria-hidden="true" />
        <span class="brand__name">MSRC Dashboard</span>
      </a>
      <nav class="nav" aria-label="Pages">
        {NAV.map(([key, label]) => (
          <a key={key} class="nav__item" href={`#${key}`} aria-current={active === key ? "page" : undefined} onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            p.onPage(key);
          }}>
            <Icon name={key} />
            {label}
            {key === "activity" && p.unseen > 0 && <span class="nav__badge">{p.unseen}</span>}
          </a>
        ))}
      </nav>
      <div class="top__search">
        {active === "cases" && (
          <label class="search">
            <span class="sr-only">Search cases</span>
            <Icon name="search" />
            <input ref={p.searchRef} type="search" placeholder="Search cases" value={p.query} onInput={(e) => p.onQuery(e.currentTarget.value)} />
            {p.page === "cases" && <kbd aria-hidden="true">/</kbd>}
          </label>
        )}
      </div>
      {p.recognitionTotals && (
        <a class="top__totals" href="#recognition" onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          p.onPage("recognition");
        }}>
          <span class="top__points">
            <CaseIcon name="points" />
            <span><strong>{p.recognitionTotals.points.toLocaleString()}</strong> pts</span>
          </span>{" "}
          <span class="top__awarded">
            <CaseIcon name="award" />
            <span><strong>{formatUsd(p.recognitionTotals.awarded)}</strong> awarded</span>
          </span>
        </a>
      )}
      <div class="top__actions">
        <div class={`top__sync${s.lastError && !s.syncing ? " top__sync--error" : ""}`}>
          {s.progress && s.baselineDone
            ? <Progress p={s.progress} />
            : <span class="top__sync-state">{status}</span>}
          <button type="button" class="top__sync-button" onClick={p.onSync} disabled={s.syncing} title={syncTitle} aria-label={`Sync now. ${status}`}>
            <Icon name="sync" />
          </button>
        </div>
        <button type="button" class="btn top__action" onClick={p.onExport}>
          <Icon name="export" />
          Export…
        </button>
        <button type="button" class="btn top__action top__action--new" onClick={p.onNew} aria-current={p.page === "new" ? "page" : undefined}>
          <Icon name="add" />
          New report
        </button>
      </div>
    </header>
  );
}
