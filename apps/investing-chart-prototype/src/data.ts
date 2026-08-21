// Mock data shaped like InvestingDashboardData (@lavega/core), trimmed to what
// the layout variants need. Not wired to the real API — this prototype answers
// "what goes where", not "does the backend work".

export type ChartPoint = { date: string; portfolioValue: number; benchmarkValue: number };

export const portfolioValue = 84_612;
export const dayChangeEur = 612;
export const dayChangePct = 0.73;
export const totalReturnEur = 9_840;
export const totalReturnPct = 13.2;

export const chartPoints: ChartPoint[] = Array.from({ length: 30 }, (_, day) => {
  const base = 78_000 + day * 220;
  const wobble = Math.sin(day / 3.4) * 900;
  const benchWobble = Math.sin(day / 3.1 + 1) * 700;
  return {
    date: new Date(2026, 6, day + 1).toISOString().slice(0, 10),
    portfolioValue: Math.round(base + wobble),
    benchmarkValue: Math.round(76_500 + day * 190 + benchWobble),
  };
});

export const allocation = [
  { key: "vwce", label: "VWCE — FTSE All-World", value: 41_200, color: "hsl(var(--chart-blue))" },
  { key: "iwda", label: "IWDA — MSCI World", value: 22_800, color: "hsl(var(--chart-teal))" },
  { key: "aapl", label: "Apple", value: 11_400, color: "hsl(var(--chart-purple))" },
  { key: "cash", label: "Cash (IBKR)", value: 6_412, color: "hsl(var(--chart-amber))" },
  { key: "other", label: "Overig", value: 2_800, color: "hsl(var(--chart-coral))" },
];

export const positions = [
  { symbol: "VWCE", description: "Vanguard FTSE All-World", entity: "IBKR", quantity: 312, valueEur: 41_200 },
  { symbol: "IWDA", description: "iShares Core MSCI World", entity: "Trading 212", quantity: 198, valueEur: 22_800 },
  { symbol: "AAPL", description: "Apple Inc.", entity: "IBKR", quantity: 45, valueEur: 11_400 },
  { symbol: "ASML", description: "ASML Holding", entity: "IBKR", quantity: 6, valueEur: 4_200 },
  { symbol: "MSFT", description: "Microsoft Corp.", entity: "Trading 212", quantity: 9, valueEur: 3_600 },
];

export const money = (value: number) => value.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
