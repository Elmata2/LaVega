/**
 * The labelled fixture and runner used by the WS2.10 forecast-error
 * measurement (#290). Kept OUT of the test files so the baseline test and the
 * integration test share one fixture and one split without importing each
 * other's assertions.
 *
 * The fixture is `__fixtures__/forecast-commitments-vault.json`: a real-shaped
 * household with 12 months the forecast may see and 3 months of actuals it is
 * scored against. Real-shaped, not the owner's vault: the vault is local-first
 * and never enters the repo (ADR 0009).
 */
import { readFileSync } from "node:fs";
import type { Account, Tx } from "../model.js";
import type { Bill } from "../bills/model.js";
import { forecastCashflow } from "../forecast.js";
import {
  FORECAST_ERROR_HORIZON_DAYS,
  measureForecastError,
  type ForecastErrorReport,
  type ForecastRunner,
} from "./forecastError.js";

export type ForecastFixture = {
  note: string;
  asOf: string;
  horizonDays: number;
  accounts: Account[];
  bills: Bill[];
  txs: Tx[];
};

export const FORECAST_FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/forecast-commitments-vault.json", import.meta.url), "utf8"),
) as ForecastFixture;

/** The pre-#290 model: detected recurring streams plus the incidental baseline,
 *  no bills occurrences. This is the code path every existing consumer uses. */
export const streamsOnlyForecast: ForecastRunner = ({ txs, accounts, asOf, horizonDays }) =>
  forecastCashflow(txs, accounts, {
    asOf,
    horizonDays,
    bufferCents: 0,
    scheduledFlows: [],
    fxHistory: {},
    mode: "separate",
  }).consolidated;

/** The fixture split the measurement needs: what a forecast at `asOf` may see,
 *  and the actuals it is scored against. Exported so the integration test uses
 *  the same split and the same checkpoints. */
export function measureFixture(
  runForecast: ForecastRunner,
  fixture: ForecastFixture = FORECAST_FIXTURE,
): ForecastErrorReport {
  return measureForecastError({
    asOf: fixture.asOf,
    accounts: fixture.accounts,
    visibleTxs: fixture.txs.filter((tx) => tx.date <= fixture.asOf),
    actualTxs: fixture.txs,
    runForecast,
    horizonDays: fixture.horizonDays ?? FORECAST_ERROR_HORIZON_DAYS,
  });
}
