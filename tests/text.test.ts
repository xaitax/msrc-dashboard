import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/core/text";

describe("htmlToText", () => {
  it("strips tags and scripts, decodes entities, keeps line breaks", () => {
    expect(htmlToText("<p>Hi&nbsp;<b>there</b><script>alert(1)</script></p><br>x")).toBe("Hi there\nx");
  });
  it("keeps link targets", () => {
    expect(htmlToText('<a href="https://example.com/a">docs</a>')).toBe("docs (https://example.com/a)");
  });
  it("decodes numeric entities", () => {
    expect(htmlToText("a &#60;b&#x3e; &amp; c")).toBe("a <b> & c");
  });
  it("passes markdown and plain text through unchanged", () => {
    const md = "## Title\n\n- item *one*\n- `code`";
    expect(htmlToText(md)).toBe(md);
  });
  it("turns list items and paragraphs into lines", () => {
    expect(htmlToText("<p>one</p><ul><li>a</li><li>b</li></ul>")).toBe("one\n- a\n- b");
  });
});
