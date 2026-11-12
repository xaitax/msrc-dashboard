import { describe, expect, it } from "vitest";
import { buildView, groupFeed, pinUnseen, stageOf } from "../src/dashboard/data";
import type { AppState } from "../src/shared/protocol";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec, msg } from "./helpers";

const NOW = new Date("2026-11-11T15:00:00");
const STATE: AppState = { auth: "ok", lastSyncAt: NOW.getTime(), lastError: null, syncing: false, baselineDone: true, progress: null, sessionExpiresAt: null, sessionStartedAt: null, lastSessionLengthMs: null };
const iso = (s: string) => new Date(s).toISOString();

let n = 0;
function ev(rn: string, type: ChangeEvent["type"], at: string, p: Partial<ChangeEvent> = {}): ChangeEvent {
  n += 1;
  return { key: `k${n}`, reportNumber: rn, ticketNumber: null, type, summary: type, occurredAt: iso(at), detectedAt: iso(at), seen: false, own: false, ...p };
}

const cases = [
  caseRec("VULN-1", { status: "DEVELOP", title: "One" }, { list: { status: "DEVELOP", ticketNumber: "100140", title: "One" } }),
  caseRec("VULN-2", { status: "REVIEW_REPRO", title: "Two" }, { list: { status: "REVIEW_REPRO", ticketNumber: "100130", title: "Two" } }),
  caseRec("VULN-3", { status: "COMPLETE_DUPLICATE", title: "Three" }, { list: { status: "COMPLETE_DUPLICATE", ticketNumber: "100138", title: "Three" } }),
];
const messages = [
  msg({ reportNumber: "VULN-1", createdOn: iso("2026-11-11T10:05:00"), senderName: "MSRC" }),
  msg({ reportNumber: "VULN-2", createdOn: iso("2026-09-30T09:00:00"), senderName: "Researcher" }),
  msg({ reportNumber: "VULN-3", createdOn: iso("2026-11-01T09:00:00"), senderName: "MSRC", body: "Fixed as CVE-2026-55555" }),
];
const events = [
  ev("VULN-1", "msrc_message", "2026-11-11T10:05:00"),
  ev("VULN-3", "status", "2026-11-10T16:40:00", { oldValue: "DEVELOP", newValue: "COMPLETE_DUPLICATE" }),
  ev("VULN-2", "own_message", "2026-09-30T09:00:00", { seen: true, own: true }),
  ev("VULN-2", "status", "2026-10-02T09:00:00", { seen: true, oldValue: "NEW", newValue: "REVIEW_REPRO" }),
  ev("VULN-1", "msrc_message", "2026-08-01T10:00:00", { seen: true }),
];

describe("buildView", () => {
  const v = buildView(cases, messages, events, STATE);

  it("sorts rows by their latest change, newest first", () => {
    expect(v.rows.map((r) => r.reportNumber)).toEqual(["VULN-1", "VULN-3", "VULN-2"]);
  });

  it("shows the previous status only while a status change is unseen", () => {
    expect(v.rows.find((r) => r.reportNumber === "VULN-3")!.prevStatus).toBe("DEVELOP");
    expect(v.rows.find((r) => r.reportNumber === "VULN-2")!.prevStatus).toBeUndefined();
  });

  it("derives the unseen flag and CVEs per row", () => {
    const r1 = v.rows.find((r) => r.reportNumber === "VULN-1")!;
    expect(r1.unseen).toBe(true);
    expect(v.rows.find((r) => r.reportNumber === "VULN-3")!).toMatchObject({ closed: true, cves: ["CVE-2026-55555"] });
  });

  it("flags the cases where MSRC waits for the researcher", () => {
    const waiting = caseRec("VULN-4", { status: "REVIEW_REPRO", statusReason: "ADDITIONAL_INFORMATION_NEEDED" }, { list: { status: "REVIEW_REPRO", statusReason: "ADDITIONAL_INFORMATION_NEEDED" } });
    const listOnly = caseRec("VULN-5", null, { list: { status: "NEW", statusReason: "ADDITIONAL_INFORMATION_NEEDED" } });
    const w = buildView([...cases, waiting, listOnly], messages, events, STATE);
    expect(w.rows.filter((r) => r.actionNeeded).map((r) => r.reportNumber).sort()).toEqual(["VULN-4", "VULN-5"]);
    expect(w.rows.find((r) => r.reportNumber === "VULN-4")!.statusReason).toBe("ADDITIONAL_INFORMATION_NEEDED");
  });

  it("groups the last 30 days of events by local day, newest first", () => {
    const feed = groupFeed(events, NOW, 30);
    expect(feed.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
    expect(feed[0]!.events.map((e) => e.type)).toEqual(["msrc_message"]);
    expect(feed.flatMap((g) => g.events).some((e) => e.reportNumber === "VULN-2")).toBe(false); // older than 30 days
  });
});

describe("stageOf", () => {
  it("maps statuses onto the 5-step rail and flags duplicates", () => {
    expect(stageOf("NEW")).toEqual({ index: 0, duplicate: false });
    expect(stageOf("REVIEW_REPRO_DUPLICATE")).toEqual({ index: 1, duplicate: true });
    expect(stageOf("PRE_RELEASE")).toEqual({ index: 3, duplicate: false });
    expect(stageOf("COMPLETE_RESOLVED")).toEqual({ index: 4, duplicate: false });
    expect(stageOf("DRAFT")).toEqual({ index: -1, duplicate: false });
  });
});

describe("feed collapsing", () => {
  it("folds identical same-day events on one case into one item with a count", () => {
    const burst = [1, 2, 3].map((i) => ev("VULN-1", "msrc_message", `2026-11-11T10:0${i}:00`, { summary: "MSRC confirmed the behavior" }));
    const feed = groupFeed(burst, NOW, 30);
    expect(feed[0]!.events).toHaveLength(1);
    expect(feed[0]!.events[0]).toMatchObject({ summary: "MSRC confirmed the behavior", count: 3 });
  });
  it("never folds a different milestone away", () => {
    const burst = [
      ev("VULN-1", "msrc_message", "2026-11-11T10:01:00", { summary: "Bounty awarded: $5,000" }),
      ev("VULN-1", "msrc_message", "2026-11-11T10:02:00", { summary: "MSRC replied" }),
    ];
    expect(groupFeed(burst, NOW, 30)[0]!.events.map((e) => e.summary)).toEqual(["MSRC replied", "Bounty awarded: $5,000"]);
  });
});

describe("pinUnseen", () => {
  it("keeps the changes that were new when a case was opened marked as new", () => {
    const seenNow = [ev("VULN-1", "msrc_message", "2026-11-11T10:05:00", { key: "a", seen: true }), ev("VULN-1", "status", "2026-11-11T10:06:00", { key: "b", seen: true })];
    expect(pinUnseen(seenNow, new Set(["a"])).map((e) => [e.key, e.seen])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("titles with HTML entities", () => {
  it("decodes them for display", () => {
    const c = [caseRec("VULN-9", { status: "NEW", title: "App Management&#39;s missing DLL &amp; more" }, { list: { status: "NEW", title: "App Management&#39;s missing DLL &amp; more" } })];
    expect(buildView(c, [], [], STATE).rows[0]!.title).toBe("App Management's missing DLL & more");
  });
});

describe("recognition points", () => {
  it("reads casePoint per case and totals it by submission quarter", () => {
    const c = [
      caseRec("VULN-1", { status: "DEVELOP", casePoint: 20 }, { list: { createdOn: "2026-07-15T00:00:00Z" } }),
      caseRec("VULN-2", { status: "DEVELOP", casePoint: 10 }, { list: { createdOn: "2026-06-24T00:00:00Z" } }),
      caseRec("VULN-3", { status: "DEVELOP", casePoint: 0 }, { list: { createdOn: "2026-07-01T00:00:00Z" } }),
    ];
    const v = buildView(c, [], [], STATE);
    expect(v.rows.find((r) => r.reportNumber === "VULN-1")!.points).toBe(20);
    expect(v.points).toEqual({ total: 30, cases: 2, byQuarter: [{ year: 2026, quarter: 3, points: 20, cases: 1 }, { year: 2026, quarter: 2, points: 10, cases: 1 }] });
  });
});

describe("drafts in the view", () => {
  it("are listed newest edit first", () => {
    const d = (rn: string, at: string | null, created: string | null = null) => ({ id: "g-" + rn, reportNumber: rn, title: rn, createdOn: created, lastActivityOn: at });
    const v = buildView([], [], [], STATE, {}, [d("VULN-1", "2026-11-01T00:00:00Z"), d("VULN-2", "2026-11-10T00:00:00Z"), d("VULN-3", null, "2026-11-05T00:00:00Z")]);
    expect(v.drafts.map((x) => x.reportNumber)).toEqual(["VULN-2", "VULN-3", "VULN-1"]);
  });
});

describe("award totals in the view", () => {
  it("carries the bounty total for the top bar and the Recognition page", () => {
    const cases = [
      caseRec("VULN-1", { status: "DEVELOP", bounty: { status: "AWARDED_REVIEWED", amount: 4000, program: "Example Bounty Program" } }, { list: { ticketNumber: "100140" } }),
      caseRec("VULN-2", { status: "PRE_RELEASE", bounty: { status: "PENDING_REVIEW", amount: null, program: null } }, { list: { ticketNumber: "100135" } }),
    ];
    const v = buildView(cases, [], [], STATE);
    expect(v.awards.total).toBe(4000);
    expect(v.awards.underReview.map((r) => r.ticketNumber)).toEqual(["100135"]);
  });
});

describe("public CVEs in the view", () => {
  const item = {
  cve: "CVE-2026-1001",
  title: "Windows Example Elevation of Privilege Vulnerability",
  releaseDate: "2026-11-10T16:00:00Z",
  severity: "Important",
  impact: "Elevation of Privilege",
  baseScore: "7.0",
  vector: null,
  cwe: ["CWE-416: Use After Free"],
  exploitability: "Exploitation More Likely",
};
  const cases = [
    caseRec("VULN-1", { status: "DEVELOP", title: "Broker use-after-free to SYSTEM", securityImpact: "ELEVATION_OF_PRIVILEGE" }, { list: { ticketNumber: "100140" } }),
    caseRec("VULN-2", { status: "DEVELOP", title: "Registry write to SYSTEM", securityImpact: "ELEVATION_OF_PRIVILEGE" }, { list: { ticketNumber: "100121" } }),
  ];

  it("an unconfirmed CVE is only a suggestion, never on the case", () => {
    const v = buildView(cases, [], [], STATE, {}, [], { publicCves: [item], cveLinks: {} });
    expect(v.publicUnlinked).toEqual([{ item, suggestion: "VULN-1" }]);
    expect(v.rows.find((r) => r.reportNumber === "VULN-1")!.cves).toEqual([]);
  });

  it("a confirmed CVE shows on its case and in search", () => {
    const v = buildView(cases, [], [], STATE, {}, [], { publicCves: [item], cveLinks: { "CVE-2026-1001": "VULN-1" } });
    expect(v.publicUnlinked).toEqual([]);
    const row = v.rows.find((r) => r.reportNumber === "VULN-1")!;
    expect(row.cves).toEqual(["CVE-2026-1001"]);
    expect(row.publicCves).toEqual([{ item, by: "you" }]);
  });
});

describe("public CVEs: what counts as MSRC's link", () => {
  const item = { cve: "CVE-2026-1001", title: "Windows Example Elevation of Privilege Vulnerability", releaseDate: "2026-11-10T16:00:00Z", severity: "Important", impact: "Elevation of Privilege", baseScore: "7.0", vector: null, cwe: ["CWE-416: Use After Free"], exploitability: null };
  const cases = [caseRec("VULN-1", { status: "DEVELOP", title: "Broker use-after-free to SYSTEM", securityImpact: "ELEVATION_OF_PRIVILEGE" }, { list: { ticketNumber: "100140" } })];

  it("a CVE in the researcher's own message stays a suggestion, not MSRC's link", () => {
    const own = msg({ reportNumber: "VULN-1", createdOn: "2026-11-12T08:10:52Z", senderName: "Jane", body: "Could you reference CVE-2026-1001 here?" });
    const v = buildView(cases, [own], [], STATE, {}, [], { publicCves: [item], cveLinks: {} });
    expect(v.publicUnlinked).toEqual([{ item, suggestion: "VULN-1" }]);
    expect(v.rows[0]!.publicCves).toEqual([]);
  });

  it("MSRC naming it on the case links it", () => {
    const fixed = msg({ reportNumber: "VULN-1", createdOn: "2026-11-13T00:00:00Z", body: "The fix was released as CVE-2026-1001." });
    const v = buildView(cases, [fixed], [], STATE, {}, [], { publicCves: [item], cveLinks: {} });
    expect(v.rows[0]!.publicCves).toEqual([{ item, by: "msrc" }]);
  });
});
