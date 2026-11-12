// Content script on https://msrc.microsoft.com/report/* (top frame, document_start).
// Two jobs only: publish this tab's MSAL snapshot to the service
// worker, and seed an empty tab from the stored snapshot so it boots logged in.
import { send, type Msg } from "../shared/protocol";
import { isMsalKey } from "../shared/msal";
import { MSRC_ORIGIN } from "../shared/urls";

function readMsal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (!k || !isMsalKey(k)) continue;
    const v = sessionStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

async function seed(): Promise<void> {
  if (Object.keys(readMsal()).some((k) => /refreshtoken/i.test(k))) return; // already logged in
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = (await send({ type: "snapshot:get" })) as Record<string, string> | undefined;
    if (snap && Object.keys(snap).length > 0) {
      for (const [k, v] of Object.entries(snap)) {
        try {
          if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v);
        } catch {
          // storage full/disabled — best effort
        }
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function push(): void {
  void send({ type: "snapshot:push", entries: readMsal() });
}

/** Background re-login: the signed-out portal only starts MSAL's login on a click. */
function pressSignIn(): boolean {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const target = buttons.find((b) => /sign in to report your vulnerability/i.test(b.textContent ?? "")) ?? buttons.find((b) => /^please sign in$/i.test((b.textContent ?? "").trim()));
  if (!target) return false;
  target.click();
  return true;
}

if (location.origin === MSRC_ORIGIN) {
  chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    if (msg?.type === "relogin:start") sendResponse(pressSignIn());
    return false;
  });
  void seed().finally(() => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", push, { once: true });
    else push();
    window.addEventListener("pagehide", push);
    setInterval(push, 5 * 60 * 1000);
    // MSAL finishes a redirect login shortly after load; catch that too.
    setTimeout(push, 5000);
  });
}
