import type { ThreadMessage } from "../src/shared/types";

let n = 0;
export function msg(p: Partial<ThreadMessage> & { reportNumber: string; createdOn: string }): ThreadMessage {
  n += 1;
  return { id: p.id ?? `m${n}`, senderName: "MSRC", body: "", raw: {}, ...p };
}

import type { CaseRecord, FileRecord, ReportDetail, ReportListItem } from "../src/shared/types";

export function listItem(p: Partial<ReportListItem> & { reportNumber: string }): ReportListItem {
  const base: ReportListItem = {
    id: "00000000-0000-0000-0000-000000000001",
    ticketNumber: "100001",
    externalId: null,
    title: "Synthetic case",
    status: "REVIEW_REPRO",
    statusReason: null,
    severity: null,
    securityImpact: null,
    createdOn: "2026-08-01T00:00:00Z",
    lastActivityOn: "2026-10-01T00:00:00Z",
    unreadMessageCount: 0,
    bountyStatus: null,
    raw: {},
    ...p,
  };
  return { ...base, raw: { ...base, raw: undefined, ...p.raw } };
}

export function caseRec(
  rn: string,
  detail: Record<string, unknown> | null,
  opts: { files?: FileRecord[]; list?: Partial<ReportListItem> } = {},
): CaseRecord {
  return {
    reportNumber: rn,
    list: listItem({ reportNumber: rn, ...opts.list }),
    detail: detail ? ({ id: "00000000-0000-0000-0000-000000000001", reportNumber: rn, ...detail } as ReportDetail) : null,
    files: opts.files ?? [],
    detailFetchedAt: detail ? 1 : 0,
  };
}

export function file(id: string, name: string, createdOn = "2026-11-01T00:00:00Z"): FileRecord {
  return { id, name, createdOn, raw: { id, name } };
}
