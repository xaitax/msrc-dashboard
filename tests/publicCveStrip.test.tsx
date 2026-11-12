// @vitest-environment happy-dom
// The Cases page strip for public CVEs that MSRC hasn't tied to a case yet.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicCveStrip } from "../src/dashboard/components/PublicCves";

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
const rows = [
  { reportNumber: "VULN-100140", ticketNumber: "100140", title: "Example service use-after-free" },
  { reportNumber: "VULN-100121", ticketNumber: "100121", title: "Example broker registry write" },
];

let host: HTMLElement;
let sent: unknown[];
beforeEach(() => {
  sent = [];
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal("chrome", { runtime: { sendMessage: async (m: unknown) => (sent.push(m), true) } });
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

const button = (re: RegExp) => [...host.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;

describe("public CVE strip", () => {
  it("shows the CVE, its advisory link and the likely case, and links it on one click", async () => {
    render(<PublicCveStrip unlinked={[{ item, suggestion: "VULN-100140" }]} rows={rows} onOpen={() => {}} />, host);
    expect(host.textContent).toContain("CVE-2026-1001");
    expect(host.textContent).toContain("Windows Example Elevation of Privilege Vulnerability");
    expect(host.textContent).toContain("100140");
    expect(host.querySelector("a[href='https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-1001']")).not.toBeNull();
    await act(async () => button(/^Link to 100140$/)!.click());
    expect(sent).toEqual([{ type: "cve:link", cve: "CVE-2026-1001", reportNumber: "VULN-100140" }]);
  });

  it("can be linked to another case, or dismissed", async () => {
    render(<PublicCveStrip unlinked={[{ item, suggestion: null }]} rows={rows} onOpen={() => {}} />, host);
    expect(button(/^Link to/)).toBeUndefined(); // no guess, no one-click link
    const sel = host.querySelector("select") as HTMLSelectElement;
    sel.value = "VULN-100121";
    await act(async () => void sel.dispatchEvent(new Event("change", { bubbles: true })));
    expect(sent).toEqual([]); // picking (arrow keys fire change on Windows) never links by itself
    await act(async () => button(/^Link$/)!.click());
    await act(async () => button(/^Not mine$/)!.click());
    expect(sent).toEqual([
      { type: "cve:link", cve: "CVE-2026-1001", reportNumber: "VULN-100121" },
      { type: "cve:link", cve: "CVE-2026-1001", reportNumber: null },
    ]);
  });

  it("renders nothing when every public CVE is linked", () => {
    render(<PublicCveStrip unlinked={[]} rows={rows} onOpen={() => {}} />, host);
    expect(host.innerHTML).toBe("");
  });
});

describe("undoing 'Not mine'", () => {
  it("lists what was marked as not yours, with an undo", async () => {
    render(<PublicCveStrip unlinked={[]} dismissed={[item]} rows={rows} onOpen={() => {}} />, host);
    expect(host.textContent).toContain("CVE-2026-1001");
    await act(async () => button(/^Undo$/)!.click());
    expect(sent).toEqual([{ type: "cve:link", cve: "CVE-2026-1001", reportNumber: undefined }]);
  });
});
