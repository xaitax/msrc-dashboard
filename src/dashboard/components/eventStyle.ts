import type { ChangeEvent } from "../../shared/types";
import { caseLabel, humanizeEnum } from "../../core/derive";
import { bountyLabel, formatUsd } from "../../core/awards";
import { ACTION_REASON } from "../../core/statusGuide";

export function boardCaseLabel(row: Pick<ChangeEvent, "ticketNumber" | "reportNumber">): string {
  const label = caseLabel(row);
  return /^\d+$/.test(label) ? `#${label}` : label;
}

const activityIcons = {
  msrc_message: "message", own_message: "reply", file_added: "file", case_added: "report",
  status: "status", status_reason: "status", disclosure_event: "calendar",
  bounty: "award", cve: "code", field_changed: "info",
} as const;

export function activityIcon(event: ChangeEvent) {
  if (event.field === "casePoint") return "points";
  if (event.field === "isFlagged") return "flag";
  if (event.type === "msrc_message" && event.summary.startsWith("Bounty ")) return activityIcons.bounty;
  return activityIcons[event.type];
}

export function previewSummary(event: ChangeEvent): string {
  if (event.type === "case_added") return "Case added";
  if (event.type === "file_added") return "Attachment added";
  if (event.type === "status_reason" && event.newValue === ACTION_REASON) return "MSRC needs more information";
  if (event.field === "isFlagged") {
    if (event.newValue === true) return "Contains a flagged message";
    if (event.newValue === false) return "No flagged messages";
  }
  if (event.type === "status" && typeof event.newValue === "string") return `Moved to ${humanizeEnum(event.newValue)}`;
  if (event.type === "bounty") {
    const previous = event.oldValue as { status?: unknown } | null;
    const current = event.newValue as { status?: unknown; amount?: unknown } | null;
    const status = current?.status;
    if (typeof status === "string" && status && status !== previous?.status) {
      const amount = current?.amount;
      if (status.startsWith("AWARDED_") && typeof amount === "number" && amount > 0 && Number.isFinite(amount)) return `${formatUsd(amount)} bounty awarded`;
      return `Bounty ${bountyLabel(status).toLowerCase()}`;
    }
  }
  return event.summary;
}
