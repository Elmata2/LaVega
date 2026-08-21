// Variant C — merged "what I own" module. Donut and positions list both
// answer the same question, so instead of two cards they become two tabs of
// one card, saving vertical space for the chart to stay dominant. KPIs move
// inline into the chart card's header, next to the range switcher, so the
// numbers and the chart read as one unit. Utility controls drop to a footer
// bar below the fold, since they're status, not primary content. Narrow
// screens: the KPI row wraps under the chart title; the tabs card is
// full-width either way.
import { Chart, DonutAndPositionsTabs, Kpis, UtilityRow } from "./pieces";

export function VariantMerged() {
  return <div style={{ display: "grid", gap: 20 }}>
    <Kpis compact />
    <Chart height={340} />
    <DonutAndPositionsTabs />
    <UtilityRow />
  </div>;
}
