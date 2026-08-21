import type { PortfolioPoint } from "../data";
import { dateLabel, money, percent, percentXirr } from "../format";

// Axis: insight-first hierarchy, paired with an always-visible header (see
// Chart.tsx) rather than everything living behind hover. The tooltip itself
// leads with the two spreads (TWR Δ, XIRR Δ) — "am I beating the
// benchmark" is the one question the crosshair exists to answer moment to
// moment — then drops the four raw returns and two raw values in small,
// muted secondary rows. Costs: the raw numbers a user glances for
// ("what's my TWR today") take a half-second longer to find.
export function OutperformanceTooltip({ point }: { point: PortfolioPoint }) {
  const twrDelta = point.portfolioTwr - point.benchmarkTwr;
  const xirrDelta = point.portfolioXirr - point.benchmarkXirr;

  return (
    <div className="tt" style={{ minWidth: 220 }}>
      <p className="tt-date">{dateLabel(point.date)}</p>
      <div className="tt-row">
        <span className="tt-badge tt-badge-twr">TWR</span>
        <span className={`tt-num ${twrDelta >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>
          {twrDelta >= 0 ? "+" : ""}{(twrDelta * 100).toFixed(1)}pp
        </span>
      </div>
      <div className="tt-row" style={{ marginTop: 4 }}>
        <span className="tt-badge tt-badge-xirr">XIRR p.j.</span>
        <span className={`tt-num ${xirrDelta >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>
          {xirrDelta >= 0 ? "+" : ""}{(xirrDelta * 100).toFixed(1)}pp
        </span>
      </div>
      <hr style={{ border: "none", borderTop: "1px solid hsl(var(--border))", margin: "8px 0" }} />
      <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 2, columnGap: 8 }}>
        <span>Portefeuille {money(point.portfolioValue)}</span>
        <span>S&amp;P 500 {money(point.benchmarkValue)}</span>
        <span>TWR {percent(point.portfolioTwr)}</span>
        <span>TWR {percent(point.benchmarkTwr)}</span>
        <span>XIRR {percentXirr(point.portfolioXirr)}</span>
        <span>XIRR {percentXirr(point.benchmarkXirr)}</span>
      </div>
    </div>
  );
}
