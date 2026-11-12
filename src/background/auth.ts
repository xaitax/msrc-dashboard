// Session lifecycle: capture the portal's MSAL snapshot, mint
// access tokens from its refresh token, persist rotations, report sign-out.
// The snapshot — refresh token included — lives unencrypted in
// chrome.storage.local; the README's security section explains the trade-off.
import type { AuthState } from "../shared/protocol";
import { isMsalKey } from "../shared/msal";
import { MSRC_ORIGIN } from "../shared/urls";

export const B2C_TOKEN_ENDPOINT =
  "https://msrcweb.b2clogin.com/msrcweb.onmicrosoft.com/b2c_1a_multitenant_signupsignin/oauth2/v2.0/token";
export const B2C_CLIENT_ID = "1d13e529-99b8-48fe-a77d-844853ae25bf";
const B2C_SCOPE = "https://msrcweb.onmicrosoft.com/msrc-api/user_impersonation openid profile";

const SNAPSHOT_KEY = "msalSnapshot"; // storage.local
const AUTH_STATE_KEY = "authState"; // storage.local
const TOKEN_KEY = "accessToken"; // storage.session: { token, expiresAt }
const SESSION_EXPIRY_KEY = "sessionExpiresAt"; // storage.local: epoch ms the refresh token dies
const SESSION_STARTED_KEY = "sessionStartedAt"; // storage.local: epoch ms of the last fresh login
const SESSION_LAST_LENGTH_KEY = "sessionLastLengthMs"; // storage.local: how long the previous login lasted
const KNOWN_RT_KEY = "knownRefreshTokens"; // storage.local: SHA-256 of every refresh token seen
const KNOWN_RT_MAX = 64;

async function rtHash(rt: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rt));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function knownTokens(): Promise<string[]> {
  return ((await chrome.storage.local.get(KNOWN_RT_KEY))[KNOWN_RT_KEY] as string[] | undefined) ?? [];
}

async function rememberToken(rt: string): Promise<void> {
  const h = await rtHash(rt);
  const list = (await knownTokens()).filter((x) => x !== h);
  list.push(h);
  await chrome.storage.local.set({ [KNOWN_RT_KEY]: list.slice(-KNOWN_RT_MAX) });
}
const RT_KEY_RE = /refreshtoken/i;
const MIN_VALIDITY_MS = 60_000;

export type Snapshot = Record<string, string>;

export class SignedOutError extends Error {
  constructor(reason: string) {
    super(`signed out: ${reason}`);
    this.name = "SignedOutError";
  }
}


function secretOf(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "secret" in parsed) {
      const s = (parsed as { secret: unknown }).secret;
      if (typeof s === "string" && s.length > 20) return s;
    }
  } catch {
    // not JSON
  }
  return null;
}

export function refreshTokenFrom(snap: Snapshot | undefined | null): string | null {
  if (!snap) return null;
  for (const [k, v] of Object.entries(snap)) {
    if (!RT_KEY_RE.test(k)) continue;
    const s = secretOf(v);
    if (s) return s;
  }
  return null;
}

export function isUsableSnapshot(snap: Snapshot | undefined | null): boolean {
  return refreshTokenFrom(snap) !== null;
}

const listeners = new Set<() => void>();
export function onSnapshotAccepted(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function getStoredSnapshot(): Promise<Snapshot | undefined> {
  return (await chrome.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as Snapshot | undefined;
}

export async function setAuthState(s: AuthState): Promise<void> {
  await chrome.storage.local.set({ [AUTH_STATE_KEY]: s });
}

export async function getAuthState(): Promise<AuthState> {
  const s = (await chrome.storage.local.get(AUTH_STATE_KEY))[AUTH_STATE_KEY] as AuthState | undefined;
  if (s) return s;
  return isUsableSnapshot(await getStoredSnapshot()) ? "ok" : "signed_out";
}

/**
 * Store a snapshot pushed by a portal tab — but only one that carries a
 * refresh token. Empty or partial snapshots (tabs mid-login, failed seeds)
 * never replace a good session; only an explicit logout clears it.
 */
export async function acceptSnapshot(entries: Snapshot, senderUrl?: string): Promise<boolean> {
  if (isUsableSnapshot(entries)) {
    // Only a refresh token never seen before is a new login. A tab echoing what
    // we seeded, or still holding a token we have since rotated, is not — and
    // must never roll the stored token back.
    const rt = refreshTokenFrom(entries)!;
    const stored = refreshTokenFrom(await getStoredSnapshot());
    if (rt === stored || (await knownTokens()).includes(await rtHash(rt))) return true;
    await rememberToken(rt);
    const wasOut = (await getAuthState()) !== "ok";
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: entries, ...(wasOut || !(await getSessionInfo()).startedAt ? { [SESSION_STARTED_KEY]: Date.now() } : {}) });
    await chrome.storage.session.remove(TOKEN_KEY);
    await setAuthState("ok");
    for (const cb of listeners) cb();
    return true;
  }
  const explicitLogout = Object.keys(entries).filter(isMsalKey).length === 0 && /logout/i.test(senderUrl ?? "");
  if (explicitLogout) {
    await chrome.storage.local.remove(SNAPSHOT_KEY);
    await chrome.storage.session.remove(TOKEN_KEY);
    await setAuthState("signed_out");
  }
  return false;
}

/** What new portal tabs get seeded with: only a session not known to be dead,
 *  so a re-login tab boots clean and performs a real sign-in. */
export async function snapshotForSeeding(): Promise<Snapshot | undefined> {
  return (await getAuthState()) === "ok" ? getStoredSnapshot() : undefined;
}

async function persistRotated(rotated: string): Promise<void> {
  const snap = await getStoredSnapshot();
  if (!snap) return;
  const previous = refreshTokenFrom(snap);
  if (previous) await rememberToken(previous);
  await rememberToken(rotated);
  const next: Snapshot = { ...snap };
  for (const [k, v] of Object.entries(snap)) {
    if (!RT_KEY_RE.test(k) || !secretOf(v)) continue;
    next[k] = JSON.stringify({ ...(JSON.parse(v) as object), secret: rotated });
  }
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: next });
}

let minting: Promise<string> | null = null;

async function mint(): Promise<string> {
  const rt = refreshTokenFrom(await getStoredSnapshot());
  if (!rt) {
    await setAuthState("signed_out");
    throw new SignedOutError("no refresh token");
  }
  const body = new URLSearchParams({ client_id: B2C_CLIENT_ID, grant_type: "refresh_token", refresh_token: rt, scope: B2C_SCOPE });
  const resp = await fetch(B2C_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (resp.status === 400 || resp.status === 401) {
    await setAuthState("signed_out");
    throw new SignedOutError(`token endpoint ${resp.status}`);
  }
  if (!resp.ok) throw new Error(`token endpoint ${resp.status}`);
  const raw = (await resp.json()) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; refresh_token_expires_in?: unknown };
  if (typeof raw.access_token !== "string" || !raw.access_token) throw new Error("token endpoint: no access_token");
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : 3600;
  if (typeof raw.refresh_token === "string" && raw.refresh_token !== rt) await persistRotated(raw.refresh_token);
  if (typeof raw.refresh_token_expires_in === "number") {
    await chrome.storage.local.set({ [SESSION_EXPIRY_KEY]: Date.now() + raw.refresh_token_expires_in * 1000 });
  }
  await chrome.storage.session.set({ [TOKEN_KEY]: { token: raw.access_token, expiresAt: Date.now() + expiresIn * 1000 } });
  await setAuthState("ok");
  return raw.access_token;
}

export async function getAccessToken(): Promise<string> {
  const cached = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as { token: string; expiresAt: number } | undefined;
  if (cached && cached.expiresAt > Date.now() + MIN_VALIDITY_MS) return cached.token;
  if (!minting) minting = mint().finally(() => (minting = null));
  return minting;
}

/** When the current login stops working without a fresh sign-in (null = unknown). */
export async function getSessionExpiry(): Promise<number | null> {
  return ((await chrome.storage.local.get(SESSION_EXPIRY_KEY))[SESSION_EXPIRY_KEY] as number | undefined) ?? null;
}

/** Microsoft does not report the login lifetime, so measure it: when the
 *  current login began, and how long the previous one lasted. */
export async function getSessionInfo(): Promise<{ startedAt: number | null; lastLengthMs: number | null }> {
  const s = await chrome.storage.local.get([SESSION_STARTED_KEY, SESSION_LAST_LENGTH_KEY]);
  return { startedAt: (s[SESSION_STARTED_KEY] as number | undefined) ?? null, lastLengthMs: (s[SESSION_LAST_LENGTH_KEY] as number | undefined) ?? null };
}

export async function markSessionEnded(at = Date.now()): Promise<void> {
  const { startedAt } = await getSessionInfo();
  if (startedAt) await chrome.storage.local.set({ [SESSION_LAST_LENGTH_KEY]: at - startedAt });
}

/** Drop the cached access token (e.g. after the API answered 401). */
export async function invalidateAccessToken(): Promise<void> {
  await chrome.storage.session.remove(TOKEN_KEY);
}

const DNR_RULE_IDS = [100, 101];

/** The API rejects chrome-extension:// origins; present the portal's origin
 *  on requests this extension initiates (and only those). */
export async function installOriginRules(): Promise<void> {
  const rule = (id: number, host: string): chrome.declarativeNetRequest.Rule => ({
    id,
    priority: 1,
    action: {
      type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: "Origin", operation: "set" as chrome.declarativeNetRequest.HeaderOperation, value: MSRC_ORIGIN }],
    },
    condition: { urlFilter: `||${host}/`, initiatorDomains: [chrome.runtime.id] },
  });
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: DNR_RULE_IDS,
    addRules: [rule(DNR_RULE_IDS[0]!, "api.msrc.microsoft.com"), rule(DNR_RULE_IDS[1]!, "msrcweb.b2clogin.com")],
  });
}

export function _resetAuthForTests(): void {
  minting = null;
  listeners.clear();
}
