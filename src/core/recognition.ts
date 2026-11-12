// Where the researcher appears on MSRC's public recognition lists. Matching
// is strict on purpose: the full acknowledgement name, the name without the
// handle, or the handle itself — never a bare first name ("Jane" ≠ you).
import { escapeRegExp } from "./text";

export interface RankRow {
  rank: number;
  displayName: string;
  points?: number;
  accuracy?: number;
  impact?: number;
  volume?: number;
}

export interface RecognitionData {
  year: number;
  leaderboards: { bountyProgram: string; period: string; year: number; leaderboardRanks: RankRow[] }[];
  honorableMentions: { year: number; researchers: { displayName: string }[] }[];
  allTime: { year: number; quarter: number | null; product: string | null; leaderboardRanks: RankRow[] }[];
  events?: { event: string; leaderboardRanks: RankRow[] }[];
}

export interface Placements {
  leaderboards: { program: string; period: string; year: number; rank: number; of: number }[];
  honorableMentions: number[];
  allTime: { year: number; quarter: number | null; rank: number; of: number }[];
  events: { event: string; rank: number; of: number }[];
}

export function nameMatcher(acknowledgementName: string): (displayName: string) => boolean {
  const full = acknowledgementName.trim().toLowerCase();
  if (!full) return () => false;
  const handle = /@([\w.-]{3,})/.exec(full)?.[1] ?? null;
  const nameOnly = full.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  const multiWord = nameOnly.split(" ").length >= 2;
  const handleRe = handle ? new RegExp(`(^|[^\\w])@?${escapeRegExp(handle)}([^\\w]|$)`) : null;
  return (displayName: string) => {
    const dn = String(displayName ?? "").trim().toLowerCase();
    if (!dn) return false;
    if (dn === full || dn === nameOnly) return true;
    if (multiWord && dn.includes(nameOnly)) return true;
    return !!handleRe && handleRe.test(dn);
  };
}

export function findPlacements(data: RecognitionData, acknowledgementName: string): Placements {
  const isMe = nameMatcher(acknowledgementName);
  const out: Placements = { leaderboards: [], honorableMentions: [], allTime: [], events: [] };
  for (const t of data.leaderboards) {
    const r = t.leaderboardRanks.find((x) => isMe(x.displayName));
    if (r) out.leaderboards.push({ program: t.bountyProgram, period: t.period, year: t.year, rank: r.rank, of: t.leaderboardRanks.length });
  }
  for (const h of data.honorableMentions) if (h.researchers.some((x) => isMe(x.displayName))) out.honorableMentions.push(h.year);
  for (const t of data.allTime) {
    const r = t.leaderboardRanks.find((x) => isMe(x.displayName));
    if (r) out.allTime.push({ year: t.year, quarter: t.quarter, rank: r.rank, of: t.leaderboardRanks.length });
  }
  for (const t of data.events ?? []) {
    const r = t.leaderboardRanks.find((x) => isMe(x.displayName));
    if (r) out.events.push({ event: t.event, rank: r.rank, of: t.leaderboardRanks.length });
  }
  return out;
}

/** "ZDQ_LEADERBOARD2026" → "Zero Day Quest 2026". */
export function eventLabel(e: string): string {
  const m = /^ZDQ_LEADERBOARD(\d{4})$/.exec(e);
  return m ? `Zero Day Quest ${m[1]}` : e;
}

const PROGRAM_NAMES: Record<string, string> = { M365: "Microsoft 365", XBOX: "Xbox", DOTNET: ".NET" };

/** "EDGE_ON_CHROMIUM" → "Edge on Chromium", "M365" → "Microsoft 365", "ALL" → "All programs". */
export function programLabel(p: string): string {
  if (p === "ALL") return "All programs";
  const named = PROGRAM_NAMES[p];
  if (named) return named;
  return p
    .toLowerCase()
    .split("_")
    .map((w, i) => (i > 0 && ["on", "and", "of", "for"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace("Microsoft365", "Microsoft 365")
    .replace("Dynamics365", "Dynamics 365")
    .replace("Hyper V", "Hyper-V")
    .replace("Wip", "WIP")
    .replace("Dev Ops", "DevOps");
}
