// Loads what the portal publishes about itself, straight from msrc.microsoft.com
// (no token): its settings file, and on request its own scripts, read for the
// "Portal internals" page.
import { parseAppSettings, parseEnvironments, parseFlagDescriptions, type Environment, type PortalSettings } from "../core/portalConfig";
import { MSRC_ORIGIN, PORTAL_REPORTS } from "../shared/urls";

const SETTINGS_URL = `${MSRC_ORIGIN}/config/appsettings.json`;
const TIMEOUT_MS = 20_000;

export interface PortalInternals {
  environments: Environment[];
  apiHosts: string[];
  flagInfo: Record<string, { label: string; description: string }>;
}

async function get(fetch: typeof globalThis.fetch, url: string, what: string): Promise<string> {
  const r = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${what}: HTTP ${r.status}`);
  return r.text();
}

export async function loadSettings(fetch: typeof globalThis.fetch, now = new Date()): Promise<PortalSettings> {
  return parseAppSettings(JSON.parse(await get(fetch, SETTINGS_URL, "portal settings")), now);
}

/** The portal page → its main script → the chunks holding environments,
 *  allowed API hosts and flag descriptions. Only scripts under the portal. */
export async function loadInternals(fetch: typeof globalThis.fetch): Promise<PortalInternals> {
  const html = await get(fetch, PORTAL_REPORTS, "portal page");
  const src = /<script\b[^>]*type="module"[^>]*src="(\/report\/vulnerability\/static\/js\/index\.[\w-]+\.js)"/.exec(html)?.[1];
  if (!src) throw new Error("portal internals: main script not found");
  const main = new URL(src, MSRC_ORIGIN);
  const index = await get(fetch, main.href, "portal script");
  const chunks = [...new Set([...index.matchAll(/from"\.\/((?:lib|featureFlags)\.[\w-]+\.js)"/g)].map((m) => m[1]!))];
  const texts = await Promise.all(chunks.map(async (c) => ({ name: c, text: await get(fetch, new URL(c, main).href, "portal script") })));
  const { environments, apiHosts } = parseEnvironments([index, ...texts.filter((t) => t.name.startsWith("lib.")).map((t) => t.text)].join("\n"));
  const flags = texts.find((t) => t.name.startsWith("featureFlags."));
  return { environments, apiHosts, flagInfo: flags ? parseFlagDescriptions(flags.text) : {} };
}
