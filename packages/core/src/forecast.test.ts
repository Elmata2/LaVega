import { expect, test } from "vitest";
import type { Tx } from "./model.js";
import { detectRecurringStreams } from "./forecast.js";

function tx(id: string, date: string, amount: number, cp: string): Tx {
  return { id, accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false };
}

test("detects a monthly salary inflow (3 occurrences, ~30d cadence, stable amount)", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 2500, "Werkgever BV"),
    tx("2", "2026-05-25", 2500, "Werkgever BV"),
    tx("3", "2026-06-25", 2500, "Werkgever BV"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ sign: 1, cadenceDays: 30, amountCents: 250000, occurrences: 3, lastDate: "2026-06-25" });
});

test("detects a weekly outflow and separates it from an inflow of the same counterparty (sign in the key)", () => {
  const txs: Tx[] = [
    tx("1", "2026-06-01", -50, "Spar"), tx("2", "2026-06-08", -50, "Spar"), tx("3", "2026-06-15", -50, "Spar"),
    tx("4", "2026-06-02", 200, "Spar"), tx("5", "2026-06-09", 200, "Spar"), tx("6", "2026-06-16", 200, "Spar"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(2);
  expect(streams.find((s) => s.sign === -1)).toMatchObject({ cadenceDays: 7, amountCents: 5000 });
  expect(streams.find((s) => s.sign === 1)).toMatchObject({ cadenceDays: 7, amountCents: 20000 });
});

test("rejects fewer than 3 occurrences", () => {
  const txs: Tx[] = [tx("1", "2026-05-01", -100, "Rent"), tx("2", "2026-06-01", -100, "Rent")];
  expect(detectRecurringStreams(txs)).toHaveLength(0);
});

test("rejects irregular cadence (no snap band) and wildly variable amounts", () => {
  const irregular: Tx[] = [tx("1", "2026-06-01", -30, "X"), tx("2", "2026-06-03", -30, "X"), tx("3", "2026-06-20", -30, "X")];
  expect(detectRecurringStreams(irregular)).toHaveLength(0);
  const variable: Tx[] = [tx("1", "2026-04-01", -10, "Y"), tx("2", "2026-05-01", -500, "Y"), tx("3", "2026-06-01", -10, "Y")];
  expect(detectRecurringStreams(variable)).toHaveLength(0);
});
