import { crossRate, type FxRate } from "../fx.js";
import type { Dividend } from "./dividend.js";
import type { CashBalance, CashFlow, Position, PriceBar, Trade } from "./model.js";

export type PortfolioValuePoint = {
  date: string;
  positionsValue: number | null;
  cashValue: number | null;
  value: number | null;
  unpriced: string[];
  forwardFilled: string[];
  cashUnknown: string[];
};
export type PortfolioRange = "1M" | "6M" | "1Y" | "YTD" | "All";
export type FxRates = FxRate | FxRate[];

function rateFor(rates: FxRates, date: string): FxRate {
  const candidates = Array.isArray(rates) ? rates : [rates];
  const rate = candidates.filter((candidate) => candidate.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!rate) throw new Error(`No FX rate available for ${date}`);
  return rate;
}

export function convertCurrency(value: number, from: string, to: string, date: string, fxRates: FxRates): number {
  if (from === to) return value;
  return value * crossRate(from, to, rateFor(fxRates, date));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function businessCalendar(from: string, to: string, priceBars: readonly PriceBar[]): string[] {
  const dates = new Set(priceBars.filter((bar) => bar.date >= from && bar.date <= to).map((bar) => bar.date));
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.add(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...dates].sort();
}

function businessDates(from: string, to: string): string[] {
  return businessCalendar(from, to, []);
}

function upperBound(sortedDates: readonly string[], date: string): number {
  let low = 0;
  let high = sortedDates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedDates[middle] <= date) low = middle + 1;
    else high = middle;
  }
  return low;
}

function signedQuantity(trade: Trade): number {
  return trade.side === "buy" ? trade.quantity : trade.side === "sell" ? -trade.quantity : 0;
}

function cashKey(value: { tenantId: string; entity: string; broker: string; currency: string }): string {
  return `${value.tenantId}\u0000${value.entity}\u0000${value.broker}\u0000${value.currency}`;
}

function displayCashKey(value: { broker: string; currency: string }): string {
  return `${value.broker}:${value.currency}`;
}

function uniqueByIdentity<T extends { id: string }>(items: readonly T[], brokerId: (item: T) => string | undefined): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = brokerId(item) ?? item.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

type CashEvent = { date: string; amount: number };

function cashAmountOnDate(date: string, anchors: readonly CashBalance[], events: readonly CashEvent[]): number | null {
  const sortedAnchors = [...anchors].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const before = sortedAnchors.filter((anchor) => anchor.asOf <= date).at(-1);
  if (before) {
    return before.amount + events
      .filter((event) => event.date > before.asOf && event.date <= date)
      .reduce((sum, event) => sum + event.amount, 0);
  }
  const after = sortedAnchors.find((anchor) => anchor.asOf > date);
  const firstEvent = [...events].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!after || !firstEvent || date < firstEvent.date) return null;
  return after.amount - events
    .filter((event) => event.date > date && event.date <= after.asOf)
    .reduce((sum, event) => sum + event.amount, 0);
}

/** Build cash-aware daily portfolio values from trade history and broker anchors. */
export function computePortfolioValueSeries(
  positions: readonly Position[],
  trades: readonly Trade[],
  priceBars: readonly PriceBar[],
  presentationCurrency: string,
  fxRates: FxRates,
  options: {
    cashBalances?: readonly CashBalance[];
    cashFlows?: readonly CashFlow[];
    dividends?: readonly Dividend[];
    today?: string;
  } = {},
): PortfolioValuePoint[] {
  const firstTrade = [...trades].sort((a, b) => a.date.localeCompare(b.date))[0]?.date;
  if (!firstTrade) return [];
  const today = options.today ?? isoDate(new Date());
  const dates = businessCalendar(firstTrade, today, priceBars);
  const weekdays = businessDates(firstTrade, today);
  const symbols = [...new Set([...trades.map((trade) => trade.symbol), ...positions.map((position) => position.symbol)])].sort();
  const tradesBySymbol = new Map(symbols.map((symbol) => [symbol, trades.filter((trade) => trade.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date))]));
  const barsBySymbol = new Map(symbols.map((symbol) => [symbol, priceBars.filter((bar) => bar.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date))]));
  const cashFlows = uniqueByIdentity(options.cashFlows ?? [], (flow) => `${cashKey(flow)}\u0000${flow.brokerFlowId ?? flow.id}`);
  const dividends = uniqueByIdentity(options.dividends ?? [], (dividend) => `${cashKey(dividend)}\u0000${dividend.brokerDividendId ?? dividend.id}`);
  const cashBalances = options.cashBalances ?? [];
  const cashLegKeys = new Set([...cashBalances.map(cashKey), ...cashFlows.map(cashKey), ...dividends.map(cashKey)]);

  return dates.map((date) => {
    let positionsValue = 0;
    let held = 0;
    let priced = 0;
    const unpriced = new Set<string>();
    const forwardFilled = new Set<string>();

    for (const symbol of symbols) {
      const quantity = (tradesBySymbol.get(symbol) ?? [])
        .filter((trade) => trade.date <= date)
        .reduce((sum, trade) => sum + signedQuantity(trade), 0);
      if (Math.abs(quantity) < 1e-12) continue;
      held += 1;
      const bars = barsBySymbol.get(symbol) ?? [];
      const exact = bars.find((bar) => bar.date === date);
      const latest = exact ?? bars.filter((bar) => bar.date < date).at(-1);
      if (!latest) {
        unpriced.add(symbol);
        continue;
      }
      const missedBusinessDays = upperBound(weekdays, date) - upperBound(weekdays, latest.date);
      if (!exact && missedBusinessDays > 5) {
        unpriced.add(symbol);
        continue;
      }
      try {
        positionsValue += convertCurrency(quantity * latest.close, latest.currency, presentationCurrency, date, fxRates);
        priced += 1;
        if (!exact) forwardFilled.add(symbol);
      } catch {
        unpriced.add(symbol);
      }
    }

    let cashValue = 0;
    let reachableCashLegs = 0;
    const cashUnknown = new Set<string>();
    for (const key of cashLegKeys) {
      const anchorGroup = cashBalances.filter((anchor) => cashKey(anchor) === key);
      const sample = anchorGroup[0] ?? cashFlows.find((flow) => cashKey(flow) === key) ?? dividends.find((dividend) => cashKey(dividend) === key);
      if (!sample) continue;
      const events: CashEvent[] = [
        ...cashFlows.filter((flow) => cashKey(flow) === key).map(({ date: eventDate, amount }) => ({ date: eventDate, amount })),
        ...dividends.filter((dividend) => cashKey(dividend) === key).map(({ date: eventDate, amount }) => ({ date: eventDate, amount })),
      ];
      const amount = cashAmountOnDate(date, anchorGroup, events);
      if (amount === null) {
        cashUnknown.add(displayCashKey(sample));
        continue;
      }
      try {
        cashValue += convertCurrency(amount, sample.currency, presentationCurrency, date, fxRates);
        reachableCashLegs += 1;
      } catch {
        cashUnknown.add(displayCashKey(sample));
      }
    }

    const knownPositionsValue = held > 0 && priced === 0 ? null : positionsValue;
    const knownCashValue = cashLegKeys.size === 0 || reachableCashLegs === 0 ? null : cashValue;
    const reachableValues = [knownPositionsValue, knownCashValue].filter((value): value is number => value !== null);
    return {
      date,
      positionsValue: knownPositionsValue,
      cashValue: knownCashValue,
      value: reachableValues.length === 0 ? null : reachableValues.reduce((sum, value) => sum + value, 0),
      unpriced: [...unpriced].sort(),
      forwardFilled: [...forwardFilled].sort(),
      cashUnknown: [...cashUnknown].sort(),
    };
  });
}

function subtractMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

export function filterPortfolioValueRange<T extends { date: string }>(points: T[], range: PortfolioRange): T[] {
  if (points.length === 0 || range === "All") return [...points];
  const latest = [...points].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!.date;
  const start = range === "YTD" ? `${latest.slice(0, 4)}-01-01` : subtractMonths(latest, range === "1M" ? 1 : range === "6M" ? 6 : 12);
  return points.filter((point) => point.date >= start);
}
