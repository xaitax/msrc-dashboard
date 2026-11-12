import { useEffect, useMemo, useState } from "preact/hooks";
import { bountyLabel, formatUsd } from "../../core/awards";
import { eventLabel, findPlacements, nameMatcher, programLabel } from "../../core/recognition";
import type { Extras } from "../../background/extras";
import { send } from "../../shared/protocol";
import type { ChangeEvent } from "../../shared/types";
import { groupFeed, type ViewModel } from "../data";
import { caseLabel, clock, when } from "../format";
import { TYPE_CLASS } from "./eventStyle";

/* ---------------- Activity ---------------- */

type ActFilter = "all" | "msrc" | "changes" | "yours";
const ACT: [ActFilter, string, (e: ChangeEvent) => boolean][] = [
  ["all", "Everything", () => true],
  ["msrc", "From MSRC", (e) => e.type === "msrc_message"],
  ["changes", "Status, CVE & bounty", (e) => ["status", "status_reason", "cve", "bounty", "disclosure_event", "field_changed"].includes(e.type)],
  ["yours", "Your replies & uploads", (e) => e.own],
];

export function ActivityPage({ view, onOpen, onMarkSeen }: { view: ViewModel; onOpen: (rn: string) => void; onMarkSeen: () => void }) {
  const [f, setF] = useState<ActFilter>("all");
  const titleOf = useMemo(() => new Map(view.rows.map((r) => [r.reportNumber, r.title])), [view]);
  const pred = ACT.find(([k]) => k === f)![2];
  const groups = useMemo(() => groupFeed(view.events.filter(pred), new Date(), null), [view, f]);
  const unseen = view.unseen;
  return (
    <main class="page">
      <header class="page__head">
        <h1 class="page__title">Activity</h1>
        <p class="page__lead">{unseen ? `${unseen} unseen ${unseen === 1 ? "change" : "changes"}.` : "You're up to date."} Everything that happened on your cases, newest first.</p>
        <div class="seg" role="group" aria-label="Filter activity">
          {ACT.map(([k, label]) => (
            <button key={k} class="seg__item" aria-pressed={f === k} onClick={() => setF(k)}>
              {label}
            </button>
          ))}
          <span class="top__grow" />
          {unseen > 0 && (
            <button class="btn" onClick={onMarkSeen}>
              Mark all seen
            </button>
          )}
        </div>
      </header>
      <div class="act">
        {groups.length === 0 && <p class="empty">Nothing here yet.</p>}
        {groups.map((g) => (
          <section key={g.label} class="act__day">
            <h2 class="act__label">{g.label}</h2>
            <ul>
              {g.events.map((e) => (
                <li key={e.key}>
                  <button class={`act__row${e.seen ? "" : " is-new"}`} onClick={() => onOpen(e.reportNumber)}>
                    <time class="act__time">{clock(e.occurredAt)}</time>
                    <span class={`dot dot--${TYPE_CLASS[e.type]}`} aria-hidden="true" />
                    <span class="act__case">{caseLabel(e)}</span>
                    <span class="act__what">
                      {e.summary}
                      {e.count > 1 && <span class="muted"> ×{e.count}</span>}
                    </span>
                    <span class="act__title">{titleOf.get(e.reportNumber) ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

/* ---------------- shared: extras loader ---------------- */

function useExtras(): [Extras | null, boolean, () => void] {
  const [data, setData] = useState<Extras | null>(null);
  const [busy, setBusy] = useState(true);
  const load = (force: boolean) => {
    setBusy(true);
    void send<Extras>({ type: "extras:get", force })
      .then((x) => setData(x ?? null))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(false), []);
  return [data, busy, () => load(true)];
}

function Fetched({ x, busy, onRefresh }: { x: Extras | null; busy: boolean; onRefresh: () => void }) {
  return (
    <p class="page__meta">
      {busy ? "Loading from MSRC…" : x?.fetchedAt ? `Checked ${when(new Date(x.fetchedAt).toISOString())}` : "Not loaded yet"}
      {x?.error && <span class="is-err"> · {x.error}</span>}
      <button class="link" onClick={onRefresh} disabled={busy}>
        Refresh
      </button>
    </p>
  );
}

/* ---------------- Recognition ---------------- */

export function RecognitionPage({ view }: { view: ViewModel }) {
  const [x, busy, refresh] = useExtras();
  const [program, setProgram] = useState("ALL");
  const [hmQuery, setHmQuery] = useState("");
  const rec = x?.recognition ?? null;
  const name = x?.profile?.publicName ?? "";
  const isMe = useMemo(() => nameMatcher(name), [name]);
  const placements = rec && name ? findPlacements(rec, name) : null;
  const table = rec?.leaderboards.find((t) => t.bountyProgram === program) ?? rec?.leaderboards[0];
  const latestQuarter = rec?.allTime.slice().sort((a, b) => b.year - a.year || (b.quarter ?? 0) - (a.quarter ?? 0))[0];
  const hm = rec?.honorableMentions.flatMap((h) => h.researchers) ?? [];
  const hmShown = hm.filter((r) => !hmQuery || r.displayName.toLowerCase().includes(hmQuery.toLowerCase()));
  const found = placements && (placements.leaderboards.length || placements.allTime.length || placements.honorableMentions.length || placements.events.length);
  // MSRC leaves some metrics empty for everyone; only show columns that carry data.
  const metrics = (["points", "accuracy", "impact", "volume"] as const).filter((k) => latestQuarter?.leaderboardRanks.some((r) => r[k] !== null && r[k] !== undefined));

  return (
    <main class="page">
      <header class="page__head">
        <h1 class="page__title">Recognition</h1>
        <p class="page__lead">MSRC's public leaderboards and honourable mentions{rec ? ` for ${rec.year}` : ""}, checked against your public name{name ? ` “${name}”` : ""}.</p>
        <Fetched x={x} busy={busy} onRefresh={refresh} />
      </header>

      {rec && (
        <section class={`you-card${found ? " is-found" : ""}`}>
          {found ? (
            <>
              <h2>You're on the list</h2>
              <ul>
                {placements!.leaderboards.map((p) => (
                  <li key={p.program}>
                    <b>#{p.rank}</b> of {p.of} · {programLabel(p.program)} {p.year}
                  </li>
                ))}
                {placements!.allTime.map((p) => (
                  <li key={`${p.year}-${p.quarter}`}>
                    <b>#{p.rank}</b> of {p.of} · quarterly ranking Q{p.quarter} {p.year}
                  </li>
                ))}
                {placements!.honorableMentions.map((y) => (
                  <li key={y}>Honourable mention {y}</li>
                ))}
                {placements!.events.map((p) => (
                  <li key={p.event}>
                    <b>#{p.rank}</b> of {p.of} · {eventLabel(p.event)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2>Not listed yet</h2>
              <p>
                You don't appear on the {rec.year} leaderboards ({rec.leaderboards.length} programs), the quarterly rankings ({rec.allTime.length} lists), the {rec.year} honourable mentions ({hm.length} names)
                {(rec.events ?? []).length ? ` or ${(rec.events ?? []).map((e) => eventLabel(e.event)).join(", ")}` : ""} yet. The quarterly rankings add up recognition points; see Your points below for where you stand. This page highlights you as soon as you appear.
              </p>
            </>
          )}
        </section>
      )}

      <AwardsBlock view={view} payout={x?.profile?.payout} />
      <PointsBlock view={view} rec={rec} />

      {rec && table && (
        <div class="rec-grid">
          <section class="rec-block">
            <div class="rec-block__head">
              <h2>Leaderboard {rec.year}</h2>
              <select value={table.bountyProgram} onChange={(e) => setProgram((e.target as HTMLSelectElement).value)} aria-label="Bounty program">
                {rec.leaderboards.map((t) => (
                  <option key={t.bountyProgram} value={t.bountyProgram}>
                    {programLabel(t.bountyProgram)} ({t.leaderboardRanks.length})
                  </option>
                ))}
              </select>
            </div>
            <RankList ranks={table.leaderboardRanks} isMe={isMe} />
          </section>

          {latestQuarter && (
            <section class="rec-block">
              <div class="rec-block__head">
                <h2>
                  Quarterly ranking Q{latestQuarter.quarter} {latestQuarter.year}
                </h2>
                <span class="muted">{latestQuarter.leaderboardRanks.length} researchers</span>
              </div>
              <table class="qtable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Researcher</th>
                    {metrics.map((k) => (
                      <th key={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {latestQuarter.leaderboardRanks.slice(0, 25).map((r, i) => (
                    <tr key={i} class={isMe(r.displayName) ? "is-me" : ""}>
                      <td>{r.rank}</td>
                      <td>{r.displayName}</td>
                      {metrics.map((k) => (
                        <td key={k}>{r[k] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p class="muted small">Top 25 shown.</p>
            </section>
          )}

          {(rec.events ?? []).map((ev) => (
            <section key={ev.event} class="rec-block">
              <div class="rec-block__head">
                <h2>{eventLabel(ev.event)}</h2>
                <span class="muted">{ev.leaderboardRanks.length} researchers</span>
              </div>
              <RankList ranks={ev.leaderboardRanks} isMe={isMe} />
            </section>
          ))}

          <section class="rec-block rec-block--wide">
            <div class="rec-block__head">
              <h2>Honourable mentions {rec.year}</h2>
              <span class="muted">{hm.length} researchers</span>
              <span class="top__grow" />
              <input class="input input--sm" type="search" placeholder="Find a name" value={hmQuery} onInput={(e) => setHmQuery((e.target as HTMLInputElement).value)} />
            </div>
            <ul class="hm">
              {hmShown.slice(0, 240).map((r, i) => (
                <li key={i} class={isMe(r.displayName) ? "is-me" : ""}>
                  {r.displayName}
                </li>
              ))}
            </ul>
            {hmShown.length > 240 && <p class="muted small">Showing 240 of {hmShown.length}. Use the search to find a name.</p>}
          </section>
        </div>
      )}
    </main>
  );
}

function RankList({ ranks, isMe }: { ranks: { rank: number; displayName: string }[]; isMe: (name: string) => boolean }) {
  return (
    <ol class="ranks">
      {ranks.map((r, i) => (
        <li key={i} class={isMe(r.displayName) ? "is-me" : ""}>
          <span class="ranks__n">{r.rank}</span>
          <span class="ranks__name">{r.displayName}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Your bounties ---------------- */

function AwardsBlock({ view, payout }: { view: ViewModel; payout: string | null | undefined }) {
  const a = view.awards;
  if (a.awarded.length === 0 && a.underReview.length === 0) return null;
  const unpaid = a.total - a.paid;
  return (
    <section class="rec-block awards">
      <div class="rec-block__head">
        <h2>Your bounties</h2>
        <span class="muted">Added up from your cases. MSRC shows no total anywhere.</span>
      </div>
      <p class="awards__total">
        <b>{formatUsd(a.total)}</b> awarded on {a.awarded.length} {a.awarded.length === 1 ? "case" : "cases"}
        {a.awarded.length > 0 && <span class="muted">{a.paid > 0 ? `, ${formatUsd(a.paid)} paid and closed, ${formatUsd(unpaid)} still open` : ", none closed as paid yet"}</span>}
      </p>
      {payout && <p class="muted small">Payouts go to {payout}, your default provider in the MSRC profile.</p>}
      <ul class="pts-list awards__list">
        {a.awarded.map((r) => (
          <li key={r.reportNumber}>
            <a href={`#case=${r.reportNumber}`}>{caseLabel(r)}</a>
            <span class="pts-list__title" title={r.title}>
              {bountyLabel(r.status)}
              {r.program ? `, ${r.program}` : ""}
            </span>
            <b>{formatUsd(r.amount ?? 0)}</b>
          </li>
        ))}
        {a.underReview.map((r) => (
          <li key={r.reportNumber}>
            <a href={`#case=${r.reportNumber}`}>{caseLabel(r)}</a>
            <span class="pts-list__title" title={r.title}>
              Bounty under review
            </span>
            <span class="muted">—</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Your points ---------------- */

function PointsBlock({ view, rec }: { view: ViewModel; rec: Extras["recognition"] }) {
  const pts = view.points;
  if (pts.total === 0) return null;
  // Lowest score on each published quarterly ranking (the bar to appear on it).
  const cutoff = new Map<string, number>();
  for (const t of rec?.allTime ?? []) {
    if (t.product) continue;
    const scores = t.leaderboardRanks.map((r) => r.points).filter((x): x is number => typeof x === "number");
    if (scores.length) cutoff.set(t.year + "-" + t.quarter, Math.min(...scores));
  }
  const withPoints = view.rows.filter((r) => r.points > 0).sort((a, b) => b.points - a.points || Date.parse(b.record.list.createdOn ?? "0") - Date.parse(a.record.list.createdOn ?? "0"));
  return (
    <section class="rec-block rec-points">
      <div class="rec-block__head">
        <h2>Your points</h2>
        <span class="muted">
          {pts.total} points on {pts.cases} {pts.cases === 1 ? "case" : "cases"}, as MSRC records them per case (the portal doesn't show this)
        </span>
      </div>
      <table class="qtable">
        <thead>
          <tr>
            <th>Quarter (by submission)</th>
            <th>Your points</th>
            <th>Lowest score on MSRC's list</th>
            <th>Outlook</th>
          </tr>
        </thead>
        <tbody>
          {pts.byQuarter.map((q) => {
            const c = cutoff.get(q.year + "-" + q.quarter);
            const outlook = c === undefined ? "List not published yet" : q.points >= c ? "Enough to be listed" : `${c - q.points} short of the list`;
            return (
              <tr key={q.year + "-" + q.quarter}>
                <td>
                  Q{q.quarter} {q.year}
                </td>
                <td>
                  <b>{q.points}</b> <span class="muted">({q.cases} {q.cases === 1 ? "case" : "cases"})</span>
                </td>
                <td>{c === undefined ? "—" : c}</td>
                <td>{outlook}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="muted small">Grouping by submission quarter is an assumption; MSRC may count points in the quarter a case is assessed or closed.</p>
      <ul class="pts-list">
        {withPoints.map((r) => (
          <li key={r.reportNumber}>
            <a href={`#case=${r.reportNumber}`}>{caseLabel(r)}</a>
            <span class="pts-list__title">{r.title}</span>
            <b>{r.points}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Profile ---------------- */

export function ProfilePage() {
  const [x, busy, refresh] = useExtras();
  const [reveal, setReveal] = useState(false);
  const p = x?.profile;
  return (
    <main class="page page--narrow">
      <header class="page__head">
        <h1 class="page__title">Profile</h1>
        <p class="page__lead">Your MSRC researcher profile, as the portal has it. Read-only; change it on the portal.</p>
        <Fetched x={x} busy={busy} onRefresh={refresh} />
      </header>
      {p && (
        <dl class="profile">
          <div>
            <dt>Name</dt>
            <dd>{p.name || "—"}</dd>
          </div>
          <div>
            <dt>Shown publicly as</dt>
            <dd>{p.publicName}</dd>
          </div>
          <div>
            <dt>Recognition preference</dt>
            <dd>{p.recognitionPreference === "PreferedNameForPublicRecognition" ? "Use my preferred name" : (p.recognitionPreference ?? "—")}</dd>
          </div>
          <div>
            <dt>Social profile</dt>
            <dd>{p.socialUrl && /^https:\/\//.test(p.socialUrl) ? <a href={p.socialUrl} target="_blank" rel="noopener">{p.socialUrl}</a> : "—"}</dd>
          </div>
          <div>
            <dt>Websites</dt>
            <dd>
              {p.websites.length
                ? p.websites.map((w) => (
                    <a key={w} href={w} target="_blank" rel="noopener" class="block">
                      {w}
                    </a>
                  ))
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Bounty payouts</dt>
            <dd>{p.payout ?? "—"}</dd>
          </div>
          <div>
            <dt>Portal notifications</dt>
            <dd>{p.subscriptions.length ? p.subscriptions.map((s) => `${s.type} by ${s.delivery.toLowerCase()} (${s.digest.toLowerCase()})`).join("; ") : "—"}</dd>
          </div>
          <div>
            <dt>Email and location</dt>
            <dd>
              {reveal ? (
                <>
                  {p.private.email ?? "—"}
                  <br />
                  {p.private.location ?? "—"}
                </>
              ) : (
                <button class="link" onClick={() => setReveal(true)}>
                  Show
                </button>
              )}
            </dd>
          </div>
        </dl>
      )}
      <p class="page__foot">
        <a href="#internals">Portal internals</a>
        <span class="muted">: what the portal publishes about itself, from its AI pre-screening to its test environments.</span>
      </p>
    </main>
  );
}
