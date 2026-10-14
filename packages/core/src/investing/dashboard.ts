import { Schema } from "effect";
import { convertCurrency, MissingFxRateError, type FxRates } from "./portfolio.js";
import type { DeepMutable } from "./schema.js";
import { bucketPricedAllocation } from "./allocation.js";
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
import type { BenchmarkInstrument } from "./benchmarks.js";
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
import { buildRiskProjection } from "./risk.js";

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

/** One of the largest held positions, weighted against the priced total. */
export type CompositionTopPosition = {
  symbol: string;
  weight: number;
  description?: string;
};

/** Current composition, projected from this read model at build time: the
 *  largest positions and the priced / missing / estimated holding counts.
 *  Pure over `positions`, so it rides the version-keyed snapshot exactly as
 *  `risk` does and no caller recomputes it on the request path. */
export type InvestingComposition = {
  topPositions: CompositionTopPosition[];
  pricedHoldings: number;
  missingHoldings: number;
  estimatedHoldings: number;
};

const NullableNumber = Schema.NullOr(Schema.Number);
const NullableString = Schema.NullOr(Schema.String);
const StringList = Schema.Array(Schema.String);
const PositionReturnStatusSchema = Schema.Union([
  Schema.Literal("available"),
  Schema.Literal("broker-unrealized"),
  Schema.Literal("missing-cost"),
  Schema.Literal("missing-fx"),
  Schema.Literal("unpriced"),
]);
const PositionPriceStatusSchema = Schema.Union([
  Schema.Literal("priced"),
  Schema.Literal("forward-filled"),
  Schema.Literal("unpriced"),
  Schema.Literal("missing-fx"),
]);

const AllocationBucketSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  value: NullableNumber,
  unpriced: Schema.Boolean,
});
const AllocationSchema = Schema.Struct({
  buckets: Schema.Array(AllocationBucketSchema),
  unpriced: StringList,
});
const PortfolioValuePointSchema = Schema.Struct({
  date: Schema.String,
  positionsValue: NullableNumber,
  cashValue: NullableNumber,
  value: NullableNumber,
  unpriced: StringList,
  forwardFilled: StringList,
  cashUnknown: StringList,
  cashEstimated: Schema.optional(StringList),
  cashShortfall: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  holdingsUnknown: Schema.optional(StringList),
  unaccountedValue: Schema.optional(NullableNumber),
});
const BenchmarkSeriesSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  exchange: Schema.String,
  currency: Schema.String,
  points: Schema.Array(Schema.Struct({ date: Schema.String, value: NullableNumber })),
  converted: Schema.optional(Schema.Boolean),
});
const ExternalCashFlowSchema = Schema.Struct({ date: Schema.String, amount: NullableNumber });
const PositionReturnSchema = Schema.Struct({
  status: PositionReturnStatusSchema,
  remainingCostBasis: NullableNumber,
  realizedCostBasisRemoved: NullableNumber,
  unrealizedGain: NullableNumber,
  realizedGain: NullableNumber,
  dividendsReceived: NullableNumber,
  totalReturn: NullableNumber,
  totalReturnPercentage: NullableNumber,
  sinceFirstBuyPercentage: NullableNumber,
  firstBuyDate: NullableString,
  problem: Schema.optional(Schema.String),
});
const CurrentPositionSchema = Schema.Struct({
  symbol: Schema.String,
  entity: Schema.String,
  isin: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  quantity: Schema.Number,
  currency: Schema.String,
  asOf: Schema.String,
  marketValue: NullableNumber,
  portfolioWeight: NullableNumber,
  priceStatus: PositionPriceStatusSchema,
  returns: PositionReturnSchema,
});
const PositionMarkerSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("buy"), Schema.Literal("sell"), Schema.Literal("dividend")]),
  eventDate: Schema.String,
  label: Schema.String,
  quantity: Schema.optional(Schema.Number),
  executionPrice: Schema.optional(NullableNumber),
  amount: Schema.optional(Schema.Number),
  commission: Schema.optional(NullableNumber),
  dividendAmount: Schema.optional(Schema.Number),
  currency: Schema.optional(Schema.String),
});
const PositionPricePointSchema = Schema.Struct({
  symbol: Schema.String,
  date: Schema.String,
  close: Schema.Number,
  currency: Schema.String,
  split: Schema.optional(Schema.Number),
  markers: Schema.Array(PositionMarkerSchema),
});
const PositionQuantityChangeSchema = Schema.Struct({
  date: Schema.String,
  quantity: Schema.Number,
  delta: Schema.Number,
  reason: Schema.Union([Schema.Literal("buy"), Schema.Literal("sell")]),
  sourceOrder: Schema.Number,
});
const PositionActivitySchema = Schema.Struct({
  date: Schema.String,
  executionAt: Schema.optional(Schema.String),
  kind: Schema.Union([Schema.Literal("buy"), Schema.Literal("sell"), Schema.Literal("dividend")]),
  quantity: Schema.optional(Schema.Number),
  executionPrice: Schema.optional(NullableNumber),
  amount: Schema.optional(NullableNumber),
  commission: Schema.optional(NullableNumber),
  dividendAmount: Schema.optional(Schema.Number),
  currency: Schema.String,
  sourceOrder: Schema.Number,
});
const PositionDetailSchema = Schema.Struct({
  symbol: Schema.String,
  description: Schema.optional(Schema.String),
  currency: Schema.String,
  priceCurrency: Schema.String,
  status: Schema.Union([Schema.Literal("open"), Schema.Literal("closed")]),
  quantity: Schema.Number,
  currentValue: NullableNumber,
  dailyChange: NullableNumber,
  dailyChangePercentage: NullableNumber,
  currentPrice: NullableNumber,
  priceStatus: PositionPriceStatusSchema,
  quoteDate: NullableString,
  averageCost: NullableNumber,
  returns: PositionReturnSchema,
  returnStatus: PositionReturnStatusSchema,
  firstBuyDate: NullableString,
  quantityHistory: Schema.Array(PositionQuantityChangeSchema),
  activity: Schema.Array(PositionActivitySchema),
  points: Schema.Array(PositionPricePointSchema),
});
const CompositionTopPositionSchema = Schema.Struct({
  symbol: Schema.String,
  weight: Schema.Number,
  description: Schema.optional(Schema.String),
});
const CompositionSchema = Schema.Struct({
  topPositions: Schema.Array(CompositionTopPositionSchema),
  pricedHoldings: Schema.Number,
  missingHoldings: Schema.Number,
  estimatedHoldings: Schema.Number,
});
const RiskRangeSchema = Schema.Union([
  Schema.Literal("6M"),
  Schema.Literal("1Y"),
  Schema.Literal("All"),
]);
const PortfolioMetricsSchema = Schema.Struct({
  dailyVolatility: NullableNumber,
  annualizedVolatility: NullableNumber,
  beta: NullableNumber,
  alpha: NullableNumber,
  maxDrawdown: NullableNumber,
  observationDays: Schema.Number,
  excludedIntervals: Schema.Number,
  pairedObservationDays: Schema.Number,
  startDate: NullableString,
  endDate: NullableString,
});
const HistoricalRiskSchema = Schema.Struct({
  status: Schema.Union([Schema.Literal("estimate"), Schema.Literal("unavailable")]),
  range: RiskRangeSchema,
  from: NullableString,
  to: NullableString,
  drawdownFrom: NullableString,
  minimumObservations: Schema.Number,
  benchmark: Schema.NullOr(
    Schema.Struct({ symbol: Schema.String, name: Schema.String, currency: Schema.String }),
  ),
  benchmarks: Schema.Array(
    Schema.Struct({ symbol: Schema.String, name: Schema.String, currency: Schema.String }),
  ),
  reasons: StringList,
  missingHoldings: StringList,
  missingPrices: StringList,
  coverage: NullableNumber,
  currency: Schema.String,
});
const HistoricalRiskReportSchema = Schema.Struct({
  metrics: PortfolioMetricsSchema,
  risk: HistoricalRiskSchema,
});
const RiskByRangeSchema = Schema.Struct({
  "6M": Schema.optional(HistoricalRiskReportSchema),
  "1Y": Schema.optional(HistoricalRiskReportSchema),
  All: Schema.optional(HistoricalRiskReportSchema),
});
const RiskProjectionSchema = Schema.Struct({
  byBenchmark: Schema.Record(Schema.String, RiskByRangeSchema),
  defaultBenchmark: NullableString,
});

/** Finished, serializable read model consumed by investing-web. Defined once as
 *  an Effect schema, so the server encodes and the client decodes the same
 *  contract and the TypeScript type cannot drift from it. */
export const InvestingDashboardDataSchema = Schema.Struct({
  dataVersion: Schema.Number,
  presentationCurrency: Schema.String,
  portfolio: Schema.Record(
    Schema.Union([
      Schema.Literal("1M"),
      Schema.Literal("6M"),
      Schema.Literal("1Y"),
      Schema.Literal("YTD"),
      Schema.Literal("All"),
    ]),
    Schema.Array(PortfolioValuePointSchema),
  ),
  benchmarks: Schema.Array(BenchmarkSeriesSchema),
  externalCashFlows: Schema.Array(ExternalCashFlowSchema),
  allocation: Schema.Struct({ instrument: AllocationSchema, entity: AllocationSchema }),
  positions: Schema.Array(CurrentPositionSchema),
  position: Schema.NullOr(PositionDetailSchema),
  problems: StringList,
  risk: RiskProjectionSchema,
  composition: CompositionSchema,
});

export type InvestingDashboardData = DeepMutable<
  Schema.Schema.Type<typeof InvestingDashboardDataSchema>
>;

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

/** The most the composition projection ever names. */
const COMPOSITION_TOP_POSITIONS = 5;

/** Positions ordered by current market value, largest first; an unpriced
 *  position (a null value) sorts last. One ordering shared by the composition
 *  projection and the portfolio-agent snapshot, so the two never disagree. */
export function positionsByMarketValueDesc<T extends { marketValue: number | null }>(
  positions: readonly T[],
): T[] {
  return [...positions].sort((left, right) => (right.marketValue ?? -1) - (left.marketValue ?? -1));
}

/** The largest priced positions and the priced / missing / estimated holding
 *  counts, over an already-built position set. Pure: the same positions always
 *  produce the same composition. */
export function buildCompositionProjection(
  positions: readonly InvestingDashboardPosition[],
): InvestingComposition {
  const priced = positions.filter(
    (position): position is InvestingDashboardPosition & { marketValue: number } =>
      position.marketValue !== null && position.marketValue > 0,
  );
  const totalValue = priced.reduce((sum, position) => sum + position.marketValue, 0);
  const topPositions = positionsByMarketValueDesc(priced)
    .slice(0, COMPOSITION_TOP_POSITIONS)
    .map((position) => ({
      symbol: position.symbol,
      weight: totalValue > 0 ? position.marketValue / totalValue : 0,
      ...(position.description ? { description: position.description } : {}),
    }));
  return {
    topPositions,
    pricedHoldings: priced.length,
    missingHoldings: positions.filter((position) => position.marketValue === null).length,
    estimatedHoldings: positions.filter((position) => position.priceStatus === "forward-filled")
      .length,
  };
}

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
    risk: { byBenchmark: {}, defaultBenchmark: null },
    composition: buildCompositionProjection([]),
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
    if (position.returns.problem)
      positionProblems.push(`${position.symbol}: ${position.returns.problem}`);
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

  const dashboard: InvestingDashboardData = {
    dataVersion: input.dataVersion ?? 0,
    presentationCurrency: input.presentationCurrency,
    portfolio,
    benchmarks: (input.benchmarkInstruments ?? []).map((instrument) => {
      const isConverted = instrument.currency !== input.presentationCurrency;
      const bars = input.benchmarkBars
        .filter((bar) => bar.symbol.toUpperCase() === instrument.symbol.toUpperCase())
        .sort((left, right) => left.date.localeCompare(right.date));
      return {
        ...instrument,
        currency: isConverted ? input.presentationCurrency : instrument.currency,
        converted: isConverted,
        points: bars.map((bar) => {
          if (!isConverted) return { date: bar.date, value: bar.close };
          try {
            return {
              date: bar.date,
              value: convertCurrency(
                bar.close,
                instrument.currency,
                input.presentationCurrency,
                bar.date,
                input.fxRates,
              ),
            };
          } catch (error) {
            if (error instanceof MissingFxRateError) return { date: bar.date, value: null };
            throw error;
          }
        }),
      };
    }),
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
    risk: { byBenchmark: {}, defaultBenchmark: null },
    composition: buildCompositionProjection(positions),
  };
  return { ...dashboard, risk: buildRiskProjection(dashboard) };
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
