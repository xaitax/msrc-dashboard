// Small derivations shared by the service worker, the dashboard and the export.
import type { CaseRecord, ChangeEvent } from "../shared/types";
import { decodeEntities } from "./text";

/** Report statuses seen in the portal bundle: NEW, REVIEW_REPRO, DEVELOP, PRE_RELEASE,
 *  COMPLETE (+ _DUPLICATE/_RESOLVED/_NA variants), DRAFT, SUBMITTED. */
export function isClosed(status: string | null | undefined): boolean {
  return typeof status === "string" && status.startsWith("COMPLETE");
}

/** MSRC's case pipeline, in order: status prefix, style key, label. */
export const PIPELINE = [
  { prefix: "NEW", key: "new", label: "New" },
  { prefix: "REVIEW_REPRO", key: "review", label: "Review / Repro" },
  { prefix: "DEVELOP", key: "develop", label: "Develop" },
  { prefix: "PRE_RELEASE", key: "prerelease", label: "Pre-release" },
  { prefix: "COMPLETE", key: "complete", label: "Complete" },
] as const;
export type StageKey = (typeof PIPELINE)[number]["key"];

const STATUS_LABELS: [string, string][] = [...PIPELINE.map((s): [string, string] => [s.prefix, s.label]), ["SUBMITTED", "Submitted"], ["DRAFT", "Draft"]];
const REASONS: Record<string, string> = { NA: "N/A" };

const MINOR_WORDS = new Set(["of", "and", "or", "to", "the", "a", "an", "in", "on", "for", "by", "with"]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && MINOR_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function humanizeEnum(v: string | null | undefined): string {
  if (!v) return "";
  for (const [prefix, label] of STATUS_LABELS) {
    if (v === prefix) return label;
    if (v.startsWith(prefix + "_")) {
      const rest = v.slice(prefix.length + 1);
      return `${label} · ${REASONS[rest] ?? titleCase(rest)}`;
    }
  }
  return titleCase(v);
}

export const MSRC_SENDER = "MSRC";

/** The case title as plain text (MSRC sends HTML entities). */
export const caseTitle = (c: CaseRecord): string => decodeEntities(String(c.detail?.["title"] ?? c.list.title ?? ""));

/** The current status: the full report's if fetched, else the list row's. */
export const caseStatus = (c: CaseRecord): string | null => (c.detail?.["status"] as string | null | undefined) ?? c.list.status;
export const caseStatusReason = (c: CaseRecord): string | null => (c.detail?.["statusReason"] as string | null | undefined) ?? c.list.statusReason;

/** The name researchers use for a case: its MSRC ticket number, else the VULN id. */
export const caseLabel = (c: { ticketNumber: string | null; reportNumber: string }): string => c.ticketNumber || c.reportNumber;

/** An MSRC template mail (status updates and the like), not a person writing. */
export function isAutomatic(m: { raw: Record<string, unknown> }): boolean {
  const topics = m.raw["topicList"];
  return Array.isArray(topics) && topics.includes("AutoNotification");
}

/** A change the researcher hasn't seen and didn't make. */
export const isUnseen = (e: Pick<ChangeEvent, "seen" | "own">): boolean => !e.seen && !e.own;
