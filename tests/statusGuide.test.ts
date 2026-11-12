import { describe, expect, it } from "vitest";
import { needsAction, statusGuide } from "../src/core/statusGuide";

describe("MSRC's own explanation of a case's state", () => {
  it("'additional information needed' is the one state where MSRC waits for you", () => {
    expect(needsAction("ADDITIONAL_INFORMATION_NEEDED")).toBe(true);
    expect(needsAction("NONE")).toBe(false);
    expect(needsAction(null)).toBe(false);
    const g = statusGuide("REVIEW_REPRO", "ADDITIONAL_INFORMATION_NEEDED")!;
    expect(g.urgent).toBe(true);
    expect(g.summary).toMatch(/missing some information from you/);
    expect(g.next).toMatch(/^Reply in the Activity feed/);
  });

  it("explains each pipeline stage in MSRC's words, duplicates included", () => {
    expect(statusGuide("NEW", null)!.summary).toBe("Thank you for your submission.");
    expect(statusGuide("REVIEW_REPRO_DUPLICATE", null)!.summary).toBe("We're reproducing and evaluating the issue.");
    const develop = statusGuide("DEVELOP", "NONE")!;
    expect(develop.summary).toContain("[coordinated vulnerability disclosure](https://www.microsoft.com/en-us/msrc/cvd)");
    expect(develop.next).toBe("No action required. Watch the Activity feed for updates from our engineering team.");
    expect(statusGuide("PRE_RELEASE", null)!.summary).toBe("The fix will be included in an upcoming updated release.");
    expect(statusGuide("COMPLETE", null)!.summary).toMatch(/^This case is closed\./);
    expect(statusGuide("COMPLETE_DUPLICATE", null)!.summary).toMatch(/closed as a duplicate/);
    expect(statusGuide("COMPLETE_NA", null)!.summary).toBe("This closed as a non-MSRC case.");
    expect(statusGuide("CLOSED", null)!.summary).toMatch(/out of scope/);
  });

  it("has nothing to say about unknown or missing statuses", () => {
    expect(statusGuide("SOMETHING_NEW", null)).toBeNull();
    expect(statusGuide(null, null)).toBeNull();
    expect(statusGuide("PLANNING", null)).toBeNull();
  });
});
