// Axis: headline-first. Leads with the one number a reader actually wants
// ("Nettovermogen: €47.320"), set in the display serif like a KPI, with the
// area chart demoted to quiet supporting evidence below it — muted single-hue
// bands rather than a technical instrument panel. Stale days get a lighter
// fill tone instead of a hatch, keeping the mark this calm.
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NetWorthPoint } from "../data";
import { dateLabel, money } from "../../format";

function Tt({ point }: { point: NetWorthPoint }) {
  const total = point.positionsValue + point.cashValue;
  return (
    <div className="tt" style={{ minWidth: 190 }}>
      <p className="tt-date">{dateLabel(point.date)}</p>
      <p className="nw-tt-total">{money(total)}</p>
      <div className="tt-row"><span className="muted">Beleggingen</span><span className="tt-num">{money(point.positionsValue)}</span></div>
      <div className="tt-row" style={{ marginTop: 3 }}><span className="muted">Cash</span><span className="tt-num">{money(point.cashValue)}</span></div>
      {point.excludedSymbols.length > 0 && (
        <p className="nw-tt-note">{point.excludedSymbols.join(", ")} uitgesloten</p>
      )}
    </div>
  );
}

export function EditorialLedger({ points }: { points: NetWorthPoint[] }) {
  const [hovered, setHovered] = useState<NetWorthPoint | null>(null);
  const data = points.map((p) => ({ ...p }));
  const headerPoint = hovered ?? points.at(-1)!;
  const headerTotal = headerPoint.positionsValue + headerPoint.cashValue;

  return (
    <>
      <p className="nw-ledger-headline">{money(headerTotal)}</p>
      <p className="nw-ledger-sub">Nettovermogen op {dateLabel(headerPoint.date)}{headerPoint.forwardFilled ? " · verouderde koers" : ""}</p>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
            onMouseMove={(state) => {
              const index = typeof state.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
              if (index !== null) setHovered(data[index] ?? null);
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={dateLabel} />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Tooltip content={({ active, payload }) => (!active || !payload?.length) ? null : <Tt point={payload[0]!.payload} />} isAnimationActive={false} />
            <Area
              dataKey="positionsValue"
              stackId="net"
              name="Beleggingen"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1}
              fill="hsl(var(--muted-foreground) / 0.22)"
              isAnimationActive={false}
            />
            <Area
              dataKey="cashValue"
              stackId="net"
              name="Cash"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1}
              strokeOpacity={0.5}
              fill="hsl(var(--muted-foreground) / 0.10)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="nw-legend" aria-label="Grafiekseries">
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--muted-foreground) / 0.55)" }} />Beleggingen</span>
        <span className="nw-legend-item"><span aria-hidden="true" className="nw-swatch" style={{ background: "hsl(var(--muted-foreground) / 0.25)" }} />Cash</span>
      </div>
    </>
  );
}
