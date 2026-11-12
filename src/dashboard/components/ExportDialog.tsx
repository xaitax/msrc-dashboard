import { useEffect, useRef, useState } from "preact/hooks";
import { buildExport, exportFileName } from "../../core/exportBuild";
import { humanizeEnum } from "../../core/derive";
import type { ViewModel } from "../data";
import { caseLabel } from "../format";

const GENERATOR = `MSRC Dashboard ${chrome.runtime.getManifest().version}`;

/** Export with the case selection inside the dialog (the board stays clean). */
export function ExportDialog({ view, onClose }: { view: ViewModel; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(view.rows.map((r) => r.reportNumber)));
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => ref.current?.showModal(), []);

  const all = picked.size === view.rows.length;
  const toggle = (rn: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(rn)) n.delete(rn);
      else n.add(rn);
      return n;
    });

  const download = () => {
    const now = new Date().toISOString();
    const doc = buildExport(
      {
        cases: view.rows.map((r) => r.record),
        messages: view.messages,
        events: view.events,
        history: view.history,
        publicCves: Object.fromEntries(view.rows.map((r) => [r.reportNumber, r.publicCves])),
        publicUnlinked: view.publicUnlinked,
      },
      { scope: all ? "all" : "selected", selected: [...picked], generator: GENERATOR, now },
    );
    const name = exportFileName(now);
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setDone(`Saved ${name} with ${doc.caseCount} ${doc.caseCount === 1 ? "case" : "cases"}.`);
  };

  return (
    <dialog ref={ref} class="dialog" onClose={onClose} aria-labelledby="export-title">
      <h2 id="export-title">Export submissions</h2>
      <p class="dialog__lead">One JSON file with every detail: report text, all messages, status changes, file names and the raw API data, ready to hand to an AI to update your case folders.</p>
      <div class="pick__head">
        <span>
          {picked.size} of {view.rows.length} cases
        </span>
        <button class="link" onClick={() => setPicked(all ? new Set() : new Set(view.rows.map((r) => r.reportNumber)))}>
          {all ? "Select none" : "Select all"}
        </button>
      </div>
      <ul class="pick">
        {view.rows.map((r) => (
          <li key={r.reportNumber}>
            <label>
              <input type="checkbox" checked={picked.has(r.reportNumber)} onChange={() => toggle(r.reportNumber)} />
              <b>{caseLabel(r)}</b>
              <span class="pick__title">{r.title}</span>
              <span class="muted">{humanizeEnum(r.status)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p class="dialog__note">Attached files are listed by name and date; the portal doesn't let researchers download them.</p>
      {done && (
        <p class="dialog__done" role="status">
          {done}
        </p>
      )}
      <div class="dialog__actions">
        <button class="btn" onClick={() => ref.current?.close()}>
          {done ? "Close" : "Cancel"}
        </button>
        <button class="btn btn--primary" onClick={download} disabled={picked.size === 0}>
          Download JSON
        </button>
      </div>
    </dialog>
  );
}
