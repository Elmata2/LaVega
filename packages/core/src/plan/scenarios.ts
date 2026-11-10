import { PLAN_THRESHOLDS } from "./thresholds.js";

/* The ONE home of compound and annuity maths, and of "required monthly
 * saving". Integer cents in and out; rates are fractions (0.04 = 4%). */

/** Printed beside every table. */
export const SCENARIO_ASSUMPTIONS = {
  compounding: "monthly",
  contributions: "month-end",
  return: "constant",
  tax: "none",
  inflation: "none",
} as const;

const roundHalfUp = (x: number): number => Math.floor(x + 0.5);

/** Guards float noise (10000.0000000001 must not become 10001). */
const CEIL_EPSILON = 1e-6;

const monthlyRate = (annualRate: number): number => annualRate / 12;

/** Growth factor of one cent paid in at the start of n months. */
const growth = (annualRate: number, months: number): number =>
  (1 + monthlyRate(annualRate)) ** months;

/** FV of 1 cent paid at each month end for n months. */
const annuityFactor = (annualRate: number, months: number): number => {
  const i = monthlyRate(annualRate);
  return i === 0 ? months : (growth(annualRate, months) - 1) / i;
};

/** Annuity future value (callers clamp months; stays finite up to 1200), contributions at month end, rounded half-up once.
 *  months <= 0 or a non-positive contribution gives 0. */
export function futureValueCents(i: {
  monthlyCents: number;
  months: number;
  annualRate: number;
}): number {
  if (i.months <= 0 || i.monthlyCents <= 0) return 0;
  return roundHalfUp(i.monthlyCents * annuityFactor(i.annualRate, i.months));
}

/** The one definition of "required monthly saving".
 *  Callers pass an integer months = max(1, monthsBetween) per ruling P7 (a
 *  goal is past only when targetDate < asOf). months <= 0 returns null here,
 *  and so does any non-finite input or result (never NaN or Infinity). Saved money grows at the
 *  same rate. Rounded up to whole cents so the target is reached; 0 when
 *  already funded. */
export function requiredMonthlyCents(i: {
  targetCents: number;
  savedCents: number;
  months: number;
  annualRate: number;
}): number | null {
  if (!(i.months > 0) || ![i.targetCents, i.savedCents, i.annualRate, i.months].every(Number.isFinite)) return null;
  const gap = i.targetCents - Math.max(0, i.savedCents) * growth(i.annualRate, i.months);
  if (Number.isNaN(gap) || !Number.isFinite(growth(i.annualRate, i.months))) return null;
  if (gap <= 0) return 0;
  const cents = Math.ceil(gap / annuityFactor(i.annualRate, i.months) - CEIL_EPSILON);
  return Number.isFinite(cents) ? Math.max(0, cents) : null;
}

const TABLE_GROSS_RATES = [0.02, 0.04, 0.06] as const;
const TABLE_COSTS = [0.002, 0.015] as const;

/** The public table: 100 euro a month for 18 years. No inputs, no variants. */
export function publicScenarioTable(): {
  monthlyCents: 10000;
  years: 18;
  paidInCents: 2160000;
  grossRates: [0.02, 0.04, 0.06];
  costs: [0.002, 0.015];
  cells: { grossRate: number; costRate: number; endCents: number }[];
} {
  const cells = TABLE_GROSS_RATES.flatMap((grossRate) =>
    TABLE_COSTS.map((costRate) => ({
      grossRate,
      costRate,
      endCents: futureValueCents({
        monthlyCents: 10000,
        months: 18 * 12,
        annualRate: grossRate - costRate,
      }),
    })),
  );
  return {
    monthlyCents: 10000,
    years: 18,
    paidInCents: 2160000,
    grossRates: [0.02, 0.04, 0.06],
    costs: [0.002, 0.015],
    cells,
  };
}

/** One row per scenario rate (0, 2, 4, 6 percent). */
export function goalScenarioRows(i: {
  targetCents: number;
  savedCents: number;
  months: number;
}): { annualRate: number; requiredMonthlyCents: number | null }[] {
  return PLAN_THRESHOLDS.scenarioRates.map((annualRate) => ({
    annualRate,
    requiredMonthlyCents: requiredMonthlyCents({ ...i, annualRate }),
  }));
}

/** What a fall of fallPct percent would cost, in cents and in months of room.
 *  monthsOfRoom is rounded to 0.1; null when there is no positive room. */
export function lossIllustration(i: {
  amountCents: number;
  fallPct: 30;
  roomMiddleCents: number | null;
}): { lossCents: number; monthsOfRoom: number | null } {
  const lossCents = roundHalfUp((Math.max(0, i.amountCents) * i.fallPct) / 100);
  const room = i.roomMiddleCents;
  return {
    lossCents,
    monthsOfRoom: room !== null && room > 0 ? Math.round((lossCents / room) * 10) / 10 : null,
  };
}
