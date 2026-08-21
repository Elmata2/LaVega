import { useEffect, useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortfolioPoint } from "./data";
import { dateLabel, money } from "./format";

type ChartProps = {
  points: PortfolioPoint[];
  renderTooltip: (point: PortfolioPoint) => ReactNode;
  renderHeader?: (point: PortfolioPoint) => ReactNode;
};

// Relays whatever point Recharts' own tooltip machinery currently considers
// active back up to the header — the tooltip's active/payload props are the
// one source of truth for "what's under the pointer right now", so drive
// off those directly instead of re-deriving hover from mouse events.
function TooltipRelay({ active, payload, renderTooltip, onHoverChange }: {
  active?: boolean;
  payload?: { payload: PortfolioPoint }[];
  renderTooltip: (point: PortfolioPoint) => ReactNode;
  onHoverChange: (point: PortfolioPoint | null) => void;
}) {
  const point = active && payload?.length ? payload[0]!.payload : null;
  useEffect(() => { onHoverChange(point); }, [point?.date]);
  if (!point) return null;
  return <>{renderTooltip(point)}</>;
}

export function Chart({ points, renderTooltip, renderHeader }: ChartProps) {
  const [hovered, setHovered] = useState<PortfolioPoint | null>(null);
  const headerPoint = hovered ?? points.at(-1)!;

  return (
    <>
      {renderHeader?.(headerPoint)}
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={dateLabel} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => money(v)} />
            <Tooltip
              content={<TooltipRelay renderTooltip={renderTooltip} onHoverChange={setHovered} />}
              isAnimationActive={false}
            />
            <Line dataKey="portfolioValue" stroke="hsl(var(--chart-blue))" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line dataKey="benchmarkValue" stroke="hsl(var(--chart-purple))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
