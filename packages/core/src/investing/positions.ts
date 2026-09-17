import type { Dividend } from "./dividend.js";
import type { Position, PriceBar, Trade } from "./model.js";
import { convertCurrency, type FxRates } from "./portfolio.js";
import { latestOwnershipAnchors } from "./ownership.js";
import { solveXirr } from "./benchmarks.js";
import { orderTrades } from "./quantity.js";
import { valuePosition, type QuoteQuality } from "./valuation.js";

export type PositionPriceStatus = QuoteQuality;
export type PositionReturnStatus =
  | "available"
  | "broker-unrealized"
  | "missing-cost"
  | "missing-fx"
  | "unpriced";

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

type BrokerCostLeg = { amount: number; currency: string; date: string };
export type BrokerCostCoverage =
  | { status: "complete"; heldQuantity: number; legs: readonly BrokerCostLeg[] }
  | { status: "incomplete"; heldQuantity: number; coveredQuantity: number };

export function calculatePositionReturn(
  quantity: number,
  marketValue: number | null,
  trades: readonly Trade[],
  dividends: readonly Dividend[],
  presentationCurrency: string,
  fxRates: FxRates,
  options: { valuationDate?: string; brokerCost?: BrokerCostCoverage } = {},
): PositionReturn {
  const orderedTrades = orderTrades(trades);
  const firstBuyDate = orderedTrades.find((trade) => trade.side === "buy")?.date ?? null;
  const fallback = () =>
    brokerCostReturn(
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

export function brokerCostCoverage(positions: readonly Position[]): BrokerCostCoverage {
  const held = positions.filter((position) => Math.abs(position.quantity) > EPSILON);
  const heldQuantity = held.reduce((sum, position) => sum + Math.abs(position.quantity), 0);
  const known = held.filter(
    (
      position,
    ): position is Position & {
      brokerCost: Extract<Position["brokerCost"], { status: "known" }>;
    } => position.brokerCost?.status === "known",
  );
  const coveredQuantity = known.reduce((sum, position) => sum + Math.abs(position.quantity), 0);
  if (coveredQuantity !== heldQuantity)
    return { status: "incomplete", heldQuantity, coveredQuantity };
  return {
    status: "complete",
    heldQuantity,
    legs: known.map((position) => ({
      amount: position.brokerCost.amount,
      currency: position.brokerCost.currency,
      date: position.asOf,
    })),
  };
}

function brokerCostReturn(
  marketValue: number | null,
  dividends: readonly Dividend[],
  presentationCurrency: string,
  fxRates: FxRates,
  firstBuyDate: string | null,
  brokerCost: BrokerCostCoverage | undefined,
): PositionReturn {
  if (
    !brokerCost ||
    brokerCost.status !== "complete" ||
    Math.abs(brokerCost.heldQuantity) <= EPSILON
  )
    return emptyReturn("missing-cost", firstBuyDate);
  try {
    let remainingCostBasis = 0;
    for (const leg of brokerCost.legs)
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
    return {
      status: "broker-unrealized",
      remainingCostBasis,
      realizedCostBasisRemoved: null,
      unrealizedGain,
      realizedGain: null,
      dividendsReceived,
      totalReturn: null,
      totalReturnPercentage: null,
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
  // Grouped by entity + symbol because that is the row a reader wants, but the
  // quantity inside a group is rebuilt per ownership key first: a group can
  // hold several brokers' snapshots, and only snapshots of the same account
  // supersede one another by date.
  const groups = new Map<string, Position[]>();
  for (const position of input.positions) {
    const groupKey = key(position);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), position]);
  }

  // Index bars once; a per-group scan of the full history is O(symbols × bars).
  // Bars are market data without an entity, so they match every holding group
  // of the same tenant + symbol.
  const barsBySymbol = new Map<string, PriceBar[]>();
  for (const bar of input.priceBars) {
    const listKey = bar.symbol.toUpperCase();
    const list = barsBySymbol.get(listKey);
    if (list) list.push(bar);
    else barsBySymbol.set(listKey, [bar]);
  }

  const current = [...groups.entries()].flatMap(([groupKey, positions]) => {
    const anchors = latestOwnershipAnchors(positions);
    const sample = anchors[0]!;
    const quantity = anchors.reduce((sum, position) => sum + position.quantity, 0);
    // A holding every owner has closed out is not a row, and neither is one
    // whose brokers' remaining quantities happen to cancel.
    if (Math.abs(quantity) <= EPSILON) return [];
    const valuation = valuePosition({
      bars: barsBySymbol.get(sample.symbol.toUpperCase()) ?? [],
      quantity,
      valuationDate: input.today,
      presentationCurrency: input.presentationCurrency,
      fxRates: input.fxRates,
    });
    const marketValue = valuation.value;
    const priceStatus = valuation.quality;
    const calculatedReturns = calculatePositionReturn(
      quantity,
      marketValue,
      input.trades.filter((trade) => key(trade) === groupKey),
      input.dividends.filter((dividend) => key(dividend) === groupKey),
      input.presentationCurrency,
      input.fxRates,
      {
        ...(valuation.quoteDate ? { valuationDate: valuation.quoteDate } : {}),
        brokerCost: brokerCostCoverage(anchors),
      },
    );
    const returns =
      priceStatus === "missing-fx" && calculatedReturns.status === "unpriced"
        ? { ...calculatedReturns, status: "missing-fx" as const }
        : calculatedReturns;
    const row = {
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
    return [row];
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
