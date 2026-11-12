import { describe, expect, it } from "vitest";
import { bannerMarkdown, parseAppSettings, parseEnvironments, parseFlagDescriptions } from "../src/core/portalConfig";

// Synthetic, shaped like the portal's public /config/appsettings.json.
const SETTINGS = {
  "AzureOpenAI:CategoryToggles:Other": true,
  "AzureOpenAI:CategoryToggles:[VRR NCR] Piracy (Close)": true,
  "AzureOpenAI:CategoryToggles:[Tier 1] Malware/Virus Submission (Close)": false,
  "AzureOpenAI:ConfidenceThreshold": 0.65,
  "AzureOpenAI:DeploymentName": "model-x",
  "AzureOpenAI:ReasoningEffort": "low",
  "AzureOpenAI:Endpoints:0": "https://one.example.com/",
  "AzureOpenAI:Endpoints:1": "https://two.example.com/",
  "frontend:RP_SystemAlert_Show": "true",
  "frontend:RP_SystemAlert_Level": "warning",
  "frontend:RP_SystemAlert_Content": "Reports are now assessed as Complete or Not Complete.",
  "frontend:RP_SystemAlert_LinkText": "Read more",
  "frontend:RP_SystemAlert_LinkUrl": "https://aka.ms/example",
  "frontend:RP_SiteBanners": JSON.stringify([
    { id: "a", level: "info", content: "Live now", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
    { id: "b", content: "Ended", endsAt: "2026-11-02T00:00:00Z" },
    { id: "c", content: "Not yet", startsAt: "2026-12-24T00:00:00Z" },
    { id: "d", content: "Second" },
    { id: "e", content: "Third" },
    { id: "f", content: "Fourth, over the limit of three" },
  ]),
  "frontend:RP_Notifications": "true",
  "frontend:RP_Notifications_BlacklistIDs": "",
  "frontend:RP_Notifications_Rollout": "100",
  "frontend:RP_QualityGates_Roles": "msrc:aaaa,msrc:bbbb",
  "frontend:SUG_ActivelyExploitedCves": '["CVE-2026-1111"]',
  feature_management: { feature_flags: [{ id: "RP_AutoQualityGateOnSubmit", enabled: true }, { id: "RP_AutoAnalyzeSubmissions", enabled: false }] },
};
const NOW = new Date("2026-11-12T12:00:00Z");

describe("the portal's public settings", () => {
  const info = parseAppSettings(SETTINGS, NOW);

  it("reads the system alert, with its link only when it is https", () => {
    expect(info.alert).toEqual({ level: "warning", content: "Reports are now assessed as Complete or Not Complete.", linkText: "Read more", linkUrl: "https://aka.ms/example" });
    expect(parseAppSettings({ ...SETTINGS, "frontend:RP_SystemAlert_Show": "false" }, NOW).alert).toBeNull();
    expect(parseAppSettings({ ...SETTINGS, "frontend:RP_SystemAlert_LinkUrl": "javascript:alert(1)" }, NOW).alert!.linkUrl).toBeNull();
  });

  it("shows the banners that are live now, at most three", () => {
    expect(info.banners.map((b) => b.id)).toEqual(["a", "d", "e"]);
    expect(info.banners[1]).toEqual({ id: "d", level: "info", content: "Second" });
    expect(parseAppSettings({ ...SETTINGS, "frontend:RP_SiteBanners": "not json" }, NOW).banners).toEqual([]);
  });

  it("describes MSRC's AI pre-screening", () => {
    expect(info.classifier).toEqual({
      model: "model-x",
      reasoningEffort: "low",
      confidenceThreshold: 0.65,
      endpoints: ["https://one.example.com/", "https://two.example.com/"],
      categories: [
        { name: "[Tier 1] Malware/Virus Submission (Close)", enabled: false, closes: true },
        { name: "[VRR NCR] Piracy (Close)", enabled: true, closes: true },
        { name: "Other", enabled: true, closes: false },
      ],
    });
  });

  it("lists the portal's feature flags, with role lists counted but never shown", () => {
    expect(info.flags).toEqual([
      { key: "Notifications", value: "true" },
      { key: "Notifications_BlacklistIDs", value: "none" },
      { key: "Notifications_Rollout", value: "100" },
      { key: "QualityGates_Roles", value: "2 entries" },
      { key: "SiteBanners", value: "6 entries" },
      { key: "SystemAlert_Content", value: "set" },
      { key: "SystemAlert_Level", value: "warning" },
      { key: "SystemAlert_LinkText", value: "set" },
      { key: "SystemAlert_LinkUrl", value: "set" },
      { key: "SystemAlert_Show", value: "true" },
    ]);
    expect(info.exploited).toEqual(["CVE-2026-1111"]);
    expect(parseAppSettings({ "frontend:RP_X_Roles": "msrc:a" }, NOW).flags).toEqual([{ key: "X_Roles", value: "1 entry" }]);
  });

  it("lists the server-side switches, also when they arrive as a JSON string", () => {
    const expected = [
      { id: "RP_AutoAnalyzeSubmissions", enabled: false },
      { id: "RP_AutoQualityGateOnSubmit", enabled: true },
    ];
    expect(info.serverFlags).toEqual(expected);
    expect(parseAppSettings({ ...SETTINGS, feature_management: JSON.stringify(SETTINGS.feature_management) }, NOW).serverFlags).toEqual(expected);
    expect(parseAppSettings({}, NOW)).toMatchObject({ alert: null, banners: [], classifier: null, flags: [], serverFlags: [], exploited: [] });
  });
});

describe("the portal bundle", () => {
  const BUNDLE =
    'x,No={apiRoot:`https://api.test.example.com`,scopes:[`openid`],clientId:`11111111-1111-1111-1111-111111111111`,authority:`https://login.example.com/B2C_1A_TEST_POLICY`,b2cSignInPolicy:`B2C_1A_TEST_POLICY`,applicationInsightsKey:`22222222-2222-2222-2222-222222222222`,emailCaseSupport:`test@example.com`},' +
    'Fo={apiRoot:`https://dev.example.net`,scopes:[`openid`],clientId:`33333333-3333-3333-3333-333333333333`,authority:`https://login.example.com/B2C_1A_Dev_Policy`},' +
    'Ov=new Set([`api.test.example.com`,`api-corp.example.com`]),y';

  it("lists the environments it was built for", () => {
    expect(parseEnvironments(BUNDLE)).toEqual({
      environments: [
        { apiRoot: "https://api.test.example.com", clientId: "11111111-1111-1111-1111-111111111111", signInPolicy: "B2C_1A_TEST_POLICY", insightsKey: "22222222-2222-2222-2222-222222222222", supportEmail: "test@example.com" },
        { apiRoot: "https://dev.example.net", clientId: "33333333-3333-3333-3333-333333333333", signInPolicy: "B2C_1A_Dev_Policy", insightsKey: null, supportEmail: null },
      ],
      apiHosts: ["api.test.example.com", "api-corp.example.com"],
    });
    expect(parseEnvironments("nothing here")).toEqual({ environments: [], apiHosts: [] });
  });

  it("reads the feature flag descriptions", () => {
    const chunk = 'a={NOTIFICATIONS:i(`Notifications`),QUALITY_GATES:i(`QualityGates`)};n({key:a.NOTIFICATIONS,label:`Notifications`,description:`Enables the bell.`,type:t.Boolean}),n({key:a.QUALITY_GATES,label:`Quality Gates - Master`,description:`Master switch.`,type:t.Boolean})';
    expect(parseFlagDescriptions(chunk)).toEqual({
      Notifications: { label: "Notifications", description: "Enables the bell." },
      QualityGates: { label: "Quality Gates - Master", description: "Master switch." },
    });
  });
});

describe("a case banner from MSRC", () => {
  it("keeps https links as Markdown and drops every other tag", () => {
    expect(bannerMarkdown('We\'re working on a fix. See <a href="https://example.com/x" target="_blank">What to expect</a>.')).toBe("We're working on a fix. See [What to expect](https://example.com/x).");
    expect(bannerMarkdown('<b>Bold</b> and <a href="javascript:x">bad</a> &amp; done')).toBe("Bold and bad & done");
  });
});
