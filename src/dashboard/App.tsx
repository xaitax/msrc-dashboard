import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { send, type Msg } from "../shared/protocol";
import { isGuid, isVulnId } from "../shared/ids";
import { sinceStrip } from "./board";
import { Board, Drafts, SinceStrip } from "./components/Board";
import { CasePanel } from "./components/CasePanel";
import { ExportDialog } from "./components/ExportDialog";
import { Header, NAV, type Page } from "./components/Header";
import { Announcements } from "./components/Announcements";
import { InternalsPage } from "./components/Internals";
import { ActivityPage, ProfilePage, RecognitionPage } from "./components/Pages";
import { PublicCveStrip } from "./components/PublicCves";
import { Progress } from "./components/Progress";
import { ReportEditor } from "./components/report/ReportEditor";
import { unsavedNewTitle } from "./reportLocal";
import { byRecency, loadView, pinUnseen, type CaseRow, type ViewModel } from "./data";
import { PORTAL_REPORTS } from "../shared/urls";
import { loadInternals, loadSettings } from "./portalInfo";
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
  const hay = `${r.ticketNumber ?? ""} ${r.reportNumber} ${r.title} ${r.cves.join(" ")} ${r.status ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export function App() {
  const [view, setView] = useState<ViewModel | null>(null);
  const [route, setRoute] = useState<Route>(parseHash());
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  const [editorKey, setEditorKey] = useState(() => `e${Date.now()}`);
  const adopted = useRef<string | null>(null); // draft id the open editor just created
  const searchRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(() => void loadView().then(setView), []);
  const go = useCallback((hash: string) => {
    location.hash = hash;
  }, []);
  const openCase = useCallback((rn: string) => go(`case=${rn}`), [go]);

  const rows = useMemo(() => (view ? view.rows.filter((r) => searchHit(r, query.trim())) : []), [view, query]);
  // Reading order for j/k: the board's order (stage, then recency).
  const order = useMemo(() => {
    if (!view) return [] as string[];
    const rank = (r: CaseRow) => (r.closed ? 9 : r.stage.index < 0 ? 8 : r.stage.index);
    return [...view.rows].sort((a, b) => rank(a) - rank(b) || byRecency(a, b)).map((r) => r.reportNumber);
  }, [view]);

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

  const currentCase = route.page === "case" ? route.rn : null;

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
          if (route.page === "cases") window.scrollTo(0, 0);
          else go("cases");
        }}
        unseen={view.unseen}
        points={view.points.total}
        awarded={view.awards.total}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        onSync={() => void send({ type: "sync:now" })}
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
          <SinceStrip strip={sinceStrip(view.events, 4)} onOpen={openCase} onAll={() => go("activity")} onMarkSeen={() => void send({ type: "seen:mark" })} />
          {query && (
            <p class="search-note">
              {rows.length} of {view.rows.length} cases match “{query}”.{" "}
              <button class="link" onClick={() => setQuery("")}>
                Clear
              </button>
            </p>
          )}
          {!query && <PublicCveStrip unlinked={view.publicUnlinked} dismissed={view.publicDismissed} rows={view.rows} onOpen={openCase} />}
          {!query && <Drafts drafts={view.drafts} unsavedNew={unsavedNewTitle()} onOpenDraft={(id) => go(`draft=${id}`)} onNew={() => go("new")} />}
          <Board rows={rows} onOpen={openCase} searching={!!query} />
        </main>
      ) : route.page === "case" ? (
        caseRow ? (
          <main class="case-page">
            <nav class="casebar" aria-label="Case navigation">
              <button class="link" onClick={() => go("cases")}>
                ← All cases
              </button>
              <span class="top__grow" />
              <span class="muted">
                {idx + 1} of {order.length}
              </span>
              <button class="btn btn--icon" disabled={idx <= 0} onClick={() => openCase(order[idx - 1]!)} title="Previous case (k)">
                ‹
              </button>
              <button class="btn btn--icon" disabled={idx >= order.length - 1} onClick={() => openCase(order[idx + 1]!)} title="Next case (j)">
                ›
              </button>
            </nav>
            <CasePanel row={caseRow} view={{ ...view, events: pinUnseen(view.events, pinned) }} />
          </main>
        ) : (
          <main class="page">
            <p class="empty">That case isn't in your list.</p>
          </main>
        )
      ) : route.page === "activity" ? (
        <ActivityPage view={view} onOpen={openCase} onMarkSeen={() => void send({ type: "seen:mark" })} />
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
