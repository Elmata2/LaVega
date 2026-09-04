import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { forecastCashflow } from "@lavega/core";
import {
  bannerState,
  confidenceLabel,
  coverageNotes,
  hasBand,
  isThinData,
  splitDrivers,
} from "./forecast-view";

/* forecast-view.ts's pure mapping helpers (bannerState, isThinData,
 * splitDrivers) drive Forecast.tsx's banner color/copy and the drivers
 * card's two-section split. Built on real forecastCashflow() output (not a
 * stubbed EntityForecast shape) so these tests mirror the exact scenarios
 * already pinned in packages/core/src/forecast.test.ts (shortfall / null
 * opening / no-shortfall roll-forward) — a change to the engine's field
 * values would be caught here too, not just a hand-rolled fixture. */

function tx(id: string, date: string, amount: number, cp: string): Tx {
  return {
    id,
    accountKey: "A1",
    date,
    amount,
    currency: "EUR",
    counterparty: cp,
    description: "",
    category: "",
    manual: false,
  };
}

test('bannerState: a real shortfall takes priority -> "shortfall"', () => {
  const txs: Tx[] = [
    tx("1", "2026-04-05", -2000, "Lening"),
    tx("2", "2026-05-05", -2000, "Lening"),
    tx("3", "2026-06-05", -2000, "Lening"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 1000 },
  ];
  const { byEntity } = forecastCashflow(txs, accounts, {
    asOf: "2026-07-01",
    horizonDays: 91,
    bufferCents: 0,
  });
  const f = byEntity["BV1"];
  expect(f.shortfall).not.toBeNull();
  expect(bannerState(f)).toBe("shortfall");
});

test('bannerState: an unknown opening balance (CSV-only account) -> "unknown"', () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "W"),
    tx("2", "2026-05-25", 3000, "W"),
    tx("3", "2026-06-25", 3000, "W"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: null },
  ];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBeNull();
  expect(bannerState(f)).toBe("unknown");
});

test('bannerState: a comfortable, known opening balance with no shortfall -> "none" (and splitDrivers partitions it)', () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"),
    tx("2", "2026-05-25", 3000, "Werkgever"),
    tx("3", "2026-06-25", 3000, "Werkgever"),
    tx("4", "2026-04-01", -1000, "Verhuurder"),
    tx("5", "2026-05-01", -1000, "Verhuurder"),
    tx("6", "2026-06-01", -1000, "Verhuurder"),
  ];
  const accounts: Account[] = [
    {
      key: "A1",
      iban: "A1",
      name: "ING",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: 5000,
    },
  ];
  const { byEntity } = forecastCashflow(txs, accounts, {
    asOf: "2026-07-01",
    horizonDays: 91,
    bufferCents: 0,
  });
  const f = byEntity["BV1"];
  expect(f.shortfall).toBeNull();
  expect(bannerState(f)).toBe("none");
  expect(isThinData(f)).toBe(false);

  const { inkomsten, uitgaven } = splitDrivers(f.drivers);
  expect(inkomsten.map((d) => d.label)).toEqual(["Werkgever"]);
  expect(uitgaven.map((d) => d.label)).toEqual(["Verhuurder"]);
});

test('no transaction history at all -> thin, and the banner refuses the green "geen tekort"', () => {
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 },
  ];
  const { byEntity } = forecastCashflow([], accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.streams).toHaveLength(0);
  expect(isThinData(f)).toBe(true);
  // This used to read "none" — a green "geen tekort verwacht in de komende 13
  // weken" over a flat line drawn from an empty vault. There is no shortfall
  // because there is no forecast, and the banner now says which.
  expect(bannerState(f)).toBe("insufficient");
  expect(coverageNotes(f).map((n) => n.id)).toContain("no-evidence");
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

/* Coverage honesty — the sentences that make the projection checkable. Each is
 * asserted through real forecastCashflow() output, so a change in the engine's
 * basis fields shows up here as changed copy rather than as silence. */

test("coverageNotes: names the history, the live streams and the window it was built on", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"),
    tx("2", "2026-05-25", 3000, "Werkgever"),
    tx("3", "2026-06-25", 3000, "Werkgever"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 },
  ];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01" }).byEntity["BV1"];
  const basis = coverageNotes(f).find((n) => n.id === "basis")!;
  expect(basis.text).toContain("61 dagen historie (2026-04-25 t/m 2026-06-25)");
  expect(basis.text).toContain("1 lopende terugkerende stroom");
});

test("coverageNotes: an account with a balance but no transactions is said out loud", () => {
  const accounts: Account[] = [
    {
      key: "A1",
      iban: "A1",
      name: "Betaal",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: 1000,
    },
    {
      key: "B1",
      iban: "B1",
      name: "Zakelijk",
      bank: "Knab",
      entity: "BV1",
      currency: "EUR",
      balance: 9000,
    },
  ];
  const txs: Tx[] = [tx("1", "2026-01-01", -25, "Koffie"), tx("2", "2026-06-25", -25, "Boek")];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01" }).byEntity["BV1"];
  const note = coverageNotes(f).find((n) => n.id === "accounts-without-history")!;
  expect(note.text).toContain("1 van je 2 rekeningen");
});

test("coverageNotes: three weeks of one card among months of another is named, with the number", () => {
  const accounts: Account[] = [
    {
      key: "A",
      iban: "A",
      name: "Betaal",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: 1000,
    },
    {
      key: "B",
      iban: "B",
      name: "Card",
      bank: "Amex",
      entity: "BV1",
      currency: "EUR",
      balance: 500,
    },
  ];
  const on = (id: string, key: string, date: string, cp: string): Tx => ({
    id,
    accountKey: key,
    date,
    amount: -25,
    currency: "EUR",
    counterparty: cp,
    description: "",
    category: "",
    manual: false,
  });
  const txs: Tx[] = [
    on("1", "A", "2026-01-01", "Koffie"),
    on("2", "A", "2026-07-19", "Boek"),
    on("3", "B", "2026-07-01", "Tanken"),
    on("4", "B", "2026-07-22", "Lunch"),
  ];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-25" }).byEntity["BV1"];
  expect(coverageNotes(f).find((n) => n.id === "short-account")!.text).toContain(
    "21 dagen historie",
  );
  expect(confidenceLabel(f.basis!.confidence)).toBe("beperkte basis");
});

test("coverageNotes: a stale import says how old it is instead of quietly forecasting from it", () => {
  const txs: Tx[] = [
    tx("1", "2026-01-05", 3000, "Werkgever"),
    tx("2", "2026-02-05", 3000, "Werkgever"),
    tx("3", "2026-03-05", 3000, "Werkgever"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 },
  ];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-04-20" }).byEntity["BV1"];
  expect(coverageNotes(f).find((n) => n.id === "stale-import")!.text).toContain(
    "2026-03-05, 46 dagen geleden",
  );
});

test("coverageNotes: a forecast without a basis (hand-written fixture) says nothing at all", () => {
  expect(
    coverageNotes({
      scope: "x",
      asOf: "2026-08-01",
      horizonDays: 91,
      openingCents: 0,
      points: [],
      shortfall: null,
      streams: [],
      drivers: [],
    }),
  ).toEqual([]);
});

test("hasBand: false when the engine could not measure one, true once it could", () => {
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 },
  ];
  const thin = forecastCashflow(
    [
      tx("1", "2026-06-10", -10000, "Equipment"),
      tx("2", "2026-06-20", -50, "Coffee"),
      tx("3", "2026-06-30", -50, "Coffee"),
    ],
    accounts,
    { asOf: "2026-07-01" },
  ).byEntity["BV1"];
  expect(hasBand(thin)).toBe(false);

  const measured = forecastCashflow(
    [
      tx("1", "2026-04-25", 2500, "Werkgever"),
      tx("2", "2026-05-25", 2600, "Werkgever"),
      tx("3", "2026-06-25", 2400, "Werkgever"),
    ],
    accounts,
    { asOf: "2026-07-01" },
  ).byEntity["BV1"];
  expect(hasBand(measured)).toBe(true);
});

test('coverageNotes: a zero-width band says "measured zero", not nothing', () => {
  // A perfectly constant salary: the spread IS measured, and it is zero. The
  // chart draws no ribbon, so the reason has to be in the text — otherwise the
  // missing band reads as a missing feature.
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"),
    tx("2", "2026-05-25", 3000, "Werkgever"),
    tx("3", "2026-06-25", 3000, "Werkgever"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 },
  ];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01" }).byEntity["BV1"];
  expect(f.basis!.bandBasis).not.toBe("none");
  expect(hasBand(f)).toBe(false);
  expect(coverageNotes(f).map((n) => n.id)).toContain("flat-band");
});
