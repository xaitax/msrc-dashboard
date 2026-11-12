// HTML → plain text without a DOM, so it runs in the service worker, the
// dashboard and tests alike. Output is only ever rendered as text — this is a
// readability transform, not a sanitizer. Non-HTML input passes through.

const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const BLOCK = new Set(["p", "div", "br", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "blockquote", "pre", "hr", "section"]);
const TAG_RE = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
const LOOKS_HTML = /<\/?(p|div|br|span|a|b|i|strong|em|ul|ol|li|h[1-6]|table|pre|code|blockquote|script|style)\b[^>]*>/i;

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(body: string | null | undefined): string {
  const input = body ?? "";
  if (!LOOKS_HTML.test(input)) return decodeEntities(input);

  let out = "";
  let skipUntil: string | null = null; // inside <script>/<style>
  let preDepth = 0;
  const hrefs: (string | null)[] = [];
  let linkTextStart = 0;
  let last = 0;

  const emitText = (raw: string) => {
    if (skipUntil) return;
    const t = preDepth > 0 ? raw : raw.replace(/\s+/g, " ");
    out += decodeEntities(t);
  };

  for (const m of input.matchAll(TAG_RE)) {
    emitText(input.slice(last, m.index));
    last = m.index! + m[0].length;
    const name = (m[1] ?? "").toLowerCase();
    if (!name) continue; // comment
    const closing = m[0].startsWith("</");
    if (skipUntil) {
      if (closing && name === skipUntil) skipUntil = null;
      continue;
    }
    if (!closing && (name === "script" || name === "style")) {
      skipUntil = name;
      continue;
    }
    if (name === "pre") preDepth += closing ? -1 : 1;
    if (name === "li" && !closing) out += "\n- ";
    else if (BLOCK.has(name)) out += "\n";
    if (name === "a") {
      if (!closing) {
        const href = /href\s*=\s*["']([^"']*)["']/i.exec(m[2] ?? "")?.[1] ?? null;
        hrefs.push(href ? decodeEntities(href) : null);
        linkTextStart = out.length;
      } else {
        const href = hrefs.pop();
        const text = out.slice(linkTextStart).trim();
        if (href && href !== text) out += ` (${href})`;
      }
    }
  }
  emitText(input.slice(last));

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
