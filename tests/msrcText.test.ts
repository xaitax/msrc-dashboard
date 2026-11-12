import { describe, expect, it } from "vitest";
import { summarizeMsrcMessage } from "../src/core/msrcText";

// Synthetic texts modelled on MSRC's templates (no real case content).
describe("summarizeMsrcMessage", () => {
  const cases: [string, string][] = [
    ["Hi R, Here's an update on your case: MSRC Case&nbsp;100001 We confirmed the behavior you reported. We'll continue our investigation.", "MSRC confirmed the behavior"],
    ["Hello, Thanks for your submission. We are reviewing your case&nbsp;100001 to determine whether the submission qualifies for a bounty award under the Microsoft Bounty Programs.", "Bounty review started"],
    ["Hello, After investigation, we determined that this report is a duplicate of your previous case 100002. Both share the same root cause.", "Marked as duplicate of case 100002"],
    ["Hello, After review, we determined that the same underlying issue had already been reported by another researcher.", "Marked as duplicate (reported before)"],
    ["Thank you for contacting MSRC. I've opened a case for this issue: MSRC Case&nbsp;100001 Please only respond using the researcher portal.", "Case 100001 opened"],
    ["Hello, Thank you for contacting the Microsoft Security Response Center (MSRC).&nbsp; Your report has been received, and you should receive a follow-up message.", "Report received"],
    ["Hi R, We are planning to release the fix for MSRC case&nbsp;100001&nbsp; in our October 2026 Security Update Release on October 13th, 2026 at 10:00 am Pacific.", "Fix planned: October 2026 release (October 13th, 2026)"],
    ["Hello, After careful review, this case does not meet Microsoft's definition of a security vulnerability for servicing.", "Does not meet the bar for servicing"],
    ["Hello, After careful investigation, this case does not meet Microsoft's bar for immediate servicing. Our engineers shared the following:", "Does not meet the bar for servicing"],
    ["Hello, Congratulations! Your report qualifies for a bounty award of $5,000 under the Windows Insider Preview Bounty.", "Bounty awarded: $5,000"],
  ];
  for (const [text, expected] of cases) {
    it(`recognises: ${expected}`, () => expect(summarizeMsrcMessage(text)).toBe(expected));
  }
  it("returns null for free-form messages", () => {
    expect(summarizeMsrcMessage("Hi, could you share the build number you tested on?")).toBeNull();
  });
});
