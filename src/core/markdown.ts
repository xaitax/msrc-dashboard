// Minimal, safe Markdown → AST. The dashboard renders the AST as Preact
// elements, never as an HTML string, so API text can't inject markup: raw HTML
// stays text and only https: links become links. Covers what MSRC mails and
// reports use: headings, paragraphs (single newlines kept), **bold**, *italic*,
// `code`, fenced code, lists, quotes, rules, [links](https://…) and bare URLs.
import { decodeEntities } from "./text";

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "h"; level: number; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "pre"; lang: string; v: string }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "quote"; c: Block[] }
  | { t: "hr" };

const LINK_RE = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;
const URL_RE = /^https:\/\/[^\s<>()]*[^\s<>().,;:!?'"\]]/;
const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

function pushText(out: Inline[], v: string): void {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const rest = s.slice(i);
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ t: "code", v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = LINK_RE.exec(rest);
      if (m) {
        const href = m[2]!;
        if (/^https:\/\//i.test(href)) out.push({ t: "a", href, c: parseInline(m[1]!) });
        else pushText(out, `${m[1]} (${href})`);
        i += m[0].length;
        continue;
      }
    }
    if (rest.startsWith("**") || (rest.startsWith("__") && !isWord(s[i - 1]))) {
      const mark = rest.slice(0, 2);
      const end = s.indexOf(mark, i + 2);
      if (end > i + 2 && (mark === "**" || !isWord(s[end + 2]))) {
        out.push({ t: "b", c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && s[i + 1] && s[i + 1] !== " " && s[i + 1] !== ch && !(ch === "_" && isWord(s[i - 1]))) {
      let end = s.indexOf(ch, i + 1);
      while (end > 0 && ch === "_" && isWord(s[end + 1])) end = s.indexOf(ch, end + 1);
      if (end > i + 1 && s[end - 1] !== " ") {
        out.push({ t: "i", c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "h" && !isWord(s[i - 1]) && s[i - 1] !== "(") {
      const m = URL_RE.exec(rest);
      if (m) {
        out.push({ t: "a", href: m[0], c: [{ t: "text", v: m[0] }] });
        i += m[0].length;
        continue;
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

function inlineLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((l, k) => {
    if (k > 0) out.push({ t: "br" });
    for (const node of parseInline(l.trim())) node.t === "text" ? pushText(out, node.v) : out.push(node);
  });
  return out;
}

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const startsBlock = (l: string) => FENCE.test(l) || HEAD.test(l) || HR.test(l) || QUOTE.test(l) || UL.test(l) || OL.test(l);

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = FENCE.exec(line))) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (or end)
      out.push({ t: "pre", lang: m[1] ?? "", v: body.join("\n") });
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if ((m = HEAD.exec(line))) {
      out.push({ t: "h", level: m[1]!.length, c: parseInline(m[2]!) });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]!))) {
        inner.push(m[1]!);
        i++;
      }
      out.push({ t: "quote", c: parseBlocks(inner) });
      continue;
    }
    const listRe = UL.test(line) ? UL : OL.test(line) ? OL : null;
    if (listRe) {
      const items: string[][] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const im = listRe.exec(l);
        if (im) items.push([im[1]!]);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items[items.length - 1]!.push(l.trim());
        else break;
        i++;
      }
      out.push({ t: listRe === UL ? "ul" : "ol", items: items.map((it) => inlineLines(it)) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && (para.length === 0 || !startsBlock(lines[i]!))) para.push(lines[i++]!);
    out.push({ t: "p", c: inlineLines(para) });
  }
  return out;
}

export function parseMarkdown(src: string | null | undefined): Block[] {
  return parseBlocks(decodeEntities(src ?? "").replace(/\r\n?/g, "\n").split("\n"));
}
