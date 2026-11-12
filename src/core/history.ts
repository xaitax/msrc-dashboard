// Exact status history from the portal's notification feed. Researchers get no
// changeLog, but every status change produces a "ReportStatusChange"
// notification carrying the new status and its exact timestamp (live-verified).
import type { RawObject, VulnId } from "../shared/types";

export interface StatusPoint {
  status: string; // report status enum, e.g. "DEVELOP"
  at: string; // ISO timestamp of the change
}

export type StatusHistory = Record<VulnId, StatusPoint[]>;

/** "ReviewRepro" → "REVIEW_REPRO", "CompleteDuplicate" → "COMPLETE_DUPLICATE". */
export function notificationStatus(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function statusHistoryFrom(notifications: RawObject[]): StatusHistory {
  const out: StatusHistory = {};
  for (const n of notifications) {
    if (n["notificationType"] !== "ReportStatusChange") continue;
    const rn = n["reportNumber"];
    const status = n["reportStatus"];
    const at = n["createdOn"];
    if (typeof rn !== "string" || typeof status !== "string" || typeof at !== "string") continue;
    (out[rn] ??= []).push({ status: notificationStatus(status), at });
  }
  for (const list of Object.values(out)) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out;
}

/** When a case most recently moved into `status`, if the feed knows. */
export function statusTimeFrom(history: StatusHistory): (rn: VulnId, status: string) => string | null {
  return (rn, status) => {
    const points = history[rn] ?? [];
    for (let i = points.length - 1; i >= 0; i--) if (points[i]!.status === status) return points[i]!.at;
    return null;
  };
}
