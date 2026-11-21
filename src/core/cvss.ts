// FIRST CVSS v3.x specification, sections 6–7 and appendix A.
const CIA = { N: 0, L: 0.22, H: 0.56 } as const;
const BASE = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: { N: 0.85, L: 0.62, H: 0.27 },
  UI: { N: 0.85, R: 0.62 },
  S: { U: 0, C: 1 },
  C: CIA,
  I: CIA,
  A: CIA,
} as const;
const TEMPORAL = {
  E: { X: 1, H: 1, F: 0.97, P: 0.94, U: 0.91 },
  RL: { X: 1, U: 1, W: 0.97, T: 0.96, O: 0.95 },
  RC: { X: 1, C: 1, R: 0.96, U: 0.92 },
} as const;
const REQUIREMENT = { X: 1, H: 1.5, M: 1, L: 0.5 } as const;
const ENVIRONMENTAL = {
  CR: REQUIREMENT, IR: REQUIREMENT, AR: REQUIREMENT,
  MAV: BASE.AV, MAC: BASE.AC, MPR: BASE.PR, MUI: BASE.UI,
  MS: BASE.S, MC: CIA, MI: CIA, MA: CIA,
} as const;
const METRICS: Readonly<Record<string, Readonly<Record<string, number>>>> = { ...BASE, ...TEMPORAL, ...ENVIRONMENTAL };
type BaseMetric = keyof typeof BASE;

export function cvssRating(score: number): string {
  if (score === 0) return "None";
  if (score < 4) return "Low";
  if (score < 7) return "Medium";
  return score < 9 ? "High" : "Critical";
}

function roundUp(score: number): number {
  return Math.ceil(Math.round(score * 100_000) / 10_000) / 10;
}

export function scoreCvss(vector: string): { base: number; temporal: number | null; environmental: number | null } | null {
  const [version, ...parts] = vector.trim().split("/");
  if (version !== "CVSS:3.0" && version !== "CVSS:3.1") return null;
  const values = new Map<string, string>();
  for (const part of parts) {
    const match = /^([A-Z]+):([A-Z])$/.exec(part);
    if (!match) return null;
    const metric = match[1]!;
    const value = match[2]!;
    if (!Object.hasOwn(METRICS, metric) || values.has(metric)) return null;
    const isDefault = value === "X" && Object.hasOwn(ENVIRONMENTAL, metric);
    if (!isDefault && !Object.hasOwn(METRICS[metric]!, value)) return null;
    values.set(metric, value);
  }
  if (Object.keys(BASE).some((metric) => !values.has(metric))) return null;

  const supplied = (metric: string) => values.has(metric) && values.get(metric) !== "X";
  const weight = (metric: string) => METRICS[metric]![values.get(metric) ?? "X"]!;
  const multiplier = weight("E") * weight("RL") * weight("RC");

  function baseFor(environmental: boolean): number {
    const value = (metric: BaseMetric) => {
      const modified = `M${metric}`;
      return values.get(environmental && supplied(modified) ? modified : metric)!;
    };
    const changed = value("S") === "C";
    const impactWeight = (metric: "C" | "I" | "A") =>
      CIA[value(metric) as keyof typeof CIA] * (environmental ? weight(`${metric}R`) : 1);
    const subscore = 1 - (1 - impactWeight("C")) * (1 - impactWeight("I")) * (1 - impactWeight("A"));
    const iss = environmental ? Math.min(subscore, 0.915) : subscore;
    const modifiedV31 = environmental && version === "CVSS:3.1";
    const changedImpact = 7.52 * (iss - 0.029) - 3.25 * (modifiedV31 ? (iss * 0.9731 - 0.02) ** 13 : (iss - 0.02) ** 15);
    const impact = changed ? changedImpact : 6.42 * iss;
    if (impact <= 0) return 0;
    const privilege = value("PR");
    const pr = changed ? { N: 0.85, L: 0.68, H: 0.5 }[privilege as keyof typeof BASE.PR] : BASE.PR[privilege as keyof typeof BASE.PR];
    const exploitability = 8.22 * BASE.AV[value("AV") as keyof typeof BASE.AV] * BASE.AC[value("AC") as keyof typeof BASE.AC] * pr * BASE.UI[value("UI") as keyof typeof BASE.UI];
    return roundUp(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
  }

  const base = baseFor(false);
  return {
    base,
    temporal: Object.keys(TEMPORAL).some(supplied) ? roundUp(base * multiplier) : null,
    environmental: Object.keys(ENVIRONMENTAL).some(supplied) ? roundUp(baseFor(true) * multiplier) : null,
  };
}
