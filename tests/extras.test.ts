import { describe, expect, it } from "vitest";
import { normalizeAllTime, profileSummary } from "../src/background/extras";

describe("normalizeAllTime", () => {
  it("maps the aliased 'name' field onto displayName", () => {
    expect(normalizeAllTime([{ year: 2026, quarter: 2, product: null, leaderboardRanks: [{ rank: 3, points: 10, name: "X" }] }])).toEqual([
      { year: 2026, quarter: 2, product: null, leaderboardRanks: [{ rank: 3, displayName: "X", points: 10 }] },
    ]);
  });
});

describe("profileSummary", () => {
  it("keeps what the Profile page shows and separates private details", () => {
    const p = profileSummary(
      {
        displayName: "Jane",
        givenName: "Jane",
        surname: "Researcher",
        primaryEmail: "a@example.com",
        addressCity: "Springfield",
        addressCountry: "DE",
        websiteList: ["https://example.com"],
        recognitionPreference: "PreferedNameForPublicRecognition",
        acknowledgement: { name: "Jane Researcher (@janer)", socialMediaUrl: "https://linkedin.example" },
        preferredPaymentProviderId: "secret-id",
      },
      [{ subscriptionTypeId: "NewMessage", deliveryMethod: "Email", digestType: "Immediate" }],
    );
    expect(p.publicName).toBe("Jane Researcher (@janer)");
    expect(p.name).toBe("Jane Researcher");
    expect(p.websites).toEqual(["https://example.com"]);
    expect(p.private).toEqual({ email: "a@example.com", location: "Springfield, DE" });
    expect(JSON.stringify(p)).not.toContain("secret-id");
    expect(p.subscriptions).toEqual([{ type: "NewMessage", delivery: "Email", digest: "Immediate" }]);
  });
});

describe("profileSummary → report defaults", () => {
  it("carries the default acknowledgement and the anonymous preference for new reports", () => {
    const p = profileSummary({ displayName: "A", anonymousSubmission: true, acknowledgement: { name: "A B", company: "Co", companyUrl: null, emailAddress: "a@x", socialMediaUrl: "https://s" } }, []);
    expect(p.reportDefaults).toEqual({ ack: { name: "A B", company: "Co", companyUrl: "", emailAddress: "a@x", socialMediaUrl: "https://s" }, anonymous: true });
    expect(profileSummary({ displayName: "A" }, []).reportDefaults).toEqual({ ack: null, anonymous: false });
  });
});

describe("profileSummary → payout", () => {
  it("names the bounty payout provider but drops its ids and payout e-mail", () => {
    const p = profileSummary({ displayName: "A", preferredPaymentProviderId: "pp-1" }, [], [{ id: "pp-1", paymentProcessor: "Intigriti", paymentId: "pay@example.com" }]);
    expect(p.payout).toBe("Intigriti");
    expect(JSON.stringify(p)).not.toContain("pay@example.com");
    expect(JSON.stringify(p)).not.toContain("pp-1");
    expect(profileSummary({ displayName: "A" }, []).payout).toBeNull();
  });
});
