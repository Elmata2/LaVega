/**
 * Forecast-error measurement for issue #290 (WS2.10).
 *
 * The plan's acceptance evidence is measured, not asserted: the forecast's
 * absolute error at the 30/60/90-day checkpoints, before and after bills
 * occurrences become drivers. This module is the ruler. It is pure and
 * clock-free (`asOf` is a parameter), reads no storage, and is exported so the
 * owner and a future CI job can re-run the same measurement.
 *
 * HOW THE MEASUREMENT WORKS
 *
 * A labelled, real-shaped vault fixture holds both the visible past and the
 * actual future. At `asOf` the forecast may see ONLY transactions dated on or
 * before `asOf`; everything after it is the actuals the projection is scored
 * against. The opening balance is the fixture accounts' balance at `asOf`.
 *
 * The projected closing for a checkpoint is the forecast's own weekly point
 * (the forecast emits weekly closes; the 30/60/90-day checkpoints are the
 * weekly closes on day 28, 56 and 84). The actual closing on that same date is
 * `opening + sum(actual transactions in (asOf, checkpointDate])`. Error is the
 * signed difference and its absolute value, in integer cents.
 *
 * Why not measure at exactly 30/60/90 days: the forecast's public contract is
 * weekly closing points, and inventing a daily point here would measure a
 * different model than the owner sees. The checkpoint labels stay 30/60/90
 * (the plan's words) and the artifact records the exact date of each close.
 *
 * The fixture is real-shaped, not the owner's vault: the vault is local-first
 * and never enters the repo (ADR 0009). See `__fixtures__/forecast-commitments-vault.json`.
 */
import type { Account, Tx } from "../model.js";
import type { EntityForecast } from "../forecast.js";

/** The three plan checkpoints, and the weekly close that represents each. */
export const FORECAST_ERROR_CHECKPOINTS: ReadonlyArray<{
  label: "30d" | "60d" | "90d";
  horizonDays: number;
  /** 1-based week index the forecast emits a point for (days / 7). */
  week: number;
}> = [
  { label: "30d", horizonDays: 30, week: 4 },
  { label: "60d", horizonDays: 60, week: 8 },
  { label: "90d", horizonDays: 90, week: 12 },
];

/** The default forecast horizon: enough to cover the 90-day checkpoint. */
export const FORECAST_ERROR_HORIZON_DAYS = 91;

export type ForecastErrorCheckpoint = {
  label: "30d" | "60d" | "90d";
  /** The plan's horizon label in days (30/60/90). */
  horizonDays: number;
  /** The date of the weekly close that stands in for it. */
  date: string;
  projectedCents: number | null;
  actualCents: number;
  /** projected - actual; null when no projection exists. */
  signedErrorCents: number | null;
  absoluteErrorCents: number | null;
};

export type ForecastErrorReport = {
  asOf: string;
  /** The consolidated scope is the household total; there is no per-entity
   *  fixture here (the bills side is personal, one entity). */
  scope: string;
  openingCents: number | null;
  checkpoints: ForecastErrorCheckpoint[];
  /** Sum of the absolute errors of the three checkpoints; null if any is null. */
  totalAbsoluteErrorCents: number | null;
};

export type ForecastRunner = (input: {
  txs: Tx[];
  accounts: Account[];
  asOf: string;
  horizonDays: number;
}) => EntityForecast;

/** Sum the actual net movement between `asOf` (exclusive) and `date`
 *  (inclusive), in integer cents, in the ledger's own EUR convention. */
function actualMovementCents(actualTxs: readonly Tx[], asOf: string, date: string): number {
  let cents = 0;
  for (const tx of actualTxs) {
    if (tx.date <= asOf || tx.date > date) continue;
    cents += Math.round(tx.amount * 100);
  }
  return cents;
}

/**
 * Score one forecast against the actual future.
 *
 * `visibleTxs` is exactly what the forecast may see (the caller filters; this
 * function never peeks). `actualTxs` is the full ledger including the future.
 * `runForecast` decides what model is under test: the pre-#290 baseline passes
 * the streams-only call, the integrated model passes the bills projections.
 */
export function measureForecastError(input: {
  asOf: string;
  accounts: readonly Account[];
  visibleTxs: readonly Tx[];
  actualTxs: readonly Tx[];
  runForecast: ForecastRunner;
  horizonDays?: number;
}): ForecastErrorReport {
  const asOf = input.asOf;
  const horizonDays = input.horizonDays ?? FORECAST_ERROR_HORIZON_DAYS;
  const forecast = input.runForecast({
    txs: [...input.visibleTxs],
    accounts: input.accounts.map((account) => ({ ...account })),
    asOf,
    horizonDays,
  });
  const openingCents = forecast.openingCents;

  const checkpoints: ForecastErrorCheckpoint[] = [];
  for (const checkpoint of FORECAST_ERROR_CHECKPOINTS) {
    const point = forecast.points.find((p) => indexOfDay(p.date, asOf) === checkpoint.week * 7);
    const date = point?.date ?? null;
    if (date == null) {
      checkpoints.push({
        label: checkpoint.label,
        horizonDays: checkpoint.horizonDays,
        date: "",
        projectedCents: null,
        actualCents: 0,
        signedErrorCents: null,
        absoluteErrorCents: null,
      });
      continue;
    }
    const projectedCents = point?.projectedClosingCents ?? null;
    const movement = actualMovementCents(input.actualTxs, asOf, date);
    const actualCents = (openingCents ?? 0) + movement;
    const signedErrorCents = projectedCents == null ? null : projectedCents - actualCents;
    checkpoints.push({
      label: checkpoint.label,
      horizonDays: checkpoint.horizonDays,
      date,
      projectedCents,
      actualCents,
      signedErrorCents,
      absoluteErrorCents: signedErrorCents == null ? null : Math.abs(signedErrorCents),
    });
  }

  const totalAbsoluteErrorCents = checkpoints.every((c) => c.absoluteErrorCents != null)
    ? checkpoints.reduce((sum, c) => sum + (c.absoluteErrorCents as number), 0)
    : null;

  return {
    asOf,
    scope: forecast.scope,
    openingCents,
    checkpoints,
    totalAbsoluteErrorCents,
  };
}

/** Whole days from `from` to `to`, ISO dates, via UTC parts (no `new Date(str)`). */
function indexOfDay(to: string, from: string): number {
  const dayNumber = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return Math.round(dayNumber(to) - dayNumber(from));
}
