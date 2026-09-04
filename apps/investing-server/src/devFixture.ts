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
const ENTITY = "personal";
const FIXTURE_BROKER = "trading212";
const HISTORY_DAYS = 270;

type FixtureSymbol = {
  symbol: string;
  currency: string;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  startClose: number;
  volatility: number;
};

const SYMBOLS: FixtureSymbol[] = [
  {
    symbol: "AAPL",
    currency: "USD",
    quantity: 25,
    averagePrice: 178.4,
    marketPrice: 231.2,
    startClose: 150,
    volatility: 6,
  },
  {
    symbol: "MSFT",
    currency: "USD",
    quantity: 10,
    averagePrice: 352.1,
    marketPrice: 418.7,
    startClose: 300,
    volatility: 9,
  },
  {
    symbol: "ASML",
    currency: "EUR",
    quantity: 4,
    averagePrice: 612,
    marketPrice: 706.5,
    startClose: 560,
    volatility: 15,
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
    date: isoDate(daysAgo(now, daysAgoCount)),
    symbol,
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
    date: isoDate(daysAgo(now, daysAgoCount)),
    symbol,
    amount,
    currency: currencyOf(symbol),
  };
}

export function createDevFixtureBrokerData(now = new Date()): RuntimeBrokerDataSnapshot {
  const asOf = isoDate(now);
  const positions: Position[] = SYMBOLS.map((entry) => ({
    tenantId: TENANT_ID,
    entity: ENTITY,
    symbol: entry.symbol,
    quantity: entry.quantity,
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
  ];
  const dividends: Dividend[] = [
    dividend("fixture-div-1", now, 90, "AAPL", 6.25),
    dividend("fixture-div-2", now, 75, "MSFT", 7.5),
  ];
  return { [FIXTURE_BROKER]: { positions, trades, dividends, cashBalances: [], cashFlows: [] } };
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

/** Canned EUR/USD rate, dated well before any fixture price bar so `rateFor`
 * (packages/core/src/investing/portfolio.ts) always finds a match, however far
 * back the requested date is. The real Frankfurter provider only ever holds
 * today's rate, which leaves the fixture's older history without FX coverage. */
const FIXTURE_FX_RATE: FxRate = { base: "EUR", date: "2000-01-01", rates: { USD: 1.15 } };

export function createDevFixtureFxProvider() {
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
  };
}
