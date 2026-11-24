export type Appearance = "system" | "light" | "dark";

export const APPEARANCE_KEY = "msrc-dashboard-appearance";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(APPEARANCE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch { /* Storage may be blocked in this browser. */ }
  return "system";
}

export function saveAppearance(value: Appearance): void {
  try {
    if (value === "system") localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, value);
  } catch { /* The choice still applies to this tab. */ }
}

export function applyAppearance(value: Appearance, systemDark: boolean): void {
  document.documentElement.dataset.theme = value === "system" ? (systemDark ? "dark" : "light") : value;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = value === "system" ? "light dark" : value;
}
