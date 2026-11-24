// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_KEY } from "../src/dashboard/appearance";
import { useAppearance } from "../src/dashboard/useAppearance";

let control: ReturnType<typeof useAppearance>;
function Harness() {
  control = useAppearance();
  return null;
}

const system = Object.assign(new EventTarget(), { matches: false });
const meta = document.createElement("meta");
meta.name = "color-scheme";
const scheme = () => document.documentElement.dataset.theme;
function changeSystem(dark: boolean) {
  act(() => {
    system.matches = dark;
    system.dispatchEvent(new Event("change"));
  });
}

beforeEach(() => {
  localStorage.clear();
  system.matches = false;
  vi.stubGlobal("matchMedia", () => system);
  document.head.append(meta);
});
afterEach(() => {
  act(() => render(null, document.body));
  meta.remove();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe("dashboard appearance", () => {
  it("uses the saved override before the application mounts", async () => {
    localStorage.setItem(APPEARANCE_KEY, "dark");
    await import("../src/dashboard/appearanceBoot");
    expect([scheme(), meta.content]).toEqual(["dark", "dark"]);
  });

  it("follows system changes, preserves an explicit choice, and can return to system", () => {
    localStorage.setItem(APPEARANCE_KEY, "invalid");
    act(() => render(<Harness />, document.body));
    expect([control.preference, scheme(), meta.content]).toEqual(["system", "light", "light dark"]);
    changeSystem(true);
    expect(scheme()).toBe("dark");
    act(() => control.choose("dark"));
    changeSystem(false);
    expect([scheme(), meta.content, localStorage.getItem(APPEARANCE_KEY)]).toEqual(["dark", "dark", "dark"]);
    act(() => control.choose("system"));
    expect([scheme(), meta.content, localStorage.getItem(APPEARANCE_KEY)]).toEqual(["light", "light dark", null]);
  });

  it("updates an open tab when another tab changes or clears its preference", () => {
    system.matches = true;
    act(() => render(<Harness />, document.body));
    localStorage.setItem(APPEARANCE_KEY, "light");
    const signal = (key: string | null) => act(() => {
      window.dispatchEvent(new StorageEvent("storage", { storageArea: localStorage, key }));
    });
    signal(APPEARANCE_KEY);
    expect([control.preference, scheme(), meta.content]).toEqual(["light", "light", "light"]);
    localStorage.clear();
    signal(null);
    expect([control.preference, scheme(), meta.content]).toEqual(["system", "dark", "light dark"]);
  });
});
