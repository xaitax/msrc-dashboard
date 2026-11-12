// MSRC Dashboard service worker: wiring only. Logic lives in auth/sync/notify/relogin.
import { planNotifications } from "../core/notifyPlan";
import { errorText, send, type AppState, type Msg, type SyncProgress, type TokenReply } from "../shared/protocol";
import { isVulnId } from "../shared/ids";
import { cveLinkUpdate, type CveLinks } from "../core/publicCves";
import { dropPublicCveEvent, getMeta, markSeen, META, setMeta } from "../store/db";
import { msrcApi } from "./api";
import {
  acceptSnapshot,
  getAccessToken,
  getAuthState,
  getSessionExpiry,
  getSessionInfo,
  installOriginRules,
  invalidateAccessToken,
  markSessionEnded,
  onSnapshotAccepted,
  setAuthState,
  SignedOutError,
  snapshotForSeeding,
} from "./auth";
import { caseFromNotificationId, notifySignedOut, openDashboard, showNotifications, updateBadge } from "./notify";
import { createCycle } from "./cycle";
import { getExtras } from "./extras";
import { createRelogin } from "./relogin";
import { createSync } from "./sync";
import { MSRC_ORIGIN } from "../shared/urls";

const POLL = "poll";
const SWEEP = "sweep";
const SIGNED_OUT_NOTIFIED = "signedOutNotified";

function broadcast(): void {
  void send({ type: "db:changed" });
}

let syncing = false;
/** The researcher's CVE-link decisions are read-modify-write on one meta key: one at a time. */
let linkQueue: Promise<unknown> = Promise.resolve();
let progress: SyncProgress | null = null;
const sync = createSync(msrcApi, () => new Date(), broadcast, undefined, (p) => {
  progress = p;
  broadcast();
});

const relogin = createRelogin({
  openTab: async (url) => (await chrome.tabs.create({ url, active: false })).id ?? -1,
  closeTab: async (id) => {
    if (id >= 0) await chrome.tabs.remove(id);
  },
  tabUrl: async (id) => (await chrome.tabs.get(id)).url,
  onAccepted: onSnapshotAccepted,
  startSignIn: async (id) => {
    // Retry until the content script is up and has pressed the portal's sign-in button.
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const done = await chrome.tabs.sendMessage(id, { type: "relogin:start" } satisfies Msg).catch(() => false);
      if (done === true) return;
    }
  },
  getBackoff: async () => ((await chrome.storage.local.get("reloginBackoffUntil"))["reloginBackoffUntil"] as number | undefined) ?? 0,
  setBackoff: (until) => chrome.storage.local.set({ reloginBackoffUntil: until }),
  now: () => Date.now(),
});

async function ensureAlarms(): Promise<void> {
  if (!(await chrome.alarms.get(POLL))) await chrome.alarms.create(POLL, { periodInMinutes: 2, delayInMinutes: 0.1 });
  if (!(await chrome.alarms.get(SWEEP))) await chrome.alarms.create(SWEEP, { periodInMinutes: 360, delayInMinutes: 30 });
}

async function enterSignedOut(): Promise<void> {
  await markSessionEnded();
  await setAuthState("signed_out");
  const notified = (await chrome.storage.local.get(SIGNED_OUT_NOTIFIED))[SIGNED_OUT_NOTIFIED];
  if (!notified) {
    await chrome.storage.local.set({ [SIGNED_OUT_NOTIFIED]: true });
    await notifySignedOut();
  }
}

const cycle = createCycle({
  getAuthState,
  setAuthState,
  run: (kind) => sync.runAuto(kind),
  relogin: () => relogin.attempt(),
  enterSignedOut,
  notify: (fresh) => showNotifications(planNotifications(fresh)),
  updateBadge: async () => updateBadge(await getAuthState()),
  setSyncing: (on) => {
    syncing = on;
  },
  broadcast,
  log: (e) => console.warn("MSRC Dashboard: sync failed", e),
});

async function appState(): Promise<AppState> {
  return {
    auth: await getAuthState(),
    lastSyncAt: (await getMeta<number>(META.lastSyncAt)) ?? null,
    lastError: (await getMeta<string | null>(META.lastError)) ?? null,
    syncing,
    baselineDone: (await getMeta<boolean>(META.baselineDone)) === true,
    progress,
    sessionExpiresAt: await getSessionExpiry(),
    ...(await getSessionInfo().then((i) => ({ sessionStartedAt: i.startedAt, lastSessionLengthMs: i.lastLengthMs }))),
  };
}

// ---- top level: runs on every service-worker start ----
void installOriginRules().catch((e) => console.warn("MSRC Dashboard: DNR rules unavailable", e));
void ensureAlarms();
// The action badge does not survive a browser restart: restore "!" / count now.
void getAuthState().then(updateBadge).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => void ensureAlarms().then(() => cycle("poll")));
chrome.runtime.onStartup.addListener(() => void ensureAlarms());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL) void cycle("poll");
  if (a.name === SWEEP) void cycle("sweep");
});
chrome.action.onClicked.addListener(() => void openDashboard());
chrome.notifications.onClicked.addListener((id) => {
  void openDashboard(caseFromNotificationId(id));
  void chrome.notifications.clear(id);
});

onSnapshotAccepted(() => {
  void chrome.storage.local.remove(SIGNED_OUT_NOTIFIED);
});

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  const fromPortal = !!sender.url && new URL(sender.url).origin === MSRC_ORIGIN;
  const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
  void (async () => {
    switch (msg?.type) {
      case "snapshot:push": {
        if (!fromPortal) return sendResponse(false);
        const wasSignedOut = (await getAuthState()) === "signed_out";
        const ok = await acceptSnapshot(msg.entries, sender.url);
        sendResponse(ok);
        if (ok && wasSignedOut) void cycle("poll"); // resume right away after a fresh login
        return;
      }
      case "snapshot:get":
        return sendResponse(fromPortal ? await snapshotForSeeding() : undefined);
      case "sync:now":
        if (!fromExtensionPage) return sendResponse(false);
        sendResponse(true);
        return void cycle(msg.full ? "sweep" : "poll");
      case "seen:mark":
        if (!fromExtensionPage) return sendResponse(0);
        if (msg.reportNumber !== undefined && !isVulnId(msg.reportNumber)) return sendResponse(0);
        sendResponse(await markSeen(msg.reportNumber));
        await updateBadge(await getAuthState());
        return broadcast();
      case "extras:get":
        if (!fromExtensionPage) return sendResponse(undefined);
        return sendResponse(await getExtras(msg.force === true));
      case "auth:token": {
        // Only the dashboard page (an extension page) gets a token, for report writes.
        if (!fromExtensionPage) return sendResponse(undefined);
        try {
          if (msg.fresh) await invalidateAccessToken();
          return sendResponse({ token: await getAccessToken() } satisfies TokenReply);
        } catch (e) {
          return sendResponse({ error: e instanceof SignedOutError ? "signed_out" : errorText(e) } satisfies TokenReply);
        }
      }
      case "cve:link": {
        if (!fromExtensionPage) return sendResponse(false);
        const run = linkQueue.then(async () => {
          const next = cveLinkUpdate((await getMeta<CveLinks>(META.cveLinks)) ?? {}, msg.cve, msg.reportNumber);
          if (!next) return false;
          await setMeta(META.cveLinks, next);
          await dropPublicCveEvent(msg.cve, msg.reportNumber);
          return true;
        });
        linkQueue = run.catch(() => false);
        const ok = await run.catch(() => false);
        sendResponse(ok);
        return ok ? broadcast() : undefined;
      }
      case "state:get":
        return sendResponse(fromExtensionPage ? await appState() : undefined);
      default:
        return sendResponse(undefined);
    }
  })();
  return true;
});
