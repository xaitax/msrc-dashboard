// Local preview of the report's Markdown fields. It makes no API call and
// uses the same safe renderer as submitted case text.
import { useEffect, useRef } from "preact/hooks";
import type { ReportForm } from "../../../core/reportForm";
import { Markdown } from "../Markdown";

function Section({ title, text }: { title: string; text: string }) {
  return (
    <section class="report-preview__section">
      <h3>{title}</h3>
      {text.trim() ? <Markdown src={text} /> : <p class="muted">Nothing written yet.</p>}
    </section>
  );
}

export function ReportPreviewDialog({ form, onClose }: { form: ReportForm; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} class="dialog dialog--report-preview" onCancel={onClose}>
      <h2>Report preview</h2>
      <p class="dialog__lead">This is a local preview of the report text. MSRC's portal may render some Markdown differently.</p>
      <div class="report-preview__body">
        <h3 class="report-preview__title">{form.title.trim() || "Untitled report"}</h3>
        <Section title="Vulnerability description" text={form.description} />
        <Section title="Steps to reproduce" text={form.reproductionSteps} />
        {form.callstack.trim() && <Section title="Call stack" text={form.callstack} />}
        {form.isExploited && form.isExploitedDiscovery.trim() && <Section title="Active exploit discovery" text={form.isExploitedDiscovery} />}
        {form.isExploited && form.isExploitedScale.trim() && <Section title="Active exploit scale" text={form.isExploitedScale} />}
      </div>
      <div class="dialog__actions">
        <button type="button" class="btn btn--primary" onClick={onClose}>Back to editing</button>
      </div>
    </dialog>
  );
}
