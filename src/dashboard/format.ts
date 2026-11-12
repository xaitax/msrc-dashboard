// Time and label formatting for the dashboard (local time zone).

export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Today 10:05", "Yesterday 16:40", "Mon 9 Nov 14:20" (this week), "3 Oct". */
export function when(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const label = dayLabel(d, now);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (label === "Today" || label === "Yesterday" || days < 7) return `${label} ${clock(iso)}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** Compact date for cards: time today, "Yesterday", else "5 Nov" (+ year if not this year). */
export function shortWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const label = dayLabel(d, now);
  if (label === "Today") return clock(iso);
  if (label === "Yesterday") return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function ago(ms: number | null, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export { caseLabel } from "../core/derive";

function duration(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * 3_600_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} days`;
}

/** "Signed in since Wed 09:10. The previous session lasted 23 h." — the
 *  refresh token's real lifetime is unknown, so the dashboard measures it. */
export function sessionLine(s: { sessionStartedAt: number | null; lastSessionLengthMs: number | null }): string {
  if (!s.sessionStartedAt) return "";
  const since = new Date(s.sessionStartedAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `Signed in since ${since}.` + (s.lastSessionLengthMs ? ` The previous session lasted ${duration(s.lastSessionLengthMs)}.` : "");
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
