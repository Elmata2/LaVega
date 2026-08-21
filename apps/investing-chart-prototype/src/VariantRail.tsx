// Variant B — chart with a right rail. The chart still leads, but keeps
// something beside it: a narrow rail stacking the KPIs, a compact donut, and
// the utility chips, so the numbers and the "what's my status" controls read
// together at a glance instead of as a separate section. Positions get a
// full-width row below, since a table doesn't compress into a rail. Narrow
// screens: rail drops below the chart, in the same stacked order.
import { Chart, Donut, Kpis, PositionsList, UtilityRow } from "./pieces";

export function VariantRail() {
  return <div style={{ display: "grid", gap: 20 }}>
    <div className="rail-grid" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20, alignItems: "start" }}>
      <Chart height={360} />
      <div style={{ display: "grid", gap: 14 }}>
        <Kpis compact />
        <div className="card"><p className="card-eyebrow">Verdeling</p><h3 className="card-title">Portefeuille</h3><div style={{ marginTop: 14 }}><Donut size={140} /></div></div>
        <UtilityRow />
      </div>
    </div>
    <div className="card"><p className="card-eyebrow">Posities</p><h3 className="card-title">Alle posities</h3><div style={{ marginTop: 14 }}><PositionsList /></div></div>
  </div>;
}
