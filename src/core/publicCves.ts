// Public CVEs that credit the researcher, from Microsoft's public Security
// Update Guide (same API host, no login). The guide's credit line names the
// researcher but never the case, and MSRC's case update can lag the release by
// days, so a CVE is tied to a case only when MSRC named it on the case or the
// researcher confirmed the link. Everything else is a suggestion, shown as one.
import { isCveId, isVulnId } from "../shared/ids";
import type { CaseRecord, RawObject, VulnId } from "../shared/types";
import { htmlToText } from "./text";
import { MSRC_ORIGIN } from "../shared/urls";
import { caseStatus, caseTitle } from "./derive";
import { escapeRegExp } from "./text";


export interface PublicCve {
  cve: string;
  title: string;
  releaseDate: string;
  severity: string | null;
  impact: string | null;
  baseScore: string | null;
  vector: string | null;
  cwe: string[];
  exploitability: string | null;
}

/** The researcher's decisions: a case, or null for "not mine". */
export type CveLinks = Record<string, VulnId | null>;

export interface PublicMeta {
  checkedAt: number; // 0 = never fetched successfully (a first run is still due)
  items: PublicCve[];
}

export const publicCveUrl = (cve: string) => `${MSRC_ORIGIN}/update-guide/vulnerability/${encodeURIComponent(cve)}`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const MIN_NAME = 5;

/** The credit names on the researcher's own (non-anonymous) reports. */
export function creditNames(cases: CaseRecord[]): string[] {
  const out = new Map<string, string>();
  for (const c of cases) {
    const d = c.detail;
    if (!d || d["anonymousSubmission"] === true) continue;
    const acks = Array.isArray(d["acknowledgements"]) ? (d["acknowledgements"] as RawObject[]) : [];
    for (const a of acks) {
      const name = str(a?.["name"]);
      if (name && name.length >= MIN_NAME && !out.has(norm(name))) out.set(norm(name), name);
    }
  }
  return [...out.values()];
}


/** Whole-name match on the guide's credit line (HTML), ignoring case and spacing. */
export function creditedTo(ackHtml: string, names: string[]): boolean {
  const text = norm(htmlToText(ackHtml));
  return names.some((n) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(norm(n))}($|[^a-z0-9])`).test(text));
}

const IMPACT_IN_TITLE = /(Elevation of Privilege|Remote Code Execution|Information Disclosure|Denial of Service|Security Feature Bypass|Spoofing|Tampering)\s+Vulnerability\s*$/i;

/** One entry from an acknowledgement row plus (if fetched) its vulnerability record. */
export function publicCveFrom(ack: RawObject, vuln: RawObject | null): PublicCve | null {
  const cve = str(ack["cveNumber"]);
  if (!isCveId(cve)) return null;
  const title = str(vuln?.["cveTitle"]) ?? str(ack["cveTitle"]) ?? cve;
  return {
    cve,
    title,
    releaseDate: str(vuln?.["releaseDate"]) ?? str(ack["releaseDate"]) ?? "",
    severity: str(vuln?.["severity"]),
    impact: str(vuln?.["impact"]) ?? IMPACT_IN_TITLE.exec(title)?.[1] ?? null,
    baseScore: str(vuln?.["baseScore"]),
    vector: str(vuln?.["vectorString"]),
    cwe: Array.isArray(vuln?.["cweList"]) ? (vuln!["cweList"] as unknown[]).map(str).filter((x): x is string => !!x) : [],
    exploitability: str(vuln?.["latestSoftwareRelease"]),
  };
}

const enumOf = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_+|_+$/g, "");
const cweNumbers = (list: unknown): number[] =>
  (Array.isArray(list) ? list : typeof list === "string" ? [list] : []).flatMap((x) => [...String(x).matchAll(/CWE-(\d+)/gi)].map((m) => Number(m[1])));

/** Title words that point at a weakness class, for cases without a CWE. */
const CWE_WORDS: [number[], RegExp][] = [
  [[416], /use[- ]after[- ]free|\buaf\b/i],
  [[120, 122, 787], /heap (?:buffer )?overflow|buffer overflow|out[- ]of[- ]bounds write/i],
  [[125], /out[- ]of[- ]bounds read/i],
  [[362, 367], /\btoctou\b|race condition|time[- ]of[- ]check/i],
  [[59], /link following|symlink|symbolic link|junction|re-resolves/i],
];

const OPEN_FOR_FIX = new Set(["DEVELOP", "PRE_RELEASE"]);
const MIN_SCORE = 4;

/** The single most likely case, or null. Same impact and submitted before the
 *  release are required; a CWE match (+3), awaiting a fix (+2) and no CVE yet
 *  (+1) score; only a unique top score of at least 4 is suggested. */
export function suggestCase(p: PublicCve, cases: CaseRecord[], cvesByCase: Record<string, string[]>): VulnId | null {
  const impact = enumOf(p.impact);
  if (!impact) return null;
  const released = Date.parse(p.releaseDate);
  const want = new Set(cweNumbers(p.cwe));
  let best: VulnId | null = null;
  let bestScore = -1;
  let tie = false;
  for (const c of cases) {
    const status = caseStatus(c) ?? "";
    if (status === "DRAFT") continue;
    if (enumOf((c.detail?.["securityImpact"] as string | null | undefined) ?? c.list.securityImpact) !== impact) continue;
    const created = Date.parse(c.list.createdOn ?? "");
    if (!Number.isNaN(released) && !Number.isNaN(created) && created >= released) continue;
    const title = caseTitle(c);
    const cweHit = cweNumbers(c.detail?.["cweList"]).some((n) => want.has(n)) || CWE_WORDS.some(([nums, re]) => nums.some((n) => want.has(n)) && re.test(title));
    const score = (cweHit ? 3 : 0) + (OPEN_FOR_FIX.has(status) ? 2 : 0) + ((cvesByCase[c.reportNumber]?.length ?? 0) === 0 ? 1 : 0);
    if (score > bestScore) {
      best = c.reportNumber;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) tie = true;
  }
  return bestScore >= MIN_SCORE && !tie ? best : null;
}

export interface ResolvedPublicCves {
  byCase: Record<VulnId, { item: PublicCve; by: "you" | "msrc" }[]>;
  unlinked: { item: PublicCve; suggestion: VulnId | null }[];
  /** Marked "not mine" by the researcher (kept so it can be undone). */
  dismissed: PublicCve[];
}

export function resolvePublicCves(cases: CaseRecord[], items: PublicCve[], links: CveLinks, cvesByCase: Record<string, string[]>): ResolvedPublicCves {
  const known = new Set(cases.map((c) => c.reportNumber));
  // For scoring, a case the researcher linked a CVE to already "has a CVE".
  const withLinks: Record<string, string[]> = { ...cvesByCase };
  for (const [cve, rn] of Object.entries(links)) if (rn && known.has(rn)) withLinks[rn] = [...(withLinks[rn] ?? []), cve];
  const byCase: ResolvedPublicCves["byCase"] = {};
  const unlinked: ResolvedPublicCves["unlinked"] = [];
  const dismissed: PublicCve[] = [];
  const add = (rn: VulnId, item: PublicCve, by: "you" | "msrc") => (byCase[rn] ??= []).push({ item, by });
  for (const item of items) {
    if (Object.hasOwn(links, item.cve)) {
      const rn = links[item.cve];
      if (rn === null) {
        dismissed.push(item); // "not mine"
        continue;
      }
      if (rn && known.has(rn)) {
        add(rn, item, "you");
        continue;
      }
    }
    const named = Object.keys(cvesByCase).find((rn) => known.has(rn) && cvesByCase[rn]!.includes(item.cve));
    if (named) add(named, item, "msrc");
    else unlinked.push({ item, suggestion: suggestCase(item, cases, withLinks) });
  }
  return { byCase, unlinked, dismissed };
}

/** Applies one decision by the researcher; null result = invalid input. `undefined` forgets the decision. */
export function cveLinkUpdate(links: CveLinks, cve: string, value: VulnId | null | undefined): CveLinks | null {
  if (!isCveId(cve)) return null;
  if (value !== null && value !== undefined && !isVulnId(value)) return null;
  const next = { ...links };
  if (value === undefined) delete next[cve];
  else next[cve] = value;
  return next;
}
