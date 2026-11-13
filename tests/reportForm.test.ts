import { describe, expect, it } from "vitest";
import {
  ackFromProfile,
  emptyForm,
  fromReport,
  needsCanary,
  normalizeCwe,
  productGroups,
  requirements,
  scenarioOptions,
  toReportInput,
  validate,
  type ReportForm,
} from "../src/core/reportForm";

const fields = (form: ReportForm, mode: "save" | "submit") => validate(form, mode).map((i) => i.field);

function complete(): ReportForm {
  const f = emptyForm();
  f.title = "EoP in ExampleService";
  f.securityImpact = "ELEVATION_OF_PRIVILEGE";
  f.targets = [{ product: "WINDOWS", productVersion: "26100", componentName: "broker.exe", componentVersion: "1.0", componentLocation: "C:\\x", componentRepository: "" }];
  f.attackScenario = "LOCAL_L1";
  f.devChannelRepro = "YES";
  f.description = "A".repeat(60);
  f.reproductionSteps = "1. Run the PoC as a standard user.";
  f.acknowledgements = [{ name: "Researcher", company: "", companyUrl: "", emailAddress: "", socialMediaUrl: "" }];
  return f;
}

describe("toReportInput", () => {
  it("sends every field, portal-shaped, with nulls for empty values", () => {
    const f = complete();
    f.cwes = ["416", " cwe-20 ", ""];
    f.links = [{ title: "Writeup", type: "WEB", url: "https://example.com/a" }];
    f.plansDisclosure = true;
    f.disclosures = [{ name: "My blog", medium: "BLOG", date: "2027-01-15" }];
    expect(toReportInput(f)).toEqual({
      title: "EoP in ExampleService",
      description: "A".repeat(60),
      reproductionSteps: "1. Run the PoC as a standard user.",
      callstack: null,
      securityImpact: "ELEVATION_OF_PRIVILEGE",
      aiSafetyImpact: null,
      aiConversationId: null,
      targetList: [{ product: "WINDOWS", productVersion: "26100", componentName: "broker.exe", componentVersion: "1.0", componentLocation: "C:\\x", componentRepository: null }],
      attackScenario: "LOCAL_L1",
      devChannelRepro: "YES",
      hasCrossTenantImpact: null,
      cweList: ["CWE-416", "CWE-20"],
      cvssVectorString: null,
      linkList: [{ title: "Writeup", type: "WEB", url: "https://example.com/a" }],
      externalId: null,
      isPublic: null,
      isExploited: null,
      isExploitedDiscovery: null,
      isExploitedScale: null,
      isMissedFix: null,
      variantOrRelatedCVE: null,
      variantCaseOrSubmission: null,
      acknowledgements: [{ name: "Researcher", company: "", companyUrl: "", emailAddress: "", socialMediaUrl: "" }],
      anonymousSubmission: false,
      disclosureEventList: [{ name: "My blog", medium: "BLOG", date: "2027-01-15T00:00:00Z" }],
    });
  });

  it("drops empty product, link and disclosure rows, and disclosures when not planned", () => {
    const f = complete();
    f.targets.push({ product: "", productVersion: "", componentName: "", componentVersion: "", componentLocation: "", componentRepository: "" });
    f.links = [{ title: "", type: "", url: "" }];
    f.plansDisclosure = false;
    f.disclosures = [{ name: "kept in the form only", medium: "BLOG", date: "" }];
    const p = toReportInput(f);
    expect(p.targetList).toHaveLength(1);
    expect(p.linkList).toEqual([]);
    expect(p.disclosureEventList).toEqual([]);
  });

  it("sends active exploitation details and enforces the portal's length limit", () => {
    const f = complete();
    f.isExploited = true;
    f.isExploitedDiscovery = "Found in telemetry";
    f.isExploitedScale = "Several customers";
    expect(toReportInput(f)).toMatchObject({ isExploitedDiscovery: "Found in telemetry", isExploitedScale: "Several customers" });
    f.isExploitedScale = "x".repeat(1001);
    expect(fields(f, "save")).toContain("isExploitedScale");
    f.isExploited = false;
    expect(toReportInput(f)).toMatchObject({ isExploitedDiscovery: null, isExploitedScale: null });
  });

  it("sends no acknowledgements for an anonymous submission", () => {
    const f = complete();
    f.anonymousSubmission = true;
    expect(toReportInput(f)).toMatchObject({ anonymousSubmission: true, acknowledgements: [] });
  });

  it("omits the attack scenario and canary answer when no product asks for them", () => {
    const f = complete();
    f.targets[0]!.product = "OFFICE";
    const p = toReportInput(f);
    expect(p.attackScenario).toBeNull();
    expect(p.devChannelRepro).toBeNull();
  });
});

describe("fromReport", () => {
  it("round-trips a stored draft without losing anything", () => {
    const f = complete();
    f.callstack = "ntdll!Foo+0x10";
    f.cwes = ["CWE-416"];
    f.cvssVectorString = "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H";
    f.links = [{ title: "t", type: "ARTICLE", url: "https://example.com" }];
    f.isPublic = false;
    f.isExploited = false;
    f.isMissedFix = true;
    f.variantOrRelatedCVE = "CVE-2026-12345";
    f.variantCaseOrSubmission = "VULN-123456";
    f.externalId = "EXT-1";
    f.hasCrossTenantImpact = "NO";
    f.plansDisclosure = true;
    f.disclosures = [{ name: "Blog", medium: "BLOG", date: "2027-01-15" }];
    const stored = { ...toReportInput(f), disclosureEventList: [{ id: "x", status: "ACTIVE", name: "Blog", medium: "BLOG", date: "2027-01-15T00:00:00Z" }] };
    expect(fromReport(stored)).toEqual(f);
  });

  it("copes with nulls, lower-case media and missing lists", () => {
    const f = fromReport({ title: "T", targetList: null, disclosureEventList: [{ name: "b", medium: "blog", date: null }], acknowledgements: null });
    expect(f.targets).toHaveLength(1); // one empty row to fill in
    expect(f.disclosures).toEqual([{ name: "b", medium: "BLOG", date: "" }]);
    expect(f.plansDisclosure).toBe(true);
    expect(f.acknowledgements).toEqual([]);
  });
});

describe("validate", () => {
  it("a complete report has no issues", () => {
    expect(validate(complete(), "submit")).toEqual([]);
  });

  it("saving a draft needs only a title", () => {
    const f = emptyForm();
    expect(fields(f, "save")).toEqual(["title"]);
    f.title = "x";
    expect(fields(f, "save")).toEqual([]);
  });

  it("uses the portal's 200-character title limit", () => {
    const f = complete();
    f.title = "x".repeat(201);
    expect(fields(f, "save")).toEqual(["title"]);
  });

  it("submitting enforces the portal's rules", () => {
    expect(fields(emptyForm(), "submit")).toEqual(["title", "securityImpact", "targets", "description", "reproductionSteps", "acknowledgements"]);
    const f = complete();
    f.description = "too short";
    f.reproductionSteps = "short";
    expect(fields(f, "submit")).toEqual(["description", "reproductionSteps"]);
  });

  it("Windows needs an attack scenario and the Canary answer", () => {
    const f = complete();
    f.attackScenario = "";
    f.devChannelRepro = "";
    expect(fields(f, "submit")).toEqual(["attackScenario", "devChannelRepro"]);
  });

  it("AI harm needs a category; anonymous needs no acknowledgement", () => {
    const f = complete();
    f.securityImpact = "AI_DERIVED_HARM";
    f.acknowledgements = [];
    f.anonymousSubmission = true;
    expect(fields(f, "submit")).toEqual(["aiSafetyImpact"]);
  });

  it("checks formats even when only saving", () => {
    const f = complete();
    f.cwes = ["CWE-abc"];
    f.cvssVectorString = "nonsense";
    f.links = [{ title: "x", type: "WEB", url: "javascript:alert(1)" }];
    f.isMissedFix = true; // the CVE field only exists (and is only sent) for a missed fix / variant
    f.variantCaseOrSubmission = "VULN-1";
    f.variantOrRelatedCVE = "2026-1";
    expect(fields(f, "save")).toEqual(["cwes", "cvssVectorString", "links", "variantOrRelatedCVE"]);
  });

  it("a missed fix or variant needs the existing case", () => {
    const f = complete();
    f.isMissedFix = true;
    expect(fields(f, "submit")).toEqual(["variantCaseOrSubmission"]);
    f.variantCaseOrSubmission = "VULN-1";
    expect(fields(f, "submit")).toEqual([]);
  });
});

describe("catalog helpers", () => {
  it("normalizes CWE input", () => {
    expect(normalizeCwe(" 416 ")).toBe("CWE-416");
    expect(normalizeCwe("cwe-20")).toBe("CWE-20");
    expect(normalizeCwe("")).toBe("");
  });

  it("scenario list follows the first product that has one", () => {
    const f = complete();
    expect(scenarioOptions(f)!.map((o) => o.value)).toContain("LOCAL_L1");
    f.targets = [{ ...f.targets[0]!, product: "OFFICE" }, { ...f.targets[0]!, product: "TEAMS_MOBILE" }];
    expect(scenarioOptions(f)!.map((o) => o.value)).toEqual(["REMOTE_CODE_EXECUTION_TEAMS_MOBILE", "AUTHENTICATION_CREDENTIALS_TEAMS_MOBILE"]);
    f.targets = [{ ...f.targets[0]!, product: "OFFICE" }];
    expect(scenarioOptions(f)).toBeNull();
    expect(needsCanary(f)).toBe(false);
  });

  it("groups products the way the portal does", () => {
    const groups = productGroups();
    const identity = groups.find((g) => g.label === "Identity")!;
    expect(identity.options.map((o) => o.value)).not.toContain("IDENTITY"); // header only
    expect(identity.options.map((o) => o.label)).toContain("MSA");
    const azure = groups.find((g) => g.label === "Azure")!;
    expect(azure.options.map((o) => o.value)).toEqual(["AZURE", "AZURE_DEV_OPS"]);
    expect(groups.find((g) => g.label === "Windows")!.options.map((o) => o.value)).toEqual(["WINDOWS"]);
  });

  it("takes the default acknowledgement from the profile", () => {
    expect(ackFromProfile({ acknowledgement: { name: "A", company: null, companyUrl: "", emailAddress: "a@x", socialMediaUrl: "https://s" } })).toEqual({ name: "A", company: "", companyUrl: "", emailAddress: "a@x", socialMediaUrl: "https://s" });
    expect(ackFromProfile({ acknowledgement: null })).toBeNull();
    expect(ackFromProfile(null)).toBeNull();
  });
});

describe("requirements (the submit checklist)", () => {
  it("lists what MSRC needs, in form order", () => {
    expect(requirements(emptyForm()).map((r) => [r.field, r.done])).toEqual([
      ["title", false],
      ["securityImpact", false],
      ["targets", false],
      ["description", false],
      ["reproductionSteps", false],
      ["acknowledgements", false],
    ]);
    const c = complete();
    expect(requirements(c).map((r) => r.field)).toEqual(["title", "securityImpact", "targets", "attackScenario", "devChannelRepro", "description", "reproductionSteps", "acknowledgements"]);
    expect(requirements(c).every((r) => r.done)).toBe(true);
  });

  it("shows how far the description is", () => {
    const f = complete();
    f.description = "x".repeat(12);
    expect(requirements(f).find((r) => r.field === "description")).toMatchObject({ done: false, detail: "12 of 50 characters" });
  });
});

describe("review fixes", () => {
  const server = {
    title: "T",
    description: null,
    reproductionSteps: null,
    callstack: null,
    securityImpact: "ELEVATION_OF_PRIVILEGE",
    aiSafetyImpact: null,
    targetList: [{ product: "WINDOWS", productVersion: "1", componentName: null, componentVersion: null, componentLocation: null, componentRepository: null }],
    attackScenario: "LOCAL_L1",
    devChannelRepro: "YES",
    hasCrossTenantImpact: null,
    cweList: null,
    cvssVectorString: null,
    linkList: [{ title: null, type: "WEB", url: "https://a.example" }],
    externalId: null,
    isPublic: null,
    isExploited: true,
    isExploitedDiscovery: "In the wild",
    isExploitedScale: null,
    aiConversationId: null,
    isMissedFix: null,
    variantOrRelatedCVE: null,
    variantCaseOrSubmission: null,
    acknowledgements: [{ name: "A", company: null, companyUrl: null, emailAddress: null, socialMediaUrl: null }],
    anonymousSubmission: false,
    disclosureEventList: [
      { id: "e1", status: "ACTIVE", name: "Blog", medium: "BLOG", date: null },
      { id: "e2", status: "CANCELLED", name: "Old talk", medium: "CONFERENCE", date: null },
    ],
  };

  it("saving what was loaded sends the same thing again (server-shaped round trip)", () => {
    const once = toReportInput(fromReport(server));
    const reloaded = { ...server, ...once, disclosureEventList: (once["disclosureEventList"] as object[]).map((d, i) => ({ ...d, id: `x${i}`, status: "ACTIVE" })) };
    expect(toReportInput(fromReport(reloaded))).toEqual(once);
  });

  it("leaves cancelled disclosure events out", () => {
    expect(fromReport(server).disclosures.map((d) => d.name)).toEqual(["Blog"]);
  });

  it("round-trips active exploit details while an update replaces the whole draft", () => {
    const p = toReportInput(fromReport(server));
    expect(p).toMatchObject({ isExploitedDiscovery: "In the wild" });
    expect(p.isExploitedScale).toBeNull();
    expect(toReportInput(emptyForm()).aiConversationId).toBeNull();
  });

  it("includes a conversation ID only for AI reports", () => {
    const f = emptyForm();
    f.aiConversationId = "conversation-1";
    f.securityImpact = "AI_DERIVED_HARM";
    expect(toReportInput(f).aiConversationId).toBe("conversation-1");
    f.securityImpact = "";
    f.targets[0]!.product = "AI";
    expect(toReportInput(f).aiConversationId).toBe("conversation-1");
    f.targets[0]!.product = "OFFICE";
    expect(toReportInput(f).aiConversationId).toBeNull();
  });

  it("an untouched new link or disclosure row neither blocks saving nor is sent", () => {
    const f = complete();
    f.links = [{ title: "", type: "WEB", url: "" }];
    f.plansDisclosure = true;
    f.disclosures = [{ name: "", medium: "BLOG", date: "" }];
    expect(validate(f, "save")).toEqual([]);
    expect(toReportInput(f)).toMatchObject({ linkList: [], disclosureEventList: [] });
  });
});
