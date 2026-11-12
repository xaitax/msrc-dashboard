import type { SyncProgress } from "../../shared/protocol";

const LABEL: Record<SyncProgress["phase"], string> = {
  cases: "Loading case",
  sweep: "Refreshing case",
  messages: "Loading messages",
};

/** Determinate when the total is known (cases), indeterminate otherwise. */
export function Progress({ p, big }: { p: SyncProgress; big?: boolean }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : null;
  const text = p.total ? `${LABEL[p.phase]} ${Math.min(p.done + (p.phase === "messages" ? 0 : 1), p.total)} of ${p.total}` : `${LABEL[p.phase]} (${p.done})`;
  return (
    <div class={`progress${big ? " progress--big" : ""}`}>
      <div class="progress__track" role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <div class={`progress__bar${pct === null ? " progress__bar--busy" : ""}`} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      <span class="progress__text">{text}</span>
    </div>
  );
}
