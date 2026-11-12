import { describe, expect, it } from "vitest";
import { parseMarkdown, type Block, type Inline } from "../src/core/markdown";

const text = (v: string): Inline => ({ t: "text", v });

describe("parseMarkdown", () => {
  it("parses headings, paragraphs and emphasis", () => {
    expect(parseMarkdown("## Impact\nA **SYSTEM** write via *any* user and `code`.")).toEqual<Block[]>([
      { t: "h", level: 2, c: [text("Impact")] },
      { t: "p", c: [text("A "), { t: "b", c: [text("SYSTEM")] }, text(" write via "), { t: "i", c: [text("any")] }, text(" user and "), { t: "code", v: "code" }, text(".")] },
    ]);
  });
  it("keeps single line breaks inside a paragraph", () => {
    expect(parseMarkdown("Hello,\nthanks")).toEqual<Block[]>([{ t: "p", c: [text("Hello,"), { t: "br" }, text("thanks")] }]);
  });
  it("parses bullet and numbered lists", () => {
    expect(parseMarkdown("- one\n- two\n\n1. first\n2. second")).toEqual<Block[]>([
      { t: "ul", items: [[text("one")], [text("two")]] },
      { t: "ol", items: [[text("first")], [text("second")]] },
    ]);
  });
  it("keeps fenced code verbatim", () => {
    expect(parseMarkdown("```c\nint *p = **q;\n```")).toEqual<Block[]>([{ t: "pre", lang: "c", v: "int *p = **q;" }]);
  });
  it("links only https URLs and autolinks bare ones", () => {
    const [p] = parseMarkdown("See [docs](https://example.com/a) or [x](javascript:alert(1)) and https://msrc.microsoft.com/x.");
    expect(p).toEqual<Block>({
      t: "p",
      c: [text("See "), { t: "a", href: "https://example.com/a", c: [text("docs")] }, text(" or x (javascript:alert(1)) and "), { t: "a", href: "https://msrc.microsoft.com/x", c: [text("https://msrc.microsoft.com/x")] }, text(".")],
    });
  });
  it("leaves HTML as plain text and decodes entities", () => {
    expect(parseMarkdown("<script>alert(1)</script>&nbsp;Case&#39;s")).toEqual<Block[]>([{ t: "p", c: [text("<script>alert(1)</script> Case's")] }]);
  });
  it("does not italicise snake_case identifiers", () => {
    expect(parseMarkdown("call some_func_name now")).toEqual<Block[]>([{ t: "p", c: [text("call some_func_name now")] }]);
  });
  it("parses quotes and rules", () => {
    expect(parseMarkdown("> quoted **text**\n\n---")).toEqual<Block[]>([{ t: "quote", c: [{ t: "p", c: [text("quoted "), { t: "b", c: [text("text")] }] }] }, { t: "hr" }]);
  });
});
