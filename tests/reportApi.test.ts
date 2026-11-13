import { describe, expect, it } from "vitest";
import {
  ANALYZE_REPORT_MUTATION,
  CANCEL_DISCLOSURE_MUTATION,
  CREATE_DISCLOSURE_MUTATION,
  CREATE_REPORT_MUTATION,
  DELETE_REPORT_DRAFT_MUTATION,
  PORTAL_BANNERS_QUERY,
  REPORT_BY_ID_QUERY,
  SUBMIT_REPORT_MUTATION,
  UPDATE_DISCLOSURE_MUTATION,
  UPDATE_REPORT_DRAFT_MUTATION,
  VALIDATE_QUALITY_GATES_MUTATION,
} from "../src/background/queries";
import { createReportApi, MaybeSentError, MESSAGE_TOPICS, WriteError } from "../src/dashboard/reportApi";

const GUID = "124103c7-209b-4948-9aea-d48bdae6b026";
const GQL = "https://api.msrc.microsoft.com/portalgraphql/v2.0";

interface Call {
  url: string;
  init: RequestInit;
}

function harness(responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const tokens: boolean[] = [];
  const api = createReportApi({
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error("unexpected request " + url);
      return typeof r === "function" ? r() : r;
    }) as typeof fetch,
    token: async (fresh) => {
      tokens.push(fresh === true);
      return fresh ? "tok-2" : "tok-1";
    },
  });
  return { api, calls, tokens };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const header = (c: Call, h: string) => new Headers(c.init.headers).get(h);
const body = (c: Call) => JSON.parse(String(c.init.body));

describe("MSRC pre-submit checks", () => {
  const report = { title: "T", description: "D", reproductionSteps: "R", callstack: "" };
  it("analyzes an existing draft and requests the portal's quality gates", async () => {
    const analysis = { submissionId: GUID, isMsrc: true, classification: "MSRC", confidence: 0.91, reason: "Relevant", suggestedCategory: null, educationalTips: [] };
    const quality = { gatesTriggered: [{ gate: "MISSING_POC", aiConfirmed: true }], showNudge: true };
    const { api, calls } = harness([json({ data: { analyzeVulnerabilityReport: analysis } }), json({ data: { validateQualityGates: quality } })]);
    expect(await api.analyzeDraft(GUID, report)).toEqual(analysis);
    expect(await api.validateQuality(report, 0)).toEqual(quality);
    expect(body(calls[0]!)).toEqual({ query: ANALYZE_REPORT_MUTATION, variables: { report: { id: GUID, ...report } } });
    expect(body(calls[1]!)).toEqual({ query: VALIDATE_QUALITY_GATES_MUTATION, variables: { report, clientTriggeredGates: ["MISSING_ATTACHMENT", "LOW_QUALITY_REPRO", "MISSING_POC"] } });
  });

  it("does not request an attachment gate when files exist or accept a different draft id", async () => {
    const { api, calls } = harness([json({ data: { validateQualityGates: { gatesTriggered: [], showNudge: false } } }), json({ data: { analyzeVulnerabilityReport: { submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } })]);
    await api.validateQuality(report, 2);
    expect(body(calls[0]!).variables.clientTriggeredGates).toEqual(["LOW_QUALITY_REPRO", "MISSING_POC"]);
    await expect(api.analyzeDraft(GUID, report)).rejects.toThrow(/did not refer to this draft/);
  });
});

describe("report drafts", () => {
  it("creates a draft with the verbatim mutation and returns its id", async () => {
    const { api, calls } = harness([json({ data: { createVulnerabilityReport: GUID } })]);
    expect(await api.createDraft({ title: "T" })).toBe(GUID);
    expect(calls[0]!.url).toBe(GQL);
    expect(calls[0]!.init.method).toBe("POST");
    expect(header(calls[0]!, "Authorization")).toBe("Bearer tok-1");
    expect(body(calls[0]!)).toEqual({ query: CREATE_REPORT_MUTATION, variables: { report: { title: "T" } } });
  });

  it("updates, reads, deletes and submits by report id", async () => {
    const { api, calls } = harness([
      json({ data: { updateVulnerabilityReportDraft: GUID } }),
      json({ data: { vulnerabilityReports: { items: [{ id: GUID, title: "T" }] } } }),
      json({ data: { deleteVulnerabilityReportDraft: GUID } }),
      json({ data: { submitVulnerabilityReport: GUID } }),
      json({ data: { vulnerabilityReports: { items: [{ id: GUID, status: "NEW" }] } } }),
    ]);
    await api.updateDraft(GUID, { title: "T" });
    expect(await api.getReport(GUID)).toEqual({ id: GUID, title: "T" });
    await api.deleteDraft(GUID);
    await api.submit(GUID);
    expect(calls.map((c) => body(c))).toEqual([
      { query: UPDATE_REPORT_DRAFT_MUTATION, variables: { reportId: GUID, report: { title: "T" } } },
      { query: REPORT_BY_ID_QUERY, variables: { id: GUID } },
      { query: DELETE_REPORT_DRAFT_MUTATION, variables: { reportId: GUID } },
      { query: SUBMIT_REPORT_MUTATION, variables: { reportId: GUID } },
      { query: REPORT_BY_ID_QUERY, variables: { id: GUID } }, // confirm it left draft state
    ]);
  });

  it("rejects malformed ids before any request", async () => {
    const { api, calls } = harness([]);
    await expect(api.updateDraft("x' or 1=1", {})).rejects.toThrow(/invalid report id/i);
    await expect(api.submit("")).rejects.toThrow(/invalid report id/i);
    await expect(api.listDraftFiles("VULN-1 or")).rejects.toThrow(/invalid report number/i);
    expect(calls).toEqual([]);
  });

  it("retries once with a fresh token on 401", async () => {
    const { api, tokens, calls } = harness([new Response("", { status: 401 }), json({ data: { deleteVulnerabilityReportDraft: GUID } })]);
    await api.deleteDraft(GUID);
    expect(tokens).toEqual([false, true]);
    expect(header(calls[1]!, "Authorization")).toBe("Bearer tok-2");
  });

  it("surfaces GraphQL and HTTP errors in words", async () => {
    const { api } = harness([json({ errors: [{ message: "Report is not in draft state" }] }), new Response("nope", { status: 400 })]);
    await expect(api.submit(GUID)).rejects.toThrow("Report is not in draft state");
    await expect(api.updateDraft(GUID, {})).rejects.toThrow(/HTTP 400/);
  });

  it("lists draft files by report number", async () => {
    const { api, calls } = harness([json({ value: [{ id: "f1", name: "poc.zip", createdOn: "2026-11-11T00:00:00Z" }] })]);
    expect(await api.listDraftFiles("VULN-263778")).toEqual([{ id: "f1", name: "poc.zip", createdOn: "2026-11-11T00:00:00Z" }]);
    expect(decodeURIComponent(calls[0]!.url)).toBe("https://api.msrc.microsoft.com/portal/v2.0/file?$filter=reportId eq 'VULN-263778'&$orderBy=createdOn desc");
  });
});

describe("attach", () => {
  it("encrypts with MSRC's key and posts the portal's multipart shape", async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" }, true, ["wrapKey", "unwrapKey"]);
    const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", hash: "SHA-1" };
    const { api, calls } = harness([json({ keys: [jwk] }), json({ value: [{ id: "f9", name: "poc.txt", reportId: "VULN-263778" }] })]);
    const file = await api.attach("VULN-263778", { name: "poc.txt", bytes: new TextEncoder().encode("hello") });
    expect(file).toEqual({ id: "f9", name: "poc.txt", createdOn: null });

    expect(calls[0]!.url).toBe("https://api.msrc.microsoft.com/portal/v2.0/key");
    expect(header(calls[0]!, "Authorization")).toBeNull(); // the key endpoint is public, like in the portal
    const post = calls[1]!;
    expect(post.url).toBe("https://api.msrc.microsoft.com/portal/v2.0/vulnerabilityReport/VULN-263778/File.Attach");
    expect(post.init.method).toBe("POST");
    expect(header(post, "Authorization")).toBe("Bearer tok-1");
    const wrapped = JSON.parse(header(post, "x-wrapped-key")!);
    expect(Object.keys(wrapped)).toEqual(["EncryptedKey", "KeyId"]);
    expect(wrapped.KeyId).toBe("k1");
    const part = (post.init.body as FormData).get("poc.txt") as Blob;
    expect(part.type).toBe("application/octet-stream");
    expect(part.size).toBe(16 + 16); // IV + one AES block for 5 bytes
  });

  it("refuses to attach to a malformed report number", async () => {
    const { api, calls } = harness([]);
    await expect(api.attach("../x", { name: "a", bytes: new Uint8Array(1) })).rejects.toThrow(/invalid report number/i);
    expect(calls).toEqual([]);
  });
});

describe("submit confirmation", () => {
  it("fails loudly when MSRC still shows a draft afterwards", async () => {
    const { api } = harness([json({ data: { submitVulnerabilityReport: null } }), json({ data: { vulnerabilityReports: { items: [{ id: GUID, status: "DRAFT" }] } } })]);
    await expect(api.submit(GUID)).rejects.toThrow(/still a draft/i);
  });

  it("says so when the confirmation itself can't be read", async () => {
    const { api } = harness([json({ data: { submitVulnerabilityReport: GUID } }), new Response("", { status: 503 })]);
    await expect(api.submit(GUID)).rejects.toThrow(/couldn't confirm/i);
  });
});

describe("sending a message", () => {
  const SEND = "https://api.msrc.microsoft.com/message/MessageService.SendMessage";

  it("posts the trimmed text with the report number and topic", async () => {
    const { api, calls } = harness([json({ value: "ok" })]);
    await api.sendMessage("VULN-100140", "  Thanks!\n\nOne question.  ", "Bounty");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SEND);
    expect(calls[0]!.init.method).toBe("POST");
    expect(header(calls[0]!, "Content-Type")).toBe("application/json");
    expect(header(calls[0]!, "Authorization")).toBe("Bearer tok-1");
    expect(body(calls[0]!)).toEqual({ body: "Thanks!\n\nOne question.", reportNumber: "VULN-100140", topicList: ["Bounty"] });
  });

  it("leaves topicList out when no topic is picked", async () => {
    const { api, calls } = harness([new Response(null, { status: 204 })]);
    await api.sendMessage("VULN-1", "Hello", null);
    expect(body(calls[0]!)).toEqual({ body: "Hello", reportNumber: "VULN-1" });
  });

  it("rejects bad input before any request", async () => {
    const { api, calls } = harness([]);
    await expect(api.sendMessage("VULN-1' or 1 eq 1", "Hi")).rejects.toThrow(/report number/);
    await expect(api.sendMessage("VULN-1", "   \n ")).rejects.toThrow(/empty/);
    await expect(api.sendMessage("VULN-1", "Hi", "Payment" as never)).rejects.toThrow(/topic/);
    expect(calls).toHaveLength(0);
  });

  it("mints a fresh token once on 401 and fails on other errors", async () => {
    const ok = harness([json({}, 401), json({ value: "ok" })]);
    await ok.api.sendMessage("VULN-1", "Hi");
    expect(ok.tokens).toEqual([false, true]);
    expect(ok.calls).toHaveLength(2);
    const bad = harness([json({ error: "nope" }, 500)]);
    await expect(bad.api.sendMessage("VULN-1", "Hi")).rejects.toThrow(/HTTP 500/);
    expect(bad.calls).toHaveLength(1);
  });

  it("lists the portal's five topics", () => {
    expect(MESSAGE_TOPICS.map((t) => t.value)).toEqual(["Assessment", "CaseStatus", "Release", "Bounty", "Other"]);
  });
});

describe("a send that may or may not have reached MSRC", () => {
  it("a server error or a dropped connection is 'maybe sent', never 'not sent'", async () => {
    for (const r of [json({}, 502), json({}, 504), json({}, 500), json({}, 408), () => { throw new TypeError("Failed to fetch"); }]) {
      const { api } = harness([r]);
      await expect(api.sendMessage("VULN-1", "Hi")).rejects.toBeInstanceOf(MaybeSentError);
    }
  });

  it("a rejection by MSRC, a bad input or no session is a plain 'not sent'", async () => {
    for (const status of [400, 403, 404, 429]) {
      const { api } = harness([json({}, status)]);
      const e = await api.sendMessage("VULN-1", "Hi").catch((x) => x);
      expect(e).toBeInstanceOf(WriteError);
      expect(e).not.toBeInstanceOf(MaybeSentError);
    }
    const noSession = createReportApi({ fetch: (async () => json({})) as typeof fetch, token: async () => { throw new WriteError("signed out"); } });
    expect(await noSession.sendMessage("VULN-1", "Hi").catch((x) => x)).not.toBeInstanceOf(MaybeSentError);
  });

  it("gives up waiting after a timeout instead of hanging", async () => {
    const { api, calls } = harness([json({ value: "ok" })]);
    await api.sendMessage("VULN-1", "Hi");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("MSRC's banner on a case", () => {
  it("reads it with the portal's query, by report number", async () => {
    const banner = { id: "b1", key: "develop", body: "We're working on a fix.", tone: "INFO" };
    const { api, calls } = harness([json({ data: { portalBanners: [banner] } })]);
    expect(await api.portalBanners("VULN-123456")).toEqual([banner]);
    expect(body(calls[0]!)).toEqual({ query: PORTAL_BANNERS_QUERY, variables: { reportNumber: "VULN-123456" } });
    await expect(api.portalBanners("100140")).rejects.toThrow(WriteError);
  });
});

describe("planned disclosures on a submitted case", () => {
  const EVENT = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("adds one with the portal's mutation; the date is midnight UTC or absent", async () => {
    const { api, calls } = harness([json({ data: { createDisclosureEvent: EVENT } }), json({ data: { createDisclosureEvent: EVENT } })]);
    await api.addDisclosure("VULN-123456", { medium: "CONFERENCE", name: "  A talk  ", date: "2027-03-01" });
    await api.addDisclosure("VULN-123456", { medium: "BLOG", name: "https://example.com/post", date: "" });
    expect(calls.map(body)).toEqual([
      { query: CREATE_DISCLOSURE_MUTATION, variables: { submissionId: "VULN-123456", conferenceTracking: { medium: "CONFERENCE", name: "A talk", date: "2027-03-01T00:00:00Z" } } },
      { query: CREATE_DISCLOSURE_MUTATION, variables: { submissionId: "VULN-123456", conferenceTracking: { medium: "BLOG", name: "https://example.com/post", date: null } } },
    ]);
  });

  it("changes and cancels one by its id", async () => {
    const { api, calls } = harness([json({ data: { updateDisclosureEvent: true } }), json({ data: { cancelDisclosureEvent: true } })]);
    await api.updateDisclosure("VULN-123456", EVENT, { medium: "OTHER", name: "Paper", date: "2027-04-02" });
    await api.cancelDisclosure("VULN-123456", EVENT);
    expect(calls.map(body)).toEqual([
      { query: UPDATE_DISCLOSURE_MUTATION, variables: { submissionId: "VULN-123456", conferenceId: EVENT, conferenceTracking: { medium: "OTHER", name: "Paper", date: "2027-04-02T00:00:00Z" } } },
      { query: CANCEL_DISCLOSURE_MUTATION, variables: { submissionId: "VULN-123456", conferenceId: EVENT } },
    ]);
  });

  it("rejects bad input before any request", async () => {
    const { api, calls } = harness([]);
    await expect(api.addDisclosure("VULN-1", { medium: "BLOG", name: " ", date: "" })).rejects.toThrow(/name/);
    await expect(api.addDisclosure("VULN-1", { medium: "PODCAST", name: "x", date: "" })).rejects.toThrow(/medium/);
    await expect(api.addDisclosure("VULN-1", { medium: "BLOG", name: "x", date: "1 March" })).rejects.toThrow(/date/);
    await expect(api.addDisclosure("nope", { medium: "BLOG", name: "x", date: "" })).rejects.toThrow(/report number/);
    await expect(api.cancelDisclosure("VULN-1", "a/b")).rejects.toThrow(/disclosure id/);
    expect(calls).toHaveLength(0);
  });

  it("reports MSRC's error in words", async () => {
    const { api } = harness([json({ errors: [{ message: "Not allowed" }] })]);
    await expect(api.cancelDisclosure("VULN-1", EVENT)).rejects.toThrow("cancel disclosure: Not allowed");
  });
});
