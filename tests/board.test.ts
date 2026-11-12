import { describe, expect, it } from "vitest";
import { boardColumns, sinceStrip } from "../src/dashboard/board";
import { findPlacements } from "../src/core/recognition";
import { buildView } from "../src/dashboard/data";
import type { AppState } from "../src/shared/protocol";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec, msg } from "./helpers";

const STATE: AppState = { auth: "ok", lastSyncAt: 1, lastError: null, syncing: false, baselineDone: true, progress: null, sessionExpiresAt: null, sessionStartedAt: null, lastSessionLengthMs: null };
let n = 0;
const ev = (rn: string, at: string, p: Partial<ChangeEvent> = {}): ChangeEvent => {
  n += 1;
  return { key: `k${n}`, reportNumber: rn, ticketNumber: rn.replace("VULN-", "1"), type: "msrc_message", summary: `s${n}`, occurredAt: new Date(at).toISOString(), detectedAt: new Date(at).toISOString(), seen: false, own: false, ...p };
};

describe("sinceStrip", () => {
  it("shows one card per case with the newest change and how many more it has", () => {
    const s = sinceStrip([ev("VULN-1", "2026-11-11T09:00"), ev("VULN-1", "2026-11-11T10:00", { summary: "newest" }), ev("VULN-2", "2026-11-10T09:00")], 4);
    expect(s.mode).toBe("new");
    expect(s.cards.map((c) => [c.reportNumber, c.latest.summary, c.count])).toEqual([
      ["VULN-1", "newest", 2],
      ["VULN-2", "s3", 1],
    ]);
    expect(s.more).toBe(0);
    expect(s.total).toBe(3);
  });
  it("caps the strip and reports the overflow as more cases", () => {
    const evs = [1, 2, 3, 4, 5, 6, 7].map((i) => ev(`VULN-${i}`, `2026-11-0${i}T09:00`));
    const s = sinceStrip(evs, 4);
    expect(s.cards).toHaveLength(4);
    expect(s.cards[0]!.reportNumber).toBe("VULN-7");
    expect(s.more).toBe(3);
  });
  it("falls back to the latest changes, marked as such, when nothing is new", () => {
    const s = sinceStrip([ev("VULN-1", "2026-11-01T09:00", { seen: true }), ev("VULN-2", "2026-11-02T09:00", { seen: true }), ev("VULN-3", "2026-11-03T09:00", { own: true, seen: true, type: "own_message" })], 4);
    expect(s.mode).toBe("latest");
    expect(s.cards.map((c) => c.reportNumber)).toEqual(["VULN-3", "VULN-2", "VULN-1"]);
    expect(s.total).toBe(0);
  });
});

describe("boardColumns", () => {
  const cases = [
    caseRec("VULN-1", { status: "DEVELOP", title: "a" }, { list: { status: "DEVELOP", ticketNumber: "1" } }),
    caseRec("VULN-2", { status: "DEVELOP", title: "b" }, { list: { status: "DEVELOP", ticketNumber: "2" } }),
    caseRec("VULN-3", { status: "REVIEW_REPRO", title: "c" }, { list: { status: "REVIEW_REPRO", ticketNumber: "3" } }),
    caseRec("VULN-4", { status: "COMPLETE_DUPLICATE", title: "d" }, { list: { status: "COMPLETE_DUPLICATE", ticketNumber: "4" } }),
  ];
  const messages = [
    msg({ reportNumber: "VULN-1", createdOn: "2026-11-01T00:00:00Z", senderName: "Researcher" }),
    msg({ reportNumber: "VULN-2", createdOn: "2026-10-01T00:00:00Z", senderName: "MSRC" }),
  ];
  const v = buildView(cases, messages, [], STATE);
  const b = boardColumns(v.rows);
  it("puts open cases in their stage column, omitting empty New, and closed ones apart", () => {
    expect(b.columns.map((c) => [c.key, c.rows.map((r) => r.reportNumber)])).toEqual([
      ["review", ["VULN-3"]],
      ["develop", ["VULN-1", "VULN-2"]],
      ["prerelease", []],
    ]);
    expect(b.closed.map((r) => r.reportNumber)).toEqual(["VULN-4"]);
  });
});

describe("findPlacements", () => {
  const data = {
    year: 2026,
    leaderboards: [
      { bountyProgram: "ALL", period: "ANNUAL", year: 2026, leaderboardRanks: [{ rank: 1, displayName: "Someone" }, { rank: 2, displayName: "Jane Researcher (@janer)" }] },
      { bountyProgram: "EDGE_ON_CHROMIUM", period: "ANNUAL", year: 2026, leaderboardRanks: [{ rank: 1, displayName: "Jane" }] },
    ],
    honorableMentions: [{ year: 2026, researchers: [{ displayName: "Other" }, { displayName: "jane researcher" }] }],
    allTime: [{ year: 2026, quarter: 2, product: null, leaderboardRanks: [{ rank: 40, displayName: "janer" }] }],
  };
  it("matches the full acknowledgement name or handle, never a bare first name", () => {
    const p = findPlacements(data, "Jane Researcher (@janer)");
    expect(p.leaderboards).toEqual([{ program: "ALL", period: "ANNUAL", year: 2026, rank: 2, of: 2 }]);
    expect(p.honorableMentions).toEqual([2026]);
    expect(p.allTime).toEqual([{ year: 2026, quarter: 2, rank: 40, of: 1 }]);
  });
  it("finds nothing for an empty name", () => {
    expect(findPlacements(data, "").leaderboards).toEqual([]);
  });
});

describe("findPlacements with Zero Day Quest", () => {
  it("finds the researcher on an event leaderboard", () => {
    const data = { year: 2026, leaderboards: [], honorableMentions: [], allTime: [], events: [{ event: "ZDQ_LEADERBOARD2026", leaderboardRanks: [{ rank: 4, displayName: "Jane Researcher (@janer)" }] }] };
    expect(findPlacements(data, "Jane Researcher (@janer)").events).toEqual([{ event: "ZDQ_LEADERBOARD2026", rank: 4, of: 1 }]);
  });
});
