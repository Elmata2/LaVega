import type { InvestingDashboardData } from "./dashboard.js";
import type { SectorExposure } from "./summary.js";

const BRIEF_HOLDINGS = 15;
const BRIEF_SECTORS = 8;

export type PortfolioConcentration = {
  largest: { symbol: string; weight: number } | null;
  top3: number | null;
  top5: number | null;
};

export function portfolioConcentration(dashboard: InvestingDashboardData): PortfolioConcentration {
  const weighted = byWeight(dashboard).filter((position) => position.portfolioWeight !== null);
  if (weighted.length === 0) return { largest: null, top3: null, top5: null };
  const share = (count: number) =>
    weighted.slice(0, count).reduce((total, position) => total + position.portfolioWeight!, 0);
  return {
    largest: { symbol: weighted[0]!.symbol, weight: weighted[0]!.portfolioWeight! },
    top3: share(3),
    top5: share(5),
  };
}

/** The per-turn portfolio context: small enough to keep the first token
 *  fast, complete enough that the agent never has to call a tool to know
 *  what the user owns. Detail beyond this comes through tools. */
export function renderPortfolioBrief(
  dashboard: InvestingDashboardData,
  sectors: readonly SectorExposure[] | null,
): string {
  const currency = dashboard.presentationCurrency;
  const latest = dashboard.portfolio.All.at(-1);
  const positions = byWeight(dashboard);
  const priced = positions.filter((position) => position.marketValue !== null);
  const costBasis = sumKnown(positions.map((position) => position.returns.remainingCostBasis));
  const totalReturn = sumKnown(positions.map((position) => position.returns.totalReturn));
  const concentration = portfolioConcentration(dashboard);
  const lines = [
    `Portfolio in ${currency}${latest ? ` as of ${latest.date}` : ""}: value ${money(latest?.value ?? null)}, ${positions.length} holdings (${priced.length} priced), open cost basis ${money(costBasis.total)}${costBasis.missing ? ` (${costBasis.missing} holdings without cost basis)` : ""}, total return on holdings ${money(totalReturn.total)}.`,
    `Concentration: largest ${concentration.largest ? `${concentration.largest.symbol} ${pct(concentration.largest.weight)}` : "n/a"}, top 3 ${pct(concentration.top3)}, top 5 ${pct(concentration.top5)}.`,
    "Holdings by weight: symbol (name) | weight | value | cost basis | total return | first buy",
    ...positions
      .slice(0, BRIEF_HOLDINGS)
      .map((position) =>
        [
          position.description ? `${position.symbol} (${position.description})` : position.symbol,
          pct(position.portfolioWeight),
          money(position.marketValue),
          money(position.returns.remainingCostBasis),
          `${money(position.returns.totalReturn)} (${pct(position.returns.totalReturnPercentage)})`,
          position.returns.firstBuyDate ?? "n/a",
        ].join(" | "),
      ),
  ];
  if (positions.length > BRIEF_HOLDINGS)
    lines.push(`...and ${positions.length - BRIEF_HOLDINGS} smaller holdings (use get_positions).`);
  lines.push(
    sectors && sectors.length > 0
      ? `Sectors, funds looked through: ${sectors
          .slice(0, BRIEF_SECTORS)
          .map((exposure) => `${exposure.sector} ${pct(exposure.weight)}`)
          .join(", ")}.`
      : "Sectors: unavailable (no stored sector profiles yet).",
  );
  if (dashboard.problems.length > 0)
    lines.push(`Data problems: ${dashboard.problems.slice(0, 5).join("; ")}.`);
  return lines.join("\n");
}

function byWeight(dashboard: InvestingDashboardData) {
  return [...dashboard.positions].sort(
    (left, right) => (right.marketValue ?? -Infinity) - (left.marketValue ?? -Infinity),
  );
}

function sumKnown(values: (number | null)[]): { total: number | null; missing: number } {
  const known = values.filter((value): value is number => value !== null);
  return {
    total: known.length > 0 ? known.reduce((total, value) => total + value, 0) : null,
    missing: values.length - known.length,
  };
}

function money(value: number | null): string {
  return value === null ? "n/a" : Math.round(value).toLocaleString("en-US");
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
