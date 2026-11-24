import { Fragment } from "preact";
import type { ChangeEvent } from "../../shared/types";
import { changeTextParts } from "../../core/changeText";
import { CaseIcon } from "./CaseIcon";

export function ChangeParts({ parts }: { parts: string[] }) {
  return <>{parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <span class="change-direction"><CaseIcon name="next" /><span class="sr-only"> to </span></span>}
      {part}
    </Fragment>
  ))}</>;
}

export function ChangeText({ event, text }: { event: ChangeEvent; text?: string }) {
  return <ChangeParts parts={changeTextParts(event, text)} />;
}
