import type { ComponentChildren } from "preact";
import { bountyLabel, formatUsd } from "../../core/awards";
import { humanizeEnum } from "../../core/derive";
import type { CaseRow } from "../data";
import { CaseCvss } from "./CaseCvss";
import { Markdown } from "./Markdown";
import { PublicCveFacts } from "./PublicCves";

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function Fact({ label, children }: { label: string; children: ComponentChildren }) {
  return <div class="case-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function TechnicalFact({ label, children }: { label: string; children: ComponentChildren }) {
  return <div class="case-fact case-fact--technical"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function CaseFacts({ row }: { row: CaseRow }) {
  const d: Record<string, unknown> = row.record.detail ?? {};
  const list = row.record.list;
  const impact = [text(d["severity"]) || list.severity, text(d["securityImpact"]) || list.securityImpact]
    .filter(Boolean).map(humanizeEnum).join(", ");
  const bounty = d["bounty"] as Record<string, unknown> | null | undefined;
  const amount = typeof bounty?.["amount"] === "number" && bounty["amount"] > 0 ? formatUsd(bounty["amount"]) : "";
  const awardStatus = text(bounty?.["status"]) || list.bountyStatus;
  const awardProgram = text(bounty?.["program"]);
  const award = !!(amount || awardProgram || (awardStatus && awardStatus !== "NONE"));
  const related = text(d["variantOrRelatedCVE"]);
  const vector = text(d["cvssVectorString"]);
  const weaknesses = Array.isArray(d["cweList"]) ? d["cweList"].map(text).filter(Boolean) : [text(d["cweList"])].filter(Boolean);
  const targets = Array.isArray(d["targetList"])
    ? d["targetList"].flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const product = text(item["product"]);
        const version = text(item["productVersion"]);
        return product || version ? [{ product, version }] : [];
      })
    : [];
  const target = text(d["target"]) || text(list.raw["target"]);
  const version = text(d["targetVersion"]) || text(list.raw["targetVersion"]);
  const products = targets.length ? targets : target || version ? [{ product: target, version }] : [];
  const unread = d["unreadMessageCount"] ?? list.unreadMessageCount;
  const hasUnread = typeof unread === "number" && unread > 0;
  const crossTenant = d["hasCrossTenantImpact"];
  const canary = d["devChannelRepro"];
  const hasFacts = impact || row.points > 0 || hasUnread || crossTenant != null || canary != null;
  const hasCvss = !!vector || row.advisoryCves.length > 0;
  const hasTechnical = row.cves.length || related || products.length || weaknesses.length || hasCvss;

  return (
    <section class="case-context__card case-facts" aria-labelledby="case-facts-title">
      <h2 id="case-facts-title">Case details</h2>
      {hasFacts && (
        <dl class="case-facts__rows">
          {impact && <Fact label="Severity / impact">{impact}</Fact>}
          {row.points > 0 && <Fact label="Recognition points">{row.points} pts</Fact>}
          {crossTenant != null && <Fact label="Cross-tenant impact">{humanizeEnum(String(crossTenant))}</Fact>}
          {canary != null && <Fact label="Windows Insider Canary reproduction">{humanizeEnum(String(canary))}</Fact>}
          {hasUnread && <Fact label="Unread in portal">{unread}</Fact>}
        </dl>
      )}
      {award && (
        <div class="case-facts__award">
          <h3>Bounty</h3>
          <p class="case-facts__award-value">
            {amount && <strong>{amount}</strong>}
            {awardStatus && <span>{bountyLabel(awardStatus)}</span>}
          </p>
          {awardProgram && <p class="case-facts__award-program">{awardProgram}</p>}
        </div>
      )}
      {hasTechnical ? (
        <dl class="case-facts__tech">
          {(row.cves.length > 0 || related) && (
            <TechnicalFact label="CVE">
              {row.cves.length > 0 && <PublicCveFacts entries={row.publicCves} otherCves={row.cves} />}
              {related && <span class="pubfact muted">Related CVE in your report: {related}</span>}
            </TechnicalFact>
          )}
          {products.length > 0 && (
            <TechnicalFact label="Products">
              <ul class="case-facts__products">
                {products.map(({ product, version: build }, index) => {
                  const label = product === product.toUpperCase() ? humanizeEnum(product) : product;
                  const alreadyNamed = label && build.toLocaleLowerCase().startsWith(`${label.toLocaleLowerCase()} `);
                  return (
                    <li key={index}>
                      {label && !alreadyNamed && <b>{label}</b>}
                      {build && <Markdown class="case-facts__version" src={build} />}
                    </li>
                  );
                })}
              </ul>
            </TechnicalFact>
          )}
          {weaknesses.length > 0 && (
            <TechnicalFact label="CWE"><ul class="case-facts__weaknesses">{weaknesses.map((cwe, index) => <li key={index}>{cwe}</li>)}</ul></TechnicalFact>
          )}
          {hasCvss && (
            <TechnicalFact label="CVSS">
              <CaseCvss vector={vector} cves={row.advisoryCves} cached={row.publicCves.map(({ item }) => item)} />
            </TechnicalFact>
          )}
        </dl>
      ) : !hasFacts && !award && <p class="case-empty">Case details will appear here as MSRC records them.</p>}
    </section>
  );
}
