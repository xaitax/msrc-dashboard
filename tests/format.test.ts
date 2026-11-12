import { describe, expect, it } from "vitest";
import { sessionLine, shortWhen } from "../src/dashboard/format";

const NOW = new Date("2026-11-11T15:00:00");
const local = (s: string) => new Date(s).toISOString();

describe("shortWhen (card dates)", () => {
  it("shows only the time for today", () => {
    expect(shortWhen(local("2026-11-11T09:05:00"), NOW)).toMatch(/^\d{1,2}:\d{2}/);
  });
  it("says Yesterday for yesterday", () => {
    expect(shortWhen(local("2026-11-10T20:00:00"), NOW)).toBe("Yesterday");
  });
  it("shows day and month otherwise, never a weekday or time", () => {
    const s = shortWhen(local("2026-11-05T20:44:00"), NOW);
    expect(s).toMatch(/5/);
    expect(s).toMatch(/Nov/);
    expect(s).not.toMatch(/:|Thu/);
  });
  it("adds the year for other years", () => {
    expect(shortWhen(local("2025-03-02T10:00:00"), NOW)).toMatch(/2025/);
  });
  it("handles missing dates", () => {
    expect(shortWhen(null, NOW)).toBe("—");
  });
});

describe("sessionLine (header tooltip)", () => {
  it("says since when you're signed in and how long the previous session lasted", () => {
    const started = new Date("2026-11-11T09:10:00").getTime();
    expect(sessionLine({ sessionStartedAt: started, lastSessionLengthMs: 23 * 3_600_000 })).toMatch(/^Signed in since .*09:10.*\. The previous session lasted 23 h\.$/);
    expect(sessionLine({ sessionStartedAt: started, lastSessionLengthMs: 40 * 60_000 })).toMatch(/The previous session lasted 40 min\.$/);
    expect(sessionLine({ sessionStartedAt: started, lastSessionLengthMs: 3 * 86_400_000 })).toMatch(/The previous session lasted 3 days\.$/);
    expect(sessionLine({ sessionStartedAt: started, lastSessionLengthMs: null })).toMatch(/^Signed in since .*09:10.*\.$/);
    expect(sessionLine({ sessionStartedAt: null, lastSessionLengthMs: 5 })).toBe("");
  });
});
