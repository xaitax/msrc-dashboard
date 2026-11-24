import { shortWhen } from "../format";
import { CaseIcon } from "./CaseIcon";

export function BoardDate({ at, label, className, title }: { at: string; label?: string; className?: string; title?: string }) {
  if (!Number.isFinite(Date.parse(at))) return <span class={className}>—</span>;
  return (
    <time class={className ? `board-date ${className}` : "board-date"} dateTime={at} title={title}>
      <CaseIcon name="calendar" />{label ?? shortWhen(at)}
    </time>
  );
}
