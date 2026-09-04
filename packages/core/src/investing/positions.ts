import type { Dividend } from "./dividend.js";
import type { Position, PriceBar, Trade } from "./model.js";
import { convertCurrency, type FxRates } from "./portfolio.js";
import { isPriceFresh } from "./calendar.js";
import { solveXirr } from "./benchmarks.js";

export type PositionPriceStatus = "priced" | "forward-filled" | "unpriced" | "missing-fx";
export type PositionReturnStatus =
  | "available"
  | "broker-average"
  | "missing-cost"
  | "missing-fx"
  | "unpriced";

/** `broker-average` means the cost basis is the broker's own average price
 *  rather than a reconciled trade history. Realized gain and the annualized
 *  return need the full history, so they stay null there. */
export type PositionReturn = {
  status: PositionReturnStatus;
  remainingCostBasis: number | null;
  realizedCostBasisRemoved: number | null;
  unrealizedGain: number | null;
  realizedGain: number | null;
  dividendsReceived: number | null;
  totalReturn: number | null;
  totalReturnPercentage: number | null;
  sinceFirstBuyPercentage: number | null;
  firstBuyDate: string | null;
};

export type CurrentPosition = {
  symbol: string;
  entity: string;
  isin?: string;
  description?: string;
  quantity: number;
  currency: string;
  asOf: string;
  marketValue: number | null;
  portfolioWeight: number | null;
  priceStatus: PositionPriceStatus;
  returns: PositionReturn;
};

const EPSILON = 1e-9;

function emptyReturn(
  status: PositionReturnStatus,
  firstBuyDate: string | null = null,
): PositionReturn {
  return {
    status,
    remainingCostBasis: null,
    realizedCostBasisRemoved: null,
    unrealizedGain: null,
    realizedGain: null,
    dividendsReceived: null,
    totalReturn: null,
    totalReturnPercentage: null,
    sinceFirstBuyPercentage: null,
    firstBuyDate,
  };
}

function tradeValue(trade: Trade): number | null {
  if (trade.amount !== null) return Math.abs(trade.amount);
  if (trade.price !== null) return Math.abs(trade.price * trade.quantity);
  return null;
}

/** What a broker says one holding cost, before any trade history is consulted. */
export type BrokerCostLeg = { amount: number; currency: string; date: string };

export function calculatePositionReturn(
  quantity: number,
  marketValue: number | null,
  trades: readonly Trade[],
  dividends: readonly Dividend[],
  presentationCurrency: string,
  fxRates: FxRates,
  options: { valuationDate?: string; brokerCost?: readonly BrokerCostLeg[] } = {},
): PositionReturn {
  const orderedTrades = [...trades].sort((left, right) => left.date.localeCompare(right.date));
  const firstBuyDate = orderedTrades.find((trade) => trade.side === "buy")?.date ?? null;
  /* Trades that do not reconcile are not the end of the story. Brokers that
   * fill through pies or autoinvest report the holding and its average price
   * but leave those fills out of order history, so the average is the only
   * cost this position will ever have. */
  const fallback = () =>
    brokerAverageReturn(
      marketValue,
      dividends,
      presentationCurrency,
      fxRates,
      firstBuyDate,
      options.brokerCost,
    );
  if (
    orderedTrades.length === 0 ||
    orderedTrades.some((trade) => trade.side === "other" || trade.commission === null)
  ) {
    return fallback();
  }

  let heldQuantity = 0;
  let remainingCostBasis = 0;
  let realizedCostBasisRemoved = 0;
  let realizedGain = 0;
  const datedFlows: Array<{ date: string; amount: number }> = [];
  try {
    for (const trade of orderedTrades) {
      const gross = tradeValue(trade);
      if (gross === null || trade.quantity <= 0) return fallback();
      const grossEur = convertCurrency(
        gross,
        trade.currency,
        presentationCurrency,
        trade.date,
        fxRates,
      );
      const feeEur = convertCurrency(
        Math.abs(trade.commission!),
        trade.currency,
        presentationCurrency,
        trade.date,
        fxRates,
      );
      if (trade.side === "buy") {
        heldQuantity += trade.quantity;
        remainingCostBasis += grossEur + feeEur;
        datedFlows.push({ date: trade.date, amount: -(grossEur + feeEur) });
        continue;
      }
      if (trade.quantity > heldQuantity + EPSILON || heldQuantity <= EPSILON) return fallback();
      const removed = (remainingCostBasis / heldQuantity) * trade.quantity;
      heldQuantity -= trade.quantity;
      remainingCostBasis -= removed;
      realizedCostBasisRemoved += removed;
      realizedGain += grossEur - removed - feeEur;
      datedFlows.push({ date: trade.date, amount: grossEur - feeEur });
    }

    if (Math.abs(heldQuantity - quantity) > EPSILON) return fallback();
    let dividendsReceived = 0;
    for (const dividend of dividends) {
      const converted = convertCurrency(
        dividend.amount,
        dividend.currency,
        presentationCurrency,
        dividend.date,
        fxRates,
      );
      dividendsReceived += converted;
      datedFlows.push({ date: dividend.date, amount: converted });
    }
    if (marketValue === null)
      return {
        status: "unpriced",
        remainingCostBasis,
        realizedCostBasisRemoved,
        unrealizedGain: null,
        realizedGain,
        dividendsReceived,
        totalReturn: null,
        totalReturnPercentage: null,
        sinceFirstBuyPercentage: null,
        firstBuyDate,
      };
    const unrealizedGain = marketValue - remainingCostBasis;
    const totalReturn = unrealizedGain + realizedGain + dividendsReceived;
    const denominator = remainingCostBasis + realizedCostBasisRemoved;
    const valuationDate =
      options.valuationDate ??
      [...orderedTrades.map((trade) => trade.date), ...dividends.map((dividend) => dividend.date)]
        .sort()
        .at(-1) ??
      firstBuyDate;
    if (marketValue > EPSILON && valuationDate)
      datedFlows.push({ date: valuationDate, amount: marketValue });
    const annualized = solveXirr(datedFlows);
    const elapsedYears =
      firstBuyDate && valuationDate
        ? (Date.parse(`${valuationDate}T00:00:00Z`) - Date.parse(`${firstBuyDate}T00:00:00Z`)) /
          31_536_000_000
        : 0;
    const sinceFirstBuyPercentage =
      annualized !== null && elapsedYears > 0 ? Math.pow(1 + annualized, elapsedYears) - 1 : null;
    return {
      status: "available",
      remainingCostBasis,
      realizedCostBasisRemoved,
      unrealizedGain,
      realizedGain,
      dividendsReceived,
      totalReturn,
      totalReturnPercentage: Math.abs(denominator) <= EPSILON ? null : totalReturn / denominator,
      sinceFirstBuyPercentage,
      firstBuyDate,
    };
  } catch {
    return emptyReturn("missing-fx", firstBuyDate);
  }
}

/** One leg per holding that reports an average price, so several accounts or a
 *  pie and a direct holding in the same instrument add up instead of one
 *  overwriting the other. */
export function brokerCostLegs(positions: readonly Position[]): BrokerCostLeg[] {
  return positions.flatMap((position) =>
    position.averagePrice === null || Math.abs(position.quantity) <= EPSILON
      ? []
      : [
          {
            amount: position.averagePrice * position.quantity,
            currency: position.currency,
            date: position.asOf,
          },
        ],
  );
}

function brokerAverageReturn(
  marketValue: number | null,
  dividends: readonly Dividend[],
  presentationCurrency: string,
  fxRates: FxRates,
  firstBuyDate: string | null,
  brokerCost: readonly BrokerCostLeg[] | undefined,
): PositionReturn {
  if (!brokerCost || brokerCost.length === 0) return emptyReturn("missing-cost", firstBuyDate);
  try {
    let remainingCostBasis = 0;
    for (const leg of brokerCost)
      remainingCostBasis += convertCurrency(
        leg.amount,
        leg.currency,
        presentationCurrency,
        leg.date,
        fxRates,
      );
    let dividendsReceived = 0;
    for (const dividend of dividends)
      dividendsReceived += convertCurrency(
        dividend.amount,
        dividend.currency,
        presentationCurrency,
        dividend.date,
        fxRates,
      );
    const unrealizedGain = marketValue === null ? null : marketValue - remainingCostBasis;
    const totalReturn = unrealizedGain === null ? null : unrealizedGain + dividendsReceived;
    return {
      status: "broker-average",
      remainingCostBasis,
      realizedCostBasisRemoved: null,
      unrealizedGain,
      realizedGain: null,
      dividendsReceived,
      totalReturn,
      totalReturnPercentage:
        totalReturn === null || Math.abs(remainingCostBasis) <= EPSILON
          ? null
          : totalReturn / remainingCostBasis,
      sinceFirstBuyPercentage: null,
      firstBuyDate,
    };
  } catch {
    return emptyReturn("missing-fx", firstBuyDate);
  }
}

function key(value: Pick<Position | Trade | Dividend, "entity" | "symbol">): string {
  return `${value.entity}\u0000${value.symbol.toUpperCase()}`;
}

export function buildCurrentPositions(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
  dividends: readonly Dividend[];
  priceBars: readonly PriceBar[];
  presentationCurrency: string;
  fxRates: FxRates;
  today: string;
}): CurrentPosition[] {
  const groups = new Map<string, Position[]>();
  for (const position of input.positions) {
    if (Math.abs(position.quantity) <= EPSILON) continue;
    const groupKey = key(position);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), position]);
  }

  // Index bars once; a per-group scan of the full history is O(symbols × bars).
  // Bars are market data without an entity, so they match every holding group
  // of the same tenant + symbol.
  const barsBySymbol = new Map<string, PriceBar[]>();
  for (const bar of input.priceBars) {
    if (bar.date > input.today) continue;
    const listKey = bar.symbol.toUpperCase();
    const list = barsBySymbol.get(listKey);
    if (list) list.push(bar);
    else barsBySymbol.set(listKey, [bar]);
  }
  for (const list of barsBySymbol.values())
    list.sort((left, right) => left.date.localeCompare(right.date));

  const current = [...groups.entries()].map(([groupKey, positions]) => {
    const sample = positions[0]!;
    const quantity = positions.reduce((sum, position) => sum + position.quantity, 0);
    const bars = barsBySymbol.get(sample.symbol.toUpperCase()) ?? [];
    const latest = bars.at(-1);
    let marketValue: number | null = null;
    let priceStatus: PositionPriceStatus = "unpriced";
    if (latest && isPriceFresh(latest.date, input.today)) {
      try {
        marketValue = convertCurrency(
          quantity * latest.close,
          latest.currency,
          input.presentationCurrency,
          input.today,
          input.fxRates,
        );
        priceStatus = latest.date === input.today ? "priced" : "forward-filled";
      } catch {
        priceStatus = "missing-fx";
      }
    }
    const calculatedReturns = calculatePositionReturn(
      quantity,
      marketValue,
      input.trades.filter((trade) => key(trade) === groupKey),
      input.dividends.filter((dividend) => key(dividend) === groupKey),
      input.presentationCurrency,
      input.fxRates,
      { valuationDate: latest?.date, brokerCost: brokerCostLegs(positions) },
    );
    const returns =
      priceStatus === "missing-fx" && calculatedReturns.status === "unpriced"
        ? { ...calculatedReturns, status: "missing-fx" as const }
        : calculatedReturns;
    return {
      symbol: sample.symbol,
      entity: sample.entity,
      ...(sample.isin ? { isin: sample.isin } : {}),
      ...(sample.description ? { description: sample.description } : {}),
      quantity,
      currency: sample.currency,
      asOf: positions
        .map((position) => position.asOf)
        .sort()
        .at(-1)!,
      marketValue,
      portfolioWeight: null,
      priceStatus,
      returns,
    } satisfies CurrentPosition;
  });

  const pricedTotal = current.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  return current.map((position) => ({
    ...position,
    portfolioWeight:
      position.marketValue === null || pricedTotal <= EPSILON
        ? null
        : position.marketValue / pricedTotal,
  }));
}
