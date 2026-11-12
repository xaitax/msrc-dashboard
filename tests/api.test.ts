import { describe, expect, it, vi } from "vitest";
import { msrcApi, normalizeFile, normalizeListItem, normalizeMessage } from "../src/background/api";
import { DETAIL_QUERY, LIST_QUERY } from "../src/background/queries";

// Synthetic payloads shaped like the live API.
const liveMessage = {
  id: "a1b2",
  createdOn: "2026-11-06T21:18:48Z",
  modifiedOn: "2026-11-06T21:52:51Z",
  senderName: "MSRC",
  body: "Hi researcher,\n we've updated your case:\n Status&nbsp;Develop",
  isResponseRequired: false,
  read: true,
  isFlagged: false,
  reportNumber: "VULN-100001",
  topicList: ["AutoNotification"],
  sentBy: { id: "00000000-0000-0000-0000-00000000000a", displayName: "MSRC", type: "useridentity" },
  regardingObject: { id: "00000000-0000-0000-0000-000000000001", displayName: "VULN-100001", type: "VulnerabilityReport" },
};
const liveFile = {
  id: "00000000-0000-0000-0000-0000000000f1",
  createdOn: "2026-03-25T19:36:52.99Z",
  createdBy: "00000000-0000-0000-0000-0000000000aa",
  modifiedOn: "2026-03-25T19:36:53.53Z",
  modifiedBy: "00000000-0000-0000-0000-0000000000aa",
  name: "poc.zip",
  reportId: "VULN-100001",
  submittedById: "00000000-0000-0000-0000-0000000000aa",
  objectId: "00000000-0000-0000-0000-000000000001",
  objectType: "VulnerabilityReport",
  uploadStatus: "completed",
};

describe("normalizers", () => {
  it("maps a live-shaped message and keeps the raw payload", () => {
    const m = normalizeMessage(liveMessage)!;
    expect(m).toMatchObject({ id: "a1b2", reportNumber: "VULN-100001", senderName: "MSRC", createdOn: "2026-11-06T21:18:48Z" });
    expect(m.raw["topicList"]).toEqual(["AutoNotification"]);
  });
  it("rejects messages without a valid report number", () => {
    expect(normalizeMessage({ ...liveMessage, reportNumber: "x" })).toBeNull();
  });
  it("maps a live-shaped file record", () => {
    expect(normalizeFile(liveFile)).toMatchObject({ id: liveFile.id, name: "poc.zip", createdOn: "2026-03-25T19:36:52.99Z" });
  });
  it("maps list items including bounty status", () => {
    expect(normalizeListItem({ id: "g", reportNumber: "VULN-1", ticketNumber: "100140", title: "t", status: "DEVELOP", bounty: { status: "PENDING" } })).toMatchObject({ ticketNumber: "100140", bountyStatus: "PENDING" });
  });
});

describe("portal query documents", () => {
  it("are the portal's own operations, unmodified", () => {
    expect(LIST_QUERY.startsWith("query VulnerabilityReports(")).toBe(true);
    expect(DETAIL_QUERY.startsWith("query VulnerabilityReportByVulnNumber(")).toBe(true);
    expect(DETAIL_QUERY).toContain("fragment EntireVulnReport on VulnerabilityReport");
    expect(LIST_QUERY).not.toContain("\r");
  });
});

describe("public Security Update Guide (no login)", () => {
  const SUG = "https://api.msrc.microsoft.com/sug/v2.0";
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

  it("reads credits since a date without a token, following paging links only on Microsoft's host", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ url, headers: new Headers(init.headers) });
      if (seen.length === 1) return json({ value: [{ cveNumber: "CVE-2026-1001" }], "@odata.nextLink": `${SUG}/sugodata/v2.0/en-US/acknowledgement?$skip=1` });
      if (seen.length === 2) return json({ value: [{ cveNumber: "CVE-2026-1002" }], "@odata.nextLink": "https://evil.example/sug/next" });
      throw new Error("followed a foreign link");
    });
    try {
      const rows = await msrcApi.publicCredits!("2026-03-06T00:00:00.000Z");
      expect(rows.map((r) => r["cveNumber"])).toEqual(["CVE-2026-1001", "CVE-2026-1002"]);
      expect(seen[0]!.url).toBe(`${SUG}/en-US/acknowledgement?$filter=${encodeURIComponent("releaseDate gt 2026-03-06T00:00:00Z")}`);
      expect(seen.every((s) => !s.headers.has("Authorization"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("looks up one CVE by a validated id, and fails loudly on errors", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return url.includes("CVE-2026-1001") ? json({ value: [{ cveNumber: "CVE-2026-1001", cveTitle: "T" }] }) : json({}, 500);
    });
    try {
      expect(await msrcApi.publicCve!("CVE-2026-1001")).toEqual({ cveNumber: "CVE-2026-1001", cveTitle: "T" });
      expect(seen[0]).toBe(`${SUG}/en-US/vulnerability?$filter=${encodeURIComponent("cveNumber eq 'CVE-2026-1001'")}`);
      expect(await msrcApi.publicCve!("CVE-2026-1' or 1")).toBeNull();
      expect(seen).toHaveLength(1);
      await expect(msrcApi.publicCredits!("2026-01-01T00:00:00Z")).rejects.toThrow(/HTTP 500/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("public guide requests can't hang the service worker", () => {
  it("every request carries a timeout signal", async () => {
    const signals: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
      signals.push(init.signal);
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    try {
      await msrcApi.publicCredits!("2026-01-01T00:00:00Z");
      await msrcApi.publicCve!("CVE-2026-1001");
      expect(signals).toHaveLength(2);
      expect(signals.every((x) => x instanceof AbortSignal)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
