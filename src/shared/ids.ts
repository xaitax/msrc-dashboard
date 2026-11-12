// Validators for ids that end up inside API URLs or GraphQL variables.
// Everything that reaches the API passes through one of these first.

const VULN_RE = /^VULN-\d+$/;
const CVE_RE = /^CVE-\d{4}-\d{4,7}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVulnId(s: unknown): s is string {
  return typeof s === "string" && VULN_RE.test(s);
}

export function isGuid(s: unknown): s is string {
  return typeof s === "string" && GUID_RE.test(s);
}

export function isCveId(s: unknown): s is string {
  return typeof s === "string" && CVE_RE.test(s);
}
