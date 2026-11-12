import type { AppState } from "../../shared/protocol";
import { formatUsd } from "../../core/awards";
import { ago, sessionLine } from "../format";
import { Progress } from "./Progress";

export type Page = "cases" | "activity" | "recognition" | "profile";

interface Props {
  state: AppState;
  page: Page | "case" | "new" | "draft";
  onPage: (p: Page) => void;
  unseen: number;
  points: number;
  /** Bounty awards on the researcher's cases, in US dollars. */
  awarded: number;
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

export function Header(p: Props) {
  const s = p.state;
  const status = s.syncing ? "Syncing…" : s.lastError ? `Sync failed: ${s.lastError}` : `Synced ${ago(s.lastSyncAt)}`;
  const active = p.page === "case" ? "cases" : p.page === "new" || p.page === "draft" ? null : p.page;
  return (
    <header class="top">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true" />
        <span class="brand__name">MSRC Dashboard</span>
      </div>
      <nav class="nav" aria-label="Pages">
        {NAV.map(([key, label]) => (
          <button key={key} class="nav__item" aria-current={active === key ? "page" : undefined} onClick={() => p.onPage(key)}>
            {label}
            {key === "activity" && p.unseen > 0 && <span class="nav__badge">{p.unseen}</span>}
          </button>
        ))}
      </nav>
      <span class="top__grow" />
      {p.points > 0 && (
        <button class="pts" onClick={() => p.onPage("recognition")} title="Recognition points MSRC assigned to your cases. Opens Recognition.">
          <svg viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">
            <path d="M232,64H208V48a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V64H24A16,16,0,0,0,8,80V96a40,40,0,0,0,40,40h3.65A80.13,80.13,0,0,0,120,191.61V216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V191.58c31.94-3.23,58.44-25.64,68.08-55.58H208a40,40,0,0,0,40-40V80A16,16,0,0,0,232,64ZM48,120A24,24,0,0,1,24,96V80H48v32q0,4,.39,8ZM232,96a24,24,0,0,1-24,24h-.5a81.81,81.81,0,0,0,.5-8.9V80h24Z" />
          </svg>
          <b>{p.points}</b> pts
        </button>
      )}
      {p.awarded > 0 && (
        <button class="pts pts--usd" onClick={() => p.onPage("recognition")} title="Bounty awards on your cases, as MSRC records them per case. Opens Recognition.">
          <b>{formatUsd(p.awarded)}</b> awarded
        </button>
      )}
      {s.progress && s.baselineDone ? (
        <Progress p={s.progress} />
      ) : (
        <span class={`top__sync${s.lastError && !s.syncing ? " is-err" : ""}`} title={[s.lastSyncAt ? `Last sync ${new Date(s.lastSyncAt).toLocaleString()}` : "", sessionLine(s)].filter(Boolean).join("\n")}>
          {status}
        </span>
      )}
      {active === "cases" && (
        <label class="search">
          <span class="sr-only">Search cases</span>
          <svg viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">
            <path d="M228.24,219.76l-51.38-51.38a86.15,86.15,0,1,0-8.48,8.48l51.38,51.38a6,6,0,0,0,8.48-8.48ZM38,112a74,74,0,1,1,74,74A74.09,74.09,0,0,1,38,112Z" />
          </svg>
          <input ref={p.searchRef} type="search" placeholder="Search cases" value={p.query} onInput={(e) => p.onQuery((e.target as HTMLInputElement).value)} />
          <kbd aria-hidden="true">/</kbd>
        </label>
      )}
      <button class="btn" onClick={p.onSync} disabled={s.syncing}>
        Sync now
      </button>
      <button class="btn" onClick={p.onExport}>
        Export…
      </button>
      <button class="btn btn--primary" onClick={p.onNew} aria-current={p.page === "new" ? "page" : undefined}>
        New report
      </button>
    </header>
  );
}
