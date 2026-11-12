// @vitest-environment happy-dom
// Case page additions (MSRC's guide and banner, planned disclosures), site
// announcements and the portal internals page.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Announcements } from "../src/dashboard/components/Announcements";
import { CaseGuide } from "../src/dashboard/components/CaseGuide";
import { Disclosures } from "../src/dashboard/components/Disclosures";
import { InternalsPage } from "../src/dashboard/components/Internals";
import { WriteError, type CaseBanner, type DisclosureInput, type ReportApi } from "../src/dashboard/reportApi";
import type { PortalSettings } from "../src/core/portalConfig";
import type { PortalInternals } from "../src/dashboard/portalInfo";

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const settle = async () => {
  for (let i = 0; i < 4; i++) await tick();
};

let host: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

const button = (re: RegExp, root: ParentNode = host) => [...root.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;
const dialog = () => host.querySelector("dialog[open]") as HTMLDialogElement | null;
async function click(b: HTMLElement | undefined) {
  expect(b).toBeTruthy();
  b!.click();
  await settle();
}
async function fill(sel: string, v: string) {
  const el = dialog()!.querySelector(sel) as HTMLInputElement | HTMLSelectElement;
  el.value = v;
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  await tick();
}

type Call = { op: string; args: unknown[] };
function fakeApi(over: Partial<Record<"addDisclosure" | "updateDisclosure" | "cancelDisclosure" | "portalBanners", (...a: unknown[]) => Promise<unknown>>> = {}) {
  const calls: Call[] = [];
  const op =
    (name: string, dflt: unknown) =>
    (...args: unknown[]) => {
      calls.push({ op: name, args });
      return over[name as keyof typeof over]?.(...args) ?? Promise.resolve(dflt);
    };
  const api = {
    addDisclosure: op("addDisclosure", undefined),
    updateDisclosure: op("updateDisclosure", undefined),
    cancelDisclosure: op("cancelDisclosure", undefined),
    portalBanners: op("portalBanners", []),
  } as unknown as ReportApi;
  return { api, calls };
}

describe("planned disclosures", () => {
  const EVENTS = [
    { id: "e-1", name: "A conference talk", medium: "CONFERENCE", date: "2027-03-01T00:00:00Z", status: "ACTIVE" },
    { id: "e-2", name: "https://example.com/post", medium: "BLOG", date: null, status: "CANCELLED" },
  ];
  let changed = 0;
  const mount = (api: ReportApi, events: Record<string, unknown>[] = EVENTS) =>
    render(<Disclosures api={api} reportNumber="VULN-100140" events={events} onChanged={() => changed++} />, host);

  it("lists them; a cancelled one can't be changed", async () => {
    mount(fakeApi().api);
    await settle();
    const items = [...host.querySelectorAll(".plan__item")];
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining("A conference talk"), expect.stringContaining("Cancelled")]);
    expect(items[0]!.textContent).toContain("2027-03-01");
    expect(items[1]!.querySelector("a")!.getAttribute("href")).toBe("https://example.com/post");
    expect(button(/^Edit/, items[0]!)).toBeTruthy();
    expect(items[1]!.querySelectorAll("button")).toHaveLength(0);
  });

  it("adds one only from the dialog's own button, with what was typed", async () => {
    const { api, calls } = fakeApi();
    changed = 0;
    mount(api, []);
    await settle();
    await click(button(/^Add a planned disclosure/));
    expect(dialog()).toBeTruthy();
    expect(button(/^Add disclosure$/, dialog()!)!.disabled).toBe(true);
    await fill("#disc-name", "My blog post");
    await fill("#disc-medium", "BLOG");
    await fill("#disc-date", "2027-01-15");
    expect(calls).toHaveLength(0);
    await click(button(/^Add disclosure$/, dialog()!));
    expect(calls).toEqual([{ op: "addDisclosure", args: ["VULN-100140", { medium: "BLOG", name: "My blog post", date: "2027-01-15" } satisfies DisclosureInput] }]);
    expect(dialog()).toBeNull();
    expect(changed).toBe(1);
    expect(host.textContent).toContain("MSRC has it");
  });

  it("edits one with its values filled in", async () => {
    const { api, calls } = fakeApi();
    mount(api);
    await settle();
    await click(button(/^Edit/, host.querySelector(".plan__item")!));
    expect((dialog()!.querySelector("#disc-name") as HTMLInputElement).value).toBe("A conference talk");
    expect((dialog()!.querySelector("#disc-date") as HTMLInputElement).value).toBe("2027-03-01");
    await fill("#disc-date", "2027-04-01");
    await click(button(/^Save changes$/, dialog()!));
    expect(calls).toEqual([{ op: "updateDisclosure", args: ["VULN-100140", "e-1", { medium: "CONFERENCE", name: "A conference talk", date: "2027-04-01" }] }]);
  });

  it("cancels one only after a confirmation that defaults to keeping it", async () => {
    const { api, calls } = fakeApi();
    mount(api);
    await settle();
    await click(button(/^Cancel/, host.querySelector(".plan__item")!));
    expect(dialog()!.textContent).toContain("A conference talk");
    expect(document.activeElement?.textContent).toBe("Keep it");
    expect(calls).toHaveLength(0);
    await click(button(/^Cancel disclosure$/, dialog()!));
    expect(calls).toEqual([{ op: "cancelDisclosure", args: ["VULN-100140", "e-1"] }]);
  });

  it("keeps the dialog open with MSRC's error when the change fails", async () => {
    const { api } = fakeApi({ addDisclosure: () => Promise.reject(new WriteError("add disclosure: Not allowed")) });
    mount(api, []);
    await settle();
    await click(button(/^Add a planned disclosure/));
    await fill("#disc-name", "Talk");
    await click(button(/^Add disclosure$/, dialog()!));
    expect(dialog()!.textContent).toContain("add disclosure: Not allowed");
  });
});

describe("MSRC's word on a case", () => {
  const row = (status: string, statusReason: string | null = null) => ({ reportNumber: "VULN-100140" as const, status, statusReason });

  it("says 'Action required' and offers the reply box while MSRC waits", async () => {
    let replied = 0;
    render(<CaseGuide api={fakeApi().api} row={row("REVIEW_REPRO", "ADDITIONAL_INFORMATION_NEEDED")} onReply={() => replied++} />, host);
    await settle();
    expect(host.querySelector(".guide--urgent")).toBeTruthy();
    expect(host.textContent).toContain("Action required");
    expect(host.textContent).toContain("missing some information from you");
    await click(button(/^Reply to MSRC$/));
    expect(replied).toBe(1);
  });

  it("shows MSRC's banner for the case as text, links https only", async () => {
    const banner: CaseBanner = { id: "b", key: "develop", tone: "INFO", body: 'We\'re working on a fix. See <a href="https://example.com/x">What to expect</a>.<img src=x onerror=alert(1)><script>alert(1)</script>' };
    const { api, calls } = fakeApi({ portalBanners: async () => [banner] });
    render(<CaseGuide api={api} row={row("DEVELOP")} onReply={() => {}} />, host);
    await settle();
    expect(calls[0]).toEqual({ op: "portalBanners", args: ["VULN-100140"] });
    const b = host.querySelector(".guide__banner")!;
    expect(b.textContent).toContain("We're working on a fix.");
    expect(b.querySelector("a")!.getAttribute("href")).toBe("https://example.com/x");
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain("No action required.");
    expect(host.textContent).not.toContain("We're investigating the issue."); // MSRC's own words for the case replace the generic ones
  });

  it("keeps the generic explanation next to a banner when MSRC waits for a reply", async () => {
    const banner: CaseBanner = { id: "b", key: "info", tone: "WARNING", body: "Please send the crash dump." };
    render(<CaseGuide api={fakeApi({ portalBanners: async () => [banner] }).api} row={row("REVIEW_REPRO", "ADDITIONAL_INFORMATION_NEEDED")} onReply={() => {}} />, host);
    await settle();
    expect(host.textContent).toContain("Please send the crash dump.");
    expect(host.textContent).toContain("missing some information from you");
  });

  it("still explains the status when the banner can't be loaded", async () => {
    render(<CaseGuide api={fakeApi({ portalBanners: () => Promise.reject(new Error("offline")) }).api} row={row("NEW")} onReply={() => {}} />, host);
    await settle();
    expect(host.textContent).toContain("Thank you for your submission.");
    expect(host.querySelector(".guide__banner")).toBeNull();
  });
});

describe("site announcements", () => {
  const SETTINGS: PortalSettings = {
    alert: { level: "info", content: "Reports are now assessed as Complete or Not Complete.", linkText: "Read more", linkUrl: "https://aka.ms/example" },
    banners: [{ id: "zdq", level: "warning", content: "Registration closes [soon](https://example.com/zdq)." }],
    classifier: null,
    flags: [],
    serverFlags: [],
    exploited: [],
  };

  it("shows MSRC's alert and banners until dismissed, also after a reload", async () => {
    render(<Announcements load={async () => SETTINGS} />, host);
    await settle();
    expect(host.textContent).toContain("Complete or Not Complete");
    expect(host.querySelector('a[href="https://aka.ms/example"]')!.textContent).toBe("Read more");
    expect(host.querySelector('a[href="https://example.com/zdq"]')).toBeTruthy();
    await click(host.querySelector('button[aria-label="Dismiss: Reports are now assessed as Complete or Not Complete."]') as HTMLButtonElement);
    expect(host.textContent).not.toContain("Complete or Not Complete");
    render(null, host);
    render(<Announcements load={async () => SETTINGS} />, host);
    await settle();
    expect(host.textContent).not.toContain("Complete or Not Complete");
    expect(host.textContent).toContain("Registration closes");
  });

  it("shows nothing when the settings can't be loaded", async () => {
    render(<Announcements load={() => Promise.reject(new Error("offline"))} />, host);
    await settle();
    expect(host.innerHTML).toBe("");
  });
});

describe("portal internals", () => {
  const SETTINGS: PortalSettings = {
    alert: null,
    banners: [],
    classifier: { model: "model-x", reasoningEffort: "low", confidenceThreshold: 0.65, endpoints: ["https://one.example.com/"], categories: [{ name: "[VRR NCR] Piracy (Close)", enabled: true, closes: true }] },
    flags: [{ key: "QualityGates", value: "true" }, { key: "QualityGates_Roles", value: "2 entries" }],
    serverFlags: [{ id: "RP_AutoQualityGateOnSubmit", enabled: true }],
    exploited: ["CVE-2026-1111"],
  };
  const INTERNALS: PortalInternals = {
    environments: [
      { apiRoot: "https://api.msrc.microsoft.com", clientId: "c-prod", signInPolicy: "B2C_1A_PROD", insightsKey: null, supportEmail: "prod@example.com" },
      { apiRoot: "https://dev.example.net", clientId: "c-dev", signInPolicy: "B2C_1A_DEV", insightsKey: "k", supportEmail: null },
    ],
    apiHosts: ["api.msrc.microsoft.com", "api-corp.example.com"],
    flagInfo: { QualityGates: { label: "Quality Gates - Master", description: "Master switch." } },
  };

  it("shows the AI pre-screening setup, environments and flags", async () => {
    render(<InternalsPage loadSettings={async () => SETTINGS} loadInternals={async () => INTERNALS} />, host);
    await settle();
    const t = host.textContent!;
    expect(t).toContain("model-x");
    expect(t).toContain("65%");
    expect(t).toContain("[VRR NCR] Piracy (Close)");
    expect(t).toContain("Closes the report");
    expect(t).toContain("This portal");
    expect(t).toContain("https://dev.example.net");
    expect(t).toContain("api-corp.example.com");
    expect(t).toContain("Quality Gates - Master");
    expect(t).toContain("2 entries");
    expect(t).toContain("RP_AutoQualityGateOnSubmit");
    expect(host.querySelector('a[href="https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-1111"]')).toBeTruthy();
  });

  it("shows the settings even when the scripts can't be read", async () => {
    render(<InternalsPage loadSettings={async () => SETTINGS} loadInternals={() => Promise.reject(new Error("portal script: HTTP 404"))} />, host);
    await settle();
    expect(host.textContent).toContain("model-x");
    expect(host.textContent).toContain("portal script: HTTP 404");
  });
});
