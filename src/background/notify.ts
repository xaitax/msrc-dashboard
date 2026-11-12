// Desktop notifications, toolbar badge, and opening/focusing the dashboard.
import type { NotificationPlan } from "../core/notifyPlan";
import type { AuthState } from "../shared/protocol";
import { isVulnId } from "../shared/ids";
import type { VulnId } from "../shared/types";
import { getEvents } from "../store/db";
import { isUnseen } from "../core/derive";

const DASHBOARD = "dashboard.html";
const SIGNED_OUT_ID = "signed-out";

const notify = (id: string, title: string, message: string, priority: number) =>
  chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icon-128.png"), title, message, priority });

export async function showNotifications(plans: NotificationPlan[]): Promise<void> {
  for (const p of plans) await notify(p.id, p.title, p.message, 1);
}

export async function notifySignedOut(): Promise<void> {
  await notify(SIGNED_OUT_ID, "MSRC Dashboard · signed out", "Microsoft ended the session. Click to open the dashboard and sign in again.", 2);
}

export async function updateBadge(auth: AuthState): Promise<void> {
  const unseen = (await getEvents()).filter(isUnseen).length;
  const text = auth === "signed_out" ? "!" : unseen > 0 ? String(unseen) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#a4262c" });
  await chrome.action.setTitle({ title: auth === "signed_out" ? "MSRC Dashboard — signed out" : unseen ? `MSRC Dashboard — ${unseen} unseen change(s)` : "MSRC Dashboard" });
}

/** Focus the dashboard tab (opening one if needed), optionally on a case. */
export async function openDashboard(rn?: VulnId): Promise<void> {
  const base = chrome.runtime.getURL(DASHBOARD);
  const url = rn && isVulnId(rn) ? `${base}#case=${rn}` : base;
  const existing = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(base));
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, rn ? { active: true, url } : { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

/** Notification ids look like `case|VULN-123|…`; anything else opens the overview. */
export function caseFromNotificationId(id: string): VulnId | undefined {
  const rn = id.split("|")[1];
  return id.startsWith("case|") && isVulnId(rn) ? rn : undefined;
}
