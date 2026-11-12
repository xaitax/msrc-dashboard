import { useEffect, useRef, useState } from "preact/hooks";
import { MEDIA } from "../../core/reportForm";
import { errorText } from "../../shared/protocol";
import type { DisclosureInput, ReportApi } from "../reportApi";

// Planned public disclosures (talks, blog posts) on a submitted case, as the
// portal's Disclosure tab manages them. Every change goes to MSRC only from a
// dialog's own button; cancelling asks first.

type Event = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isCancelled = (e: Event) => e["status"] === "CANCELLED";
const mediumLabel = (v: unknown) => MEDIA.find((m) => m.value === v)?.label ?? "Other";
const dayOf = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : "");

function Name({ name }: { name: string }) {
  if (/^https:\/\/\S+$/i.test(name))
    return (
      <a href={name} target="_blank" rel="noopener noreferrer">
        {name.replace(/^https:\/\//i, "")}
      </a>
    );
  return <>{name || "Unnamed disclosure"}</>;
}

interface Props {
  api: ReportApi;
  reportNumber: string;
  events: Event[];
  /** MSRC took a change: refresh the case. */
  onChanged: () => void;
}

export function Disclosures({ api, reportNumber, events, onChanged }: Props) {
  const [editing, setEditing] = useState<{ id: string | null; form: DisclosureInput } | null>(null);
  const [cancelling, setCancelling] = useState<Event | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const done = (what: string) => {
    setEditing(null);
    setCancelling(null);
    setNote(`${what}. MSRC has it; the case shows the change after the next sync.`);
    onChanged();
  };

  return (
    <div class="plan">
      {events.length > 0 ? (
        <ul class="plan__list">
          {events.map((e, i) => (
            <li key={str(e["id"]) || i} class={`plan__item${isCancelled(e) ? " is-cancelled" : ""}`}>
              <span class="plan__name">
                <Name name={str(e["name"]).trim()} />
              </span>
              <span class="plan__meta">
                {mediumLabel(e["medium"])}, {dayOf(e["date"]) || "no date yet"}
              </span>
              {isCancelled(e) ? (
                <span class="plan__state">Cancelled</span>
              ) : (
                str(e["id"]) && (
                  <span class="plan__actions">
                    <button type="button" class="link" onClick={() => setEditing({ id: str(e["id"]), form: { medium: str(e["medium"]) || "OTHER", name: str(e["name"]), date: dayOf(e["date"]) } })}>
                      Edit
                    </button>
                    <button type="button" class="link link--danger" onClick={() => setCancelling(e)}>
                      Cancel
                    </button>
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted plan__none">No planned disclosure.</p>
      )}
      <button type="button" class="link add" onClick={() => setEditing({ id: null, form: { medium: "BLOG", name: "", date: "" } })}>
        Add a planned disclosure
      </button>
      {note && (
        <p class="plan__note" role="status">
          {note}
        </p>
      )}
      {editing && (
        <EditDialog
          initial={editing.form}
          isNew={!editing.id}
          onClose={() => setEditing(null)}
          onSave={async (form) => {
            if (editing.id) await api.updateDisclosure(reportNumber, editing.id, form);
            else await api.addDisclosure(reportNumber, form);
            done(editing.id ? "Saved" : "Added");
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          name={str(cancelling["name"]).trim() || "Unnamed disclosure"}
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            await api.cancelDisclosure(reportNumber, str(cancelling["id"]));
            done("Cancelled");
          }}
        />
      )}
    </div>
  );
}

/** A modal that stays up while its request runs, and shows why it failed. */
function useWrite(onClose: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const inflight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => ref.current?.showModal(), []);
  const run = async (fn: () => Promise<void>) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return;
    } catch (e) {
      setError(errorText(e));
    }
    inflight.current = false;
    setBusy(false);
  };
  const dialogProps = {
    ref,
    onCancel: (e: Event | globalThis.Event) => {
      (e as globalThis.Event).preventDefault();
      if (!inflight.current) onClose();
    },
    onClose: () => {
      if (inflight.current) ref.current?.showModal();
      else onClose();
    },
  };
  return { dialogProps, busy, error, run };
}

function EditDialog({ initial, isNew, onClose, onSave }: { initial: DisclosureInput; isNew: boolean; onClose: () => void; onSave: (f: DisclosureInput) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const { dialogProps, busy, error, run } = useWrite(onClose);
  const set = (k: keyof DisclosureInput, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const unchanged = !isNew && form.name.trim() === initial.name.trim() && form.medium === initial.medium && form.date === initial.date;
  return (
    <dialog {...dialogProps} class="dialog dialog--plan">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => onSave({ ...form, name: form.name.trim() }));
        }}
      >
        <h2>{isNew ? "Add a planned disclosure" : "Change this planned disclosure"}</h2>
        <p class="dialog__lead">Agree the timing with your MSRC case manager. MSRC sees this on the case right away.</p>
        <div class="plan__form">
          <label for="disc-medium">Medium</label>
          <select id="disc-medium" class="input" value={form.medium} onChange={(e) => set("medium", (e.target as HTMLSelectElement).value)}>
            {MEDIA.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <label for="disc-name">Where</label>
          <input id="disc-name" class="input" type="text" placeholder="Blog post URL, talk or venue" value={form.name} onInput={(e) => set("name", (e.target as HTMLInputElement).value)} />
          <label for="disc-date">Planned date</label>
          <input id="disc-date" class="input" type="date" value={form.date} onInput={(e) => set("date", (e.target as HTMLInputElement).value)} />
        </div>
        {error && (
          <p class="rf__err" role="alert">
            {error}
          </p>
        )}
        <div class="dialog__actions">
          <button type="button" class="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="submit" class="btn btn--go" disabled={busy || !form.name.trim() || unchanged}>
            {busy ? "Saving…" : isNew ? "Add disclosure" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function CancelDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const { dialogProps, busy, error, run } = useWrite(onClose);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <dialog {...dialogProps} class="dialog dialog--plan">
      <h2>Cancel “{name}”?</h2>
      <p class="dialog__lead">MSRC is told you no longer plan this disclosure. It stays on the case as cancelled and can't be reopened.</p>
      {error && (
        <p class="rf__err" role="alert">
          {error}
        </p>
      )}
      <div class="dialog__actions">
        <button type="button" class="btn" ref={keepRef} onClick={onClose} disabled={busy}>
          Keep it
        </button>
        <button type="button" class="btn btn--danger" onClick={() => void run(onConfirm)} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel disclosure"}
        </button>
      </div>
    </dialog>
  );
}
