import { buildIndexedSeries, type InvestingDashboardData } from "@lavega/core";

/** The headline figures read from one dashboard payload. The Overview header
 *  and the "Key figures" widget both render these, so the two can never
 *  disagree about what the portfolio is worth. A figure that cannot be known
 *  is `null`, never zero. */
export type PortfolioFigures = {
  latest: InvestingDashboardData["portfolio"]["All"][number] | undefined;
  previous: InvestingDashboardData["portfolio"]["All"][number] | undefined;
  portfolioValue: number | null;
  usingPositionsFallback: boolean;
  dailyChange: number | null;
  dailyChangePercentage: number | null;
  totalReturn: number | null;
};

export function portfolioFigures(data: InvestingDashboardData): PortfolioFigures {
  const points = data.portfolio.All;
  const latest = points.at(-1);
  const previous = points.at(-2);
  const pricedPositionsValue = data.positions.reduce(
    (sum, position) => sum + (position.marketValue ?? 0),
    0,
  );
  const portfolioValue = latest?.value ?? (pricedPositionsValue > 0 ? pricedPositionsValue : null);
  const usingPositionsFallback =
    (latest?.value === null || latest?.value === undefined) && pricedPositionsValue > 0;
  const dailyChange =
    latest?.value !== null &&
    latest?.value !== undefined &&
    previous?.value !== null &&
    previous?.value !== undefined
      ? latest.value - previous.value
      : null;
  const dailyChangePercentage =
    dailyChange !== null && previous?.value ? dailyChange / previous.value : null;
  const totalReturn =
    buildIndexedSeries(points, [], data.externalCashFlows).at(-1)?.portfolioReturn ?? null;
  return {
    latest,
    previous,
    portfolioValue,
    usingPositionsFallback,
    dailyChange,
    dailyChangePercentage,
    totalReturn,
  };
}

export function formatMoney(
  value: number,
  currency: string,
  signDisplay: "auto" | "always" = "auto",
): string {
  return value.toLocaleString("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    signDisplay,
  });
}

export function formatSignedPercent(value: number): string {
  return value.toLocaleString("en-GB", {
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay: "always",
  });
}

const holdings = (count: number) => `${count} ${count === 1 ? "holding" : "holdings"}`;

/** Why the value is not the whole truth, in one short line, or null when it is.
 *  Names counts, not tickers; the tickers live in the notes below the row. */
export function valueQualifier(figures: PortfolioFigures): string | null {
  const { latest, usingPositionsFallback } = figures;
  const parts: string[] = [];
  if (usingPositionsFallback) parts.push("Priced positions only; cash and history are missing");
  if (latest && latest.unpriced.length > 0)
    parts.push(`No usable price for ${holdings(latest.unpriced.length)}`);
  if (latest && latest.cashUnknown.length > 0)
    parts.push(
      `Cash history unknown for ${latest.cashUnknown.length} ${latest.cashUnknown.length === 1 ? "account" : "accounts"}`,
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The reason a figure derived from history is unknown. */
export function historyReason(figures: PortfolioFigures, pointCount: number): string {
  const partly = valueQualifier(figures);
  if (partly && !figures.usingPositionsFallback) return partly;
  if (pointCount < 2) return "Needs at least two days of valuation history";
  return "The valuation history has gaps";
}
