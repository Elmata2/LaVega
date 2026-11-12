import { Schema } from "effect";
import { expect, test } from "vitest";
import type { Position, Trade } from "./model.js";
import { buildCurrentPositions } from "./positions.js";
import { buildInvestingDashboard, InvestingDashboardDataSchema } from "./dashboard.js";
import {
  DIVIDENDS,
  FX_RATES,
  POSITIONS,
  PRICE_BARS,
  TRADES,
} from "./__fixtures__/tradeOnlyBrokers.js";

/* WS4.2 integration: the positions builder attaches a typed basis summary to
 * every row, so the dashboard can say why a basis is unknown instead of
 * rendering "return unavailable" with no cause. Returns themselves must not
 * move; the byte-identical gate lives in dashboardReturns.regression.test.ts. */

const build = (
  overrides: {
    positions?: readonly Position[];
    trades?: readonly Trade[];
  } = {},
) =>
  buildCurrentPositions({
    positions: overrides.positions ?? POSITIONS,
    trades: overrides.trades ?? TRADES,
    dividends: DIVIDENDS,
    priceBars: PRICE_BARS,
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    today: "2026-09-17",
  });

const bySymbol = (positions: ReturnType<typeof build>, symbol: string) => {
  const found = positions.find((position) => position.symbol === symbol);
  expect(found).toBeDefined();
  return found!;
};

const position = (overrides: Partial<Position>): Position => ({
  entity: "personal",
  broker: "trading212",
  account: "main",
  symbol: "ACME",
  quantity: 10,
  averagePrice: 10,
  marketPrice: 10,
  marketValue: 100,
  currency: "EUR",
  asOf: "2026-09-17",
  ...overrides,
});

test("a trade-only position reports a calculated basis with no reason", () => {
  const acme = bySymbol(build(), "ACME");
  expect(acme.basis).toMatchObject({
    status: "known",
    source: "calculated",
    amountCents: 29870,
    currency: "EUR",
    locked: false,
    reason: null,
    firstBuyDate: "2026-01-02",
  });
  // The basis and the return agree for a trade-only book.
  expect(acme.basis!.amountCents).toBe(Math.round(acme.returns.remainingCostBasis! * 100));
});

test("a transfer-in makes the whole basis unknown with its reason, and returns stay null", () => {
  const positions = build({
    positions: [position({ quantity: 12, marketValue: 120 })],
    trades: [
      {
        id: "buy",
        entity: "personal",
        broker: "trading212",
        account: "main",
        date: "2026-01-02",
        symbol: "ACME",
        side: "buy",
        quantity: 2,
        price: 10,
        amount: 20,
        currency: "EUR",
        commission: 0,
      },
      {
        id: "transfer-in",
        entity: "personal",
        broker: "trading212",
        account: "main",
        date: "2026-02-01",
        symbol: "ACME",
        side: "other",
        quantity: 10,
        price: null,
        amount: null,
        currency: "EUR",
        commission: null,
      },
    ],
  });
  const acme = bySymbol(positions, "ACME");
  expect(acme.basis).toEqual({
    status: "unknown",
    source: null,
    amountCents: null,
    currency: "EUR",
    locked: false,
    reason: "transfer-in",
    firstBuyDate: "2026-01-02",
  });
  // Never 1:1 or a guess: the return fields stay null.
  expect(acme.returns.status).toBe("missing-cost");
  expect(acme.returns.remainingCostBasis).toBeNull();
});

test("a broker basis stands in as provider source; no history without it is typed", () => {
  const positions = build();
  expect(bySymbol(positions, "GAMMA").basis).toMatchObject({
    status: "known",
    source: "provider",
    amountCents: 9000,
  });
  expect(bySymbol(positions, "DELTA").basis).toMatchObject({
    status: "unknown",
    reason: "no-history",
    amountCents: null,
  });
  expect(bySymbol(positions, "EPSILON").basis).toMatchObject({
    status: "unknown",
    reason: "missing-fx",
    amountCents: null,
  });
});

test("a locked manual basis wins the read path without touching returns", () => {
  const positions = build({
    positions: [
      position({
        quantity: 10,
        marketPrice: 20,
        marketValue: 200,
        manualCostBasis: { amountCents: 12_345, currency: "EUR", locked: true },
      }),
    ],
    trades: [
      {
        id: "buy",
        entity: "personal",
        broker: "trading212",
        account: "main",
        date: "2026-01-02",
        symbol: "ACME",
        side: "buy",
        quantity: 10,
        price: 10,
        amount: 100,
        currency: "EUR",
        commission: 0,
      },
    ],
  });
  const acme = bySymbol(positions, "ACME");
  expect(acme.basis).toMatchObject({
    status: "known",
    source: "manual",
    amountCents: 12_345,
    locked: true,
  });
  // Provenance is metadata: the calculated return remains the trade replay.
  expect(acme.returns.remainingCostBasis).toBe(100);
});

test("the dashboard schema carries the basis summary through encode and decode", () => {
  const dashboard = buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: DIVIDENDS,
    priceBars: PRICE_BARS,
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    selectedSymbol: "ACME",
    today: "2026-09-17",
  });
  const encoded = Schema.encodeSync(InvestingDashboardDataSchema)(dashboard);
  const decoded = Schema.decodeUnknownSync(InvestingDashboardDataSchema)(encoded);
  const decodedPositions = decoded.positions.map((row) => ({
    symbol: row.symbol,
    basis: row.basis,
  }));
  expect(decodedPositions.find((row) => row.symbol === "ACME")?.basis).toMatchObject({
    status: "known",
    source: "calculated",
    reason: null,
  });
  expect(decodedPositions.find((row) => row.symbol === "EPSILON")?.basis).toMatchObject({
    status: "unknown",
    source: null,
    reason: "missing-fx",
  });
  expect(decoded.position?.basis?.status).toBe("known");
});
