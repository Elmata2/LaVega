import type { PortfolioPoint } from "../data";
import { dateLabel, money, percent, percentXirr } from "../format";

// Axis: organized by series. Two columns — Portfolio, then S&P 500 — each
// stacked Waarde / TWR / XIRR top to bottom. Reads naturally when the
// question is "how is this one thing doing", at the cost of making a
// side-by-side comparison (is TWR beating XIRR, portfolio beating
// benchmark) a left/right eye-jump instead of a straight line.
export function BySeriesTooltip({ point }: { point: PortfolioPoint }) {
  const column = (
    label: string,
    dotColor: string,
    value: number,
    twr: number,
    xirr: number,
  ) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: dotColor, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 11 }}>{label}</span>
      </div>
      <div className="tt-row"><span className="muted">Waarde</span><span className="tt-num">{money(value)}</span></div>
      <div className="tt-row" style={{ marginTop: 3 }}>
        <span className="tt-badge tt-badge-twr">TWR</span>
        <span className={`tt-num ${twr >= 0 ? "pos" : "neg"}`}>{percent(twr)}</span>
      </div>
      <div className="tt-row" style={{ marginTop: 3 }}>
        <span className="tt-badge tt-badge-xirr">XIRR p.j.</span>
        <span className={`tt-num ${xirr >= 0 ? "pos" : "neg"}`}>{percentXirr(xirr)}</span>
      </div>
    </div>
  );

  return (
    <div className="tt" style={{ minWidth: 280 }}>
      <p className="tt-date">{dateLabel(point.date)}</p>
      <div style={{ display: "flex", gap: 18 }}>
        {column("Portefeuille", "hsl(var(--chart-blue))", point.portfolioValue, point.portfolioTwr, point.portfolioXirr)}
        {column("S&P 500", "hsl(var(--chart-purple))", point.benchmarkValue, point.benchmarkTwr, point.benchmarkXirr)}
      </div>
    </div>
  );
}
