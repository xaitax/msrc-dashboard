// Recognition lists and the researcher's profile: fetched rarely (twice a day
// or on demand), cached in IndexedDB meta, shown on their own pages.
import type { RecognitionData, RankRow } from "../core/recognition";
import { payoutProvider } from "../core/awards";
import { ackFromProfile, type Ack } from "../core/reportForm";
import type { RawObject } from "../shared/types";
import { getMeta, META, setMeta } from "../store/db";
import { apiFetch, gql } from "./api";
import { ALL_TIME_RANKS_QUERY, HONORABLE_MENTIONS_QUERY, LEADERBOARD_QUERY, LEADERBOARD_RANKS_BY_EVENT_QUERY } from "./queries";
import { API_ROOT } from "../shared/urls";
import { errorText } from "../shared/protocol";

export interface ProfileSummary {
  name: string;
  publicName: string;
  socialUrl: string | null;
  websites: string[];
  recognitionPreference: string | null;
  subscriptions: { type: string; delivery: string; digest: string }[];
  private: { email: string | null; location: string | null };
  /** Prefill for new reports: the portal's "Add my default acknowledgement" and anonymity preference. */
  reportDefaults: { ack: Ack | null; anonymous: boolean };
  /** Bounty payout provider by name (e.g. "Intigriti"); the payout e-mail is never kept. */
  payout: string | null;
}

export interface Extras {
  recognition: RecognitionData | null;
  profile: ProfileSummary | null;
  fetchedAt: number;
  error: string | null;
}

const MAX_AGE_MS = 12 * 3_600_000;

type AllTimeRow = { rank: number; name?: string; displayName?: string; points?: number; accuracy?: number; impact?: number; volume?: number };

/** The all-time query aliases displayName as `name`; normalise it. */
export function normalizeAllTime(items: { year: number; quarter: number | null; product: string | null; leaderboardRanks: AllTimeRow[] }[]): RecognitionData["allTime"] {
  return items.map((t) => ({
    year: t.year,
    quarter: t.quarter,
    product: t.product,
    leaderboardRanks: t.leaderboardRanks.map(({ name, displayName, ...rest }) => ({ ...rest, displayName: String(displayName ?? name ?? "") }) as RankRow),
  }));
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What the Profile page shows. Payment/identity ids and the payout e-mail are
 *  deliberately dropped; email and location are kept apart so the page can
 *  hide them by default. */
export function profileSummary(me: RawObject, subs: RawObject[], providers: RawObject[] = []): ProfileSummary {
  const ack = (me["acknowledgement"] ?? {}) as RawObject;
  const name = [str(me["givenName"]), str(me["surname"])].filter(Boolean).join(" ") || String(me["displayName"] ?? "");
  const location = [str(me["addressCity"]), str(me["addressCountry"])].filter(Boolean).join(", ") || null;
  return {
    name,
    publicName: str(ack["name"]) ?? name,
    socialUrl: str(ack["socialMediaUrl"]),
    websites: Array.isArray(me["websiteList"]) ? (me["websiteList"] as unknown[]).map(String).filter((u) => /^https:\/\//i.test(u)) : [],
    recognitionPreference: str(me["recognitionPreference"]),
    subscriptions: subs.map((s) => ({ type: String(s["subscriptionTypeId"] ?? ""), delivery: String(s["deliveryMethod"] ?? ""), digest: String(s["digestType"] ?? "") })),
    private: { email: str(me["primaryEmail"]), location },
    reportDefaults: { ack: ackFromProfile(me), anonymous: me["anonymousSubmission"] === true },
    payout: payoutProvider(me, providers),
  };
}

const getJson = (path: string): Promise<unknown> => apiFetch(API_ROOT + path, {}, path);

async function fetchRecognition(year: number): Promise<RecognitionData> {
  const lb = await gql<{ leaderboard: { items: RecognitionData["leaderboards"] } }>(LEADERBOARD_QUERY, { year, skip: 0, take: 50 }, "leaderboard");
  const hm = await gql<{ honorableMentions: RecognitionData["honorableMentions"] | RecognitionData["honorableMentions"][number] }>(HONORABLE_MENTIONS_QUERY, { year }, "honorable mentions");
  const allTime: Parameters<typeof normalizeAllTime>[0] = [];
  for (let skip = 0; skip < 1000; skip += 50) {
    const page = await gql<{ leaderboardAllTimeRanks: { items: Parameters<typeof normalizeAllTime>[0] } }>(ALL_TIME_RANKS_QUERY, { skip, take: 50 }, "all-time ranks");
    allTime.push(...page.leaderboardAllTimeRanks.items);
    if (page.leaderboardAllTimeRanks.items.length < 50) break;
  }
  // Event leaderboards (Zero Day Quest). The API caps pages at 50 rows.
  const events: NonNullable<RecognitionData["events"]> = [];
  for (const event of ["ZDQ_LEADERBOARD" + year]) {
    const ranks: RankRow[] = [];
    try {
      for (let skip = 0; skip < 1000; skip += 50) {
        const page = await gql<{ leaderboardRanksByEvent: { items: { leaderboardRanks: RankRow[] }[] } }>(LEADERBOARD_RANKS_BY_EVENT_QUERY, { leaderboardEvent: event, skip, take: 50 }, "event leaderboard");
        const rows = page.leaderboardRanksByEvent.items.flatMap((t) => t.leaderboardRanks);
        ranks.push(...rows);
        if (rows.length < 50) break;
      }
      if (ranks.length) events.push({ event, leaderboardRanks: ranks });
    } catch {
      // event not running this year — skip
    }
  }
  return {
    year,
    events,
    leaderboards: lb.leaderboard.items ?? [],
    honorableMentions: Array.isArray(hm.honorableMentions) ? hm.honorableMentions : [hm.honorableMentions],
    allTime: normalizeAllTime(allTime),
  };
}

export async function getExtras(force = false, now = Date.now()): Promise<Extras> {
  const cached = await getMeta<Extras>(META.extras);
  if (cached && !force && now - cached.fetchedAt < MAX_AGE_MS) return cached;
  try {
    const [recognition, me, subs, providers] = await Promise.all([
      fetchRecognition(new Date(now).getFullYear()),
      getJson("/me") as Promise<RawObject>,
      getJson("/me/subscriptions").then((d) => ((d as { value?: RawObject[] }).value ?? []) as RawObject[]),
      // Only for the provider's name; never required.
      getJson("/portal/v2.0/paymentProvider/")
        .then((d) => ((d as { value?: RawObject[] }).value ?? (Array.isArray(d) ? d : [])) as RawObject[])
        .catch(() => [] as RawObject[]),
    ]);
    const fresh: Extras = { recognition, profile: profileSummary(me, subs, providers), fetchedAt: now, error: null };
    await setMeta(META.extras, fresh);
    return fresh;
  } catch (e) {
    const msg = errorText(e);
    return cached ? { ...cached, error: msg } : { recognition: null, profile: null, fetchedAt: 0, error: msg };
  }
}
