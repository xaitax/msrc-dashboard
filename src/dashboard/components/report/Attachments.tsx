// Attachments on a draft. Files are encrypted in the page and uploaded one by
// one after a confirmation, because MSRC offers no way to remove a file again.
import { useEffect, useRef, useState } from "preact/hooks";
import type { DraftFile, ReportApi } from "../../reportApi";
import { when } from "../../format";
import { fmtSize } from "../../format";
import { errorText } from "../../../shared/protocol";

type Item = { key: string; file: File; state: "ready" | "working" | "done" | "failed"; error?: string };

export function Attachments({ api, reportNumber, onCount, onPending }: { api: ReportApi; reportNumber: string | null; onCount: (n: number) => void; onPending?: (n: number) => void }) {
  const [files, setFiles] = useState<DraftFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const dlg = useRef<HTMLDialogElement | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  useEffect(() => onPending?.(queue.filter((x) => x.state !== "done").length), [queue, onPending]);

  const refresh = () => {
    if (!reportNumber) return;
    api
      .listDraftFiles(reportNumber)
      .then((f) => {
        setFiles(f);
        setListError(null);
        onCount(f.length);
      })
      .catch((e) => setListError(errorText(e)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per report number
  useEffect(refresh, [reportNumber]);
  useEffect(() => {
    if (confirming) dlg.current?.showModal();
    else dlg.current?.close();
  }, [confirming]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const fresh = [...list].map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, state: "ready" as const }));
    setQueue((q) => [...q.filter((x) => x.state !== "done"), ...fresh]);
  };
  const ready = queue.filter((x) => x.state === "ready" || x.state === "failed");

  const upload = async () => {
    if (!reportNumber) return;
    setConfirming(false);
    setBusy(true);
    for (const item of ready) {
      if (!queueRef.current.some((x) => x.key === item.key)) continue; // removed meanwhile: never attach it
      setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, state: "working", error: undefined } : x)));
      try {
        await api.attach(reportNumber, { name: item.file.name, bytes: new Uint8Array(await item.file.arrayBuffer()) });
        setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, state: "done" } : x)));
      } catch (e) {
        setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, state: "failed", error: errorText(e) } : x)));
      }
    }
    setBusy(false);
    setQueue((q) => q.filter((x) => x.state !== "done")); // now listed under "On MSRC"
    refresh();
  };

  if (!reportNumber) {
    return <p class="rf__hint">Save the draft first. Attachments go onto the draft on MSRC, so it has to exist there.</p>;
  }

  return (
    <div class="att">
      <label
        class={`drop${over ? " is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer?.files ?? null);
        }}
      >
        <input type="file" multiple class="sr-only" onChange={(e) => add((e.target as HTMLInputElement).files)} />
        <b>Drop files here or choose files</b>
        <span class="muted small">Proof of concept, scripts, crash dumps, screenshots, video. Encrypted before upload, like in the portal.</span>
      </label>

      {queue.length > 0 && (
        <ul class="flist flist--queue">
          {queue.map((x) => (
            <li key={x.key} class={`is-${x.state}`}>
              <span class="flist__name">{x.file.name}</span>
              <span class="muted">{fmtSize(x.file.size)}</span>
              <span class="flist__state">
                {x.state === "ready" ? "Not attached yet" : x.state === "working" ? "Encrypting and uploading…" : x.state === "done" ? "Attached" : x.error}
              </span>
              {x.state !== "working" && x.state !== "done" && (
                <button type="button" class="link" onClick={() => setQueue((q) => q.filter((y) => y.key !== x.key))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ready.length > 0 && (
        <div class="att__go">
          <button type="button" class="btn" disabled={busy} onClick={() => setConfirming(true)}>
            Attach {ready.length} {ready.length === 1 ? "file" : "files"} to {reportNumber}…
          </button>
        </div>
      )}

      <h3 class="att__head">On MSRC</h3>
      {listError ? (
        <p class="rf__err">Couldn't list the attached files: {listError}</p>
      ) : files === null ? (
        <p class="muted small">Loading…</p>
      ) : files.length === 0 ? (
        <p class="muted small">No files attached yet.</p>
      ) : (
        <ul class="flist">
          {files.map((f) => (
            <li key={f.id}>
              <span class="flist__name">{f.name}</span>
              <span class="muted">{f.createdOn ? when(f.createdOn) : ""}</span>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={dlg} class="dialog" onCancel={() => setConfirming(false)}>
        <h2>
          Attach {ready.length} {ready.length === 1 ? "file" : "files"} to {reportNumber}?
        </h2>
        <p class="dialog__lead">MSRC has no way to remove an attached file, so check these are the right ones.</p>
        <ul class="flist">
          {ready.map((x) => (
            <li key={x.key}>
              <span class="flist__name">{x.file.name}</span>
              <span class="muted">{fmtSize(x.file.size)}</span>
            </li>
          ))}
        </ul>
        <div class="dialog__actions">
          <button type="button" class="btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" class="btn btn--primary" onClick={() => void upload()}>
            Attach {ready.length === 1 ? "file" : "files"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
