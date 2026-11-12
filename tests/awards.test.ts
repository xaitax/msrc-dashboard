import { describe, expect, it } from "vitest";
import { awardSummary, bountyLabel, formatUsd, payoutProvider } from "../src/core/awards";
import { caseRec } from "./helpers";

const c = (rn: string, ticket: string, bounty: Record<string, unknown> | null, createdOn = "2026-08-01T00:00:00Z", title = "T &amp; more") =>
  caseRec(rn, { bounty, title }, { list: { ticketNumber: ticket, createdOn, title } });

describe("award totals", () => {
  it("sums only awarded statuses with an amount, paid = Awarded – Closed", () => {
    const s = awardSummary([
      c("VULN-1", "100140", { status: "AWARDED_REVIEWED", amount: 4000, program: "Example Bounty Program" }, "2026-08-24T00:00:00Z"),
      c("VULN-2", "100002", { status: "AWARDED_CLOSED", amount: 3000, program: "Windows" }, "2026-03-01T00:00:00Z"),
      c("VULN-3", "100003", { status: "AWARD_PENDING_REVIEWED", amount: 4000, program: "Windows" }, "2026-09-01T00:00:00Z"),
      c("VULN-4", "100004", { status: "PAYMENT_INFO_NEEDED_REVIEWED", amount: 1000, program: null }),
      c("VULN-5", "100135", { status: "PENDING_REVIEW", amount: null, program: null }, "2026-08-13T00:00:00Z"),
      c("VULN-6", "100006", { status: "OUT_OF_SCOPE_CLOSED", amount: 0, program: null }),
      c("VULN-7", "100007", { status: "AWARDED_REVIEWED", amount: null, program: null }), // no amount yet
      c("VULN-8", "100008", null),
      c("VULN-9", "100009", { status: "SOMETHING_NEW", amount: 99, program: null }),
    ]);
    expect(s.total).toBe(12000);
    expect(s.paid).toBe(3000);
    // largest first, then newest
    expect(s.awarded.map((r) => r.ticketNumber)).toEqual(["100003", "100140", "100002", "100004"]);
    expect(s.awarded[1]).toEqual({ reportNumber: "VULN-1", ticketNumber: "100140", title: "T & more", amount: 4000, program: "Example Bounty Program", status: "AWARDED_REVIEWED" });
    expect(s.underReview.map((r) => r.ticketNumber)).toEqual(["100135"]);
  });

  it("is empty without bounties", () => {
    expect(awardSummary([c("VULN-1", "1", null)])).toEqual({ total: 0, paid: 0, awarded: [], underReview: [] });
  });

  it("labels bounty states the way the portal names them", () => {
    expect(bountyLabel("AWARDED_REVIEWED")).toBe("Awarded – Reviewed");
    expect(bountyLabel("AWARD_PENDING_REVIEWED")).toBe("Award Pending – Reviewed");
    expect(bountyLabel("PAYMENT_INFO_NEEDED_REVIEWED")).toBe("Payment info needed – Reviewed");
    expect(bountyLabel("PENDING_REVIEW")).toBe("Pending Review");
    expect(bountyLabel("BRAND_NEW_STATE")).toBe("Brand New State");
    expect(bountyLabel(null)).toBe("");
  });

  it("formats dollars without cents unless there are some", () => {
    expect(formatUsd(4000)).toBe("$4,000");
    expect(formatUsd(22000)).toBe("$22,000");
    expect(formatUsd(1500.5)).toBe("$1,500.50");
  });
});

describe("payout provider", () => {
  const providers = [
    { id: "p-1", paymentProcessor: "Intigriti", paymentId: "payout@example.com" },
    { id: "p-2", paymentProcessor: "HackerOne", paymentId: "other@example.com" },
  ];
  it("names the profile's preferred provider, never the payout address", () => {
    expect(payoutProvider({ preferredPaymentProviderId: "p-1" }, providers)).toBe("Intigriti");
    expect(payoutProvider({ preferredPaymentProviderId: "p-2" }, providers)).toBe("HackerOne");
    expect(payoutProvider({ preferredPaymentProviderId: "x" }, [{ id: "x", paymentProcessor: "MicrosoftPaymentCentral" }])).toBe("Microsoft Payment Central");
  });
  it("is null when nothing matches", () => {
    expect(payoutProvider({ preferredPaymentProviderId: "nope" }, providers)).toBeNull();
    expect(payoutProvider({}, providers)).toBeNull();
    expect(payoutProvider({ preferredPaymentProviderId: "p-1" }, [])).toBeNull();
  });
});
