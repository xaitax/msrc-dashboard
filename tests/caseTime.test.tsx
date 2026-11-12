// @vitest-environment happy-dom
// The 90-day mark and MSRC's silence: on the board card and on the case page.
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { caseClock, type ClockInput } from "../src/core/caseClock";
import { CaseCard } from "../src/dashboard/components/Board";
import { CaseTime } from "../src/dashboard/components/CaseTime";
import { buildView } from "../src/dashboard/data";
import type { AppState } from "../src/shared/protocol";
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
  it("shows a case nearing the 90-day mark that MSRC hasn't touched since the receipt", () => {
    card("REVIEW_REPRO", 83, [{ daysAgo: 83, from: "MSRC" }]);
    expect(text(".card__clock")).toBe("Day 83 of 90 MSRC silent since submission");
    expect(host.querySelector(".card__clock .tag--soon")).toBeTruthy();
  });

  it("marks a case past the 90-day mark, and a message MSRC hasn't answered", () => {
    card("DEVELOP", 141, [
      { daysAgo: 141, from: "MSRC" },
      { daysAgo: 20, from: "MSRC" },
      { daysAgo: 15, from: "Researcher" },
    ]);
    expect(host.querySelector(".card__clock .tag--past")?.textContent).toBe("Day 141, past 90");
    expect(text(".card__clock .tag--quiet")).toBe("No reply for 15 days");
  });

  it("stays plain for a young case with recent activity, and for closed cases", () => {
    card("REVIEW_REPRO", 40, [{ daysAgo: 3, from: "MSRC" }]);
    expect(host.querySelector(".card__clock")).toBeNull();
    card("COMPLETE", 200, [{ daysAgo: 150, from: "MSRC" }]);
    expect(host.querySelector(".card__clock")).toBeNull();
  });
});

describe("case page", () => {
  it("counts the days against the mark and says MSRC has only sent the receipt", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(83), msrcTimes: [daysAgo(83)] })} now={NOW} />, host);
    expect(host.querySelector(".ctime--soon")).toBeTruthy();
    expect(text(".ctime__head")).toMatch(/^Day 83 since you submitted\. The 90-day mark is .+, in 7 days\.$/);
    expect(text(".ctime__msrc")).toBe("Nothing from MSRC since the automatic receipt when you submitted.");
  });

  it("says when the mark passed and that the researcher's message is unanswered", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(141), msrcTimes: [daysAgo(141), daysAgo(20)], ownTimes: [daysAgo(15)] })} now={NOW} />, host);
    expect(host.querySelector(".ctime--past")).toBeTruthy();
    expect(text(".ctime__head")).toMatch(/^Day 141 since you submitted\. The 90-day mark passed on .+, 51 days ago\.$/);
    expect(text(".ctime__msrc")).toMatch(/^MSRC last wrote or changed the status on .+, 20 days ago\. You wrote on .+ and haven't had a reply\.$/);
  });

  it("draws the mark inside the bar once a case runs past it", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(180) })} now={NOW} />, host);
    expect((host.querySelector(".ctime__mark") as HTMLElement).style.left).toBe("50%");
    expect((host.querySelector(".ctime__fill") as HTMLElement).style.width).toBe("100%");
  });

  it("says today or yesterday without repeating the date", () => {
    render(<CaseTime clock={clock({ msrcTimes: [new Date(NOW.getTime() - 3_600_000).toISOString()] })} now={NOW} />, host);
    expect(text(".ctime__msrc")).toBe("MSRC last wrote or changed the status today.");
    render(<CaseTime clock={clock({ msrcTimes: [daysAgo(1)] })} now={NOW} />, host);
    expect(text(".ctime__msrc")).toBe("MSRC last wrote or changed the status yesterday.");
  });

  it("covers a case MSRC never wrote on", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(10), msrcTimes: [] })} now={NOW} />, host);
    expect(text(".ctime__msrc")).toBe("MSRC hasn't written yet.");
  });

  it("only says when MSRC last wrote once the fix is public", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(120), fixedPublicly: true, msrcTimes: [daysAgo(4)] })} now={NOW} />, host);
    expect(host.querySelector(".ctime__head")).toBeNull();
    expect(host.querySelector(".ctime__bar")).toBeNull();
    expect(text(".ctime__msrc")).toMatch(/4 days ago\.$/);
  });

  it("shows nothing on a closed case", () => {
    render(<CaseTime clock={clock({ submittedAt: daysAgo(120), open: false, msrcTimes: [daysAgo(4)] })} now={NOW} />, host);
    expect(host.innerHTML).toBe("");
  });
});
