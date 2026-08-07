import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { eur, points } from "./data";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function RechartsChart() {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke={css("--prototype-grid")} />
        <XAxis dataKey="date" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value) => new Date(value).getFullYear().toString()} stroke={css("--prototype-muted")} tickLine={false} axisLine={false} minTickGap={48} fontSize={10} />
        <YAxis width={52} tickFormatter={(value) => `€${Math.round(value / 1000)}k`} stroke={css("--prototype-muted")} tickLine={false} axisLine={false} fontSize={10} />
        <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="tooltip"><p className="tooltip-date">{new Date(Number(payload[0].payload.date)).toLocaleDateString("en-GB")}</p><p>Portfolio {eur.format(Number(payload[0].value))}</p><p>Benchmark {eur.format(Number(payload[1].value))}</p></div> : null} />
        <Line dataKey="portfolio" type="monotone" stroke={css("--prototype-portfolio")} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="benchmark" type="monotone" stroke={css("--prototype-benchmark")} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
