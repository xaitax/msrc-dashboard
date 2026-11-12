import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRelogin, type ReloginDeps } from "../src/background/relogin";

const HOUR = 3_600_000;

function deps(over: Partial<ReloginDeps> = {}) {
  let backoff = 0;
  let accepted: (() => void) | null = null;
  const d = {
    openTab: vi.fn(async () => 7),
    closeTab: vi.fn(async () => {}),
    tabUrl: vi.fn(async () => "https://msrcweb.b2clogin.com/msrcweb.onmicrosoft.com/oauth2/v2.0/authorize?x"),
    onAccepted: vi.fn((cb: () => void) => {
      accepted = cb;
      return () => (accepted = null);
    }),
    startSignIn: vi.fn(async (_id: number) => {}),
    getBackoff: vi.fn(async () => backoff),
    setBackoff: vi.fn(async (t: number) => {
      backoff = t;
    }),
    now: () => Date.now(),
    ...over,
  };
  return { d, fire: () => accepted?.() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("background re-login", () => {
  it("gives up when the tab waits on an interactive login page, closes it and backs off", async () => {
    const { d } = deps();
    const t0 = Date.now();
    const p = createRelogin(d).attempt();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await p).toBe(false);
    expect(d.openTab).toHaveBeenCalledWith("https://msrc.microsoft.com/report/vulnerability");
    expect(d.closeTab).toHaveBeenCalledWith(7);
    const until = vi.mocked(d.setBackoff).mock.calls[0]![0];
    expect(until).toBeGreaterThanOrEqual(t0 + HOUR);
    expect(until).toBeLessThanOrEqual(t0 + HOUR + 16_000);
  });

  it("does not open another tab during the backoff hour", async () => {
    const { d } = deps();
    const r = createRelogin(d);
    const p = r.attempt();
    await vi.advanceTimersByTimeAsync(16_000);
    await p;
    vi.mocked(d.openTab).mockClear();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(await r.attempt()).toBe(false);
    expect(d.openTab).not.toHaveBeenCalled();
  });

  it("succeeds when the portal tab publishes a usable snapshot, and closes the tab", async () => {
    const { d, fire } = deps({ tabUrl: vi.fn(async () => "https://msrc.microsoft.com/report/vulnerability") });
    const p = createRelogin(d).attempt();
    await vi.advanceTimersByTimeAsync(3_000);
    fire();
    expect(await p).toBe(true);
    expect(d.closeTab).toHaveBeenCalledWith(7);
    expect(d.setBackoff).toHaveBeenCalledWith(0);
    expect(d.startSignIn).toHaveBeenCalledWith(7); // the portal waits for a click to start sign-in
  });

  it("times out after 60 s on the portal without a snapshot", async () => {
    const { d } = deps({ tabUrl: vi.fn(async () => "https://msrc.microsoft.com/report/vulnerability") });
    const p = createRelogin(d).attempt();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await p).toBe(false);
    expect(d.closeTab).toHaveBeenCalledTimes(1);
  });

  it("shares one attempt between concurrent callers", async () => {
    const { d, fire } = deps({ tabUrl: vi.fn(async () => "https://msrc.microsoft.com/report/vulnerability") });
    const r = createRelogin(d);
    const a = r.attempt();
    const b = r.attempt();
    await vi.advanceTimersByTimeAsync(1_000);
    fire();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(d.openTab).toHaveBeenCalledTimes(1);
  });
});

describe("background re-login, races", () => {
  it("still closes the tab when the snapshot lands before the tab id is known", async () => {
    let release: (id: number) => void = () => {};
    const slowOpen = vi.fn(() => new Promise<number>((r) => (release = r)));
    const { d, fire } = deps({ openTab: slowOpen });
    const p = createRelogin(d).attempt();
    await vi.advanceTimersByTimeAsync(0);
    fire();
    expect(await p).toBe(true);
    release(9); // the tab only materialises after the attempt finished
    await vi.advanceTimersByTimeAsync(0);
    expect(d.closeTab).toHaveBeenCalledWith(9);
  });
});
