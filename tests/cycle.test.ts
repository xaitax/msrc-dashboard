import { describe, expect, it, vi } from "vitest";
import { SignedOutError } from "../src/background/auth";
import { createCycle, type CycleDeps } from "../src/background/cycle";
import type { AuthState } from "../src/shared/protocol";
import type { ChangeEvent } from "../src/shared/types";

function deps(over: Partial<CycleDeps> = {}) {
  let auth: AuthState = "ok";
  const d: CycleDeps = {
    getAuthState: vi.fn(async () => auth),
    setAuthState: vi.fn(async (s: AuthState) => {
      auth = s;
    }),
    run: vi.fn(async () => [] as ChangeEvent[]),
    relogin: vi.fn(async () => true),
    enterSignedOut: vi.fn(async () => {
      auth = "signed_out";
    }),
    notify: vi.fn(async () => {}),
    updateBadge: vi.fn(async () => {}),
    setSyncing: vi.fn(),
    broadcast: vi.fn(),
    log: vi.fn(),
    ...over,
  };
  return d;
}

describe("sync cycle", () => {
  it("treats a sign-out on the retry after a 'successful' re-login as a real sign-out", async () => {
    const run = vi.fn().mockRejectedValueOnce(new SignedOutError("x")).mockRejectedValueOnce(new SignedOutError("y"));
    const d = deps({ run });
    await createCycle(d)("poll");
    expect(d.enterSignedOut).toHaveBeenCalledTimes(1);
    expect(d.notify).not.toHaveBeenCalled();
  });
  it("still refreshes the badge when skipping because the session is signed out", async () => {
    const d = deps({ getAuthState: vi.fn(async () => "signed_out" as AuthState) });
    await createCycle(d)("poll");
    expect(d.run).not.toHaveBeenCalled();
    expect(d.updateBadge).toHaveBeenCalled();
  });
  it("enters the signed-out state when re-login fails", async () => {
    const d = deps({ run: vi.fn().mockRejectedValueOnce(new SignedOutError("x")), relogin: vi.fn(async () => false) });
    await createCycle(d)("poll");
    expect(d.enterSignedOut).toHaveBeenCalledTimes(1);
  });
  it("notifies about fresh events and updates the badge on a normal run", async () => {
    const ev = [{ key: "k" } as ChangeEvent];
    const d = deps({ run: vi.fn(async () => ev) });
    await createCycle(d)("poll");
    expect(d.notify).toHaveBeenCalledWith(ev);
    expect(d.updateBadge).toHaveBeenCalled();
    expect(d.setSyncing).toHaveBeenLastCalledWith(false);
  });
});
