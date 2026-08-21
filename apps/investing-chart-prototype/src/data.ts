// Synthetic daily points over a 90-day "3M-ish" range, shaped like the real
// domain: two value series (portfolio/benchmark), two TWR cumulative-return
// series (since range start), and two XIRR since-range-start series that
// run hot and noisy in the first few days (annualizing a tiny window
// exaggerates any move) before settling down — a real trait of the metric
// the tooltip has to survive gracefully, not an artifact of the fake data.

export type PortfolioPoint = {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  portfolioTwr: number; // cumulative return since range start, e.g. 0.084 = +8.4%
  benchmarkTwr: number;
  portfolioXirr: number; // annualized, since range start
  benchmarkXirr: number;
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generatePoints(days = 90): PortfolioPoint[] {
  const rand = seededRandom(42);
  const points: PortfolioPoint[] = [];
  const start = new Date("2026-05-24T00:00:00Z");
  const portfolioStart = 42_180;
  const benchmarkStart = 5_120;

  let portfolioValue = portfolioStart;
  let benchmarkValue = benchmarkStart;

  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);

    portfolioValue *= 1 + (rand() - 0.46) * 0.014;
    benchmarkValue *= 1 + (rand() - 0.47) * 0.011;

    const portfolioTwr = portfolioValue / portfolioStart - 1;
    const benchmarkTwr = benchmarkValue / benchmarkStart - 1;

    // Annualize the since-range-start return over the elapsed window.
    // With <5 trading days elapsed this blows up — realistic, and the
    // tooltip has to format it without breaking layout.
    const yearsElapsed = Math.max(i, 1) / 365;
    const portfolioXirr = Math.pow(1 + portfolioTwr, 1 / yearsElapsed) - 1;
    const benchmarkXirr = Math.pow(1 + benchmarkTwr, 1 / yearsElapsed) - 1;

    points.push({
      date: date.toISOString().slice(0, 10),
      portfolioValue: Math.round(portfolioValue * 100) / 100,
      benchmarkValue: Math.round(benchmarkValue * 100) / 100,
      portfolioTwr,
      benchmarkTwr,
      portfolioXirr,
      benchmarkXirr,
    });
  }

  return points;
}
