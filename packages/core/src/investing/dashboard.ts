import { convertCurrency, type FxRates } from "./portfolio.js";
import { bucketPricedAllocation, type Allocation } from "./allocation.js";
import {
  computePortfolioValueSeries,
  filterPortfolioValueRange,
  type PortfolioRange,
  type PortfolioValuePoint,
} from "./portfolio.js";
import { placePositionMarkers, type PositionPricePoint } from "./markers.js";
import type { Dividend } from "./dividend.js";
import type { CashBalance, CashFlow, Position, PriceBar, Trade } from "./model.js";
import type { BenchmarkInstrument, BenchmarkSeries } from "./benchmarks.js";
import { buildCurrentPositions, calculatePositionReturn, type CurrentPosition, type PositionReturn, type PositionReturnStatus } from "./positions.js";

export const PORTFOLIO_RANGES = ["1M", "6M", "1Y", "YTD", "All"] as const satisfies readonly PortfolioRange[];

export type InvestingDashboardPosition = CurrentPosition;

export type InvestingPositionDetail = {
  symbol: string;
  description?: string;
  currency: string;
  priceCurrency: string;
  status: "open" | "closed";
  quantity: number;
  currentValue: number | null;
  dailyChange: number | null;
  dailyChangePercentage: number | null;
  currentPrice: number | null;
  averageCost: number | null;
  returns: PositionReturn;
  returnStatus: PositionReturnStatus;
  firstBuyDate: string | null;
  quantityHistory: PositionQuantityChange[];
  activity: PositionActivity[];
  points: PositionPricePoint[];
};

export type PositionQuantityChange = {
  date: string;
  quantity: number;
  delta: number;
  reason: "buy" | "sell";
  sourceOrder: number;
};

export type PositionActivity = {
  date: string;
  kind: "buy" | "sell" | "dividend";
  quantity?: number;
  executionPrice?: number | null;
  amount?: number | null;
  commission?: number | null;
  dividendAmount?: number;
  currency: string;
  sourceOrder: number;
};

/** Finished, serializable read model consumed by investing-web. */
export type InvestingDashboardData = {
  dataVersion: number;
  presentationCurrency: string;
  portfolio: Record<PortfolioRange, PortfolioValuePoint[]>;
  benchmarks: BenchmarkSeries[];
  externalCashFlows: Array<{ date: string; amount: number | null }>;
  allocation: {
    instrument: Allocation;
    entity: Allocation;
  };
  positions: InvestingDashboardPosition[];
  position: InvestingPositionDetail | null;
  problems: string[];
};

export type InvestingDashboardInput = {
  positions: readonly Position[];
  trades: readonly Trade[];
  dividends: readonly Dividend[];
  cashBalances?: readonly CashBalance[];
  cashFlows?: readonly CashFlow[];
  priceBars: readonly PriceBar[];
  benchmarkBars: readonly PriceBar[];
  benchmarkInstruments?: readonly BenchmarkInstrument[];
  presentationCurrency: string;
  fxRates: FxRates;
  selectedSymbol?: string;
  problems?: readonly string[];
  today?: string;
  dataVersion?: number;
};

export function emptyInvestingDashboard(presentationCurrency = "EUR"): InvestingDashboardData {
  const portfolio = {} as Record<PortfolioRange, PortfolioValuePoint[]>;
  for (const range of PORTFOLIO_RANGES) portfolio[range] = [];
  return {
    dataVersion: 0,
    presentationCurrency,
    portfolio,
    benchmarks: [],
    externalCashFlows: [],
    allocation: {
      instrument: { buckets: [], unpriced: [] },
      entity: { buckets: [], unpriced: [] },
    },
    positions: [],
    position: null,
    problems: [],
  };
}

/** Shape local domain records once, before they cross the server boundary. */
export function buildInvestingDashboard(input: InvestingDashboardInput): InvestingDashboardData {
  const portfolioValues = computePortfolioValueSeries(
    [...input.positions],
    [...input.trades],
    [...input.priceBars],
    input.presentationCurrency,
    input.fxRates,
    {
      cashBalances: input.cashBalances,
      cashFlows: input.cashFlows,
      dividends: input.dividends,
      today: input.today,
    },
  );
  const portfolio = Object.fromEntries(
    PORTFOLIO_RANGES.map((range) => [range, filterPortfolioValueRange(portfolioValues, range)]),
  ) as Record<PortfolioRange, PortfolioValuePoint[]>;
  const positions = buildCurrentPositions({
    positions: input.positions,
    trades: input.trades,
    dividends: input.dividends,
    priceBars: input.priceBars,
    presentationCurrency: input.presentationCurrency,
    fxRates: input.fxRates,
    today: input.today ?? new Date().toISOString().slice(0, 10),
  });

  const selected = input.selectedSymbol?.trim().toUpperCase();
  const selectedPositions = selected
    ? input.positions.filter((position) => position.symbol.toUpperCase() === selected)
    : [];
  const selectedBars = selected ? input.priceBars.filter((bar) => bar.symbol.toUpperCase() === selected) : [];
  const selectedTrades = selected ? input.trades.filter((trade) => trade.symbol.toUpperCase() === selected) : [];
  const selectedDividends = selected ? input.dividends.filter((dividend) => dividend.symbol.toUpperCase() === selected) : [];
  const sample = selectedPositions[0] ?? selectedTrades[0] ?? selectedDividends[0] ?? selectedBars[0];
  const position = selected && sample
    ? buildPositionDetail({
        selected,
        sampleCurrency: sample.currency,
        positions: selectedPositions,
        trades: selectedTrades,
        dividends: selectedDividends,
        bars: selectedBars,
        presentationCurrency: input.presentationCurrency,
        fxRates: input.fxRates,
      })
    : null;

  const externalByDate = new Map<string, number | null>();
  const seenFlows = new Set<string>();
  for (const flow of input.cashFlows ?? []) {
    if (flow.kind !== "deposit" && flow.kind !== "withdrawal") continue;
    const identity = `${flow.entity}\u0000${flow.broker}\u0000${flow.currency}\u0000${flow.brokerFlowId ?? flow.id}`;
    if (seenFlows.has(identity)) continue;
    seenFlows.add(identity);
    let converted: number | null = null;
    try {
      converted = convertCurrency(flow.amount, flow.currency, input.presentationCurrency, flow.date, input.fxRates);
    } catch {
      // Keep unknown owner flow visible. TWR must not skip or move it.
    }
    const current = externalByDate.get(flow.date);
    externalByDate.set(flow.date, current === null || converted === null ? null : (current ?? 0) + converted);
  }

  return {
    dataVersion: input.dataVersion ?? 0,
    presentationCurrency: input.presentationCurrency,
    portfolio,
    benchmarks: (input.benchmarkInstruments ?? []).map((instrument) => ({
      ...instrument,
      points: input.benchmarkBars
        .filter((bar) => bar.symbol.toUpperCase() === instrument.symbol.toUpperCase())
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((bar) => ({ date: bar.date, value: bar.close })),
    })),
    externalCashFlows: [...externalByDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, amount]) => ({ date, amount })),
    allocation: {
      instrument: bucketPricedAllocation(positions, "instrument"),
      entity: bucketPricedAllocation(positions, "entity"),
    },
    positions,
    position,
    problems: [...(input.problems ?? [])],
  };
}

function buildPositionDetail(input: {
  selected: string;
  sampleCurrency: string;
  positions: Position[];
  trades: Trade[];
  dividends: Dividend[];
  bars: PriceBar[];
  presentationCurrency: string;
  fxRates: FxRates;
}): InvestingPositionDetail {
  const orderedTrades = input.trades.map((trade, sourceOrder) => ({ trade, sourceOrder }))
    .sort((left, right) => left.trade.date.localeCompare(right.trade.date) || left.sourceOrder - right.sourceOrder);
  let reconstructedQuantity = 0;
  const quantityHistory: PositionQuantityChange[] = [];
  for (const { trade, sourceOrder } of orderedTrades) {
    if (trade.side === "other") continue;
    const delta = trade.side === "buy" ? trade.quantity : -trade.quantity;
    reconstructedQuantity += delta;
    quantityHistory.push({ date: trade.date, quantity: reconstructedQuantity, delta, reason: trade.side, sourceOrder });
  }
  const snapshotQuantity = input.positions.reduce((sum, item) => sum + item.quantity, 0);
  const quantity = input.positions.length > 0 ? snapshotQuantity : reconstructedQuantity;
  const status = Math.abs(quantity) > 1e-9 ? "open" : "closed";
  const bars = [...input.bars].sort((left, right) => left.date.localeCompare(right.date));
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  let currentPrice: number | null = null;
  let currentValue: number | null = null;
  let dailyChange: number | null = null;
  let dailyChangePercentage: number | null = null;
  if (status === "open" && latest) {
    try {
      currentPrice = convertCurrency(latest.close, latest.currency, input.presentationCurrency, latest.date, input.fxRates);
      currentValue = currentPrice * quantity;
      if (previous) {
        const priorPrice = convertCurrency(previous.close, previous.currency, input.presentationCurrency, previous.date, input.fxRates);
        dailyChange = (currentPrice - priorPrice) * quantity;
        dailyChangePercentage = Math.abs(priorPrice) <= 1e-9 ? null : (currentPrice - priorPrice) / priorPrice;
      }
    } catch {
      currentPrice = null;
      currentValue = null;
      dailyChange = null;
      dailyChangePercentage = null;
    }
  }
  const valuationDate = status === "open"
    ? latest?.date
    : [...input.trades.map((trade) => trade.date), ...input.dividends.map((dividend) => dividend.date)].sort().at(-1);
  const returns = calculatePositionReturn(quantity, status === "closed" ? 0 : currentValue, input.trades, input.dividends, input.presentationCurrency, input.fxRates, { valuationDate });
  const averageCost = returns.remainingCostBasis === null || Math.abs(quantity) <= 1e-9 ? null : returns.remainingCostBasis / quantity;
  const activity: PositionActivity[] = [
    ...input.trades.flatMap((trade, sourceOrder): PositionActivity[] => trade.side === "other" ? [] : [{
      date: trade.date,
      kind: trade.side,
      quantity: trade.quantity,
      executionPrice: trade.price,
      amount: trade.amount,
      commission: trade.commission,
      currency: trade.currency,
      sourceOrder,
    }]),
    ...input.dividends.map((dividend, index): PositionActivity => ({
      date: dividend.date,
      kind: "dividend",
      dividendAmount: dividend.amount,
      amount: dividend.amount,
      currency: dividend.currency,
      sourceOrder: input.trades.length + index,
    })),
  ].sort((left, right) => right.date.localeCompare(left.date) || left.sourceOrder - right.sourceOrder);
  const description = input.positions.find((item) => item.description)?.description
    ?? input.trades.find((item) => item.description)?.description
    ?? input.dividends.find((item) => item.description)?.description;
  return {
    symbol: input.selected,
    ...(description ? { description } : {}),
    currency: input.presentationCurrency,
    priceCurrency: latest?.currency ?? input.sampleCurrency,
    status,
    quantity,
    currentValue,
    dailyChange,
    dailyChangePercentage,
    currentPrice,
    averageCost,
    returns,
    returnStatus: returns.status,
    firstBuyDate: returns.firstBuyDate,
    quantityHistory,
    activity,
    points: placePositionMarkers(bars, input.trades, input.dividends),
  };
}
