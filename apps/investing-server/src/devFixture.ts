import {
  crossRate,
  type Dividend,
  type FxRate,
  type Position,
  type PriceBar,
  type Trade,
} from "@lavega/core";
import type { FxProviderResult, FxRequest } from "@lavega/adapters";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

/** Canned local-dev data: a small portfolio plus matching price history, so the
 * dashboard renders instantly without a real broker sync or price fetch. Enabled
 * via INVESTING_DEV_FIXTURE=1 (see docker.ts / index.ts). Never used in production. */

const TENANT_ID = "local";
const TRANSFER_IN_SYMBOL = "TSLA";
const ENTITY = "personal";
const FIXTURE_BROKER = "trading212";
const FIXTURE_ACCOUNT = "ISA";
const HISTORY_DAYS = 270;

type FixtureSymbol = {
  symbol: string;
  /** A real ISIN, so the dashboard shows the canonical identity the security
   *  master keys on (WS4.5, #297). */
  isin: string;
  currency: string;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  startClose: number;
  volatility: number;
  /** A legacy row whose broker reported no legal entity: the allocation ladder
   *  places it in its labelled Unclassified bucket (WS4.6, #297). */
  unclassified?: boolean;
};

const SYMBOLS: FixtureSymbol[] = [
  {
    symbol: "AAPL",
    isin: "US0378331005",
    currency: "USD",
    quantity: 20,
    averagePrice: 178.4,
    marketPrice: 231.2,
    startClose: 150,
    volatility: 6,
  },
  {
    symbol: "MSFT",
    isin: "US5949181045",
    currency: "USD",
    quantity: 10,
    averagePrice: 352.1,
    marketPrice: 418.7,
    startClose: 300,
    volatility: 9,
  },
  {
    symbol: "ASML",
    isin: "NL0010273215",
    currency: "EUR",
    quantity: 4,
    averagePrice: 612,
    marketPrice: 706.5,
    startClose: 560,
    volatility: 15,
  },
  {
    // Demonstrates WS4.2: 5 of these 8 units arrived by transfer, so the cost
    // basis is unknown as a whole and the dashboard shows the typed reason.
    symbol: TRANSFER_IN_SYMBOL,
    isin: "US88160R1014",
    currency: "USD",
    quantity: 8,
    averagePrice: 210,
    marketPrice: 250,
    startClose: 180,
    volatility: 8,
  },
  {
    // Demonstrates WS4.6: a legacy snapshot row with no entity, so the entity
    // ladder has a real, labelled Unclassified bucket.
    symbol: "VWRL",
    isin: "IE00B3RBWM25",
    currency: "EUR",
    quantity: 2,
    averagePrice: 100,
    marketPrice: 110,
    startClose: 95,
    volatility: 3,
    unclassified: true,
  },
];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(now: Date, days: number): Date {
  const result = new Date(now);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function currencyOf(symbol: string): string {
  return SYMBOLS.find((entry) => entry.symbol === symbol)?.currency ?? "EUR";
}

function isinOf(symbol: string): string | undefined {
  return SYMBOLS.find((entry) => entry.symbol === symbol)?.isin;
}

function trade(
  id: string,
  now: Date,
  daysAgoCount: number,
  symbol: string,
  side: Trade["side"],
  quantity: number,
  price: number,
): Trade {
  return {
    id,
    entity: ENTITY,
    broker: FIXTURE_BROKER,
    account: FIXTURE_ACCOUNT,
    date: isoDate(daysAgo(now, daysAgoCount)),
    symbol,
    ...(isinOf(symbol) ? { isin: isinOf(symbol) } : {}),
    side,
    quantity,
    price,
    amount: Math.round(quantity * price * 100) / 100,
    currency: currencyOf(symbol),
    commission: 1,
  };
}

function dividend(
  id: string,
  now: Date,
  daysAgoCount: number,
  symbol: string,
  amount: number,
): Dividend {
  return {
    id,
    entity: ENTITY,
    broker: FIXTURE_BROKER,
    account: FIXTURE_ACCOUNT,
    date: isoDate(daysAgo(now, daysAgoCount)),
    symbol,
    amount,
    currency: currencyOf(symbol),
  };
}

/** The Personal side of the net-worth bridge for the local run: a bank-only
 *  total (WS4.7 #298, investment accounts are Investing's own figure), so the
 *  NetWorthPage can be checked end to end without a real Personal vault. */
export function createDevFixturePersonalNetWorthSeed(
  now = new Date(),
): Record<string, Array<{ date: string; totalCents: number }>> {
  return { [TENANT_ID]: [{ date: isoDate(now), totalCents: 25_000_00 }] };
}

export function createDevFixtureBrokerData(now = new Date()): RuntimeBrokerDataSnapshot {
  const asOf = isoDate(now);
  const positions: Position[] = SYMBOLS.map((entry) => ({
    tenantId: TENANT_ID,
    entity: ENTITY,
    broker: FIXTURE_BROKER,
    account: FIXTURE_ACCOUNT,
    ...(entry.unclassified ? { entity: "" } : {}),
    symbol: entry.symbol,
    isin: entry.isin,
    quantity: entry.quantity,
    brokerCost:
      entry.symbol === TRANSFER_IN_SYMBOL
        ? { status: "unknown", reason: "not-reported" }
        : {
            status: "known",
            amount: entry.averagePrice * entry.quantity,
            currency: entry.currency,
          },
    averagePrice: entry.averagePrice,
    marketPrice: entry.marketPrice,
    marketValue: Math.round(entry.quantity * entry.marketPrice * 100) / 100,
    currency: entry.currency,
    asOf,
  }));
  const trades: Trade[] = [
    trade("fixture-1", now, 180, "AAPL", "buy", 15, 158),
    trade("fixture-2", now, 60, "AAPL", "buy", 10, 205),
    trade("fixture-3", now, 150, "MSFT", "buy", 10, 352.1),
    trade("fixture-4", now, 120, "ASML", "buy", 2, 585),
    trade("fixture-5", now, 45, "ASML", "buy", 2, 639),
    trade("fixture-6", now, 100, TRANSFER_IN_SYMBOL, "buy", 3, 210),
    // An inbound internal transfer: no price and no commission exist, and the
    // positive quantity carries the direction (see `normalizeTradeQuantity`).
    {
      id: "fixture-7",
      entity: ENTITY,
      broker: FIXTURE_BROKER,
      account: FIXTURE_ACCOUNT,
      date: isoDate(daysAgo(now, 30)),
      symbol: TRANSFER_IN_SYMBOL,
      side: "other",
      quantity: 5,
      price: null,
      amount: null,
      currency: currencyOf(TRANSFER_IN_SYMBOL),
      commission: null,
    },
    // WS4.3 (#296): a real disposal. The wallet settlement is the broker's own
    // net cash, so the realised report reconciles it against gross minus fee.
    {
      id: "fixture-8",
      entity: ENTITY,
      broker: FIXTURE_BROKER,
      account: FIXTURE_ACCOUNT,
      date: isoDate(daysAgo(now, 40)),
      symbol: "AAPL",
      side: "sell",
      quantity: 5,
      price: 231.2,
      amount: 1156,
      currency: "USD",
      commission: 1,
      settlement: { currency: "USD", amount: 1155 },
    },
    // WS4.3 (#296): a closed position in a currency the fixture's FX provider
    // has no rate for. The report shows the disposal's gain as unknown; it must
    // never convert 1:1.
    {
      id: "fixture-9",
      entity: ENTITY,
      broker: FIXTURE_BROKER,
      account: FIXTURE_ACCOUNT,
      date: isoDate(daysAgo(now, 100)),
      symbol: "NESN",
      side: "buy",
      quantity: 2,
      price: 90,
      amount: 180,
      currency: "CHF",
      commission: 0,
    },
    {
      id: "fixture-10",
      entity: ENTITY,
      broker: FIXTURE_BROKER,
      account: FIXTURE_ACCOUNT,
      date: isoDate(daysAgo(now, 20)),
      symbol: "NESN",
      side: "sell",
      quantity: 2,
      price: 100,
      amount: 200,
      currency: "CHF",
      commission: 0,
    },
  ];
  const dividends: Dividend[] = [
    dividend("fixture-div-1", now, 90, "AAPL", 6.25),
    dividend("fixture-div-2", now, 75, "MSFT", 7.5),
  ];
  return {
    [FIXTURE_BROKER]: {
      positions,
      trades,
      dividends,
      /* One settled cash anchor, so the allocation ladder's Cash bucket is a
       * real figure (WS4.6, #297). */
      cashBalances: [
        {
          entity: ENTITY,
          broker: FIXTURE_BROKER,
          currency: "EUR",
          amount: 1500,
          asOf,
        },
      ],
      cashFlows: [],
    },
  };
}

function series(
  symbol: string,
  currency: string,
  startClose: number,
  endClose: number,
  volatility: number,
  now: Date,
): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let day = HISTORY_DAYS; day >= 0; day -= 1) {
    const progress = 1 - day / HISTORY_DAYS;
    const drift = startClose + (endClose - startClose) * progress;
    const wobble = Math.sin(day * 0.35) * volatility;
    bars.push({
      symbol,
      date: isoDate(daysAgo(now, day)),
      close: Math.round((drift + wobble) * 100) / 100,
      currency,
    });
  }
  return bars;
}

/** Bars run through today. `syncPrices` (packages/adapters/src/market-data/priceSync.ts)
 * only calls out to Yahoo when the cached last date is stale, so a fresh last bar also
 * keeps the frontend's on-mount price sync from making any real network calls. */
export function createDevFixturePriceBars(now = new Date()): PriceBar[] {
  return [
    ...SYMBOLS.flatMap((entry) =>
      series(
        entry.symbol,
        entry.currency,
        entry.startClose,
        entry.marketPrice,
        entry.volatility,
        now,
      ),
    ),
    ...series("SP500", "EUR", 4200, 5650, 40, now),
  ];
}

/** Canned EUR/USD rate for a spot conversion (`get`/`getLatestRate`, which take
 * no date and never go through `rateFor`'s carry window). */
const FIXTURE_FX_RATE: FxRate = { base: "EUR", date: "2000-01-01", rates: { USD: 1.15 } };

/** One rate per day across the fixture's own history window, so `rateFor`
 * (packages/core/src/investing/portfolio.ts) finds an exact-day match for
 * every trade, dividend, and price-bar date the fixture generates. A single
 * old rate cannot do this: `rateFor` only carries a rate forward ten calendar
 * days, far short of HISTORY_DAYS — the real Frankfurter provider only ever
 * holds today's rate anyway, which leaves the fixture's older history without
 * FX coverage unless the fixture manufactures its own. */
function fixtureFxHistory(now: Date): FxRate[] {
  const rates: FxRate[] = [];
  for (let day = HISTORY_DAYS; day >= 0; day -= 1) {
    rates.push({ base: "EUR", date: isoDate(daysAgo(now, day)), rates: { USD: 1.15 } });
  }
  return rates;
}

export function createDevFixtureFxProvider(now = new Date()) {
  return {
    sourceKey: "dev-fixture",
    priority: 10,
    async get(request: FxRequest): Promise<FxProviderResult> {
      try {
        return { rate: crossRate(request.from, request.to, FIXTURE_FX_RATE), problems: [] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          rate: 0,
          problems: [`Dev fixture has no FX rate for ${request.from} to ${request.to}: ${message}`],
        };
      }
    },
    async getLatestRate(): Promise<{ rate: FxRate; problems: string[] }> {
      return { rate: FIXTURE_FX_RATE, problems: [] };
    },
    async getHistoricalRates(
      _from: string,
      _to: string,
    ): Promise<{ rates: FxRate[]; problems: string[] }> {
      return { rates: fixtureFxHistory(now), problems: [] };
    },
  };
}
