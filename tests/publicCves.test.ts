import { describe, expect, it } from "vitest";
import { creditedTo, creditNames, cveLinkUpdate, publicCveFrom, resolvePublicCves, suggestCase, type PublicCve } from "../src/core/publicCves";
import { caseRec } from "./helpers";

const ME = "Jane Researcher (@janer)";
const eop = (rn: string, ticket: string, title: string, status = "DEVELOP", createdOn = "2026-08-01T00:00:00Z", extra: Record<string, unknown> = {}) =>
  caseRec(rn, { title, status, securityImpact: "ELEVATION_OF_PRIVILEGE", acknowledgements: [{ name: ME }], ...extra }, { list: { ticketNumber: ticket, title, status, createdOn, securityImpact: "ELEVATION_OF_PRIVILEGE" } });

const CASES = [
  eop("VULN-1", "100140", "Example service drops a COM reference, causing a use-after-free and local elevation to SYSTEM", "DEVELOP", "2026-08-24T00:00:00Z"),
  eop("VULN-2", "100121", "Example broker: standard user to SYSTEM via an arbitrary registry write"),
  eop("VULN-3", "100125", "Example session buffer metadata causes a heap overflow"),
  eop("VULN-4", "100110", "Example broker trusts spoofable caller attributes"),
];

const EXAMPLE_CVE: PublicCve = {
  cve: "CVE-2026-1001",
  title: "Windows Example Elevation of Privilege Vulnerability",
  releaseDate: "2026-11-10T08:00:00-08:00",
  severity: "Important",
  impact: "Elevation of Privilege",
  baseScore: "7.0",
  vector: "CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:H/E:U/RL:O/RC:C",
  cwe: ["CWE-416: Use After Free"],
  exploitability: "Exploitation More Likely",
};

describe("whose credit is it", () => {
  it("takes the credit names from the researcher's own reports, skipping anonymous ones", () => {
    const anon = caseRec("VULN-9", { acknowledgements: [{ name: "Someone Else" }], anonymousSubmission: true });
    const short = caseRec("VULN-8", { acknowledgements: [{ name: "Al" }] });
    expect(creditNames([...CASES, anon, short])).toEqual([ME]);
  });

  it("matches the credit line in the guide's HTML, ignoring case and spacing", () => {
    const html = `<a href="https://www.linkedin.com/in/example/">Jane  Researcher (@JANER)</a> with https://example.com/`;
    expect(creditedTo(html, [ME])).toBe(true);
    expect(creditedTo("Anonymous", [ME])).toBe(false);
    expect(creditedTo("Jane Researcher (@janer2) with Contoso", [ME])).toBe(false); // whole name only
    expect(creditedTo("Jane Researcher", [])).toBe(false);
  });
});

describe("normalising the guide's entries", () => {
  it("prefers the vulnerability record and falls back to the acknowledgement row", () => {
    const ack = { cveNumber: "CVE-2026-1001", cveTitle: "Windows Example Elevation of Privilege Vulnerability", releaseDate: "2026-11-10T08:00:00-08:00", ackText: "x" };
    const vuln = { cveNumber: "CVE-2026-1001", cveTitle: "Windows Example Elevation of Privilege Vulnerability", releaseDate: "2026-11-10T08:00:00-08:00", severity: "Important", impact: "Elevation of Privilege", baseScore: "7.0", vectorString: EXAMPLE_CVE.vector, cweList: ["CWE-416: Use After Free"], latestSoftwareRelease: "Exploitation More Likely" };
    expect(publicCveFrom(ack, vuln)).toEqual(EXAMPLE_CVE);
    // Without the record: impact from the title, nothing invented.
    expect(publicCveFrom(ack, null)).toEqual({ cve: EXAMPLE_CVE.cve, title: EXAMPLE_CVE.title, releaseDate: EXAMPLE_CVE.releaseDate, severity: null, impact: "Elevation of Privilege", baseScore: null, vector: null, cwe: [], exploitability: null });
    expect(publicCveFrom({ ...ack, cveNumber: "CVE-2026-1' or 1" }, null)).toBeNull();
  });
});

describe("which case is it", () => {
  it("suggests the one use-after-free EoP case among several open EoP cases", () => {
    expect(suggestCase(EXAMPLE_CVE, CASES, {})).toBe("VULN-1");
  });

  it("makes no suggestion without a CWE match, on a tie, or for another impact", () => {
    expect(suggestCase({ ...EXAMPLE_CVE, cwe: [] }, CASES, {})).toBeNull();
    const twin = eop("VULN-5", "139999", "Another use-after-free in a broker");
    expect(suggestCase(EXAMPLE_CVE, [...CASES, twin], {})).toBeNull();
    expect(suggestCase({ ...EXAMPLE_CVE, impact: "Remote Code Execution" }, CASES, {})).toBeNull();
  });

  it("ignores cases submitted after the release and prefers one without a CVE", () => {
    const late = eop("VULN-6", "140000", "Late use-after-free", "DEVELOP", "2026-11-11T00:00:00Z");
    expect(suggestCase(EXAMPLE_CVE, [...CASES.slice(1), late], {})).toBeNull();
    const twin = eop("VULN-5", "139999", "Another use-after-free in a broker");
    expect(suggestCase(EXAMPLE_CVE, [...CASES, twin], { "VULN-5": ["CVE-2026-90000"] })).toBe("VULN-1");
  });
});

describe("linking", () => {
  const second: PublicCve = { ...EXAMPLE_CVE, cve: "CVE-2026-1002", title: "Windows Sample Service Elevation of Privilege Vulnerability", cwe: [] };

  it("links a CVE MSRC named in a message, keeps the rest unlinked with a suggestion", () => {
    const r = resolvePublicCves(CASES, [EXAMPLE_CVE, second], {}, { "VULN-4": ["CVE-2026-1002"] });
    expect(r.byCase["VULN-4"]).toEqual([{ item: second, by: "msrc" }]);
    expect(r.unlinked).toEqual([{ item: EXAMPLE_CVE, suggestion: "VULN-1" }]);
  });

  it("the researcher's link wins, and 'not mine' hides it", () => {
    const linked = resolvePublicCves(CASES, [EXAMPLE_CVE], { "CVE-2026-1001": "VULN-2" }, {});
    expect(linked.byCase["VULN-2"]).toEqual([{ item: EXAMPLE_CVE, by: "you" }]);
    expect(linked.unlinked).toEqual([]);
    const hidden = resolvePublicCves(CASES, [EXAMPLE_CVE], { "CVE-2026-1001": null }, {});
    expect(hidden.byCase).toEqual({});
    expect(hidden.unlinked).toEqual([]);
    expect(hidden.dismissed).toEqual([EXAMPLE_CVE]); // so it can be undone
  });

  it("a link to a case that no longer exists counts as unlinked", () => {
    const r = resolvePublicCves(CASES, [EXAMPLE_CVE], { "CVE-2026-1001": "VULN-77" }, {});
    expect(r.unlinked).toEqual([{ item: EXAMPLE_CVE, suggestion: "VULN-1" }]);
  });

  it("validates link updates", () => {
    expect(cveLinkUpdate({}, "CVE-2026-1001", "VULN-1")).toEqual({ "CVE-2026-1001": "VULN-1" });
    expect(cveLinkUpdate({ "CVE-2026-1001": "VULN-1" }, "CVE-2026-1001", null)).toEqual({ "CVE-2026-1001": null });
    expect(cveLinkUpdate({ "CVE-2026-1001": "VULN-1" }, "CVE-2026-1001", undefined)).toEqual({});
    expect(cveLinkUpdate({}, "CVE-1", "VULN-1")).toBeNull();
    expect(cveLinkUpdate({}, "CVE-2026-1001", "VULN-1' or 1")).toBeNull();
  });
});

describe("suggestions respect the researcher's links", () => {
  it("a case that already has a researcher-linked CVE doesn't score as 'no CVE yet'", () => {
    const twin = eop("VULN-5", "139999", "Another use-after-free in a broker");
    const other: PublicCve = { ...EXAMPLE_CVE, cve: "CVE-2026-7777" };
    // VULN-1 already carries CVE-2026-7777 by the researcher's link; VULN-5 has none.
    const r = resolvePublicCves([...CASES, twin], [other, EXAMPLE_CVE], { "CVE-2026-7777": "VULN-1" }, {});
    expect(r.unlinked).toEqual([{ item: EXAMPLE_CVE, suggestion: "VULN-5" }]);
  });
});
