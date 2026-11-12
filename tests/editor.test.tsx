// @vitest-environment happy-dom
// Component tests for the report editor's write paths (review fixes I1, I2, m2, m6).
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyForm } from "../src/core/reportForm";
import { Attachments } from "../src/dashboard/components/report/Attachments";
import { ReportEditor } from "../src/dashboard/components/report/ReportEditor";
import { SubmitDialog } from "../src/dashboard/components/report/SubmitDialog";
import type { ReportApi } from "../src/dashboard/reportApi";

const GUID = "124103c7-209b-4948-9aea-d48bdae6b026";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const settle = async () => {
  for (let i = 0; i < 4; i++) await tick();
};

/** Fake MSRC: counts GraphQL operations; individual responses can be held back. */
function fakeMsrc(opts: { status?: string; enhanced?: boolean; hold?: Record<string, ReturnType<typeof deferred<void>>> } = {}) {
  const ops: string[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    if (url.includes("/portal/v2.0/file")) return json({ value: [] });
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    const op = body.query.trim().split(/[\s(]/)[1]!;
    ops.push(op);
    const hold = opts.hold?.[op];
    if (hold) await hold.promise;
    if (op === "CreateVulnerabilityReport") return json({ data: { createVulnerabilityReport: GUID } });
    if (op === "UpdateVulnerabilityReportDraft") return json({ data: { updateVulnerabilityReportDraft: GUID } });
    if (op === "VulnerabilityReportById")
      return json({ data: { vulnerabilityReports: { items: [{ id: GUID, reportNumber: "VULN-9", status: opts.status ?? "DRAFT", title: "Bug", isEnhancedReport: opts.enhanced ?? false }] } } });
    return json({ data: {} });
  };
  vi.stubGlobal("fetch", fetchFn);
  return ops;
}

let host: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: async (m: { type: string }) =>
        m.type === "auth:token" ? { token: "t" } : m.type === "extras:get" ? { profile: { reportDefaults: { ack: null, anonymous: false } } } : undefined,
    },
  });
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

function mountEditor(id: string | null) {
  const props = { id, cases: [], onLeave: () => {}, onOpenCase: () => {}, onCreated: (_: string) => {} };
  const draw = (patch: Partial<typeof props> = {}) => render(<ReportEditor {...props} {...patch} />, host);
  // Like App: after the first save the route (and so the id prop) changes, same editor.
  props.onCreated = (nid) => draw({ id: nid });
  draw();
  return draw;
}
const typeInto = async (sel: string, value: string) => {
  const el = host.querySelector(sel) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
};
const button = (re: RegExp) => [...host.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() ?? "")) as HTMLButtonElement;
const ctrlS = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));

describe("report editor", () => {
  it("first save of a new report keeps text typed while it saves and reloads nothing", async () => {
    const hold = { UpdateVulnerabilityReportDraft: deferred<void>() };
    const ops = fakeMsrc({ hold });
    mountEditor(null);
    await settle();
    await typeInto("#in-title", "Bug");
    await act(async () => button(/^Save draft/).click());
    await settle();
    await typeInto("#in-description", "typed during save");
    await tick(450); // the local autosave fires
    await act(async () => hold.UpdateVulnerabilityReportDraft.resolve());
    await settle();

    expect((host.querySelector("#in-description") as HTMLTextAreaElement).value).toBe("typed during save");
    expect(ops.filter((o) => o === "VulnerabilityReportById")).toHaveLength(1); // only the save's own report-number lookup
    expect(host.querySelector(".note")).toBeNull(); // no "restored" banner
    expect(localStorage.getItem(`msrc-dashboard:report:${GUID}`)).toContain("typed during save"); // still backed up locally
  });

  it("two quick Ctrl+S create one draft, not two", async () => {
    const hold = { CreateVulnerabilityReport: deferred<void>() };
    const ops = fakeMsrc({ hold });
    mountEditor(null);
    await settle();
    await typeInto("#in-title", "Bug");
    await act(async () => {
      ctrlS();
      ctrlS();
    });
    await act(async () => hold.CreateVulnerabilityReport.resolve());
    await settle();
    expect(ops.filter((o) => o === "CreateVulnerabilityReport")).toHaveLength(1);
  });

  it("does not edit a draft made with MSRC's enhanced form (different mutation)", async () => {
    const ops = fakeMsrc({ enhanced: true });
    mountEditor(GUID);
    await settle();
    expect(host.textContent).toContain("Open it in the portal");
    expect(host.querySelector("#in-title")).toBeNull();
    await act(async () => void ctrlS());
    await settle();
    expect(ops).toEqual(["VulnerabilityReportById"]);
  });

  it("Ctrl+S writes nothing on a report that was already submitted", async () => {
    const ops = fakeMsrc({ status: "NEW" });
    mountEditor(GUID);
    await settle();
    expect(host.textContent).toContain("has been submitted");
    await act(async () => void ctrlS());
    await settle();
    expect(ops).toEqual(["VulnerabilityReportById"]);
  });
});

describe("attachments", () => {
  it("a file removed while uploads run is not attached", async () => {
    const sent: string[] = [];
    const first = deferred<void>();
    const api = {
      listDraftFiles: async () => [],
      attach: async (_rn: string, f: { name: string }) => {
        sent.push(f.name);
        if (sent.length === 1) await first.promise;
        return { id: f.name, name: f.name, createdOn: null };
      },
    } as unknown as ReportApi;
    render(<Attachments api={api} reportNumber="VULN-9" onCount={() => {}} />, host);
    await settle();
    const input = host.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["a"], "a.txt"), new File(["b"], "b.txt")], configurable: true });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => button(/^Attach 2 files to VULN-9/).click());
    await act(async () => button(/^Attach files$/).click());
    await settle();
    const removeB = [...host.querySelectorAll(".flist li")].find((li) => li.textContent?.includes("b.txt"))?.querySelector("button");
    await act(async () => removeB?.click());
    await act(async () => first.resolve());
    await settle();
    expect(sent).toEqual(["a.txt"]);
  });
});

describe("submit dialog", () => {
  it("warns about files that were picked but never attached", async () => {
    const form = { ...emptyForm(), title: "Bug" };
    render(<SubmitDialog form={form} issues={[]} fileCount={0} pendingFiles={1} onClose={() => {}} onFix={() => {}} onSubmit={async () => "VULN-9"} onDone={() => {}} />, host);
    await settle();
    expect(host.textContent).toMatch(/1 file is picked but not attached/);
  });
});
