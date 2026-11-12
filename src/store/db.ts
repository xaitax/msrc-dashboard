// IndexedDB store shared by the service worker (writer) and the dashboard
// (reader) — both run on the extension origin, so they see the same database.
import type { CaseRecord, ChangeEvent, ThreadMessage, VulnId } from "../shared/types";

const DB_NAME = "msrc-dashboard";
const VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("transaction aborted"));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("cases", { keyPath: "reportNumber" });
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("reportNumber", "reportNumber");
        const events = db.createObjectStore("events", { keyPath: "key" });
        events.createIndex("reportNumber", "reportNumber");
        db.createObjectStore("meta");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

async function tx(stores: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
  return (await openDb()).transaction(stores, mode);
}

export async function getAllCases(): Promise<CaseRecord[]> {
  return req((await tx(["cases"], "readonly")).objectStore("cases").getAll() as IDBRequest<CaseRecord[]>);
}

export async function putCases(cases: CaseRecord[]): Promise<void> {
  const t = await tx(["cases"], "readwrite");
  const s = t.objectStore("cases");
  for (const c of cases) s.put(c);
  await done(t);
}

export async function getMessages(rn?: VulnId): Promise<ThreadMessage[]> {
  const s = (await tx(["messages"], "readonly")).objectStore("messages");
  return req((rn ? s.index("reportNumber").getAll(rn) : s.getAll()) as IDBRequest<ThreadMessage[]>);
}

/** Upserts all messages; returns only the ones whose id was not stored before. */
export async function putMessages(msgs: ThreadMessage[]): Promise<ThreadMessage[]> {
  const t = await tx(["messages"], "readwrite");
  const s = t.objectStore("messages");
  const known = new Set((await req(s.getAllKeys())).map(String));
  const fresh = msgs.filter((m) => !known.has(m.id));
  for (const m of msgs) s.put(m);
  await done(t);
  return fresh;
}

export async function getEvents(): Promise<ChangeEvent[]> {
  return req((await tx(["events"], "readonly")).objectStore("events").getAll() as IDBRequest<ChangeEvent[]>);
}

/** Keys in the meta store. Stored data depends on them: never rename. */
export const META = {
  baselineDone: "baselineDone",
  lastSyncAt: "lastSyncAt",
  lastError: "lastError",
  drafts: "drafts",
  cveSnapshot: "cveSnapshot",
  statusHistory: "statusHistory",
  extras: "extras",
  publicCves: "publicCves",
  cveLinks: "cveLinks",
} as const;

/** Adds the events whose key is new; existing ones (and their seen state) stay. */
async function insertNew(store: IDBObjectStore, events: ChangeEvent[]): Promise<ChangeEvent[]> {
  const known = new Set((await req(store.getAllKeys())).map(String));
  const inserted: ChangeEvent[] = [];
  for (const e of events) {
    if (known.has(e.key)) continue;
    known.add(e.key);
    store.add(e);
    inserted.push(e);
  }
  return inserted;
}

/** Inserts events whose key is new; existing events (and their seen state) are untouched. */
export async function addEvents(events: ChangeEvent[]): Promise<ChangeEvent[]> {
  const t = await tx(["events"], "readwrite");
  const inserted = await insertNew(t.objectStore("events"), events);
  await done(t);
  return inserted;
}

/** A public CVE's announcement sits on a guessed case until the researcher decides.
 *  A decision for another case, "not mine" or an unlink removes it. */
export async function dropPublicCveEvent(cve: string, keepFor: VulnId | null | undefined): Promise<void> {
  const t = await tx(["events"], "readwrite");
  const s = t.objectStore("events");
  const key = `pubcve|${cve}`;
  const e = (await req(s.get(key))) as ChangeEvent | undefined;
  if (e && e.reportNumber !== keepFor) s.delete(key);
  await done(t);
}

/**
 * Everything one poll produces, written in ONE transaction: cases, new
 * messages, meta and events either all land or none do. A poll that fails
 * half-way therefore leaves the store untouched and the next poll re-derives
 * the same events (whose keys dedupe). Returns only newly inserted events.
 */
export async function commitPoll(input: {
  cases: CaseRecord[];
  messages: ThreadMessage[];
  events: ChangeEvent[];
  meta: Record<string, unknown>;
  /** Cases to drop with all their events (stale drafts) — applied before the rest. */
  removeCases?: VulnId[];
}): Promise<ChangeEvent[]> {
  const t = await tx(["cases", "messages", "events", "meta"], "readwrite");
  for (const rn of input.removeCases ?? []) {
    t.objectStore("cases").delete(rn);
    for (const k of await req(t.objectStore("events").index("reportNumber").getAllKeys(rn))) t.objectStore("events").delete(k);
  }
  for (const c of input.cases) t.objectStore("cases").put(c);
  for (const m of input.messages) t.objectStore("messages").put(m);
  for (const [k, v] of Object.entries(input.meta)) t.objectStore("meta").put(v, k);
  const inserted = await insertNew(t.objectStore("events"), input.events);
  await done(t);
  return inserted;
}

/** Marks unseen events seen — for one case, or all when rn is omitted. Returns the count. */
export async function markSeen(rn?: VulnId): Promise<number> {
  const t = await tx(["events"], "readwrite");
  const s = t.objectStore("events");
  const all = (await req((rn ? s.index("reportNumber").getAll(rn) : s.getAll()) as IDBRequest<ChangeEvent[]>)).filter((e) => !e.seen);
  for (const e of all) s.put({ ...e, seen: true });
  await done(t);
  return all.length;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return req((await tx(["meta"], "readonly")).objectStore("meta").get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const t = await tx(["meta"], "readwrite");
  t.objectStore("meta").put(value, key);
  await done(t);
}

/** Test-only: drop the database so each test starts empty. */
export async function _resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await req(indexedDB.deleteDatabase(DB_NAME) as unknown as IDBRequest<unknown>);
}
