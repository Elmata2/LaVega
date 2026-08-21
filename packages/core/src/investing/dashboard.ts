import { convertCurrency, type FxRates } from "./portfolio.js";
import { bucketAllocationByEntity, bucketAllocationByInstrument, type Allocation } from "./allocation.js";
import {
  buildPortfolioBenchmarkSeries,
  computePortfolioValueSeries,
  normalizeBenchmarkSeries,
  type PortfolioBenchmarkPoint,
  type PortfolioRange,
} from "./portfolio.js";
import { placePositionMarkers, type PositionPricePoint } from "./markers.js";
import type { Dividend } from "./dividend.js";
import type { CashBalance, CashFlow, Position, PriceBar, Trade } from "./model.js";
import { buildCurrentPositions, type CurrentPosition } from "./positions.js";

export const PORTFOLIO_RANGES = ["1M", "6M", "1Y", "YTD", "All"] as const satisfies readonly PortfolioRange[];

export type InvestingDashboardPosition = CurrentPosition;

export type InvestingPositionDetail = {
  symbol: string;
  description?: string;
  currency: string;
  points: PositionPricePoint[];
};

/** Finished, serializable read model consumed by investing-web. */
export type InvestingDashboardData = {
  dataVersion: number;
  presentationCurrency: string;
  portfolio: Record<PortfolioRange, PortfolioBenchmarkPoint[]>;
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
  presentationCurrency: string;
  fxRates: FxRates;
  selectedSymbol?: string;
  problems?: readonly string[];
  today?: string;
  dataVersion?: number;
};

export function emptyInvestingDashboard(presentationCurrency = "EUR"): InvestingDashboardData {
  const portfolio = {} as Record<PortfolioRange, PortfolioBenchmarkPoint[]>;
  for (const range of PORTFOLIO_RANGES) portfolio[range] = [];
  return {
    dataVersion: 0,
    presentationCurrency,
    portfolio,
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
  const benchmark = normalizeBenchmarkSeries([...input.benchmarkBars], portfolioValues);
  const portfolio = Object.fromEntries(
    PORTFOLIO_RANGES.map((range) => [range, buildPortfolioBenchmarkSeries(portfolioValues, benchmark, range)]),
  ) as Record<PortfolioRange, PortfolioBenchmarkPoint[]>;
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
  const selectedPosition = selected
    ? input.positions.find((position) => position.symbol.toUpperCase() === selected)
    : undefined;
  const selectedBars = selected ? input.priceBars.filter((bar) => bar.symbol.toUpperCase() === selected) : [];
  const selectedTrades = selected ? input.trades.filter((trade) => trade.symbol.toUpperCase() === selected) : [];
  const selectedDividends = selected ? input.dividends.filter((dividend) => dividend.symbol.toUpperCase() === selected) : [];
  const position = selectedPosition
    ? {
        symbol: selectedPosition.symbol,
        ...(selectedPosition.description ? { description: selectedPosition.description } : {}),
        currency: selectedPosition.currency,
        points: placePositionMarkers([...selectedBars], [...selectedTrades], [...selectedDividends]),
      }
    : null;

  const externalByDate = new Map<string, number | null>();
  const seenFlows = new Set<string>();
  for (const flow of input.cashFlows ?? []) {
    if (flow.kind !== "deposit" && flow.kind !== "withdrawal") continue;
    const identity = `${flow.tenantId}\u0000${flow.entity}\u0000${flow.broker}\u0000${flow.currency}\u0000${flow.brokerFlowId ?? flow.id}`;
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
    externalCashFlows: [...externalByDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, amount]) => ({ date, amount })),
    allocation: {
      instrument: bucketAllocationByInstrument([...input.positions], input.presentationCurrency, input.fxRates),
      entity: bucketAllocationByEntity([...input.positions], input.presentationCurrency, input.fxRates),
    },
    positions,
    position,
    problems: [...(input.problems ?? [])],
  };
}
