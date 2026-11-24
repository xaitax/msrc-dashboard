import { useRef } from "preact/hooks";
import type { TimelineItem } from "../../core/timeline";
import { clock, dayLabel } from "../format";
import { CaseIcon } from "./CaseIcon";
import { ChangeParts } from "./ChangeText";
import { Markdown } from "./Markdown";

export interface FlagAction {
  id: string;
  pending: boolean;
  feedback: string;
}

function groupDays(items: TimelineItem[]) {
  const days: { label: string; items: TimelineItem[] }[] = [];
  const now = new Date();
  for (const item of items) {
    const date = new Date(item.at);
    const label = Number.isFinite(date.getTime()) ? dayLabel(date, now) : "Date unavailable";
    const previous = days.at(-1);
    if (previous?.label === label) previous.items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}

interface Props {
  items: TimelineItem[];
  flagged: Set<string>;
  flagStatus: string | null;
  flagAction: FlagAction | null;
  onUnflag?: (id: string, row: HTMLLIElement | null) => void;
}

export function CaseTimeline({ items, flagged, flagStatus, flagAction, onUnflag }: Props) {
  const firstFlagged = useRef<HTMLLIElement>(null);
  const latest = useRef<HTMLLIElement>(null);
  const firstFlaggedKey = items.find((item) => item.kind === "message" && flagged.has(item.key.slice(2)))?.key;
  const latestKey = items.at(-1)?.key;

  if (!items.length) return <p class="case-empty">Activity will appear here as the case updates.</p>;

  return (
    <div class="case-thread">
      {(items.length > 1 || firstFlaggedKey || flagStatus) && (
        <div class="case-thread__tools">
          {flagStatus && <span class="case-thread__status" role="status">{flagStatus}</span>}
          {firstFlaggedKey && (
            <button type="button" class="link case-thread__flags" onClick={() => firstFlagged.current?.focus()}>
              <CaseIcon name="flag" /> {flagged.size} flagged {flagged.size === 1 ? "message" : "messages"}
            </button>
          )}
          {items.length > 1 && (
            <button type="button" class="link case-thread__latest" onClick={() => latest.current?.focus()}>
              <CaseIcon name="down" /> Jump to latest
            </button>
          )}
        </div>
      )}
      {groupDays(items).map((day) => (
        <section key={day.items[0]!.key} class="thread-day" aria-label={day.label}>
          <h2 class="thread-day__date">{day.label}</h2>
          <ol class="tl">
            {day.items.map((item) => {
              const id = item.kind === "message" ? item.key.slice(2) : null;
              const isFlagged = id !== null && flagged.has(id);
              const action = flagAction?.id === id ? flagAction : null;
              const first = item.key === firstFlaggedKey;
              const last = item.key === latestKey;
              const time = Number.isFinite(Date.parse(item.at)) ? (
                <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>{clock(item.at)}</time>
              ) : null;
              const newMark = item.isNew && <span class="tl__new">New</span>;
              const message = <Markdown class="msg__text" src={item.text} />;

              return (
                <li key={item.key}
                  ref={first || last ? (el) => { if (first) firstFlagged.current = el; if (last) latest.current = el; } : undefined}
                  tabIndex={isFlagged || action || last ? -1 : undefined}
                  class={`tl__item tl__item--${item.kind}${item.from ? ` tl__item--${item.from}` : ""}${item.isNew ? " is-new" : ""}`}>
                  <span class="tl__symbol"><CaseIcon name={item.kind === "message" ? item.from === "you" ? "reply" : "message" : item.kind === "file" ? "file" : "status"} /></span>
                  {item.kind === "message" ? (
                    <div class="msg">
                      <div class="msg__head">
                        <div class="msg__who">
                          <strong>{item.from === "msrc" ? "MSRC" : "You"}</strong>
                          {time}
                          {item.automatic && <span class="msg__auto">Automated</span>}
                          {newMark}
                        </div>
                        {isFlagged && (
                          <div class="msg__flag-actions">
                            <span class="tl__flag" title="MSRC’s flagged message list includes this message"><CaseIcon name="flag" /> Flagged</span>
                            {id && onUnflag && <button type="button" class="link tl__unflag" aria-disabled={flagAction?.pending || undefined}
                              onClick={(e) => onUnflag(id, e.currentTarget.closest("li"))}>Unflag</button>}
                          </div>
                        )}
                      </div>
                      {(isFlagged || action) && <span class="tl__flag-feedback" role="status">{action?.feedback}</span>}
                      {item.automatic ? (
                        <details class="msg__template" open={item.isNew || isFlagged || undefined}>
                          <summary><span>{item.label ?? "Automated message from MSRC"}</span><CaseIcon name="chevron" /></summary>
                          {message}
                        </details>
                      ) : (
                        <>
                          {item.label && <p class="msg__label">{item.label}</p>}
                          {message}
                        </>
                      )}
                    </div>
                  ) : (
                    <div class="tl__record">
                      <div class="tl__record-label">
                        {item.kind === "file" && <span class="tl__record-kind">Attachment uploaded</span>}
                        <p>{item.changeParts ? <ChangeParts parts={item.changeParts} /> : item.text}</p>
                      </div>
                      <div class="tl__record-meta">{newMark}{time}</div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
