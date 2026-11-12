// Bounty awards. MSRC has no totals anywhere (not in /me, not in the portal):
// the only data is per case, `bounty {amount, program, status}`. Labels follow
// the portal's own names (SubmitButton chunk), with an en dash.
import type { CaseRecord, RawObject, VulnId } from "../shared/types";
import { caseTitle, humanizeEnum } from "./derive";

export const BOUNTY_LABEL: Record<string, string> = {
  NONE: "None",
  PENDING_REVIEW: "Pending Review",
  AWARD_PENDING_REVIEWED: "Award Pending – Reviewed",
  AWARDED_REVIEWED: "Awarded – Reviewed",
  PAYMENT_INFO_NEEDED_REVIEWED: "Payment info needed – Reviewed",
  AWARDED_CLOSED: "Awarded – Closed",
  OUT_OF_SCOPE_REVIEWED: "Out of Scope – Reviewed",
  OUT_OF_SCOPE_CLOSED: "Out of Scope – Closed",
};

export function bountyLabel(status: string | null | undefined): string {
  if (!status) return "";
  return BOUNTY_LABEL[status] ?? humanizeEnum(status);
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
}

/** An award has been decided (amount set); paid once MSRC closes it. */
const AWARDED = new Set(["AWARD_PENDING_REVIEWED", "AWARDED_REVIEWED", "PAYMENT_INFO_NEEDED_REVIEWED", "AWARDED_CLOSED"]);
const PAID = "AWARDED_CLOSED";
const UNDER_REVIEW = "PENDING_REVIEW";

export interface AwardRow {
  reportNumber: VulnId;
  ticketNumber: string | null;
  title: string;
  amount: number | null;
  program: string | null;
  status: string;
}

export interface AwardSummary {
  total: number;
  paid: number;
  awarded: AwardRow[]; // largest first, then newest
  underReview: AwardRow[]; // newest first
}

type Dated = AwardRow & { at: number };

export function awardSummary(cases: CaseRecord[]): AwardSummary {
  const awarded: Dated[] = [];
  const underReview: Dated[] = [];
  for (const c of cases) {
    const b = c.detail?.["bounty"] as RawObject | null | undefined;
    const status = typeof b?.["status"] === "string" ? b["status"] : null;
    if (!b || !status) continue;
    const amount = typeof b["amount"] === "number" && Number.isFinite(b["amount"]) ? b["amount"] : null;
    const row: Dated = {
      reportNumber: c.reportNumber,
      ticketNumber: c.list.ticketNumber,
      title: caseTitle(c),
      amount,
      program: typeof b["program"] === "string" && b["program"] ? b["program"] : null,
      status,
      at: Date.parse(c.list.createdOn ?? "") || 0,
    };
    if (AWARDED.has(status) && amount !== null && amount > 0) awarded.push(row);
    else if (status === UNDER_REVIEW) underReview.push(row);
  }
  awarded.sort((a, b) => b.amount! - a.amount! || b.at - a.at);
  underReview.sort((a, b) => b.at - a.at);
  const strip = ({ at: _at, ...r }: Dated): AwardRow => r;
  return {
    total: awarded.reduce((s, r) => s + r.amount!, 0),
    paid: awarded.filter((r) => r.status === PAID).reduce((s, r) => s + r.amount!, 0),
    awarded: awarded.map(strip),
    underReview: underReview.map(strip),
  };
}

const PAYOUT_LABEL: Record<string, string> = {
  Intigriti: "Intigriti",
  Bugcrowd: "Bugcrowd",
  HackerOne: "HackerOne",
  MicrosoftPaymentCentral: "Microsoft Payment Central",
};

/** The profile's preferred payout provider by name. The payout e-mail
 *  (`paymentId`) and the ids never leave this function. */
export function payoutProvider(me: RawObject, providers: RawObject[]): string | null {
  const id = me["preferredPaymentProviderId"];
  if (typeof id !== "string" || !id) return null;
  const proc = providers.find((x) => x["id"] === id)?.["paymentProcessor"];
  if (typeof proc !== "string" || !proc) return null;
  return PAYOUT_LABEL[proc] ?? (/^[A-Za-z]+$/.test(proc) ? proc : null);
}
