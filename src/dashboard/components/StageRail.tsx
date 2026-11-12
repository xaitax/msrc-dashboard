import { PIPELINE } from "../../core/derive";
import type { Stage } from "../data";

export function stageKey(stage: Stage): string {
  return stage.index >= 0 ? PIPELINE[stage.index]!.key : "none";
}

/** Five-step pipeline track coloured by stage. Filled up to the current stage;
 *  a ring marks where the case was before an unseen stage change. */
export function StageRail({ stage, prev, labelled }: { stage: Stage; prev?: Stage; labelled?: boolean }) {
  const name = stage.index >= 0 ? PIPELINE[stage.index]!.label : "Not in pipeline";
  const moved = !!prev && prev.index >= 0 && prev.index !== stage.index;
  const label = `${name}${stage.duplicate ? ", duplicate" : ""}${moved && prev ? `, was ${PIPELINE[prev.index]!.label}` : ""}`;
  return (
    <span class={`rail rail--${stageKey(stage)}${stage.duplicate ? " rail--dup" : ""}${labelled ? " rail--labelled" : ""}`} role="img" aria-label={label} title={label}>
      {PIPELINE.map((s, i) => (
        <span
          key={i}
          class={["rail__seg", i <= stage.index ? "rail__seg--on" : "", i === stage.index ? "rail__seg--now" : "", moved && prev && i === prev.index ? "rail__seg--was" : ""].join(" ")}
        >
          {labelled && <span class="rail__name">{s.label}</span>}
        </span>
      ))}
    </span>
  );
}

/** Coloured status pill: stage colour + human status text. */
export function StatusPill({ stage, text }: { stage: Stage; text: string }) {
  return <span class={`pill pill--${stageKey(stage)}${stage.duplicate ? " pill--dup" : ""}`}>{text || "—"}</span>;
}
