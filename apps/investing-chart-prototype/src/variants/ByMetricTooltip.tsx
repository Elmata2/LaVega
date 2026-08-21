import type { PortfolioPoint } from "../data";
import { dateLabel, money, percent, percentXirr } from "../format";

// Axis: organized by metric. Three rows — Waarde, TWR, XIRR — each holding
// portfolio and benchmark side by side with a Δ (portfolio − benchmark) on
// the return rows. Reads naturally when the question is "am I beating the
// benchmark on this metric", at the cost of a wider tooltip (three columns)
// and losing the sense of "this is Portfolio's block, this is S&P 500's".
export function ByMetricTooltip({ point }: { point: PortfolioPoint }) {
  const row = (
    label: string,
    badge: { text: string; cls: string } | null,
    portfolioVal: string,
    benchmarkVal: string,
    delta: number | null,
  ) => (
    <div className="tt-row" style={{ marginTop: 5, alignItems: "center" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5, width: 62, flexShrink: 0 }}>
        {badge ? <span className={`tt-badge ${badge.cls}`}>{badge.text}</span> : <span className="muted">{label}</span>}
      </span>
      <span className="tt-num" style={{ width: 70, textAlign: "right" }}>{portfolioVal}</span>
      <span className="tt-num muted" style={{ width: 70, textAlign: "right" }}>{benchmarkVal}</span>
      <span className={delta !== null ? `tt-num ${delta >= 0 ? "pos" : "neg"}` : undefined} style={{ width: 54, textAlign: "right", fontSize: 11 }}>
        {delta !== null ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp` : ""}
      </span>
    </div>
  );

  return (
    <div className="tt" style={{ minWidth: 300 }}>
      <p className="tt-date">{dateLabel(point.date)}</p>
      <div className="tt-row" style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
        <span style={{ width: 62 }} />
        <span style={{ width: 70, textAlign: "right" }}>Portefeuille</span>
        <span style={{ width: 70, textAlign: "right" }}>S&amp;P 500</span>
        <span style={{ width: 54, textAlign: "right" }}>Δ</span>
      </div>
      {row("Waarde", null, money(point.portfolioValue), money(point.benchmarkValue), null)}
      {row("TWR", { text: "TWR", cls: "tt-badge-twr" }, percent(point.portfolioTwr), percent(point.benchmarkTwr), point.portfolioTwr - point.benchmarkTwr)}
      {row("XIRR", { text: "XIRR p.j.", cls: "tt-badge-xirr" }, percentXirr(point.portfolioXirr), percentXirr(point.benchmarkXirr), point.portfolioXirr - point.benchmarkXirr)}
    </div>
  );
}
