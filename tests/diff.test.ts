import { describe, expect, it } from "vitest";
import { cveEvents, diffCase, messageEvents } from "../src/core/diff";
import { caseRec, file, msg } from "./helpers";

const NOW = "2026-11-11T12:00:00.000Z";
const ctx = { now: NOW };
const base = {
  title: "Synthetic case",
  status: "REVIEW_REPRO",
  statusReason: null,
  bounty: { amount: null, program: "Windows", status: "PENDING" },
  cvssVectorString: "CVSS:3.1/AV:L",
  variantOrRelatedCVE: null,
  disclosureEventList: [],
  isFlagged: false,
  lastActivityOn: "2026-10-01T00:00:00Z",
  unreadMessageCount: 0,
  changeLog: [],
};

describe("diffCase", () => {
  it("reports a brand-new case once, as own and seen", () => {
    const ev = diffCase(undefined, caseRec("VULN-1", base), ctx);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "case_added", own: true, seen: true, reportNumber: "VULN-1" });
  });

  it("emits a status event dated from the changeLog when present", () => {
    const next = {
      ...base,
      status: "DEVELOP",
      changeLog: [{ id: "c1", activityTime: "2026-11-06T15:44:00Z", changeSet: [{ key: "status", value: { oldValue: "REVIEW_REPRO", newValue: "DEVELOP" } }] }],
    };
    const ev = diffCase(caseRec("VULN-1", base), caseRec("VULN-1", next), ctx);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "status", oldValue: "REVIEW_REPRO", newValue: "DEVELOP", occurredAt: "2026-11-06T15:44:00Z", seen: false, own: false });
    expect(ev[0]!.summary).toBe("Status Review / Repro → Develop");
  });

  it("falls back to detection time without a changeLog entry", () => {
    const ev = diffCase(caseRec("VULN-1", base), caseRec("VULN-1", { ...base, statusReason: "FIXED" }), ctx);
    expect(ev[0]).toMatchObject({ type: "status_reason", occurredAt: NOW, detectedAt: NOW });
  });

  it("says plainly when MSRC starts or stops waiting for the researcher", () => {
    const waiting = { ...base, statusReason: "ADDITIONAL_INFORMATION_NEEDED" };
    expect(diffCase(caseRec("VULN-1", base), caseRec("VULN-1", waiting), ctx)[0]!.summary).toBe("Action required: MSRC needs more information from you");
    expect(diffCase(caseRec("VULN-1", waiting), caseRec("VULN-1", { ...base, statusReason: "NONE" }), ctx)[0]!.summary).toBe("MSRC no longer needs information from you");
    expect(diffCase(caseRec("VULN-1", base), caseRec("VULN-1", { ...base, statusReason: "FIXED" }), ctx)[0]!.summary).toBe("Status reason — → Fixed");
  });

  it("folds all bounty sub-field changes into one bounty event", () => {
    const next = { ...base, bounty: { amount: 5000, program: "Windows Insider", status: "AWARDED" } };
    const ev = diffCase(caseRec("VULN-1", base), caseRec("VULN-1", next), ctx);
    expect(ev.map((e) => e.type)).toEqual(["bounty"]);
    expect(ev[0]!.summary).toContain("Bounty Pending → Awarded");
    expect(ev[0]!.summary).toContain("Bounty amount — → $5,000");
  });

  it("reports new files and disclosure events; the researcher's 'related CVE' is a field change, not an assigned CVE", () => {
    const next = { ...base, variantOrRelatedCVE: "CVE-2026-11111", disclosureEventList: [{ id: "d1", name: "Talk", date: "2027-01-01" }] };
    const ev = diffCase(caseRec("VULN-1", base), caseRec("VULN-1", next, { files: [file("f1", "poc.zip")] }), ctx);
    expect(ev.map((e) => e.type).sort()).toEqual(["disclosure_event", "field_changed", "file_added"]);
    expect(ev.find((e) => e.type === "field_changed")!.summary).toContain("CVE-2026-11111");
    expect(ev.find((e) => e.type === "file_added")!.occurredAt).toBe("2026-11-01T00:00:00Z");
  });

  it("ignores bookkeeping fields", () => {
    const next = { ...base, lastActivityOn: "2026-11-11T00:00:00Z", unreadMessageCount: 3, hasUnread: true, modifiedOn: "x", csatSurveyLink: { url: "u" } };
    expect(diffCase(caseRec("VULN-1", base), caseRec("VULN-1", next), ctx)).toEqual([]);
  });

  it("reports any other field as field_changed with its name", () => {
    const ev = diffCase(caseRec("VULN-1", base), caseRec("VULN-1", { ...base, cvssVectorString: "CVSS:3.1/AV:N" }), ctx);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "field_changed", field: "cvssVectorString", newValue: "CVSS:3.1/AV:N" });
  });

  it("treats flag toggles as the researcher's own action", () => {
    const ev = diffCase(caseRec("VULN-1", base), caseRec("VULN-1", { ...base, isFlagged: true }), ctx);
    expect(ev[0]).toMatchObject({ field: "isFlagged", own: true, seen: true });
  });

  it("does not invent changes when only one side has full details", () => {
    expect(diffCase(caseRec("VULN-1", null), caseRec("VULN-1", base), ctx)).toEqual([]);
  });

  it("produces identical keys when diffing the same pair twice", () => {
    const a = caseRec("VULN-1", base);
    const b = caseRec("VULN-1", { ...base, status: "DEVELOP", cvssVectorString: "x" });
    expect(diffCase(a, b, ctx).map((e) => e.key)).toEqual(diffCase(a, b, { now: "2030-01-01T00:00:00Z" }).map((e) => e.key));
  });
});

describe("messageEvents", () => {
  const mctx = { now: NOW, ticketOf: () => "100140" };
  it("marks MSRC messages unseen and own messages seen", () => {
    const ev = messageEvents(
      [
        msg({ id: "a", reportNumber: "VULN-1", createdOn: "2026-11-11T10:05:00Z", senderName: "MSRC" }),
        msg({ id: "b", reportNumber: "VULN-1", createdOn: "2026-11-11T11:00:00Z", senderName: "Researcher" }),
      ],
      mctx,
    );
    expect(ev[0]).toMatchObject({ type: "msrc_message", seen: false, own: false, occurredAt: "2026-11-11T10:05:00Z", sourceId: "a", ticketNumber: "100140" });
    expect(ev[1]).toMatchObject({ type: "own_message", seen: true, own: true });
  });
});

describe("cveEvents", () => {
  it("emits only CVEs that are new since the previous extraction, keyed like field CVEs", () => {
    const before = { "VULN-1": [{ cve: "CVE-2026-10001", source: "message" as const, messageId: "a" }] };
    const after = {
      "VULN-1": [
        { cve: "CVE-2026-10001", source: "message" as const, messageId: "a" },
        { cve: "CVE-2026-20002", source: "message" as const, messageId: "b" },
      ],
    };
    const ev = cveEvents(before, after, { now: NOW, ticketOf: () => null, msgTime: () => "2026-11-10T00:00:00Z" });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "cve", newValue: "CVE-2026-20002", occurredAt: "2026-11-10T00:00:00Z" });
  });
});

describe("messageEvents, automatic MSRC mails", () => {
  it("summarises known MSRC templates", () => {
    const ev = messageEvents([msg({ id: "z", reportNumber: "VULN-1", createdOn: NOW, senderName: "MSRC", body: "We confirmed the behavior you reported.", raw: { topicList: ["AutoNotification"] } })], { now: NOW, ticketOf: () => null });
    expect(ev[0]).toMatchObject({ type: "msrc_message", summary: "MSRC confirmed the behavior" });
  });
  it("falls back to a generic label for unknown automatic mails", () => {
    const ev = messageEvents([msg({ id: "y", reportNumber: "VULN-1", createdOn: NOW, senderName: "MSRC", body: "Something new.", raw: { topicList: ["AutoNotification"] } })], { now: NOW, ticketOf: () => null });
    expect(ev[0]!.summary).toBe("MSRC sent an update");
  });
});

describe("occurredAt without a changeLog", () => {
  it("uses the case's new lastActivityOn instead of the detection time", () => {
    const prev = caseRec("VULN-1", { ...base, changeLog: null }, { list: { lastActivityOn: "2026-11-01T00:00:00Z" } });
    const next = caseRec("VULN-1", { ...base, changeLog: null, status: "DEVELOP" }, { list: { lastActivityOn: "2026-11-08T09:30:00Z" } });
    expect(diffCase(prev, next, ctx)[0]).toMatchObject({ type: "status", occurredAt: "2026-11-08T09:30:00Z", detectedAt: NOW });
  });
  it("falls back to detection time when lastActivityOn did not move", () => {
    const prev = caseRec("VULN-1", { ...base, changeLog: null }, { list: { lastActivityOn: "2026-11-01T00:00:00Z" } });
    const next = caseRec("VULN-1", { ...base, changeLog: null, status: "DEVELOP" }, { list: { lastActivityOn: "2026-11-01T00:00:00Z" } });
    expect(diffCase(prev, next, ctx)[0]!.occurredAt).toBe(NOW);
  });
});

describe("bounty wording", () => {
  it("uses the portal's names for bounty states", () => {
    const prev = caseRec("VULN-1", { ...base, bounty: { amount: 4000, program: "W", status: "AWARD_PENDING_REVIEWED" } });
    const next = caseRec("VULN-1", { ...base, bounty: { amount: 4000, program: "W", status: "AWARDED_REVIEWED" } });
    const ev = diffCase(prev, next, ctx);
    expect(ev[0]!.summary).toBe("Bounty Award Pending – Reviewed → Awarded – Reviewed");
  });
});

describe("case added", () => {
  it("decodes HTML entities in the title", () => {
    const ev = diffCase(undefined, caseRec("VULN-1", { title: "A &amp; B &lt;driver&gt;" }), ctx);
    expect(ev[0]!.summary).toBe("Case added: A & B <driver>");
  });
});
