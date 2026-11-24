import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { send } from "../shared/protocol";
import { isNewerRelease, type ReleaseCheck } from "../shared/release";

const DISMISSED = "msrc-dashboard:dismissed-release";

function readDismissed(): string | null {
  try { return localStorage.getItem(DISMISSED); }
  catch { return null; }
}

export function useReleaseUpdate() {
  const installed = chrome.runtime.getManifest().version;
  const [result, setResult] = useState<ReleaseCheck | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [checking, setChecking] = useState(false);
  const pending = useRef(false);

  const check = useCallback(async (force = false) => {
    if (pending.current) return;
    pending.current = true;
    setChecking(true);
    try {
      const response = await send<ReleaseCheck>({ type: "release:check", force });
      setResult(previous => response ?? {
        latestTag: previous?.latestTag ?? null, checkedAt: previous?.checkedAt ?? null, unavailable: true,
      });
    } finally {
      pending.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const checkVisible = () => { if (!document.hidden) void check(); };
    const syncDismissed = (event: StorageEvent) => {
      if (event.key === DISMISSED || event.key === null) setDismissed(readDismissed());
    };
    checkVisible();
    const timer = window.setInterval(checkVisible, 60 * 60_000);
    document.addEventListener("visibilitychange", checkVisible);
    window.addEventListener("storage", syncDismissed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkVisible);
      window.removeEventListener("storage", syncDismissed);
    };
  }, [check]);

  const available = result?.latestTag && isNewerRelease(result.latestTag, installed) ? result.latestTag : null;
  function dismiss() {
    if (!available) return;
    setDismissed(available);
    try { localStorage.setItem(DISMISSED, available); }
    catch { /* The notice stays dismissed in this tab when storage is blocked. */ }
  }

  return { installed, result, checking, check, available, showNotice: !!available && available !== dismissed, dismiss };
}

export type ReleaseUpdate = ReturnType<typeof useReleaseUpdate>;
