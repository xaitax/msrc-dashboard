// Reads what the portal publishes about itself: its public settings file
// (/config/appsettings.json: announcements, feature flags, the AI pre-screening
// setup) and the environment configs compiled into its script bundle. Pure
// parsers; every string they return is rendered as text or safe Markdown.
import { decodeEntities } from "./text";

export type AlertLevel = "info" | "warning" | "error";

export interface SystemAlert {
  level: AlertLevel;
  content: string;
  linkText: string | null;
  linkUrl: string | null;
}

/** A site banner; `content` is Markdown (the portal renders links in it). */
export interface SiteBanner {
  id: string;
  level: AlertLevel;
  content: string;
}

export interface ClassifierCategory {
  name: string;
  enabled: boolean;
  /** MSRC's naming: "(Close)" categories close the report as not an MSRC case. */
  closes: boolean;
}

export interface Classifier {
  model: string | null;
  reasoningEffort: string | null;
  confidenceThreshold: number | null;
  endpoints: string[];
  categories: ClassifierCategory[];
}

export interface PortalSettings {
  alert: SystemAlert | null;
  banners: SiteBanner[];
  classifier: Classifier | null;
  /** The portal's front-end flags (frontend:RP_*), name without the prefix. */
  flags: { key: string; value: string }[];
  /** Back-end feature switches (feature_management). */
  serverFlags: { id: string; enabled: boolean }[];
  exploited: string[];
}

export interface Environment {
  apiRoot: string;
  clientId: string | null;
  signInPolicy: string | null;
  insightsKey: string | null;
  supportEmail: string | null;
}

const MAX_BANNERS = 3; // the portal shows three at once
const FLAG_PREFIX = "frontend:RP_";
const LIST_FLAG = /_(Roles|AllowlistIDs|BlacklistIDs)$/;
const TEXT_FLAG = /^SystemAlert_(Content|LinkText|LinkUrl)$/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const level = (v: unknown): AlertLevel => (v === "warning" || v === "error" ? v : "info");
const https = (v: string): string | null => (/^https:\/\/[^\s]+$/i.test(v) ? v : null);

function json(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function time(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

function readAlert(s: Record<string, unknown>): SystemAlert | null {
  const content = str(s["frontend:RP_SystemAlert_Content"]);
  if (str(s["frontend:RP_SystemAlert_Show"]).toLowerCase() !== "true" || !content) return null;
  const linkUrl = https(str(s["frontend:RP_SystemAlert_LinkUrl"]));
  const linkText = str(s["frontend:RP_SystemAlert_LinkText"]) || null;
  return { level: level(s["frontend:RP_SystemAlert_Level"]), content, linkText, linkUrl };
}

function readBanners(raw: unknown, now: number): SiteBanner[] {
  const list = json(raw);
  if (!Array.isArray(list)) return [];
  const out: SiteBanner[] = [];
  for (const b of list as Record<string, unknown>[]) {
    const id = str(b?.["id"]);
    const content = str(b?.["content"]);
    const from = time(b?.["startsAt"]);
    const until = time(b?.["endsAt"]);
    if (!id || !content || from === null || until === null) continue;
    if ((from !== undefined && now < from) || (until !== undefined && now >= until)) continue;
    out.push({ id, level: level(b["level"]), content });
    if (out.length === MAX_BANNERS) break;
  }
  return out;
}

function readClassifier(s: Record<string, unknown>): Classifier | null {
  const keys = Object.keys(s).filter((k) => k.startsWith("AzureOpenAI:"));
  if (!keys.length) return null;
  const endpoints = keys
    .filter((k) => /^AzureOpenAI:Endpoints:\d+$/.test(k))
    .sort((a, b) => Number(a.split(":")[2]) - Number(b.split(":")[2]))
    .map((k) => str(s[k]))
    .filter(Boolean);
  const categories = keys
    .filter((k) => k.startsWith("AzureOpenAI:CategoryToggles:"))
    .map((k) => {
      const name = k.slice("AzureOpenAI:CategoryToggles:".length);
      return { name, enabled: s[k] === true || s[k] === "true", closes: /\(Close\)\s*$/.test(name) };
    })
    .sort((a, b) => Number(b.closes) - Number(a.closes) || a.name.localeCompare(b.name, "en"));
  const threshold = Number(s["AzureOpenAI:ConfidenceThreshold"]);
  return {
    model: str(s["AzureOpenAI:DeploymentName"]) || null,
    reasoningEffort: str(s["AzureOpenAI:ReasoningEffort"]) || null,
    confidenceThreshold: Number.isFinite(threshold) && s["AzureOpenAI:ConfidenceThreshold"] !== "" ? threshold : null,
    endpoints,
    categories,
  };
}

/** Lists (role claims, allow/deny lists) are counted, never shown. */
function flagValue(key: string, v: unknown): string {
  const s = typeof v === "string" ? v.trim() : JSON.stringify(v);
  if (LIST_FLAG.test(key)) {
    const n = s.split(",").filter((x) => x.trim()).length;
    return n ? `${n} ${n === 1 ? "entry" : "entries"}` : "none";
  }
  if (key === "SiteBanners") {
    const list = json(s);
    return Array.isArray(list) && list.length ? `${list.length} ${list.length === 1 ? "entry" : "entries"}` : "none";
  }
  if (TEXT_FLAG.test(key)) return s ? "set" : "none";
  return s;
}

export function parseAppSettings(raw: unknown, now = new Date()): PortalSettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flags = Object.keys(s)
    .filter((k) => k.startsWith(FLAG_PREFIX))
    .map((k) => {
      const key = k.slice(FLAG_PREFIX.length);
      return { key, value: flagValue(key, s[k]) };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const fm = json(s["feature_management"]) as { feature_flags?: { id?: unknown; enabled?: unknown }[] } | null;
  const serverFlags = (Array.isArray(fm?.feature_flags) ? fm.feature_flags : [])
    .filter((f) => typeof f?.id === "string" && f.id)
    .map((f) => ({ id: f.id as string, enabled: f.enabled === true }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const exploited = json(s["frontend:SUG_ActivelyExploitedCves"]);
  return {
    alert: readAlert(s),
    banners: readBanners(s["frontend:RP_SiteBanners"], now.getTime()),
    classifier: readClassifier(s),
    flags,
    serverFlags,
    exploited: Array.isArray(exploited) ? exploited.filter((c): c is string => typeof c === "string" && /^CVE-\d{4}-\d{4,7}$/.test(c)) : [],
  };
}

const field = (obj: string, name: string): string | null => new RegExp(`\\b${name}:\`([^\`]*)\``).exec(obj)?.[1] || null;

/** Environment configs ({apiRoot, clientId, authority, …}) in the portal's main
 *  script, and the API hosts it allows. */
export function parseEnvironments(bundle: string): { environments: Environment[]; apiHosts: string[] } {
  const environments: Environment[] = [];
  const seen = new Set<string>();
  for (const m of bundle.matchAll(/\{apiRoot:`([^`]+)`[^}]*\}/g)) {
    const obj = m[0];
    const authority = field(obj, "authority");
    const env: Environment = {
      apiRoot: m[1]!,
      clientId: field(obj, "clientId"),
      signInPolicy: field(obj, "b2cSignInPolicy") ?? (authority ? authority.split("/").pop() || null : null),
      insightsKey: field(obj, "applicationInsightsKey"),
      supportEmail: field(obj, "emailCaseSupport"),
    };
    const id = `${env.apiRoot}|${env.clientId}|${env.signInPolicy}`;
    if (!seen.has(id)) {
      seen.add(id);
      environments.push(env);
    }
  }
  const roots = new Set(environments.map((e) => e.apiRoot.replace(/^https:\/\//, "").replace(/\/.*$/, "")));
  let apiHosts: string[] = [];
  for (const m of bundle.matchAll(/new Set\(\[((?:`[^`]*`,?)+)\]\)/g)) {
    const hosts = [...m[1]!.matchAll(/`([^`]*)`/g)].map((x) => x[1]!);
    if (hosts.every((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) && hosts.some((h) => roots.has(h))) {
      apiHosts = hosts;
      break;
    }
  }
  return { environments, apiHosts };
}

/** Labels and descriptions of the portal's feature flags (its featureFlags chunk). */
export function parseFlagDescriptions(chunk: string): Record<string, { label: string; description: string }> {
  const names = new Map<string, string>();
  for (const m of chunk.matchAll(/\b([A-Z][A-Z0-9_]*):\w+\(`([^`]+)`\)/g)) names.set(m[1]!, m[2]!);
  const out: Record<string, { label: string; description: string }> = {};
  for (const m of chunk.matchAll(/\{key:\w+\.([A-Z][A-Z0-9_]*),label:`([^`]*)`,description:`([^`]*)`/g)) {
    const name = names.get(m[1]!);
    if (name) out[name] = { label: m[2]!, description: m[3]! };
  }
  return out;
}

/** MSRC's case banner is HTML: keep https links as Markdown, drop all other tags. */
export function bannerMarkdown(html: string): string {
  return decodeEntities(
    html
      .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
        const label = text.replace(/<[^>]*>/g, "").trim();
        const url = https(decodeEntities(href));
        return url && label ? `[${label}](${url})` : label;
      })
      .replace(/<br\s*\/?>|<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}
