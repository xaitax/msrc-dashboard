// Write to MSRC on a case. Sending can't be undone, so the box's button only
// opens a preview popup; that popup's "Send to MSRC" is the one click that
// sends. Unsent text is kept per case in localStorage. A send that may have
// reached MSRC (server error, dropped connection) is never offered as a plain
// retry: the box waits for the next sync to show the message on the case.
import { useEffect, useRef, useState } from "preact/hooks";
import { decodeEntities } from "../../core/text";
import { MaybeSentError, MESSAGE_TOPICS, type MessageTopic, type ReportApi } from "../reportApi";
import { clearMessageDraft, loadMessageDraft, messageDraftKey, saveMessageDraft } from "../reportLocal";
import { clock } from "../format";
import { Markdown } from "./Markdown";
import { MdArea } from "./report/fields";
import { errorText } from "../../shared/protocol";

interface Props {
  api: ReportApi;
  reportNumber: string;
  caseLabel: string;
  /** The researcher's own messages on this case, as synced from MSRC. */
  ownMessages: { body: string; createdOn: string }[];
  /** Ask for a sync (after a send, or to find out whether a send arrived). */
  onSent: () => void;
}

const isTopic = (v: string): v is MessageTopic => MESSAGE_TOPICS.some((t) => t.value === v);
/** MSRC escapes some characters and may touch whitespace. */
const comparable = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();
const at = (ms: number) => clock(new Date(ms).toISOString());
const MATCH_WINDOW_MS = 5 * 60_000;

/** Keyed by case: stepping to another case (same panel) starts a fresh box. */
export function MessageBox(p: Props) {
  return <Box key={p.reportNumber} {...p} />;
}

function Box(p: Props) {
  const [initial] = useState(() => loadMessageDraft(p.reportNumber));
  const [text, setText] = useState(initial?.text ?? "");
  const [topic, setTopic] = useState<MessageTopic | "">(initial && isTopic(initial.topic) ? initial.topic : "");
  const [maybeSentAt, setMaybeSentAt] = useState<number | null>(initial?.maybeSentAt ?? null);
  const [reviewing, setReviewing] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  /** The message is on MSRC: empty the box and forget the saved copy. */
  const sent = (at: number) => {
    clearMessageDraft(p.reportNumber);
    setText("");
    setTopic("");
    setMaybeSentAt(null);
    setSentAt(at);
  };

  useEffect(() => saveMessageDraft(p.reportNumber, { text, topic, ...(maybeSentAt ? { maybeSentAt } : {}) }), [p.reportNumber, text, topic, maybeSentAt]);

  // Another dashboard tab on this case sent or edited the message: follow it,
  // so text sent there can't come back here as a draft.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== messageDraftKey(p.reportNumber)) return;
      const d = loadMessageDraft(p.reportNumber);
      setText(d?.text ?? "");
      setTopic(d && isTopic(d.topic) ? d.topic : "");
      setMaybeSentAt(d?.maybeSentAt ?? null);
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, [p.reportNumber]);

  // A maybe-sent message that shows up on the case after a sync did arrive.
  useEffect(() => {
    if (!maybeSentAt) return;
    const want = comparable(text);
    const arrived = p.ownMessages.some((m) => Date.parse(m.createdOn) >= maybeSentAt - MATCH_WINDOW_MS && comparable(m.body) === want);
    if (arrived) sent(maybeSentAt);
  }, [p.ownMessages, maybeSentAt, text, p.reportNumber]);

  const empty = !text.trim();
  return (
    <section class="compose" aria-labelledby="compose-title">
      <div class="compose__head">
        <h3 id="compose-title">Write to MSRC</h3>
        <span class="muted small">Goes to the case team, like the portal's message box. Markdown works.</span>
      </div>
      {maybeSentAt && (
        <p class="compose__warn" role="status">
          This message may already have reached MSRC: the send at {at(maybeSentAt)} didn't confirm. Each sync checks the case for it; wait for that before sending it again.
        </p>
      )}
      <MdArea id="msg" value={text} onChange={(v) => (setText(v), setSentAt(null))} rows={5} placeholder="Type a new message" />
      <div class="compose__bar">
        <label class="compose__topic">
          <span>Topic</span>
          <select id="msg-topic" class="input input--sm" value={topic} onChange={(e) => setTopic(((e.target as HTMLSelectElement).value as MessageTopic) || "")}>
            <option value="">No topic</option>
            {MESSAGE_TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <span class="top__grow" />
        {sentAt && (
          <span class="compose__sent" role="status">
            Sent at {at(sentAt)}. It shows in the timeline after the next sync.
          </span>
        )}
        <button type="button" class="btn btn--primary" disabled={empty} onClick={() => setReviewing(true)}>
          Review and send…
        </button>
      </div>
      {reviewing && (
        <SendDialog
          {...p}
          text={text}
          topic={topic || null}
          maybeSentAt={maybeSentAt}
          onClose={() => setReviewing(false)}
          onUncertain={() => {
            setMaybeSentAt(Date.now());
            p.onSent();
          }}
          onDone={() => {
            sent(Date.now());
            setReviewing(false);
            p.onSent();
          }}
        />
      )}
    </section>
  );
}

type Outcome = { kind: "failed"; message: string } | { kind: "uncertain"; message: string } | null;

function SendDialog(p: Props & { text: string; topic: MessageTopic | null; maybeSentAt: number | null; onClose: () => void; onUncertain: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const inflight = useRef(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  useEffect(() => {
    ref.current?.showModal();
    cancelRef.current?.focus(); // never a link in the preview, never Send
  }, []);

  const send = async () => {
    if (inflight.current) return; // one click, one message
    inflight.current = true;
    setSending(true);
    setOutcome(null);
    try {
      await p.api.sendMessage(p.reportNumber, p.text, p.topic);
      p.onDone();
      return;
    } catch (e) {
      const message = errorText(e);
      if (e instanceof MaybeSentError) {
        setOutcome({ kind: "uncertain", message });
        p.onUncertain();
      } else setOutcome({ kind: "failed", message });
    }
    inflight.current = false;
    setSending(false);
  };

  const topicLabel = MESSAGE_TOPICS.find((t) => t.value === p.topic)?.label ?? "No topic";
  const uncertain = outcome?.kind === "uncertain";
  return (
    <dialog
      ref={ref}
      class="dialog dialog--send"
      onCancel={(e) => {
        e.preventDefault();
        if (!inflight.current) p.onClose();
      }}
      onClose={() => {
        // The browser can force a modal closed (repeated Esc). Mid-send it
        // stays up so the result is seen; otherwise the box must know.
        if (inflight.current) ref.current?.showModal();
        else p.onClose();
      }}
    >
      <h2>Send this message to MSRC?</h2>
      <p class="dialog__lead">
        Case <b>{p.caseLabel}</b> ({p.reportNumber}), topic: {topicLabel}
      </p>
      {p.maybeSentAt && !uncertain && (
        <p class="dialog__warn" role="alert">
          A send of this message at {at(p.maybeSentAt)} may already have reached MSRC. Check the case timeline first, or it may arrive twice.
        </p>
      )}
      <div class="send__preview">
        <Markdown src={p.text.trim()} />
      </div>
      {!uncertain && <p class="dialog__note">MSRC gets it right away. A sent message can't be edited or deleted.</p>}
      {outcome?.kind === "failed" && (
        <p class="rf__err" role="alert">
          {outcome.message} Nothing was sent.
        </p>
      )}
      {uncertain && (
        <p class="dialog__warn" role="alert">
          MSRC may have received this message ({outcome.message}). The dashboard checks the case at the next sync. Don't send it again until then.
        </p>
      )}
      <div class="dialog__actions">
        {uncertain ? (
          <button type="button" class="btn" onClick={p.onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" class="btn" ref={cancelRef} onClick={p.onClose} disabled={sending}>
              Cancel
            </button>
            <button type="button" class="btn btn--go" onClick={() => void send()} disabled={sending}>
              {sending ? "Sending…" : p.maybeSentAt ? "Send again anyway" : "Send to MSRC"}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
