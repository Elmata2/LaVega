import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { forecastCashflow } from "../forecast.js";
import type { EntityForecast } from "../forecast.js";

/* WS2.10 acceptance, measured: forecast absolute error at the 30/60/90-day
 * checkpoints against the pre-integration baseline.
 *
 * The baseline artifact `__fixtures__/forecast-error-baseline-290.json` was
 * measured and committed BEFORE bills occurrences became forecast drivers, so
 * this test cannot quietly move the goalposts it compares against. The
 * integrated measurement lives beside it in `forecastError.integration.test.ts`.
 *
 * Fixture: `__fixtures__/forecast-commitments-vault.json`, a real-shaped
 * household: 12 months of visible history, 3 months of actual future, rent,
 * energy (a price change at the origin), Netflix (books a day late), a phone
 * bill on the 30th, a student loan, salary, a gym paused before the origin
 * whose detected stream still projects, a newly declared health-insurance bill
 * with no history, and a yearly insurance outside the horizon. It copies the
 * shape of the owner's real ING data, not the data: the owner's vault is
 * local-first and never enters the repo (ADR 0009). */

import { FORECAST_FIXTURE, measureFixture, streamsOnlyForecast } from "./forecastErrorFixture.js";
import type { ForecastErrorReport } from "./forecastError.js";

const BASELINE_URL = new URL("./__fixtures__/forecast-error-baseline-290.json", import.meta.url);

describe("forecast error baseline (#290)", () => {
  const measured = measureFixture(streamsOnlyForecast);

  test("the fixture really hides its future from the forecast", () => {
    const visible = FORECAST_FIXTURE.txs.filter((tx) => tx.date <= FORECAST_FIXTURE.asOf);
    expect(visible.length).toBeGreaterThan(150);
    expect(visible.some((tx) => tx.date > FORECAST_FIXTURE.asOf)).toBe(false);
    expect(FORECAST_FIXTURE.txs.some((tx) => tx.date > FORECAST_FIXTURE.asOf)).toBe(true);
  });

  test("the measured baseline matches the artifact committed before integration", () => {
    if (process.env.WRITE_FORECAST_BASELINE === "1") {
      writeFileSync(BASELINE_URL, JSON.stringify(measured, null, 2) + "\n");
    }
    const baseline = JSON.parse(readFileSync(BASELINE_URL, "utf8")) as ForecastErrorReport;
    expect(measured).toEqual(baseline);
    // A measurement with no opening balance or no checkpoint is not a baseline.
    expect(measured.openingCents).not.toBeNull();
    expect(measured.checkpoints.map((c) => c.label)).toEqual(["30d", "60d", "90d"]);
    expect(measured.totalAbsoluteErrorCents).not.toBeNull();
  });

  test("the baseline forecast projects detected streams, not bills occurrences", () => {
    const forecast: EntityForecast = forecastCashflow(
      FORECAST_FIXTURE.txs.filter((tx) => tx.date <= FORECAST_FIXTURE.asOf),
      FORECAST_FIXTURE.accounts,
      {
        asOf: FORECAST_FIXTURE.asOf,
        horizonDays: FORECAST_FIXTURE.horizonDays,
        bufferCents: 0,
        scheduledFlows: [],
        fxHistory: {},
        mode: "separate",
      },
    ).consolidated;
    const labels = forecast.streams.map((s) => s.counterparty.toLowerCase());
    // The paused gym and the never-seen new bill are where the baseline is
    // wrong, and both are visible in the detected-stream list.
    expect(labels.some((l) => l.includes("basic-fit"))).toBe(true);
    expect(labels.some((l) => l.includes("delta"))).toBe(false);
  });
});
