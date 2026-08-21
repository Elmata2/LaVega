// Variant A — full-bleed hero chart. KPI strip sits directly above the chart
// as its opening line ("here's where you stand"), the chart runs edge to edge
// as the centrepiece, and allocation + positions sit side by side beneath it
// as two equal-weight answers to "what do I own". Utility controls (sync,
// vault, price cache) are pushed to a thin strip under the header, out of the
// way of the numbers. Narrow screens: KPI strip wraps to a single column,
// donut/positions stack.
import { Chart, Donut, Kpis, PositionsList, UtilityRow } from "./pieces";

export function VariantHero() {
  return <div style={{ display: "grid", gap: 20 }}>
    <UtilityRow />
    <Kpis />
    <Chart height={360} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <div className="card"><p className="card-eyebrow">Verdeling</p><h3 className="card-title">Portefeuille</h3><div style={{ marginTop: 14 }}><Donut /></div></div>
      <div className="card"><p className="card-eyebrow">Posities</p><h3 className="card-title">Alle posities</h3><div style={{ marginTop: 14 }}><PositionsList /></div></div>
    </div>
  </div>;
}
