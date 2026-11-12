// One-line summaries for MSRC's templated milestone mails (topic
// "AutoNotification"). Templates observed on the live portal 2026-11-11.
// Returns null for free-form text; callers fall back to a generic label.
import { decodeEntities } from "./text";

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const RULES: Rule[] = [
  [/qualifies for a bounty award of (\$[\d,.]+)/i, (m) => `Bounty awarded: ${m[1]}`],
  [/(?:determine whether|to determine if) the submission qualifies for a bounty|reviewing your case\s*\d*\s*to determine whether .*bounty/i, () => "Bounty review started"],
  [/duplicate of (?:your previous |a previous |an earlier )?case\s*(\d{4,})/i, (m) => `Marked as duplicate of case ${m[1]}`],
  [/same underlying issue had already been reported|report is a duplicate/i, () => "Marked as duplicate (reported before)"],
  [/opened a case for this issue:?\s*MSRC Case\s*(\d+)/i, (m) => `Case ${m[1]} opened`],
  [/your report has been received/i, () => "Report received"],
  [
    /release the fix for .*? in our ([A-Z][a-z]+ \d{4}) Security Update Release on ([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?, \d{4})/i,
    (m) => `Fix planned: ${m[1]} release (${m[2]})`,
  ],
  [/does not meet Microsoft'?s (?:definition|bar)/i, () => "Does not meet the bar for servicing"],
  [/we confirmed the behaviou?r/i, () => "MSRC confirmed the behavior"],
];

export function summarizeMsrcMessage(body: string | null | undefined): string | null {
  const text = decodeEntities(body ?? "").replace(/\s+/g, " ");
  for (const [re, fmt] of RULES) {
    const m = text.match(re);
    if (m) return fmt(m);
  }
  return null;
}
