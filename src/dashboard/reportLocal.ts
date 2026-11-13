// Local autosave for the report editor: every keystroke lands in localStorage
// (per draft, plus one slot for a report never saved to MSRC), so a closed tab
// or a failed save never loses text. Cleared after a successful save.
import { emptyForm, type ReportForm } from "../core/reportForm";

const PREFIX = "msrc-dashboard:report:";

export const localKey = (id: string | null) => PREFIX + (id ?? "new");

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveLocal(id: string | null, form: ReportForm, at = Date.now()): void {
  try {
    store()?.setItem(localKey(id), JSON.stringify({ form, at }));
  } catch {
    // quota or privacy mode: the MSRC draft is still the source of truth
  }
}

export function loadLocal(id: string | null): { form: ReportForm; at: number } | null {
  try {
    const raw = store()?.getItem(localKey(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as { form?: Partial<ReportForm>; at?: unknown };
    if (!v?.form || typeof v.form.title !== "string" || typeof v.at !== "number") return null;
    // Older local drafts kept these now-editable portal fields in `keep`.
    const keep = { ...(v.form.keep ?? {}) };
    const isExploitedDiscovery = v.form.isExploitedDiscovery ?? (typeof keep["isExploitedDiscovery"] === "string" ? keep["isExploitedDiscovery"] : "");
    const isExploitedScale = v.form.isExploitedScale ?? (typeof keep["isExploitedScale"] === "string" ? keep["isExploitedScale"] : "");
    const aiConversationId = v.form.aiConversationId ?? (typeof keep["aiConversationId"] === "string" ? keep["aiConversationId"] : "");
    delete keep["isExploitedDiscovery"];
    delete keep["isExploitedScale"];
    return { form: { ...emptyForm(), ...v.form, keep, isExploitedDiscovery, isExploitedScale, aiConversationId }, at: v.at };
  } catch {
    return null;
  }
}

export function clearLocal(id: string | null): void {
  try {
    store()?.removeItem(localKey(id));
  } catch {
    // nothing to clear
  }
}

/** Title of a report that was started but never saved to MSRC, if any. */
export function unsavedNewTitle(): string | null {
  const l = loadLocal(null);
  return l ? l.form.title : null;
}

// ---- unsent messages, one per case ----

const MSG_PREFIX = "msrc-dashboard:msg:";

export const messageDraftKey = (reportNumber: string) => MSG_PREFIX + reportNumber;

export interface MessageDraft {
  text: string;
  topic: string;
  /** A send of this text that may have reached MSRC (time of the attempt). */
  maybeSentAt?: number;
}

export function saveMessageDraft(reportNumber: string, d: MessageDraft, at = Date.now()): void {
  try {
    if (!d.text.trim() && !d.topic) store()?.removeItem(messageDraftKey(reportNumber));
    else store()?.setItem(messageDraftKey(reportNumber), JSON.stringify({ ...d, at }));
  } catch {
    // quota or privacy mode: the text stays on screen
  }
}

export function loadMessageDraft(reportNumber: string): MessageDraft | null {
  try {
    const raw = store()?.getItem(messageDraftKey(reportNumber));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MessageDraft>;
    if (typeof v.text !== "string") return null;
    return { text: v.text, topic: typeof v.topic === "string" ? v.topic : "", ...(typeof v.maybeSentAt === "number" ? { maybeSentAt: v.maybeSentAt } : {}) };
  } catch {
    return null;
  }
}

export function clearMessageDraft(reportNumber: string): void {
  try {
    store()?.removeItem(messageDraftKey(reportNumber));
  } catch {
    // nothing to clear
  }
}
