// "New report" / draft editor: MSRC's report form, rebuilt. Typing autosaves
// locally; "Save draft" writes the draft to MSRC; "Submit" needs a typed
// confirmation. All writes are explicit clicks (see reportApi.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AI_HARMS,
  CANARY,
  CROSS_TENANT,
  emptyAck,
  emptyDisclosure,
  emptyLink,
  emptyForm,
  emptyTarget,
  fromReport,
  IMPACTS,
  LIMITS,
  LINK_TYPES,
  MEDIA,
  needsCanary,
  normalizeCwe,
  productGroups,
  requirements,
  scenarioOptions,
  scenarioProgram,
  toReportInput,
  validate,
  type Ack,
  type Issue,
  type ReportForm,
} from "../../../core/reportForm";
import { isVulnId } from "../../../shared/ids";
import { errorText, send } from "../../../shared/protocol";
import { ago, when } from "../../format";
import { createReportApi, WriteError, type ReportAnalysis, type QualityResult } from "../../reportApi";
import { pageToken, syncSoon } from "../../pageToken";
import { clearLocal, loadLocal, saveLocal } from "../../reportLocal";
import { Attachments } from "./Attachments";
import { Choice, Field, MdArea, Select, Text, YesNo } from "./fields";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { SubmitDialog } from "./SubmitDialog";
import { portalDraftUrl } from "../../../shared/urls";
import type { ComponentChildren } from "preact";

const GROUPS = productGroups();

type Defaults = { ack: Ack | null; anonymous: boolean };
type RowKey = "targets" | "links" | "acknowledgements" | "disclosures";

const sig = (f: ReportForm) => JSON.stringify(toReportInput(f));
const prefilled = (d: Defaults | null): ReportForm => ({ ...emptyForm(), acknowledgements: d?.ack?.name ? [d.ack] : [], anonymousSubmission: d?.anonymous ?? false });
const hasMore = (f: ReportForm) =>
  f.cwes.length > 0 || !!f.cvssVectorString || f.links.length > 0 || f.isPublic !== null || f.isExploited !== null || !!f.isExploitedDiscovery || !!f.isExploitedScale || f.isMissedFix !== null || !!f.externalId;

function focusField(field: string) {
  const el = document.getElementById(`f-${field}`);
  if (!el) return;
  const det = el.closest("details");
  if (det && !det.open) det.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el.querySelector("input:not([type=hidden]), select, textarea") as HTMLElement | null)?.focus({ preventScroll: true });
}

export function ReportEditor(p: { id: string | null; cases: { reportNumber: string; title: string }[]; onCreated: (id: string) => void; onLeave: () => void; onOpenCase: (rn: string) => void }) {
  const api = useMemo(() => createReportApi({ fetch: (u, i) => fetch(u, i), token: pageToken }), []);
  const [id, setId] = useState<string | null>(p.id);
  const [rn, setRn] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<ReportForm>(emptyForm);
  const [base, setBase] = useState(() => sig(emptyForm()));
  const [serverForm, setServerForm] = useState<ReportForm | null>(null);
  const [loading, setLoading] = useState(!!p.id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cweDraft, setCweDraft] = useState("");
  const [enhanced, setEnhanced] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(0);
  const touched = useRef(false);
  // Load only what this editor was opened for: after the first save of a new
  // report the route (and so this prop) changes to the new id, same editor.
  const mountId = useRef(p.id).current;
  const formRef = useRef(form);
  formRef.current = form;
  const inflight = useRef<Promise<{ id: string; rn: string | null }> | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // ---- load: the MSRC draft (plus any newer local copy), or a new form ----
  useEffect(() => {
    let live = true;
    if (!mountId) {
      const local = loadLocal(null);
      if (local) {
        touched.current = true;
        setForm(local.form);
        setRestoredAt(local.at);
        setMoreOpen(hasMore(local.form));
      }
      return;
    }
    void api
      .getReport(mountId)
      .then((raw) => {
        if (!live) return;
        if (!raw) return setLoadError("This draft no longer exists on MSRC.");
        setEnhanced(raw["isEnhancedReport"] === true);
        const server = fromReport(raw);
        setRn(isVulnId(raw["reportNumber"]) ? (raw["reportNumber"] as string) : null);
        setStatus(typeof raw["status"] === "string" ? raw["status"] : null);
        setServerForm(server);
        setBase(sig(server));
        const at = Date.parse(String(raw["lastActivityOn"] ?? raw["createdOn"] ?? ""));
        setSavedAt(Number.isFinite(at) ? at : null);
        const local = loadLocal(mountId);
        const start = local && sig(local.form) !== sig(server) ? local.form : server;
        if (start !== server) setRestoredAt(local!.at);
        else clearLocal(mountId);
        setForm(start);
        setMoreOpen(hasMore(start));
      })
      .catch((e) => live && setLoadError(errorText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [api, mountId]);

  // ---- profile defaults: prefill a fresh form, offer "Add my acknowledgement" ----
  useEffect(() => {
    let live = true;
    void (async () => {
      type X = { profile?: { reportDefaults?: Defaults } | null } | null | undefined;
      let x = (await send({ type: "extras:get" })) as X;
      if (x?.profile && !x.profile.reportDefaults) x = (await send({ type: "extras:get", force: true })) as X;
      const d = x?.profile?.reportDefaults ?? null;
      if (!live || !d) return;
      setDefaults(d);
      if (!mountId && !touched.current) {
        const f = prefilled(d);
        setForm(f);
        setBase(sig(f));
      }
    })();
    return () => {
      live = false;
    };
  }, [mountId]);

  const dirty = sig(form) !== base;

  // ---- local autosave (never loses text, even when MSRC is unreachable) ----
  useEffect(() => {
    if (loading || loadError) return;
    const t = setTimeout(() => (dirty ? saveLocal(id, form) : clearLocal(id)), 400);
    return () => clearTimeout(t);
  }, [form, dirty, id, loading, loadError]);

  const set = useCallback(<K extends keyof ReportForm>(k: K, v: ReportForm[K]) => {
    touched.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  }, []);
  function setRow<K extends RowKey>(k: K, i: number, patch: Partial<ReportForm[K][number]>) {
    touched.current = true;
    setForm((f) => ({ ...f, [k]: (f[k] as object[]).map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }
  function dropRow(k: RowKey, i: number) {
    touched.current = true;
    setForm((f) => ({ ...f, [k]: (f[k] as object[]).filter((_, j) => j !== i) }));
  }

  // ---- writes ----
  // One save at a time: a second Ctrl+S while saving joins the running one
  // (two creates would make two drafts on MSRC).
  const save = (): Promise<{ id: string; rn: string | null }> => {
    if (inflight.current) return inflight.current;
    const run = doSave().finally(() => {
      inflight.current = null;
    });
    inflight.current = run;
    return run;
  };

  const doSave = async (): Promise<{ id: string; rn: string | null }> => {
    const problems = validate(form, "save");
    if (problems.length) {
      setAttempted(true);
      focusField(problems[0]!.field);
      throw new WriteError(problems[0]!.message);
    }
    setSaving(true);
    setSaveError(null);
    const snapshot = form;
    const payload = toReportInput(snapshot);
    try {
      let cur = id;
      let number = rn;
      if (!cur) {
        // Create with the title only (the shape live-verified), then write everything.
        cur = await api.createDraft({ title: payload["title"] });
        setId(cur);
        saveLocal(cur, formRef.current);
        clearLocal(null);
        if (alive.current) p.onCreated(cur);
        const raw = await api.getReport(cur).catch(() => null);
        number = isVulnId(raw?.["reportNumber"]) ? (raw!["reportNumber"] as string) : null;
        setRn(number);
        setStatus("DRAFT");
      }
      await api.updateDraft(cur, payload);
      setBase(JSON.stringify(payload));
      setServerForm(snapshot);
      // Text typed while saving is not on MSRC yet: keep its local backup.
      if (sig(formRef.current) === JSON.stringify(payload)) clearLocal(cur);
      else saveLocal(cur, formRef.current);
      setSavedAt(Date.now());
      setRestoredAt(null);
      syncSoon();
      return { id: cur, rn: number };
    } catch (e) {
      setSaveError(errorText(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const submit = async (): Promise<string> => {
    const left = validate(form, "submit");
    if (left.length) throw new WriteError(left[0]!.message);
    await inflight.current?.catch(() => undefined);
    // A successful pre-check already saved this exact form. Re-saving would
    // replace fields MSRC may have added during analysis.
    const r = id && !dirty ? { id, rn } : await save();
    await api.submit(r.id);
    clearLocal(r.id);
    setStatus("SUBMITTED");
    syncSoon();
    return r.rn ?? "";
  };

  const checkBeforeSubmit = async (): Promise<{ analysis: ReportAnalysis; quality: QualityResult }> => {
    const left = validate(form, "submit");
    if (left.length) throw new WriteError(left[0]!.message);
    await inflight.current?.catch(() => undefined);
    const snapshot = form;
    const knownFileCount = rn ? fileCount : 0;
    const r = await save(); // explicit click; the saved id prevents an extra AI-created draft
    const text = { title: snapshot.title, description: snapshot.description, reproductionSteps: snapshot.reproductionSteps, callstack: snapshot.callstack };
    const analysis = await api.analyzeDraft(r.id, text);
    // Analysis can add hidden draft metadata (notably aiConversationId). Keep
    // it so a later edit does not clear it in the portal's replace-all update.
    const analyzedDraft = await api.getReport(r.id);
    if (!analyzedDraft) throw new WriteError("MSRC analyzed the draft, but it could not be reloaded. Check it in the portal before continuing.");
    const analyzed = fromReport(analyzedDraft);
    const merged = { ...snapshot, aiConversationId: analyzed.aiConversationId, keep: analyzed.keep };
    formRef.current = merged;
    setForm(merged);
    setBase(sig(merged));
    setServerForm(merged);
    const quality = await api.validateQuality(text, knownFileCount);
    return { analysis, quality };
  };

  const remove = async () => {
    if (id) await api.deleteDraft(id);
    clearLocal(id);
    syncSoon();
    p.onLeave();
  };

  const discardLocal = () => {
    clearLocal(id);
    const f = serverForm ?? prefilled(defaults);
    touched.current = false;
    setForm(f);
    setBase(sig(f));
    setRestoredAt(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const editable = !loading && !loadError && !enhanced && (!status || status === "DRAFT") && !submitOpen && !deleteOpen;
        if (editable) void save().catch(() => undefined);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ---- render ----
  const back = (
    <nav class="casebar" aria-label="Report navigation">
      <button type="button" class="link" onClick={p.onLeave}>
        ← All cases
      </button>
    </nav>
  );
  // States where the form isn't shown: a back link and one line.
  const shell = (body: ComponentChildren) => (
    <main class="report-page">
      <div class="report-main">
        {back}
        {body}
      </div>
    </main>
  );
  if (loading) return shell(<p class="muted">Loading the draft from MSRC…</p>);
  if (loadError) return shell(<p class="rf__err">{loadError}</p>);
  if (enhanced)
    return shell(
      <>
        <p>{rn ?? "This draft"} uses MSRC's extended report form, which the dashboard doesn't edit. Open it in the portal.</p>
        {rn && (
          <a class="btn" href={portalDraftUrl(rn)} target="_blank" rel="noopener">
            Open in the portal
          </a>
        )}
      </>,
    );
  if (status && status !== "DRAFT" && !submitOpen)
    return shell(
      <>
        <p>{rn ?? "This report"} has been submitted, so it can't be edited here any more.</p>
        {rn && (
          <button type="button" class="btn" onClick={() => p.onOpenCase(rn)}>
            Open the case
          </button>
        )}
      </>,
    );

  const issues = attempted ? validate(form, "submit") : validate(form, "save").filter((i) => i.field !== "title");
  const err = (k: Issue["field"]) => issues.find((i) => i.field === k)?.message;
  const reqs = requirements(form);
  const doneN = reqs.filter((r) => r.done).length;
  const scenario = scenarioOptions(form);
  const program = scenarioProgram(form);
  const [tone, statusText] = saving
    ? ["busy", "Saving to MSRC…"]
    : saveError
      ? ["err", `Not saved to MSRC: ${saveError}`]
      : dirty
        ? ["dirty", id ? "Changes not saved to MSRC yet" : "Not on MSRC yet"]
        : id
          ? ["ok", `Saved to MSRC${savedAt ? ` ${ago(savedAt)}` : ""}`]
          : ["idle", "Nothing written yet"];

  const addCwe = () => {
    const c = normalizeCwe(cweDraft.replace(/,/g, ""));
    if (c && !form.cwes.map(normalizeCwe).includes(c)) set("cwes", [...form.cwes, c]);
    setCweDraft("");
  };

  return (
    <main class="report-page">
      <div class="report-main">
        {back}
        <header class="report-head">
          <h1>{id ? `Draft ${rn ?? ""}`.trim() : "New report"}</h1>
          <p class="report-head__sub">Saving keeps this as a draft on MSRC. Nothing reaches MSRC's engineers until you submit.</p>
        </header>

        {restoredAt && (
          <div class="note" role="status">
            <span>Restored text you hadn't saved to MSRC yet, from {when(new Date(restoredAt).toISOString())}.</span>
            <button type="button" class="link" onClick={discardLocal}>
              {serverForm ? "Use the version on MSRC" : "Start over"}
            </button>
          </div>
        )}

        <section class="rsec" aria-labelledby="sec-proof">
          <div class="rsec__heading">
            <span class="rsec__step" aria-hidden="true">01</span>
            <div>
              <h2 id="sec-proof">Proof of concept</h2>
              <p>Describe the issue clearly and include steps and evidence MSRC can use to reproduce it.</p>
            </div>
          </div>
          <Field id="title" label="Title" error={err("title")}>
            <Text id="in-title" class="rf__title" value={form.title} maxLength={200} placeholder="e.g. Elevation of privilege in ExampleService via …" onChange={(v) => set("title", v)} />
            <p class="rf__count">{Math.max(0, 200 - form.title.length)} of 200 characters remaining</p>
          </Field>
          <Field id="description" label="Vulnerability description" error={err("description")} hint="Markdown works. Screenshots go in Attachments; MSRC doesn't accept inline images.">
            <MdArea id="description" value={form.description} rows={10} min={LIMITS.description[0]} max={LIMITS.description[1]} placeholder="What is the bug, where is it, and what can an attacker do with it?" onChange={(v) => set("description", v)} />
          </Field>
          <Field id="reproductionSteps" label="Steps to reproduce" error={err("reproductionSteps")} hint="Exact enough to reproduce without guessing: setup, steps in order, expected and actual result.">
            <MdArea id="reproductionSteps" value={form.reproductionSteps} rows={10} max={LIMITS.reproductionSteps[1]} placeholder={"1. …\n2. …"} onChange={(v) => set("reproductionSteps", v)} />
          </Field>
          <Field id="callstack" label="Call stack" hint="If it crashes. Use a fenced code block to preserve stack formatting in the preview.">
            <MdArea id="callstack" value={form.callstack} rows={6} mono onChange={(v) => set("callstack", v)} />
          </Field>
          <div class="rsec__sub">
            <h3>Attachments</h3>
            <Attachments api={api} reportNumber={rn} onCount={setFileCount} onPending={setPendingFiles} />
          </div>
        </section>

        <section class="rsec" aria-labelledby="sec-impact">
          <div class="rsec__heading">
            <span class="rsec__step" aria-hidden="true">02</span>
            <div>
              <h2 id="sec-impact">Security impact</h2>
              <p>Choose the impact and identify the affected Microsoft products and components.</p>
            </div>
          </div>
          <div class="rf-row">
            <Field id="securityImpact" label="Security impact" error={err("securityImpact")}>
              <Select id="in-securityImpact" value={form.securityImpact} options={IMPACTS} onChange={(v) => set("securityImpact", v)} />
            </Field>
            {form.securityImpact === "AI_DERIVED_HARM" && (
              <Field id="aiSafetyImpact" label="AI harm category" error={err("aiSafetyImpact")}>
                <Select id="in-aiSafetyImpact" value={form.aiSafetyImpact} options={AI_HARMS} onChange={(v) => set("aiSafetyImpact", v)} />
              </Field>
            )}
          </div>

          <Field id="targets" label="Affected products" labelFor="in-targets" error={err("targets")} hint="The product, then the component the bug is in.">
            {form.targets.map((t, i) => (
              <div class="target" key={i}>
                <div class="target__row">
                  <Select id={i === 0 ? "in-targets" : undefined} label="Product" value={t.product} groups={GROUPS} placeholder="Choose a product…" onChange={(v) => setRow("targets", i, { product: v })} />
                  <Text label="Product version" placeholder="Product version" value={t.productVersion} onChange={(v) => setRow("targets", i, { productVersion: v })} />
                  {form.targets.length > 1 && (
                    <button type="button" class="btn btn--icon" aria-label="Remove this product" title="Remove this product" onClick={() => dropRow("targets", i)}>
                      ×
                    </button>
                  )}
                </div>
                <div class="target__row target__row--3">
                  <Text label="Component name" placeholder="Component name" value={t.componentName} onChange={(v) => setRow("targets", i, { componentName: v })} />
                  <Text label="Component version" placeholder="Component version" value={t.componentVersion} onChange={(v) => setRow("targets", i, { componentVersion: v })} />
                  <Text label="Component location" placeholder="Location (path)" value={t.componentLocation} onChange={(v) => setRow("targets", i, { componentLocation: v })} />
                </div>
              </div>
            ))}
            {form.targets.length < LIMITS.products && (
              <button type="button" class="link add" onClick={() => set("targets", [...form.targets, emptyTarget()])}>
                Add another product <span class="muted">({form.targets.length}/{LIMITS.products})</span>
              </button>
            )}
          </Field>

          {(form.securityImpact === "AI_DERIVED_HARM" || form.targets.some((t) => t.product === "AI")) && (
            <Field id="aiConversationId" label="AI conversation ID" error={err("aiConversationId")} hint="The AI-related conversation's unique ID, if available.">
              <Text id="in-aiConversationId" value={form.aiConversationId} maxLength={100} placeholder="123e4567-e89b-12d3-a456-426614174000" onChange={(v) => set("aiConversationId", v)} />
            </Field>
          )}

          {scenario && (
            <Field
              id="attackScenario"
              label="Attack scenario"
              error={err("attackScenario")}
              hint={
                program && (
                  <>
                    Required by the{" "}
                    <a href={program.link} target="_blank" rel="noopener">
                      {program.program}
                    </a>
                    .
                  </>
                )
              }
            >
              <Select id="in-attackScenario" value={form.attackScenario} options={scenario} onChange={(v) => set("attackScenario", v)} />
            </Field>
          )}
          {needsCanary(form) && (
            <Field id="devChannelRepro" label="Does it reproduce on the Windows Insider Canary Channel?" labelFor={false} error={err("devChannelRepro")} hint="The highest Windows Insider awards need the latest Canary build.">
              <Choice name="canary" labelledBy="l-devChannelRepro" value={form.devChannelRepro} options={CANARY.filter((o) => o.value !== "UNKNOWN" || form.devChannelRepro === "UNKNOWN")} onChange={(v) => set("devChannelRepro", v)} />
            </Field>
          )}
          <Field id="hasCrossTenantImpact" label="Does it affect more than one organization or Entra ID tenant?" labelFor={false}>
            <Choice name="tenant" labelledBy="l-hasCrossTenantImpact" value={form.hasCrossTenantImpact} options={CROSS_TENANT} onChange={(v) => set("hasCrossTenantImpact", v)} />
          </Field>
        </section>

        <section class="rsec" aria-labelledby="sec-ack">
          <div class="rsec__heading">
            <span class="rsec__step" aria-hidden="true">03</span>
            <div><h2 id="sec-ack">Acknowledgement</h2><p>Choose how you and any co-researchers should be credited.</p></div>
          </div>
          <Field id="acknowledgements" label="How MSRC credits you" labelFor={false} error={err("acknowledgements")} hint="Used if this becomes a CVE. Add co-researchers as contributors.">
            {!form.anonymousSubmission &&
              form.acknowledgements.map((a, i) => (
                <div class="ack" key={i}>
                  <div class="ack__row">
                    <Text label="Name" placeholder="Name as it should appear" value={a.name} onChange={(v) => setRow("acknowledgements", i, { name: v })} />
                    <Text label="Company" placeholder="Company (optional)" value={a.company} onChange={(v) => setRow("acknowledgements", i, { company: v })} />
                    <button type="button" class="btn btn--icon" aria-label="Remove this acknowledgement" title="Remove" onClick={() => dropRow("acknowledgements", i)}>
                      ×
                    </button>
                  </div>
                  <div class="target__row target__row--3">
                    <Text label="Company URL" type="url" placeholder="Company URL" value={a.companyUrl} onChange={(v) => setRow("acknowledgements", i, { companyUrl: v })} />
                    <Text label="Email" type="email" placeholder="Email" value={a.emailAddress} onChange={(v) => setRow("acknowledgements", i, { emailAddress: v })} />
                    <Text label="Social profile" type="url" placeholder="Social profile URL" value={a.socialMediaUrl} onChange={(v) => setRow("acknowledgements", i, { socialMediaUrl: v })} />
                  </div>
                </div>
              ))}
            {!form.anonymousSubmission && (
              <div class="row-actions">
                <button type="button" class="link add" onClick={() => set("acknowledgements", [...form.acknowledgements, emptyAck()])}>
                  Add a contributor
                </button>
                {defaults?.ack?.name && !form.acknowledgements.some((a) => a.name === defaults.ack!.name) && (
                  <button type="button" class="link add" onClick={() => set("acknowledgements", [...form.acknowledgements, defaults.ack!])}>
                    Add my profile acknowledgement
                  </button>
                )}
              </div>
            )}
            <label class="tick">
              <input type="checkbox" checked={form.anonymousSubmission} onChange={(e) => set("anonymousSubmission", (e.target as HTMLInputElement).checked)} />
              Submit anonymously, without public acknowledgement
            </label>
          </Field>
        </section>

        <section class="rsec" aria-labelledby="sec-disc">
          <div class="rsec__heading">
            <span class="rsec__step" aria-hidden="true">04</span>
            <div><h2 id="sec-disc">Public disclosure</h2><p>Tell MSRC if you plan to publish or present this report.</p></div>
          </div>
          <Field id="disclosures" label="Do you plan to disclose this report publicly?" labelFor={false} error={err("disclosures")} hint="Agree the timing with your MSRC case manager.">
            <YesNo
              name="plans"
              labelledBy="l-disclosures"
              value={form.plansDisclosure}
              onChange={(v) => {
                set("plansDisclosure", v);
                if (v && form.disclosures.length === 0) set("disclosures", [emptyDisclosure()]);
              }}
            />
            {form.plansDisclosure && (
              <div class="disc-list">
                {form.disclosures.map((d, i) => (
                  <div class="disc" key={i}>
                    <Text label="Where" placeholder="Blog, talk or venue" value={d.name} onChange={(v) => setRow("disclosures", i, { name: v })} />
                    <Select label="Medium" value={d.medium} options={MEDIA} placeholder="Medium…" onChange={(v) => setRow("disclosures", i, { medium: v })} />
                    <Text label="Planned date" type="date" value={d.date} onChange={(v) => setRow("disclosures", i, { date: v })} />
                    <button type="button" class="btn btn--icon" aria-label="Remove this disclosure" title="Remove" onClick={() => dropRow("disclosures", i)}>
                      ×
                    </button>
                  </div>
                ))}
                {form.disclosures.length < LIMITS.disclosures && (
                  <button type="button" class="link add" onClick={() => set("disclosures", [...form.disclosures, emptyDisclosure()])}>
                    Add another disclosure <span class="muted">({form.disclosures.length}/{LIMITS.disclosures})</span>
                  </button>
                )}
              </div>
            )}
          </Field>
        </section>

        <details class="rsec rsec--more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>
            <h2>Additional information</h2>
            <span class="muted small">CWE, CVSS, links, variants, exploitation, tracking ID</span>
          </summary>
          <Field id="cwes" label="CWE" labelFor="in-cwe" error={err("cwes")}>
            <div class="chips">
              {form.cwes.map((c, i) => (
                <span class="chip" key={c + i}>
                  {normalizeCwe(c)}
                  <button type="button" aria-label={`Remove ${normalizeCwe(c)}`} onClick={() => set("cwes", form.cwes.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </span>
              ))}
              <input
                id="in-cwe"
                class="input chips__input"
                placeholder="Add a CWE, e.g. 416"
                value={cweDraft}
                onInput={(e) => setCweDraft((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addCwe();
                  }
                }}
                onBlur={addCwe}
              />
            </div>
          </Field>
          <Field id="cvssVectorString" label="CVSS vector" error={err("cvssVectorString")}>
            <Text id="in-cvssVectorString" class="is-mono" maxLength={200} placeholder="CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H" value={form.cvssVectorString} onChange={(v) => set("cvssVectorString", v)} />
          </Field>
          <Field id="links" label="Links" labelFor={false} error={err("links")} hint="Write-ups, references, related issues.">
            {form.links.map((l, i) => (
              <div class="link-row" key={i}>
                <Select label="Link type" value={l.type} options={LINK_TYPES} placeholder="Type…" onChange={(v) => setRow("links", i, { type: v })} />
                <Text label="Link title" placeholder="Title" value={l.title} onChange={(v) => setRow("links", i, { title: v })} />
                <Text label="URL" type="url" placeholder="https://…" value={l.url} onChange={(v) => setRow("links", i, { url: v })} />
                <button type="button" class="btn btn--icon" aria-label="Remove this link" title="Remove" onClick={() => dropRow("links", i)}>
                  ×
                </button>
              </div>
            ))}
            {form.links.length < LIMITS.links && <button type="button" class="link add" onClick={() => set("links", [...form.links, emptyLink()])}>
              Add a link
            </button>}
          </Field>
          <div class="rf-row">
            <Field id="isPublic" label="Is the issue public?" labelFor={false}>
              <YesNo name="public" labelledBy="l-isPublic" value={form.isPublic} onChange={(v) => set("isPublic", v)} />
            </Field>
            <Field id="isExploited" label="Actively exploited?" labelFor={false}>
              <YesNo name="exploited" labelledBy="l-isExploited" value={form.isExploited} onChange={(v) => set("isExploited", v)} />
            </Field>
          </div>
          {form.isExploited && (
            <>
              <Field id="isExploitedDiscovery" label="Active exploit discovery" error={err("isExploitedDiscovery")} hint="Where or how was this discovered as an active exploit?">
                <MdArea id="isExploitedDiscovery" value={form.isExploitedDiscovery} rows={4} max={1000} onChange={(v) => set("isExploitedDiscovery", v)} />
              </Field>
              <Field id="isExploitedScale" label="Active exploit scale" error={err("isExploitedScale")} hint="At what scale is it being exploited?">
                <MdArea id="isExploitedScale" value={form.isExploitedScale} rows={4} max={1000} onChange={(v) => set("isExploitedScale", v)} />
              </Field>
            </>
          )}
          <Field id="isMissedFix" label="Is this a missed fix or a variant of an earlier CVE or case?" labelFor={false}>
            <YesNo name="variant" labelledBy="l-isMissedFix" value={form.isMissedFix} onChange={(v) => set("isMissedFix", v)} />
          </Field>
          {form.isMissedFix && (
            <div class="rf-row">
              <Field id="variantCaseOrSubmission" label="Your existing case" error={err("variantCaseOrSubmission")}>
                <Text id="in-variantCaseOrSubmission" list="my-cases" placeholder="VULN-123456" value={form.variantCaseOrSubmission} onChange={(v) => set("variantCaseOrSubmission", v.trim().toUpperCase())} />
                <datalist id="my-cases">
                  {p.cases.map((c) => (
                    <option key={c.reportNumber} value={c.reportNumber}>
                      {c.title}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field id="variantOrRelatedCVE" label="Related CVE" error={err("variantOrRelatedCVE")}>
                <Text id="in-variantOrRelatedCVE" placeholder="CVE-2026-12345" value={form.variantOrRelatedCVE} onChange={(v) => set("variantOrRelatedCVE", v.trim().toUpperCase())} />
              </Field>
            </div>
          )}
          <Field id="externalId" label="External tracking ID" hint="Your own reference, for example a ticket in your tracker.">
            <Text id="in-externalId" value={form.externalId} onChange={(v) => set("externalId", v)} />
          </Field>
        </details>
      </div>

      <aside class="side" aria-label="Save and submit">
        <div class="side__card">
          <p class={`side__status is-${tone}`}>
            <span class="sdot" aria-hidden="true" />
            <span>{statusText}</span>
          </p>
          <button type="button" class="btn btn--primary btn--wide" disabled={saving || (!dirty && !!id)} onClick={() => void save().catch(() => undefined)}>
            {saving ? "Saving…" : "Save draft"}
            <kbd class="kbd">Ctrl S</kbd>
          </button>
        </div>

        <div class="side__card">
          <div class="side__head">
            <h2 class="side__title">Ready to submit</h2>
            <span class="side__n">
              {doneN} of {reqs.length}
            </span>
          </div>
          <div class="meter" aria-hidden="true">
            <span style={{ width: `${(doneN / reqs.length) * 100}%` }} />
          </div>
          <ul class="checks">
            {reqs.map((r) => (
              <li key={r.field}>
                <button type="button" class={`check${r.done ? " is-done" : ""}`} onClick={() => focusField(r.field)}>
                  <span class="check__mark" aria-hidden="true">
                    {r.done ? "✓" : ""}
                  </span>
                  <span class="check__label">
                    {r.label}
                    <span class="sr-only">{r.done ? " (done)" : " (missing)"}</span>
                    {r.detail && <span class="check__detail">{r.detail}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" class="btn btn--wide side__preview" onClick={() => setPreviewOpen(true)}>
            Preview report
          </button>
          <button
            type="button"
            class="btn btn--go btn--wide"
            disabled={saving}
            onClick={() => {
              setAttempted(true);
              setSubmitOpen(true);
            }}
          >
            Submit to MSRC…
          </button>
        </div>

        <div class="side__links">
          {rn && (
            <a href={portalDraftUrl(rn)} target="_blank" rel="noopener">
              Open this draft in the portal
            </a>
          )}
          <button type="button" class="link link--danger" onClick={() => setDeleteOpen(true)}>
            {id ? "Delete draft…" : "Discard…"}
          </button>
        </div>
      </aside>

      {previewOpen && <ReportPreviewDialog form={form} onClose={() => setPreviewOpen(false)} />}
      {submitOpen && (
        <SubmitDialog
          form={form}
          issues={validate(form, "submit")}
          fileCount={fileCount}
          pendingFiles={pendingFiles}
          onCheck={checkBeforeSubmit}
          onClose={() => setSubmitOpen(false)}
          onFix={(field) => {
            setSubmitOpen(false);
            setTimeout(() => focusField(field), 50);
          }}
          onSubmit={submit}
          onDone={p.onLeave}
        />
      )}
      {deleteOpen && <DeleteDialog onMsrc={!!id} onCancel={() => setDeleteOpen(false)} onConfirm={remove} />}
    </main>
  );
}

function DeleteDialog(p: { onMsrc: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      class="dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else p.onCancel();
      }}
    >
      <h2>{p.onMsrc ? "Delete this draft?" : "Discard this report?"}</h2>
      <p class="dialog__lead">{p.onMsrc ? "This deletes the draft on MSRC, attached files included. It can't be undone." : "This throws away what you've written here. Nothing was saved to MSRC."}</p>
      {error && (
        <p class="rf__err" role="alert">
          {error}
        </p>
      )}
      <div class="dialog__actions">
        <button type="button" class="btn" disabled={busy} onClick={p.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn--danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            p.onConfirm().catch((e) => {
              setError(errorText(e));
              setBusy(false);
            });
          }}
        >
          {busy ? "Deleting…" : p.onMsrc ? "Delete draft" : "Discard"}
        </button>
      </div>
    </dialog>
  );
}
