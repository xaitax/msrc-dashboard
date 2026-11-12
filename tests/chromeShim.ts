// Minimal in-memory stand-in for the chrome.* APIs the background uses.
import { vi } from "vitest";

function area() {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data[k] !== undefined) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    async setAccessLevel() {},
  };
}

export function installChromeShim() {
  const chrome = {
    runtime: { id: "testextensionid", sendMessage: vi.fn(async () => undefined), getURL: (p: string) => `chrome-extension://testextensionid/${p}` },
    storage: { local: area(), session: area() },
    declarativeNetRequest: { updateDynamicRules: vi.fn(async () => {}) },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chrome;
  return chrome;
}
