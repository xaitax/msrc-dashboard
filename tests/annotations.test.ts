import { describe, expect, it } from "vitest";
import { addTag, cleanTag, hasTag, sortedTags, tagCounts, tagKey } from "../src/core/annotations";

describe("private case tags", () => {
  it("keeps Unicode spelling and merges equivalent or differently cased tags", () => {
    const tags = addTag(addTag([], "  Cafe\u0301   Service  "), "\uD83D\uDD10 驱动程序");
    expect(tags).toEqual(["Café Service", "🔐 驱动程序"]);
    expect(addTag(tags, "CAFÉ SERVICE")).toBe(tags);
    expect(cleanTag(" \n print\t driver ")).toBe("print driver");
    expect(hasTag(tags, tagKey("cafe\u0301 service"))).toBe(true);
  });

  it("sorts selectable tags for display and counts cases", () => {
    const annotations = [
      { reportNumber: "VULN-1", note: "", tags: ["WPR", "驱动程序"] },
      { reportNumber: "VULN-2", note: "", tags: ["wpr", "Áudio"] },
    ];
    expect(tagCounts(annotations)).toEqual([
      { tag: "Áudio", count: 1 },
      { tag: "WPR", count: 2 },
      { tag: "驱动程序", count: 1 },
    ]);
    expect(sortedTags(["Zeta", "Audio", "Beta"])).toEqual(["Audio", "Beta", "Zeta"]);
  });
});
