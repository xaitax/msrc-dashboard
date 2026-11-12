// MSRC API client for the service worker. Requests carry a Bearer token
// minted by auth.ts; the DNR rule rewrites Origin so the API accepts them.
// The service worker only reads. Report writes (drafts, attachments, submit)
// run in the dashboard page via src/dashboard/reportApi.ts.
import { isCveId, isGuid, isVulnId } from "../shared/ids";
import type { FileRecord, RawObject, ReportDetail, ReportListItem, ThreadMessage, VulnId } from "../shared/types";
import { getAccessToken, invalidateAccessToken } from "./auth";
import { DETAIL_QUERY, LIST_QUERY } from "./queries";
import type { SyncApi } from "./sync";
import { API_ROOT, GRAPHQL_URL } from "../shared/urls";

export { API_ROOT };
const GRAPHQL = GRAPHQL_URL;
/** Microsoft's public Security Update Guide: same host, no login, no token sent. */
const SUG = `${API_ROOT}/sug/v2.0`;
const SUG_MAX_PAGES = 20;
/** Chrome stops a service worker whose fetch hangs ~30 s; give up before that. */
const SUG_TIMEOUT_MS = 20_000;

async function publicGet(url: string, what: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(SUG_TIMEOUT_MS) });
  if (!r.ok) throw new ApiError(r.status, what);
  return r.json();
}
const LIST_PAGE = 50;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`${what}: HTTP ${status}`);
    this.name = "ApiError";
  }
}

export async function apiFetch(url: string, init: RequestInit = {}, what = url): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();
    const resp = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (resp.status === 401 && attempt === 0) {
      await invalidateAccessToken(); // stale token — mint once more
      continue;
    }
    if (!resp.ok) throw new ApiError(resp.status, what);
    return resp.json();
  }
  throw new ApiError(401, what);
}

export async function gql<T>(query: string, variables: Record<string, unknown>, what: string): Promise<T> {
  const r = (await apiFetch(GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }, what)) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (r.errors?.length) throw new Error(`${what}: ${r.errors[0]!.message}`);
  if (!r.data) throw new Error(`${what}: empty response`);
  return r.data;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

export function normalizeListItem(raw: RawObject): ReportListItem | null {
  const reportNumber = raw["reportNumber"];
  if (!isVulnId(reportNumber)) return null;
  return {
    id: String(raw["id"] ?? ""),
    reportNumber,
    ticketNumber: str(raw["ticketNumber"]),
    externalId: str(raw["externalId"]),
    title: String(raw["title"] ?? ""),
    status: str(raw["status"]),
    statusReason: str(raw["statusReason"]),
    severity: str(raw["severity"]),
    securityImpact: str(raw["securityImpact"]),
    createdOn: str(raw["createdOn"]),
    lastActivityOn: str(raw["lastActivityOn"]),
    unreadMessageCount: typeof raw["unreadMessageCount"] === "number" ? (raw["unreadMessageCount"] as number) : null,
    bountyStatus: str((raw["bounty"] as RawObject | null | undefined)?.["status"]),
    raw,
  };
}

export function normalizeMessage(raw: RawObject): ThreadMessage | null {
  const reportNumber = raw["reportNumber"];
  const id = str(raw["id"]);
  if (!isVulnId(reportNumber) || !id) return null;
  return {
    id,
    reportNumber,
    senderName: String(raw["senderName"] ?? ""),
    createdOn: String(raw["createdOn"] ?? ""),
    body: String(raw["body"] ?? ""),
    raw,
  };
}

export function normalizeFile(raw: RawObject): FileRecord | null {
  const id = str(raw["id"]);
  if (!id) return null;
  return {
    id,
    name: String(raw["name"] ?? raw["fileName"] ?? raw["displayName"] ?? id),
    createdOn: str(raw["createdOn"]),
    raw,
  };
}

export const msrcApi: SyncApi = {
  async listReports() {
    const out: ReportListItem[] = [];
    for (let skip = 0; skip < 5000; skip += LIST_PAGE) {
      const d = await gql<{ vulnerabilityReports: { items: RawObject[]; pageInfo?: { hasNextPage?: boolean } } }>(LIST_QUERY, { skip, take: LIST_PAGE }, "list reports");
      for (const raw of d.vulnerabilityReports.items ?? []) {
        const item = normalizeListItem(raw);
        if (item) out.push(item);
      }
      if (!d.vulnerabilityReports.pageInfo?.hasNextPage) break;
    }
    return out;
  },

  async getReportDetail(rn: VulnId) {
    if (!isVulnId(rn)) return null;
    const d = await gql<{ vulnerabilityReports: { items: RawObject[] } }>(DETAIL_QUERY, { vulnNumber: rn }, `report ${rn}`);
    const item = d.vulnerabilityReports.items?.[0];
    return item && isVulnId(item["reportNumber"]) ? (item as ReportDetail) : null;
  },

  async messagesNewestFirst(skip: number) {
    const url = `${API_ROOT}/message?$orderBy=createdOn%20desc&$filter=${encodeURIComponent("conversationId eq null")}&$top=100&$skip=${Math.max(0, Math.floor(skip))}`;
    const d = (await apiFetch(url, {}, "messages")) as { value?: RawObject[] };
    return (d.value ?? []).map(normalizeMessage).filter((m): m is ThreadMessage => m !== null);
  },

  async listNotifications() {
    const out: RawObject[] = [];
    for (let skip = 0; skip < 2000; skip += 100) {
      const url = API_ROOT + "/portal/v2.0/notification?$orderBy=createdOn%20desc&$top=100&$skip=" + skip;
      const d = (await apiFetch(url, {}, "notifications")) as { value?: RawObject[] };
      out.push(...(d.value ?? []));
      if ((d.value ?? []).length < 100) break;
    }
    return out;
  },

  async listFiles(reportId: string) {
    if (!isGuid(reportId)) return [];
    // Live-verified: files are keyed by objectId (the report GUID), not reportId.
    const filter = encodeURIComponent(`objectId eq '${reportId}'`);
    const d = (await apiFetch(`${API_ROOT}/portal/v2.0/file?$filter=${filter}&$orderBy=createdOn%20desc`, {}, "files")) as { value?: RawObject[] };
    return (d.value ?? []).map(normalizeFile).filter((f): f is FileRecord => f !== null);
  },

  /** Every public CVE credit since `sinceIso` (all researchers; filtered locally). */
  async publicCredits(sinceIso: string) {
    const since = new Date(sinceIso).toISOString().replace(/\.\d{3}Z$/, "Z");
    let url: string | null = `${SUG}/en-US/acknowledgement?$filter=${encodeURIComponent(`releaseDate gt ${since}`)}`;
    const out: RawObject[] = [];
    for (let page = 0; url && page < SUG_MAX_PAGES; page++) {
      const d = (await publicGet(url, "public acknowledgements")) as { value?: RawObject[]; "@odata.nextLink"?: unknown };
      out.push(...(d.value ?? []));
      const next = d["@odata.nextLink"];
      url = typeof next === "string" && next.startsWith(`${SUG}/`) ? next : null;
    }
    return out;
  },

  async publicCve(cve: string) {
    if (!isCveId(cve)) return null;
    const d = (await publicGet(`${SUG}/en-US/vulnerability?$filter=${encodeURIComponent(`cveNumber eq '${cve}'`)}`, `public ${cve}`)) as { value?: RawObject[] };
    return d.value?.[0] ?? null;
  },
};
