export type Point = { date: Date; label: string; portfolio: number; benchmark: number };

const DAY = 86_400_000;
const start = Date.UTC(2021, 7, 6);

// Deterministic five-year daily data. Both charts receive this same array.
export const points: Point[] = Array.from({ length: 1827 }, (_, index) => {
  const date = new Date(start + index * DAY);
  const market = index * 21 + Math.sin(index / 43) * 5_200 + Math.sin(index / 137) * 7_400;
  const portfolio = 100_000 + market + Math.sin(index / 17) * 1_400 + Math.max(0, index - 980) * 7;
  const benchmark = 100_000 + index * 18.5 + Math.sin(index / 45) * 4_800 + Math.sin(index / 140) * 6_900;
  return { date, label: date.toISOString().slice(0, 10), portfolio, benchmark };
});

export const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const pctGain = ((points.at(-1)!.portfolio / points[0].portfolio - 1) * 100).toFixed(1);
