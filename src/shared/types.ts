// Domain types. API objects keep their full payload in `raw` so the export
// can stay lossless even for fields this code does not know about.

export type VulnId = string; // validated by isVulnId: ^VULN-\d+$

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type RawObject = Record<string, unknown>;

/** One row of the GraphQL `vulnerabilityReports` list query. */
export interface ReportListItem {
  id: string;
  reportNumber: VulnId;
  ticketNumber: string | null;
  externalId: string | null;
  title: string;
  status: string | null;
  statusReason: string | null;
  severity: string | null;
  securityImpact: string | null;
  createdOn: string | null;
  lastActivityOn: string | null;
  unreadMessageCount: number | null;
  bountyStatus: string | null;
  raw: RawObject;
}

/** Full `EntireVulnReport` fragment, untouched. */
export type ReportDetail = RawObject & { id: string; reportNumber: VulnId };


export interface ThreadMessage {
  id: string;
  reportNumber: VulnId;
  senderName: string;
  createdOn: string;
  body: string;
  raw: RawObject;
}

export interface FileRecord {
  id: string;
  name: string;
  createdOn: string | null;
  raw: RawObject;
}

/** A portal draft: listed for "continue editing", never diffed or notified. */
export interface DraftRef {
  id: string; // report GUID
  reportNumber: VulnId;
  title: string;
  createdOn: string | null;
  lastActivityOn: string | null;
}

export interface CaseRecord {
  reportNumber: VulnId;
  list: ReportListItem;
  detail: ReportDetail | null;
  files: FileRecord[];
  detailFetchedAt: number; // epoch ms, 0 = never
  rev?: number; // bumped on every refetch; part of state-change event keys
  recheck?: number; // refetches so far while the details lag behind the list row (sync.ts MAX_RECHECKS)
}

export type EventType =
  | "case_added"
  | "msrc_message"
  | "own_message"
  | "status"
  | "status_reason"
  | "bounty"
  | "cve"
  | "file_added"
  | "disclosure_event"
  | "field_changed";

export interface ChangeEvent {
  key: string; // stable dedupe key, see eventKey()
  reportNumber: VulnId;
  ticketNumber: string | null;
  type: EventType;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  summary: string; // one line, human readable: "Status Develop → Complete · Duplicate"
  occurredAt: string; // ISO; source timestamp, else detection time
  detectedAt: string; // ISO
  seen: boolean;
  own: boolean;
  sourceId?: string; // message id / file id / changeLog id
}
