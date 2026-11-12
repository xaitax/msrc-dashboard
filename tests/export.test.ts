import { describe, expect, it } from "vitest";
import { buildExport, FIELD_GUIDE } from "../src/core/exportBuild";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec, file, msg } from "./helpers";

const NOW = "2026-11-11T20:00:00.000Z";
const cases = [
  caseRec("VULN-3", { title: "No ticket", status: "NEW", description: "**md** text" }, { list: { ticketNumber: null } }),
  caseRec("VULN-2", { title: "Two", status: "DEVELOP" }, { list: { ticketNumber: "100140" }, files: [{ ...file("f1", "poc.zip"), raw: { uploadStatus: "completed" } }] }),
  caseRec("VULN-1", { title: "One", status: "COMPLETE_DUPLICATE", variantOrRelatedCVE: "CVE-2026-11111" }, { list: { ticketNumber: "100120" } }),
];
const messages = [
  msg({ id: "a", reportNumber: "VULN-2", createdOn: "2026-10-01T00:00:00Z", senderName: "Researcher", body: "Hello&nbsp;MSRC" }),
  msg({ id: "b", reportNumber: "VULN-2", createdOn: "2026-10-02T00:00:00Z", senderName: "MSRC", body: "We confirmed the behavior you reported.", raw: { topicList: ["AutoNotification"], isResponseRequired: false } }),
];
const events: ChangeEvent[] = [
  { key: "s1", reportNumber: "VULN-2", ticketNumber: "100140", type: "status", field: "status", oldValue: "REVIEW_REPRO", newValue: "DEVELOP", summary: "Status Review / Repro → Develop", occurredAt: "2026-10-03T00:00:00Z", detectedAt: "2026-10-03T00:01:00Z", seen: false, own: false },
];
const input = { cases, messages, events };
const opts = { scope: "all" as const, generator: "MSRC Dashboard 0.1.0", now: NOW };

describe("buildExport", () => {
  const doc = buildExport(input, opts);

  it("sorts cases by MSRC case number, cases without one last", () => {
    expect(doc.cases.map((c) => c.ids.ticketNumber)).toEqual(["100120", "100140", null]);
  });

  it("limits the selected scope to the chosen cases", () => {
    const sel = buildExport(input, { ...opts, scope: "selected", selected: ["VULN-2"] });
    expect(sel.scope).toBe("selected");
    expect(sel.cases.map((c) => c.ids.reportNumber)).toEqual(["VULN-2"]);
  });

  it("carries messages as decoded text plus the original body", () => {
    const c = doc.cases.find((x) => x.ids.reportNumber === "VULN-2")!;
    expect(c.messages.map((m) => [m.from, m.bodyText, m.milestone])).toEqual([
      ["you", "Hello MSRC", null],
      ["msrc", "We confirmed the behavior you reported.", "MSRC confirmed the behavior"],
    ]);
    expect(c.messages[0]!.bodyOriginal).toBe("Hello&nbsp;MSRC");
  });

  it("derives status history from detected changes and lists files as metadata", () => {
    const c = doc.cases.find((x) => x.ids.reportNumber === "VULN-2")!;
    expect(c.statusHistory).toEqual([{ at: "2026-10-03T00:00:00Z", from: "REVIEW_REPRO", to: "DEVELOP", source: "detected" }]);
    expect(c.files).toEqual([{ id: "f1", name: "poc.zip", createdOn: "2026-11-01T00:00:00Z", uploadStatus: "completed", downloadable: false }]);
  });

  it("keeps report text and CVEs", () => {
    expect(doc.cases.find((x) => x.ids.reportNumber === "VULN-3")!.originalReport["description"]).toBe("**md** text");
    const one = doc.cases.find((x) => x.ids.reportNumber === "VULN-1")!;
    expect(one.summary.cves).toEqual([]); // the researcher's 'related CVE' is not the case's CVE…
    expect(one.originalReport["variantOrRelatedCVE"]).toBe("CVE-2026-11111"); // …it stays with the report
  });

  it("documents every per-case field in the field guide", () => {
    for (const c of doc.cases) for (const k of Object.keys(c)) expect(FIELD_GUIDE).toHaveProperty(k);
    expect(doc).toMatchObject({ schemaVersion: 1, exportedAt: NOW, generator: "MSRC Dashboard 0.1.0", caseCount: 3 });
  });

  it("never contains token-shaped strings", () => {
    expect(JSON.stringify(doc)).not.toMatch(/eyJ[\w-]{10,}\./);
  });
});

describe("export titles", () => {
  it("decodes HTML entities in titles", () => {
    const doc = buildExport({ cases: [caseRec("VULN-8", { title: "A&#39;s &amp; B", status: "NEW" })], messages: [], events: [] }, opts);
    expect(doc.cases[0]!.summary.title).toBe("A's & B");
  });
});

describe("export status history from notifications", () => {
  it("prefers the exact history when available", () => {
    const doc = buildExport({ ...input, history: { "VULN-2": [{ status: "REVIEW_REPRO", at: "2026-09-01T10:00:00Z" }, { status: "DEVELOP", at: "2026-10-06T14:02:00Z" }] } }, opts);
    expect(doc.cases.find((x) => x.ids.reportNumber === "VULN-2")!.statusHistory).toEqual([
      { at: "2026-09-01T10:00:00Z", from: null, to: "REVIEW_REPRO", source: "notification" },
      { at: "2026-10-06T14:02:00Z", from: "REVIEW_REPRO", to: "DEVELOP", source: "notification" },
    ]);
  });
});

describe("public CVEs in the export", () => {
  const item = {
  cve: "CVE-2026-1001",
  title: "Windows Example Elevation of Privilege Vulnerability",
  releaseDate: "2026-11-10T16:00:00Z",
  severity: "Important",
  impact: "Elevation of Privilege",
  baseScore: "7.0",
  vector: null,
  cwe: ["CWE-416: Use After Free"],
  exploitability: "Exploitation More Likely",
};
  it("puts linked public CVEs on their case and lists unconfirmed ones with the guess marked as a guess", () => {
    const doc = buildExport({ ...input, publicCves: { "VULN-2": [{ item, by: "you" }] }, publicUnlinked: [{ item: { ...item, cve: "CVE-2026-99999" }, suggestion: "VULN-1" }] }, opts);
    const two = doc.cases.find((c) => c.ids.reportNumber === "VULN-2")!;
    expect(two.summary.publicCves).toEqual([{ ...item, linkedBy: "researcher", url: "https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-1001" }]);
    expect(doc.cases.find((c) => c.ids.reportNumber === "VULN-1")!.summary.publicCves).toEqual([]);
    expect(doc.publicCvesNotLinked).toEqual([{ ...item, cve: "CVE-2026-99999", url: "https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-99999", guessedReportNumber: "VULN-1" }]);
    expect(doc.fieldGuide.publicCvesNotLinked).toMatch(/guess/);
  });
});

describe("public CVEs in a selected export", () => {
  const base = { cve: "CVE-2026-1", title: "T", releaseDate: "2026-11-10T16:00:00Z", severity: null, impact: null, baseScore: null, vector: null, cwe: [], exploitability: null };
  it("keeps only unlinked CVEs guessed for a selected case", () => {
    const unlinked = [
      { item: { ...base, cve: "CVE-2026-1" }, suggestion: "VULN-2" as const },
      { item: { ...base, cve: "CVE-2026-2" }, suggestion: "VULN-1" as const },
      { item: { ...base, cve: "CVE-2026-3" }, suggestion: null },
    ];
    const doc = buildExport({ ...input, publicUnlinked: unlinked }, { ...opts, scope: "selected", selected: ["VULN-2"] });
    expect(doc.publicCvesNotLinked.map((x) => x.cve)).toEqual(["CVE-2026-1"]);
    const all = buildExport({ ...input, publicUnlinked: unlinked }, opts);
    expect(all.publicCvesNotLinked).toHaveLength(3);
  });
});
