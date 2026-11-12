import { describe, expect, it } from "vitest";
import { caseClock, deadlineTag, quietTag, type ClockInput } from "../src/core/caseClock";

const NOW = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number, h = 0) => new Date(NOW.getTime() - n * 86_400_000 - h * 3_600_000).toISOString();

const input = (over: Partial<ClockInput> = {}): ClockInput => ({
  submittedAt: daysAgo(40),
  open: true,
  fixedPublicly: false,
  actionNeeded: false,
  msrcTimes: [],
  ownTimes: [],
  ...over,
});

describe("caseClock: the 90-day mark", () => {
  it("counts whole days since submission and dates the mark 90 days later", () => {
    const c = caseClock(input({ submittedAt: "2026-04-01T09:00:00Z" }), NOW);
    expect(c.deadline).toEqual({ day: 90, at: "2026-06-30T09:00:00.000Z", daysLeft: 0, state: "past" });
  });

  it("is running early on, soon within 14 days of the mark, past from day 90", () => {
    expect(caseClock(input({ submittedAt: daysAgo(75) }), NOW).deadline?.state).toBe("running");
    expect(caseClock(input({ submittedAt: daysAgo(76) }), NOW).deadline).toMatchObject({ day: 76, daysLeft: 14, state: "soon" });
    expect(caseClock(input({ submittedAt: daysAgo(89, 23) }), NOW).deadline).toMatchObject({ day: 89, daysLeft: 1, state: "soon" });
    expect(caseClock(input({ submittedAt: daysAgo(141) }), NOW).deadline).toMatchObject({ day: 141, daysLeft: -51, state: "past" });
  });

  it("stops once the case is closed or a public CVE is tied to it", () => {
    expect(caseClock(input({ submittedAt: daysAgo(100), open: false }), NOW).deadline).toBeNull();
    expect(caseClock(input({ submittedAt: daysAgo(100), fixedPublicly: true }), NOW).deadline).toBeNull();
  });

  it("has nothing to count without a valid submission date", () => {
    expect(caseClock(input({ submittedAt: null }), NOW).deadline).toBeNull();
    expect(caseClock(input({ submittedAt: "not a date" }), NOW).deadline).toBeNull();
  });
});

describe("caseClock: silence", () => {
  it("reports the newest MSRC activity and the researcher's newest message", () => {
    const c = caseClock(input({ msrcTimes: [daysAgo(30), daysAgo(5), "junk"], ownTimes: [daysAgo(9), daysAgo(2)] }), NOW);
    expect(c.lastMsrcAt).toBe(daysAgo(5));
    expect(c.lastOwnAt).toBe(daysAgo(2));
  });

  it("calls it silent since submission when MSRC's only activity was the day it arrived", () => {
    const c = caseClock(input({ submittedAt: daysAgo(83), msrcTimes: [daysAgo(83), daysAgo(82, 20)] }), NOW);
    expect(c.quiet).toEqual({ kind: "since-submission", days: 82, since: daysAgo(82, 20), unansweredSince: null });
  });

  it("counts from submission when MSRC never wrote", () => {
    expect(caseClock(input({ submittedAt: daysAgo(35) }), NOW).quiet).toMatchObject({ kind: "since-submission", days: 35 });
  });

  it("tells whether MSRC has done anything after the automatic receipt", () => {
    expect(caseClock(input({ submittedAt: daysAgo(10), msrcTimes: [daysAgo(10)] }), NOW)).toMatchObject({ onlyReceipt: true, open: true, submittedAt: daysAgo(10) });
    expect(caseClock(input({ submittedAt: daysAgo(10), msrcTimes: [daysAgo(10), daysAgo(7)] }), NOW).onlyReceipt).toBe(false);
    expect(caseClock(input({ submittedAt: daysAgo(10), msrcTimes: [] }), NOW).onlyReceipt).toBe(false);
  });

  it("calls it silent after 30 days without MSRC activity, not before", () => {
    expect(caseClock(input({ msrcTimes: [daysAgo(29)] }), NOW).quiet).toBeNull();
    expect(caseClock(input({ submittedAt: daysAgo(80), msrcTimes: [daysAgo(30)] }), NOW).quiet).toEqual({ kind: "silent", days: 30, since: daysAgo(30), unansweredSince: null });
  });

  it("notes an unanswered message from the researcher inside a long silence", () => {
    const c = caseClock(input({ submittedAt: daysAgo(140), msrcTimes: [daysAgo(131)], ownTimes: [daysAgo(24)] }), NOW);
    expect(c.quiet).toMatchObject({ kind: "silent", days: 131, unansweredSince: daysAgo(24) });
  });

  it("flags a message MSRC hasn't answered for 14 days, even when MSRC was active recently before it", () => {
    expect(caseClock(input({ msrcTimes: [daysAgo(20)], ownTimes: [daysAgo(13)] }), NOW).quiet).toBeNull();
    expect(caseClock(input({ msrcTimes: [daysAgo(20)], ownTimes: [daysAgo(14)] }), NOW).quiet).toEqual({ kind: "unanswered", days: 14, since: daysAgo(14), unansweredSince: daysAgo(14) });
  });

  it("doesn't count a message MSRC already answered", () => {
    expect(caseClock(input({ msrcTimes: [daysAgo(15)], ownTimes: [daysAgo(16)] }), NOW).quiet).toBeNull();
  });

  it("stays quiet about silence on closed cases and when MSRC is waiting on the researcher", () => {
    expect(caseClock(input({ submittedAt: daysAgo(100), open: false }), NOW).quiet).toBeNull();
    expect(caseClock(input({ submittedAt: daysAgo(100), actionNeeded: true }), NOW).quiet).toBeNull();
  });
});

describe("card tags", () => {
  it("names the day against the 90-day mark", () => {
    expect(deadlineTag({ day: 83, at: "", daysLeft: 7, state: "soon" })).toBe("Day 83 of 90");
    expect(deadlineTag({ day: 141, at: "", daysLeft: -51, state: "past" })).toBe("Day 141, past 90");
  });

  it("says how long MSRC has been silent", () => {
    expect(quietTag({ kind: "since-submission", days: 83, since: "", unansweredSince: null })).toBe("MSRC silent since submission");
    expect(quietTag({ kind: "silent", days: 45, since: "", unansweredSince: null })).toBe("MSRC silent for 45 days");
    expect(quietTag({ kind: "unanswered", days: 24, since: "", unansweredSince: "" })).toBe("No reply for 24 days");
  });
});
