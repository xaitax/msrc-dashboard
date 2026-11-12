// CVE ids per report, from MSRC's own messages: MSRC announces assigned CVEs
// only inside thread messages. Template messages cite the same CVE on many
// threads, so an id seen on more than BOILERPLATE_MAX distinct reports is
// noise. A CVE the researcher writes (in a message, or in the report's
// "related CVE" field) is not an assignment.
import type { ThreadMessage, VulnId } from "../shared/types";
import { MSRC_SENDER } from "./derive";

export interface CveRef {
  cve: string;
  source: "message";
  messageId: string;
}

const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;
const BOILERPLATE_MAX = 3;

function idsIn(text: string | null | undefined): string[] {
  return Array.from(new Set((text ?? "").match(CVE_RE)?.map((c) => c.toUpperCase()) ?? []));
}

export function extractCves(msgs: ThreadMessage[]): Record<VulnId, CveRef[]> {
  const fromMessages = new Map<VulnId, Map<string, string>>(); // report -> cve -> first message id
  const reportsPerCve = new Map<string, Set<VulnId>>();
  const ordered = msgs.filter((m) => m.senderName === MSRC_SENDER).sort((a, b) => Date.parse(a.createdOn) - Date.parse(b.createdOn));
  for (const m of ordered) {
    for (const cve of idsIn(m.body)) {
      const perReport = fromMessages.get(m.reportNumber) ?? new Map<string, string>();
      if (!perReport.has(cve)) perReport.set(cve, m.id);
      fromMessages.set(m.reportNumber, perReport);
      const reports = reportsPerCve.get(cve) ?? new Set<VulnId>();
      reports.add(m.reportNumber);
      reportsPerCve.set(cve, reports);
    }
  }

  const out: Record<VulnId, CveRef[]> = {};
  for (const [rn, perReport] of fromMessages) {
    const refs = [...perReport]
      .filter(([cve]) => (reportsPerCve.get(cve)?.size ?? 0) <= BOILERPLATE_MAX)
      .map(([cve, messageId]): CveRef => ({ cve, source: "message", messageId }));
    if (refs.length > 0) out[rn] = refs;
  }
  return out;
}

/** CVEs MSRC named on exactly one case: the only automatic CVE ↔ case link. */
export function msrcNamedCves(refs: Record<VulnId, CveRef[]>): Record<VulnId, string[]> {
  const cases = new Map<string, VulnId[]>();
  for (const [rn, list] of Object.entries(refs)) for (const r of list) cases.set(r.cve, [...(cases.get(r.cve) ?? []), rn]);
  const out: Record<VulnId, string[]> = {};
  for (const [cve, rns] of cases) if (rns.length === 1) (out[rns[0]!] ??= []).push(cve);
  return out;
}
