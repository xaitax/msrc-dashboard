import { describe, expect, it } from "vitest";
import { isGuid, isVulnId } from "../src/shared/ids";

describe("isVulnId", () => {
  it("accepts VULN- followed by digits", () => {
    expect(isVulnId("VULN-123456")).toBe(true);
  });
  it("rejects injection attempts and wrong case", () => {
    expect(isVulnId('VULN-1" }')).toBe(false);
    expect(isVulnId("vuln-1")).toBe(false);
    expect(isVulnId("VULN-")).toBe(false);
    expect(isVulnId(42 as unknown as string)).toBe(false);
  });
});

describe("isGuid", () => {
  it("accepts lower and upper case GUIDs", () => {
    expect(isGuid("1d13e529-99b8-48fe-a77d-844853ae25bf")).toBe(true);
    expect(isGuid("1D13E529-99B8-48FE-A77D-844853AE25BF")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isGuid("1d13e529-99b8-48fe-a77d-844853ae25b")).toBe(false);
    expect(isGuid("1d13e529-99b8-48fe-a77d-844853ae25bf/x")).toBe(false);
    expect(isGuid("")).toBe(false);
  });
});
