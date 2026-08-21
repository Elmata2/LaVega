import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import type { InvestingDashboardData, InvestingPositionDetail } from "@lavega/core";
import { EmptyState } from "./components/EmptyState";
import { AllocationDonut } from "./components/AllocationDonut";
import { Button } from "./components/ui/button";
import { PositionPriceChart } from "./components/PositionPriceChart";
import { PortfolioBenchmarkChart } from "./components/PortfolioBenchmarkChart";

const DASHBOARD_REFRESH_EVENT = "lavega:dashboard-refresh";

function otherBrokerUnconfigured(problem: string, broker: "ibkr" | "trading212"): boolean {
  const other = broker === "ibkr" ? /trading\s*212/i : /ibkr/i;
  return other.test(problem) && /credentials are not configured/i.test(problem);
}

type Health = { ok: boolean; service: string };
type BrokerProgress = { status: "idle" | "running" | "waiting" | "completed" | "problem"; pages: number; ordersRead: number; positionsRead: number; waitUntil: string | null; remaining: number | null; updatedAt: string | null; message: string | null };
type PriceProgress = { status: "idle" | "running" | "waiting" | "completed" | "problem"; total: number; completed: number; remainingSymbols: string[]; currentSymbol: string | null; waitUntil: string | null; updatedAt: string | null; message: string | null; problems: string[] };
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
    && typeof data.dataVersion === "number"
    && (data.benchmarks === undefined || Array.isArray(data.benchmarks))
    && Array.isArray(data.externalCashFlows)
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

type PositionSort = "instrument" | "value" | "weight" | "return";
type SortDirection = "asc" | "desc";

const POSITION_SORTS: Array<{ key: PositionSort; label: string }> = [
  { key: "instrument", label: "Instrument" },
  { key: "value", label: "Waarde" },
  { key: "weight", label: "% portefeuille" },
  { key: "return", label: "Totaal rendement" },
];

function numericCompare(left: number | null, right: number | null, direction: SortDirection): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return (left - right) * (direction === "asc" ? 1 : -1);
}

function PositionList({ positions, currency }: { positions: InvestingDashboardData["positions"]; currency: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSort = searchParams.get("sort");
  const sort: PositionSort = POSITION_SORTS.some(({ key }) => key === requestedSort) ? requestedSort as PositionSort : "value";
  const direction: SortDirection = searchParams.get("direction") === "asc" ? "asc" : "desc";
  if (positions.length === 0) return <EmptyState title="Geen posities geladen" description="Koppel een broker of importeer een overzicht om jouw beleggingen te zien." />;
  const sorted = [...positions].sort((left, right) => {
    if (sort === "instrument") {
      const result = `${left.description ?? left.symbol}\u0000${left.entity}`.localeCompare(`${right.description ?? right.symbol}\u0000${right.entity}`, "nl");
      return result * (direction === "asc" ? 1 : -1);
    }
    if (sort === "value") return numericCompare(left.marketValue, right.marketValue, direction);
    if (sort === "weight") return numericCompare(left.portfolioWeight, right.portfolioWeight, direction);
    return numericCompare(left.returns.totalReturn, right.returns.totalReturn, direction);
  });
  const money = (value: number) => value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2, signDisplay: "always" });
  const percent = (value: number) => value.toLocaleString("nl-NL", { style: "percent", maximumFractionDigits: 1, signDisplay: "always" });
  function changeSort(next: PositionSort) {
    const nextDirection: SortDirection = sort === next ? direction === "desc" ? "asc" : "desc" : next === "instrument" ? "asc" : "desc";
    setSearchParams({ sort: next, direction: nextDirection });
  }
  const query = searchParams.toString();
  return <div className="overflow-x-auto rounded-card border border-border" role="table" aria-label="Posities">
    <div className="min-w-[760px]">
      <div role="row" className="grid grid-cols-[minmax(220px,1.35fr)_minmax(130px,.8fr)_minmax(130px,.7fr)_minmax(220px,1fr)] bg-secondary/30 px-5 py-3">
        {POSITION_SORTS.map((column, index) => <div role="columnheader" aria-sort={sort === column.key ? direction === "asc" ? "ascending" : "descending" : "none"} key={column.key} className={index === 0 ? "text-left" : "text-right"}><button type="button" onClick={() => changeSort(column.key)} className="rounded-sm text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{column.label}{sort === column.key ? direction === "asc" ? " ↑" : " ↓" : ""}</button></div>)}
      </div>
      <div role="rowgroup" className="divide-y divide-border">
        {sorted.map((position) => <Link role="row" key={`${position.symbol}-${position.entity}`} to={{ pathname: `/positions/${encodeURIComponent(position.symbol)}`, search: query ? `?${query}` : "" }} className="group grid grid-cols-[minmax(220px,1.35fr)_minmax(130px,.8fr)_minmax(130px,.7fr)_minmax(220px,1fr)] items-center px-5 py-4 outline-none hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <div role="cell" className="min-w-0 pr-4"><span className="block truncate font-semibold text-primary">{position.description ?? position.symbol}</span><span className="block truncate text-xs text-muted-foreground">{position.symbol} · {position.entity} · {position.quantity.toLocaleString("nl-NL")} {position.currency}</span></div>
          <div role="cell" className="text-right text-sm tabular-nums">{position.marketValue === null ? <span className="text-muted-foreground">{position.priceStatus === "missing-fx" ? "FX-koers ontbreekt" : "Waarde onbekend"}</span> : <><span className="font-semibold">{money(position.marketValue).replace(/^\+/, "")}</span>{position.priceStatus === "forward-filled" && <span className="block text-xs text-warning">Geschatte koers</span>}</>}</div>
          <div role="cell" className="text-right text-sm tabular-nums">{position.portfolioWeight === null ? <span className="text-muted-foreground">Niet beschikbaar</span> : percent(position.portfolioWeight).replace(/^\+/, "")}</div>
          <div role="cell" className="pl-4 text-right text-sm tabular-nums">{position.returns.status === "available" && position.returns.totalReturn !== null ? <><span className={position.returns.totalReturn >= 0 ? "font-semibold text-positive" : "font-semibold text-negative"}>{money(position.returns.totalReturn)}{position.returns.totalReturnPercentage === null ? "" : ` (${percent(position.returns.totalReturnPercentage)})`}</span><span className="block text-xs text-muted-foreground">totaal rendement</span></> : <><span className="font-medium text-muted-foreground">{position.returns.status === "missing-fx" ? "FX-koers ontbreekt" : "Rendement niet beschikbaar"}</span>{position.returns.status === "missing-cost" && <span className="block text-xs leading-5 text-muted-foreground">Importeer eerdere transacties of koppel je andere brokers om rendement te berekenen.</span>}</>}</div>
        </Link>)}
      </div>
    </div>
  </div>;
}

function PortfolioCashSummary({ data }: { data: InvestingDashboardData }) {
  const latest = data.portfolio.All.at(-1);
  const money = (value: number | null) => value === null
    ? "Waarde onbekend"
    : value.toLocaleString("nl-NL", { style: "currency", currency: data.presentationCurrency, maximumFractionDigits: 2 });
  if (!latest) return null;
  const incomplete = latest.unpriced.length > 0 || latest.cashUnknown.length > 0;
  return <section aria-label="Portefeuillewaarde uitsplitsing" className="rounded-card border border-border bg-card p-5 shadow-soft">
    <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Laatste waarde</p>
    <p className="mt-2 font-display text-3xl font-semibold tabular-nums">{money(latest.value)}</p>
    <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
      <div><dt className="text-muted-foreground">Posities</dt><dd className="mt-1 font-semibold tabular-nums">{money(latest.positionsValue)}</dd></div>
      <div><dt className="text-muted-foreground">Cash</dt><dd className="mt-1 font-semibold tabular-nums">{money(latest.cashValue)}</dd></div>
    </dl>
    {latest.forwardFilled.length > 0 && <p className="mt-4 text-xs text-muted-foreground">Geschatte koers: {latest.forwardFilled.join(", ")}</p>}
    {incomplete && <div role="status" className="mt-4 rounded-[14px] border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-5">
      <p className="font-semibold">Waarde deels onbekend</p>
      {latest.unpriced.length > 0 && <p>Geen bruikbare koers: {latest.unpriced.join(", ")}</p>}
      {latest.cashUnknown.length > 0 && <p>Cashhistorie onbekend: {latest.cashUnknown.join(", ")}</p>}
    </div>}
  </section>;
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
        window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
        if (current) setProblems(nextProblems);
      } catch { if (current) setProblems(["Brokersynchronisatie mislukt."]); }
    };
    void run();
    return () => { current = false; };
  }, []);
  if (problems.length === 0) return null;
  return <div role="alert" className="rounded-card border border-negative/30 bg-negative/5 p-4 text-sm"><p className="font-semibold">Synchronisatieproblemen</p><ul className="mt-2 list-disc space-y-1 pl-5">{problems.map((problem, index) => <li key={`${problem}-${index}`}>{problem}</li>)}</ul></div>;
}

function PriceSyncProgressCard() {
  const [progress, setProgress] = useState<PriceProgress | null>(null);
  const refreshedRun = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const response = await fetch("/api/prices/sync/status");
        if (!response.ok) return;
        const next = await response.json() as PriceProgress;
        if (!current || !["idle", "running", "waiting", "completed", "problem"].includes(next.status)) return;
        setProgress(next);
        if ((next.status === "completed" || next.status === "problem") && next.updatedAt && refreshedRun.current !== next.updatedAt) {
          refreshedRun.current = next.updatedAt;
          window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
        }
      } catch { /* Dashboard remains usable with cached prices. */ }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 1_000);
    return () => { current = false; window.clearInterval(timer); };
  }, []);

  if (!progress || progress.status === "idle") return null;
  const active = progress.status === "running" || progress.status === "waiting";
  const problem = progress.status === "problem";
  return <section aria-live="polite" className={`rounded-card border p-4 ${problem ? "border-negative/30 bg-negative/5" : active ? "border-primary/20 bg-secondary/40" : "border-positive/30 bg-positive/5"}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Prijsgeschiedenis</p>
        <p className="mt-1 text-sm font-semibold">{active ? `${progress.completed} van ${progress.total} geladen` : problem ? "Voltooid met problemen" : "Actueel"}</p>
        {active && <p className="mt-1 truncate text-xs text-muted-foreground">{progress.currentSymbol ? `${progress.currentSymbol} wordt geladen` : `${progress.remainingSymbols.length} symbolen resterend`}</p>}
        {problem && <p className="mt-1 text-xs text-negative">{progress.problems.length} symboolproblemen; cache blijft beschikbaar.</p>}
      </div>
      <span className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${problem ? "bg-negative/10 text-negative" : active ? "bg-primary/10 text-primary" : "bg-positive/10 text-positive"}`}>{progress.status === "waiting" ? "Wachten" : progress.status === "running" ? "Bezig" : problem ? "Probleem" : "Voltooid"}</span>
    </div>
  </section>;
}

function ClearPriceCache() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function clear() { setBusy(true); setMessage(null); try { const response = await fetch("/api/prices/cache", { method: "DELETE" }); if (!response.ok) throw new Error("Wissen mislukt"); setMessage("Prijsgegevens verwijderd"); } catch (error) { setMessage(error instanceof Error ? error.message : "Wissen mislukt"); } finally { setBusy(false); } }
  if (confirming) return <div className="flex flex-wrap items-center justify-end gap-3" role="alert"><span className="text-xs text-negative">Dit verwijdert alle lokaal opgeslagen prijsgegevens.</span><Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Annuleren</Button><Button type="button" variant="destructive" size="sm" onClick={clear} disabled={busy}>{busy ? "Wissen…" : "Ja, alles verwijderen"}</Button></div>;
  return <div className="flex items-center gap-3"><Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} disabled={busy}>Prijsgegevens wissen</Button>{message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}</div>;
}

function BrokerSetupCard({
  name,
  eyebrow,
  description,
  fields,
  steps,
  warning,
}: {
  name: string;
  eyebrow: string;
  description: string;
  fields: string[];
  steps: string[];
  warning?: string;
}) {
  return <article className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6">
    <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{eyebrow}</p>
    <h3 className="mt-2 font-display text-3xl font-semibold">{name}</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-sm font-semibold">Gegevens die je nodig hebt</p>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">{fields.map((field) => <li key={field} className="flex gap-2"><span className="text-primary">✓</span><span>{field}</span></li>)}</ul>
    </div>
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-sm font-semibold">Zo vind je ze</p>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </div>
    {warning && <p role="note" className="mt-6 rounded-[14px] bg-warning/10 px-4 py-3 text-xs leading-5 text-foreground">{warning}</p>}
  </article>;
}

function BrokerSyncAction() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [problems, setProblems] = useState<string[]>([]);

  async function sync() {
    setStatus("loading");
    setProblems([]);
    try {
      const response = await fetch("/api/brokers/sync?force=true", { method: "POST" });
      const result = await response.json() as { problems?: string[] };
      if (!response.ok) throw new Error(result.problems?.[0] ?? "Broker synchronisatie mislukt.");
      const nextProblems = result.problems ?? [];
      setProblems(nextProblems);
      setStatus(nextProblems.length > 0 ? "error" : "success");
      if (nextProblems.length === 0) window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "Broker synchronisatie mislukt."]);
      setStatus("error");
    }
  }

  return <div className="rounded-card border border-border bg-secondary/40 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
    <div>
      <p className="text-sm font-semibold">Gegevens opgeslagen?</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">Start direct nieuwe broker-synchronisatie. Dit omzeilt dagelijkse sync-cache.</p>
    </div>
    <div className="mt-4 shrink-0 sm:mt-0">
      <Button type="button" onClick={sync} disabled={status === "loading"}>{status === "loading" ? "Synchroniseren…" : "Synchronisatie starten"}</Button>
    </div>
    {status === "success" && <p role="status" className="mt-3 text-sm text-positive sm:mt-0">Synchronisatie voltooid.</p>}
    {problems.length > 0 && <div role="alert" className="mt-4 basis-full rounded-[14px] border border-negative/20 bg-negative/5 px-4 py-3 text-sm"><p className="font-semibold">Synchronisatie niet voltooid</p><ul className="mt-2 list-disc space-y-1 pl-5">{problems.map((problem, index) => <li key={`${problem}-${index}`}>{problem}</li>)}</ul></div>}
  </div>;
}

function BrokerSyncProgressCard() {
  const [progress, setProgress] = useState<BrokerProgress | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const response = await fetch("/api/brokers/sync/status");
        if (!response.ok) return;
        const next = await response.json() as Partial<BrokerProgress>;
        if (current && ["idle", "running", "waiting", "completed", "problem"].includes(next.status ?? "")) setProgress(next as BrokerProgress);
      } catch { /* Existing sync result surfaces network errors. */ }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 1_000);
    return () => { current = false; window.clearInterval(timer); };
  }, []);

  if (!progress || progress.status === "idle" || progress.status === "problem") return null;
  const waiting = progress.status === "waiting";
  const completed = progress.status === "completed";
  const seconds = progress.waitUntil ? Math.max(0, Math.ceil((Date.parse(progress.waitUntil) - Date.now()) / 1_000)) : null;
  return <section aria-live="polite" className={`rounded-card border p-5 ${completed ? "border-positive/30 bg-positive/5" : waiting ? "border-warning/30 bg-warning/10" : "border-primary/20 bg-secondary/40"}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Brokersynchronisatie</p>
        <h3 className="mt-2 font-display text-2xl font-semibold">{completed ? "Trading 212 gesynchroniseerd" : "Trading 212 synchroniseert"}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{progress.pages} pagina’s · {progress.ordersRead.toLocaleString("nl-NL")} orders gelezen · {progress.positionsRead} posities</p>
      </div>
      <span className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${completed ? "bg-positive/10 text-positive" : waiting ? "bg-warning/20 text-foreground" : "bg-primary/10 text-primary"}`}>{completed ? "Voltooid" : waiting ? "API-pauze" : "Bezig"}</span>
    </div>
    {waiting && <p className="mt-4 text-sm font-medium">Wacht op nieuwe API-capaciteit{seconds !== null ? ` · verder over ${seconds} sec.` : ""}</p>}
    {!waiting && !completed && <p className="mt-4 text-sm text-muted-foreground">Volledige orderhistorie wordt geladen. Venster mag open blijven, maar hoeft niet.</p>}
  </section>;
}

function BrokerVaultUnlock() {
  const [vaultStatus, setVaultStatus] = useState<"checking" | "hidden" | "locked" | "unlocked">("checking");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetch("/api/brokers/credentials/status")
      .then(async (response) => response.ok ? await response.json() as { status?: string } : {})
      .then((result) => { if (current) setVaultStatus(result.status === "locked" ? "locked" : "hidden"); })
      .catch(() => { if (current) setVaultStatus("hidden"); });
    return () => { current = false; };
  }, []);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const unlockResponse = await fetch("/api/brokers/credentials/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase }) });
      const unlockResult = await unlockResponse.json().catch(() => ({})) as { problems?: string[] };
      if (!unlockResponse.ok) throw new Error(unlockResult.problems?.[0] ?? "Kluis ontgrendelen mislukt.");
      setPassphrase("");
      const syncResponse = await fetch("/api/brokers/sync?force=true", { method: "POST" });
      const syncResult = await syncResponse.json() as { problems?: string[] };
      if (!syncResponse.ok) throw new Error(syncResult.problems?.[0] ?? "Broker synchronisatie mislukt.");
      setVaultStatus("unlocked");
      setMessage((syncResult.problems ?? []).length === 0 ? "Kluis ontgrendeld. Synchronisatie voltooid." : `Kluis ontgrendeld. ${syncResult.problems?.join(" · ")}`);
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kluis ontgrendelen mislukt.");
    } finally {
      setBusy(false);
    }
  }

  if (vaultStatus === "checking" || vaultStatus === "hidden") return null;
  if (vaultStatus === "unlocked") return <p role="status" className="rounded-card border border-positive/30 bg-positive/5 p-4 text-sm text-positive">{message}</p>;
  return <form onSubmit={unlock} className="rounded-card border border-warning/30 bg-warning/10 p-5 sm:flex sm:items-end sm:gap-4 sm:p-6">
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Bestaande kluis</p>
      <h3 className="mt-2 font-display text-2xl font-semibold">Kluis ontgrendelen</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Inloggegevens staan versleuteld op schijf. Voer alleen kluiswachtwoord in; brokersleutels hoeven niet opnieuw.</p>
      <label className="mt-4 block text-sm font-semibold">Kluiswachtwoord<input required name="unlockPassphrase" type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal" /></label>
      {message && <p role="alert" className="mt-3 text-sm text-negative">{message}</p>}
    </div>
    <Button data-action="unlock-vault" type="submit" disabled={busy} className="mt-4 shrink-0 sm:mt-0">{busy ? "Ontgrendelen…" : "Ontgrendelen en synchroniseren"}</Button>
  </form>;
}

function BrokerCredentialForm() {
  const [broker, setBroker] = useState<"ibkr" | "trading212">("ibkr");
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function resetBroker(next: "ibkr" | "trading212") {
    setBroker(next); setToken(""); setQueryId(""); setSecret(""); setMessage(null); setStatus("idle");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading"); setMessage(null);
    const payload = { broker, token, ...(broker === "ibkr" ? { queryId } : { secret }), passphrase };
    try {
      const saveResponse = await fetch("/api/brokers/credentials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const saveResult = await saveResponse.json().catch(() => ({})) as { problems?: string[] };
      if (!saveResponse.ok) throw new Error(saveResult.problems?.[0] ?? "Inloggegevens opslaan mislukt.");
      const syncResponse = await fetch("/api/brokers/sync?force=true", { method: "POST" });
      const syncResult = await syncResponse.json() as { problems?: string[] };
      const blocking = (syncResult.problems ?? []).filter((problem) => !otherBrokerUnconfigured(problem, broker));
      if (!syncResponse.ok || blocking.length > 0) throw new Error(blocking[0] ?? syncResult.problems?.[0] ?? "Broker synchronisatie mislukt.");
      setStatus("success"); setMessage("Inloggegevens opgeslagen. Synchronisatie voltooid."); setToken(""); setQueryId(""); setSecret(""); setPassphrase("");
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    } catch (error) {
      setStatus("error"); setMessage(error instanceof Error ? error.message : "Broker koppelen mislukt.");
    }
  }

  return <form onSubmit={submit} className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Stap 2</p><h3 className="mt-2 font-display text-3xl font-semibold">Inloggegevens opslaan</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">LaVega versleutelt deze gegevens in lokale kluis. Daarna start synchronisatie automatisch.</p></div><label className="text-sm font-semibold">Broker<select aria-label="Broker" value={broker} onChange={(event) => resetBroker(event.target.value as "ibkr" | "trading212")} className="mt-2 block rounded-pill border border-input bg-background px-3 py-2 text-sm font-normal"><option value="ibkr">Interactive Brokers</option><option value="trading212">Trading 212</option></select></label></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">{broker === "ibkr" ? "Flex-token" : "API key"}<input required name="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal" /></label>
      {broker === "ibkr" ? <label className="text-sm font-semibold">Query ID<input required name="queryId" inputMode="numeric" value={queryId} onChange={(event) => setQueryId(event.target.value)} className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal" /></label> : <label className="text-sm font-semibold">API secret<input required name="secret" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal" /></label>}
      <label className="text-sm font-semibold sm:col-span-2">Kluiswachtwoord<input required name="passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal" /><span className="mt-2 block text-xs font-normal text-muted-foreground">Nieuwe kluis? Dit wachtwoord wordt kluissleutel. Bewaar het veilig; LaVega kan het niet herstellen.</span></label>
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-4"><Button type="submit" disabled={status === "loading"}>{status === "loading" ? "Opslaan en synchroniseren…" : "Opslaan en synchroniseren"}</Button>{status === "success" && <span role="status" className="text-sm text-positive">{message}</span>}{status === "error" && <span role="alert" className="text-sm text-negative">{message}</span>}</div>
  </form>;
}

function BrokerConnect() {
  return <div className="mx-auto max-w-5xl space-y-8">
    <div className="max-w-2xl">
      <Link to="/" className="text-sm font-semibold text-primary hover:underline">← Terug naar overzicht</Link>
      <p className="mb-2 mt-8 text-sm font-medium text-primary">Veilige lokale koppeling</p>
      <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Broker koppelen</h2>
      <p className="mt-4 text-base leading-7 text-muted-foreground">Volg instructies voor jouw broker. LaVega gebruikt alleen read-only gegevens en bewaart credentials lokaal.</p>
    </div>
    <BrokerVaultUnlock />
    <BrokerSyncProgressCard />
    <div className="grid gap-5 lg:grid-cols-2">
      <BrokerSetupCard
        name="Interactive Brokers"
        eyebrow="IBKR"
        description="Gebruik IBKR Flex Web Service. Dit werkt met dagelijks bijgewerkte rapporten, zonder lokale gateway of browser-login."
        fields={["Flex-token", "Numeriek Query ID", "Flex Query met Open Positions, Trades, Cash Report en Statement of Funds"]}
        steps={["Open Client Portal van Interactive Brokers.", "Ga naar Performance & Reports → Flex Queries.", "Maak één query met Open Positions, Trades, Cash Report en Statement of Funds.", "Sla query op en noteer het numerieke Query ID.", "Ga naar Flex Web Service en genereer token. Noteer token direct; IBKR toont deze beperkt."]}
      />
      <BrokerSetupCard
        name="Trading 212"
        eyebrow="Trading 212"
        description="Gebruik de officiële Trading 212 API. LaVega leest posities en orders via jouw eigen API-credentials."
        fields={["API key", "API secret"]}
        steps={["Open de Trading 212-app.", "Ga naar Menu → Settings → API (of API management).", "Maak een API-key voor jouw Invest- of Stocks ISA-account.", "Kies read-only scope als Trading 212 die optie toont.", "Kopieer API key en API secret. Het secret kan daarna niet opnieuw zichtbaar zijn."]}
        warning="Controleer scope vóór opslaan. Een key zonder read-only beperking kan mogelijk orders plaatsen."
      />
    </div>
    <BrokerCredentialForm />
    <BrokerSyncAction />
    <p className="rounded-card border border-border bg-secondary/40 p-4 text-sm leading-6 text-muted-foreground">Credentials blijven op jouw machine. Deel Flex-tokens, API keys of API secrets nooit in chat, screenshots, issues of git.</p>
  </div>;
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
  const connect = location.pathname === "/brokers/connect";
  return <div className="min-h-screen p-3 sm:p-6"><div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-frame bg-background shadow-float sm:min-h-[calc(100vh-3rem)]"><header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><Link to="/" className="pressable group"><span className="text-xs font-semibold uppercase tracking-[.2em] text-primary">LaVega</span><h1 className="font-display text-3xl font-semibold leading-none">Investeren</h1></Link><nav aria-label="Hoofdnavigatie" className="flex items-center gap-1 rounded-pill bg-secondary p-1"><NavLink to="/" end className={({ isActive }) => `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Overzicht</NavLink><NavLink to="/positions" className={({ isActive }) => `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Posities</NavLink></nav></header><main className="px-5 py-8 sm:px-8 sm:py-12">{!connect && <div className="mb-8 flex items-end justify-between gap-4"><div><p className="mb-2 text-sm font-medium text-primary">{detail ? "Positiedetail" : "Jouw financiële overzicht"}</p><h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{detail ? "Positie" : "Overzicht"}</h2></div>{!detail && <Link to="/brokers/connect" className="pressable inline-flex items-center justify-center whitespace-nowrap rounded-pill border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary">Broker koppelen</Link>}</div>}<Outlet /></main><footer className="border-t border-border px-5 py-5 text-xs text-muted-foreground sm:px-8"><span role="status"><HealthStatus /></span></footer></div></div>;
}

function Overview() {
  const state = useDashboard();
  return <div className="space-y-5"><AppOpenSync /><div className="grid gap-3 lg:grid-cols-2"><BrokerSyncProgressCard /><PriceSyncProgressCard /></div><div className="flex justify-end"><ClearPriceCache /></div>{state.status === "loading" ? <DashboardLoading /> : state.status === "error" ? <DashboardError message={state.message} /> : <><DashboardProblems problems={state.data.problems} /><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><PortfolioBenchmarkChart data={state.data.portfolio} benchmarks={state.data.benchmarks ?? []} externalCashFlows={state.data.externalCashFlows} currency={state.data.presentationCurrency} /><div className="space-y-5"><PortfolioCashSummary data={state.data} /><AllocationDonut instrument={state.data.allocation.instrument} entity={state.data.allocation.entity} /></div></div><PositionList positions={state.data.positions} currency={state.data.presentationCurrency} /></>}</div>;
}

function Positions() {
  const state = useDashboard();
  if (state.status === "loading") return <DashboardLoading />;
  if (state.status === "error") return <DashboardError message={state.message} />;
  return <><DashboardProblems problems={state.data.problems} /><PositionList positions={state.data.positions} currency={state.data.presentationCurrency} /></>;
}

const detailDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

function PositionDetailSummary({ position }: { position: InvestingPositionDetail }) {
  const [quantityOpen, setQuantityOpen] = useState(false);
  const money = (value: number | null) => value === null ? "Niet beschikbaar" : value.toLocaleString("nl-NL", { style: "currency", currency: position.currency, maximumFractionDigits: 2, signDisplay: "always" });
  const percent = (value: number | null) => value === null ? "Niet beschikbaar" : value.toLocaleString("nl-NL", { style: "percent", maximumFractionDigits: 1, signDisplay: "always" });
  const available = position.returnStatus === "available";
  return <section aria-labelledby="position-title" className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{position.status === "closed" ? "Gesloten positie" : "Open positie"}</p><h3 id="position-title" className="mt-1 font-display text-3xl font-semibold">{position.description ?? position.symbol}</h3><p className="mt-1 text-sm text-muted-foreground">{position.symbol} · bedragen in {position.currency}</p></div><span className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${position.status === "closed" ? "bg-secondary text-muted-foreground" : "bg-positive/10 text-positive"}`}>{position.status === "closed" ? "Gesloten" : "Open"}</span></div>
    <dl className={`mt-6 grid gap-3 ${position.status === "closed" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
      {position.status === "open" && <div className="rounded-[14px] bg-secondary/40 p-4"><dt className="text-xs font-semibold text-muted-foreground">Huidige waarde</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(position.currentValue).replace(/^\+/, "")}</dd></div>}
      {position.status === "open" && <div className="rounded-[14px] bg-secondary/40 p-4"><dt className="text-xs font-semibold text-muted-foreground">Dagverandering</dt><dd className={`mt-1 text-xl font-semibold tabular-nums ${position.dailyChange === null ? "text-muted-foreground" : position.dailyChange >= 0 ? "text-positive" : "text-negative"}`}>{money(position.dailyChange)}{position.dailyChangePercentage === null ? "" : ` (${percent(position.dailyChangePercentage)})`}</dd></div>}
      <div className="rounded-[14px] bg-secondary/40 p-4"><dt className="text-xs font-semibold text-muted-foreground">Totaal rendement</dt><dd className={`mt-1 text-xl font-semibold tabular-nums ${!available || position.returns.totalReturn === null ? "text-muted-foreground" : position.returns.totalReturn >= 0 ? "text-positive" : "text-negative"}`}>{available ? `${money(position.returns.totalReturn)}${position.returns.totalReturnPercentage === null ? "" : ` (${percent(position.returns.totalReturnPercentage)})`}` : "Niet beschikbaar"}</dd></div>
      {position.status === "closed" && <div className="rounded-[14px] bg-secondary/40 p-4"><dt className="text-xs font-semibold text-muted-foreground">Eindstatus</dt><dd className="mt-1 text-xl font-semibold">0 stuks · gesloten</dd></div>}
    </dl>
    {!available && <p role="status" className="mt-4 rounded-[14px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm">{position.returnStatus === "missing-fx" ? "FX-koers ontbreekt. Rendement kan niet worden berekend." : "Importeer eerdere transacties of koppel je andere brokers om rendement te berekenen."}</p>}
    <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-muted-foreground">Aantal</dt><dd className="mt-1 font-semibold tabular-nums">{position.quantity.toLocaleString("nl-NL")}</dd><button type="button" aria-expanded={quantityOpen} aria-controls="quantity-history" onClick={() => setQuantityOpen((open) => !open)} className="pressable mt-1 rounded-sm text-xs font-semibold text-primary underline-offset-2 hover:underline">{quantityOpen ? "Historie verbergen" : "Aantalhistorie tonen"}</button></div>
      {position.status === "open" && <><div><dt className="text-muted-foreground">Gemiddelde kostprijs</dt><dd className="mt-1 font-semibold tabular-nums">{money(position.averageCost).replace(/^\+/, "")}</dd></div><div><dt className="text-muted-foreground">Huidige koers</dt><dd className="mt-1 font-semibold tabular-nums">{money(position.currentPrice).replace(/^\+/, "")}</dd></div><div><dt className="text-muted-foreground">Ongerealiseerd</dt><dd className="mt-1 font-semibold tabular-nums">{money(position.returns.unrealizedGain)}{position.returns.remainingCostBasis && position.returns.unrealizedGain !== null ? ` (${percent(position.returns.unrealizedGain / position.returns.remainingCostBasis)})` : ""}</dd></div></>}
      <div><dt className="text-muted-foreground">Gerealiseerd</dt><dd className="mt-1 font-semibold tabular-nums">{money(position.returns.realizedGain)}</dd></div><div><dt className="text-muted-foreground">Dividend ontvangen</dt><dd className="mt-1 font-semibold tabular-nums">{money(position.returns.dividendsReceived)}</dd></div><div><dt className="text-muted-foreground">Eerste aankoop</dt><dd className="mt-1 font-semibold">{position.firstBuyDate ? detailDate(position.firstBuyDate) : "Niet beschikbaar"}</dd></div>
    </dl>
    {quantityOpen && <ol id="quantity-history" className="mt-5 space-y-2 border-t border-border pt-4 text-sm">{position.quantityHistory.length === 0 ? <li className="text-muted-foreground">Geen volledige aantalhistorie beschikbaar.</li> : position.quantityHistory.map((change) => <li key={`${change.date}-${change.sourceOrder}`} className="flex flex-wrap justify-between gap-2"><span>{detailDate(change.date)} · {change.reason === "buy" ? "Koop" : "Verkoop"}</span><span className="font-semibold tabular-nums">{change.delta > 0 ? "+" : ""}{change.delta.toLocaleString("nl-NL")} → {change.quantity.toLocaleString("nl-NL")}</span></li>)}</ol>}
  </section>;
}

function PositionActivityTable({ position }: { position: InvestingPositionDetail }) {
  const dates = [...new Set(position.activity.map((item) => item.date))];
  const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("nl-NL", { maximumFractionDigits: 4 });
  return <section aria-labelledby="activity-title" className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6"><h3 id="activity-title" className="font-display text-2xl font-semibold">Activiteit</h3>{dates.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Geen transactie- of dividendhistorie beschikbaar.</p> : <div className="mt-4 overflow-x-auto"><div role="table" aria-label="Positieactiviteit" className="min-w-[760px] text-sm"><div role="row" className="grid grid-cols-[150px_100px_90px_120px_120px_110px_70px] border-b border-border pb-2 text-xs font-semibold text-muted-foreground"><span>Datum</span><span>Type</span><span className="text-right">Aantal</span><span className="text-right">Koers</span><span className="text-right">Bedrag</span><span className="text-right">Commissie</span><span className="text-right">Valuta</span></div>{dates.map((date) => <div key={date} id={`activity-${date}`} tabIndex={-1} className="scroll-mt-4 border-b border-border/70 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">{position.activity.filter((item) => item.date === date).map((item) => <div role="row" key={`${item.kind}-${item.sourceOrder}`} className="grid grid-cols-[150px_100px_90px_120px_120px_110px_70px] py-1.5 tabular-nums"><span>{detailDate(date)}</span><span className="font-semibold">{item.kind === "buy" ? "Koop" : item.kind === "sell" ? "Verkoop" : "Dividend"}</span><span className="text-right">{number(item.quantity)}</span><span className="text-right">{number(item.executionPrice)}</span><span className="text-right">{number(item.amount)}</span><span className="text-right">{number(item.commission)}</span><span className="text-right">{item.currency}</span></div>)}</div>)}</div></div>}</section>;
}

function CompletePositionDetail({ position }: { position: InvestingPositionDetail }) {
  const activate = (date: string) => { const row = document.getElementById(`activity-${date}`); row?.scrollIntoView?.({ block: "nearest" }); row?.focus(); };
  return <><PositionDetailSummary position={position} /><PositionPriceChart symbol={position.symbol} currency={position.priceCurrency} points={position.points} onMarkerActivate={activate} /><PositionActivityTable position={position} /></>;
}

function PositionDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const [searchParams] = useSearchParams();
  const positionSymbol = symbol?.trim().toUpperCase() ?? "";
  const state = useDashboard(positionSymbol || undefined);
  const query = searchParams.toString();
  return <div className="space-y-5"><Link to={{ pathname: "/positions", search: query ? `?${query}` : "" }} className="text-sm font-semibold text-primary hover:underline">← Terug naar posities</Link>{!positionSymbol ? <EmptyState title="Geen positie gekozen" description="Kies een positie om koershistorie te bekijken." /> : state.status === "loading" ? <DashboardLoading /> : state.status === "error" ? <DashboardError message={state.message} /> : state.data.position?.symbol.toUpperCase() === positionSymbol ? <><DashboardProblems problems={state.data.problems} /><CompletePositionDetail position={state.data.position} /></> : <EmptyState title="Positie niet gevonden" description="Deze positie staat niet in het lokale dashboardmodel." />}</div>;
}

export function App() { return <Routes><Route element={<Layout />}><Route path="/" element={<Overview />} /><Route path="/positions" element={<Positions />} /><Route path="/positions/:symbol" element={<PositionDetail />} /><Route path="/brokers/connect" element={<BrokerConnect />} /></Route></Routes>; }
