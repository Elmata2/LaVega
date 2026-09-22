import { crossRate, type FxRate } from "../fx.js";
import type { Dividend } from "./dividend.js";
import type { CashBalance, CashFlow, Position, PriceBar, Trade } from "./model.js";
import { businessDateRange, isPriceFresh } from "./calendar.js";
import { ownershipKey, type Ownership } from "./ownership.js";
import { tradeDelta } from "./quantity.js";

export type PortfolioValuePoint = {
  date: string;
  positionsValue: number | null;
  cashValue: number | null;
  value: number | null;
  unpriced: string[];
  forwardFilled: string[];
  cashUnknown: string[];
  /** Holdings inferred from a later snapshot without dated ownership evidence. */
  holdingsUnknown?: string[];
};
export type PortfolioRange = "1M" | "6M" | "1Y" | "YTD" | "All";
/** Undefined means the FX provider failed. Conversions then throw and every
 *  caller already reports that as missing-fx rather than a wrong number. */
export type FxRates = FxRate | FxRate[] | undefined;
const FX_CARRY_DAYS = 10;
const sortedFxRates = new WeakMap<FxRate[], FxRate[]>();

function daysSince(observation: string, date: string): number | null {
  const observedAt = Date.parse(`${observation}T00:00:00Z`);
  const requestedAt = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(observedAt) || !Number.isFinite(requestedAt)) return null;
  return (requestedAt - observedAt) / 86_400_000;
}

function rateFor(rates: FxRates, date: string): FxRate {
  const candidates = rates === undefined ? [] : Array.isArray(rates) ? rates : [rates];
  if (candidates.length === 0) throw new Error(`No FX rate available for ${date}`);
  let sorted: FxRate[];
  if (Array.isArray(rates)) {
    sorted =
      sortedFxRates.get(rates) ??
      [...rates].sort((left, right) => left.date.localeCompare(right.date));
    sortedFxRates.set(rates, sorted);
  } else {
    sorted = candidates;
  }
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle]!.date <= date) low = middle + 1;
    else high = middle;
  }
  const rate = sorted[low - 1];
  const age = rate ? daysSince(rate.date, date) : null;
  if (age === null || age < 0 || age > FX_CARRY_DAYS)
    throw new Error(`No FX rate available for ${date}`);
  return rate;
}

export function convertCurrency(
  value: number,
  from: string,
  to: string,
  date: string,
  fxRates: FxRates,
): number {
  if (from === to) return value;
  return value * crossRate(from, to, rateFor(fxRates, date));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function businessCalendar(from: string, to: string, priceBars: readonly PriceBar[]): string[] {
  const dates = new Set(
    priceBars.filter((bar) => bar.date >= from && bar.date <= to).map((bar) => bar.date),
  );
  for (const date of businessDateRange(from, to)) dates.add(date);
  return [...dates].sort();
}

function cashKey(value: { entity: string; broker: string; currency: string }): string {
  return `${value.entity}\u0000${value.broker}\u0000${value.currency}`;
}

function displayCashKey(value: { broker: string; currency: string }): string {
  return `${value.broker}:${value.currency}`;
}

function uniqueByIdentity<T extends { id: string }>(
  items: readonly T[],
  brokerId: (item: T) => string | undefined,
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = brokerId(item) ?? item.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

type CashEvent = { date: string; amount: number };
type Anchor = { asOf: string; amount: number };

function sumBetween(events: readonly CashEvent[], after: string, through: string): number {
  return events
    .filter((event) => event.date > after && event.date <= through)
    .reduce((sum, event) => sum + event.amount, 0);
}

/** Walk events out from the nearest broker anchor: forwards from the last anchor
 *  on or before the date, otherwise backwards from the first anchor after it.
 *  Null when no anchor reaches the date at all. */
function anchoredAmountOnDate(
  date: string,
  anchors: readonly Anchor[],
  events: readonly CashEvent[],
): number | null {
  const sortedAnchors = [...anchors].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const before = sortedAnchors.filter((anchor) => anchor.asOf <= date).at(-1);
  if (before) return before.amount + sumBetween(events, before.asOf, date);
  const after = sortedAnchors.find((anchor) => anchor.asOf > date);
  if (!after) return null;
  return after.amount - sumBetween(events, date, after.asOf);
}

function cashAmountOnDate(
  date: string,
  anchors: readonly CashBalance[],
  events: readonly CashEvent[],
): number | null {
  // Before the first recorded flow an untracked earlier movement could sit
  // between us and the anchor, so report unknown rather than a wrong balance.
  const firstEvent = [...events].sort((a, b) => a.date.localeCompare(b.date))[0];
  const covered =
    anchors.some((anchor) => anchor.asOf <= date) ||
    (firstEvent !== undefined && date >= firstEvent.date);
  return covered ? anchoredAmountOnDate(date, anchors, events) : null;
}

/** One symbol held by one owner: broker quantity snapshots plus signed trades.
 *
 *  The owner is the full ownership identity, not just the entity. Two brokers
 *  holding the same instrument for the same entity each report their own dated
 *  snapshots; folded into one holding those dates read as a single timeline and
 *  whichever broker synced last silently replaces the other's anchor. */
type Holding = { anchors: Map<string, number>; events: CashEvent[] };

function holdingsBySymbol(
  positions: readonly Position[],
  trades: readonly Trade[],
): Map<string, Holding[]> {
  const byKey = new Map<string, Holding>();
  const bySymbol = new Map<string, Holding[]>();
  const holding = (symbol: string, owner: Ownership): Holding => {
    const key = `${symbol}\u0000${ownershipKey(owner)}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const created: Holding = { anchors: new Map(), events: [] };
    byKey.set(key, created);
    const group = bySymbol.get(symbol) ?? [];
    group.push(created);
    bySymbol.set(symbol, group);
    return created;
  };
  for (const position of positions) {
    const anchors = holding(position.symbol, position).anchors;
    anchors.set(position.asOf, (anchors.get(position.asOf) ?? 0) + position.quantity);
  }
  for (const trade of trades)
    holding(trade.symbol, trade).events.push({
      date: trade.date,
      amount: tradeDelta(trade),
    });
  return bySymbol;
}

/** Quantity held on a date, anchored on the broker's reported position. Order
 *  history is routinely short, and pie trades never appear in it at all, so
 *  accumulating trades forward from the start silently undercounts a holding. */
function quantityOnDate(date: string, holdings: readonly Holding[]): number {
  return holdings.reduce((sum, holding) => {
    const anchors = [...holding.anchors].map(([asOf, amount]) => ({ asOf, amount }));
    const anchored = anchoredAmountOnDate(date, anchors, holding.events);
    return sum + (anchored ?? sumBetween(holding.events, "", date));
  }, 0);
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
  // Market history is not evidence that the account owned a position then.
  const start = [
    firstTrade,
    ...positions.map((position) => position.asOf),
    ...(options.cashBalances ?? []).map((balance) => balance.asOf),
    ...(options.cashFlows ?? []).map((flow) => flow.date),
  ]
    .filter((date): date is string => Boolean(date))
    .sort()[0];
  if (!start) return [];
  const today = options.today ?? isoDate(new Date());
  const dates = businessCalendar(start, today, priceBars);
  const symbols = [
    ...new Set([
      ...trades.map((trade) => trade.symbol),
      ...positions.map((position) => position.symbol),
    ]),
  ].sort();
  const holdings = holdingsBySymbol(positions, trades);
  const barsBySymbol = new Map(
    symbols.map((symbol) => [
      symbol,
      {
        bars: priceBars
          .filter((bar) => bar.symbol === symbol)
          .sort((left, right) => left.date.localeCompare(right.date)),
        index: 0,
        latest: null as PriceBar | null,
      },
    ]),
  );
  const cashFlows = uniqueByIdentity(
    options.cashFlows ?? [],
    (flow) => `${cashKey(flow)}\u0000${flow.brokerFlowId ?? flow.id}`,
  );
  const dividends = uniqueByIdentity(
    options.dividends ?? [],
    (dividend) => `${cashKey(dividend)}\u0000${dividend.brokerDividendId ?? dividend.id}`,
  );
  const cashBalances = options.cashBalances ?? [];
  const cashLegKeys = new Set([
    ...cashBalances.map(cashKey),
    ...cashFlows.map(cashKey),
    ...dividends.map(cashKey),
  ]);

  return dates.map((date) => {
    let positionsValue = 0;
    let held = 0;
    let priced = 0;
    const unpriced = new Set<string>();
    const forwardFilled = new Set<string>();
    const holdingsUnknown = new Set<string>();

    for (const symbol of symbols) {
      const quantity = quantityOnDate(date, holdings.get(symbol) ?? []);
      if (Math.abs(quantity) < 1e-12) continue;
      for (const holding of holdings.get(symbol) ?? []) {
        const firstAnchor = [...holding.anchors.keys()].sort()[0];
        if (!firstAnchor || date >= firstAnchor) continue;
        const inferredOpening =
          holding.anchors.get(firstAnchor)! - sumBetween(holding.events, "", firstAnchor);
        if (Math.abs(inferredOpening) > 1e-8) holdingsUnknown.add(symbol);
      }
      held += 1;
      const prices = barsBySymbol.get(symbol);
      while (prices && prices.index < prices.bars.length && prices.bars[prices.index]!.date <= date)
        prices.latest = prices.bars[prices.index++]!;
      const latest = prices?.latest;
      const exact = latest?.date === date ? latest : undefined;
      if (!latest) {
        unpriced.add(symbol);
        continue;
      }
      if (!exact && !isPriceFresh(latest.date, date)) {
        unpriced.add(symbol);
        continue;
      }
      try {
        positionsValue += convertCurrency(
          quantity * latest.close,
          latest.currency,
          presentationCurrency,
          date,
          fxRates,
        );
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
      const sample =
        anchorGroup[0] ??
        cashFlows.find((flow) => cashKey(flow) === key) ??
        dividends.find((dividend) => cashKey(dividend) === key);
      if (!sample) continue;
      const events: CashEvent[] = [
        ...cashFlows
          .filter((flow) => cashKey(flow) === key)
          .map(({ date: eventDate, amount }) => ({ date: eventDate, amount })),
        ...dividends
          .filter((dividend) => cashKey(dividend) === key)
          .map(({ date: eventDate, amount }) => ({ date: eventDate, amount })),
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
    const reachableValues = [knownPositionsValue, knownCashValue].filter(
      (value): value is number => value !== null,
    );
    return {
      date,
      positionsValue: knownPositionsValue,
      cashValue: knownCashValue,
      value:
        reachableValues.length === 0
          ? null
          : reachableValues.reduce((sum, value) => sum + value, 0),
      unpriced: [...unpriced].sort(),
      forwardFilled: [...forwardFilled].sort(),
      cashUnknown: [...cashUnknown].sort(),
      ...(holdingsUnknown.size ? { holdingsUnknown: [...holdingsUnknown].sort() } : {}),
    };
  });
}

function subtractMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

export function filterPortfolioValueRange<T extends { date: string }>(
  points: T[],
  range: PortfolioRange,
): T[] {
  if (points.length === 0 || range === "All") return [...points];
  const latest = [...points].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!.date;
  const start =
    range === "YTD"
      ? `${latest.slice(0, 4)}-01-01`
      : subtractMonths(latest, range === "1M" ? 1 : range === "6M" ? 6 : 12);
  return points.filter((point) => point.date >= start);
}
