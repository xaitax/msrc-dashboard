import { useEffect, useState } from "preact/hooks";
import { fetchPublicCve } from "../../background/api";
import { cvssRating, scoreCvss } from "../../core/cvss";
import { publicCveFrom, publicCveUrl, type PublicCve } from "../../core/publicCves";

function Vector({ value }: { value: string }) {
  return (
    <code class="case-facts__vector">
      {value.split("/").map((part, index) => <span key={index}>{index > 0 && <><wbr />/</>}{part}</span>)}
    </code>
  );
}

function Scores({ base, temporal, environmental }: { base?: number; temporal?: number; environmental?: number }) {
  const scores = [["Base", base], ["Temporal", temporal], ["Environmental", environmental]] as const;
  if (scores.every(([, score]) => score === undefined)) return null;
  return (
    <dl class="case-cvss__scores">
      {scores.map(([label, score]) => score === undefined ? null : (
        <div key={label}>
          <dt>{label}</dt>
          <dd><strong>{score.toFixed(1)}</strong>{label === "Base" && <span>{cvssRating(score)}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function numericScore(value: string | null | undefined): number | undefined {
  return value && /^(?:[0-9](?:\.\d)?|10(?:\.0)?)$/.test(value) ? Number(value) : undefined;
}

function PublishedAssessment({ cve, cached }: { cve: string; cached?: PublicCve }) {
  const [result, setResult] = useState<PublicCve | "empty" | "failed" | null>(null);
  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const advisory = await fetchPublicCve(cve);
        if (current) setResult(advisory ? publicCveFrom({ cveNumber: cve }, advisory) ?? "empty" : "empty");
      } catch {
        if (current) setResult("failed");
      }
    }
    void load();
    return () => { current = false; };
  }, [cve]);

  const advisory = typeof result === "object" ? result ?? cached : cached;
  const base = numericScore(advisory?.baseScore);
  const temporal = numericScore(advisory?.temporalScore);
  const hasAssessment = base !== undefined || temporal !== undefined || !!(advisory?.severity || advisory?.vector || advisory?.exploitability);
  const status = result === "failed" ? "Microsoft advisory lookup failed." : result === "empty" ? "Microsoft’s public API returned no advisory." : result === null ? "Checking Microsoft’s advisory…" : "Microsoft’s advisory has no CVSS assessment.";
  return (
    <div class="case-cvss__assessment">
      <p class="case-cvss__source">
        <span>Microsoft advisory</span>
        <a href={publicCveUrl(cve)} target="_blank" rel="noopener">{cve}</a>
      </p>
      {hasAssessment ? (
        <>
          {advisory?.severity && <p class="case-cvss__severity">Microsoft severity <strong>{advisory.severity}</strong></p>}
          <Scores base={base} temporal={temporal} />
          {advisory?.exploitability && <p class="case-cvss__exploitability">{advisory.exploitability}</p>}
          {advisory?.vector && <Vector value={advisory.vector} />}
        </>
      ) : <p class="case-cvss__status" role="status">{status}</p>}
    </div>
  );
}

export function CaseCvss({ vector, cves, cached }: { vector: string; cves: string[]; cached: PublicCve[] }) {
  const scores = vector ? scoreCvss(vector) : null;
  return (
    <div class="case-cvss">
      {vector && (
        <div class="case-cvss__assessment">
          <p class="case-cvss__source">Report vector</p>
          {scores && <Scores base={scores.base} temporal={scores.temporal ?? undefined} environmental={scores.environmental ?? undefined} />}
          <Vector value={vector} />
        </div>
      )}
      {cves.map((cve) => <PublishedAssessment key={cve} cve={cve} cached={cached.find((item) => item.cve === cve)} />)}
    </div>
  );
}
