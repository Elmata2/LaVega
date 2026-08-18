import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { EmptyState } from "./components/EmptyState";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

type Health = { ok: boolean; service: string };

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/health").then(async (response) => { if (!response.ok) throw new Error(`Health request failed: ${response.status}`); return await response.json() as Health; }).then(setHealth).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Health request failed")); }, []);
  if (error) return <span className="text-negative">Server unavailable: {error}</span>;
  if (!health) return <span>Connecting to investing server…</span>;
  return <span>{health.service}: {health.ok ? "healthy" : "unhealthy"}</span>;
}

function Layout() {
  const location = useLocation();
  const detail = location.pathname.startsWith("/positions/");
  return <div className="min-h-screen p-3 sm:p-6"><div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-frame bg-background shadow-float sm:min-h-[calc(100vh-3rem)]"><header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><Link to="/" className="pressable group"><span className="text-xs font-semibold uppercase tracking-[.2em] text-primary">LaVega</span><h1 className="font-display text-3xl font-semibold leading-none">Investing</h1></Link><nav aria-label="Main navigation" className="flex items-center gap-1 rounded-pill bg-secondary p-1"><NavLink to="/" end className={({ isActive }) => `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Overview</NavLink><NavLink to="/positions" className={({ isActive }) => `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Positions</NavLink></nav></header><main className="px-5 py-8 sm:px-8 sm:py-12"><div className="mb-8 flex items-end justify-between gap-4"><div><p className="mb-2 text-sm font-medium text-primary">{detail ? "Position detail" : "Your financial picture"}</p><h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{detail ? "Position" : "Overview"}</h2></div>{!detail && <Button variant="outline" size="sm">Connect broker</Button>}</div><Outlet /></main><footer className="border-t border-border px-5 py-5 text-xs text-muted-foreground sm:px-8"><span role="status"><HealthStatus /></span></footer></div></div>;
}

function Overview() { return <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><Card><CardHeader><p className="text-sm font-medium text-muted-foreground">Portfolio value</p><CardTitle>Nothing here yet</CardTitle></CardHeader><CardContent><EmptyState title="Your portfolio is waiting" description="Connect a broker to see portfolio value, performance, and benchmark data here." /></CardContent></Card><Card><CardHeader><p className="text-sm font-medium text-muted-foreground">Allocation</p><CardTitle>Start with your holdings</CardTitle></CardHeader><CardContent><EmptyState title="No positions" description="Your allocation breakdown will appear after your first broker sync." /></CardContent></Card></div>; }
function Positions() { return <EmptyState title="No positions loaded" description="Connect a broker or import a statement to see your investments." />; }
function PositionDetail() { return <div className="space-y-5"><Link to="/positions" className="text-sm font-semibold text-primary hover:underline">← Back to positions</Link><EmptyState title="No position selected" description="Position history and trade markers will appear when holdings are available." /></div>; }

export function App() { return <Routes><Route element={<Layout />}><Route path="/" element={<Overview />} /><Route path="/positions" element={<Positions />} /><Route path="/positions/:symbol" element={<PositionDetail />} /></Route></Routes>; }
