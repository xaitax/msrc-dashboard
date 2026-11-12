import { describe, expect, it } from "vitest";
import { statusHistoryFrom, notificationStatus } from "../src/core/history";
import { buildTimeline } from "../src/core/timeline";
import { diffCase } from "../src/core/diff";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec } from "./helpers";

const n = (rn: string, status: string, at: string, type = "ReportStatusChange") => ({ id: at, createdOn: at, notificationType: type, reportNumber: rn, reportStatus: status, read: true });

describe("notificationStatus", () => {
  it("maps notification status names onto report status enums", () => {
    expect(notificationStatus("ReviewRepro")).toBe("REVIEW_REPRO");
    expect(notificationStatus("CompleteDuplicate")).toBe("COMPLETE_DUPLICATE");
    expect(notificationStatus("PreRelease")).toBe("PRE_RELEASE");
    expect(notificationStatus("Develop")).toBe("DEVELOP");
  });
});

describe("statusHistoryFrom", () => {
  it("keeps status changes only, per case, oldest first", () => {
    const h = statusHistoryFrom([
      n("VULN-1", "Develop", "2026-10-06T14:02:00Z"),
      n("VULN-1", "NewMessageOnReport", "2026-10-07T00:00:00Z", "NewMessageOnReport"),
      n("VULN-1", "ReviewRepro", "2026-09-01T10:00:00Z"),
      n("VULN-2", "New", "2026-08-01T00:00:00Z"),
    ]);
    expect(h).toEqual({
      "VULN-1": [
        { status: "REVIEW_REPRO", at: "2026-09-01T10:00:00Z" },
        { status: "DEVELOP", at: "2026-10-06T14:02:00Z" },
      ],
      "VULN-2": [{ status: "NEW", at: "2026-08-01T00:00:00Z" }],
    });
  });
});

describe("exact status times", () => {
  it("dates a detected status change by the matching notification", () => {
    const prev = caseRec("VULN-1", { status: "REVIEW_REPRO", changeLog: null });
    const next = caseRec("VULN-1", { status: "DEVELOP", changeLog: null }, { list: { lastActivityOn: "2026-10-09T00:00:00Z" } });
    const ev = diffCase(prev, next, { now: "2026-11-11T00:00:00Z", statusTime: (rn, st) => (rn === "VULN-1" && st === "DEVELOP" ? "2026-10-06T14:02:00Z" : null) });
    expect(ev[0]).toMatchObject({ type: "status", occurredAt: "2026-10-06T14:02:00Z" });
  });

  it("shows the notification history in the timeline instead of duplicate detected status events", () => {
    const c = caseRec("VULN-1", { status: "DEVELOP" }, { list: { createdOn: "2026-08-01T00:00:00Z" } });
    const detected: ChangeEvent = { key: "s", reportNumber: "VULN-1", ticketNumber: null, type: "status", field: "status", oldValue: "REVIEW_REPRO", newValue: "DEVELOP", summary: "Status Review / Repro → Develop", occurredAt: "2026-10-09T00:00:00Z", detectedAt: "2026-10-09T00:00:00Z", seen: false, own: false };
    const t = buildTimeline(c, [], [detected], [
      { status: "REVIEW_REPRO", at: "2026-09-01T10:00:00Z" },
      { status: "DEVELOP", at: "2026-10-06T14:02:00Z" },
    ]);
    expect(t.filter((i) => i.kind === "event").map((i) => [i.at, i.text])).toEqual([
      ["2026-08-01T00:00:00Z", "Report submitted"],
      ["2026-09-01T10:00:00Z", "Status → Review / Repro"],
      ["2026-10-06T14:02:00Z", "Status → Develop"],
    ]);
    expect(t.find((i) => i.text === "Status → Develop")!.isNew).toBe(true); // the unseen detected change carries over
  });
});
