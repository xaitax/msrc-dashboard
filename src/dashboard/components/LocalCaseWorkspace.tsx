import { useEffect, useRef, useState } from "preact/hooks";
import { addTag, sortedTags, tagKey } from "../../core/annotations";
import { updateCaseAnnotation } from "../../store/db";
import type { CaseAnnotation } from "../../shared/types";

export function LocalCaseWorkspace({ annotation, knownTags, onChanged, onSelectTag }: { annotation: CaseAnnotation; knownTags: string[]; onChanged: () => void; onSelectTag: (tag: string) => void }) {
  const [note, setNote] = useState(annotation.note);
  const [tags, setTags] = useState(annotation.tags);
  const [input, setInput] = useState("");
  const [saveState, setSaveState] = useState("");
  const [open, setOpen] = useState(false);
  const sequence = useRef(0);
  const lastNoteSave = useRef<Promise<void>>(Promise.resolve());
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);

  const saveNote = (value: string) => {
    setNote(value);
    setSaveState("Saving…");
    const current = ++sequence.current;
    lastNoteSave.current = updateCaseAnnotation(annotation.reportNumber, { note: value })
      .then(() => { if (sequence.current === current) setSaveState("Saved locally"); })
      .catch(() => { if (sequence.current === current) setSaveState("Could not save note"); });
  };

  const saveTags = (next: string[]) => {
    setTags(next);
    setSaveState("Saving…");
    const current = ++sequence.current;
    void updateCaseAnnotation(annotation.reportNumber, { tags: next })
      .then(() => { if (sequence.current === current) setSaveState("Saved locally"); onChanged(); })
      .catch(() => { if (sequence.current === current) setSaveState("Could not save tags"); });
  };

  const submitTag = (event: Event) => {
    event.preventDefault();
    const next = addTag(tags, input);
    setInput("");
    if (next !== tags) saveTags(next);
  };

  return <>
    <div class="case-local" aria-label="Your local notes and tags">
      {sortedTags(tags).map((tag) => <button key={tag} type="button" class="local-tag local-tag--selectable" title={`Show cases tagged ${tag}`} onClick={() => onSelectTag(tag)}>{tag}</button>)}
      {note.trim() && <span class="case-local__note" title={note}>Note: {note.trim().replace(/\s+/gu, " ")}</span>}
      <button type="button" class="link case-local__edit" onClick={() => setOpen(true)}>{tags.length || note.trim() ? "Edit notes & tags" : "Add note or tags"}</button>
    </div>
    {open && <dialog ref={dialog} class="dialog dialog--local" aria-labelledby="local-workspace-title" onClose={() => setOpen(false)}>
      <div class="local-workspace__head">
        <div>
          <h2 id="local-workspace-title">Your notes & tags</h2>
          <p>Only in this browser. Never sent to MSRC or included in the report export.</p>
        </div>
        <span class="local-workspace__saved" role="status">{saveState}</span>
      </div>
      <div class="local-workspace__body">
        <div class="local-workspace__tags">
          <label for="local-tag-input">Tags</label>
          <div class="local-workspace__chips">
            {sortedTags(tags).map((tag) => (
              <span class="local-tag local-tag--editable" key={tag}>
                {tag}
                <button type="button" aria-label={`Remove tag ${tag}`} title={`Remove ${tag}`} onClick={() => saveTags(tags.filter((t) => tagKey(t) !== tagKey(tag)))}>×</button>
              </span>
            ))}
            {tags.length === 0 && <span class="muted small">No tags yet</span>}
          </div>
          <form class="local-workspace__add" onSubmit={submitTag}>
            <input id="local-tag-input" class="input" type="text" value={input} list="local-tag-suggestions" placeholder="Service, driver, or anything…" onInput={(e) => setInput((e.target as HTMLInputElement).value)} />
            <datalist id="local-tag-suggestions">{knownTags.map((tag) => <option key={tagKey(tag)} value={tag} />)}</datalist>
            <button type="submit" class="btn" disabled={!input.trim()}>Add tag</button>
          </form>
          <p class="local-workspace__hint">Use any language or emoji. Press Enter to add one tag.</p>
        </div>
        <div class="local-workspace__note">
          <label for="local-case-note">Private note</label>
          <textarea id="local-case-note" class="input" rows={5} value={note} placeholder="What do you want to remember about this case?" onInput={(e) => saveNote((e.target as HTMLTextAreaElement).value)} onBlur={() => void lastNoteSave.current.then(onChanged)} />
        </div>
      </div>
      <div class="dialog__actions"><button type="button" class="btn btn--primary" onClick={() => dialog.current?.close()}>Done</button></div>
    </dialog>}
  </>;
}
