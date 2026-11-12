import { describe, expect, it } from "vitest";
import { planNotifications } from "../src/core/notifyPlan";
import type { ChangeEvent } from "../src/shared/types";

let i = 0;
function ev(p: Partial<ChangeEvent> & Pick<ChangeEvent, "reportNumber" | "type" | "summary">): ChangeEvent {
  i += 1;
  return { key: `k${i}`, ticketNumber: "100140", occurredAt: "2026-11-11T10:00:00Z", detectedAt: "2026-11-11T10:01:00Z", seen: false, own: false, ...p };
}

describe("planNotifications", () => {
  it("never notifies own or already-seen events", () => {
    expect(
      planNotifications([
        ev({ reportNumber: "VULN-1", type: "own_message", summary: "You replied", own: true, seen: true }),
        ev({ reportNumber: "VULN-1", type: "status", summary: "Status A → B", seen: true }),
      ]),
    ).toEqual([]);
  });

  it("groups one case's changes into one notification, MSRC reply first", () => {
    const plans = planNotifications([
      ev({ reportNumber: "VULN-1", type: "status", summary: "Status Review / Repro → Develop" }),
      ev({ reportNumber: "VULN-1", type: "msrc_message", summary: "MSRC replied" }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: "100140 · MSRC replied", reportNumber: "VULN-1" });
    expect(plans[0]!.message).toBe("MSRC replied · Status Review / Repro → Develop");
  });

  it("counts several MSRC replies on one case", () => {
    const plans = planNotifications([
      ev({ reportNumber: "VULN-1", type: "msrc_message", summary: "MSRC replied" }),
      ev({ reportNumber: "VULN-1", type: "msrc_message", summary: "MSRC replied" }),
    ]);
    expect(plans[0]!.title).toBe("100140 · MSRC replied (2)");
  });

  it("collapses more than 3 changed cases into one summary", () => {
    const plans = planNotifications(["VULN-1", "VULN-2", "VULN-3", "VULN-4"].map((rn, n) => ev({ reportNumber: rn, ticketNumber: String(100 + n), type: "status", summary: "Status x" })));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.title).toBe("4 cases changed");
    expect(plans[0]!.reportNumber).toBeUndefined();
    expect(plans[0]!.message).toContain("100");
  });

  it("keeps exactly 3 cases as 3 notifications", () => {
    expect(planNotifications(["VULN-1", "VULN-2", "VULN-3"].map((rn) => ev({ reportNumber: rn, type: "cve", summary: "CVE" })))).toHaveLength(3);
  });

  it("labels cases without a ticket number by VULN id", () => {
    expect(planNotifications([ev({ reportNumber: "VULN-7", ticketNumber: null, type: "file_added", summary: "File added: a" })])[0]!.title).toBe("VULN-7 · File added: a");
  });

  it("gives stable ids so a re-plan replaces instead of duplicating", () => {
    const e = [ev({ reportNumber: "VULN-1", type: "status", summary: "s" })];
    expect(planNotifications(e)[0]!.id).toBe(planNotifications(e)[0]!.id);
  });
});
