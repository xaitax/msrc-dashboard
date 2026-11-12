// One sync run with auth recovery, separated from the service-worker wiring so
// it can be tested. On sign-out: try the silent re-login once, retry, and if
// anything still says "signed out", surface it (never swallow it).
import type { AuthState } from "../shared/protocol";
import type { ChangeEvent } from "../shared/types";
import { SignedOutError } from "./auth";

export type CycleKind = "poll" | "sweep";

export interface CycleDeps {
  getAuthState(): Promise<AuthState>;
  setAuthState(s: AuthState): Promise<void>;
  run(kind: CycleKind): Promise<ChangeEvent[]>;
  relogin(): Promise<boolean>;
  enterSignedOut(): Promise<void>;
  notify(fresh: ChangeEvent[]): Promise<void>;
  updateBadge(): Promise<void>;
  setSyncing(on: boolean): void;
  broadcast(): void;
  log(e: unknown): void;
}

export function createCycle(d: CycleDeps) {
  return async function cycle(kind: CycleKind): Promise<void> {
    if ((await d.getAuthState()) === "signed_out") {
      await d.updateBadge(); // paused until a new login arrives — but keep the "!" visible
      return;
    }
    d.setSyncing(true);
    d.broadcast();
    try {
      let fresh: ChangeEvent[];
      try {
        fresh = await d.run(kind);
      } catch (e) {
        if (!(e instanceof SignedOutError)) throw e;
        await d.setAuthState("relogin");
        d.broadcast();
        if (!(await d.relogin())) {
          await d.enterSignedOut();
          return;
        }
        try {
          fresh = await d.run(kind);
        } catch (e2) {
          if (!(e2 instanceof SignedOutError)) throw e2;
          await d.enterSignedOut();
          return;
        }
      }
      await d.notify(fresh);
    } catch (e) {
      d.log(e);
    } finally {
      d.setSyncing(false);
      await d.updateBadge();
      d.broadcast();
    }
  };
}
