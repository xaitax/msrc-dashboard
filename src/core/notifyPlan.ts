// Turns freshly detected events into desktop notifications:
// one per case per poll; more than MAX_INDIVIDUAL cases → one summary.
import type { ChangeEvent, EventType, VulnId } from "../shared/types";
import { caseLabel, isUnseen } from "./derive";

export interface NotificationPlan {
  id: string;
  title: string;
  message: string;
  reportNumber?: VulnId;
}

const MAX_INDIVIDUAL = 3;
const PRIORITY: EventType[] = ["msrc_message", "status", "status_reason", "bounty", "cve", "disclosure_event", "file_added", "field_changed", "case_added", "own_message"];
const rank = (t: EventType) => PRIORITY.indexOf(t);

export { caseLabel };

function caseLines(events: ChangeEvent[]): string[] {
  const sorted = [...events].sort((a, b) => rank(a.type) - rank(b.type));
  const lines: string[] = [];
  const replies = sorted.filter((e) => e.type === "msrc_message");
  if (replies.length > 0) {
    const first = replies[0]!.summary;
    const allSame = replies.every((e) => e.summary === first);
    lines.push(replies.length === 1 ? first : allSame ? `${first} (${replies.length})` : `${first} (+${replies.length - 1} more)`);
  }
  for (const e of sorted) if (e.type !== "msrc_message") lines.push(e.summary);
  return lines;
}

export function planNotifications(newEvents: ChangeEvent[]): NotificationPlan[] {
  const byCase = new Map<VulnId, ChangeEvent[]>();
  for (const e of newEvents) {
    if (!isUnseen(e)) continue;
    byCase.set(e.reportNumber, [...(byCase.get(e.reportNumber) ?? []), e]);
  }
  if (byCase.size === 0) return [];

  if (byCase.size > MAX_INDIVIDUAL) {
    const keys = [...byCase.values()].flat().map((e) => e.key).sort();
    const labels = [...byCase.values()].map((evs) => caseLabel(evs[0]!));
    return [{ id: `summary|${keys[0]}|${keys.length}`, title: `${byCase.size} cases changed`, message: labels.join(", ") }];
  }

  return [...byCase.entries()].map(([rn, evs]) => {
    const lines = caseLines(evs);
    const firstKey = evs.map((e) => e.key).sort()[0];
    return { id: `case|${rn}|${firstKey}`, title: `${caseLabel(evs[0]!)} · ${lines[0]}`, message: lines.join(" · "), reportNumber: rn };
  });
}
