export interface ReleaseCheck {
  latestTag: string | null;
  /** Time of the last successful check. */
  checkedAt: number | null;
  unavailable: boolean;
}

const REPOSITORY = "xaitax/msrc-dashboard";
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASES = `https://github.com/${REPOSITORY}/releases`;

/** Chromium compares up to four numeric components, treating missing components as zero. */
function versionParts(tag: string): number[] | null {
  const parts = tag.replace(/^v/, "").split(".");
  if (parts.length > 4 || !parts.every(p => /^(0|[1-9]\d{0,4})$/.test(p) && Number(p) <= 65535)) return null;
  const numbers = parts.map(Number);
  return numbers.some(n => n > 0) ? numbers : null;
}

export function isReleaseTag(tag: unknown): tag is string {
  return typeof tag === "string" && versionParts(tag) !== null;
}

export function isNewerRelease(tag: string, installed: string): boolean {
  const latest = versionParts(tag);
  const current = versionParts(installed);
  if (!latest || !current) return false;
  for (let i = 0; i < 4; i++) {
    const difference = (latest[i] ?? 0) - (current[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function releaseUrl(tag: string): string {
  return isReleaseTag(tag) ? `${RELEASES}/tag/${encodeURIComponent(tag)}` : RELEASES;
}
