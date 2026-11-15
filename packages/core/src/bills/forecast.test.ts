import { describe, expect, test } from "vitest";
import type { Bill, BillDecisions, BillOccurrence } from "./model.js";
import type { Tx } from "../model.js";
import { EMPTY_BILL_DECISIONS } from "./model.js";
import { makeBillOccurrence } from "./occurrences.js";
import { billForecastProjection } from "./forecast.js";

/* WS2.10 (#290): bills occurrences become forecast drivers. These tests pin
 * the adapter's decisions (which stream a series claims, which occurrences are
 * projected, how confident the commitment is) on small hand-built vaults; the
 * error measurement lives in `plan/forecastError.integration.test.ts`. */

const AS_OF = "2026-09-01";

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "huur",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 125_000,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
    anchorDate: "2025-01-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
    accountKey: "betaal",
    merchant: "Woonstad Verhuur",
    ...overrides,
  };
}

function occurrence(
  series: Bill,
  dueOn: string,
  overrides: Partial<BillOccurrence> = {},
): BillOccurrence {
  return { ...makeBillOccurrence(series, { originalDueOn: dueOn, dueOn }), ...overrides };
}

function historyPayment(date: string, amount: number, counterparty = "Woonstad Verhuur"): Tx {
  return {
    id: `tx-${date}`,
    accountKey: "betaal",
    date,
    amount,
    currency: "EUR",
    counterparty,
    description: "Huur",
    category: "",
    manual: false,
  };
}

const accounts = [
  {
    key: "betaal",
    iban: "NL01",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 5000,
  },
];

const projections = (
  bills: Bill[],
  occurrences: BillOccurrence[],
  txs: Tx[],
  decisions?: BillDecisions,
) => billForecastProjection({ bills, occurrences, txs, accounts, asOf: AS_OF, decisions });

describe("commitments", () => {
  test("open future occurrences become dated commitments with the current amount", () => {
    const series = bill({ amountCents: 126_675 });
    const occurrences = [
      occurrence(series, "2026-09-01"),
      occurrence(series, "2026-10-01"),
      occurrence(series, "2026-11-01"),
    ];
    const txs = [
      historyPayment("2026-06-01", -1184),
      historyPayment("2026-07-01", -1184),
      historyPayment("2026-08-01", -1184),
    ];
    const projection = projections([series], occurrences, txs);
    const commitments = projection.commitments.filter((c) => c.label === "Huur");
    // The occurrence on asOf itself is already in the opening balance.
    expect(commitments.map((c) => c.dueDate)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(commitments.map((c) => c.amountCents)).toEqual([126_675, 126_675]);
    expect(commitments[0].confidence).toBe("high");
    expect(commitments[0].sign).toBe(-1);
    expect(commitments[0].entity).toBe("Prive");
  });

  test("a partially paid occurrence projects only the remaining amount", () => {
    const series = bill();
    const row = occurrence(series, "2026-10-01");
    const decisions: BillDecisions = {
      ...EMPTY_BILL_DECISIONS,
      matches: [
        {
          id: "m1",
          occurrenceId: row.id,
          billId: series.id,
          txId: "tx-1",
          amountCents: 50_000,
          currency: "EUR",
          source: "user",
          confidence: 1,
          decidedAt: "2026-09-20",
        },
      ],
    };
    const projection = projections([series], [row], [], decisions);
    expect(projection.commitments[0].amountCents).toBe(75_000);
  });

  test("income commitments keep their positive sign", () => {
    const salary = bill({
      id: "salaris",
      name: "Salaris",
      type: "income",
      direction: "in",
      amountCents: 380_000,
      merchant: "Brightwave Studio",
    });
    const row = occurrence(salary, "2026-09-25");
    const projection = projections([salary], [row], []);
    expect(projection.commitments[0].sign).toBe(1);
    expect(projection.commitments[0].label).toBe("Salaris");
  });

  test("a closed occurrence is not committed again", () => {
    const series = bill();
    const closed = occurrence(series, "2026-10-01", {
      status: "paid",
      paidOn: "2026-10-01",
      paidAmountCents: 125_000,
    });
    expect(projections([series], [closed], []).commitments).toEqual([]);
  });

  test("confidence comes from observed ledger history, capped at three cycles", () => {
    const series = bill();
    const row = occurrence(series, "2026-10-01");
    const one = projections([series], [row], [historyPayment("2026-08-01", -1250)]);
    expect(one.commitments[0].confidence).toBe("medium");
    const none = projections([series], [row], []);
    expect(none.commitments[0].confidence).toBe("low");
  });

  test("a non-EUR series is left out and counted", () => {
    const usd = bill({ id: "usd", currency: "USD" });
    const row = occurrence(usd, "2026-10-01");
    const projection = projections([usd], [row], []);
    expect(projection.commitments).toEqual([]);
    expect(projection.excludedCurrencyCount).toBe(1);
  });
});

describe("claiming detected streams", () => {
  const monthlyHistory = (counterparty: string, amount: number): Tx[] =>
    ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"].map((date) =>
      historyPayment(date, amount, counterparty),
    );

  test("an active series claims its detected stream so its extrapolated dates are not used", () => {
    const series = bill();
    const row = occurrence(series, "2026-10-01");
    const projection = projections([series], [row], monthlyHistory("Woonstad Verhuur", -1250));
    expect(projection.claimedStreams.map((c) => c.key)).toEqual(["woonstad verhuur|out"]);
    expect(projection.claimed[0].billId).toBe("huur");
  });

  test("a paused series claims its stream and has no commitment, so nothing projects", () => {
    const series = bill({ status: "paused" });
    const projection = projections([series], [], monthlyHistory("Woonstad Verhuur", -1250));
    expect(projection.claimedStreams).toHaveLength(1);
    expect(projection.commitments).toEqual([]);
    expect(projection.excludedBillIds).toEqual(["huur"]);
  });

  test("a declared series with no history claims nothing and still commits its dates", () => {
    const series = bill({ id: "zorg", name: "Zorgverzekering", merchant: "Delta Zorgverzekering" });
    const row = occurrence(series, "2026-09-15");
    const projection = projections([series], [row], []);
    expect(projection.claimedStreams).toEqual([]);
    expect(projection.commitments).toHaveLength(1);
    expect(projection.commitments[0].confidence).toBe("low");
  });

  test("a stream with no matching series stays unclaimed and keeps projecting", () => {
    const gym = bill({ id: "gym", name: "Sportschool", merchant: "Basic-Fit" });
    const projection = projections(
      [gym],
      [occurrence(gym, "2026-10-11")],
      monthlyHistory("Albert Heijn", -6420),
    );
    expect(projection.claimedStreams).toEqual([]);
    expect(projection.unclaimedStreamKeys).toEqual(["albert heijn|out"]);
  });

  test("a claimed stream's entity is the series account's entity", () => {
    const series = bill();
    const projection = projections(
      [series],
      [occurrence(series, "2026-10-01")],
      monthlyHistory("Woonstad Verhuur", -1250),
    );
    expect(projection.claimedStreams[0].entity).toBe("Prive");
  });
});
