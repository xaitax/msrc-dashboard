import { describe, expect, it } from "vitest";
import { boardColumns, sinceStrip } from "../src/dashboard/board";
import { findPlacements } from "../src/core/recognition";
import { buildView, groupFeed } from "../src/dashboard/data";
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
  it("provides the full list so the strip can fill its available columns", () => {
    const events = [1, 2, 3, 4, 5, 6, 7].map((i) => ev(`VULN-${i}`, `2026-11-0${i}T09:00`));
    const strip = sinceStrip(events);
    expect(strip.entries.map(({ event }) => event)).toEqual(events.slice().reverse());
    expect(strip.total).toBe(7);
  });

  it("keeps recent updates in the same order when they are marked seen", () => {
    const older = ev("VULN-1", "2026-11-01T09:00");
    const newer = ev("VULN-2", "2026-11-02T09:00", { seen: true });
    const events = [older, newer];
    const before = sinceStrip(events);
    const after = sinceStrip(events.map((event) => ({ ...event, seen: true })));
    expect(before.entries.map(({ event }) => event.key)).toEqual([newer.key, older.key]);
    expect(after.entries.map(({ event }) => event.key)).toEqual([newer.key, older.key]);
    expect(after.total).toBe(0);
  });

  it("reserves a single slot per case and keeps its unseen indicator", () => {
    const summary = "Bounty review started";
    const latest = ev("VULN-1", "2026-11-11T10:45:51", { summary, seen: true });
    const other = ev("VULN-2", "2026-11-11T10:45:37", { summary });
    const repeated = ev("VULN-1", "2026-11-11T10:45:15", { summary: "MSRC replied" });
    const earlier = ev("VULN-1", "2026-11-11T10:44:58", { summary: "Status changed" });
    const strip = sinceStrip([repeated, earlier, other, latest]);
    expect(strip.entries).toEqual([
      { event: latest, unseen: true },
      { event: other, unseen: true },
    ]);
    expect(strip.total).toBe(3);
  });

  it.each([
    { scenario: "a simultaneous flag arrives first", flagFirst: true, later: false },
    { scenario: "a simultaneous reply arrives first", flagFirst: false, later: false },
    { scenario: "the flag is one millisecond newer", flagFirst: false, later: true },
  ])("uses the same headline on the board and strip when $scenario", ({ flagFirst, later }) => {
    const at = "2026-11-11T10:45:00.000Z";
    const reply = ev("VULN-1", at, { summary: "MSRC replied", seen: true });
    const flag = ev("VULN-1", later ? "2026-11-11T10:45:00.001Z" : at, { type: "field_changed", field: "isFlagged", newValue: true });
    const events = flagFirst ? [flag, reply] : [reply, flag];
    const view = buildView([caseRec("VULN-1", null)], [], events, STATE);
    const selected = later ? flag : reply;
    expect(view.rows[0]!.lastChange?.key).toBe(selected.key);
    const [preview] = sinceStrip(view.events).entries;
    expect(preview?.event.key).toBe(selected.key);
    expect(preview?.unseen).toBe(true);
    const fullActivity = groupFeed(view.events, new Date(at), null)[0]!.events;
    expect(fullActivity.map((event) => event.key)).toEqual((later ? [flag, reply] : events).map((event) => event.key));
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

  it("sorts cases by their first Unicode tag, with untagged cases last", () => {
    const tagged = buildView(cases, messages, [], STATE, {}, [], {}, new Date(), [
      { reportNumber: "VULN-1", note: "", tags: ["Zeta Service"] },
      { reportNumber: "VULN-2", note: "", tags: ["Áudio"] },
    ]);
    const sorted = boardColumns(tagged.rows, "tag");
    expect(sorted.columns.find((c) => c.key === "develop")!.rows.map((r) => r.reportNumber)).toEqual(["VULN-2", "VULN-1"]);
    expect(sorted.closed[0]!.annotation.tags).toEqual([]);
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
