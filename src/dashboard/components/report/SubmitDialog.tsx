// The last step: either what is still missing, or a summary plus a typed
// confirmation. Submitting cannot be undone, so the button needs "SUBMIT".
import { useEffect, useRef, useState } from "preact/hooks";
import { IMPACTS, PRODUCT_LABEL, type Issue, type ReportForm } from "../../../core/reportForm";
import { errorText } from "../../../shared/protocol";
import type { ReportAnalysis, QualityResult } from "../../reportApi";

const WORD = "SUBMIT";

export function SubmitDialog(p: {
  form: ReportForm;
  issues: Issue[];
  fileCount: number | null;
  /** Files picked in Attachments but not (yet) attached to the draft. */
  pendingFiles?: number;
  onClose: () => void;
  onFix: (field: Issue["field"]) => void;
  /** Saves a draft, then runs the same advisory checks the portal uses. */
  onCheck: () => Promise<{ analysis: ReportAnalysis; quality: QualityResult }>;
  /** Saves, submits; resolves with the report number. */
  onSubmit: () => Promise<string>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"confirm" | "working" | "done">("confirm");
  const [error, setError] = useState<string | null>(null);
  const [rn, setRn] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ analysis: ReportAnalysis; quality: QualityResult } | null>(null);
  const [skipChecks, setSkipChecks] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  const f = p.form;
  const products = f.targets.filter((t) => t.product).map((t) => [PRODUCT_LABEL[t.product] ?? t.product, t.productVersion].filter(Boolean).join(" "));
  const impact = IMPACTS.find((i) => i.value === f.securityImpact)?.label ?? f.securityImpact;
  const credit = f.anonymousSubmission ? "Anonymous" : f.acknowledgements.map((a) => a.name).filter(Boolean).join(", ");

  const go = async () => {
    setPhase("working");
    setError(null);
    try {
      setRn(await p.onSubmit());
      setPhase("done");
    } catch (e) {
      setError(errorText(e));
      setPhase("confirm");
    }
  };

  const check = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setChecks(await p.onCheck());
    } catch (e) {
      setCheckError(errorText(e));
    } finally {
      setChecking(false);
    }
  };
  const gateNames: Record<string, string> = {
    MISSING_ATTACHMENT: "No attachment",
    LOW_QUALITY_REPRO: "Steps may be hard to reproduce",
    MISSING_POC: "No proof of concept",
  };
  const tips = Array.isArray(checks?.analysis.educationalTips)
    ? checks.analysis.educationalTips.map((t: unknown) => typeof t === "string" ? t : t && typeof t === "object" ? String((t as Record<string, unknown>)["text"] ?? (t as Record<string, unknown>)["message"] ?? JSON.stringify(t)) : String(t))
    : [];

  return (
    <dialog
      ref={ref}
      class="dialog dialog--submit"
      onCancel={(e) => {
        if (phase === "working" || checking) e.preventDefault();
        else p.onClose();
      }}
    >
      {p.issues.length > 0 ? (
        <>
          <h2>A few things before you submit</h2>
          <p class="dialog__lead">MSRC's form requires these.</p>
          <ul class="issues">
            {p.issues.map((i) => (
              <li key={i.field + i.message}>
                <span>{i.message}</span>
                <button type="button" class="link" onClick={() => p.onFix(i.field)}>
                  Show
                </button>
              </li>
            ))}
          </ul>
          <div class="dialog__actions">
            <button type="button" class="btn" onClick={p.onClose}>
              Back to the report
            </button>
          </div>
        </>
      ) : phase === "done" ? (
        <>
          <h2>Submitted</h2>
          <p class="dialog__done">{rn || "Your report"} is now with MSRC.</p>
          <p class="dialog__lead">It moves from Drafts to the board after the next sync, usually within a minute or two.</p>
          <div class="dialog__actions">
            <button type="button" class="btn btn--primary" onClick={p.onDone}>
              Back to cases
            </button>
          </div>
        </>
      ) : !checks && !skipChecks ? (
        <>
          <h2>Check this report with MSRC</h2>
          <p class="dialog__lead">MSRC checks whether this looks like an MSRC case and whether the reproduction and evidence may need work. These are advisory; the final submit still needs your confirmation.</p>
          <p class="dialog__note">Checking saves a draft on MSRC first. This keeps the AI check on the same draft and avoids creating an extra one.</p>
          {!!p.pendingFiles && <p class="dialog__warn" role="alert">Attach your {p.pendingFiles === 1 ? "picked file" : "picked files"} before checking so the attachment check is accurate.</p>}
          {checkError && <p class="rf__err" role="alert">MSRC check failed: {checkError}</p>}
          <div class="dialog__actions">
            <button type="button" class="btn" onClick={p.onClose} disabled={checking}>Back to the report</button>
            {checkError && <button type="button" class="btn" onClick={() => setSkipChecks(true)}>Continue without checks</button>}
            <button type="button" class="btn btn--go" onClick={() => void check()} disabled={checking || !!p.pendingFiles}>{checking ? "Checking…" : checkError ? "Retry checks" : "Run MSRC checks"}</button>
          </div>
        </>
      ) : (
        <>
          <h2>Submit this report to MSRC?</h2>
          {checks && (
            <div class="dialog__check-results" role="status">
              <p><b>MSRC AI assessment:</b> {checks.analysis.isMsrc === false ? "May be outside MSRC's scope" : checks.analysis.isMsrc === true ? "Looks like an MSRC case" : checks.analysis.classification ?? "No classification"}{checks.analysis.confidence != null ? ` (${Math.round(checks.analysis.confidence * 100)}% confidence)` : ""}</p>
              {checks.analysis.reason && <p>{checks.analysis.reason}</p>}
              {checks.analysis.suggestedCategory && <p>Suggested category: {checks.analysis.suggestedCategory}</p>}
              {tips.length > 0 && <ul>{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}
              <p><b>Quality checks:</b> {checks.quality.gatesTriggered.filter((g) => g.aiConfirmed).length ? "MSRC suggests improving:" : "No quality concerns confirmed."}</p>
              {checks.quality.gatesTriggered.some((g) => g.aiConfirmed) && <ul>{checks.quality.gatesTriggered.filter((g) => g.aiConfirmed).map((g) => <li key={g.gate}>{gateNames[g.gate] ?? g.gate}</li>)}</ul>}
            </div>
          )}
          {skipChecks && <p class="dialog__warn" role="alert">MSRC checks did not complete. MSRC will still run its server checks when you submit.</p>}
          <dl class="sum">
            <dt>Title</dt>
            <dd>{f.title}</dd>
            <dt>Impact</dt>
            <dd>{impact}</dd>
            <dt>{products.length === 1 ? "Product" : "Products"}</dt>
            <dd>{products.join(", ")}</dd>
            <dt>Attachments</dt>
            <dd>{p.fileCount === null ? "—" : p.fileCount === 0 ? "None" : `${p.fileCount} ${p.fileCount === 1 ? "file" : "files"}`}</dd>
            <dt>Credit</dt>
            <dd>{credit || "—"}</dd>
          </dl>
          {!!p.pendingFiles && (
            <p class="dialog__warn" role="alert">
              {p.pendingFiles === 1
                ? "1 file is picked but not attached. Attach it first, or it won't be part of the report."
                : `${p.pendingFiles} files are picked but not attached. Attach them first, or they won't be part of the report.`}
            </p>
          )}
          <p class="dialog__note">MSRC gets the report as soon as you submit, and it can't be edited afterwards. Anything you add later goes through messages on the case. Unsaved changes are saved first.</p>
          <label class="confirm">
            <span>
              Type <b>{WORD}</b> to confirm
            </span>
            <input class="input" value={typed} autocomplete="off" spellcheck={false} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} disabled={phase === "working"} />
          </label>
          {error && (
            <p class="rf__err" role="alert">
              {error}
            </p>
          )}
          <div class="dialog__actions">
            <button type="button" class="btn" onClick={p.onClose} disabled={phase === "working"}>
              Cancel
            </button>
            <button type="button" class="btn btn--go" disabled={typed.trim() !== WORD || phase === "working"} onClick={() => void go()}>
              {phase === "working" ? "Submitting…" : "Submit to MSRC"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
