// Axis: composition-first. Normalizes to a 100%-stacked band so the chart
// answers "how is my net worth split" (is cash drifting up as a share) rather
// than "how big is it" — a genuinely different question from the absolute
// euro chart. Tooltip leads with the euro total, then gives share %, so the
// number a reader actually holds (their money) isn't buried under the ratio
// the chart is built to show.
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NetWorthPoint } from "../data";
import { dateLabel, money } from "../../format";

const sharePct = (v: number) => `${(v * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

function Tt({ point }: { point: NetWorthPoint }) {
  const total = point.positionsValue + point.cashValue;
  const cashShare = point.cashValue / total;
  return (
    <div className="tt" style={{ minWidth: 210 }}>
      <p className="tt-date">{dateLabel(point.date)}</p>
      <p className="nw-tt-total">{money(total)}</p>
      <div className="tt-row"><span className="muted">Beleggingen{point.forwardFilled ? " (verouderde koers)" : ""}</span><span className="tt-num">{sharePct(1 - cashShare)}</span></div>
      <div className="tt-row" style={{ marginTop: 3 }}><span className="muted">Cash</span><span className="tt-num">{sharePct(cashShare)}</span></div>
      {point.excludedSymbols.length > 0 && (
        <p className="nw-tt-note">{point.excludedSymbols.join(", ")} uitgesloten (koers te oud)</p>
      )}
    </div>
  );
}

export function CompositionBand({ points }: { points: NetWorthPoint[] }) {
  const [hovered, setHovered] = useState<NetWorthPoint | null>(null);
  const data = points.map((p) => {
    const total = p.positionsValue + p.cashValue;
    return { ...p, positionsShare: p.positionsValue / total, cashShare: p.cashValue / total };
  });
  const headerPoint = hovered ?? points.at(-1)!;
  const headerTotal = headerPoint.positionsValue + headerPoint.cashValue;
  const headerCashShare = headerPoint.cashValue / headerTotal;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="tt-num" style={{ fontSize: 20 }}>{money(headerTotal)}</span>
          <span className="muted" style={{ fontSize: 12 }}>op {dateLabel(headerPoint.date)}</span>
        </div>
        <div className="nw-share-row" aria-hidden="true">
          <span style={{ width: `${(1 - headerCashShare) * 100}%`, background: "hsl(var(--chart-blue))" }} />
          <span style={{ width: `${headerCashShare * 100}%`, background: "hsl(var(--chart-amber))" }} />
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{sharePct(1 - headerCashShare)} beleggingen · {sharePct(headerCashShare)} cash</span>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 12, left: 8, bottom: 0 }}
            onMouseMove={(state) => {
              const index = typeof state.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
              if (index !== null) setHovered(data[index] ?? null);
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={dateLabel} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Tooltip content={({ active, payload }) => (!active || !payload?.length) ? null : <Tt point={payload[0]!.payload} />} isAnimationActive={false} />
            <Area dataKey="positionsShare" stackId="net" name="Beleggingen" stroke="hsl(var(--chart-blue))" fill="hsl(var(--chart-blue) / 0.32)" strokeWidth={1.5} isAnimationActive={false} />
            <Area dataKey="cashShare" stackId="net" name="Cash" stroke="hsl(var(--chart-amber))" fill="hsl(var(--chart-amber) / 0.32)" strokeWidth={1.5} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="nw-legend" aria-label="Grafiekseries">
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--chart-blue))" }} />Beleggingen (%)</span>
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--chart-amber))" }} />Cash (%)</span>
      </div>
    </>
  );
}
