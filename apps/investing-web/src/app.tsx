import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { EmptyState } from "./components/EmptyState";
import { AllocationDonut } from "./components/AllocationDonut";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { PositionPriceChart } from "./components/PositionPriceChart";
import { PortfolioBenchmarkChart } from "./components/PortfolioBenchmarkChart";

const YAHOO_FINANCE_CONSENT_HEADER = "x-lavega-yahoo-consent";
const YAHOO_DISCLOSURE_STORAGE_KEY = "lavega.yahoo-finance-disclosure.v1";
const hasSeenYahooFinanceDisclosure = () => { try { return localStorage.getItem(YAHOO_DISCLOSURE_STORAGE_KEY) === "seen"; } catch { return false; } };
const markYahooFinanceDisclosureSeen = () => { try { localStorage.setItem(YAHOO_DISCLOSURE_STORAGE_KEY, "seen"); } catch { /* unavailable storage is non-fatal */ } };

type Health = { ok: boolean; service: string };
type Consent = { accepted: boolean; disclosure: string };

export function YahooDisclosure() {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { fetch("/api/market-data/consent", { headers: hasSeenYahooFinanceDisclosure() ? { [YAHOO_FINANCE_CONSENT_HEADER]: "accepted" } : undefined }).then(async (response) => { const status = await response.json() as Consent; return hasSeenYahooFinanceDisclosure() ? { ...status, accepted: true } : status; }).then(setConsent).catch(() => setProblem("Kan toestemmingsstatus niet laden.")); }, []);
  async function accept() {
    setBusy(true); setProblem(null);
    try {
      const response = await fetch("/api/market-data/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted: true }) });
      if (!response.ok) throw new Error("Toestemming opslaan mislukt.");
      markYahooFinanceDisclosureSeen();
      setConsent((current) => current ? { ...current, accepted: true } : current);
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : "Toestemming opslaan mislukt."); }
    finally { setBusy(false); }
  }
  if (consent?.accepted) return null;
  return <Card role="dialog" aria-labelledby="yahoo-disclosure-title" className="border-primary/20 bg-secondary/40"><CardHeader><p className="text-sm font-medium text-primary">Eerst even dit</p><CardTitle id="yahoo-disclosure-title">Prijsdata van Yahoo Finance</CardTitle></CardHeader><CardContent className="space-y-4"><p className="max-w-2xl text-sm leading-6 text-muted-foreground">{consent?.disclosure ?? "Yahoo Finance is niet officieel. De dienst kan zonder waarschuwing stoppen of verzoeken beperken. LaVega gebruikt Yahoo alleen voor lokaal of zelf gehost persoonlijk gebruik."}</p><p className="text-sm font-semibold">Accepteer deze melding voordat LaVega prijsdata opvraagt.</p>{problem && <p role="alert" className="text-sm text-negative">{problem}</p>}<Button type="button" onClick={accept} disabled={busy || !consent}>{busy ? "Opslaan…" : "Ik begrijp het en ga akkoord"}</Button></CardContent></Card>;
}

function AppOpenSync() {
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => { void fetch("/api/brokers/sync", { method: "POST" }).then(async (response) => { const result = await response.json() as { problems?: string[] }; setProblems(result.problems ?? []); }).catch(() => setProblems(["Brokersynchronisatie mislukt."])); }, []);
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

function Overview() { const emptyAllocation = { buckets: [], unpriced: [] }; return <div className="space-y-5"><AppOpenSync /><YahooDisclosure /><div className="flex justify-end"><ClearPriceCache /></div><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><PortfolioBenchmarkChart data={{}} /><AllocationDonut instrument={emptyAllocation} broker={emptyAllocation} /></div></div>; }
function Positions() { return <EmptyState title="Geen posities geladen" description="Koppel een broker of importeer een overzicht om jouw beleggingen te zien." />; }
function PositionDetail() { return <div className="space-y-5"><Link to="/positions" className="text-sm font-semibold text-primary hover:underline">← Terug naar posities</Link><PositionPriceChart symbol="AAPL" currency="USD" points={[]} /></div>; }

export function App() { return <Routes><Route element={<Layout />}><Route path="/" element={<Overview />} /><Route path="/positions" element={<Positions />} /><Route path="/positions/:symbol" element={<PositionDetail />} /></Route></Routes>; }
