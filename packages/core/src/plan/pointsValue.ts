import { norm } from "../hash.js";

export type PointsValueRange = {
  lowCentsPerPoint: number;
  medianCentsPerPoint: number;
  highCentsPerPoint: number;
  examples: number;
} | null;

type Example = {
  programId: string;
  pointsSpent: number;
  cashPriceSavedCents: number;
};

/** Lowest, median, highest cents per point over the user's own examples. */
export function pointsValueRange(
  examples: readonly Example[],
  programId: string,
): PointsValueRange {
  const rates = examples
    .filter((e) => norm(e.programId) === norm(programId) && e.pointsSpent > 0)
    .map((e) => e.cashPriceSavedCents / e.pointsSpent)
    .sort((a, b) => a - b);
  if (rates.length === 0) return null;
  const mid = rates.length >> 1;
  const median = rates.length % 2 === 1 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
  return {
    lowCentsPerPoint: rates[0]!,
    medianCentsPerPoint: median,
    highCentsPerPoint: rates[rates.length - 1]!,
    examples: rates.length,
  };
}

