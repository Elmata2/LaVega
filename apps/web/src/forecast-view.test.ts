import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { forecastCashflow } from "@lavega/core";
import { bannerState, isThinData, splitDrivers } from "./forecast-view";

/* forecast-view.ts's pure mapping helpers (bannerState, isThinData,
 * splitDrivers) drive Forecast.tsx's banner color/copy and the drivers
 * card's two-section split. Built on real forecastCashflow() output (not a
 * stubbed EntityForecast shape) so these tests mirror the exact scenarios
 * already pinned in packages/core/src/forecast.test.ts (shortfall / null
 * opening / no-shortfall roll-forward) — a change to the engine's field
 * values would be caught here too, not just a hand-rolled fixture. */

function tx(id: string, date: string, amount: number, cp: string): Tx {
  return { id, accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false };
}

test('bannerState: a real shortfall takes priority -> "shortfall"', () => {
  const txs: Tx[] = [tx("1", "2026-04-05", -2000, "Lening"), tx("2", "2026-05-05", -2000, "Lening"), tx("3", "2026-06-05", -2000, "Lening")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 1000 }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.shortfall).not.toBeNull();
  expect(bannerState(f)).toBe("shortfall");
});

test('bannerState: an unknown opening balance (CSV-only account) -> "unknown"', () => {
  const txs: Tx[] = [tx("1", "2026-04-25", 3000, "W"), tx("2", "2026-05-25", 3000, "W"), tx("3", "2026-06-25", 3000, "W")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: null }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBeNull();
  expect(bannerState(f)).toBe("unknown");
});

test('bannerState: a comfortable, known opening balance with no shortfall -> "none" (and splitDrivers partitions it)', () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"), tx("2", "2026-05-25", 3000, "Werkgever"), tx("3", "2026-06-25", 3000, "Werkgever"),
    tx("4", "2026-04-01", -1000, "Verhuurder"), tx("5", "2026-05-01", -1000, "Verhuurder"), tx("6", "2026-06-01", -1000, "Verhuurder"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "ING", bank: "ING", entity: "BV1", currency: "EUR", balance: 5000 }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.shortfall).toBeNull();
  expect(bannerState(f)).toBe("none");
  expect(isThinData(f)).toBe(false);

  const { inkomsten, uitgaven } = splitDrivers(f.drivers);
  expect(inkomsten.map((d) => d.label)).toEqual(["Werkgever"]);
  expect(uitgaven.map((d) => d.label)).toEqual(["Verhuurder"]);
});

test("isThinData: no transaction history at all -> no recurring streams detected -> true", () => {
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const { byEntity } = forecastCashflow([], accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.streams).toHaveLength(0);
  expect(isThinData(f)).toBe(true);
  // Thin data is an additional caveat, not a banner-color change: opening is
  // known and there's no shortfall, so the banner still reads "none".
  expect(bannerState(f)).toBe("none");
});

test("splitDrivers: partitions by sign and preserves each side's existing order", () => {
  const drivers = [
    { label: "Shopify payouts", sign: 1 as const, perWeekCents: 79_000 },
    { label: "Debiteuren", sign: 1 as const, perWeekCents: 184_000 },
    { label: "Huur", sign: -1 as const, perWeekCents: -51_000 },
    { label: "Loon", sign: -1 as const, perWeekCents: -143_000 },
  ];
  const { inkomsten, uitgaven } = splitDrivers(drivers);
  expect(inkomsten.map((d) => d.label)).toEqual(["Shopify payouts", "Debiteuren"]);
  expect(uitgaven.map((d) => d.label)).toEqual(["Huur", "Loon"]);
});

test("splitDrivers: an empty driver list partitions into two empty arrays", () => {
  expect(splitDrivers([])).toEqual({ inkomsten: [], uitgaven: [] });
});
