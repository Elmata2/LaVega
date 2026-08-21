import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { InvestingDashboardData } from "@lavega/core";
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
        fields={["Flex-token", "Numeriek Query ID", "Flex Query met Open Positions en Trades"]}
        steps={["Open Client Portal van Interactive Brokers.", "Ga naar Performance & Reports → Flex Queries.", "Maak één query met Open Positions en Trades.", "Sla query op en noteer het numerieke Query ID.", "Ga naar Flex Web Service en genereer token. Noteer token direct; IBKR toont deze beperkt."]}
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
  return <div className="space-y-5"><AppOpenSync /><BrokerSyncProgressCard /><div className="flex justify-end"><ClearPriceCache /></div>{state.status === "loading" ? <DashboardLoading /> : state.status === "error" ? <DashboardError message={state.message} /> : <><DashboardProblems problems={state.data.problems} /><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><PortfolioBenchmarkChart data={state.data.portfolio} currency={state.data.presentationCurrency} /><AllocationDonut instrument={state.data.allocation.instrument} entity={state.data.allocation.entity} /></div><PositionList positions={state.data.positions} /></>}</div>;
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

export function App() { return <Routes><Route element={<Layout />}><Route path="/" element={<Overview />} /><Route path="/positions" element={<Positions />} /><Route path="/positions/:symbol" element={<PositionDetail />} /><Route path="/brokers/connect" element={<BrokerConnect />} /></Route></Routes>; }
