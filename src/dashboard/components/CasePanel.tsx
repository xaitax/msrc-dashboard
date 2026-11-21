import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { humanizeEnum, MSRC_SENDER } from "../../core/derive";
import type { CaseRow, ViewModel } from "../data";
import { caseLabel, dayDate, when } from "../format";
import { buildTimeline } from "../../core/timeline";
import { CaseGuide } from "./CaseGuide";
import { CaseFacts } from "./CaseFacts";
import { CaseIcon } from "./CaseIcon";
import { CaseTimeline, type FlagAction } from "./CaseTimeline";
import { LocalCaseWorkspace } from "./LocalCaseWorkspace";
import { tagCounts } from "../../core/annotations";
import { CaseTime } from "./CaseTime";
import { Disclosures } from "./Disclosures";
import { Markdown } from "./Markdown";
import { MessageBox } from "./MessageBox";
import { createReportApi, WriteError } from "../reportApi";
import { errorText } from "../../shared/protocol";
import { pageToken, syncSoon } from "../pageToken";
import { StageRail, StatusPill } from "./StageRail";
import { portalCaseUrl } from "../../shared/urls";
import type { ThreadMessage } from "../../shared/types";

type Tab = "timeline" | "report" | "files" | "raw";
type FlagLookup = { ids: Set<string>; messages: Map<string, ThreadMessage> };

function updateFlagLookup(previous: FlagLookup | null, matches: ThreadMessage[]): FlagLookup {
  const messages = new Map(previous?.messages);
  for (const match of matches) messages.set(match.id, match);
  return { ids: new Set(matches.map((m) => m.id)), messages };
}

const REPORT_FIELDS: [string, string][] = [
  ["abstract", "Abstract"],
  ["description", "Description"],
  ["reproductionSteps", "Reproduction steps"],
  ["attackScenario", "Attack scenario"],
  ["callstack", "Call stack"],
  ["recommendedSolution", "Recommended solution"],
  ["analysisNotes", "Analysis notes"],
  ["isExploitedDiscovery", "Active exploit discovery"],
  ["isExploitedScale", "Active exploit scale"],
  ["acknowledgement", "Acknowledgement"],
];

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function CasePanel({ row, view, onAnnotationChange, onSelectTag }: { row: CaseRow; view: ViewModel; onAnnotationChange: () => void; onSelectTag: (tag: string) => void }) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [replyRequest, setReplyRequest] = useState(0);
  const context = useRef<HTMLElement>(null);
  const api = useMemo(() => createReportApi({ fetch: (u, i) => fetch(u, i), token: pageToken }), []);
  const [portalReadError, setPortalReadError] = useState<string | null>(null);
  const readThrough = useRef<number | null>(null);
  const through = view.state.lastSyncStartedAt;
  const markPortalRead = (cutoff: number) => {
    void api.markPortalNotificationsRead(row.reportNumber, cutoff)
      .then(() => setPortalReadError(null))
      .catch((e) => setPortalReadError(errorText(e)));
  };
  useEffect(() => {
    if (view.state.auth !== "ok" || through == null || readThrough.current !== null) return;
    readThrough.current = through;
    markPortalRead(through);
  }, [row.reportNumber, through, view.state.auth]);
  const writeToMsrc = () => {
    setTab("timeline");
    setReplyRequest((request) => request + 1);
  };
  useLayoutEffect(() => {
    if (!replyRequest) return;
    const box = document.getElementById("in-msg");
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    box?.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "center" });
    box?.focus({ preventScroll: true });
  }, [replyRequest]);
  const d = (row.record.detail ?? {}) as Record<string, unknown>;
  const msgs = useMemo(() => view.messages.filter((m) => m.reportNumber === row.reportNumber), [view, row.reportNumber]);
  const hasFlag = row.record.list.raw["isFlagged"] === true || msgs.some((m) => m.raw["isFlagged"] === true);
  const [flagged, setFlagged] = useState<FlagLookup | null>(null);
  const [flagError, setFlagError] = useState(false);
  const [flagAction, setFlagAction] = useState<FlagAction | null>(null);
  const updatingFlag = useRef(false);
  const flagLookupVersion = useRef(0);
  useEffect(() => {
    if (!hasFlag || view.state.auth !== "ok" || updatingFlag.current) return;
    const version = ++flagLookupVersion.current;
    let active = true;
    void (async () => {
      try {
        const matches = await api.flaggedMessages(row.reportNumber);
        if (active && version === flagLookupVersion.current) {
          setFlagged((previous) => updateFlagLookup(previous, matches));
          setFlagError(false);
        }
      } catch {
        if (active && version === flagLookupVersion.current) setFlagError(true);
      }
    })();
    return () => { active = false; };
  }, [api, hasFlag, row.reportNumber, view.state.auth, view.state.lastSyncStartedAt]);
  const unflag = async (id: string, messageRow: HTMLLIElement | null) => {
    if (updatingFlag.current || view.state.auth !== "ok") return;
    updatingFlag.current = true;
    flagLookupVersion.current++;
    setFlagAction({ id, pending: true, feedback: "Removing flag…" });
    let feedback: string;
    let accepted = false;
    try {
      await api.unflagMessage(id);
      accepted = true;
      const matches = await api.flaggedMessages(row.reportNumber);
      setFlagged((previous) => updateFlagLookup(previous, matches));
      setFlagError(false);
      if (matches.some((m) => m.id === id)) {
        feedback = "MSRC still lists this message as flagged.";
      } else {
        feedback = "Flag removed.";
        if (messageRow?.contains(document.activeElement)) messageRow.focus();
        syncSoon();
      }
    } catch (e) {
      feedback = accepted
        ? "MSRC accepted the request, but the flag could not be verified. Reopen the case to check."
        : e instanceof WriteError && e.status === 403
          ? "MSRC denied permission to unflag this message."
          : `Could not unflag this message. ${errorText(e)}`;
    } finally {
      updatingFlag.current = false;
    }
    setFlagAction({ id, pending: false, feedback });
  };
  const flaggedIds = useMemo(() => flagged?.ids ?? new Set(msgs.filter((m) => m.raw["isFlagged"] === true).map((m) => m.id)), [flagged, msgs]);
  const timelineMessages = useMemo(() => {
    if (!flagged?.messages.size) return msgs;
    const known = new Set(msgs.map((m) => m.id));
    return [...msgs, ...[...flagged.messages.values()].filter((m) => !known.has(m.id))];
  }, [flagged, msgs]);
  const events = useMemo(() => view.events.filter((e) => e.reportNumber === row.reportNumber), [view, row.reportNumber]);
  const ownMessages = useMemo(() => msgs.filter((m) => m.senderName !== MSRC_SENDER).map((m) => ({ body: m.body, createdOn: m.createdOn })), [msgs]);
  const timeline = useMemo(() => buildTimeline(row.record, timelineMessages, events, view.history[row.reportNumber] ?? []), [row.record, timelineMessages, events, view.history]);
  const disclosures = (d["disclosureEventList"] as Record<string, unknown>[] | null | undefined) ?? [];
  const sections = REPORT_FIELDS.filter(([key]) => d[key] != null && d[key] !== "");
  const tabs = [
    { key: "timeline", label: "Timeline", count: timeline.length, icon: "message" },
    { key: "report", label: "Report", icon: "report" },
    { key: "files", label: "Files", count: row.record.files.length, icon: "file" },
    { key: "raw", label: "Raw data", icon: "code" },
  ] as const;
  const flagStatus = hasFlag && flaggedIds.size === 0 && !flagAction
    ? flagError || view.state.auth !== "ok"
      ? "Flagged messages are currently unavailable."
      : flagged ? "MSRC reports a flag, but returned no matching messages." : "Looking up flagged messages…"
    : null;

  return (
    <section class="detail" aria-labelledby="case-heading">
      {portalReadError && (
        <div class="banner banner--warn" role="alert">
          <span>Could not mark this case’s MSRC portal notifications as read: {portalReadError}</span>
          <button type="button" class="btn" onClick={() => { if (readThrough.current !== null) markPortalRead(readThrough.current); }}>Retry</button>
        </div>
      )}
      <div class="case-hero">
        <header class="panel__head">
          <div class="panel__titles">
            <p class="panel__kicker">
              <span class="panel__num">{row.ticketNumber ? `Case ${caseLabel(row)}` : row.reportNumber}</span>
              <StatusPill stage={row.stage} text={humanizeEnum(row.status)} />
              <span class="panel__meta">
                {row.ticketNumber && <span>{row.reportNumber}</span>}
                {row.record.list.createdOn && <span>Submitted {dayDate(row.record.list.createdOn)}</span>}
              </span>
            </p>
            <h1 class="panel__title" id="case-heading">{row.title || row.reportNumber}</h1>
            <LocalCaseWorkspace annotation={row.annotation} knownTags={tagCounts(view.rows.map((r) => r.annotation)).map((x) => x.tag)} onChanged={onAnnotationChange} onSelectTag={onSelectTag} />
          </div>
          <div class="panel__actions">
            <button type="button" class="btn btn--primary" onClick={writeToMsrc}>
              <CaseIcon name="reply" /> Write to MSRC
            </button>
            <a class="btn" href={portalCaseUrl(row.reportNumber)} target="_blank" rel="noopener">
              Open in portal <CaseIcon name="external" />
            </a>
            <button type="button" class="btn panel__context-jump" onClick={() => context.current?.focus()}>
              Case details <CaseIcon name="down" />
            </button>
          </div>
        </header>
        {row.stage.index >= 0 && (
          <div class="panel__track">
            <StageRail stage={row.stage} prev={row.prevStage} labelled />
          </div>
        )}
      </div>

      {row.actionNeeded && <div class="case-attention"><CaseGuide api={api} row={row} onReply={writeToMsrc} /></div>}

      <div class="case-layout">
        <div class="case-main">
          <div class="tabs" role="tablist" aria-label="Case views" onKeyDown={(e) => {
            const index = tabs.findIndex((item) => item.key === tab);
            const next = e.key === "ArrowRight" ? (index + 1) % tabs.length
              : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
              : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
            if (next === null) return;
            e.preventDefault();
            setTab(tabs[next]!.key);
            e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
          }}>
            {tabs.map((item) => (
              <button key={item.key} type="button" role="tab" class="tab" id={`case-tab-${item.key}`}
                aria-controls={`case-view-${item.key}`} aria-selected={tab === item.key}
                tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)}>
                <CaseIcon name={item.icon} /> {item.label}
                {"count" in item && <span class="tab__count">{item.count}</span>}
              </button>
            ))}
          </div>

          <div class="panel__body" id="case-view-timeline" role="tabpanel" aria-labelledby="case-tab-timeline" hidden={tab !== "timeline"}>
            <CaseTimeline items={timeline} flagged={flaggedIds} flagStatus={flagStatus} flagAction={flagAction}
              onUnflag={view.state.auth === "ok" ? unflag : undefined} />
            <MessageBox api={api} reportNumber={row.reportNumber} caseLabel={caseLabel(row)} ownMessages={ownMessages} onSent={syncSoon} />
          </div>

          <div class="panel__body" id="case-view-report" role="tabpanel" aria-labelledby="case-tab-report" hidden={tab !== "report"}>
            {tab === "report" && (
              <div class="report">
                {sections.length > 2 && (
                  <nav class="report__index" aria-label="Report sections">
                    {sections.map(([key, label]) => (
                      <button key={key} type="button" class="link" onClick={() => document.getElementById(`report-section-${key}`)?.focus()}>{label}</button>
                    ))}
                  </nav>
                )}
                {sections.map(([key, label]) => (
                  <section key={key}>
                    <h2 id={`report-section-${key}`} tabIndex={-1}>{label}</h2>
                    <Markdown class="report__text" src={String(d[key])} />
                  </section>
                ))}
                {!sections.length && <p class="case-empty">No report text available.</p>}
              </div>
            )}
          </div>

          <div class="panel__body" id="case-view-files" role="tabpanel" aria-labelledby="case-tab-files" hidden={tab !== "files"}>
            {tab === "files" && (row.record.files.length ? (
              <table class="files">
                <thead>
                  <tr><th scope="col">Name</th><th scope="col">Uploaded</th><th scope="col">Status</th></tr>
                </thead>
                <tbody>
                  {row.record.files.map((f) => (
                    <tr key={f.id}>
                      <td><span class="files__name"><CaseIcon name="file" />{f.name}</span></td>
                      <td>{when(f.createdOn)}</td>
                      <td>{val(f.raw["uploadStatus"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p class="case-empty">No files on this case.</p>)}
          </div>

          <div class="panel__body" id="case-view-raw" role="tabpanel" aria-labelledby="case-tab-raw" hidden={tab !== "raw"}>
            {tab === "raw" && <pre class="raw">{JSON.stringify({ list: row.record.list.raw, detail: row.record.detail, files: row.record.files.map((f) => f.raw) }, null, 2)}</pre>}
          </div>
        </div>

        <aside class="case-context" ref={context} tabIndex={-1} aria-label="Case context">
          <section class="case-context__card case-context__status" aria-labelledby="case-progress-title">
            <div class="case-context__head">
              <h2 id="case-progress-title">Case status</h2>
              {row.closed && <StatusPill stage={row.stage} text={humanizeEnum(row.status)} />}
            </div>
            <CaseTime clock={row.clock} />
            {!row.actionNeeded && <CaseGuide api={api} row={row} onReply={writeToMsrc} compact />}
          </section>
          <CaseFacts row={row} />
          <section class="case-context__card plan-wrap" aria-labelledby="plan-h">
            <h2 id="plan-h">Planned disclosure</h2>
            <Disclosures api={api} reportNumber={row.reportNumber} events={disclosures} onChanged={syncSoon} />
          </section>
        </aside>
      </div>
    </section>
  );
}
