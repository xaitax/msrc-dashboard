import { isReleaseTag, LATEST_RELEASE_API, type ReleaseCheck } from "../shared/release";

const CACHE_KEY = "dashboardReleaseCheck";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface CachedCheck {
  result: ReleaseCheck;
  attemptedAt: number;
  rateLimitedUntil: number;
}

const empty: ReleaseCheck = { latestTag: null, checkedAt: null, unavailable: true };
let pending: Promise<ReleaseCheck> | undefined;

/** GitHub supplies Retry-After in seconds and the primary limit reset as a Unix timestamp. */
function rateLimitDeadline(response: Response, now: number): number {
  if (response.status !== 403 && response.status !== 429) return 0;
  const after = Number(response.headers.get("retry-after"));
  const reset = response.headers.get("x-ratelimit-remaining") === "0" ? Number(response.headers.get("x-ratelimit-reset")) : 0;
  return Math.max(now + MINUTE, Number.isFinite(after) ? now + after * 1000 : 0, Number.isFinite(reset) ? reset * 1000 : 0);
}

async function readCache(): Promise<CachedCheck | undefined> {
  try {
    const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] as CachedCheck | undefined;
    const result = stored?.result;
    if (stored && result && (result.latestTag === null || isReleaseTag(result.latestTag))
      && (result.checkedAt === null || Number.isFinite(result.checkedAt)) && typeof result.unavailable === "boolean"
      && Number.isFinite(stored.attemptedAt) && Number.isFinite(stored.rateLimitedUntil)) return stored;
  } catch { /* A storage error should not prevent a live check. */ }
  return undefined;
}

async function refresh(cached: CachedCheck | undefined, now: number): Promise<ReleaseCheck> {
  let result: ReleaseCheck = { ...(cached?.result ?? empty), unavailable: true };
  let rateLimitedUntil = 0;
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    rateLimitedUntil = rateLimitDeadline(response, now);
    if (response.ok) {
      const release = await response.json();
      if (release?.draft === false && release.prerelease === false && isReleaseTag(release.tag_name)) {
        result = { latestTag: release.tag_name, checkedAt: now, unavailable: false };
      }
    }
  } catch { /* Offline, timeout or invalid JSON: keep the last verified release. */ }
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: { result, attemptedAt: now, rateLimitedUntil } satisfies CachedCheck });
  } catch { /* The result still reaches the requesting tab. */ }
  return result;
}

export async function checkRelease(force = false): Promise<ReleaseCheck> {
  if (pending) return pending;
  const cached = await readCache();
  // A second tab may already have started the network request during the storage read.
  if (pending) return pending;
  const now = Date.now();
  if (cached && now >= cached.attemptedAt) {
    const interval = force ? MINUTE : cached.result.unavailable ? 15 * MINUTE : DAY;
    if (now < Math.max(cached.attemptedAt + interval, cached.rateLimitedUntil)) return cached.result;
  }
  pending = refresh(cached, now).finally(() => { pending = undefined; });
  return pending;
}
