import { useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortfolioPoint } from "./data";
import { dateLabel, money } from "./format";

type ChartProps = {
  points: PortfolioPoint[];
  renderTooltip: (point: PortfolioPoint) => ReactNode;
  renderHeader?: (point: PortfolioPoint) => ReactNode;
};

export function Chart({ points, renderTooltip, renderHeader }: ChartProps) {
  const [hovered, setHovered] = useState<PortfolioPoint | null>(null);
  const headerPoint = hovered ?? points.at(-1)!;

  return (
    <>
      {renderHeader?.(headerPoint)}
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 12, right: 12, left: 8, bottom: 0 }}
            onMouseMove={(state) => {
              const index = typeof state.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
              if (index !== null) setHovered(points[index] ?? null);
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={dateLabel} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => money(v)} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return renderTooltip(payload[0]!.payload as PortfolioPoint);
              }}
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
