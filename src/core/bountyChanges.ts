import { bountyLabel, formatUsd } from "./awards";

const textValue = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const amountLabel = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? formatUsd(value) : textValue(value);

type BountyFields = { status?: string | null; amount?: string | null; program?: string | null };

function displayFields(value: unknown): BountyFields {
  if (!value || typeof value !== "object") return {};
  const fields = value as Record<string, unknown>;
  return { status: bountyLabel(textValue(fields.status)), amount: amountLabel(fields.amount), program: textValue(fields.program) };
}

export function bountyChangeParts(before: unknown, after: unknown): string[] {
  return formatBountyFields(displayFields(before), displayFields(after));
}

/** Each boundary between parts is a real transition, even when a program name contains an arrow. */
export function formatBountyFields(before: BountyFields, after: BountyFields): string[] {
  const parts: string[] = [];

  function append(clause: string, to?: string) {
    if (parts.length) parts[parts.length - 1] += ` · ${clause}`;
    else parts.push(clause);
    if (to !== undefined) parts.push(to);
  }

  const fromStatus = before.status || "";
  const toStatus = after.status || "";
  if (fromStatus !== toStatus) {
    if (!fromStatus) append(`Bounty ${toStatus.toLowerCase()}`);
    else if (!toStatus) append(`Bounty status no longer listed (was ${fromStatus})`);
    else append(`Bounty ${fromStatus}`, toStatus);
  }

  function detail(name: string, from: string | null, to: string | null) {
    if (from === to) return;
    const label = parts.length ? name : `Bounty ${name.toLowerCase()}`;
    if (to === null) append(`${label} no longer listed (was ${from})`);
    else if (from === null) append(`${label}: ${to}`);
    else append(`${label} ${from}`, to);
  }

  detail("Amount", before.amount ?? null, after.amount ?? null);
  detail("Program", before.program ?? null, after.program ?? null);
  return parts.length ? parts : ["Bounty changed"];
}
