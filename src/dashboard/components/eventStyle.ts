import type { ChangeEvent } from "../../shared/types";

/** Dot colour class per event type (see .dot--* in dashboard.css). */
export const TYPE_CLASS: Record<ChangeEvent["type"], string> = {
  msrc_message: "new",
  own_message: "own",
  status: "st",
  status_reason: "st",
  bounty: "bty",
  cve: "cve",
  file_added: "file",
  disclosure_event: "st",
  field_changed: "field",
  case_added: "own",
};
