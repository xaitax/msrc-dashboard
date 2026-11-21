import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, addEvents, dropPublicCveEvent, getAllCases, getCaseAnnotations, getEvents, getMessages, getMeta, markSeen, putCases, putMessages, setMeta, updateCaseAnnotation } from "../src/store/db";
import type { ChangeEvent } from "../src/shared/types";
import { caseRec, msg } from "./helpers";

function ev(key: string, rn: string, p: Partial<ChangeEvent> = {}): ChangeEvent {
  return { key, reportNumber: rn, ticketNumber: null, type: "status", summary: "s", occurredAt: "2026-11-11T00:00:00Z", detectedAt: "2026-11-11T00:00:00Z", seen: false, own: false, ...p };
}

beforeEach(async () => {
  await _resetForTests();
});

describe("store", () => {
  it("adds the private annotation store to an existing version 1 database without losing cases", async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("msrc-dashboard", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("cases", { keyPath: "reportNumber" });
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("reportNumber", "reportNumber");
        const events = db.createObjectStore("events", { keyPath: "key" });
        events.createIndex("reportNumber", "reportNumber");
        db.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const t = old.transaction("cases", "readwrite");
      t.objectStore("cases").put(caseRec("VULN-1", { status: "NEW" }));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    old.close();
    expect((await getAllCases())[0]!.reportNumber).toBe("VULN-1");
    await updateCaseAnnotation("VULN-1", { tags: ["驱动程序"] });
    expect((await getCaseAnnotations())[0]!.tags).toEqual(["驱动程序"]);
  });

  it("inserts events once and returns only new ones", async () => {
    expect(await addEvents([ev("a", "VULN-1"), ev("b", "VULN-1")])).toHaveLength(2);
    expect(await addEvents([ev("a", "VULN-1"), ev("c", "VULN-2")])).toEqual([ev("c", "VULN-2")]);
    expect((await getEvents()).map((e) => e.key).sort()).toEqual(["a", "b", "c"]);
  });

  it("never lets a re-insert flip a seen event back to unseen", async () => {
    await addEvents([ev("a", "VULN-1")]);
    await markSeen("VULN-1");
    await addEvents([ev("a", "VULN-1")]);
    expect((await getEvents())[0]!.seen).toBe(true);
  });

  it("returns only previously unknown messages", async () => {
    const m1 = msg({ id: "m1", reportNumber: "VULN-1", createdOn: "2026-01-01T00:00:00Z" });
    const m2 = msg({ id: "m2", reportNumber: "VULN-2", createdOn: "2026-01-02T00:00:00Z" });
    expect(await putMessages([m1])).toEqual([m1]);
    expect(await putMessages([m1, m2])).toEqual([m2]);
    expect(await getMessages("VULN-2")).toEqual([m2]);
    expect(await getMessages()).toHaveLength(2);
  });

  it("marks seen per case or everything, returning the count", async () => {
    await addEvents([ev("a", "VULN-1"), ev("b", "VULN-2"), ev("c", "VULN-2")]);
    expect(await markSeen("VULN-2")).toBe(2);
    expect((await getEvents()).filter((e) => !e.seen).map((e) => e.key)).toEqual(["a"]);
    expect(await markSeen()).toBe(1);
  });

  it("round-trips cases and meta", async () => {
    await putCases([caseRec("VULN-1", { status: "NEW" })]);
    expect((await getAllCases())[0]!.reportNumber).toBe("VULN-1");
    await setMeta("lastSyncAt", 123);
    expect(await getMeta<number>("lastSyncAt")).toBe(123);
    expect(await getMeta("missing")).toBeUndefined();
  });

  it("keeps private notes and tags separate from portal records", async () => {
    await putCases([caseRec("VULN-1", { status: "NEW" })]);
    await updateCaseAnnotation("VULN-1", { note: "Remember: 🔐 服务" });
    await updateCaseAnnotation("VULN-1", { tags: ["WPR", "驱动程序"] });
    expect(await getCaseAnnotations()).toEqual([{ reportNumber: "VULN-1", note: "Remember: 🔐 服务", tags: ["WPR", "驱动程序"] }]);
    expect((await getAllCases())[0]!.detail?.["note"]).toBeUndefined();
    await updateCaseAnnotation("VULN-1", { note: "" });
    await updateCaseAnnotation("VULN-1", { tags: [] });
    expect(await getCaseAnnotations()).toEqual([]);
  });
});

describe("public CVE announcements follow the researcher's decision", () => {
  const ann = (rn: string): ChangeEvent => ({ key: "pubcve|CVE-2026-1001", reportNumber: rn as ChangeEvent["reportNumber"], ticketNumber: null, type: "cve", summary: "CVE-2026-1001 is public and credits you (…). Possibly this case", occurredAt: "2026-11-10T16:00:00Z", detectedAt: "2026-11-12T00:00:00Z", seen: false, own: false });

  it("'not mine' or a link to another case removes the guessed announcement", async () => {
    await addEvents([ann("VULN-1")]);
    await dropPublicCveEvent("CVE-2026-1001", "VULN-2");
    expect(await getEvents()).toEqual([]);
    await addEvents([ann("VULN-1")]);
    await dropPublicCveEvent("CVE-2026-1001", null);
    expect(await getEvents()).toEqual([]);
  });

  it("confirming the guessed case keeps it", async () => {
    await addEvents([ann("VULN-1")]);
    await dropPublicCveEvent("CVE-2026-1001", "VULN-1");
    expect((await getEvents()).map((e) => e.key)).toEqual(["pubcve|CVE-2026-1001"]);
  });
});
