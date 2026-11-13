import { useMemo, useState } from "preact/hooks";
import { bountyLabel, formatUsd } from "../../core/awards";
import { humanizeEnum, MSRC_SENDER } from "../../core/derive";
import type { CaseRow, ViewModel } from "../data";
import { caseLabel, when } from "../format";
import { buildTimeline } from "../../core/timeline";
import { CaseGuide } from "./CaseGuide";
import { CaseTime } from "./CaseTime";
import { Disclosures } from "./Disclosures";
import { Markdown } from "./Markdown";
import { MessageBox } from "./MessageBox";
import { PublicCveFacts } from "./PublicCves";
import { createReportApi } from "../reportApi";
import { pageToken, syncSoon } from "../pageToken";
import { StageRail, StatusPill } from "./StageRail";
import { portalCaseUrl } from "../../shared/urls";

type Tab = "timeline" | "report" | "files" | "raw";

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

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function CasePanel({ row, view }: { row: CaseRow; view: ViewModel }) {
  const [tab, setTab] = useState<Tab>("timeline");
  const api = useMemo(() => createReportApi({ fetch: (u, i) => fetch(u, i), token: pageToken }), []);
  const writeToMsrc = () => {
    setTab("timeline");
    requestAnimationFrame(() => {
      const box = document.getElementById("in-msg");
      box?.scrollIntoView({ behavior: "smooth", block: "center" });
      box?.focus({ preventScroll: true });
    });
  };
  const d = (row.record.detail ?? {}) as Record<string, unknown>;
  const msgs = useMemo(() => view.messages.filter((m) => m.reportNumber === row.reportNumber), [view, row.reportNumber]);
  const events = useMemo(() => view.events.filter((e) => e.reportNumber === row.reportNumber), [view, row.reportNumber]);
  const ownMessages = useMemo(() => msgs.filter((m) => m.senderName !== MSRC_SENDER).map((m) => ({ body: m.body, createdOn: m.createdOn })), [msgs]);
  const timeline = useMemo(() => buildTimeline(row.record, msgs, events, view.history[row.reportNumber] ?? []), [row.record, msgs, events, view.history]);
  const bounty = d["bounty"] as Record<string, unknown> | null | undefined;
  const products = (d["targetList"] as Record<string, unknown>[] | null | undefined)?.map((t) => [t["product"], t["productVersion"]].filter(Boolean).join(" ")).filter(Boolean) ?? [];
  const disclosures = (d["disclosureEventList"] as Record<string, unknown>[] | null | undefined) ?? [];
  const related = typeof d["variantOrRelatedCVE"] === "string" && d["variantOrRelatedCVE"].trim() ? d["variantOrRelatedCVE"] : null;

  return (
    <section class="detail" aria-label={`Case ${caseLabel(row)}`}>
      <header class="panel__head">
        <div class="panel__titles">
          <p class="panel__kicker">
            <span class="panel__num">{caseLabel(row)}</span>
            <StatusPill stage={row.stage} text={humanizeEnum(row.status)} />
            <span class="panel__meta">{row.reportNumber}, submitted {when(row.record.list.createdOn)}</span>
          </p>
          <h2 class="panel__title">{row.title || row.reportNumber}</h2>
        </div>
        <div class="panel__actions">
          <button type="button" class="btn btn--primary" onClick={writeToMsrc}>
            Write to MSRC
          </button>
          <a class="btn" href={portalCaseUrl(row.reportNumber)} target="_blank" rel="noopener">
            Open in portal
          </a>
        </div>
      </header>

      <div class="panel__track">
        <StageRail stage={row.stage} prev={row.prevStage} labelled />
      </div>

      <CaseTime clock={row.clock} />
      <CaseGuide api={api} row={row} onReply={writeToMsrc} />

      <dl class="fields">
        <Field label="Severity / impact">
          {[d["severity"], d["securityImpact"]].filter(Boolean).map((x) => humanizeEnum(String(x))).join(", ") || "—"}
        </Field>
        <Field label="Recognition points">{row.points > 0 ? `${row.points} pts` : "—"}</Field>
        <Field label="Bounty">
          {bounty
            ? [typeof bounty["amount"] === "number" && bounty["amount"] > 0 ? formatUsd(bounty["amount"]) : "", bountyLabel(bounty["status"] as string | null), bounty["program"] ?? ""].filter(Boolean).join(", ") || "—"
            : "—"}
        </Field>
        <Field label="CVE">
          {(row.cves.length > 0 || !related) && <PublicCveFacts entries={row.publicCves} otherCves={row.cves} />}
          {related && <span class="pubfact muted">Related CVE in your report: {related}</span>}
        </Field>
        <Field label="CVSS">{d["cvssVectorString"] ? val(d["cvssVectorString"]) : row.publicCves[0]?.item.baseScore ? `${row.publicCves[0].item.baseScore} (public advisory)` : "—"}</Field>
        <Field label="CWE">{val(d["cweList"])}</Field>
        <Field label="Products">{products.join(", ") || val(d["target"])}</Field>
        {d["hasCrossTenantImpact"] != null && <Field label="Cross-tenant impact">{humanizeEnum(String(d["hasCrossTenantImpact"]))}</Field>}
        {d["devChannelRepro"] != null && <Field label="Windows Insider Canary reproduction">{humanizeEnum(String(d["devChannelRepro"]))}</Field>}
        <Field label="Unread in portal">{val(d["unreadMessageCount"] ?? row.record.list.unreadMessageCount)}</Field>
      </dl>

      <section class="plan-wrap" aria-labelledby="plan-h">
        <h3 id="plan-h">Planned disclosure</h3>
        <Disclosures api={api} reportNumber={row.reportNumber} events={disclosures} onChanged={syncSoon} />
      </section>

      <div class="tabs" role="tablist">
        {(
          [
            ["timeline", `Timeline (${timeline.length})`],
            ["report", "Report"],
            ["files", `Files (${row.record.files.length})`],
            ["raw", "Raw data"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} class="tab" onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div class="panel__body">
        {tab === "timeline" && (
          <ol class="tl">
            {timeline.map((i) => (
              <li key={i.key} class={`tl__item tl__item--${i.kind}${i.from ? ` tl__item--${i.from}` : ""}${i.isNew ? " is-new" : ""}`}>
                <div class="tl__when">
                  {when(i.at)}
                  {i.kind === "message" && <span>{i.from === "msrc" ? (i.automatic ? " · MSRC (template)" : " · MSRC") : " · You"}</span>}
                  {i.kind === "file" && <span> · file uploaded</span>}
                  {i.isNew && <b class="tl__new"> new</b>}
                </div>
                {i.kind === "message" ? (
                  <div class="msg">
                    {i.label && <p class="msg__label">{i.label}</p>}
                    <Markdown class="msg__text" src={i.text} />
                  </div>
                ) : (
                  <p class="tl__text">{i.kind === "file" ? `File: ${i.text}` : i.text}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {tab === "timeline" && <MessageBox api={api} reportNumber={row.reportNumber} caseLabel={caseLabel(row)} ownMessages={ownMessages} onSent={syncSoon} />}

        {tab === "report" && (
          <div class="report">
            {REPORT_FIELDS.filter(([k]) => d[k]).map(([k, label]) => (
              <section key={k}>
                <h3>{label}</h3>
                <Markdown class="report__text" src={String(d[k])} />
              </section>
            ))}
            {!REPORT_FIELDS.some(([k]) => d[k]) && <p class="empty">No report text available.</p>}
          </div>
        )}

        {tab === "files" &&
          (row.record.files.length ? (
            <table class="files">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {row.record.files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{when(f.createdOn)}</td>
                    <td>{val(f.raw["uploadStatus"])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="empty">No files on this case. The researcher API lists file names only; downloads aren't available.</p>
          ))}

        {tab === "raw" && <pre class="raw">{JSON.stringify({ list: row.record.list.raw, detail: row.record.detail, files: row.record.files.map((f) => f.raw) }, null, 2)}</pre>}
      </div>
    </section>
  );
}
