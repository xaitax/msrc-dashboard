import { useEffect, useState } from "preact/hooks";
import type { AlertLevel, PortalSettings } from "../../core/portalConfig";
import { Markdown } from "./Markdown";

// MSRC's site-wide alert and announcement banners, as the portal shows them
// above every page. Each can be dismissed; a changed text shows again.

const KEY = "msrc-dashboard:dismissed-announcements";
const REFRESH_MS = 30 * 60_000;

interface Notice {
  key: string;
  level: AlertLevel;
  text: string;
}

function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function notices(s: PortalSettings): Notice[] {
  const out: Notice[] = [];
  const a = s.alert;
  if (a) {
    const link = a.linkText && a.linkUrl ? ` [${a.linkText}](${a.linkUrl})` : "";
    out.push({ key: `alert:${a.content}${link}`, level: a.level, text: `${a.content}${link}` });
  }
  for (const b of s.banners) out.push({ key: `banner:${b.id}:${b.content}`, level: b.level, text: b.content });
  return out;
}

export function Announcements({ load }: { load: () => Promise<PortalSettings> }) {
  const [list, setList] = useState<Notice[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      load()
        .then((s) => live && setList(notices(s)))
        .catch(() => {}); // announcements are a nicety; never an error on the page
    void refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [load]);

  const shown = list.filter((n) => !dismissed.includes(n.key));
  if (!shown.length) return null;
  const dismiss = (key: string) => {
    const next = [...dismissed.filter((k) => k !== key), key].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private window or blocked storage: dismissed for this page only
    }
  };

  return (
    <div class="notices">
      {shown.map((n) => (
        <div key={n.key} class={`notice notice--${n.level}`} role="status">
          <Markdown class="notice__text" src={n.text} />
          <button type="button" class="notice__x" aria-label={`Dismiss: ${n.text.replace(/ \[[^\]]*\]\([^)]*\)$/, "")}`} title="Dismiss" onClick={() => dismiss(n.key)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
