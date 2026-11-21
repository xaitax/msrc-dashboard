import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText, send, type Msg } from "../shared/protocol";
import { isGuid, isVulnId } from "../shared/ids";
import { boardColumns, sinceStrip, type CaseSort } from "./board";
import { hasTag, tagCounts, tagKey } from "../core/annotations";
import { Board, Drafts, SinceStrip } from "./components/Board";
import { CasePanel } from "./components/CasePanel";
import { CaseIcon } from "./components/CaseIcon";
import { ExportDialog } from "./components/ExportDialog";
import { Header, NAV, type Page } from "./components/Header";
import { Announcements } from "./components/Announcements";
import { InternalsPage } from "./components/Internals";
import { ActivityPage, ProfilePage, RecognitionPage } from "./components/Pages";
import { PublicCveStrip } from "./components/PublicCves";
import { Progress } from "./components/Progress";
import { ReportEditor } from "./components/report/ReportEditor";
import { unsavedNewTitle } from "./reportLocal";
import { loadView, pinUnseen, type CaseRow, type ViewModel } from "./data";
import { PORTAL_REPORTS } from "../shared/urls";
import { loadInternals, loadSettings } from "./portalInfo";
import { createReportApi } from "./reportApi";
import { pageToken } from "./pageToken";
import { isUnseen } from "../core/derive";


type Route = { page: Page } | { page: "case"; rn: string } | { page: "new" } | { page: "draft"; id: string } | { page: "internals" };

// Stable references: the components reload when these change.
const portalSettings = () => loadSettings(fetch);
const portalInternals = () => loadInternals(fetch);

function parseHash(): Route {
  const h = location.hash.replace(/^#/, "");
  const m = /^case=(VULN-\d+)$/.exec(h);
  if (m && isVulnId(m[1])) return { page: "case", rn: m[1]! };
  if (h === "new") return { page: "new" };
  if (h === "internals") return { page: "internals" };
  const d = /^draft=(.+)$/.exec(h);
  if (d && isGuid(d[1])) return { page: "draft", id: d[1]! };
  const page = NAV.find(([key]) => key === h)?.[0];
  if (page) return { page };
  return { page: "cases" };
}


function searchHit(r: CaseRow, q: string): boolean {
  if (!q) return true;
  const hay = `${r.ticketNumber ?? ""} ${r.reportNumber} ${r.title} ${r.cves.join(" ")} ${r.status ?? ""} ${r.annotation.tags.join(" ")} ${r.annotation.note}`.toLocaleLowerCase();
  return q
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export function App() {
  const [view, setView] = useState<ViewModel | null>(null);
  const [route, setRoute] = useState<Route>(parseHash());
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [caseSort, setCaseSort] = useState<CaseSort>("recent");
  const [exporting, setExporting] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [portalReadFeedback, setPortalReadFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [clearingPortalRead, setClearingPortalRead] = useState(false);
  const reportApi = useMemo(() => createReportApi({ fetch: (u, i) => fetch(u, i), token: pageToken }), []);
  const [, tick] = useState(0);
  const [editorKey, setEditorKey] = useState(() => `e${Date.now()}`);
  const adopted = useRef<string | null>(null); // draft id the open editor just created
  const searchRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(() => void loadView().then(setView), []);
  const go = useCallback((hash: string) => {
    location.hash = hash;
  }, []);
  const openCase = useCallback((rn: string) => go(`case=${rn}`), [go]);
  const currentCase = route.page === "case" ? route.rn : null;
  const clearPortalNotifications = useCallback(async () => {
    if (clearingPortalRead) return;
    setClearingPortalRead(true);
    setPortalReadFeedback(null);
    try {
      const count = await reportApi.markPortalNotificationsRead();
      setPortalReadFeedback({ error: false, text: count ? `Marked ${count} MSRC portal notification${count === 1 ? "" : "s"} as read.` : "No unread MSRC portal notifications to clear." });
    } catch (e) {
      setPortalReadFeedback({ error: true, text: `Could not mark MSRC portal notifications as read: ${errorText(e)}` });
    } finally {
      setClearingPortalRead(false);
    }
  }, [clearingPortalRead, reportApi]);

  const tags = useMemo(() => tagCounts(view?.rows.map((r) => r.annotation) ?? []), [view]);
  const rows = useMemo(() => (view ? view.rows.filter((r) => searchHit(r, query.trim()) && (!tagFilter || hasTag(r.annotation.tags, tagFilter))) : []), [view, query, tagFilter]);
  useEffect(() => {
    if (view && tagFilter && !tags.some((t) => tagKey(t.tag) === tagFilter)) setTagFilter("");
  }, [view, tagFilter, tags]);
  // Reading order for j/k: the board's order (stage, then recency).
  const order = useMemo(() => {
    if (!view) return [] as string[];
    const visible = rows.some((r) => r.reportNumber === currentCase) ? rows : view.rows;
    const board = boardColumns(visible, caseSort);
    return [...board.columns.flatMap((c) => c.rows), ...board.offBoard, ...board.closed].map((r) => r.reportNumber);
  }, [view, rows, caseSort, currentCase]);

  useEffect(() => {
    reload();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onMsg = (m: Msg) => {
      if (m?.type !== "db:changed") return;
      clearTimeout(t);
      t = setTimeout(reload, 250);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const clockTimer = setInterval(() => tick((n) => n + 1), 30_000);
    const onHash = () => {
      const r = parseHash();
      setRoute(r);
      if (r.page === "draft" && r.id === adopted.current) return; // first save of a new report: same editor, no reload
      adopted.current = null;
      setEditorKey(`e${Date.now()}`);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      clearInterval(clockTimer);
      window.removeEventListener("hashchange", onHash);
    };
  }, [reload]);

  // Opening a case marks its changes seen (locally only); the case page keeps
  // marking what was new at the moment it opened.
  useEffect(() => {
    if (!currentCase) return setPinned(new Set());
    setPinned(new Set((view?.events ?? []).filter((e) => e.reportNumber === currentCase && isUnseen(e)).map((e) => e.key)));
    void send({ type: "seen:mark", reportNumber: currentCase });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture once per opened case
  }, [currentCase, view === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "/" && !typing && route.page === "cases") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (typing) el!.blur();
        else if (route.page === "case") go("cases");
      } else if (!typing && currentCase && (e.key === "j" || e.key === "k" || e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const i = order.indexOf(currentCase);
        const next = e.key === "j" || e.key === "ArrowRight" ? order[i + 1] : order[i - 1];
        if (next) openCase(next);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [route, currentCase, order, go, openCase]);

  if (!view) return <div class="loading">Loading…</div>;

  const st = view.state;
  const caseRow = currentCase ? (view.rows.find((r) => r.reportNumber === currentCase) ?? null) : null;
  const idx = currentCase ? order.indexOf(currentCase) : -1;

  return (
    <div class="app">
      <Header
        state={st}
        page={route.page}
        onPage={(p) => go(p)}
        onHome={() => {
          setQuery("");
          setTagFilter("");
          if (route.page === "cases") window.scrollTo(0, 0);
          else go("cases");
        }}
        unseen={view.unseen}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        onSync={() => void send({ type: "sync:now", full: true })}
        onExport={() => setExporting(true)}
        onNew={() => go("new")}
      />

      <Announcements load={portalSettings} />

      {st.auth === "signed_out" && (
        <div class="banner banner--warn" role="status">
          <span>You're signed out of MSRC. Sign in on the portal and the dashboard picks the session up by itself.</span>
          <a class="btn btn--primary" href={PORTAL_REPORTS} target="_blank" rel="noopener">
            Sign in on the portal
          </a>
        </div>
      )}
      {st.auth === "relogin" && (
        <div class="banner" role="status">
          Renewing your MSRC session in the background…
        </div>
      )}
      {portalReadFeedback && (
        <div class={`banner${portalReadFeedback.error ? " banner--warn" : ""}`} role={portalReadFeedback.error ? "alert" : "status"}>
          <span>{portalReadFeedback.text}</span>
          {portalReadFeedback.error && <button type="button" class="btn" onClick={() => void clearPortalNotifications()} disabled={clearingPortalRead}>Retry</button>}
          <button type="button" class="link" onClick={() => setPortalReadFeedback(null)}>Dismiss</button>
        </div>
      )}

      {route.page === "new" || route.page === "draft" ? (
        <ReportEditor
          key={editorKey}
          id={route.page === "draft" ? route.id : null}
          cases={view.rows.map((r) => ({ reportNumber: r.reportNumber, title: r.title }))}
          onCreated={(id) => {
            adopted.current = id;
            location.replace(`#draft=${id}`);
          }}
          onLeave={() => go("cases")}
          onOpenCase={openCase}
        />
      ) : view.rows.length === 0 ? (
        <main class="first-run">
          {st.auth === "signed_out" ? (
            <p>Sign in to the MSRC portal once, and your submissions load here.</p>
          ) : (
            <>
              <p>Loading your submissions for the first time.</p>
              {st.progress ? <Progress p={st.progress} big /> : <p class="muted">Starting…</p>}
            </>
          )}
        </main>
      ) : route.page === "cases" ? (
        <main class="cases-page">
          <header class="boardbar">
            <div class="boardbar__heading">
              <h1>Cases</h1>
              <span class="boardbar__count" aria-live="polite">
                {query || tagFilter ? `${rows.length} of ${view.rows.length} cases` : `${rows.length} total`}
              </span>
            </div>
            <div class="boardbar__controls">
              {rows.some((r) => r.closed) && (
                <button type="button" class="btn boardbar__closed" onClick={() => document.getElementById("closed-cases-title")?.focus()}>
                  Closed cases <CaseIcon name="down" />
                </button>
              )}
              <label class="sr-only" for="case-tag-filter">Filter cases by tag</label>
              <select id="case-tag-filter" class="input" title="Filter cases by tag" value={tagFilter} onChange={(e) => setTagFilter((e.target as HTMLSelectElement).value)}>
                <option value="">All tags</option>
                {tags.map(({ tag, count }) => <option key={tagKey(tag)} value={tagKey(tag)}>{tag} ({count})</option>)}
              </select>
              <label class="sr-only" for="case-sort">Sort cases</label>
              <select id="case-sort" class="input" title="Sort cases" value={caseSort} onChange={(e) => setCaseSort((e.target as HTMLSelectElement).value as CaseSort)}>
                <option value="recent">Latest activity</option>
                <option value="tag">Tag A–Z</option>
                <option value="title">Title A–Z</option>
              </select>
              {(tagFilter || query) && <button class="link" onClick={() => { setTagFilter(""); setQuery(""); }}>Clear</button>}
            </div>
          </header>
          <SinceStrip strip={sinceStrip(view.events)} onOpen={openCase} onAll={() => go("activity")} onMarkSeen={() => void send({ type: "seen:mark" })} />
          {!query && !tagFilter && <PublicCveStrip unlinked={view.publicUnlinked} dismissed={view.publicDismissed} rows={view.rows} onOpen={openCase} />}
          {!query && !tagFilter && <Drafts drafts={view.drafts} unsavedNew={unsavedNewTitle()} onOpenDraft={(id) => go(`draft=${id}`)} onNew={() => go("new")} />}
          <Board rows={rows} onOpen={openCase} searching={!!(query || tagFilter)} sort={caseSort} />
        </main>
      ) : route.page === "case" ? (
        caseRow ? (
          <main class="case-page">
            <nav class="casebar" aria-label="Case navigation">
              <button class="link" onClick={() => go("cases")}>
                <CaseIcon name="back" /> All cases
              </button>
              <span class="top__grow" />
              <span class="muted">
                {idx + 1} of {order.length}
              </span>
              <button class="btn btn--icon" disabled={idx <= 0} onClick={() => openCase(order[idx - 1]!)} title="Previous case (k)" aria-label="Previous case">
                <CaseIcon name="previous" />
              </button>
              <button class="btn btn--icon" disabled={idx >= order.length - 1} onClick={() => openCase(order[idx + 1]!)} title="Next case (j)" aria-label="Next case">
                <CaseIcon name="next" />
              </button>
            </nav>
            <CasePanel key={caseRow.reportNumber} row={caseRow} view={{ ...view, events: pinUnseen(view.events, pinned) }} onAnnotationChange={reload} onSelectTag={(tag) => { setTagFilter(tagKey(tag)); setQuery(""); go("cases"); }} />
          </main>
        ) : (
          <main class="page">
            <p class="empty">That case isn't in your list.</p>
          </main>
        )
      ) : route.page === "activity" ? (
        <ActivityPage view={view} onOpen={openCase} onMarkSeen={() => void send({ type: "seen:mark" })} onClearPortal={() => void clearPortalNotifications()} clearingPortalRead={clearingPortalRead} />
      ) : route.page === "recognition" ? (
        <RecognitionPage view={view} />
      ) : route.page === "internals" ? (
        <InternalsPage loadSettings={portalSettings} loadInternals={portalInternals} />
      ) : (
        <ProfilePage />
      )}

      {exporting && <ExportDialog view={view} onClose={() => setExporting(false)} />}
    </div>
  );
}
