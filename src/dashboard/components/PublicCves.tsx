// Public CVEs that credit the researcher (Microsoft's Security Update Guide).
// MSRC's own case update can lag the release by days, and the guide never says
// which case a CVE belongs to: the researcher confirms the link with one click.
import { useState } from "preact/hooks";
import { publicCveUrl, type PublicCve } from "../../core/publicCves";
import { send } from "../../shared/protocol";
import type { VulnId } from "../../shared/types";
import { caseLabel } from "../../core/derive";

type RowRef = { reportNumber: string; ticketNumber: string | null; title: string };

const link = (cve: string, reportNumber: VulnId | null | undefined) => void send({ type: "cve:link", cve, reportNumber });

export function releaseDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "Important, CVSS 7.0, Exploitation More Likely" — whatever the guide has. */
export function cveFacts(p: PublicCve): string {
  return [p.severity, p.baseScore ? `CVSS ${p.baseScore}` : null, p.exploitability].filter(Boolean).join(", ");
}

export function PublicCveStrip({
  unlinked,
  dismissed = [],
  rows,
  onOpen,
}: {
  unlinked: { item: PublicCve; suggestion: VulnId | null }[];
  dismissed?: PublicCve[];
  rows: RowRef[];
  onOpen: (rn: string) => void;
}) {
  if (unlinked.length === 0 && dismissed.length === 0) return null;
  const notMine =
    dismissed.length > 0 ? (
      <p class="pubcves__dismissed">
        Marked as not yours:{" "}
        {dismissed.map((d, i) => (
          <span key={d.cve}>
            {i > 0 && ", "}
            <a href={publicCveUrl(d.cve)} target="_blank" rel="noopener">
              {d.cve}
            </a>{" "}
            <button type="button" class="link" onClick={() => link(d.cve, undefined)}>
              Undo
            </button>
          </span>
        ))}
      </p>
    ) : null;
  if (unlinked.length === 0) return notMine;
  return (
    <section class="pubcves" aria-labelledby="pubcves-title">
      <h2 id="pubcves-title" class="pubcves__title">
        {unlinked.length === 1 ? "A public CVE credits you" : `${unlinked.length} public CVEs credit you`}
      </h2>
      <p class="pubcves__lead">Microsoft has published {unlinked.length === 1 ? "it" : "them"}, but MSRC hasn't tied {unlinked.length === 1 ? "it" : "them"} to one of your cases yet.</p>
      <ul class="pubcves__list">
        {unlinked.map(({ item, suggestion }) => (
          <PublicCveItem key={item.cve} item={item} guess={suggestion ? rows.find((r) => r.reportNumber === suggestion) : undefined} rows={rows} onOpen={onOpen} />
        ))}
      </ul>
      {notMine}
    </section>
  );
}


function PublicCveItem({ item, guess, rows, onOpen }: { item: PublicCve; guess: RowRef | undefined; rows: RowRef[]; onOpen: (rn: string) => void }) {
  // Picking a case only selects it; the Link button links. (On Windows the
  // arrow keys fire `change` on a closed select.)
  const [pick, setPick] = useState("");
  const facts = cveFacts(item);
  return (
    <li class="pubcve">
      <div class="pubcve__head">
        <a class="pubcve__id" href={publicCveUrl(item.cve)} target="_blank" rel="noopener">
          {item.cve}
        </a>
        <span class="pubcve__name">{item.title}</span>
      </div>
      <p class="pubcve__meta">
        Published {releaseDay(item.releaseDate)}
        {facts ? `. ${facts}` : ""}
      </p>
      {guess && (
        <p class="pubcve__guess">
          Most likely your case{" "}
          <button type="button" class="link" onClick={() => onOpen(guess.reportNumber)}>
            {caseLabel(guess)}
          </button>
          : {guess.title}
        </p>
      )}
      <div class="pubcve__actions">
        {guess && (
          <button type="button" class="btn btn--primary" onClick={() => link(item.cve, guess.reportNumber as VulnId)}>
            Link to {caseLabel(guess)}
          </button>
        )}
        <label class="pubcve__pick">
          <span class="sr-only">Choose the case for {item.cve}</span>
          <select class="input input--sm" value={pick} onChange={(e) => setPick((e.target as HTMLSelectElement).value)}>
            <option value="">{guess ? "Another case…" : "Choose the case…"}</option>
            {rows.map((r) => (
              <option key={r.reportNumber} value={r.reportNumber}>
                {caseLabel(r)}: {r.title.length > 70 ? r.title.slice(0, 69) + "…" : r.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="btn" disabled={!pick} onClick={() => pick && link(item.cve, pick as VulnId)}>
          Link
        </button>
        <button type="button" class="btn" onClick={() => link(item.cve, null)}>
          Not mine
        </button>
      </div>
    </li>
  );
}

/** The CVE line on a case: public advisory details, and undo for a link the researcher made. */
export function PublicCveFacts({ entries, otherCves }: { entries: { item: PublicCve; by: "you" | "msrc" }[]; otherCves: string[] }) {
  if (entries.length === 0) return <>{otherCves.join(", ") || "—"}</>;
  const pubIds = new Set(entries.map((e) => e.item.cve));
  const rest = otherCves.filter((c) => !pubIds.has(c));
  return (
    <>
      {entries.map(({ item, by }) => (
        <span key={item.cve} class="pubfact">
          <a href={publicCveUrl(item.cve)} target="_blank" rel="noopener">
            {item.cve}
          </a>
          <span class="muted">
            {" "}
            published {releaseDay(item.releaseDate)}
            {cveFacts(item) ? `, ${cveFacts(item)}` : ""}
          </span>
          {by === "you" && (
            <button type="button" class="link pubfact__undo" onClick={() => link(item.cve, undefined)}>
              Unlink
            </button>
          )}
        </span>
      ))}
      {rest.length > 0 && <span class="pubfact">{rest.join(", ")}</span>}
    </>
  );
}
