import type { ChangeEvent } from "../shared/types";
import { bountyChangeParts, formatBountyFields } from "./bountyChanges";

const separator = " → ";
type ChangeTextEvent = Pick<ChangeEvent, "type" | "field" | "summary" | "newValue" | "oldValue">;

function recognitionPointParts(event: ChangeTextEvent): string[] | null {
  // Some stored events have only the summary produced by the case-field diff.
  const legacy = /^Case point: (—|-?\d+) → (—|-?\d+)$/.exec(event.summary);
  if (event.field !== "casePoint" && !legacy) return null;
  const before = event.oldValue === undefined ? legacy?.[1] : event.oldValue;
  const after = event.newValue === undefined ? legacy?.[2] : event.newValue;
  const hasBefore = before != null && before !== "—" && before !== "";
  const hasAfter = after != null && after !== "—" && after !== "";
  if (!hasAfter) return hasBefore ? [`Recognition points no longer listed (was ${before})`] : null;
  if (!hasBefore) return [`Recognition points set to ${after}`];
  return [String(before), `${after} recognition ${String(after) === "1" ? "point" : "points"}`];
}

function bountyTextParts(event: ChangeTextEvent): string[] {
  const text = event.summary;
  // The free-text program name comes last in both stored formats. Everything
  // after its label belongs to the name, including arrows and middle dots.
  const program = /^Bounty program(?: → |: )| · (?:Bounty program → |Program: )/.exec(text);
  const head = program ? text.slice(0, program.index) : text;
  const hasField = (field: string) => [event.oldValue, event.newValue].every(value =>
    value === null || (typeof value === "object" && Object.hasOwn(value, field)));
  if (Object.hasOwn(event, "oldValue") && Object.hasOwn(event, "newValue")) {
    const parts = bountyChangeParts(event.oldValue, event.newValue);
    const missingDetail = (program && !hasField("program")) ||
      (/(?:^| · )Bounty amount /.test(head) && !hasField("amount")) ||
      (/^Bounty (?!amount |program )[^·]+? → /.test(head) && !hasField("status"));
    if (!missingDetail && parts[0] !== "Bounty changed") return parts;
  }
  if (!text.includes(separator)) return [text];

  // Newer summary-only entries already label added programs explicitly.
  if (program?.[0].endsWith(": ")) {
    const parts = head.split(separator);
    parts[parts.length - 1] += text.slice(program.index);
    return parts;
  }
  const before: { status?: string; amount?: string } = {};
  const after: { status?: string; amount?: string; program?: string } = {};
  for (const clause of head ? head.split(" · ") : []) {
    const change = /^Bounty (amount )?(.+?) → (.+)$/.exec(clause);
    if (change) {
      const field = change[1] ? "amount" : "status";
      if (change[2] !== "—") before[field] = change[2];
      if (change[3] !== "—") after[field] = change[3];
    } else if (clause.startsWith("Bounty ") && !clause.includes(":")) {
      after.status = clause.slice("Bounty ".length);
    } else {
      return text.split(separator);
    }
  }
  if (program) {
    const name = text.slice(program.index + program[0].length);
    if (name === "—") {
      if (!head) return ["Bounty program no longer listed"];
      const parts = formatBountyFields(before, after);
      parts[parts.length - 1] += " · Program no longer listed";
      return parts;
    }
    after.program = name;
  }
  return formatBountyFields(before, after);
}

/** Split the dashboard's transition markers while keeping quoted field values intact. */
export function changeTextParts(event: ChangeTextEvent, text = event.summary): string[] {
  if (event.type === "bounty") return text === event.summary ? bountyTextParts(event) : [text];
  if (event.type === "field_changed" && text === event.summary) {
    const points = recognitionPointParts(event);
    if (points) return points;
  }
  if (!text.includes(separator)) return [text];
  switch (event.type) {
    case "status":
    case "status_reason":
      return text.split(separator);
    case "field_changed": {
      // A title can itself contain arrows on either side of the transition.
      const next = event.newValue;
      const boundary = typeof next === "string" && text.endsWith(separator + next)
        ? text.length - next.length - separator.length
        : text.lastIndexOf(separator);
      return [text.slice(0, boundary), text.slice(boundary + separator.length)];
    }
    default:
      return [text];
  }
}
