import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readDeGiroPortfolio } from "./portfolio.js";

/* Issue #319: the portfolio export -> dated positions and its cash row.
 *
 * The fixtures are the sanitized real NL/EN exports from #313: 13 rows, one
 * `CASH & CASH FUND` row plus 12 holdings, and no date column. Every amount,
 * ISIN and product is synthetic. */

const fixture = (path: string): string =>
  readFileSync(new URL(`../__fixtures__/degiro/${path}`, import.meta.url), "utf8");

const AS_OF = "2026-11-12";
const NL_HEADER = "Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR";

const ISINS = [
  "XS00PF000003",
  "XS00PF000011",
  "XS00PF000029",
  "XS00PF000037",
  "XS00PF000045",
  "XS00PF000052",
  "XS00PF000060",
  "XS00PF000078",
  "XS00PF000086",
  "XS00PF000094",
  "XS00PF000102",
  "XS00PF000110",
];

const csv = (...rows: string[]): string => [NL_HEADER, ...rows].join("\n");

test("the NL fixture reads 12 positions and one cash balance", () => {
  const result = readDeGiroPortfolio(fixture("nl/portfolio.csv"), AS_OF);

  expect(result.problems).toEqual([]);
  expect(result.positions).toHaveLength(12);
  expect(result.cashBalances).toEqual([{ currency: "EUR", amount: 201.76, asOf: AS_OF }]);
  expect(result.positions[0]).toEqual({
    symbol: "XS00PF000003",
    isin: "XS00PF000003",
    description: "VOORBEELD GLOBAL EQUITY ETF",
    quantity: 3,
    averagePrice: null,
    marketPrice: 41.66,
    marketValue: 124.98,
    currency: "USD",
    brokerCost: { status: "unknown", reason: "not-reported" },
    asOf: AS_OF,
  });
  expect(result.positions[1]).toMatchObject({
    symbol: "XS00PF000011",
    description: "VOORBEELD DIVIDEND AANDEEL",
    quantity: 4,
    marketPrice: 55.36,
    marketValue: 221.44,
    currency: "USD",
  });
  expect(result.positions[3]).toMatchObject({
    symbol: "XS00PF000037",
    description: "VOORBEELD EURO OBLIGATIE ETF",
    quantity: 6,
    marketPrice: 82.76,
    marketValue: 496.56,
    currency: "EUR",
  });
  // The cash row is a balance, never an identity-less holding.
  expect(
    result.positions.some((position) =>
      position.description?.toLowerCase().startsWith("cash & cash fund"),
    ),
  ).toBe(false);
});

test("every position is keyed by its ISIN, so a product rename cannot split identity", () => {
  const { positions } = readDeGiroPortfolio(fixture("nl/portfolio.csv"), AS_OF);

  for (const position of positions) expect(position.symbol).toBe(position.isin);
  expect(new Set(positions.map((position) => position.symbol))).toEqual(new Set(ISINS));
});

test("the EN export parses to the same positions and cash balances as the NL export", () => {
  const nl = readDeGiroPortfolio(fixture("nl/portfolio.csv"), AS_OF);
  const en = readDeGiroPortfolio(fixture("en/portfolio.csv"), AS_OF);

  expect(en.positions).toEqual(nl.positions);
  expect(en.cashBalances).toEqual(nl.cashBalances);
  expect(en.problems).toEqual([]);
});

test("a header-only portfolio reports no positions, not a silent empty import", () => {
  const result = readDeGiroPortfolio(`${NL_HEADER}\n`, AS_OF);

  expect(result.positions).toEqual([]);
  expect(result.cashBalances).toEqual([]);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatch(/geen posities/);
});

test.each(["", "2026-02-31", "12-11-2026"])(
  "the export date %j is required, so no row is dated without it",
  (asOf) => {
    const result = readDeGiroPortfolio(fixture("nl/portfolio.csv"), asOf);

    expect(result.positions).toEqual([]);
    expect(result.cashBalances).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/exportdatum/);
  },
);

test("a position without an ISIN is skipped and the valid rows still parse", () => {
  const result = readDeGiroPortfolio(
    csv(
      "VOORBEELD AANDEEL,XS00PF000999,2,10.00,EUR,20.00,20.00",
      "VOORBEELD ZONDER ISIN,,2,10.00,EUR,20.00,20.00",
      "VOORBEELD TWEEDE AANDEEL,XS00PF000998,1,5.00,EUR,5.00,5.00",
    ),
    AS_OF,
  );

  expect(result.positions.map((position) => position.symbol)).toEqual([
    "XS00PF000999",
    "XS00PF000998",
  ]);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatch(/rij 3/);
  expect(result.problems[0]).toMatch(/ISIN/);
});

test("a row whose quantity, closing price or local value does not parse is skipped", () => {
  const result = readDeGiroPortfolio(
    csv(
      "VOORBEELD AANDEEL,XS00PF000999,abc,10.00,EUR,20.00,20.00",
      "VOORBEELD AANDEEL,XS00PF000998,2,abc,EUR,20.00,20.00",
      "VOORBEELD AANDEEL,XS00PF000997,2,10.00,,,20.00",
    ),
    AS_OF,
  );

  expect(result.positions).toEqual([]);
  expect(result.problems).toHaveLength(3);
  expect(result.problems[0]).toMatch(/rij 2/);
  expect(result.problems[1]).toMatch(/rij 3/);
  expect(result.problems[2]).toMatch(/rij 4/);
});

test("an unknown header yields no rows and one problem", () => {
  const result = readDeGiroPortfolio("Datum,Onbekend\n06-03-2026,x\n", AS_OF);

  expect(result.positions).toEqual([]);
  expect(result.cashBalances).toEqual([]);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatch(/onbekend/);
});

test("another known profile is not a portfolio export", () => {
  const result = readDeGiroPortfolio(fixture("nl/account.csv"), AS_OF);

  expect(result.positions).toEqual([]);
  expect(result.cashBalances).toEqual([]);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatch(/geen DeGiro portfolio-export/);
});
