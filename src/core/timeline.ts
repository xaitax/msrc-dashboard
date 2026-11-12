// One chronological stream per case: submission, files, messages, changes.
import { humanizeEnum, isAutomatic, isUnseen, MSRC_SENDER } from "./derive";
import type { StatusPoint } from "./history";
import { summarizeMsrcMessage } from "./msrcText";
import { htmlToText } from "./text";
import type { CaseRecord, ChangeEvent, ThreadMessage } from "../shared/types";

export interface TimelineItem {
  at: string;
  kind: "message" | "event" | "file";
  from?: "msrc" | "you";
  label?: string; // e.g. the MSRC template milestone
  text: string;
  isNew: boolean;
  automatic?: boolean;
  key: string;
}

const MESSAGE_EVENTS = new Set<ChangeEvent["type"]>(["msrc_message", "own_message", "file_added", "case_added"]);

export function buildTimeline(c: CaseRecord, msgs: ThreadMessage[], events: ChangeEvent[], history: StatusPoint[] = []): TimelineItem[] {
  const unseen = new Set(events.filter((e) => isUnseen(e) && e.sourceId).map((e) => e.sourceId!));
  const items: TimelineItem[] = [];

  if (c.list.createdOn) items.push({ at: c.list.createdOn, kind: "event", text: "Report submitted", isNew: false, key: "submitted" });

  for (const f of c.files) {
    // The API does not say who uploaded a file (createdBy is a service account).
    items.push({ at: f.createdOn ?? c.list.createdOn ?? "", kind: "file", text: f.name, isNew: unseen.has(f.id), key: `f:${f.id}` });
  }

  for (const m of msgs) {
    const fromMsrc = m.senderName === MSRC_SENDER;
    items.push({
      at: m.createdOn,
      kind: "message",
      from: fromMsrc ? "msrc" : "you",
      label: fromMsrc ? (summarizeMsrcMessage(m.body) ?? undefined) : undefined,
      automatic: isAutomatic(m),
      text: htmlToText(m.body),
      isNew: unseen.has(m.id),
      key: `m:${m.id}`,
    });
  }

  // Exact status history (notification feed) replaces detected status events
  // for the same status; an unseen detected change keeps the item marked new.
  const historyStatuses = new Set(history.map((h) => h.status));
  const unseenStatus = new Set(events.filter((e) => e.type === "status" && isUnseen(e)).map((e) => String(e.newValue)));
  history.forEach((h, i) => {
    const latestOfKind = history.findLastIndex((x) => x.status === h.status) === i;
    items.push({ at: h.at, kind: "event", text: `Status → ${humanizeEnum(h.status)}`, isNew: latestOfKind && unseenStatus.has(h.status), key: `h:${h.status}:${h.at}` });
  });

  for (const e of events) {
    if (MESSAGE_EVENTS.has(e.type)) continue; // represented by the message/file itself
    if (e.type === "status" && historyStatuses.has(String(e.newValue))) continue;
    items.push({ at: e.occurredAt, kind: "event", text: e.summary, isNew: isUnseen(e), key: `e:${e.key}` });
  }

  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
