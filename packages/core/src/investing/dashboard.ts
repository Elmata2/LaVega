import type { FxRates } from "./portfolio.js";
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
import type { Position, PriceBar, Trade } from "./model.js";

export const PORTFOLIO_RANGES = ["1M", "6M", "1Y", "YTD", "All"] as const satisfies readonly PortfolioRange[];

export type InvestingDashboardPosition = {
  symbol: string;
  entity: string;
  isin?: string;
  description?: string;
  quantity: number;
  marketValue: number | null;
  currency: string;
  asOf: string;
};

export type InvestingPositionDetail = {
  symbol: string;
  description?: string;
  currency: string;
  points: PositionPricePoint[];
};

/** Finished, serializable read model consumed by investing-web. */
export type InvestingDashboardData = {
  presentationCurrency: string;
  portfolio: Record<PortfolioRange, PortfolioBenchmarkPoint[]>;
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
  priceBars: readonly PriceBar[];
  benchmarkBars: readonly PriceBar[];
  presentationCurrency: string;
  fxRates: FxRates;
  selectedSymbol?: string;
  problems?: readonly string[];
};

export function emptyInvestingDashboard(presentationCurrency = "EUR"): InvestingDashboardData {
  const portfolio = {} as Record<PortfolioRange, PortfolioBenchmarkPoint[]>;
  for (const range of PORTFOLIO_RANGES) portfolio[range] = [];
  return {
    presentationCurrency,
    portfolio,
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
  );
  const benchmark = normalizeBenchmarkSeries([...input.benchmarkBars], portfolioValues);
  const portfolio = Object.fromEntries(
    PORTFOLIO_RANGES.map((range) => [range, buildPortfolioBenchmarkSeries(portfolioValues, benchmark, range)]),
  ) as Record<PortfolioRange, PortfolioBenchmarkPoint[]>;
  const positions = [...input.positions]
    .map(({ tenantId: _tenantId, ...position }) => position)
    .sort((left, right) => `${left.symbol}\u0000${left.entity}`.localeCompare(`${right.symbol}\u0000${right.entity}`));

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

  return {
    presentationCurrency: input.presentationCurrency,
    portfolio,
    allocation: {
      instrument: bucketAllocationByInstrument([...input.positions], input.presentationCurrency, input.fxRates),
      entity: bucketAllocationByEntity([...input.positions], input.presentationCurrency, input.fxRates),
    },
    positions,
    position,
    problems: [...(input.problems ?? [])],
  };
}
