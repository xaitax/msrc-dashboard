import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createSync, MAX_RECHECKS } from "../src/background/sync";
import { _resetForTests, addEvents, getAllCases, getEvents, getMessages, getMeta, putCases, setMeta } from "../src/store/db";
import { fakeApi, type FakeState } from "./fakeApi";
import { file, msg } from "./helpers";

const G1 = "00000000-0000-0000-0000-000000000001";
const G2 = "00000000-0000-0000-0000-000000000002";
let clock = Date.parse("2026-11-11T12:00:00Z");
const now = () => new Date(clock);

function world(): FakeState {
  return {
    details: {
      "VULN-1": { id: G1, title: "Case one", ticketNumber: "100140", status: "REVIEW_REPRO", statusReason: null, cvssVectorString: "CVSS:3.1/AV:L", bounty: { status: "PENDING" }, lastActivityOn: "2026-11-01T00:00:00Z", variantOrRelatedCVE: null, createdOn: "2026-08-24T20:00:00Z" },
      "VULN-2": { id: G2, title: "Case two", ticketNumber: "100130", status: "DEVELOP", statusReason: null, cvssVectorString: "x", bounty: null, lastActivityOn: "2026-10-03T00:00:00Z", variantOrRelatedCVE: null, createdOn: "2026-07-01T00:00:00Z" },
    },
    messages: [
      msg({ id: "m1", reportNumber: "VULN-1", createdOn: "2026-10-01T00:00:00Z", senderName: "Researcher" }),
      msg({ id: "m2", reportNumber: "VULN-1", createdOn: "2026-11-01T00:00:00Z", senderName: "MSRC" }),
      msg({ id: "m3", reportNumber: "VULN-2", createdOn: "2026-10-03T00:00:00Z", senderName: "Researcher" }),
    ],
    files: { [G1]: [file("f1", "poc.zip", "2026-08-24T20:01:00Z")] },
  };
}

beforeEach(async () => {
  await _resetForTests();
  clock = Date.parse("2026-11-11T12:00:00Z");
});

async function baselined(state = world()) {
  const fa = fakeApi(state);
  const sync = createSync(fa.api, now, () => {});
  await sync.runBaseline();
  fa.calls.length = 0;
  return { ...fa, sync, state };
}

describe("sync engine", () => {
  it("baseline stores everything and creates no unseen events", async () => {
    await baselined();
    expect((await getAllCases()).map((c) => c.reportNumber).sort()).toEqual(["VULN-1", "VULN-2"]);
    expect(await getMessages()).toHaveLength(3);
    expect((await getAllCases()).find((c) => c.reportNumber === "VULN-1")!.files).toHaveLength(1);
    expect((await getEvents()).filter((e) => !e.seen)).toEqual([]);
  });

  it("a quiet poll costs exactly two requests and yields nothing", async () => {
    const { sync, calls } = await baselined();
    expect(await sync.runPoll()).toEqual([]);
    expect(calls).toEqual(["list", "messages:0"]);
  });

  it("a new MSRC reply refetches only that case and is reported", async () => {
    const { sync, calls, state } = await baselined();
    state.messages.push(msg({ id: "m4", reportNumber: "VULN-2", createdOn: "2026-11-11T10:05:00Z", senderName: "MSRC" }));
    const ev = await sync.runPoll();
    expect(calls).toEqual(["list", "messages:0", "detail:VULN-2", `files:${G2}`]);
    expect(ev.map((e) => [e.type, e.reportNumber, e.seen])).toEqual([["msrc_message", "VULN-2", false]]);
  });

  it("a status change in the list refetches that case and yields a status event", async () => {
    const { sync, calls, state } = await baselined();
    state.details["VULN-1"]!["status"] = "DEVELOP";
    const ev = await sync.runPoll();
    expect(calls).toContain("detail:VULN-1");
    expect(calls).not.toContain("detail:VULN-2");
    expect(ev.map((e) => e.type)).toEqual(["status"]);
  });

  it("the sweep catches detail-only edits", async () => {
    const { sync, calls, state } = await baselined();
    state.details["VULN-2"]!["cvssVectorString"] = "CVSS:3.1/AV:N";
    expect(await sync.runPoll()).toEqual([]);
    const ev = await sync.runSweep();
    expect(calls.filter((c) => c.startsWith("detail:")).sort()).toEqual(["detail:VULN-1", "detail:VULN-2"]);
    expect(ev.map((e) => [e.type, e.field])).toEqual([["field_changed", "cvssVectorString"]]);
  });

  it("never reports the same change twice", async () => {
    const { sync, state } = await baselined();
    state.details["VULN-1"]!["status"] = "DEVELOP";
    expect(await sync.runPoll()).toHaveLength(1);
    expect(await sync.runPoll()).toEqual([]);
    expect(await sync.runSweep()).toEqual([]);
  });

  it("treats files uploaded alongside the researcher's own message as own", async () => {
    const { sync, state } = await baselined();
    state.messages.push(msg({ id: "m5", reportNumber: "VULN-1", createdOn: "2026-11-11T11:00:00Z", senderName: "Researcher" }));
    state.files[G1]!.push(file("f2", "trace.etl", "2026-11-11T11:02:00Z"));
    const ev = await sync.runPoll();
    expect(ev.map((e) => [e.type, e.own, e.seen]).sort()).toEqual([
      ["file_added", true, true],
      ["own_message", true, true],
    ]);
  });

  it("reports a CVE that MSRC announces inside a message", async () => {
    const { sync, state } = await baselined();
    state.messages.push(msg({ id: "m6", reportNumber: "VULN-1", createdOn: "2026-11-11T11:30:00Z", senderName: "MSRC", body: "Assigned CVE-2026-45678." }));
    const ev = await sync.runPoll();
    expect(ev.map((e) => e.type).sort()).toEqual(["cve", "msrc_message"]);
  });

  it("serializes overlapping runs", async () => {
    const { sync, state } = await baselined();
    state.details["VULN-1"]!["status"] = "DEVELOP";
    const [a, b] = await Promise.all([sync.runPoll(), sync.runPoll()]);
    expect(a.length + b.length).toBe(1);
  });
});

describe("own uploads ignore createdBy (live: always the upload service account)", () => {
  it("decides by timing even when createdBy differs from submittedById", async () => {
    const { sync, state } = await baselined();
    state.messages.push(msg({ id: "m7", reportNumber: "VULN-1", createdOn: "2026-11-11T08:00:00Z", senderName: "Researcher" }));
    const svc = { createdBy: "svc", submittedById: "u1" };
    state.files[G1]!.push({ ...file("f3", "mine.zip", "2026-11-11T08:03:00Z"), raw: svc }, { ...file("f4", "later.txt", "2026-11-11T11:00:00Z"), raw: svc });
    const ev = (await sync.runPoll()).filter((e) => e.type === "file_added");
    expect(ev.map((e) => [e.newValue, e.own]).sort()).toEqual([
      ["later.txt", false],
      ["mine.zip", true],
    ]);
  });
});

describe("progress reporting", () => {
  it("reports per-case progress during the baseline and clears it at the end", async () => {
    const fa = fakeApi(world());
    const seen: (string | null)[] = [];
    const sync = createSync(fa.api, now, () => {}, async () => {}, (p) => seen.push(p ? `${p.phase}:${p.done}/${p.total ?? "?"}` : null));
    await sync.runBaseline();
    expect(seen).toEqual(["cases:0/2", "cases:1/2", "cases:2/2", "messages:3/?", null]);
  });
});

describe("runAuto", () => {
  it("decides baseline-vs-poll inside the queue, so overlapping triggers baseline only once", async () => {
    const fa = fakeApi(world());
    const sync = createSync(fa.api, now, () => {}, async () => {});
    await Promise.all([sync.runAuto("poll"), sync.runAuto("poll")]);
    expect(fa.calls.filter((c) => c.startsWith("detail:"))).toHaveLength(2); // one baseline, then a quiet poll
    expect(fa.calls.filter((c) => c === "list")).toHaveLength(2);
  });
  it("runs a sweep when asked after the baseline", async () => {
    const { sync, calls } = await baselined();
    await sync.runAuto("sweep");
    expect(calls.filter((c) => c.startsWith("detail:"))).toHaveLength(2);
  });
});

describe("poll is atomic", () => {
  it("does not lose a new MSRC reply when the poll fails half-way", async () => {
    const { sync, state } = await baselined();
    state.messages.push(msg({ id: "m9", reportNumber: "VULN-2", createdOn: "2026-11-11T10:05:00Z", senderName: "MSRC" }));
    state.failDetailTimes = 1;
    await expect(sync.runPoll()).rejects.toThrow("503");
    const ev = await sync.runPoll();
    expect(ev.map((e) => [e.type, e.sourceId])).toEqual([["msrc_message", "m9"]]);
  });
  it("does not lose a status change when the poll fails half-way", async () => {
    const { sync, state } = await baselined();
    state.details["VULN-1"]!["status"] = "DEVELOP";
    state.details["VULN-2"]!["status"] = "PRE_RELEASE";
    state.failDetailTimes = 1; // VULN-1 fetched fine? no: first refetch fails
    await expect(sync.runPoll()).rejects.toThrow("503");
    const ev = await sync.runPoll();
    expect(ev.map((e) => e.reportNumber).sort()).toEqual(["VULN-1", "VULN-2"]);
  });
});

describe("state that flips back", () => {
  it("reports every transition, including a return to an earlier status", async () => {
    const { sync, state } = await baselined();
    const seen: string[] = [];
    for (const s of ["PRE_RELEASE", "DEVELOP", "PRE_RELEASE"]) {
      state.details["VULN-2"]!["status"] = s;
      seen.push(...(await sync.runPoll()).map((e) => `${e.oldValue}->${e.newValue}`));
    }
    expect(seen).toEqual(["DEVELOP->PRE_RELEASE", "PRE_RELEASE->DEVELOP", "DEVELOP->PRE_RELEASE"]);
  });
});

describe("status history from notifications", () => {
  it("fetches the notification feed only when a status changed, and uses its exact time", async () => {
    const { sync, calls, state } = await baselined();
    expect(await sync.runPoll()).toEqual([]);
    expect(calls).toEqual(["list", "messages:0"]); // quiet poll: no notifications request
    calls.length = 0;
    state.details["VULN-1"]!["status"] = "DEVELOP";
    state.notifications = [{ id: "n1", createdOn: "2026-11-10T08:15:00Z", notificationType: "ReportStatusChange", reportNumber: "VULN-1", reportStatus: "Develop", read: false }];
    const ev = await sync.runPoll();
    expect(calls).toContain("notifications");
    expect(ev[0]).toMatchObject({ type: "status", occurredAt: "2026-11-10T08:15:00Z" });
  });
});

describe("drafts", () => {
  const G3 = "00000000-0000-0000-0000-000000000003";
  const withDraft = () => {
    const w = world();
    w.details["VULN-3"] = { id: G3, title: "My draft", ticketNumber: null, status: "DRAFT", statusReason: null, bounty: null, lastActivityOn: "2026-11-11T11:00:00Z", createdOn: "2026-11-11T10:00:00Z" };
    return w;
  };

  it("never become cases: no detail fetch, no events, listed in meta.drafts", async () => {
    const { sync, calls, state } = await baselined(withDraft());
    expect((await getAllCases()).map((c) => c.reportNumber).sort()).toEqual(["VULN-1", "VULN-2"]);
    expect(await getMeta("drafts")).toEqual([{ id: G3, reportNumber: "VULN-3", title: "My draft", createdOn: "2026-08-01T00:00:00Z", lastActivityOn: "2026-11-11T11:00:00Z" }]); // createdOn: listItem helper default
    state.details["VULN-3"]!["title"] = "My draft, edited";
    state.details["VULN-3"]!["lastActivityOn"] = "2026-11-11T11:30:00Z";
    expect(await sync.runPoll()).toEqual([]);
    expect(calls).toEqual(["list", "messages:0"]);
    expect((await getMeta<{ title: string }[]>("drafts"))!.map((d) => d.title)).toEqual(["My draft, edited"]);
  });

  it("a deleted draft disappears from meta.drafts", async () => {
    const { sync, state } = await baselined(withDraft());
    delete state.details["VULN-3"];
    await sync.runPoll();
    expect(await getMeta("drafts")).toEqual([]);
  });

  it("purges a draft that an older version stored as a case, with its events", async () => {
    const { sync, state } = await baselined();
    const list = { id: G3, reportNumber: "VULN-3", ticketNumber: null, externalId: null, title: "Old draft", status: "DRAFT", statusReason: null, severity: null, securityImpact: null, createdOn: null, lastActivityOn: null, unreadMessageCount: 0, bountyStatus: null, raw: {} };
    await putCases([{ reportNumber: "VULN-3", list, detail: null, files: [], detailFetchedAt: 0 }]);
    await addEvents([{ key: "VULN-3|case_added", reportNumber: "VULN-3", ticketNumber: null, type: "case_added", summary: "Case added: Old draft", occurredAt: "2026-11-11T10:00:00Z", detectedAt: "2026-11-11T10:00:00Z", seen: true, own: true }]);
    void state;
    await sync.runPoll();
    expect((await getAllCases()).map((c) => c.reportNumber).sort()).toEqual(["VULN-1", "VULN-2"]);
    expect((await getEvents()).filter((e) => e.reportNumber === "VULN-3")).toEqual([]);
  });

  it("a submitted draft arrives as a new case with one own event", async () => {
    const { sync, state } = await baselined(withDraft());
    state.details["VULN-3"]!["status"] = "NEW";
    const ev = await sync.runPoll();
    expect(ev.map((e) => [e.reportNumber, e.type, e.own])).toEqual([["VULN-3", "case_added", true]]);
    expect(await getMeta("drafts")).toEqual([]);
  });
});

describe("details lagging behind MSRC's list", () => {
  it("re-checks the case on the next poll, so the award isn't held back until something else changes", async () => {
    const { sync, state, calls } = await baselined();
    // 01:11 — MSRC's list already says awarded, the report details still say pending.
    state.details["VULN-1"]!["bounty"] = { status: "AWARD_PENDING_REVIEWED", amount: 4000 };
    state.listOverrides = { "VULN-1": { bountyStatus: "AWARDED_REVIEWED", lastActivityOn: "2026-11-12T01:11:33Z" } };
    clock += 120_000;
    await sync.runPoll();
    // The details catch up; the list row doesn't change again.
    state.details["VULN-1"]!["bounty"] = { status: "AWARDED_REVIEWED", amount: 4000 };
    state.details["VULN-1"]!["lastActivityOn"] = "2026-11-12T01:11:33Z";
    calls.length = 0;
    clock += 120_000;
    const fresh = await sync.runPoll();
    expect(calls).toContain("detail:VULN-1");
    expect(fresh.filter((e) => e.type === "bounty").map((e) => e.summary)).toEqual([expect.stringMatching(/→ Awarded/)]);
    calls.length = 0;
    clock += 120_000;
    await sync.runPoll(); // in agreement again: back to two requests
    expect(calls).toEqual(["list", "messages:0"]);
  });

  it("gives up after MAX_RECHECKS when the list and the details keep disagreeing", async () => {
    const { sync, state, calls } = await baselined();
    state.listOverrides = { "VULN-1": { status: "DEVELOP" } }; // the details stay REVIEW_REPRO
    let fetches = 0;
    for (let i = 0; i < MAX_RECHECKS + 5; i++) {
      calls.length = 0;
      clock += 120_000;
      await sync.runPoll();
      fetches += calls.filter((c) => c === "detail:VULN-1").length;
    }
    expect(fetches).toBe(MAX_RECHECKS);
    calls.length = 0;
    await sync.runSweep(); // the 6-hour sweep still refetches it
    expect(calls).toContain("detail:VULN-1");
  });

  it("a new change on the list re-arms the re-check after it gave up", async () => {
    const { sync, state, calls } = await baselined();
    state.listOverrides = { "VULN-1": { status: "DEVELOP" } };
    for (let i = 0; i < MAX_RECHECKS + 2; i++) {
      clock += 120_000;
      await sync.runPoll();
    }
    // Later the list moves again (bounty), and the details lag once more.
    state.listOverrides = { "VULN-1": { status: "DEVELOP", bountyStatus: "AWARDED_REVIEWED" } };
    clock += 120_000;
    await sync.runPoll(); // the list change itself refetches
    calls.length = 0;
    clock += 120_000;
    await sync.runPoll();
    expect(calls).toContain("detail:VULN-1"); // and the re-check runs again
  });
});

describe("public CVEs (Security Update Guide)", () => {
  const ME = "Jane Researcher (@janer)";
  const ack = (cve: string, name = ME, releaseDate = "2026-11-10T16:00:00Z") => ({
    cveNumber: cve,
    cveTitle: "Windows Broker Elevation of Privilege Vulnerability",
    releaseDate,
    ackText: `<a href="https://example.com/">${name}</a> with Contoso`,
  });
  const vuln = (cve: string, releaseDate = "2026-11-10T16:00:00Z") => ({ cveNumber: cve, cveTitle: "Windows Broker Elevation of Privilege Vulnerability", releaseDate, impact: "Elevation of Privilege", severity: "Important", baseScore: "7.0", cweList: ["CWE-416: Use After Free"] });
  function pubWorld(): FakeState {
    const w = world();
    w.details["VULN-1"] = { ...w.details["VULN-1"]!, acknowledgements: [{ name: ME }], securityImpact: "ELEVATION_OF_PRIVILEGE" };
    w.details["VULN-2"] = { ...w.details["VULN-2"]!, title: "Broker use-after-free to SYSTEM", acknowledgements: [{ name: ME }], securityImpact: "ELEVATION_OF_PRIVILEGE" };
    w.publicAcks = [ack("CVE-2026-1111"), ack("CVE-2026-2222", "Someone Else")];
    w.publicVulns = { "CVE-2026-1111": vuln("CVE-2026-1111"), "CVE-2026-3333": vuln("CVE-2026-3333", "2026-12-08T16:00:00Z") };
    return w;
  }

  it("the first run records your public CVEs without notifying, and looks up only yours", async () => {
    const fa = fakeApi(pubWorld());
    const sync = createSync(fa.api, now, () => {});
    await sync.runBaseline();
    expect(fa.calls.filter((c) => c.startsWith("public"))).toEqual(["public:2026-08-01T00:00:00.000Z", "publicCve:CVE-2026-1111"]); // from the earliest case
    const meta = await getMeta<{ items: { cve: string; cwe: string[] }[] }>("publicCves");
    expect(meta!.items.map((i) => i.cve)).toEqual(["CVE-2026-1111"]);
    expect(meta!.items[0]!.cwe).toEqual(["CWE-416: Use After Free"]);
    expect((await getEvents()).filter((e) => e.key.startsWith("pubcve|"))).toEqual([]);
    fa.calls.length = 0;
    clock += 120_000;
    await sync.runPoll(); // a regular poll doesn't ask the guide again
    expect(fa.calls).toEqual(["list", "messages:0"]);
  });

  it("a CVE that turns public later is announced on the likely case at the next sweep", async () => {
    const { sync, state, calls } = await baselined(pubWorld());
    state.publicAcks!.push(ack("CVE-2026-3333", ME, "2026-12-08T16:00:00Z"));
    clock = Date.parse("2026-12-09T12:00:00Z");
    calls.length = 0;
    const fresh = await sync.runSweep();
    expect(calls.filter((c) => c.startsWith("public:"))).toEqual([`public:${new Date(Date.parse("2026-11-11T12:00:00Z") - 45 * 86_400_000).toISOString()}`]);
    const pub = fresh.filter((e) => e.key.startsWith("pubcve|"));
    expect(pub.map((e) => [e.key, e.reportNumber, e.type, e.seen])).toEqual([["pubcve|CVE-2026-3333", "VULN-2", "cve", false]]);
    expect(pub[0]!.summary).toBe("CVE-2026-3333 is public and credits you (Windows Broker Elevation of Privilege Vulnerability). Possibly this case: confirm it on the Cases page");
    expect(pub[0]!.occurredAt).toBe("2026-12-08T16:00:00.000Z");
    const items = (await getMeta<{ items: { cve: string }[] }>("publicCves"))!.items.map((i) => i.cve);
    expect(items).toEqual(["CVE-2026-1111", "CVE-2026-3333"]);
  });

  it("an outage of the public guide never breaks the sync, and isn't retried every poll", async () => {
    const st = pubWorld();
    st.failPublic = true;
    const fa = fakeApi(st);
    const sync = createSync(fa.api, now, () => {});
    await sync.runBaseline();
    expect(await getMeta("baselineDone")).toBe(true);
    fa.calls.length = 0;
    clock += 120_000;
    await sync.runPoll();
    expect(fa.calls).toEqual(["list", "messages:0"]);
    // Recovered by the next sweep: still a first run, so nothing is announced.
    st.failPublic = false;
    const fresh = await sync.runSweep();
    expect(fresh.filter((e) => e.key.startsWith("pubcve|"))).toEqual([]);
    expect((await getMeta<{ items: { cve: string }[] }>("publicCves"))!.items.map((i) => i.cve)).toEqual(["CVE-2026-1111"]);
  });

  it("an install from before this feature checks once on its next poll", async () => {
    const st = pubWorld();
    const fa = fakeApi(st);
    const old = createSync({ ...fa.api, publicCredits: undefined, publicCve: undefined }, now, () => {});
    await old.runBaseline();
    fa.calls.length = 0;
    const sync = createSync(fa.api, now, () => {});
    clock += 120_000;
    const fresh = await sync.runPoll();
    expect(fa.calls.filter((c) => c.startsWith("public:"))).toHaveLength(1);
    expect(fresh.filter((e) => e.key.startsWith("pubcve|"))).toEqual([]);
  });
});

describe("public CVE check runs after the sync's own work", () => {
  const ME = "Jane Researcher (@janer)";
  function world2(): FakeState {
    const w = world();
    w.details["VULN-1"] = { ...w.details["VULN-1"]!, acknowledgements: [{ name: ME }] };
    w.publicAcks = [];
    return w;
  }

  it("the baseline is complete before the guide is asked", async () => {
    const st = world2();
    const fa = fakeApi(st);
    let baselineDoneThen: unknown = "not asked";
    const api = { ...fa.api, publicCredits: async (since: string) => ((baselineDoneThen = await getMeta("baselineDone")), fa.api.publicCredits!(since)) };
    await createSync(api, now, () => {}).runBaseline();
    expect(baselineDoneThen).toBe(true);
  });

  it("a sweep saves its case changes, and an upgraded install marks the check, before the guide is asked", async () => {
    const st = world2();
    const fa = fakeApi(st);
    const old = createSync({ ...fa.api, publicCredits: undefined, publicCve: undefined }, now, () => {});
    await old.runBaseline();
    st.details["VULN-2"]!["status"] = "COMPLETE";
    let seenThen: { statusEvent: boolean; marker: unknown } | null = null;
    const api = {
      ...fa.api,
      publicCredits: async (since: string) => {
        seenThen = { statusEvent: (await getEvents()).some((e) => e.reportNumber === "VULN-2" && e.type === "status"), marker: await getMeta("publicCves") };
        return fa.api.publicCredits!(since);
      },
    };
    clock += 120_000;
    await createSync(api, now, () => {}).runSweep();
    expect(seenThen).toEqual({ statusEvent: true, marker: { checkedAt: 0, items: [] } });
  });
});

describe("announcing a public CVE", () => {
  const ME = "Jane Researcher (@janer)";
  it("states it as fact only on a case the researcher linked or MSRC named", async () => {
    const w = world();
    w.details["VULN-1"] = { ...w.details["VULN-1"]!, acknowledgements: [{ name: ME }], securityImpact: "ELEVATION_OF_PRIVILEGE" };
    w.publicAcks = [];
    const { sync, state } = await baselined(w);
    await setMeta("cveLinks", { "CVE-2026-4444": "VULN-1" }); // linked before the guide had it
    state.publicAcks!.push({ cveNumber: "CVE-2026-4444", cveTitle: "Windows Thing Elevation of Privilege Vulnerability", releaseDate: "2026-12-08T16:00:00Z", ackText: ME });
    clock = Date.parse("2026-12-09T12:00:00Z");
    const pub = (await sync.runSweep()).filter((e) => e.key.startsWith("pubcve|"));
    expect(pub.map((e) => [e.reportNumber, e.summary])).toEqual([["VULN-1", "CVE-2026-4444 is public: Windows Thing Elevation of Privilege Vulnerability"]]);
  });
});

describe("public CVE records", () => {
  const ME = "Jane Researcher (@janer)";
  it("a record lookup that failed is tried again on the next sweep", async () => {
    const w = world();
    w.details["VULN-1"] = { ...w.details["VULN-1"]!, acknowledgements: [{ name: ME }] };
    w.publicAcks = [{ cveNumber: "CVE-2026-5555", cveTitle: "Windows Thing Elevation of Privilege Vulnerability", releaseDate: "2026-11-10T16:00:00Z", ackText: ME }];
    const fa = fakeApi(w);
    let fail = true;
    const api = { ...fa.api, publicCve: async (cve: string) => (fail ? Promise.reject(new Error("503")) : fa.api.publicCve!(cve)) };
    const sync = createSync(api, now, () => {});
    await sync.runBaseline();
    expect((await getMeta<{ items: { severity: string | null }[] }>("publicCves"))!.items[0]!.severity).toBeNull();
    fail = false;
    w.publicVulns = { "CVE-2026-5555": { cveNumber: "CVE-2026-5555", cveTitle: "Windows Thing Elevation of Privilege Vulnerability", releaseDate: "2026-11-10T16:00:00Z", severity: "Important", impact: "Elevation of Privilege", baseScore: "7.8", cweList: ["CWE-416: Use After Free"] } };
    clock += 6 * 3_600_000;
    await sync.runSweep();
    const item = (await getMeta<{ items: { severity: string | null; cwe: string[] }[] }>("publicCves"))!.items[0]!;
    expect(item.severity).toBe("Important");
    expect(item.cwe).toEqual(["CWE-416: Use After Free"]);
  });
});

describe("details lagging: empty values", () => {
  it("an empty string and a missing value are the same, so the case isn't re-read forever", async () => {
    const { sync, state, calls } = await baselined();
    state.details["VULN-1"]!["statusReason"] = "";
    state.listOverrides = { "VULN-1": { statusReason: null } }; // api.ts normalises "" to null in the list
    clock += 6 * 3_600_000;
    await sync.runSweep();
    calls.length = 0;
    clock += 120_000;
    await sync.runPoll();
    expect(calls).toEqual(["list", "messages:0"]);
  });
});
