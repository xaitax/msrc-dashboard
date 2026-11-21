// @vitest-environment happy-dom
// The 90-day mark and MSRC's silence: on the board card and on the case page.
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { caseClock, type ClockInput } from "../src/core/caseClock";
import { CaseCard } from "../src/dashboard/components/Board";
import { CaseTime } from "../src/dashboard/components/CaseTime";
import { buildView } from "../src/dashboard/data";
import type { AppState } from "../src/shared/protocol";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec, msg } from "./helpers";

const NOW = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const STATE: AppState = { auth: "ok", lastSyncAt: NOW.getTime(), lastError: null, syncing: false, baselineDone: true, progress: null, sessionExpiresAt: null, sessionStartedAt: null, lastSessionLengthMs: null };
const clock = (over: Partial<ClockInput>) => caseClock({ submittedAt: daysAgo(40), open: true, fixedPublicly: false, actionNeeded: false, msrcTimes: [], ownTimes: [], ...over }, NOW);

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});
const text = (sel: string) => host.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

function card(status: string, submittedDaysAgo: number, msgs: { daysAgo: number; from: string }[]) {
  const rec = caseRec("VULN-1", { status }, { list: { status, ticketNumber: "100140", createdOn: daysAgo(submittedDaysAgo) } });
  const v = buildView([rec], msgs.map((m) => msg({ reportNumber: "VULN-1", createdOn: daysAgo(m.daysAgo), senderName: m.from })), [], STATE, {}, [], {}, NOW);
  render(<CaseCard row={v.rows[0]!} onOpen={() => {}} />, host);
}

describe("board card", () => {
  it("shows local tags as quiet text and puts the latest activity beside its date", () => {
    const rec = caseRec("VULN-1", { status: "DEVELOP" }, { list: { status: "DEVELOP", createdOn: daysAgo(10) } });
    const event: ChangeEvent = { key: "reply", reportNumber: "VULN-1", ticketNumber: "100140", type: "msrc_message", summary: "MSRC replied", occurredAt: daysAgo(1), detectedAt: daysAgo(1), seen: true, own: false };
    const view = buildView([rec], [], [event], STATE, {}, [], {}, NOW, [{ reportNumber: "VULN-1", note: "Still researching", tags: ["WManSvc", "Autopilot"] }]);
    render(<CaseCard row={view.rows[0]!} onOpen={() => {}} />, host);
    expect(text(".card__top .card__meta-tags")).toBe("Autopilot, WManSvc");
    expect(text(".card__top .card__note")).toBe("Private note saved");
    expect(text(".card__last")).toBe("MSRC replied");
    expect(host.querySelector(".card__foot time")).toBeTruthy();
    expect(host.querySelector(".card__top .card__when, .card__foot .dot, .card__tags")).toBeNull();
  });

  it("shows a case nearing the 90-day mark that MSRC hasn't touched since the receipt", () => {
    card("REVIEW_REPRO", 83, [{ daysAgo: 83, from: "MSRC" }]);
    expect(text(".card-clock__metric--soon strong")).toBe("Day 83");
    expect(text(".card-clock__metric--soon small")).toBe("90-day mark in 7 days");
    expect(text(".card-clock__metric--msrc strong")).toBe("No update");
    expect(text(".card-clock__metric--msrc small")).toBe("Since submission");
  });

  it("marks a case past the 90-day mark, and a message MSRC hasn't answered", () => {
    card("DEVELOP", 141, [
      { daysAgo: 141, from: "MSRC" },
      { daysAgo: 20, from: "MSRC" },
      { daysAgo: 15, from: "Researcher" },
    ]);
    expect(text(".card-clock__metric--past strong")).toBe("Day 141");
    expect(text(".card-clock__metric--past small")).toBe("Past the 90-day mark");
    expect(text(".card-clock__metric--msrc strong")).toBe("15 days");
    expect(text(".card-clock__metric--msrc small")).toBe("Awaiting MSRC reply");
  });

  it("shows MSRC silence beside a neutral age marker on a younger case", () => {
    card("DEVELOP", 50, [{ daysAgo: 31, from: "MSRC" }]);
    expect(host.querySelector(".card-clock__metric--past, .card-clock__metric--soon")).toBeNull();
    expect(text(".card-clock__metric--running strong")).toBe("Day 50");
    expect(text(".card-clock__metric--msrc strong")).toBe("31 days");
    expect(text(".card-clock__metric--msrc small")).toBe("Since MSRC activity");
  });

  it("keeps both timing slots on young cases and stops the clock on closed cases", () => {
    card("REVIEW_REPRO", 40, [{ daysAgo: 3, from: "MSRC" }]);
    expect(text(".card-clock__metric--running small")).toBe("Since submission");
    expect(text(".card-clock__metric--msrc small")).toBe("Last MSRC activity");
    card("COMPLETE", 200, [{ daysAgo: 150, from: "MSRC" }]);
    expect(host.querySelector(".card__clock")).toBeNull();
  });
});

describe("case page", () => {
  it("counts the days against the mark and says MSRC has only sent the receipt", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(83), msrcTimes: [daysAgo(83)] })} now={NOW} />, host);
    expect(host.querySelector(".ctime--soon")).toBeTruthy();
    expect(text(".ctime__elapsed")).toBe("Day 83");
    expect(text(".ctime__remaining")).toBe("7 days");
    expect(host.querySelector(".ctime__deadline time")?.getAttribute("datetime")).toBe(daysAgo(-7));
    expect(text(".ctime__msrc time")).toBe("Receipt only");
  });

  it("says when the mark passed and that the researcher's message is unanswered", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(141), msrcTimes: [daysAgo(141), daysAgo(20)], ownTimes: [daysAgo(15)] })} now={NOW} />, host);
    expect(host.querySelector(".ctime--past")).toBeTruthy();
    expect(text(".ctime__elapsed")).toBe("Day 141");
    expect(text(".ctime__remaining")).toBe("51 days");
    expect(text(".ctime__msrc time")).toBe("20 days ago");
    expect(host.querySelector(".ctime__unanswered time")?.getAttribute("datetime")).toBe(daysAgo(15));
  });

  it("draws the mark inside the bar once a case runs past it", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(180) })} now={NOW} />, host);
    expect((host.querySelector(".ctime__mark") as HTMLElement).style.left).toBe("50%");
    expect((host.querySelector(".ctime__fill") as HTMLElement).style.width).toBe("100%");
  });

  it("says today or yesterday without repeating the date", () => {
    render(<CaseTime clock={clock({ msrcTimes: [new Date(NOW.getTime() - 3_600_000).toISOString()] })} now={NOW} />, host);
    expect(text(".ctime__msrc time")).toBe("Today");
    render(<CaseTime clock={clock({ msrcTimes: [daysAgo(1)] })} now={NOW} />, host);
    expect(text(".ctime__msrc time")).toBe("Yesterday");
  });

  it("covers a case MSRC never wrote on", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(10), msrcTimes: [] })} now={NOW} />, host);
    expect(text(".ctime__msrc strong")).toBe("No update yet");
  });

  it("only says when MSRC last wrote once the fix is public", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(120), fixedPublicly: true, msrcTimes: [daysAgo(4)] })} now={NOW} />, host);
    expect(host.querySelector(".ctime__metrics")).toBeNull();
    expect(host.querySelector(".ctime__bar")).toBeNull();
    expect(text(".ctime__msrc time")).toBe("4 days ago");
  });

  it("shows nothing on a closed case", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(120), open: false, msrcTimes: [daysAgo(4)] })} now={NOW} />, host);
    expect(host.innerHTML).toBe("");
  });
});
