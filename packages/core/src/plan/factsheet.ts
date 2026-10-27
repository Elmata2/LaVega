import { Schema } from "effect";
import { hash } from "../hash.js";
import type { FigureUnit, PlanFact, Polarity, SectionId } from "./types.js";

export const PLAN_ENGINE_VERSION = "plan-2";

/** Thrown when facts break the FactSheet contract (a factId that could carry a
 *  raw key, free text in `exact`, or a duplicate factId). A programming
 *  defect, not a user-data condition: callers do not catch it. */
export class FactSheetError extends Schema.TaggedError<FactSheetError>()("FactSheetError", {
  message: Schema.String,
}) {}

const FACT_ID = /^[a-z0-9_:-]+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type FactSheetFact = {
  factId: string;
  /** Browser-only: lets the AI layer group returned sentences by section. */
  section: SectionId | null;
  exact: number | string;
  bucket: string;
  unit: FigureUnit;
  polarity: Polarity;
  trend?: PlanFact["trend"];
  range?: PlanFact["range"];
  mustMention: boolean;
  derivedFrom?: string[];
};

export type FactSheet = {
  id: string;
  taskType: "plan" | "digest" | "note";
  locale: "nl" | "en";
  engineVersion: string;
  generatedAt: string;
  hash: string;
  facts: FactSheetFact[];
};

/** Upper bounds (exclusive) with their label, in order; the last row catches the rest. */
type Band = readonly [upper: number, label: string];

const CENTS_POSITIVE: readonly Band[] = [
  [250_00, "0-250"],
  [500_00, "250-500"],
  [1_000_00, "500-1k"],
  [2_500_00, "1k-2.5k"],
  [5_000_00, "2.5k-5k"],
  [10_000_00, "5k-10k"],
  [Infinity, "10k+"],
];
const PCT_POINTS: readonly Band[] = [
  [1, "0-1"],
  [2, "1-2"],
  [3, "2-3"],
  [5, "3-5"],
  [10, "5-10"],
  [Infinity, "10+"],
];
const MONTHS: readonly Band[] = [
  [1, "<1"],
  [3, "1-3"],
  [6, "3-6"],
  [Infinity, "6+"],
];
const YEARS: readonly Band[] = [
  [1, "<1"],
  [3, "1-3"],
  [10, "3-10"],
  [Infinity, "10+"],
];

const band = (table: readonly Band[], x: number): string => table.find(([upper]) => x < upper)![1];

const num = (exact: number | string): number | null =>
  typeof exact === "number" && Number.isFinite(exact) ? exact : null;

/** Coarse bucket for an exact figure, the only form of a number the AI layer
 *  may paraphrase. Table-driven: each boundary is a data row. */
export function bucketOf(unit: FigureUnit, exact: number | string): string {
  if (unit === "date") {
    const m = /^(\d{4})-(\d{2})/.exec(String(exact));
    return m === null ? "unknown" : `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
  }
  const x = num(exact);
  if (x === null) return "unknown";
  switch (unit) {
    case "cents":
      return x < 0 ? "<0" : band(CENTS_POSITIVE, x);
    case "months":
      return x < 0 ? "<0" : band(MONTHS, x);
    case "years":
      return x < 0 ? "<0" : band(YEARS, x);
    case "count":
      return x < 0 ? "<0" : !Number.isInteger(x) ? "unknown" : x <= 5 ? String(x) : "6+";
    case "ratio": {
      // A fraction (0.25 = 25%). Round first so 0.99999999995 stays below 1.
      const r = Math.round(x * 1e6) / 1e6;
      if (r < 0) return "<0";
      if (r >= 1) return "1.0+";
      const lo = Math.floor(r * 10 + 1e-9) / 10;
      return `${lo.toFixed(1)}-${(lo + 0.1).toFixed(1)}`;
    }
    case "pct":
      // Percentage points (2.5 = 2.5%).
      return x < 0 ? "<0" : band(PCT_POINTS, x);
  }
}

export function buildFactSheet(
  facts: PlanFact[],
  ctx: {
    locale: "nl" | "en";
    asOf: string;
    taskType?: "plan" | "digest" | "note";
  },
): FactSheet {
  const taskType = ctx.taskType ?? "plan";
  const seen = new Set<string>();
  for (const f of facts) {
    if (!FACT_ID.test(f.factId)) {
      throw new FactSheetError({
        message: `factId not allowed: ${JSON.stringify(f.factId)}`,
      });
    }
    if (seen.has(f.factId)) {
      throw new FactSheetError({ message: `duplicate factId: ${f.factId}` });
    }
    seen.add(f.factId);
    if (typeof f.exact === "string" && !(f.unit === "date" && ISO_DAY.test(f.exact))) {
      throw new FactSheetError({
        message: `string exact only for dates: ${f.factId}`,
      });
    }
  }
  const sorted = [...facts].sort((a, b) => (a.factId < b.factId ? -1 : 1));
  const out: FactSheetFact[] = sorted.map((f) => ({
    factId: f.factId,
    section: f.section,
    exact: f.exact,
    bucket: bucketOf(f.unit, f.exact),
    unit: f.unit,
    polarity: f.polarity,
    ...(f.trend === undefined ? {} : { trend: f.trend }),
    ...(f.range === undefined ? {} : { range: f.range }),
    mustMention: f.mustMention,
    ...(f.derivedFrom === undefined ? {} : { derivedFrom: f.derivedFrom }),
  }));
  const h = hash(
    JSON.stringify(out.map((f) => [f.factId, f.exact, f.polarity, f.mustMention, f.bucket])) +
      PLAN_ENGINE_VERSION +
      ctx.locale +
      taskType,
  );
  return {
    id: `fs-${h}`,
    taskType,
    locale: ctx.locale,
    engineVersion: PLAN_ENGINE_VERSION,
    generatedAt: ctx.asOf,
    hash: h,
    facts: out,
  };
}
