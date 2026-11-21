import { describe, expect, it } from "vitest";
import { cvssRating, scoreCvss } from "../src/core/cvss";

describe("CVSS v3 vectors", () => {
  const local = "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H";

  it("scores both the base and temporal metrics from a report", () => {
    expect(scoreCvss(`${local}/E:U/RL:O/RC:C`)).toEqual({ base: 7.8, temporal: 6.8, environmental: null });
    expect(cvssRating(7.8)).toBe("High");
  });

  it("handles changed scope and ignores undefined optional metrics", () => {
    expect(scoreCvss("CVSS:3.0/S:C/AV:N/AC:L/PR:L/UI:N/C:H/I:H/A:H/E:X")).toEqual({
      base: 9.9, temporal: null, environmental: null,
    });
  });

  it("keeps an explicit zero, including when environmental metrics eliminate impact", () => {
    expect(scoreCvss(`${local}/MC:N/MI:N/MA:N`)).toEqual({ base: 7.8, temporal: null, environmental: 0 });
    expect(scoreCvss("CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:N")?.base).toBe(0);
  });

  it("rejects unsupported versions and incomplete, duplicate, or invalid metrics", () => {
    for (const malformed of [local.replace("3.1", "4.0"), "CVSS:3.1/AV:L", `${local}/AV:L`, `${local}/RL:B`]) {
      expect(scoreCvss(malformed)).toBeNull();
    }
  });
});
