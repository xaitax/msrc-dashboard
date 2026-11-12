import { describe, expect, it } from "vitest";
import { extractCves, msrcNamedCves } from "../src/core/cve";
import { msg } from "./helpers";

describe("extractCves", () => {
  it("drops a CVE mentioned on more than 3 reports as boilerplate, keeps 3", () => {
    const msgs = [
      ...["VULN-1", "VULN-2", "VULN-3", "VULN-4"].map((r) => msg({ reportNumber: r, createdOn: "2026-01-01T00:00:00Z", body: "see CVE-2020-0001" })),
      ...["VULN-1", "VULN-2", "VULN-3"].map((r) => msg({ reportNumber: r, createdOn: "2026-01-01T00:00:00Z", body: "assigned cve-2026-12345" })),
    ];
    const out = extractCves(msgs);
    expect(out["VULN-1"]?.map((c) => c.cve)).toEqual(["CVE-2026-12345"]);
    expect(out["VULN-4"]).toBeUndefined();
  });
  it("dedupes a CVE named twice in one message", () => {
    const msgs = [msg({ id: "a", reportNumber: "VULN-9", createdOn: "2026-01-01T00:00:00Z", body: "CVE-2026-20001 and CVE-2026-20001" })];
    expect(extractCves(msgs)["VULN-9"]).toEqual([{ cve: "CVE-2026-20001", source: "message", messageId: "a" }]);
  });
  it("records the message id for message-sourced CVEs", () => {
    const out = extractCves([msg({ id: "x1", reportNumber: "VULN-5", createdOn: "2026-01-01T00:00:00Z", body: "CVE-2026-30003" })]);
    expect(out["VULN-5"]).toEqual([{ cve: "CVE-2026-30003", source: "message", messageId: "x1" }]);
  });
});

describe("only MSRC assigns CVEs", () => {
  it("ignores a CVE the researcher wrote in their own message (seen live: a thank-you naming the CVE)", () => {
    const msgs = [msg({ id: "own", reportNumber: "VULN-1", createdOn: "2026-11-12T08:10:52Z", senderName: "Jane", body: "Could you reference CVE-2026-1001 here?" })];
    expect(extractCves(msgs)).toEqual({});
  });

  it("links a public CVE to a case only when MSRC named it there, on exactly one case", () => {
    const refs = extractCves(
      [
        msg({ id: "a", reportNumber: "VULN-1", createdOn: "2026-11-01T00:00:00Z", body: "Fixed as CVE-2026-1001." }),
        msg({ id: "b", reportNumber: "VULN-2", createdOn: "2026-11-01T00:00:00Z", body: "Duplicate of a case fixed as CVE-2026-1002." }),
        msg({ id: "c", reportNumber: "VULN-3", createdOn: "2026-11-01T00:00:00Z", body: "Duplicate of a case fixed as CVE-2026-1002." }),
      ],
    );
    expect(msrcNamedCves(refs)).toEqual({ "VULN-1": ["CVE-2026-1001"] });
  });
});
