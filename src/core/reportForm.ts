// The vulnerability report form: catalog, form ⇄ API payload, validation.
// Values, labels and rules are copied from the portal bundle (CreateReportPage,
// 2026-11-11) and checked live on a throw-away draft. Pure: no DOM, no network.
import { isCveId, isVulnId } from "../shared/ids";

export interface Option {
  value: string;
  label: string;
}
export interface OptionGroup {
  label: string;
  options: Option[];
}

export interface TargetRow {
  product: string;
  productVersion: string;
  componentName: string;
  componentVersion: string;
  componentLocation: string;
  componentRepository: string;
}
export interface LinkRow {
  title: string;
  type: string;
  url: string;
}
export interface Ack {
  name: string;
  company: string;
  companyUrl: string;
  emailAddress: string;
  socialMediaUrl: string;
}
export interface DisclosureRow {
  name: string;
  medium: string;
  date: string; // yyyy-mm-dd or ""
}

export interface ReportForm {
  title: string;
  securityImpact: string;
  aiSafetyImpact: string;
  aiConversationId: string;
  targets: TargetRow[];
  attackScenario: string;
  devChannelRepro: string;
  hasCrossTenantImpact: string; // "" = I don't know
  description: string;
  reproductionSteps: string;
  callstack: string;
  cwes: string[];
  cvssVectorString: string;
  links: LinkRow[];
  isPublic: boolean | null;
  isExploited: boolean | null;
  isExploitedDiscovery: string;
  isExploitedScale: string;
  isMissedFix: boolean | null;
  variantOrRelatedCVE: string;
  variantCaseOrSubmission: string;
  externalId: string;
  acknowledgements: Ack[];
  anonymousSubmission: boolean;
  plansDisclosure: boolean; // UI only: the portal derives it from the event list
  disclosures: DisclosureRow[];
  /** Input fields the editor doesn't show, carried through unchanged: an update
   *  replaces the whole draft (live-verified), so leaving them out would clear them. */
  keep: Record<string, unknown>;
}

const KEEP_FIELDS = ["aiConversationId"] as const;

export type ReportInput = Record<string, unknown>;

export interface Issue {
  field: keyof ReportForm;
  message: string;
}

// ---- catalog ---------------------------------------------------------------

interface ProductDef {
  value: string;
  label: string;
  order: number;
  group?: string;
  headerOnly?: boolean;
}

const PRODUCTS: ProductDef[] = [
  { value: "AZURE", label: "Azure", order: 10 },
  { value: "AZURE_DEV_OPS", label: "Azure DevOps", order: 20, group: "Azure" },
  { value: "BING", label: "Bing", order: 40 },
  { value: "AI", label: "Copilot, AI + ML, and LLMs", order: 45 },
  { value: "DYNAMICS", label: "Dynamics", order: 60 },
  { value: "EDGE", label: "Edge", order: 80 },
  { value: "EDGE_CHROMIUM", label: "Edge (Chromium)", order: 90 },
  { value: "EXCHANGE", label: "Exchange", order: 100 },
  { value: "EXCHANGE_ON_PREM", label: "Exchange On-Prem", order: 101, group: "Exchange" },
  { value: "GAMING", label: "Gaming", order: 110 },
  { value: "HARDWARE", label: "Hardware", order: 120 },
  { value: "IDENTITY", label: "Identity", order: 140, headerOnly: true },
  { value: "IDENTITY_AAD_ESTS", label: "AAD/ESTS", order: 141, group: "Identity" },
  { value: "IDENTITY_MSA", label: "MSA", order: 142, group: "Identity" },
  { value: "IDENTITY_GRAPH_SERVICES", label: "Graph Services", order: 143, group: "Identity" },
  { value: "IDENTITY_SELF_SERVICE_CREDENTIAL_MANAGEMENT", label: "Self-Service Credential Management", order: 144, group: "Identity" },
  { value: "IDENTITY_AAD_APPLICATIONS", label: "AAD Applications", order: 145, group: "Identity" },
  { value: "IDENTITY_ADFS", label: "ADFS", order: 146, group: "Identity" },
  { value: "IDENTITY_B2_B", label: "B2B", order: 147, group: "Identity" },
  { value: "IDENTITY_MFA", label: "MFA", order: 148, group: "Identity" },
  { value: "IDENTITY_PRIVILEGED_IDENTITY_MANAGEMENT", label: "Privileged Identity Management", order: 149, group: "Identity" },
  { value: "INTERNET_EXPLORER", label: "Internet Explorer", order: 160 },
  { value: "MSN", label: "MSN", order: 180 },
  { value: "NUANCE", label: "Nuance", order: 190 },
  { value: "DOTNET", label: ".NET", order: 191 },
  { value: "DOTNET_FRAMEWORK", label: ".NET Framework", order: 192 },
  { value: "OFFICE", label: "Office", order: 200 },
  { value: "SHARE_POINT", label: "SharePoint", order: 210 },
  { value: "SKYPE", label: "Skype", order: 220 },
  { value: "SQL_SERVER_ON_PREM", label: "SQL Server On-Prem", order: 230 },
  { value: "SURFACE", label: "Surface", order: 240, group: "Hardware" },
  { value: "TEAMS", label: "Teams", order: 241 },
  { value: "TEAMS_DESKTOP", label: "Teams Desktop", order: 242, group: "Teams" },
  { value: "TEAMS_MOBILE", label: "Teams Mobile", order: 243, group: "Teams" },
  { value: "VISUAL_STUDIO", label: "Visual Studio", order: 260 },
  { value: "WINDOWS", label: "Windows", order: 280 },
  { value: "XBOX", label: "Xbox", order: 300 },
  { value: "OTHER", label: "Other / Unknown", order: 10_000 },
];

export const PRODUCT_LABEL: Record<string, string> = Object.fromEntries(PRODUCTS.map((p) => [p.value, p.label]));

/** Top-level products in portal order; sub-products sit in their parent's group. */
export function productGroups(): OptionGroup[] {
  return PRODUCTS.filter((p) => !p.group)
    .sort((a, b) => a.order - b.order)
    .map((top) => ({
      label: top.label,
      options: [
        ...(top.headerOnly ? [] : [{ value: top.value, label: top.label }]),
        ...PRODUCTS.filter((c) => c.group === top.label)
          .sort((a, b) => a.order - b.order)
          .map((c) => ({ value: c.value, label: c.label })),
      ],
    }));
}

export const IMPACTS: Option[] = [
  { value: "ELEVATION_OF_PRIVILEGE", label: "Elevation of Privilege" },
  { value: "REMOTE_CODE_EXECUTION", label: "Remote Code Execution" },
  { value: "INFORMATION_DISCLOSURE", label: "Information Disclosure" },
  { value: "SECURITY_FEATURE_BYPASS", label: "Security Feature Bypass" },
  { value: "DENIAL_OF_SERVICE", label: "Denial of Service" },
  { value: "SPOOFING", label: "Spoofing" },
  { value: "TAMPERING", label: "Tampering" },
  { value: "AI_DERIVED_HARM", label: "AI derived harm" },
  { value: "OTHER", label: "Other" },
  { value: "UNKNOWN", label: "Unknown" },
];

export const AI_HARM_CSEAM = "HARMFUL_CONTENT_CSEAM";
export const AI_HARMS: Option[] = [
  { value: "CBRN", label: "CBRN (chemical, biological, radiological, nuclear)" },
  { value: "FAIRNESS", label: "Fairness" },
  { value: "HARMFUL_CONTENT_HATE_SPEECH", label: "Harmful content: hate speech" },
  { value: "HARMFUL_CONTENT_INAPPROPRIATE_LANGUAGE", label: "Harmful content: inappropriate language" },
  { value: "HARMFUL_CONTENT_INCITING_VIOLENCE", label: "Harmful content: inciting violence" },
  { value: "HARMFUL_CONTENT_SELF_HARM", label: "Harmful content: self-harm" },
  { value: "HARMFUL_CONTENT_SEXUAL", label: "Harmful content: sexual" },
  { value: AI_HARM_CSEAM, label: "Harmful content: child sexual exploitation" },
  { value: "INFORMATION_INTEGRITY_ELECTION", label: "Information integrity: elections" },
  { value: "INFORMATION_INTEGRITY_GENERAL", label: "Information integrity: general" },
  { value: "MALICIOUS_USES", label: "Malicious uses" },
];

/** Attack scenarios per product (portal `cr` map; Windows values live-verified). */
const SCENARIOS: Record<string, { options: Option[]; link: string; program: string }> = {
  WINDOWS: {
    link: "https://www.microsoft.com/en-us/msrc/bounty-windows-insider-preview",
    program: "Windows Insider Bounty Program",
    options: [
      { value: "LOCAL", label: "Local" },
      { value: "LOCAL_L1", label: "Local · Sandbox escape with little or no user interaction" },
      { value: "LOCAL_L2", label: "Local · Unauthorized access to sensitive user data from a sandboxed process, no user interaction" },
      { value: "REMOTE", label: "Remote" },
      { value: "REMOTE_R1", label: "Remote · Unauthenticated non-sandboxed code execution, no user interaction" },
      { value: "REMOTE_R2", label: "Remote · Unauthorized access to private user data, little or no user interaction" },
      { value: "REMOTE_R3", label: "Remote · Data destruction or persistent denial of service, no user interaction" },
      { value: "UNKNOWN", label: "Unknown" },
    ],
  },
  DYNAMICS: {
    link: "https://www.microsoft.com/en-us/msrc/bounty-dynamics",
    program: "Microsoft Dynamics 365 and Power Platform Bounty Program",
    options: [
      { value: "CROSS_TENANT_INFORMATION_DISCLOSURE_DYNAMICS365", label: "Cross-tenant information disclosure" },
      { value: "OTHER_DYNAMICS365", label: "Other" },
    ],
  },
  TEAMS_DESKTOP: {
    link: "https://www.microsoft.com/en-us/msrc/bounty-applications",
    program: "Microsoft Applications Bounty Program",
    options: [
      { value: "REMOTE_CODE_EXECUTION_TEAMS_DESKTOP", label: "Remote code execution (native code, current user) with no user interaction" },
      { value: "AUTHENTICATION_CREDENTIALS_TEAMS_DESKTOP", label: "Obtain authentication credentials for other users (not phishing)" },
      { value: "XSS_NO_USER_INTERACTION_TEAMS_DESKTOP", label: "XSS / script injection in Teams with no user interaction" },
      { value: "ELEVATION_OF_PRIVILEGE_TEAMS_DESKTOP", label: "Elevation of privilege across an OS user boundary" },
      { value: "XSS_USER_INTERACTION_TEAMS_DESKTOP", label: "XSS / script injection in Teams with minimal user interaction" },
    ],
  },
  TEAMS_MOBILE: {
    link: "https://www.microsoft.com/en-us/msrc/bounty-applications",
    program: "Microsoft Applications Bounty Program",
    options: [
      { value: "REMOTE_CODE_EXECUTION_TEAMS_MOBILE", label: "Remote code execution (within the app sandbox) with no user interaction" },
      { value: "AUTHENTICATION_CREDENTIALS_TEAMS_MOBILE", label: "Obtain authentication credentials for other users (not phishing)" },
    ],
  },
};

export const CANARY: Option[] = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "NOT_SURE", label: "Not sure" },
  { value: "UNKNOWN", label: "Unknown" },
];

export const CROSS_TENANT: Option[] = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "NOT_APPLICABLE", label: "N/A" },
  { value: "", label: "I don't know" },
];

export const LINK_TYPES: Option[] = [
  { value: "WEB", label: "Web page" },
  { value: "ARTICLE", label: "Article" },
  { value: "CONFERENCE", label: "Conference" },
  { value: "ISSUE", label: "Issue" },
  { value: "ISSUE_TRACKER", label: "Issue tracker" },
  { value: "MSRC_SUBMISSION_OR_CASE", label: "MSRC submission or case" },
  { value: "PARENT_ISSUE", label: "Parent issue" },
];

export const MEDIA: Option[] = [
  { value: "BLOG", label: "Blog" },
  { value: "CONFERENCE", label: "Conference" },
  { value: "OTHER", label: "Other" },
];

export const LIMITS = { description: [50, 10_000], reproductionSteps: [20, 10_000], products: 20, links: 20, disclosures: 20 } as const;

// ---- form <-> payload --------------------------------------------------------

export const emptyTarget = (): TargetRow => ({ product: "", productVersion: "", componentName: "", componentVersion: "", componentLocation: "", componentRepository: "" });
export const emptyAck = (): Ack => ({ name: "", company: "", companyUrl: "", emailAddress: "", socialMediaUrl: "" });

export function emptyForm(): ReportForm {
  return {
    title: "",
    securityImpact: "",
    aiSafetyImpact: "",
    aiConversationId: "",
    targets: [emptyTarget()],
    attackScenario: "",
    devChannelRepro: "",
    hasCrossTenantImpact: "",
    description: "",
    reproductionSteps: "",
    callstack: "",
    cwes: [],
    cvssVectorString: "",
    links: [],
    isPublic: null,
    isExploited: null,
    isExploitedDiscovery: "",
    isExploitedScale: "",
    isMissedFix: null,
    variantOrRelatedCVE: "",
    variantCaseOrSubmission: "",
    externalId: "",
    acknowledgements: [],
    anonymousSubmission: false,
    plansDisclosure: false,
    disclosures: [],
    keep: {},
  };
}

export const emptyLink = (): LinkRow => ({ title: "", type: "WEB", url: "" });
export const emptyDisclosure = (): DisclosureRow => ({ name: "", medium: "BLOG", date: "" });

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const nul = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);
const filled = (o: object) => Object.values(o).some((v) => typeof v === "string" && v.trim() !== "");
// Rows start with a preset type / medium; only typed text makes them count.
const linkFilled = (l: LinkRow) => !!(l.title.trim() || l.url.trim());
const discFilled = (d: DisclosureRow) => !!(d.name.trim() || d.date.trim());

export function normalizeCwe(v: string): string {
  const t = v.trim();
  return t ? `CWE-${t.replace(/^cwe-?/i, "")}` : "";
}

/** The attack-scenario list of the first product that has one (the portal's rule). */
const scenarioFor = (f: ReportForm) => {
  const first = f.targets.find((t) => SCENARIOS[t.product]);
  return first ? SCENARIOS[first.product]! : null;
};

export const scenarioOptions = (f: ReportForm): Option[] | null => scenarioFor(f)?.options ?? null;

export function scenarioProgram(f: ReportForm): { link: string; program: string } | null {
  const s = scenarioFor(f);
  return s ? { link: s.link, program: s.program } : null;
}

export const needsCanary = (f: ReportForm): boolean => f.targets.some((t) => t.product === "WINDOWS");

/** The GraphQL `VulnerabilityReportInputType` — every field, so clearing one clears it on MSRC. */
export function toReportInput(f: ReportForm): ReportInput {
  const scenario = scenarioOptions(f);
  return {
    ...f.keep,
    title: f.title.trim(),
    description: nul(f.description) === null ? null : f.description,
    reproductionSteps: nul(f.reproductionSteps) === null ? null : f.reproductionSteps,
    callstack: nul(f.callstack) === null ? null : f.callstack,
    securityImpact: nul(f.securityImpact),
    aiSafetyImpact: f.securityImpact === "AI_DERIVED_HARM" ? nul(f.aiSafetyImpact) : null,
    aiConversationId: f.securityImpact === "AI_DERIVED_HARM" || f.targets.some((t) => t.product === "AI") ? nul(f.aiConversationId) : null,
    targetList: f.targets.filter(filled).map((t) => ({
      product: nul(t.product),
      productVersion: nul(t.productVersion),
      componentName: nul(t.componentName),
      componentVersion: nul(t.componentVersion),
      componentLocation: nul(t.componentLocation),
      componentRepository: nul(t.componentRepository),
    })),
    attackScenario: scenario ? nul(f.attackScenario) : null,
    devChannelRepro: needsCanary(f) ? nul(f.devChannelRepro) : null,
    hasCrossTenantImpact: nul(f.hasCrossTenantImpact),
    cweList: [...new Set(f.cwes.map(normalizeCwe).filter(Boolean))],
    cvssVectorString: nul(f.cvssVectorString),
    linkList: f.links.filter(linkFilled).map((l) => ({ title: l.title.trim(), type: l.type, url: l.url.trim() })),
    externalId: nul(f.externalId),
    isPublic: f.isPublic,
    isExploited: f.isExploited,
    isExploitedDiscovery: f.isExploited ? nul(f.isExploitedDiscovery) : null,
    isExploitedScale: f.isExploited ? nul(f.isExploitedScale) : null,
    isMissedFix: f.isMissedFix,
    variantOrRelatedCVE: f.isMissedFix ? nul(f.variantOrRelatedCVE) : null,
    variantCaseOrSubmission: f.isMissedFix ? nul(f.variantCaseOrSubmission) : null,
    acknowledgements: f.anonymousSubmission ? [] : f.acknowledgements.filter(filled).map((a) => ({ ...a })),
    anonymousSubmission: f.anonymousSubmission,
    disclosureEventList: f.plansDisclosure
      ? f.disclosures.filter(discFilled).map((d) => ({ name: d.name.trim(), medium: d.medium, date: d.date ? `${d.date}T00:00:00Z` : null }))
      : [],
  };
}

/** A stored report (`EntireVulnReport`) back into the form. */
export function fromReport(r: Record<string, unknown>): ReportForm {
  const targets = rows(r["targetList"]).map((t) => ({
    product: s(t["product"]),
    productVersion: s(t["productVersion"]),
    componentName: s(t["componentName"]),
    componentVersion: s(t["componentVersion"]),
    componentLocation: s(t["componentLocation"]),
    componentRepository: s(t["componentRepository"]),
  }));
  const disclosures = rows(r["disclosureEventList"])
    .filter((d) => d["status"] == null || d["status"] === "ACTIVE")
    .map((d) => ({ name: s(d["name"]), medium: s(d["medium"]).toUpperCase(), date: s(d["date"]).slice(0, 10) }));
  return {
    title: s(r["title"]),
    securityImpact: s(r["securityImpact"]),
    aiSafetyImpact: s(r["aiSafetyImpact"]),
    aiConversationId: s(r["aiConversationId"]),
    targets: targets.length ? targets : [emptyTarget()],
    attackScenario: s(r["attackScenario"]),
    devChannelRepro: s(r["devChannelRepro"]),
    hasCrossTenantImpact: s(r["hasCrossTenantImpact"]),
    description: s(r["description"]),
    reproductionSteps: s(r["reproductionSteps"]),
    callstack: s(r["callstack"]),
    cwes: Array.isArray(r["cweList"]) ? (r["cweList"] as unknown[]).map(s).filter(Boolean) : [],
    cvssVectorString: s(r["cvssVectorString"]),
    links: rows(r["linkList"]).map((l) => ({ title: s(l["title"]), type: s(l["type"]), url: s(l["url"]) })),
    isPublic: bool(r["isPublic"]),
    isExploited: bool(r["isExploited"]),
    isExploitedDiscovery: s(r["isExploitedDiscovery"]),
    isExploitedScale: s(r["isExploitedScale"]),
    isMissedFix: bool(r["isMissedFix"]),
    variantOrRelatedCVE: s(r["variantOrRelatedCVE"]),
    variantCaseOrSubmission: s(r["variantCaseOrSubmission"]),
    externalId: s(r["externalId"]),
    acknowledgements: rows(r["acknowledgements"]).map(ackOf),
    anonymousSubmission: r["anonymousSubmission"] === true,
    plansDisclosure: disclosures.length > 0,
    disclosures,
    keep: Object.fromEntries(KEEP_FIELDS.filter((k) => r[k] != null).map((k) => [k, r[k]])),
  };
}

function ackOf(a: Record<string, unknown>): Ack {
  return { name: s(a["name"]), company: s(a["company"]), companyUrl: s(a["companyUrl"]), emailAddress: s(a["emailAddress"]), socialMediaUrl: s(a["socialMediaUrl"]) };
}

/** The profile's default acknowledgement (`/me` → acknowledgement), if any. */
export function ackFromProfile(me: unknown): Ack | null {
  const a = (me as { acknowledgement?: Record<string, unknown> | null } | null)?.acknowledgement;
  return a && typeof a === "object" ? ackOf(a) : null;
}

// ---- validation --------------------------------------------------------------

const CWE_RE = /^CWE-\d{1,8}$/;
const CVSS_RE = /^CVSS:\d{1,2}(\.\d{1,2})?(\/[A-Za-z]+:[A-Za-z0-9]+)+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** "save": what MSRC needs to store a draft. "submit": the portal's full rules. */
export function validate(f: ReportForm, mode: "save" | "submit"): Issue[] {
  const out: Issue[] = [];
  const add = (field: Issue["field"], message: string) => out.push({ field, message });
  const submit = mode === "submit";
  const len = (v: string) => v.trim().length;

  if (!f.title.trim()) add("title", "Add a title.");
  else if (f.title.length > 200) add("title", "Shorten the title to 200 characters.");
  if (submit && !f.securityImpact) add("securityImpact", "Choose the security impact.");
  if (submit && f.securityImpact === "AI_DERIVED_HARM" && !f.aiSafetyImpact) add("aiSafetyImpact", "Choose the AI harm category.");
  if (f.securityImpact === "AI_DERIVED_HARM" && f.aiSafetyImpact === AI_HARM_CSEAM)
    add("aiSafetyImpact", "MSRC doesn't take reports of this kind. Use Microsoft's Report a Concern form instead.");
  if (submit && !f.targets.some((t) => t.product)) add("targets", "Add at least one product.");
  if (submit && scenarioOptions(f) && !f.attackScenario) add("attackScenario", "Choose the attack scenario.");
  if (submit && needsCanary(f) && !f.devChannelRepro) add("devChannelRepro", "Say whether it reproduces on the Canary Channel.");
  const [dMin, dMax] = LIMITS.description;
  if (submit && len(f.description) < dMin) add("description", `Describe the issue in at least ${dMin} characters.`);
  else if (f.description.length > dMax) add("description", `Shorten the description to ${dMax.toLocaleString("en")} characters.`);
  const [rMin, rMax] = LIMITS.reproductionSteps;
  if (submit && len(f.reproductionSteps) < rMin) add("reproductionSteps", `Write the steps to reproduce (at least ${rMin} characters).`);
  else if (f.reproductionSteps.length > rMax) add("reproductionSteps", `Shorten the steps to ${rMax.toLocaleString("en")} characters.`);

  if (f.cwes.map(normalizeCwe).some((c) => c && !CWE_RE.test(c))) add("cwes", "CWE numbers look like CWE-416.");
  if (f.cvssVectorString.length > 200) add("cvssVectorString", "Shorten the CVSS vector to 200 characters.");
  if (f.cvssVectorString.trim() && !CVSS_RE.test(f.cvssVectorString.trim())) add("cvssVectorString", "Use a CVSS vector like CVSS:3.1/AV:L/AC:L/…");
  if (f.isExploited && f.isExploitedDiscovery.length > 1000) add("isExploitedDiscovery", "Shorten exploit discovery details to 1,000 characters.");
  if (f.isExploited && f.isExploitedScale.length > 1000) add("isExploitedScale", "Shorten exploit scale details to 1,000 characters.");
  if ((f.securityImpact === "AI_DERIVED_HARM" || f.targets.some((t) => t.product === "AI")) && f.aiConversationId.length > 100)
    add("aiConversationId", "Shorten the AI conversation ID to 100 characters.");
  if (f.links.filter(linkFilled).some((l) => !URL_RE.test(l.url.trim()) || !l.type)) add("links", "Each link needs a type and an http(s) URL.");
  if (f.links.filter(linkFilled).length > LIMITS.links) add("links", "MSRC accepts at most 20 links.");
  if (f.isMissedFix && f.variantOrRelatedCVE.trim() && !isCveId(f.variantOrRelatedCVE.trim())) add("variantOrRelatedCVE", "CVE numbers look like CVE-2026-12345.");
  if (f.isMissedFix && (f.variantCaseOrSubmission.trim() ? !isVulnId(f.variantCaseOrSubmission.trim()) : submit))
    add("variantCaseOrSubmission", "Name the existing case as VULN-123456.");
  const acks = f.acknowledgements.filter(filled);
  if (acks.some((a) => !a.name.trim())) add("acknowledgements", "Each acknowledgement needs a name.");
  else if (submit && !f.anonymousSubmission && acks.length === 0) add("acknowledgements", "Add how you'd like to be acknowledged, or submit anonymously.");
  if (f.plansDisclosure && f.disclosures.filter(discFilled).some((d) => !d.name.trim() || !d.medium)) add("disclosures", "Each disclosure needs a name and a medium.");
  return out;
}

// ---- the submit checklist ------------------------------------------------------

export interface Requirement {
  field: Issue["field"];
  label: string;
  done: boolean;
  detail?: string;
}

/** What MSRC needs before a report can go out, in form order; drives the side rail. */
export function requirements(f: ReportForm): Requirement[] {
  const open = new Set(validate(f, "submit").map((i) => i.field));
  const req = (field: Issue["field"], label: string, detail?: string): Requirement => ({ field, label, done: !open.has(field), ...(detail ? { detail } : {}) });
  const out: Requirement[] = [req("title", "Title"), req("securityImpact", "Security impact")];
  if (f.securityImpact === "AI_DERIVED_HARM") out.push(req("aiSafetyImpact", "AI harm category"));
  out.push(req("targets", "At least one product"));
  if (scenarioOptions(f)) out.push(req("attackScenario", "Attack scenario"));
  if (needsCanary(f)) out.push(req("devChannelRepro", "Canary Channel answer"));
  const d = f.description.trim().length;
  const [dMin] = LIMITS.description;
  out.push(req("description", "Description", d < dMin ? `${d} of ${dMin} characters` : undefined));
  out.push(req("reproductionSteps", "Steps to reproduce"));
  out.push(req("acknowledgements", "Acknowledgement or anonymous"));
  return out;
}
