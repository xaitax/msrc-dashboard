import { useMemo, useRef, useState } from "preact/hooks";
import type { ChangeEvent } from "../../shared/types";
import { groupFeed, type FeedItem, type CaseRow, type ViewModel } from "../data";
import { clock } from "../format";
import { BoardDate } from "./BoardDate";
import { CaseIcon } from "./CaseIcon";
import { ChangeText } from "./ChangeText";
import { activityIcon, boardCaseLabel } from "./eventStyle";

const filters = [
  { label: "All activity", matches: () => true },
  { label: "MSRC messages", matches: (e: ChangeEvent) => e.type === "msrc_message" },
  { label: "Case changes", matches: (e: ChangeEvent) => ["status", "status_reason", "cve", "bounty", "disclosure_event", "field_changed"].includes(e.type) },
  { label: "Your activity", matches: (e: ChangeEvent) => e.own },
] as const;

function ActivityRow({ event, row }: { event: FeedItem; row?: CaseRow }) {
  const icon = activityIcon(event);
  const stamp = new Date(event.occurredAt).toLocaleString();
  return (
    <li>
      <a class={`act__row${event.unseen ? " is-new" : ""}`} href={`#case=${event.reportNumber}`}>
        <time class="act__time" dateTime={event.occurredAt} title={stamp}>{clock(event.occurredAt)}</time>
        <span class={`act__icon chg__icon--${icon}`} aria-hidden="true"><CaseIcon name={icon} /></span>
        <span class="act__what">
          {event.unseen && <span class="sr-only">Unseen update. </span>}
          <ChangeText event={event} />
          {event.count > 1 && (
            <span class="act__repeat" title={`${event.count} matching updates this day, latest time shown`}>
              <span aria-hidden="true">×{event.count}</span><span class="sr-only">, {event.count} matching updates</span>
            </span>
          )}
        </span>
        <span class="act__context">
          <span class="act__case">{boardCaseLabel(row ?? event)}</span>
          {row?.title && <span class="act__title" title={row.title}>{row.title}</span>}
        </span>
        <span class="act__open" aria-hidden="true"><CaseIcon name="next" /></span>
      </a>
    </li>
  );
}

interface Props {
  view: ViewModel;
  onMarkSeen: () => void;
  onClearPortal: () => void;
  clearingPortalRead: boolean;
}

export function ActivityPage({ view, onMarkSeen, onClearPortal, clearingPortalRead }: Props) {
  const [filter, setFilter] = useState<(typeof filters)[number]>(filters[0]);
  const filterBar = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => new Map(view.rows.map(row => [row.reportNumber, row])), [view.rows]);
  const localDay = new Date().toDateString();
  const days = useMemo(() => groupFeed(view.events.filter(filter.matches), new Date(), null), [view.events, filter, localDay]);
  const unseen = view.unseen;
  return (
    <main class="activity-page">
      <header class="act__header">
        <div class="act__heading">
          <h1>Activity</h1>
          {view.events.length > 0 && <span class={`act__status${unseen ? " is-new" : ""}`} role="status">
            {!unseen && <CaseIcon name="check" />}{unseen ? `${unseen} unseen` : "All seen"}
          </span>}
        </div>
        <div class="act__actions">
          {unseen > 0 && <button type="button" class="btn" title="Mark all dashboard updates as seen" onClick={() => {
            filterBar.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
            onMarkSeen();
          }}><CaseIcon name="check" />Mark all seen</button>}
          <button type="button" class="btn" title="Mark notifications as read in the MSRC portal" onClick={onClearPortal} disabled={clearingPortalRead || view.state.auth !== "ok"}>
            <CaseIcon name="bell" />{clearingPortalRead ? "Marking read…" : "Clear MSRC bell"}
          </button>
        </div>
        <div class="act__filters" role="group" aria-label="Filter activity" ref={filterBar}>
          {filters.map(f => <button type="button" key={f.label} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f.label}</button>)}
        </div>
      </header>
      <div class="act">
        {days.length === 0 && <p class="act__empty" role="status">{filter === filters[0] ? "No activity yet." : `No updates in “${filter.label}”.`}</p>}
        {days.map(day => {
          const at = day.events[0]!.occurredAt;
          const count = day.events.reduce((total, event) => total + event.count, 0);
          return (
            <section class="act__day" key={day.label} aria-label={day.label}>
              <div class="act__date">
                <h2 class="act__label"><BoardDate at={at} label={day.label} title={new Date(at).toLocaleDateString(undefined, { dateStyle: "full" })} /></h2>
                <span class="act__count">{count} {count === 1 ? "update" : "updates"}</span>
              </div>
              <ol class="act__list" role="list">
                {day.events.map(event => <ActivityRow key={event.key} event={event} row={rows.get(event.reportNumber)} />)}
              </ol>
            </section>
          );
        })}
      </div>
    </main>
  );
}
