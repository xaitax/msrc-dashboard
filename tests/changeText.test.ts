import { describe, expect, it } from "vitest";
import { changeTextParts } from "../src/core/changeText";

describe("changeTextParts", () => {
  it("shows the first recorded bounty status without a transition from a missing value", () => {
    expect(changeTextParts({ type: "bounty", summary: "Bounty — → Pending Review" })).toEqual(["Bounty pending review"]);
    expect(changeTextParts({ type: "bounty", summary: "Bounty — → Pending Review · Bounty program → Track A → B" }))
      .toEqual(["Bounty pending review · Program: Track A → B"]);
    expect(changeTextParts({ type: "bounty", summary: "Bounty None → Pending Review" })).toEqual(["Bounty None", "Pending Review"]);
  });

  it.each([20, 0])("shows a first recorded points value of %i without a transition", value => {
    const event = { type: "field_changed", summary: `Case point: — → ${value}` } as const;
    const expected = [`Recognition points set to ${value}`];
    expect(changeTextParts({ ...event, field: "casePoint", oldValue: null, newValue: value })).toEqual(expected);
    expect(changeTextParts(event)).toEqual(expected);
  });

  it("keeps genuine points transitions, including zero, and distinguishes removals", () => {
    const event = { type: "field_changed", field: "casePoint", summary: "Case point: 20 → 0", newValue: 0 } as const;
    expect(changeTextParts(event)).toEqual(["20", "0 recognition points"]);
    expect(changeTextParts({ ...event, oldValue: 0, newValue: 1, summary: "Case point: 0 → 1" })).toEqual(["0", "1 recognition point"]);
    expect(changeTextParts({ ...event, oldValue: 20, newValue: null, summary: "Case point: 20 → —" })).toEqual(["Recognition points no longer listed (was 20)"]);
  });

  it("preserves literal arrows within the old and new field values", () => {
    expect(changeTextParts({ type: "field_changed", summary: "Title: A → B → C → D", newValue: "C → D" }))
      .toEqual(["Title: A → B", "C → D"]);
  });

  it("renders the stored compound award with only the status transition", () => {
    const summary = "Bounty Pending Review → Awarded – Closed · Bounty amount — → $8,000 · Bounty program → Windows Insider Preview Bounty Program";
    const event = { type: "bounty", summary } as const;
    const structured = {
      ...event,
      oldValue: { status: "PENDING_REVIEW", amount: null, program: null },
      newValue: { status: "AWARDED_CLOSED", amount: 8000, program: "Windows Insider Preview Bounty Program" },
    };
    const expected = ["Bounty Pending Review", "Awarded – Closed · Amount: $8,000 · Program: Windows Insider Preview Bounty Program"];
    expect(changeTextParts(event)).toEqual(expected);
    expect(changeTextParts(structured)).toEqual(expected);
    expect(changeTextParts({ ...event, oldValue: structured.oldValue, newValue: { status: "AWARDED_CLOSED" } })).toEqual(expected);
    expect(changeTextParts(structured, "$8,000 bounty awarded")).toEqual(["$8,000 bounty awarded"]);
  });

  it("uses the recorded values even when the stored summary has no arrow", () => {
    expect(changeTextParts({ type: "bounty", summary: "Bounty changed", oldValue: null, newValue: { amount: 0 } }))
      .toEqual(["Bounty amount: $0"]);
    expect(changeTextParts({ type: "bounty", summary: "Bounty review started", oldValue: null, newValue: null }))
      .toEqual(["Bounty review started"]);
  });

  it("distinguishes missing, zero, changed, and removed amounts in older records", () => {
    const render = (summary: string) => changeTextParts({ type: "bounty", summary });
    expect(render("Bounty amount — → $0")).toEqual(["Bounty amount: $0"]);
    expect(render("Bounty amount $0 → $200")).toEqual(["Bounty amount $0", "$200"]);
    expect(render("Bounty Pending → Awarded · Bounty amount $100 → $200"))
      .toEqual(["Bounty Pending", "Awarded · Amount $100", "$200"]);
    expect(render("Bounty Awarded → — · Bounty amount $200 → —"))
      .toEqual(["Bounty status no longer listed (was Awarded) · Amount no longer listed (was $200)"]);
  });

  it("preserves literal program names and describes legacy removals without inventing a name", () => {
    const render = (summary: string) => changeTextParts({ type: "bounty", summary });
    const name = "Track A → B · Bounty program → Track C · Preview";
    expect(render("Bounty program → " + name)).toEqual(["Bounty program: " + name]);
    expect(render("Bounty program: " + name)).toEqual(["Bounty program: " + name]);
    expect(changeTextParts({ type: "bounty", summary: "Bounty program A → B → " + name,
      oldValue: { program: "A → B" }, newValue: { program: name } }))
      .toEqual(["Bounty program A → B", name]);
    expect(render("Bounty amount — → $500 · Bounty program → " + name)).toEqual(["Bounty amount: $500 · Program: " + name]);
    expect(render("Bounty program → —")).toEqual(["Bounty program no longer listed"]);
    expect(render("Bounty amount $200 → — · Bounty program → —"))
      .toEqual(["Bounty amount no longer listed (was $200) · Program no longer listed"]);
  });

  it("leaves titles, file names, disclosure names and messages readable as supplied", () => {
    for (const type of ["case_added", "file_added", "disclosure_event", "msrc_message", "own_message"] as const) {
      expect(changeTextParts({ type, summary: "A → B" })).toEqual(["A → B"]);
    }
    expect(changeTextParts({ type: "status_reason", summary: "Action required" })).toEqual(["Action required"]);
  });
});
