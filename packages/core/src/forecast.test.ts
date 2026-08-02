import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { detectRecurringStreams, forecastCashflow } from "./forecast.js";

function tx(id: string, date: string, amount: number, cp: string): Tx {
  return { id, accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false };
}

test("amountCents stays an integer for an even occurrence count (median of two middles is rounded)", () => {
  const txs: Tx[] = [
    tx("1", "2026-03-25", -100.0, "Saas"), tx("2", "2026-04-25", -100.0, "Saas"),
    tx("3", "2026-05-25", -100.01, "Saas"), tx("4", "2026-06-25", -100.02, "Saas"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(1);
  // cents [10000,10000,10001,10002] -> median (10000+10001)/2 = 10000.5 -> round 10001
  expect(streams[0].amountCents).toBe(10001);
  expect(Number.isInteger(streams[0].amountCents)).toBe(true);
});

test("interval CV uses SAMPLE stddev: a jittery ~monthly stream (gaps 22 & 40) is rejected as too irregular", () => {
  // median gap 31 snaps to the 30-day band; amounts stable -> only the CV gate can reject.
  // sample CV = 12.73/31 ≈ 0.41 > 0.35 -> rejected (population CV would be 0.29 -> accepted).
  const txs: Tx[] = [
    tx("1", "2026-06-01", -100, "Jitter"),
    tx("2", "2026-06-23", -100, "Jitter"), // +22 days
    tx("3", "2026-08-02", -100, "Jitter"), // +40 days
  ];
  expect(detectRecurringStreams(txs)).toHaveLength(0);
});

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

test("roll-forward: monthly salary + rent projects the balance, no shortfall, ends above opening", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"), tx("2", "2026-05-25", 3000, "Werkgever"), tx("3", "2026-06-25", 3000, "Werkgever"),
    tx("4", "2026-04-01", -1000, "Verhuurder"), tx("5", "2026-05-01", -1000, "Verhuurder"), tx("6", "2026-06-01", -1000, "Verhuurder"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "ING", bank: "ING", entity: "BV1", currency: "EUR", balance: 5000 }];
  const { byEntity, consolidated } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBe(500000);
  expect(f.points).toHaveLength(13);
  expect(f.streams).toHaveLength(2);
  expect(f.shortfall).toBeNull();
  expect(f.points[12].projectedClosingCents!).toBeGreaterThan(f.openingCents!);
  expect(consolidated.openingCents).toBe(500000);
});

test("shortfall: a large recurring outflow against a small opening flags a breach date", () => {
  const txs: Tx[] = [tx("1", "2026-04-05", -2000, "Lening"), tx("2", "2026-05-05", -2000, "Lening"), tx("3", "2026-06-05", -2000, "Lening")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 1000 }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.shortfall).not.toBeNull();
  expect(f.shortfall!.balanceCents).toBeLessThan(0);
  expect(f.shortfall!.date >= "2026-07-01").toBe(true);
});

test("null opening (CSV-only) -> flow projected internally but closing/band null, no shortfall, drivers present", () => {
  const txs: Tx[] = [tx("1", "2026-04-25", 3000, "W"), tx("2", "2026-05-25", 3000, "W"), tx("3", "2026-06-25", 3000, "W")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: null }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBeNull();
  expect(f.points[0].projectedClosingCents).toBeNull();
  expect(f.shortfall).toBeNull();
  expect(f.streams.length).toBeGreaterThan(0);
  expect(f.drivers.length).toBeGreaterThan(0);
});

test("deterministic: identical JSON on repeated runs", () => {
  const txs: Tx[] = [tx("1", "2026-04-25", 3000, "W"), tx("2", "2026-05-25", 3000, "W"), tx("3", "2026-06-25", 3000, "W")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const a = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const b = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
