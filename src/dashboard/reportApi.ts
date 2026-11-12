// Writes from the dashboard page: report drafts, attachments, submit, messages.
// The page calls the API itself (attachments can be far larger than runtime
// messages allow); the service worker only hands out the access token
// (`auth:token`). Every call here is triggered by an explicit click.
import { CREATE_REPORT_MUTATION, DELETE_REPORT_DRAFT_MUTATION, REPORT_BY_ID_QUERY, SUBMIT_REPORT_MUTATION, UPDATE_REPORT_DRAFT_MUTATION } from "../background/queries";
import { attachFieldName, encryptForMsrc, type MsrcJwk } from "../core/attachCrypto";
import type { ReportInput } from "../core/reportForm";
import { isGuid, isVulnId } from "../shared/ids";
import { API_ROOT, GRAPHQL_URL } from "../shared/urls";
import { errorText } from "../shared/protocol";

const API = API_ROOT;
const GRAPHQL = GRAPHQL_URL;

/** The portal's optional message topics ("helps MSRC get back to you faster"). */
export const MESSAGE_TOPICS = [
  { value: "Assessment", label: "Assessment" },
  { value: "CaseStatus", label: "Case status" },
  { value: "Release", label: "Release" },
  { value: "Bounty", label: "Bounty" },
  { value: "Other", label: "Other" },
] as const;
export type MessageTopic = (typeof MESSAGE_TOPICS)[number]["value"];

export interface ReportApiDeps {
  fetch: typeof fetch;
  /** Access token; `fresh` asks the service worker to mint a new one. */
  token: (fresh?: boolean) => Promise<string>;
}

export interface DraftFile {
  id: string;
  name: string;
  createdOn: string | null;
}

export class WriteError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WriteError";
  }
}

/** The request may have reached MSRC (server error, dropped connection,
 *  timeout): never present it as "not sent", or a retry sends it twice. */
export class MaybeSentError extends WriteError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "MaybeSentError";
  }
}

const SEND_TIMEOUT_MS = 30_000;

const guid = (id: string) => {
  if (!isGuid(id)) throw new WriteError(`Invalid report id: ${JSON.stringify(id)}`);
  return id;
};
const vuln = (rn: string) => {
  if (!isVulnId(rn)) throw new WriteError(`Invalid report number: ${JSON.stringify(rn)}`);
  return rn;
};

const fileOf = (f: Record<string, unknown>): DraftFile => ({
  id: String(f["id"] ?? ""),
  name: String(f["name"] ?? f["fileName"] ?? "attachment"),
  createdOn: typeof f["createdOn"] === "string" ? f["createdOn"] : null,
});

export function createReportApi(d: ReportApiDeps) {
  async function call(url: string, init: RequestInit, what: string): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await d.token(attempt > 0);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Accept", "application/json");
      const resp = await d.fetch(url, { ...init, headers });
      if (resp.status === 401 && attempt === 0) continue;
      if (!resp.ok) throw new WriteError(`${what}: HTTP ${resp.status}`, resp.status);
      return resp;
    }
    throw new WriteError(`${what}: HTTP 401 (signed out?)`, 401);
  }

  async function gql<T>(query: string, variables: Record<string, unknown>, what: string): Promise<T> {
    const resp = await call(GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) }, what);
    const r = (await resp.json()) as { data?: T; errors?: { message?: string }[] };
    if (r.errors?.length) throw new WriteError(`${what}: ${r.errors[0]?.message ?? "error"}`);
    if (!r.data) throw new WriteError(`${what}: empty response`);
    return r.data;
  }

  let key: Promise<MsrcJwk> | null = null;
  function msrcKey(): Promise<MsrcJwk> {
    key ??= d
      .fetch(`${API}/portal/v2.0/key`, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new WriteError(`encryption key: HTTP ${r.status}`, r.status);
        const k = ((await r.json()) as { keys?: MsrcJwk[] }).keys?.[0];
        if (!k) throw new WriteError("encryption key: MSRC published no key");
        return k;
      })
      .catch((e) => {
        key = null; // try again next time
        throw e;
      });
    return key;
  }

  return {
    /** Irreversible: a new message on the case, exactly what the portal's
     *  "Type a new message" box sends. No conversation id is involved. */
    async sendMessage(reportNumber: string, text: string, topic?: MessageTopic | null): Promise<void> {
      const rn = vuln(reportNumber);
      const bodyText = text.trim();
      if (!bodyText) throw new WriteError("The message is empty.");
      if (topic != null && !MESSAGE_TOPICS.some((t) => t.value === topic)) throw new WriteError(`Unknown message topic: ${JSON.stringify(topic)}`);
      const payload: Record<string, unknown> = { body: bodyText, reportNumber: rn };
      if (topic) payload["topicList"] = [topic];
      try {
        await call(
          `${API}/message/MessageService.SendMessage`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) },
          "send message",
        );
      } catch (e) {
        if (e instanceof WriteError) {
          const s = e.status;
          // No session, or MSRC rejected the request: nothing was sent.
          if (s === undefined || (s >= 400 && s < 500 && s !== 408)) throw e;
          throw new MaybeSentError(e.message, s);
        }
        // Network failure or timeout after the request went out.
        throw new MaybeSentError(`send message: ${errorText(e)}`);
      }
    },

    async createDraft(report: ReportInput): Promise<string> {
      const id = (await gql<{ createVulnerabilityReport: unknown }>(CREATE_REPORT_MUTATION, { report }, "save draft")).createVulnerabilityReport;
      if (!isGuid(id)) throw new WriteError("save draft: MSRC returned no report id");
      return id;
    },

    async updateDraft(id: string, report: ReportInput): Promise<void> {
      await gql(UPDATE_REPORT_DRAFT_MUTATION, { reportId: guid(id), report }, "save draft");
    },

    async getReport(id: string): Promise<Record<string, unknown> | null> {
      const d = await gql<{ vulnerabilityReports: { items?: Record<string, unknown>[] } }>(REPORT_BY_ID_QUERY, { id: guid(id) }, "load draft");
      return d.vulnerabilityReports.items?.[0] ?? null;
    },

    async deleteDraft(id: string): Promise<void> {
      await gql(DELETE_REPORT_DRAFT_MUTATION, { reportId: guid(id) }, "delete draft");
    },

    /** Irreversible. Resolves only once MSRC lists the report as no longer a draft. */
    async submit(id: string): Promise<void> {
      await gql(SUBMIT_REPORT_MUTATION, { reportId: guid(id) }, "submit");
      let after: Record<string, unknown> | null;
      try {
        const d = await gql<{ vulnerabilityReports: { items?: Record<string, unknown>[] } }>(REPORT_BY_ID_QUERY, { id }, "confirm submit");
        after = d.vulnerabilityReports.items?.[0] ?? null;
      } catch (e) {
        throw new WriteError(`MSRC took the request, but the dashboard couldn't confirm the submission (${errorText(e)}). Check the report in the portal before trying again.`);
      }
      if (!after || after["status"] === "DRAFT") throw new WriteError("MSRC says the report is still a draft, so it was not submitted. Check it in the portal.");
    },

    async listDraftFiles(reportNumber: string): Promise<DraftFile[]> {
      // Live: drafts list their files by report number; objectId only works once submitted.
      const filter = encodeURIComponent(`reportId eq '${vuln(reportNumber)}'`);
      const r = await call(`${API}/portal/v2.0/file?$filter=${filter}&$orderBy=${encodeURIComponent("createdOn desc")}`, {}, "files");
      return (((await r.json()) as { value?: Record<string, unknown>[] }).value ?? []).map(fileOf);
    },

    /** Irreversible: MSRC has no way to remove an attached file. */
    async attach(reportNumber: string, file: { name: string; bytes: Uint8Array<ArrayBuffer> | ArrayBuffer }): Promise<DraftFile> {
      const rn = vuln(reportNumber);
      const jwk = await msrcKey();
      const enc = await encryptForMsrc(file.bytes, jwk);
      const form = new FormData();
      form.append(attachFieldName(file.name), new Blob([enc.body], { type: "application/octet-stream" }));
      const r = await call(
        `${API}/portal/v2.0/vulnerabilityReport/${rn}/File.Attach`,
        { method: "POST", headers: { "x-wrapped-key": JSON.stringify({ EncryptedKey: enc.wrappedKey, KeyId: enc.kid }) }, body: form },
        `attach ${file.name}`,
      );
      const saved = ((await r.json()) as { value?: Record<string, unknown>[] }).value?.[0];
      return saved ? fileOf(saved) : { id: "", name: file.name, createdOn: null };
    },
  };
}

export type ReportApi = ReturnType<typeof createReportApi>;
