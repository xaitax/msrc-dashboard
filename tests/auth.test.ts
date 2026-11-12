import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptSnapshot, getAccessToken, getAuthState, getSessionExpiry, getSessionInfo, installOriginRules, markSessionEnded, onSnapshotAccepted, refreshTokenFrom, SignedOutError, snapshotForSeeding, _resetAuthForTests } from "../src/background/auth";
import { installChromeShim } from "./chromeShim";

const RT_KEY = "msal.2|uid.tid|msrcweb.b2clogin.com|refreshtoken|1d13e529-99b8-48fe-a77d-844853ae25bf||";
const AT_KEY = "msal.2|uid.tid|msrcweb.b2clogin.com|accesstoken|1d13e529-99b8-48fe-a77d-844853ae25bf|tid|scope";
const rtValue = (secret: string) => JSON.stringify({ credentialType: "RefreshToken", secret });
const good = (secret = "rt-original-0123456789abcdef") => ({ [RT_KEY]: rtValue(secret), [AT_KEY]: JSON.stringify({ secret: "at" }), "msal.account.keys": "[]" });
const PORTAL = "https://msrc.microsoft.com/report/vulnerability";

let chrome: ReturnType<typeof installChromeShim>;
beforeEach(() => {
  chrome = installChromeShim();
  _resetAuthForTests();
  vi.unstubAllGlobals();
});

function b2c(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("refreshTokenFrom", () => {
  it("finds the secret by key and skips non-JSON values", () => {
    expect(refreshTokenFrom({ "x|refreshtoken|y": "not json", ...good() })).toBe("rt-original-0123456789abcdef");
    expect(refreshTokenFrom(undefined)).toBeNull();
    expect(refreshTokenFrom({ [AT_KEY]: JSON.stringify({ secret: "at" }) })).toBeNull();
  });
});

describe("acceptSnapshot", () => {
  it("stores a usable snapshot, sets auth ok and notifies listeners", async () => {
    const cb = vi.fn();
    onSnapshotAccepted(cb);
    expect(await acceptSnapshot(good(), PORTAL)).toBe(true);
    expect(await getAuthState()).toBe("ok");
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it("never lets an empty or partial snapshot overwrite a good session", async () => {
    await acceptSnapshot(good(), PORTAL);
    expect(await acceptSnapshot({}, PORTAL)).toBe(false);
    expect(await acceptSnapshot({ [AT_KEY]: JSON.stringify({ secret: "at" }), "msal.interaction.status": "x" }, PORTAL)).toBe(false);
    const stored = (await chrome.storage.local.get("msalSnapshot")).msalSnapshot as Record<string, string>;
    expect(refreshTokenFrom(stored)).toBe("rt-original-0123456789abcdef");
  });
});

describe("getAccessToken", () => {
  it("mints from the refresh token, persists the rotated one, then serves from cache", async () => {
    await acceptSnapshot(good(), PORTAL);
    const fetchMock = b2c(200, { access_token: "AT-1", expires_in: 3600, refresh_token: "rt-rotated-0123456789abcdef" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAccessToken()).toBe("AT-1");
    expect(await getAccessToken()).toBe("AT-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=1d13e529-99b8-48fe-a77d-844853ae25bf");
    const stored = (await chrome.storage.local.get("msalSnapshot")).msalSnapshot as Record<string, string>;
    expect(refreshTokenFrom(stored)).toBe("rt-rotated-0123456789abcdef");
  });
  it("mints once for concurrent callers", async () => {
    await acceptSnapshot(good(), PORTAL);
    const fetchMock = b2c(200, { access_token: "AT-2", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await Promise.all([getAccessToken(), getAccessToken()])).toEqual(["AT-2", "AT-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("signals signed-out when B2C rejects the refresh token", async () => {
    await acceptSnapshot(good(), PORTAL);
    vi.stubGlobal("fetch", b2c(400, { error: "invalid_grant" }));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
    expect(await getAuthState()).toBe("signed_out");
  });
  it("treats server errors as transient, not as sign-out", async () => {
    await acceptSnapshot(good(), PORTAL);
    vi.stubGlobal("fetch", b2c(503, {}));
    await expect(getAccessToken()).rejects.not.toBeInstanceOf(SignedOutError);
    expect(await getAuthState()).toBe("ok");
  });
  it("is signed out without any stored snapshot", async () => {
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
  });
});

describe("installOriginRules", () => {
  it("rewrites Origin only for requests this extension initiates", async () => {
    await installOriginRules();
    const arg = (chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0] as unknown as [{ removeRuleIds: number[]; addRules: { id: number; condition: { initiatorDomains: string[] } }[] }])[0];
    expect(arg.removeRuleIds).toEqual([100, 101]);
    expect(arg.addRules.map((r) => r.id)).toEqual([100, 101]);
    expect(arg.addRules.every((r) => r.condition.initiatorDomains[0] === "testextensionid")).toBe(true);
  });
});

describe("re-login safety", () => {
  it("only announces a snapshot as a new session when the refresh token changed", async () => {
    const cb = vi.fn();
    onSnapshotAccepted(cb);
    await acceptSnapshot(good("rt-first-0123456789abcdef"), PORTAL);
    await acceptSnapshot(good("rt-first-0123456789abcdef"), PORTAL); // a tab echoing what we seeded
    expect(cb).toHaveBeenCalledTimes(1);
    await acceptSnapshot(good("rt-second-0123456789abcdef"), PORTAL);
    expect(cb).toHaveBeenCalledTimes(2);
  });
  it("does not seed portal tabs while the stored session is known to be dead", async () => {
    await acceptSnapshot(good(), PORTAL);
    expect(await snapshotForSeeding()).toBeDefined();
    vi.stubGlobal("fetch", b2c(400, { error: "invalid_grant" }));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
    expect(await snapshotForSeeding()).toBeUndefined();
  });
});

describe("session expiry", () => {
  it("records when the refresh token expires, from the token response", async () => {
    await acceptSnapshot(good(), PORTAL);
    vi.stubGlobal("fetch", b2c(200, { access_token: "AT-9", expires_in: 3600, refresh_token: "rt-rotated-9-0123456789abcdef", refresh_token_expires_in: 86400 }));
    const before = Date.now();
    await getAccessToken();
    const at = await getSessionExpiry();
    expect(at).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(at).toBeLessThan(before + 86_400_000 + 5_000);
  });
});

describe("session length tracking", () => {
  it("records when a login started and how long the previous one lasted", async () => {
    const t0 = Date.now();
    await acceptSnapshot(good("rt-a-0123456789abcdefghij"), PORTAL);
    const info = await getSessionInfo();
    expect(info.startedAt).toBeGreaterThanOrEqual(t0);
    expect(info.lastLengthMs).toBeNull();
    await markSessionEnded(t0 + 5 * 3_600_000);
    expect((await getSessionInfo()).lastLengthMs).toBe(t0 + 5 * 3_600_000 - info.startedAt!);
  });
});

describe("token rotation vs. stale tabs", () => {
  it("ignores a tab pushing the pre-rotation token: no new login, stored token kept", async () => {
    const cb = vi.fn();
    await acceptSnapshot(good("rt-original-0123456789abcdef"), PORTAL);
    onSnapshotAccepted(cb);
    vi.stubGlobal("fetch", b2c(200, { access_token: "AT", expires_in: 3600, refresh_token: "rt-rotated-0123456789abcdef" }));
    await getAccessToken();
    await acceptSnapshot(good("rt-original-0123456789abcdef"), PORTAL); // stale tab, routine push
    expect(cb).not.toHaveBeenCalled();
    const stored = (await chrome.storage.local.get("msalSnapshot")).msalSnapshot as Record<string, string>;
    expect(refreshTokenFrom(stored)).toBe("rt-rotated-0123456789abcdef");
  });
  it("does not flip a signed-out session back to ok for an already-seen dead token", async () => {
    await acceptSnapshot(good("rt-dead-0123456789abcdefgh"), PORTAL);
    vi.stubGlobal("fetch", b2c(400, { error: "invalid_grant" }));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
    await acceptSnapshot(good("rt-dead-0123456789abcdefgh"), PORTAL);
    expect(await getAuthState()).toBe("signed_out");
  });
  it("accepts a genuinely new login while signed out", async () => {
    const cb = vi.fn();
    onSnapshotAccepted(cb);
    await acceptSnapshot(good("rt-dead-0123456789abcdefgh"), PORTAL);
    vi.stubGlobal("fetch", b2c(400, { error: "invalid_grant" }));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
    await acceptSnapshot(good("rt-fresh-login-0123456789ab"), PORTAL);
    expect(await getAuthState()).toBe("ok");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
