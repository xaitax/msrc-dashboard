// Runtime messages between content script, service worker and dashboard.
import type { VulnId } from "./types";

export type AuthState = "ok" | "signed_out" | "relogin";

export interface SyncProgress {
  phase: "cases" | "messages" | "sweep";
  done: number;
  total: number | null;
}

export interface AppState {
  auth: AuthState;
  lastSyncAt: number | null;
  lastError: string | null;
  syncing: boolean;
  baselineDone: boolean;
  progress: SyncProgress | null;
  sessionExpiresAt: number | null;
  sessionStartedAt: number | null;
  lastSessionLengthMs: number | null;
}

export type Msg =
  | { type: "snapshot:push"; entries: Record<string, string> }
  | { type: "snapshot:get" }
  | { type: "sync:now"; full?: boolean }
  | { type: "seen:mark"; reportNumber?: VulnId }
  | { type: "state:get" }
  | { type: "db:changed" }
  | { type: "relogin:start" }
  | { type: "extras:get"; force?: boolean }
  /** Dashboard page → SW: an access token for the page's own write calls (extension pages only). */
  | { type: "auth:token"; fresh?: boolean }
  /** Dashboard → SW: the researcher ties a public CVE to a case (null = "not mine", undefined = forget). */
  | { type: "cve:link"; cve: string; reportNumber: VulnId | null | undefined };

export type TokenReply = { token: string } | { error: "signed_out" | string };

/** A runtime message to the extension. Resolves undefined when nobody answers
 *  (worker asleep, page closing, or the extension reloaded under a page). */
export function send<T = unknown>(msg: Msg): Promise<T | undefined> {
  try {
    return (chrome.runtime.sendMessage(msg) as Promise<T>).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
