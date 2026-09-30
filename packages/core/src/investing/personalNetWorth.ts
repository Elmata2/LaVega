import type { PortfolioValuePoint } from "./portfolio.js";

/** One day's opted-in Personal total, as apps/server's
 *  personal.net_worth_totals row reports it. */
export type PersonalNetWorthTotal = { date: string; totalCents: number };

export type NetWorthPoint = PortfolioValuePoint & {
  /** Personal's total in EUR, carried forward from the latest total on or
   *  before this date. Null on every date before the owner's first shared
   *  total, or when nothing has ever been shared — never a guessed 0. */
  personalValue: number | null;
  /** `value` (portfolio) and `personalValue` (Personal) added together,
   *  whichever of the two are known — the same "sum what's known, null only
   *  when nothing is" rule `computePortfolioValueSeries` already applies to
   *  positions and cash. This field exists only for the net worth chart;
   *  returns, risk and allocation must keep reading `value`, which this
   *  function never touches. */
  netWorth: number | null;
};

/**
 * Folds the owner's opted-in Personal totals into a portfolio value series,
 * for LaVega Investing's net worth chart only (packages/investing-web's
 * NetWorthChart/NetWorthPage). `points` and `totals` need not be sorted; ties
 * are broken by processing totals oldest first.
 *
 * `points` itself is returned unchanged in every other respect: this is an
 * additive read, not a rebuild of the portfolio series, so a caller that
 * still wants portfolio-only figures (returns, risk, allocation) keeps
 * reading `value`/`positionsValue`/`cashValue` off the same objects.
 */
export function mergeInPersonalNetWorth(
  points: readonly PortfolioValuePoint[],
  totals: readonly PersonalNetWorthTotal[],
): { points: NetWorthPoint[]; latestPersonalDate: string | null } {
  const sortedTotals = [...totals].sort((a, b) => a.date.localeCompare(b.date));
  const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));

  let cursor = 0;
  let carried: number | null = null;
  const merged = sortedPoints.map((point) => {
    while (cursor < sortedTotals.length && sortedTotals[cursor]!.date <= point.date) {
      carried = sortedTotals[cursor]!.totalCents / 100;
      cursor += 1;
    }
    const reachable = [point.value, carried].filter((v): v is number => v !== null);
    return {
      ...point,
      personalValue: carried,
      netWorth: reachable.length === 0 ? null : reachable.reduce((sum, v) => sum + v, 0),
    };
  });

  return {
    points: merged,
    latestPersonalDate: sortedTotals.at(-1)?.date ?? null,
  };
}
