// Axis: data-first. Absolute euros, positions stacked bottom / cash on top,
// a bold total line riding the stack's top edge, stale (forward-filled) days
// called out with a hatch texture directly on the positions band. Reads like
// a technical instrument panel — every signal (value, staleness, total) is
// visible on the chart itself, nothing deferred to the tooltip alone.
import { useState } from "react";
import { Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NetWorthPoint } from "../data";
import { dateLabel, money } from "../../format";

function Tt({ point }: { point: NetWorthPoint }) {
  const total = point.positionsValue + point.cashValue;
  return (
    <div className="tt" style={{ minWidth: 200 }}>
      <p className="tt-date">{dateLabel(point.date)}</p>
      <p className="nw-tt-total">{money(total)}</p>
      <div className="tt-row"><span className="muted">Beleggingen{point.forwardFilled ? " (verouderde koers)" : ""}</span><span className="tt-num">{money(point.positionsValue)}</span></div>
      <div className="tt-row" style={{ marginTop: 3 }}><span className="muted">Cash</span><span className="tt-num">{money(point.cashValue)}</span></div>
      {point.excludedSymbols.length > 0 && (
        <p className="nw-tt-note">{point.excludedSymbols.join(", ")} uitgesloten (koers te oud)</p>
      )}
    </div>
  );
}

export function LayeredValues({ points }: { points: NetWorthPoint[] }) {
  const [hovered, setHovered] = useState<NetWorthPoint | null>(null);
  const data = points.map((p) => ({
    ...p,
    total: p.positionsValue + p.cashValue,
    stale: p.forwardFilled ? p.positionsValue : null,
  }));
  const headerPoint = hovered ?? points.at(-1)!;
  const headerTotal = headerPoint.positionsValue + headerPoint.cashValue;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <span className="tt-num" style={{ fontSize: 20 }}>{money(headerTotal)}</span>
        <span className="muted" style={{ fontSize: 12 }}>op {dateLabel(headerPoint.date)}</span>
      </div>
      <div style={{ height: 320 }}>
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
            <defs>
              <pattern id="nw-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="hsl(var(--chart-teal) / 0.18)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--chart-teal) / 0.55)" strokeWidth="2" />
              </pattern>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={dateLabel} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => money(v)} />
            <Tooltip content={({ active, payload }) => (!active || !payload?.length) ? null : <Tt point={payload[0]!.payload} />} isAnimationActive={false} />
            <Area dataKey="positionsValue" stackId="net" name="Beleggingen" stroke="hsl(var(--chart-teal))" fill="hsl(var(--chart-teal) / 0.28)" strokeWidth={1.5} isAnimationActive={false} />
            <Area dataKey="cashValue" stackId="net" name="Cash" stroke="hsl(var(--chart-amber))" fill="hsl(var(--chart-amber) / 0.28)" strokeWidth={1.5} isAnimationActive={false} />
            <Area dataKey="stale" stroke="none" fill="url(#nw-hatch)" connectNulls={false} isAnimationActive={false} legendType="none" />
            <Line dataKey="total" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="nw-legend" aria-label="Grafiekseries">
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--chart-teal))" }} />Beleggingen</span>
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--chart-amber))" }} />Cash</span>
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--foreground))" }} />Totaal</span>
      </div>
    </>
  );
}
