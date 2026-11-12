// In-memory fake of the MSRC API surface the sync engine uses.
import type { FileRecord, ReportDetail, ReportListItem, ThreadMessage } from "../src/shared/types";
import type { SyncApi } from "../src/background/sync";
import { listItem } from "./helpers";

export interface FakeState {
  details: Record<string, Record<string, unknown>>;
  messages: ThreadMessage[]; // any order; served newest first
  files: Record<string, FileRecord[]>; // by report id (GUID)
  failDetailTimes?: number; // next N getReportDetail calls throw (transient 503)
  notifications?: Record<string, unknown>[];
  /** Public Security Update Guide: credit rows and CVE records; failPublic = outage. */
  publicAcks?: Record<string, unknown>[];
  publicVulns?: Record<string, Record<string, unknown>>;
  failPublic?: boolean;
  /** MSRC's list row ahead of (or behind) the details, per report. */
  listOverrides?: Record<string, Partial<Pick<ReportListItem, "status" | "statusReason" | "bountyStatus" | "lastActivityOn">>>;
}

export function fakeApi(state: FakeState) {
  const calls: string[] = [];
  const api: SyncApi = {
    async listReports(): Promise<ReportListItem[]> {
      calls.push("list");
      return Object.entries(state.details).map(([rn, d]) => {
        const o = state.listOverrides?.[rn] ?? {};
        const item = listItem({
          reportNumber: rn,
          id: String(d["id"]),
          title: String(d["title"] ?? ""),
          status: (d["status"] as string) ?? null,
          statusReason: (d["statusReason"] as string) ?? null,
          ticketNumber: (d["ticketNumber"] as string) ?? null,
          lastActivityOn: (d["lastActivityOn"] as string) ?? null,
          bountyStatus: ((d["bounty"] as Record<string, unknown> | undefined)?.["status"] as string) ?? null,
          unreadMessageCount: 0,
          raw: { reportNumber: rn, status: d["status"], statusReason: d["statusReason"] ?? null, title: d["title"] },
        });
        return { ...item, ...o, raw: { ...item.raw, ...o } }; // the raw row is the list row: keep them in step
      });
    },
    async getReportDetail(rn: string): Promise<ReportDetail | null> {
      calls.push(`detail:${rn}`);
      if (state.failDetailTimes && state.failDetailTimes > 0) {
        state.failDetailTimes -= 1;
        throw new Error("api 503");
      }
      const d = state.details[rn];
      return d ? (structuredClone({ ...d, reportNumber: rn }) as ReportDetail) : null;
    },
    async messagesNewestFirst(skip: number): Promise<ThreadMessage[]> {
      calls.push(`messages:${skip}`);
      const sorted = [...state.messages].sort((a, b) => Date.parse(b.createdOn) - Date.parse(a.createdOn));
      return structuredClone(sorted.slice(skip, skip + 100));
    },
    async listNotifications() {
      calls.push("notifications");
      return structuredClone(state.notifications ?? []);
    },
    async publicCredits(since: string) {
      calls.push(`public:${since}`);
      if (state.failPublic) throw new Error("sug 503");
      return structuredClone((state.publicAcks ?? []).filter((a) => Date.parse(String(a["releaseDate"])) > Date.parse(since)));
    },
    async publicCve(cve: string) {
      calls.push(`publicCve:${cve}`);
      return structuredClone(state.publicVulns?.[cve] ?? null);
    },
    async listFiles(reportId: string): Promise<FileRecord[]> {
      calls.push(`files:${reportId}`);
      return structuredClone(state.files[reportId] ?? []);
    },
  };
  return { api, calls };
}
