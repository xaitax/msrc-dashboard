// The last step: either what is still missing, or a summary plus a typed
// confirmation. Submitting cannot be undone, so the button needs "SUBMIT".
import { useEffect, useRef, useState } from "preact/hooks";
import { IMPACTS, PRODUCT_LABEL, type Issue, type ReportForm } from "../../../core/reportForm";
import { errorText } from "../../../shared/protocol";

const WORD = "SUBMIT";

export function SubmitDialog(p: {
  form: ReportForm;
  issues: Issue[];
  fileCount: number | null;
  /** Files picked in Attachments but not (yet) attached to the draft. */
  pendingFiles?: number;
  onClose: () => void;
  onFix: (field: Issue["field"]) => void;
  /** Saves, submits; resolves with the report number. */
  onSubmit: () => Promise<string>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"confirm" | "working" | "done">("confirm");
  const [error, setError] = useState<string | null>(null);
  const [rn, setRn] = useState("");
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

  return (
    <dialog
      ref={ref}
      class="dialog dialog--submit"
      onCancel={(e) => {
        if (phase === "working") e.preventDefault();
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
      ) : (
        <>
          <h2>Submit this report to MSRC?</h2>
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
