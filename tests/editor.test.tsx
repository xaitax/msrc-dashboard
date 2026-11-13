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
  it("follows the portal's submission section order", async () => {
    fakeMsrc();
    mountEditor(null);
    await settle();
    expect([...host.querySelectorAll(".report-main .rsec h2")].map((h) => h.textContent)).toEqual([
      "Proof of concept", "Security impact", "Acknowledgement", "Public disclosure", "Additional information",
    ]);
    expect((host.querySelector("#in-title") as HTMLInputElement).maxLength).toBe(200);
  });

  it("previews Markdown locally and returns to the unchanged draft", async () => {
    const ops = fakeMsrc();
    mountEditor(null);
    await settle();
    await typeInto("#in-title", "Preview test");
    await typeInto("#in-description", "A **bold** finding with <script>alert(1)</script> text.");
    await act(async () => button(/^Preview report$/).click());
    await settle();
    const preview = host.querySelector(".dialog--report-preview")!;
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(preview.textContent).toContain("<script>alert(1)</script>");
    expect(preview.querySelector("script")).toBeNull();
    expect(ops).toEqual([]);
    await act(async () => button(/^Back to editing$/).click());
    await settle();
    expect((host.querySelector("#in-description") as HTMLTextAreaElement).value).toBe("A **bold** finding with <script>alert(1)</script> text.");
  });

  it("previews call stack Markdown in the field and in the report preview", async () => {
    const ops = fakeMsrc();
    mountEditor(null);
    await settle();
    await typeInto("#in-callstack", "## Stack\n**frame** and `symbol`");
    await act(async () => (host.querySelector("#f-callstack .mdf__tabs button:last-child") as HTMLButtonElement).click());
    await settle();
    expect(host.querySelector("#f-callstack .mdf__preview strong")?.textContent).toBe("frame");
    await act(async () => button(/^Preview report$/).click());
    await settle();
    expect(host.querySelector(".dialog--report-preview strong")?.textContent).toBe("frame");
    expect(ops).toEqual([]);
  });

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
    render(<SubmitDialog form={form} issues={[]} fileCount={0} pendingFiles={1} onClose={() => {}} onFix={() => {}} onCheck={async () => { throw Error("should not run"); }} onSubmit={async () => "VULN-9"} onDone={() => {}} />, host);
    await settle();
    expect(host.textContent).toMatch(/Attach your picked file before checking/);
    expect(button(/Run MSRC checks/).disabled).toBe(true);
  });

  it("shows MSRC's classification and quality advice before the final confirmation", async () => {
    let checked = 0;
    render(<SubmitDialog form={{ ...emptyForm(), title: "Synthetic" }} issues={[]} fileCount={0} onClose={() => {}} onFix={() => {}}
      onCheck={async () => { checked++; return { analysis: { submissionId: "id", isMsrc: false, classification: "NON_MSRC", confidence: 0.9, reason: "May be outside scope", suggestedCategory: null, educationalTips: [] }, quality: { gatesTriggered: [{ gate: "MISSING_POC", aiConfirmed: true }], showNudge: true } }; }}
      onSubmit={async () => "VULN-9"} onDone={() => {}} />, host);
    await settle();
    expect(host.textContent).toContain("Check this report with MSRC");
    expect(checked).toBe(0);
    await act(async () => button(/Run MSRC checks/).click());
    await settle();
    expect(checked).toBe(1);
    expect(host.textContent).toContain("May be outside MSRC's scope");
    expect(host.textContent).toContain("No proof of concept");
    expect(host.textContent).toContain("Type SUBMIT to confirm");
  });
});
