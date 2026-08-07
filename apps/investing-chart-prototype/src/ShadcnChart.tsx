import { createContext, useContext, useId } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { eur, points } from "./data";

type ChartConfig = Record<string, { label: string; color: string }>;
const ChartContext = createContext<ChartConfig>({});
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Minimal copy of the shadcn/ui Charts pattern: config context, scoped theme
// variables, responsive Recharts container, and config-aware tooltip content.
function ChartContainer({ config, children }: { config: ChartConfig; children: React.ReactNode }) {
  const id = `chart-${useId().replace(/:/g, "")}`;
  const style = Object.fromEntries(Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color])) as React.CSSProperties;
  return <ChartContext.Provider value={config}><div data-chart={id} style={{ ...style, width: "100%", height: "100%" }}><ResponsiveContainer>{children}</ResponsiveContainer></div></ChartContext.Provider>;
}

function ChartTooltipContent({ active, payload }: { active?: boolean; payload?: ReadonlyArray<any> }) {
  const config = useContext(ChartContext);
  if (!active || !payload?.length) return null;
  return <div className="tooltip"><p className="tooltip-date">{new Date(Number(payload[0].payload.date)).toLocaleDateString("en-GB")}</p>{payload.map((item) => <p key={item.dataKey}><i className="tooltip-dot" style={{ background: config[item.dataKey]?.color }} />{config[item.dataKey]?.label} {eur.format(Number(item.value))}</p>)}</div>;
}

const config = {
  portfolio: { label: "Portfolio", color: "var(--prototype-portfolio)" },
  benchmark: { label: "MSCI World", color: "var(--prototype-benchmark)" },
} satisfies ChartConfig;

export function ShadcnChart() {
  return <ChartContainer config={config}><LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} accessibilityLayer>
    <CartesianGrid vertical={false} stroke={css("--prototype-grid")} />
    <XAxis dataKey="date" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value) => new Date(value).getFullYear().toString()} stroke={css("--prototype-muted")} tickLine={false} axisLine={false} minTickGap={48} fontSize={10} />
    <YAxis width={52} tickFormatter={(value) => `€${Math.round(value / 1000)}k`} stroke={css("--prototype-muted")} tickLine={false} axisLine={false} fontSize={10} />
    <Tooltip content={<ChartTooltipContent />} />
    <Line dataKey="portfolio" type="monotone" stroke="var(--color-portfolio)" strokeWidth={2} dot={false} isAnimationActive={false} />
    <Line dataKey="benchmark" type="monotone" stroke="var(--color-benchmark)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
  </LineChart></ChartContainer>;
}
