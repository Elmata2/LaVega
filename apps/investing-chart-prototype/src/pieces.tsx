// Content widgets shared across all three variants — a shared <Header>, not a
// shared <Layout>. Each variant is free to arrange, size, and place these
// however it wants; none of them own the page structure.
import { useState } from "react";
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { allocation, chartPoints, dayChangeEur, dayChangePct, money, portfolioValue, positions, totalReturnEur, totalReturnPct } from "./data";

export function Kpis({ compact = false }: { compact?: boolean }) {
  return <div className={`kpi-strip${compact ? " compact" : ""}`}>
    <div className="kpi"><p className="kpi-label">Portefeuillewaarde</p><p className="kpi-value">{money(portfolioValue)}</p></div>
    <div className="kpi"><p className="kpi-label">Vandaag</p><p className="kpi-value pos">+{money(dayChangeEur)}</p><p className="kpi-sub">+{dayChangePct.toFixed(2)}%</p></div>
    <div className="kpi"><p className="kpi-label">Totaalrendement</p><p className="kpi-value pos">+{money(totalReturnEur)}</p><p className="kpi-sub">+{totalReturnPct.toFixed(1)}%</p></div>
  </div>;
}

export function Chart({ height = 320 }: { height?: number }) {
  return <div className="card">
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <div><p className="card-eyebrow">Portefeuillewaarde</p><h3 className="card-title">Versus S&amp;P 500</h3></div>
      <div className="pill-group">{["1M", "6M", "1J", "YTD", "Alles"].map((label, index) => <button key={label} type="button" className={`pill${index === 0 ? " active" : ""}`}>{label}</button>)}</div>
    </div>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => money(v)} />
        <Tooltip formatter={(value, name) => [money(Number(value)), name === "portfolioValue" ? "Portefeuille" : "S&P 500"]} labelFormatter={(label) => new Date(`${String(label)}T00:00:00Z`).toLocaleDateString("nl-NL")} />
        <Line dataKey="portfolioValue" stroke="hsl(var(--positive))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        <Line dataKey="benchmarkValue" stroke="hsl(var(--chart-purple))" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

export function Donut({ size = 200 }: { size?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `${size}px 1fr`, gap: 16, alignItems: "center" }}>
    <ResponsiveContainer width={size} height={size}>
      <PieChart>
        <Pie data={allocation} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
          {allocation.map((bucket) => <Cell key={bucket.key} fill={bucket.color} />)}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
    <ul className="donut-legend">{allocation.map((bucket) => <li key={bucket.key}><span><span className="dot" style={{ background: bucket.color }} />{bucket.label}</span><span className="amount">{money(bucket.value)}</span></li>)}</ul>
  </div>;
}

export function PositionsList() {
  return <ul className="positions-list">
    <li className="row"><span>Positie</span><span>Waarde</span></li>
    {positions.map((position) => <li className="row" key={position.symbol}><span>{position.description}<span style={{ display: "block", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{position.symbol} · {position.entity}</span></span><span className="amount">{money(position.valueEur)}</span></li>)}
  </ul>;
}

/** Sync banner, vault prompt, and price-cache control — the controls competing with the numbers today. */
export function UtilityRow() {
  return <div className="utility-row">
    <span className="chip warn">⚠ Trading 212 niet gekoppeld</span>
    <span className="chip">🔒 Kluis ontgrendeld</span>
    <span className="chip">Prijzen bijgewerkt: 2 min geleden <button type="button">wissen</button></span>
  </div>;
}

export function DonutAndPositionsTabs() {
  const [tab, setTab] = useState<"donut" | "list">("donut");
  return <div className="card">
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
      <div><p className="card-eyebrow">Wat ik bezit</p><h3 className="card-title">Posities &amp; verdeling</h3></div>
      <div className="pill-group">
        <button type="button" className={`pill${tab === "donut" ? " active" : ""}`} onClick={() => setTab("donut")}>Verdeling</button>
        <button type="button" className={`pill${tab === "list" ? " active" : ""}`} onClick={() => setTab("list")}>Lijst</button>
      </div>
    </div>
    <div style={{ marginTop: 14 }}>{tab === "donut" ? <Donut /> : <PositionsList />}</div>
  </div>;
}
