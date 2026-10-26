import { monthsBetween } from "./months.js";
import type { RoomResult } from "./room.js";
import { CAPACITY_THRESHOLDS as T, MIN_CAPACITY_INPUTS } from "./thresholds.js";

export type CapacityInputs = {
  bufferMonths: number | null;
  roomShare: number | null;
  debtShare: number | null;
  horizonYears: number | null;
};

export type Points = 0 | 1 | 2;
export type CapacityScore = {
  score: 1 | 2 | 3 | 4 | 5 | null;
  parts: {
    buffer: Points | null;
    room: Points | null;
    debt: Points | null;
    horizon: Points | null;
  };
  missing: string[];
};

/** Months of fixed costs the savings cover; null when there are no fixed costs. */
export function bufferMonths(savingsCents: number, fixedCostsMonthlyCents: number): number | null {
  return fixedCostsMonthlyCents > 0 ? savingsCents / fixedCostsMonthlyCents : null;
}

/** Monthly debt payments: proposed debts plus user-stated ones.
 *  A debt with `monthlyCents: null` (a credit card) has no known fixed payment;
 *  it is skipped in the sum on purpose, not counted as zero by accident. */
export function debtPaymentsMonthly(
  proposed: readonly { data: { monthlyCents: number | null } }[],
  statedMonthlyCents: readonly number[] = [],
): number {
  let sum = 0;
  for (const p of proposed) if (p.data.monthlyCents !== null) sum += p.data.monthlyCents;
  for (const s of statedMonthlyCents) sum += s;
  return sum;
}

export function capacityInputs(i: {
  savingsCents: number;
  fixedCostsMonthlyCents: number;
  room: RoomResult;
  debtPaymentsMonthlyCents: number;
  goals: readonly { targetDate: string }[];
  asOf: string;
}): CapacityInputs {
  // Computed room: the median month's income. Stated room: the midpoint of the
  // stated income range, and the midpoint of the room range over it.
  const income =
    i.room.kind === "computed"
      ? i.room.middleIncomeCents
      : i.room.kind === "stated"
        ? i.room.incomeMidCents
        : 0;
  const hasIncome = income > 0;
  const roomMid =
    i.room.kind === "computed"
      ? i.room.middleCents
      : i.room.kind === "stated"
        ? (i.room.lowCents + i.room.highCents) / 2
        : 0;
  // A goal dated before asOf is already past; it must not give a negative horizon.
  const months = i.goals
    .filter((g) => g.targetDate >= i.asOf)
    .map((g) => monthsBetween(i.asOf, g.targetDate));
  return {
    bufferMonths: bufferMonths(i.savingsCents, i.fixedCostsMonthlyCents),
    roomShare: hasIncome ? roomMid / income : null,
    debtShare: hasIncome ? i.debtPaymentsMonthlyCents / income : null,
    horizonYears: months.length === 0 ? null : Math.min(...months) / 12,
  };
}

/** Points for a value against a [low, high] pair, higher is better. */
function higherIsBetter(v: number, [low, high]: readonly [number, number]): Points {
  if (v < low) return 0;
  return v <= high ? 1 : 2;
}

/** Room: below the first edge is 0, the first edge up to the second is 1 (both inclusive). */
const roomPoints = (v: number): Points => higherIsBetter(v, T.roomShare);

/** Debt: lower is better. Above the high edge 0, low..high inclusive 1, below low 2. */
function debtPoints(v: number): Points {
  const [low, high] = T.debtShare;
  if (v > high) return 0;
  return v >= low ? 1 : 2;
}

export function scoreCapacity(i: CapacityInputs): CapacityScore {
  const parts: CapacityScore["parts"] = {
    buffer: i.bufferMonths === null ? null : higherIsBetter(i.bufferMonths, T.bufferMonths),
    room: i.roomShare === null ? null : roomPoints(i.roomShare),
    debt: i.debtShare === null ? null : debtPoints(i.debtShare),
    horizon: i.horizonYears === null ? null : higherIsBetter(i.horizonYears, T.horizonYears),
  };
  const entries = Object.entries(parts) as [keyof typeof parts, Points | null][];
  const missing = entries.filter(([, p]) => p === null).map(([k]) => k);
  const present = entries.length - missing.length;
  if (present < MIN_CAPACITY_INPUTS) return { score: null, parts, missing };

  const raw = entries.reduce((s, [, p]) => s + (p ?? 0), 0);
  // With one input missing the best possible sum is 6 of 8, so scale by 8/6
  // before mapping; otherwise a missing input would always lower the score.
  const sum = present === entries.length ? raw : Math.round((raw * 8) / 6);
  const row = T.sumToScore.find((r) => sum <= r.max) ?? T.sumToScore[T.sumToScore.length - 1];
  return { score: row.score, parts, missing };
}

/** Capacity and tolerance two or more points apart disagree. */
export function capacityToleranceFlag(
  capacity: number | null,
  tolerance: number | null,
): "disagree" | "agree" | "unknown" {
  if (capacity === null || tolerance === null) return "unknown";
  return Math.abs(capacity - tolerance) >= 2 ? "disagree" : "agree";
}
