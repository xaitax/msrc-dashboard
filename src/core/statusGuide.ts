// MSRC's own explanation of where a case stands and what, if anything, the
// researcher should do. Texts are the portal's (ReportDetail status summaries),
// written as safe Markdown for the dashboard's renderer.

export const ACTION_REASON = "ADDITIONAL_INFORMATION_NEEDED";

export interface StatusGuide {
  /** MSRC is waiting for the researcher: the case is on hold until they reply. */
  urgent: boolean;
  summary: string;
  next: string | null;
}

const CVD = "[coordinated vulnerability disclosure](https://www.microsoft.com/en-us/msrc/cvd)";

const RECEIVED: StatusGuide = { urgent: false, summary: "Thank you for your submission.", next: "No action needed. We'll be in touch if we need more information." };
const REPRO: StatusGuide = {
  urgent: false,
  summary: "We're reproducing and evaluating the issue.",
  next: "No action needed. If you have additional information that might help reproduction, add it in the Activity feed.",
};
const DEVELOP: StatusGuide = {
  urgent: false,
  summary: `We're investigating the issue. We appreciate your patience and discretion.\n\nPlease respect ${CVD} and not report this publicly before we have notified you that this issue is fixed.`,
  next: "No action required. Watch the Activity feed for updates from our engineering team.",
};
const PRE_RELEASE: StatusGuide = {
  urgent: false,
  summary: "The fix will be included in an upcoming updated release.",
  next: `No action needed. Continue to respect ${CVD} until the release is published.`,
};

const GUIDES: Record<string, StatusGuide> = {
  [ACTION_REASON]: {
    urgent: true,
    summary: "We're missing some information from you and the case is on hold. Please check the Activity list to see what's missing. We'll restart the case when you reply.",
    next: "Reply in the Activity feed with the requested information to resume evaluation.",
  },
  DRAFT: { urgent: false, summary: "This case is in draft mode.", next: "Submit your draft to begin evaluation." },
  SUBMITTED: RECEIVED,
  NEW: RECEIVED,
  NEW_DUPLICATE: RECEIVED,
  REVIEW_REPRO: REPRO,
  REVIEW_REPRO_DUPLICATE: REPRO,
  DEVELOP,
  DEVELOP_DUPLICATE: DEVELOP,
  PRE_RELEASE,
  PRE_RELEASE_DUPLICATE: PRE_RELEASE,
  COMPLETE: { urgent: false, summary: "This case is closed. Review the Activity feed for details about the outcome.", next: null },
  COMPLETE_DUPLICATE: { urgent: false, summary: "This case is closed as a duplicate report. Review the Activity feed for details.", next: null },
  COMPLETE_NA: { urgent: false, summary: "This closed as a non-MSRC case.", next: null },
  COMPLETE_RESOLVED: { urgent: false, summary: "This case was closed.", next: null },
  CLOSED: {
    urgent: false,
    summary: "This case is out of scope for MSRC and we've closed it. Start a new conversation if you need more information.",
    next: "Review the closure reason in the Activity feed. If you believe this was in scope, you may start a new submission.",
  },
};

export const needsAction = (statusReason: string | null | undefined): boolean => statusReason === ACTION_REASON;

/** The portal's rule: the "information needed" reason overrides the status. */
export function statusGuide(status: string | null | undefined, statusReason: string | null | undefined): StatusGuide | null {
  const key = needsAction(statusReason) ? ACTION_REASON : status;
  return (key && GUIDES[key]) || null;
}
