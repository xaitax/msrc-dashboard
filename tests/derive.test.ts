import { describe, expect, it } from "vitest";
import { humanizeEnum, isClosed } from "../src/core/derive";


describe("isClosed", () => {
  it("treats the COMPLETE family as closed", () => {
    for (const s of ["COMPLETE", "COMPLETE_RESOLVED", "COMPLETE_NA", "COMPLETE_DUPLICATE"]) expect(isClosed(s)).toBe(true);
  });
  it("treats everything else as open", () => {
    for (const s of ["NEW", "REVIEW_REPRO", "DEVELOP_DUPLICATE", "PRE_RELEASE", "DRAFT", null]) expect(isClosed(s)).toBe(false);
  });
});

describe("humanizeEnum", () => {
  it("formats stage and reason", () => {
    expect(humanizeEnum("COMPLETE_DUPLICATE")).toBe("Complete · Duplicate");
    expect(humanizeEnum("REVIEW_REPRO")).toBe("Review / Repro");
    expect(humanizeEnum("REVIEW_REPRO_DUPLICATE")).toBe("Review / Repro · Duplicate");
    expect(humanizeEnum("PRE_RELEASE")).toBe("Pre-release");
    expect(humanizeEnum("COMPLETE_NA")).toBe("Complete · N/A");
  });
  it("keeps short connecting words lower-case", () => {
    expect(humanizeEnum("ELEVATION_OF_PRIVILEGE")).toBe("Elevation of Privilege");
    expect(humanizeEnum("SECURITY_FEATURE_BYPASS")).toBe("Security Feature Bypass");
  });
  it("title-cases unknown values and handles empty", () => {
    expect(humanizeEnum("SOME_NEW_THING")).toBe("Some New Thing");
    expect(humanizeEnum(null)).toBe("");
  });
});
