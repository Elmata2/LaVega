import { convertCurrency, type FxRates } from "./portfolio.js";
import { bucketPricedAllocation, type Allocation } from "./allocation.js";
import {
  computePortfolioValueSeries,
  filterPortfolioValueRange,
  type PortfolioRange,
  type PortfolioValuePoint,
} from "./portfolio.js";
import { placePositionMarkers, type PositionPricePoint } from "./markers.js";
import { inCurrentShareUnits } from "./splits.js";
import type { Dividend } from "./dividend.js";
import type {
  CashBalance,
  CashFlow,
  CashHistoryCoverage,
  Position,
  PriceBar,
  Trade,
} from "./model.js";
import type { BenchmarkInstrument, BenchmarkSeries } from "./benchmarks.js";
import {
  brokerCostCoverage,
  buildCurrentPositions,
  calculatePositionReturn,
  type CurrentPosition,
  type PositionPriceStatus,
  type PositionReturn,
  type PositionReturnStatus,
} from "./positions.js";
import { valuePosition } from "./valuation.js";
import { anchoredSnapshotQuantity, latestOwnershipAnchors } from "./ownership.js";
import { orderTrades, tradeDelta } from "./quantity.js";

export const PORTFOLIO_RANGES = [
  "1M",
  "6M",
  "1Y",
  "YTD",
  "All",
] as const satisfies readonly PortfolioRange[];

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
  priceStatus: PositionPriceStatus;
  /** Close backing the current value, so a forward-filled detail is readable. */
  quoteDate: string | null;
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
  executionAt?: string;
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
  cashCoverage?: readonly CashHistoryCoverage[];
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
export function buildInvestingDashboard(reported: InvestingDashboardInput): InvestingDashboardData {
  const input = {
    ...reported,
    ...inCurrentShareUnits(reported.positions, reported.trades, reported.priceBars),
  };
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const portfolioValues = computePortfolioValueSeries(
    [...input.positions],
    [...input.trades],
    [...input.priceBars],
    input.presentationCurrency,
    input.fxRates,
    {
      cashBalances: input.cashBalances,
      cashFlows: input.cashFlows,
      cashCoverage: input.cashCoverage,
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
    today,
  });
  const positionProblems: string[] = [];
  for (const position of positions) {
    if (position.returns.problem) positionProblems.push(`${position.symbol}: ${position.returns.problem}`);
  }
  const unpricedCount = positions.filter((position) => position.marketValue === null).length;
  // Only when SOME positions are priced does a null-for-the-rest weight look
  // like a real total; if every position is dark, weights are already null
  // across the board and add nothing misleading to flag.
  if (unpricedCount > 0 && unpricedCount < positions.length) {
    positionProblems.push(
      `Portfolio weight is calculated only across priced positions: ${unpricedCount} of ${positions.length} ${positions.length === 1 ? "position is" : "positions are"} unpriced and excluded from the total.`,
    );
  }

  const selected = input.selectedSymbol?.trim().toUpperCase();
  const selectedPositions = selected
    ? input.positions.filter((position) => position.symbol.toUpperCase() === selected)
    : [];
  const selectedBars = selected
    ? input.priceBars.filter((bar) => bar.symbol.toUpperCase() === selected)
    : [];
  const selectedTrades = selected
    ? input.trades.filter((trade) => trade.symbol.toUpperCase() === selected)
    : [];
  const selectedDividends = selected
    ? input.dividends.filter((dividend) => dividend.symbol.toUpperCase() === selected)
    : [];
  const sample =
    selectedPositions[0] ?? selectedTrades[0] ?? selectedDividends[0] ?? selectedBars[0];
  const position =
    selected && sample
      ? buildPositionDetail({
          selected,
          sampleCurrency: sample.currency,
          positions: selectedPositions,
          trades: selectedTrades,
          dividends: selectedDividends,
          bars: selectedBars,
          presentationCurrency: input.presentationCurrency,
          fxRates: input.fxRates,
          today,
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
    if (flow.amount !== null) {
      try {
        converted = convertCurrency(
          flow.amount,
          flow.currency,
          input.presentationCurrency,
          flow.date,
          input.fxRates,
        );
      } catch {
        // Keep unknown owner flow visible. TWR must not skip or move it.
      }
    }
    const current = externalByDate.get(flow.date);
    externalByDate.set(
      flow.date,
      current === null || converted === null ? null : (current ?? 0) + converted,
    );
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
    externalCashFlows: [...externalByDate]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, amount]) => ({ date, amount })),
    allocation: {
      instrument: bucketPricedAllocation(positions, "instrument"),
      entity: bucketPricedAllocation(positions, "entity"),
    },
    positions,
    position,
    problems: [...(input.problems ?? []), ...positionProblems],
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
  today: string;
}): InvestingPositionDetail {
  const sourceOrderByTrade = new Map(input.trades.map((trade, index) => [trade, index]));
  const orderedTrades = orderTrades(input.trades).map((trade) => ({
    trade,
    sourceOrder: sourceOrderByTrade.get(trade)!,
  }));
  let reconstructedQuantity = 0;
  const quantityHistory: PositionQuantityChange[] = [];
  for (const { trade, sourceOrder } of orderedTrades) {
    if (trade.side === "other") continue;
    const delta = tradeDelta(trade);
    reconstructedQuantity += delta;
    quantityHistory.push({
      date: trade.date,
      quantity: reconstructedQuantity,
      delta,
      reason: trade.side,
      sourceOrder,
    });
  }
  const snapshotQuantity = anchoredSnapshotQuantity(input.positions);
  const quantity = input.positions.length > 0 ? snapshotQuantity : reconstructedQuantity;
  const status = Math.abs(quantity) > 1e-9 ? "open" : "closed";
  const bars = input.bars
    .filter((bar) => bar.date <= input.today)
    .sort((left, right) => left.date.localeCompare(right.date));
  const valuation = valuePosition({
    bars,
    quantity,
    valuationDate: input.today,
    presentationCurrency: input.presentationCurrency,
    fxRates: input.fxRates,
  });
  // A holding that is closed today holds no value; its closes stay history.
  const open = status === "open";
  const currentPrice = open ? valuation.price : null;
  const currentValue = open ? valuation.value : null;
  const dailyChange = open ? valuation.dailyChange : null;
  const dailyChangePercentage = open ? valuation.dailyChangePercentage : null;
  const valuationDate =
    status === "open"
      ? (valuation.quoteDate ?? undefined)
      : [
          ...input.trades.map((trade) => trade.date),
          ...input.dividends.map((dividend) => dividend.date),
        ]
          .sort()
          .at(-1);
  const returns = calculatePositionReturn(
    quantity,
    status === "closed" ? 0 : currentValue,
    input.trades,
    input.dividends,
    input.presentationCurrency,
    input.fxRates,
    { valuationDate, brokerCost: brokerCostCoverage(latestOwnershipAnchors(input.positions)) },
  );
  const averageCost =
    returns.remainingCostBasis === null || Math.abs(quantity) <= 1e-9
      ? null
      : returns.remainingCostBasis / quantity;
  const activity: PositionActivity[] = [
    ...orderTrades(input.trades, "reverse-chronological").flatMap((trade): PositionActivity[] =>
      trade.side === "other"
        ? []
        : [
            {
              date: trade.date,
              ...(trade.executionAt ? { executionAt: trade.executionAt } : {}),
              kind: trade.side,
              quantity: trade.quantity,
              executionPrice: trade.price,
              amount: trade.amount,
              commission: trade.commission,
              currency: trade.currency,
              sourceOrder: sourceOrderByTrade.get(trade)!,
            },
          ],
    ),
    ...input.dividends.map((dividend, index): PositionActivity => ({
      date: dividend.date,
      kind: "dividend",
      dividendAmount: dividend.amount,
      amount: dividend.amount,
      currency: dividend.currency,
      sourceOrder: input.trades.length + index,
    })),
  ].sort((left, right) => right.date.localeCompare(left.date));
  const description =
    input.positions.find((item) => item.description)?.description ??
    input.trades.find((item) => item.description)?.description ??
    input.dividends.find((item) => item.description)?.description;
  return {
    symbol: input.selected,
    ...(description ? { description } : {}),
    currency: input.presentationCurrency,
    priceCurrency: valuation.quoteCurrency ?? input.sampleCurrency,
    status,
    quantity,
    currentValue,
    dailyChange,
    dailyChangePercentage,
    currentPrice,
    priceStatus: valuation.quality,
    quoteDate: valuation.quoteDate,
    averageCost,
    returns,
    returnStatus: returns.status,
    firstBuyDate: returns.firstBuyDate,
    quantityHistory,
    activity,
    points: placePositionMarkers(bars, input.trades, input.dividends),
  };
}
