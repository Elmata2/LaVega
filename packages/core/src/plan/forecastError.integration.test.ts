import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EMPTY_BILL_DECISIONS } from "../bills/model.js";
import { billForecastProjection } from "../bills/forecast.js";
import { generateBillOccurrences } from "../bills/occurrences.js";
import { forecastCashflow } from "../forecast.js";
import type { EntityForecast } from "../forecast.js";
import fixtureJson from "./__fixtures__/forecast-commitments-vault.json";
import {
  measureFixture,
  type ForecastErrorReport,
  type ForecastFixture,
  type ForecastRunner,
} from "./forecastError.js";

const FORECAST_FIXTURE = fixtureJson as ForecastFixture;

/* WS2.10 acceptance, measured after the integration: bills occurrences become
 * forecast drivers. The baseline artifact beside this test was committed BEFORE
 * this change, so the comparison cannot be moved after the fact.
 *
 * The fixture and the split are the same ones the baseline used
 * (`forecastError.test.ts`): 12 months visible, 3 months actual, one household,
 * one consolidated scope. */

const AFTER_URL = new URL("./__fixtures__/forecast-error-integrated-290.json", import.meta.url);

/** The integrated runner: the SAME forecastCashflow call, plus the bills
 *  projection (commitments + claimed streams). Nothing else changes. */
export function billsAwareForecast(fixture: ForecastFixture = FORECAST_FIXTURE): {
  runner: ForecastRunner;
  projectionOf: (
    visibleTxs: import("../model.js").Tx[],
  ) => ReturnType<typeof billForecastProjection>;
} {
  // Occurrences are materialized exactly as the app does on unlock: the same
  // generator, the same asOf, with the six-month history the matcher half
  // enabled. The forecast only sees the rows that are still open.
  const occurrences = generateBillOccurrences(fixture.bills, [], fixture.asOf, {
    historyMonths: 12,
  }).occurrences;
  const projectionOf = (visibleTxs: import("../model.js").Tx[]) =>
    billForecastProjection({
      bills: fixture.bills,
      occurrences,
      txs: visibleTxs,
      decisions: EMPTY_BILL_DECISIONS,
      accounts: fixture.accounts,
      asOf: fixture.asOf,
      horizonDays: fixture.horizonDays,
    });
  const runner: ForecastRunner = ({ txs, accounts, asOf, horizonDays }) => {
    const projection = projectionOf(txs);
    return forecastCashflow(txs, accounts, {
      asOf,
      horizonDays,
      bufferCents: 0,
      scheduledFlows: [],
      fxHistory: {},
      mode: "separate",
      commitments: projection.commitments,
      claimedStreams: projection.claimedStreams,
    }).consolidated;
  };
  return { runner, projectionOf };
}

const baseline = JSON.parse(
  readFileSync(new URL("./__fixtures__/forecast-error-baseline-290.json", import.meta.url), "utf8"),
) as ForecastErrorReport;
const integrated = measureFixture(billsAwareForecast().runner, FORECAST_FIXTURE);
const projected = billsAwareForecast().projectionOf(
  FORECAST_FIXTURE.txs.filter((tx) => tx.date <= FORECAST_FIXTURE.asOf),
);

describe("bills occurrences as forecast drivers (#290)", () => {
  test("the integrated measurement improves every checkpoint and is recorded", () => {
    if (process.env.WRITE_FORECAST_INTEGRATED === "1") {
      writeFileSync(AFTER_URL, JSON.stringify(integrated, null, 2) + "\n");
    }
    const artifact = JSON.parse(readFileSync(AFTER_URL, "utf8")) as ForecastErrorReport;
    expect(integrated).toEqual(artifact);
    for (const checkpoint of integrated.checkpoints) {
      const before = baseline.checkpoints.find((c) => c.label === checkpoint.label);
      expect(before?.absoluteErrorCents).not.toBeNull();
      expect(checkpoint.absoluteErrorCents).not.toBeNull();
      expect(checkpoint.absoluteErrorCents as number).toBeLessThanOrEqual(
        before?.absoluteErrorCents as number,
      );
    }
    expect(integrated.totalAbsoluteErrorCents as number).toBeLessThanOrEqual(
      baseline.totalAbsoluteErrorCents as number,
    );
  });

  test("the gain is explained by occurrence dates and amounts, not tuning", () => {
    // A paused series has no future occurrence dates, so its still-detected
    // stream is claimed and suppressed instead of projecting EUR 29,95 four
    // more times.
    const paused = projected.claimed.find((c) => c.billId === "sportschool");
    expect(paused?.billStatus).toBe("paused");
    expect(FORECAST_FIXTURE.bills.find((b) => b.id === "sportschool")?.status).toBe("paused");
    // A declared series whose first payment is in the future has no history to
    // detect: only its occurrence dates can put it in the line.
    const declared = projected.commitments.filter((c) => c.label === "Zorgverzekering");
    expect(declared.map((c) => c.dueDate)).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    expect(declared[0].confidence).toBe("low");
    // The energy price rose at the origin; the commitment carries the series'
    // current amount, not the history's stale median.
    const energy = projected.commitments.filter((c) => c.label === "Energie");
    expect(energy.map((c) => c.amountCents)).toEqual([12675, 12675, 12675]);
    expect(energy[0].confidence).toBe("high");
    // Calendar due dates, not the detector's 30-day stepping from the last
    // actual payment (the phone bill is due on the 30th).
    const phone = projected.commitments.filter((c) => c.label === "Telefoon");
    expect(phone.map((c) => c.dueDate)).toEqual(["2026-09-30", "2026-10-30", "2026-11-30"]);
    // The rent's dates are calendar months too.
    const rent = projected.commitments.filter((c) => c.label === "Huur");
    expect(rent.map((c) => c.dueDate)).toEqual(["2026-10-01", "2026-11-01"]);
  });

  test("a claimed stream is never projected as well as its commitments", () => {
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
        commitments: projected.commitments,
        claimedStreams: projected.claimedStreams,
      },
    ).consolidated;
    // The paused gym's stream exists but is not projected, and it is not in the
    // drivers either: its money is simply absent.
    expect(forecast.streams.some((s) => s.counterparty.toLowerCase().includes("basic-fit"))).toBe(
      true,
    );
    expect(forecast.drivers.some((d) => d.label.toLowerCase().includes("basic-fit"))).toBe(false);
    expect(forecast.basis?.claimedStreams).toBe(projected.claimedStreams.length);
    expect(forecast.basis?.commitmentsProjected).toBe(projected.commitments.length);
    // A bills driver carries its committed dates and confidence.
    const zorg = forecast.drivers.find((d) => d.label === "Zorgverzekering");
    expect(zorg?.source).toBe("commitment");
    expect(zorg?.dates).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    expect(zorg?.commitmentConfidence).toBe("low");
    const energieDriver = forecast.drivers.find((d) => d.label === "Energie");
    expect(energieDriver?.commitmentConfidence).toBe("high");
  });

  test("the baseline model is unchanged when no commitments are passed", () => {
    // Passing nothing is exactly the pre-#290 call, so old callers keep the old
    // numbers (and the old output shape, which only gained optional fields).
    const streamsOnly = measureFixture(
      ({ txs, accounts, asOf, horizonDays }) =>
        forecastCashflow(txs, accounts, {
          asOf,
          horizonDays,
          bufferCents: 0,
          scheduledFlows: [],
          fxHistory: {},
          mode: "separate",
        }).consolidated,
      FORECAST_FIXTURE,
    );
    expect(streamsOnly).toEqual(baseline);
  });
});
