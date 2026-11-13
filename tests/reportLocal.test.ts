import { beforeEach, describe, expect, it } from "vitest";
import { emptyForm } from "../src/core/reportForm";
import { clearLocal, loadLocal, localKey, saveLocal, unsavedNewTitle } from "../src/dashboard/reportLocal";

beforeEach(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
});

describe("local autosave", () => {
  it("keeps one copy per draft and one for the unsaved new report", () => {
    expect(localKey(null)).toBe("msrc-dashboard:report:new");
    expect(localKey("124103c7-209b-4948-9aea-d48bdae6b026")).toBe("msrc-dashboard:report:124103c7-209b-4948-9aea-d48bdae6b026");
  });

  it("round-trips a form with its time", () => {
    const f = { ...emptyForm(), title: "Kept" };
    saveLocal(null, f, 1000);
    expect(loadLocal(null)).toEqual({ form: f, at: 1000 });
    expect(unsavedNewTitle()).toBe("Kept");
    clearLocal(null);
    expect(loadLocal(null)).toBeNull();
    expect(unsavedNewTitle()).toBeNull();
  });

  it("ignores broken or foreign data", () => {
    localStorage.setItem(localKey(null), "{not json");
    expect(loadLocal(null)).toBeNull();
    localStorage.setItem(localKey(null), JSON.stringify({ form: { title: 5 }, at: 1 }));
    expect(loadLocal(null)).toBeNull();
  });

  it("fills fields that older copies did not have", () => {
    localStorage.setItem(localKey(null), JSON.stringify({ form: { title: "Old" }, at: 2 }));
    expect(loadLocal(null)).toEqual({ form: { ...emptyForm(), title: "Old" }, at: 2 });
  });

  it("moves old hidden exploit details into editable fields", () => {
    localStorage.setItem(localKey(null), JSON.stringify({ form: { title: "Old", isExploited: true, keep: { isExploitedDiscovery: "Telemetry", isExploitedScale: "Small", aiConversationId: "chat" } }, at: 3 }));
    expect(loadLocal(null)?.form).toMatchObject({ isExploitedDiscovery: "Telemetry", isExploitedScale: "Small", aiConversationId: "chat", keep: { aiConversationId: "chat" } });
  });
});
