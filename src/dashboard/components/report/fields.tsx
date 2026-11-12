// Form controls for the report editor. Plain HTML controls (labels, native
// selects, real radios) so keyboard use and autofill behave as expected.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Option, OptionGroup } from "../../../core/reportForm";
import { Markdown } from "../Markdown";

const val = (e: Event) => (e.target as HTMLInputElement).value;

export function Field(p: { id: string; label: string; hint?: ComponentChildren; error?: string; children: ComponentChildren; labelFor?: string | false }) {
  return (
    <div class={`rf${p.error ? " has-err" : ""}`} id={`f-${p.id}`}>
      <div class="rf__head">
        {p.labelFor === false ? (
          <span class="rf__label" id={`l-${p.id}`}>
            {p.label}
          </span>
        ) : (
          <label class="rf__label" id={`l-${p.id}`} for={p.labelFor ?? `in-${p.id}`}>
            {p.label}
          </label>
        )}
      </div>
      {p.hint && <p class="rf__hint">{p.hint}</p>}
      {p.children}
      {p.error && (
        <p class="rf__err" role="alert">
          {p.error}
        </p>
      )}
    </div>
  );
}

export function Text(p: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; label?: string; class?: string; type?: "text" | "url" | "email" | "date"; maxLength?: number; list?: string }) {
  return (
    <input
      id={p.id}
      class={`input${p.class ? ` ${p.class}` : ""}`}
      type={p.type ?? "text"}
      value={p.value}
      placeholder={p.placeholder}
      aria-label={p.label}
      maxLength={p.maxLength}
      list={p.list}
      spellcheck={false}
      onInput={(e) => p.onChange(val(e))}
    />
  );
}

export function Select(p: { id?: string; value: string; onChange: (v: string) => void; options?: Option[]; groups?: OptionGroup[]; placeholder?: string; label?: string }) {
  const known = new Set([...(p.options ?? []), ...(p.groups ?? []).flatMap((g) => g.options)].map((o) => o.value));
  return (
    <select id={p.id} class="input rf__select" value={p.value} aria-label={p.label} onChange={(e) => p.onChange(val(e))}>
      <option value="">{p.placeholder ?? "Choose…"}</option>
      {p.groups
        ? p.groups.map((g) =>
            g.options.length === 1 && g.options[0]!.label === g.label ? (
              <option key={g.label} value={g.options[0]!.value}>
                {g.label}
              </option>
            ) : (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ),
          )
        : (p.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
      {/* keep a value MSRC stored that this catalog doesn't know */}
      {p.value && !known.has(p.value) && <option value={p.value}>{p.value}</option>}
    </select>
  );
}

/** Segmented single choice built from real radio inputs. */
export function Choice(p: { name: string; value: string; options: Option[]; onChange: (v: string) => void; labelledBy?: string }) {
  return (
    <div class="choice" role="radiogroup" aria-labelledby={p.labelledBy}>
      {p.options.map((o) => (
        <label key={o.value} class={`choice__opt${p.value === o.value ? " is-on" : ""}`}>
          <input type="radio" name={p.name} value={o.value} checked={p.value === o.value} onChange={() => p.onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

const YES_NO: Option[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function YesNo(p: { name: string; value: boolean | null; onChange: (v: boolean) => void; labelledBy?: string }) {
  return <Choice name={p.name} labelledBy={p.labelledBy} value={p.value === null ? "" : p.value ? "yes" : "no"} options={YES_NO} onChange={(v) => p.onChange(v === "yes")} />;
}

/** Markdown text with Write / Preview and a character count. */
export function MdArea(p: { id: string; value: string; onChange: (v: string) => void; rows?: number; min?: number; max?: number; mono?: boolean; placeholder?: string; noPreview?: boolean }) {
  const [preview, setPreview] = useState(false);
  const n = p.value.trim().length;
  return (
    <div class="mdf">
      <div class="mdf__bar" hidden={p.noPreview}>
        {!p.noPreview && (
          <div class="mdf__tabs" role="tablist" aria-label="Edit or preview">
            <button type="button" role="tab" class="mdf__tab" aria-selected={!preview} onClick={() => setPreview(false)}>
              Write
            </button>
            <button type="button" role="tab" class="mdf__tab" aria-selected={preview} onClick={() => setPreview(true)}>
              Preview
            </button>
          </div>
        )}
        <span class="top__grow" />
        <span class={`mdf__count${p.min && n > 0 && n < p.min ? " is-short" : ""}`}>
          {n.toLocaleString("en")}
          {p.max ? ` / ${p.max.toLocaleString("en")}` : ""}
        </span>
      </div>
      {preview ? (
        <div class="mdf__preview">{p.value.trim() ? <Markdown src={p.value} /> : <p class="muted">Nothing to preview yet.</p>}</div>
      ) : (
        <textarea
          id={`in-${p.id}`}
          class={`input mdf__text${p.mono ? " is-mono" : ""}`}
          rows={p.rows ?? 8}
          value={p.value}
          maxLength={p.max}
          placeholder={p.placeholder}
          spellcheck={!p.mono}
          onInput={(e) => p.onChange((e.target as HTMLTextAreaElement).value)}
        />
      )}
    </div>
  );
}
