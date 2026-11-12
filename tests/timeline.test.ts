import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/core/timeline";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec, file, msg } from "./helpers";

const c = caseRec("VULN-1", { status: "DEVELOP" }, {
  list: { createdOn: "2026-08-01T10:00:00Z" },
  files: [{ ...file("f1", "poc.zip", "2026-08-01T10:05:00Z"), raw: { createdBy: "u", submittedById: "u" } }],
});
const msgs = [
  msg({ id: "m2", reportNumber: "VULN-1", createdOn: "2026-09-01T10:00:00Z", senderName: "MSRC", body: "<p>We confirmed the behavior you reported.</p>", raw: { topicList: ["AutoNotification"] } }),
  msg({ id: "m1", reportNumber: "VULN-1", createdOn: "2026-08-20T10:00:00Z", senderName: "Researcher", body: "Any update?" }),
];
const ev = (p: Partial<ChangeEvent> & Pick<ChangeEvent, "key" | "type" | "occurredAt">): ChangeEvent => ({
  reportNumber: "VULN-1", ticketNumber: null, summary: p.type, detectedAt: p.occurredAt, seen: true, own: false, ...p,
});
const events = [
  ev({ key: "a", type: "msrc_message", sourceId: "m2", occurredAt: "2026-09-01T10:00:00Z", seen: false }),
  ev({ key: "b", type: "own_message", sourceId: "m1", occurredAt: "2026-08-20T10:00:00Z", own: true }),
  ev({ key: "c", type: "status", summary: "Status Review / Repro → Develop", occurredAt: "2026-09-02T00:00:00Z", seen: false }),
];

describe("buildTimeline", () => {
  const t = buildTimeline(c, msgs, events);

  it("merges submission, files, messages and changes oldest first", () => {
    expect(t.map((i) => i.kind + ":" + i.text.slice(0, 18))).toEqual([
      "event:Report submitted",
      "file:poc.zip",
      "message:Any update?",
      "message:We confirmed the b",
      "event:Status Review / Re",
    ]);
  });

  it("does not duplicate message events next to their messages", () => {
    expect(t.filter((i) => i.kind === "event" && /replied|confirmed/i.test(i.text))).toHaveLength(0);
  });

  it("marks items new while their change is unseen, and labels MSRC templates", () => {
    const m2 = t.find((i) => i.kind === "message" && i.from === "msrc")!;
    expect(m2).toMatchObject({ isNew: true, label: "MSRC confirmed the behavior" });
    expect(t.find((i) => i.text.startsWith("Any update"))!).toMatchObject({ from: "you", isNew: false });
    expect(t.find((i) => i.kind === "event" && i.text.startsWith("Status"))!.isNew).toBe(true);
    expect(t.find((i) => i.kind === "file")!).toMatchObject({ isNew: false });
    expect(t.find((i) => i.kind === "file")!.from).toBeUndefined();
  });
});
