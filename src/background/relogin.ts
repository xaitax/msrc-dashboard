// Silent background re-login: open an inactive
// portal tab, let the portal sign itself in with the B2C session cookie, wait
// for the content script's snapshot, close the tab. Never loops: one attempt
// at a time, 60 s cap, 15 s cap once parked on an interactive login page,
// then at most one attempt per hour.
import { PORTAL_REPORTS } from "../shared/urls";
export interface ReloginDeps {
  openTab(url: string): Promise<number>;
  closeTab(id: number): Promise<void>;
  tabUrl(id: number): Promise<string | undefined>;
  onAccepted(cb: () => void): () => void;
  /** The signed-out portal waits for a click; ask its content script to press "Sign in". */
  startSignIn(id: number): Promise<void>;
  getBackoff(): Promise<number>;
  setBackoff(until: number): Promise<void>;
  now(): number;
}

const TOTAL_MS = 60_000;
const LOGIN_PAGE_MS = 15_000;
const BACKOFF_MS = 3_600_000;
const CHECK_MS = 1_000;

export function createRelogin(deps: ReloginDeps) {
  let inflight: Promise<boolean> | null = null;

  async function run(): Promise<boolean> {
    if (deps.now() < (await deps.getBackoff())) return false;
    const started = deps.now();
    let tabId: number | null = null;
    let off: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tab = deps.openTab(PORTAL_REPORTS);
    try {
      const ok = await new Promise<boolean>((resolve) => {
        off = deps.onAccepted(() => resolve(true));
        void tab.then(
          (id) => {
            tabId = id;
            void deps.startSignIn(id).catch(() => undefined);
          },
          () => resolve(false),
        );
        timer = setInterval(() => {
          const elapsed = deps.now() - started;
          if (elapsed >= TOTAL_MS) return resolve(false);
          if (tabId === null || elapsed < LOGIN_PAGE_MS) return;
          void deps.tabUrl(tabId).then((url) => {
            if (url && new URL(url).hostname === "msrcweb.b2clogin.com") resolve(false);
          }, () => resolve(false));
        }, CHECK_MS);
      });
      await deps.setBackoff(ok ? 0 : deps.now() + BACKOFF_MS);
      return ok;
    } finally {
      clearInterval(timer);
      (off as (() => void) | null)?.();
      // The tab may only materialise after we are done — close it whenever it does.
      void tab.then((id) => deps.closeTab(id)).catch(() => undefined);
    }
  }

  return {
    attempt(): Promise<boolean> {
      if (!inflight) inflight = run().finally(() => (inflight = null));
      return inflight;
    },
  };
}
