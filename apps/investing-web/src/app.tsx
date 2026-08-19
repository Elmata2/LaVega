import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { InvestingDashboardData } from "@lavega/core";
import { EmptyState } from "./components/EmptyState";
import { AllocationDonut } from "./components/AllocationDonut";
import { Button } from "./components/ui/button";
import { PositionPriceChart } from "./components/PositionPriceChart";
import { PortfolioBenchmarkChart } from "./components/PortfolioBenchmarkChart";

const DASHBOARD_REFRESH_EVENT = "lavega:dashboard-refresh";

type Health = { ok: boolean; service: string };
type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: InvestingDashboardData }
  | { status: "error"; message: string };

function isDashboardData(value: unknown): value is InvestingDashboardData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<InvestingDashboardData>;
  return typeof data.presentationCurrency === "string"
    && Boolean(data.portfolio && typeof data.portfolio === "object")
    && Boolean(data.allocation && typeof data.allocation === "object")
    && Array.isArray(data.positions)
    && Array.isArray(data.problems)
    && (data.position === null || (Boolean(data.position) && typeof data.position === "object"));
}

async function fetchDashboard(symbol?: string): Promise<InvestingDashboardData> {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const response = await fetch(`/api/investing/dashboard${query}`);
  if (!response.ok) throw new Error(`Dashboard laden mislukt: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isDashboardData(payload)) throw new Error("Dashboardgegevens hebben ongeldig formaat.");
  return payload;
}

function useDashboard(symbol?: string): DashboardState {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    const load = () => {
      setState({ status: "loading" });
      void fetchDashboard(symbol)
        .then((data) => { if (current) setState({ status: "ready", data }); })
        .catch((reason: unknown) => { if (current) setState({ status: "error", message: reason instanceof Error ? reason.message : "Dashboard laden mislukt" }); });
    };
    load();
    window.addEventListener(DASHBOARD_REFRESH_EVENT, load);
    return () => { current = false; window.removeEventListener(DASHBOARD_REFRESH_EVENT, load); };
  }, [symbol]);
  return state;
}

function DashboardLoading() {
  return <div role="status" className="rounded-card border border-border bg-secondary/30 p-6 text-sm text-muted-foreground">Dashboard laden…</div>;
}

function DashboardError({ message }: { message: string }) {
  return <EmptyState title="Dashboard niet beschikbaar" description={message} />;
}

function DashboardProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return <div role="alert" className="rounded-card border border-negative/30 bg-negative/5 p-4 text-sm"><p className="font-semibold">Leesproblemen</p><ul className="mt-2 list-disc space-y-1 pl-5">{problems.map((problem, index) => <li key={`${problem}-${index}`}>{problem}</li>)}</ul></div>;
}

function PositionList({ positions }: { positions: InvestingDashboardData["positions"] }) {
  if (positions.length === 0) return <EmptyState title="Geen posities geladen" description="Koppel een broker of importeer een overzicht om jouw beleggingen te zien." />;
  return <div className="space-y-5"><ul aria-label="Posities" className="divide-y divide-border rounded-card border border-border"><li className="grid grid-cols-[1fr_auto] gap-4 bg-secondary/30 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>Positie</span><span>Hoeveelheid</span></li>{positions.map((position) => <li key={`${position.symbol}-${position.entity}`} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4"><Link to={`/positions/${encodeURIComponent(position.symbol)}`} className="min-w-0 font-semibold text-primary hover:underline"><span className="block truncate">{position.description ?? position.symbol}</span><span className="block text-xs font-normal text-muted-foreground">{position.symbol} · {position.entity}</span></Link><span className="text-right text-sm tabular-nums">{position.quantity} {position.currency}</span></li>)}</ul></div>;
}

function AppOpenSync() {
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    const run = async () => {
      try {
        const brokerResponse = await fetch("/api/brokers/sync", { method: "POST" });
        const brokerResult = await brokerResponse.json() as { problems?: string[] };
        const nextProblems = [...(brokerResult.problems ?? [])];
        const dashboard = await fetchDashboard();
          type PriceSyncSymbol = { symbol: string; currency: string; isin?: string; ticker?: string; exchange?: string; backfillFrom?: string };
          const symbols: PriceSyncSymbol[] = dashboard.positions
            .map((position) => position.isin
              ? { symbol: position.symbol, isin: position.isin, currency: position.currency, backfillFrom: position.asOf }
              : { symbol: position.symbol, ticker: position.symbol, exchange: "UNKNOWN", currency: position.currency, backfillFrom: position.asOf });
          symbols.push({ symbol: "SP500", ticker: "^GSPC", exchange: "NASDAQ", currency: "EUR", backfillFrom: "2000-01-01" });
          const priceResponse = await fetch("/api/prices/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols }) });
          if (priceResponse.ok) {
            const priceResult = await priceResponse.json() as { problems?: string[] };
            nextProblems.push(...(priceResult.problems ?? []));
            window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
          }
        if (current) setProblems(nextProblems);
      } catch { if (current) setProblems(["Brokersynchronisatie mislukt."]); }
    };
    void run();
    return () => { current = false; };
  }, []);
  if (problems.length === 0) return null;
  return <div role="alert" className="rounded-card border border-negative/30 bg-negative/5 p-4 text-sm"><p className="font-semibold">Synchronisatieproblemen</p><ul className="mt-2 list-disc space-y-1 pl-5">{problems.map((problem, index) => <li key={`${problem}-${index}`}>{problem}</li>)}</ul></div>;
}

function ClearPriceCache() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function clear() { setBusy(true); setMessage(null); try { const response = await fetch("/api/prices/cache", { method: "DELETE" }); if (!response.ok) throw new Error("Wissen mislukt"); setMessage("Prijsgegevens verwijderd"); } catch (error) { setMessage(error instanceof Error ? error.message : "Wissen mislukt"); } finally { setBusy(false); } }
  if (confirming) return <div className="flex flex-wrap items-center justify-end gap-3" role="alert"><span className="text-xs text-negative">Dit verwijdert alle lokaal opgeslagen prijsgegevens.</span><Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Annuleren</Button><Button type="button" variant="destructive" size="sm" onClick={clear} disabled={busy}>{busy ? "Wissen…" : "Ja, alles verwijderen"}</Button></div>;
  return <div className="flex items-center gap-3"><Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} disabled={busy}>Prijsgegevens wissen</Button>{message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}</div>;
}

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/health").then(async (response) => { if (!response.ok) throw new Error(`Gezondheidscontrole mislukt: ${response.status}`); return await response.json() as Health; }).then(setHealth).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Gezondheidscontrole mislukt")); }, []);
  if (error) return <span className="text-negative">Server niet beschikbaar: {error}</span>;
  if (!health) return <span>Verbinden met investeringsserver…</span>;
  return <span>{health.service}: {health.ok ? "beschikbaar" : "niet beschikbaar"}</span>;
}

function Layout() {
  const location = useLocation();
  const detail = location.pathname.startsWith("/positions/");
  return <div className="min-h-screen p-3 sm:p-6"><div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-frame bg-background shadow-float sm:min-h-[calc(100vh-3rem)]"><header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><Link to="/" className="pressable group"><span className="text-xs font-semibold uppercase tracking-[.2em] text-primary">LaVega</span><h1 className="font-display text-3xl font-semibold leading-none">Investeren</h1></Link><nav aria-label="Hoofdnavigatie" className="flex items-center gap-1 rounded-pill bg-secondary p-1"><NavLink to="/" end className={({ isActive }) => `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Overzicht</NavLink><NavLink to="/positions" className={({ isActive }) => `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Posities</NavLink></nav></header><main className="px-5 py-8 sm:px-8 sm:py-12"><div className="mb-8 flex items-end justify-between gap-4"><div><p className="mb-2 text-sm font-medium text-primary">{detail ? "Positiedetail" : "Jouw financiële overzicht"}</p><h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{detail ? "Positie" : "Overzicht"}</h2></div>{!detail && <Button variant="outline" size="sm">Broker koppelen</Button>}</div><Outlet /></main><footer className="border-t border-border px-5 py-5 text-xs text-muted-foreground sm:px-8"><span role="status"><HealthStatus /></span></footer></div></div>;
}

function Overview() {
  const state = useDashboard();
  return <div className="space-y-5"><AppOpenSync /><div className="flex justify-end"><ClearPriceCache /></div>{state.status === "loading" ? <DashboardLoading /> : state.status === "error" ? <DashboardError message={state.message} /> : <><DashboardProblems problems={state.data.problems} /><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><PortfolioBenchmarkChart data={state.data.portfolio} currency={state.data.presentationCurrency} /><AllocationDonut instrument={state.data.allocation.instrument} broker={state.data.allocation.broker} /></div><PositionList positions={state.data.positions} /></>}</div>;
}

function Positions() {
  const state = useDashboard();
  if (state.status === "loading") return <DashboardLoading />;
  if (state.status === "error") return <DashboardError message={state.message} />;
  return <><DashboardProblems problems={state.data.problems} /><PositionList positions={state.data.positions} /></>;
}

function PositionDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const positionSymbol = symbol?.trim().toUpperCase() ?? "";
  const state = useDashboard(positionSymbol || undefined);
  return <div className="space-y-5"><Link to="/positions" className="text-sm font-semibold text-primary hover:underline">← Terug naar posities</Link>{!positionSymbol ? <EmptyState title="Geen positie gekozen" description="Kies een positie om koershistorie te bekijken." /> : state.status === "loading" ? <DashboardLoading /> : state.status === "error" ? <DashboardError message={state.message} /> : state.data.position?.symbol.toUpperCase() === positionSymbol ? <><DashboardProblems problems={state.data.problems} /><PositionPriceChart symbol={state.data.position.symbol} currency={state.data.position.currency} points={state.data.position.points} /></> : <EmptyState title="Positie niet gevonden" description="Deze positie staat niet in het lokale dashboardmodel." />}</div>;
}

export function App() { return <Routes><Route element={<Layout />}><Route path="/" element={<Overview />} /><Route path="/positions" element={<Positions />} /><Route path="/positions/:symbol" element={<PositionDetail />} /></Route></Routes>; }
