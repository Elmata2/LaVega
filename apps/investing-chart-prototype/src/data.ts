// Deterministic two-year daily data: portfolio TWR + up to three benchmarks,
// indexed to 0% at the series start — matches the "Chart modes" ticket
// (issue 75), which this prototype takes as given and builds interaction on top of.
export type Point = {
  date: Date;
  label: string;
  portfolio: number;
  spx: number;
  world: number;
  aex: number;
};

const DAY = 86_400_000;
const start = Date.UTC(2024, 7, 6);

export const points: Point[] = Array.from({ length: 730 }, (_, index) => {
  const date = new Date(start + index * DAY);
  return {
    date,
    label: date.toISOString().slice(0, 10),
    portfolio: index * 0.052 + Math.sin(index / 41) * 6 + Math.sin(index / 133) * 9 + Math.max(0, index - 520) * 0.08,
    spx: index * 0.041 + Math.sin(index / 47) * 5 + Math.sin(index / 151) * 7,
    world: index * 0.034 + Math.sin(index / 39) * 4.5 + Math.sin(index / 160) * 6,
    aex: index * 0.028 + Math.sin(index / 33) * 7 + Math.sin(index / 97) * 5,
  };
});

// Trades feeding the click-to-drill stub: buys on the portfolio line only,
// sparse enough to click without zooming.
export const trades = [80, 210, 340, 470, 600].map((index) => ({
  date: points[index].label,
  index,
  symbol: ["ASML", "VWCE", "MSFT", "IWDA", "PRX"][Math.floor(index / 130) % 5],
}));

export const pct = new Intl.NumberFormat("nl-NL", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
