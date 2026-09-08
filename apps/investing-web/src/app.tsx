import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  buildIndexedSeries,
  type InvestingDashboardData,
  type InvestingPositionDetail,
} from "@lavega/core";
import { EmptyState } from "./components/EmptyState";
import { AllocationDonut } from "./components/AllocationDonut";
import { AuthForm } from "./components/AuthForm";
import { RequireAuth } from "./components/RequireAuth";
import { Button } from "./components/ui/button";
import { PositionPriceChart } from "./components/PositionPriceChart";
import { PortfolioBenchmarkChart } from "./components/PortfolioBenchmarkChart";
import { NetWorthChart } from "./components/NetWorthChart";
import { PortfolioSummaryCard } from "./components/PortfolioSummaryCard";
import { signOut } from "./lib/auth-client";
import { longDate } from "./lib/dates.js";
import {
  DASHBOARD_REFRESH_EVENT,
  runPriceSyncUntilComplete,
  type PriceSyncProgress,
} from "./lib/priceSync";

const BROKER_SYNC_STARTED_EVENT = "lavega:broker-sync-started";

const SYNC_BACKGROUND_MESSAGE = "Sync continues in the background; progress is shown above.";

function brokerSyncActive(status?: BrokerProgress["status"]): boolean {
  return status === "running" || status === "waiting";
}

function priceSyncActive(status?: PriceProgress["status"]): boolean {
  return status === "running" || status === "waiting" || status === "paused";
}

function notifyBrokerSyncStarted() {
  window.dispatchEvent(new Event(BROKER_SYNC_STARTED_EVENT));
}

/* An initial full sync takes longer than the edge timeout: Cloudflare cuts the request off after about 100 seconds with an HTML page (524) while the server keeps working. A response without JSON is therefore not a failure, and the parse error should not appear as an on-screen error. */
async function readSyncResult(response: Response): Promise<{ problems?: string[] } | null> {
  return (await response.json().catch(() => null)) as { problems?: string[] } | null;
}

function otherBrokerUnconfigured(problem: string, broker: "ibkr" | "trading212"): boolean {
  const other = broker === "ibkr" ? /trading\s*212/i : /ibkr/i;
  return other.test(problem) && /credentials are not configured/i.test(problem);
}

function filterVisibleSyncProblems(problems: readonly string[]): string[] {
  return problems.filter((problem) => !/credentials are not configured/i.test(problem));
}

/* `service` only comes back from the investing server itself. Mounted on
 * lavega.dev the personal server answers /health, and it names no service. */
type Health = { ok: boolean; service?: string };
type BrokerProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
};
type PriceProgress = PriceSyncProgress;
type PortfolioAgentDefinition = {
  id: string;
  displayName: string;
  description: string;
  investingStyle: string;
};
type PortfolioAgentInsight = {
  agentId: string;
  displayName: string;
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  summary: string;
  reasoning: string;
  insights: string[];
  model: string;
  snapshotHash: string;
};
type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: InvestingDashboardData; refreshError?: string }
  | { status: "error"; message: string };

function isDashboardData(value: unknown): value is InvestingDashboardData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<InvestingDashboardData>;
  return (
    typeof data.presentationCurrency === "string" &&
    Boolean(data.portfolio && typeof data.portfolio === "object") &&
    Boolean(data.allocation && typeof data.allocation === "object") &&
    typeof data.dataVersion === "number" &&
    (data.benchmarks === undefined || Array.isArray(data.benchmarks)) &&
    Array.isArray(data.externalCashFlows) &&
    Array.isArray(data.positions) &&
    Array.isArray(data.problems) &&
    (data.position === null || (Boolean(data.position) && typeof data.position === "object"))
  );
}

async function fetchDashboard(symbol?: string): Promise<InvestingDashboardData> {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const response = await fetch(`/api/investing/dashboard${query}`);
  if (!response.ok) throw new Error(`Failed to load dashboard: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isDashboardData(payload)) throw new Error("Dashboard data has an invalid format.");
  return payload;
}

function isPortfolioAgentDefinition(value: unknown): value is PortfolioAgentDefinition {
  if (!value || typeof value !== "object") return false;
  const agent = value as Partial<PortfolioAgentDefinition>;
  return (
    typeof agent.id === "string" &&
    typeof agent.displayName === "string" &&
    typeof agent.description === "string" &&
    typeof agent.investingStyle === "string"
  );
}

function isPortfolioAgentInsight(value: unknown): value is PortfolioAgentInsight {
  if (!value || typeof value !== "object") return false;
  const insight = value as Partial<PortfolioAgentInsight>;
  return (
    typeof insight.agentId === "string" &&
    typeof insight.displayName === "string" &&
    (insight.signal === "bullish" ||
      insight.signal === "bearish" ||
      insight.signal === "neutral") &&
    typeof insight.confidence === "number" &&
    typeof insight.summary === "string" &&
    typeof insight.reasoning === "string" &&
    Array.isArray(insight.insights) &&
    typeof insight.model === "string" &&
    typeof insight.snapshotHash === "string"
  );
}

async function fetchPortfolioAgents(): Promise<PortfolioAgentDefinition[]> {
  const response = await fetch("/api/agents/portfolio");
  if (!response.ok) throw new Error("Failed to load agents.");
  const payload = (await response.json()) as { agents?: unknown };
  const agents = Array.isArray(payload.agents)
    ? payload.agents.filter(isPortfolioAgentDefinition)
    : [];
  if (agents.length === 0) throw new Error("No portfolio agents available.");
  return agents;
}

async function runPortfolioAgent(agentId: string, prompt?: string): Promise<PortfolioAgentInsight> {
  const body = prompt ? { agentId, prompt } : { agentId };
  const response = await fetch("/api/agents/portfolio/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    problems?: string[];
  };
  if (!response.ok) throw new Error(payload.problems?.[0] ?? "Agent run failed.");
  if (!isPortfolioAgentInsight(payload.result)) throw new Error("Agent gave an invalid answer.");
  return payload.result;
}

function useDashboard(symbol?: string): DashboardState {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    const load = () => {
      setState((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
      void fetchDashboard(symbol)
        .then((data) => {
          if (current) setState({ status: "ready", data });
        })
        .catch((reason: unknown) => {
          if (!current) return;
          const message = reason instanceof Error ? reason.message : "Failed to load dashboard";
          setState((previous) =>
            previous.status === "ready"
              ? { ...previous, refreshError: message }
              : { status: "error", message },
          );
        });
    };
    load();
    window.addEventListener(DASHBOARD_REFRESH_EVENT, load);
    return () => {
      current = false;
      window.removeEventListener(DASHBOARD_REFRESH_EVENT, load);
    };
  }, [symbol]);
  return state;
}

function DashboardLoading() {
  return (
    <div
      role="status"
      className="rounded-card border border-border bg-secondary/30 p-6 text-sm text-muted-foreground"
    >
      Loading dashboard…
    </div>
  );
}

function DashboardError({ message }: { message: string }) {
  return <EmptyState title="Dashboard unavailable" description={message} />;
}

function DashboardProblems({ problems }: { problems: string[] }) {
  const visibleProblems = filterVisibleSyncProblems(problems);
  if (visibleProblems.length === 0) return null;
  return (
    <div role="alert" className="rounded-card border border-negative/30 bg-negative/5 p-4 text-sm">
      <p className="font-semibold">Reading problems</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {visibleProblems.map((problem, index) => (
          <li key={`${problem}-${index}`}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

type PositionSort = "instrument" | "value" | "weight" | "return";
type SortDirection = "asc" | "desc";

const POSITION_SORTS: Array<{ key: PositionSort; label: string }> = [
  { key: "instrument", label: "Instrument" },
  { key: "value", label: "Value" },
  { key: "weight", label: "% portfolio" },
  { key: "return", label: "Total return" },
];

function numericCompare(
  left: number | null,
  right: number | null,
  direction: SortDirection,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return (left - right) * (direction === "asc" ? 1 : -1);
}

function PositionList({
  positions,
  currency,
}: {
  positions: InvestingDashboardData["positions"];
  currency: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSort = searchParams.get("sort");
  const sort: PositionSort = POSITION_SORTS.some(({ key }) => key === requestedSort)
    ? (requestedSort as PositionSort)
    : "value";
  const direction: SortDirection = searchParams.get("direction") === "asc" ? "asc" : "desc";
  if (positions.length === 0)
    return (
      <EmptyState
        title="No positions loaded"
        description="Connect a broker or import a statement to see your investments."
      />
    );
  const sorted = [...positions].sort((left, right) => {
    if (sort === "instrument") {
      const result = `${left.description ?? left.symbol}\u0000${left.entity}`.localeCompare(
        `${right.description ?? right.symbol}\u0000${right.entity}`,
        "en",
      );
      return result * (direction === "asc" ? 1 : -1);
    }
    if (sort === "value") return numericCompare(left.marketValue, right.marketValue, direction);
    if (sort === "weight")
      return numericCompare(left.portfolioWeight, right.portfolioWeight, direction);
    return numericCompare(left.returns.totalReturn, right.returns.totalReturn, direction);
  });
  const money = (value: number) =>
    value.toLocaleString("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      signDisplay: "always",
    });
  const percent = (value: number) =>
    value.toLocaleString("en-GB", {
      style: "percent",
      maximumFractionDigits: 1,
      signDisplay: "always",
    });
  function changeSort(next: PositionSort) {
    const nextDirection: SortDirection =
      sort === next
        ? direction === "desc"
          ? "asc"
          : "desc"
        : next === "instrument"
          ? "asc"
          : "desc";
    setSearchParams({ sort: next, direction: nextDirection });
  }
  const query = searchParams.toString();
  return (
    <div
      className="overflow-x-auto rounded-card border border-border"
      role="table"
      aria-label="Positions"
    >
      <div className="min-w-[760px]">
        <div
          role="row"
          className="grid grid-cols-[minmax(220px,1.35fr)_minmax(130px,.8fr)_minmax(130px,.7fr)_minmax(220px,1fr)] bg-secondary/30 px-5 py-3"
        >
          {POSITION_SORTS.map((column, index) => (
            <div
              role="columnheader"
              aria-sort={
                sort === column.key ? (direction === "asc" ? "ascending" : "descending") : "none"
              }
              key={column.key}
              className={index === 0 ? "text-left" : "text-right"}
            >
              <button
                type="button"
                onClick={() => changeSort(column.key)}
                className="rounded-sm text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {column.label}
                {sort === column.key ? (direction === "asc" ? " ↑" : " ↓") : ""}
              </button>
            </div>
          ))}
        </div>
        <div role="rowgroup" className="divide-y divide-border">
          {sorted.map((position) => (
            <Link
              role="row"
              key={`${position.symbol}-${position.entity}`}
              to={{
                pathname: `/positions/${encodeURIComponent(position.symbol)}`,
                search: query ? `?${query}` : "",
              }}
              className="group grid grid-cols-[minmax(220px,1.35fr)_minmax(130px,.8fr)_minmax(130px,.7fr)_minmax(220px,1fr)] items-center px-5 py-4 outline-none hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div role="cell" className="min-w-0 pr-4">
                <span className="block truncate font-semibold text-primary">
                  {position.description ?? position.symbol}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {position.symbol} · {position.entity} ·{" "}
                  {position.quantity.toLocaleString("en-GB")} shares
                </span>
              </div>
              <div role="cell" className="text-right text-sm tabular-nums">
                {position.marketValue === null ? (
                  <span className="text-muted-foreground">
                    {position.priceStatus === "missing-fx" ? "FX rate missing" : "Value unknown"}
                  </span>
                ) : (
                  <>
                    <span className="font-semibold">
                      {money(position.marketValue).replace(/^\+/, "")}
                    </span>
                    {position.priceStatus === "forward-filled" && (
                      <span className="block text-xs text-warning">Estimated price</span>
                    )}
                  </>
                )}
              </div>
              <div role="cell" className="text-right text-sm tabular-nums">
                {position.portfolioWeight === null ? (
                  <span className="text-muted-foreground">Unavailable</span>
                ) : (
                  percent(position.portfolioWeight).replace(/^\+/, "")
                )}
              </div>
              <div role="cell" className="pl-4 text-right text-sm tabular-nums">
                {(position.returns.status === "available" ||
                  position.returns.status === "broker-average") &&
                position.returns.totalReturn !== null ? (
                  <>
                    <span
                      className={
                        position.returns.totalReturn >= 0
                          ? "font-semibold text-positive"
                          : "font-semibold text-negative"
                      }
                    >
                      {money(position.returns.totalReturn)}
                      {position.returns.totalReturnPercentage === null
                        ? ""
                        : ` (${percent(position.returns.totalReturnPercentage)})`}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {position.returns.status === "broker-average"
                        ? "return on average purchase price"
                        : "total return"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-muted-foreground">
                      {position.returns.status === "missing-fx"
                        ? "FX rate missing"
                        : "Return unavailable"}
                    </span>
                    {position.returns.status === "missing-cost" && (
                      <span className="block text-xs leading-5 text-muted-foreground">
                        Import earlier transactions or connect your other brokers to calculate
                        return.
                      </span>
                    )}
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function PortfolioKpis({ data }: { data: InvestingDashboardData }) {
  const points = data.portfolio.All;
  const latest = points.at(-1);
  const previous = points.at(-2);
  const pricedPositionsValue = data.positions.reduce(
    (sum, position) => sum + (position.marketValue ?? 0),
    0,
  );
  const portfolioValue = latest?.value ?? (pricedPositionsValue > 0 ? pricedPositionsValue : null);
  const usingPositionsFallback =
    (latest?.value === null || latest?.value === undefined) && pricedPositionsValue > 0;
  const dailyChange =
    latest?.value !== null &&
    latest?.value !== undefined &&
    previous?.value !== null &&
    previous?.value !== undefined
      ? latest.value - previous.value
      : null;
  const dailyChangePercentage =
    dailyChange !== null && previous?.value ? dailyChange / previous.value : null;
  const totalReturn =
    buildIndexedSeries(points, [], data.externalCashFlows).at(-1)?.portfolioReturn ?? null;
  const money = (value: number | null, signDisplay: "auto" | "always" = "auto") =>
    value === null
      ? "Value unknown"
      : value.toLocaleString("en-GB", {
          style: "currency",
          currency: data.presentationCurrency,
          maximumFractionDigits: 2,
          signDisplay,
        });
  const percentage = (value: number | null) =>
    value === null
      ? "Return unknown"
      : value.toLocaleString("en-GB", {
          style: "percent",
          maximumFractionDigits: 2,
          signDisplay: "always",
        });
  return (
    <section
      aria-label="Portfolio KPIs"
      className="rounded-card border border-border bg-card p-5 shadow-soft"
      data-dashboard-section="kpis"
    >
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
        Key figures
      </p>
      <dl className="mt-4 space-y-4">
        <div>
          <dt className="text-xs text-muted-foreground">Portfolio value</dt>
          <dd
            className={`mt-1 font-display text-3xl font-semibold tabular-nums ${portfolioValue === null ? "text-muted-foreground" : ""}`}
          >
            {money(portfolioValue)}
          </dd>
          {usingPositionsFallback && (
            <dd className="text-xs text-muted-foreground">
              Priced positions only; cash and history are still missing.
            </dd>
          )}
        </div>
        <div className="border-t border-border pt-4">
          <dt className="text-xs text-muted-foreground">Daily change</dt>
          <dd
            className={`mt-1 font-display text-2xl font-semibold tabular-nums ${dailyChange === null ? "text-muted-foreground" : dailyChange >= 0 ? "text-positive" : "text-negative"}`}
          >
            {money(dailyChange, "always")}
          </dd>
          <dd className="text-xs text-muted-foreground">{percentage(dailyChangePercentage)}</dd>
        </div>
        <div className="border-t border-border pt-4">
          <dt className="text-xs text-muted-foreground">Total return</dt>
          <dd
            className={`mt-1 font-display text-2xl font-semibold tabular-nums ${totalReturn === null ? "text-muted-foreground" : totalReturn >= 0 ? "text-positive" : "text-negative"}`}
          >
            {percentage(totalReturn)}
          </dd>
          <dd className="text-xs text-muted-foreground">TWR after deposits and withdrawals</dd>
        </div>
      </dl>
      {latest && latest.forwardFilled.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Estimated price: {latest.forwardFilled.join(", ")}
        </p>
      )}
      {latest && (latest.unpriced.length > 0 || latest.cashUnknown.length > 0) && (
        <div
          role="status"
          className="mt-4 rounded-[14px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5"
        >
          <p className="font-semibold">Value partly unknown</p>
          {latest.unpriced.length > 0 && <p>No usable price: {latest.unpriced.join(", ")}</p>}
          {latest.cashUnknown.length > 0 && (
            <p>Cash history unknown: {latest.cashUnknown.join(", ")}</p>
          )}
        </div>
      )}
    </section>
  );
}

function PortfolioAgentCard() {
  const [agents, setAgents] = useState<PortfolioAgentDefinition[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [insight, setInsight] = useState<PortfolioAgentInsight | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "running" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetchPortfolioAgents()
      .then((items) => {
        if (!current) return;
        setAgents(items);
        setSelected(items[0]?.id ?? "");
        setStatus("idle");
      })
      .catch((error) => {
        if (!current) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Failed to load agents.");
      });
    return () => {
      current = false;
    };
  }, []);

  async function run() {
    if (!selected) return;
    setStatus("running");
    setMessage(null);
    try {
      setInsight(await runPortfolioAgent(selected));
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Agent run failed.");
    }
  }

  const active = agents.find((agent) => agent.id === selected);
  const navigate = useNavigate();
  function openAgentWindow(agentId: string) {
    const base = window.location.pathname.startsWith("/investing") ? "/investing" : "";
    const target = `${base}/agents/${encodeURIComponent(agentId)}`;
    const popup = window.open(target, "lavega-agent-workbench", "popup,width=1180,height=860");
    if (!popup) navigate(`/agents/${encodeURIComponent(agentId)}`);
  }
  const tone =
    insight?.signal === "bullish"
      ? "text-positive"
      : insight?.signal === "bearish"
        ? "text-negative"
        : "text-muted-foreground";
  return (
    <section
      aria-labelledby="portfolio-agent-title"
      className="rounded-card border border-border bg-card p-5 shadow-soft"
      data-dashboard-section="agent"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Agent</p>
          <h3 id="portfolio-agent-title" className="mt-1 font-display text-2xl font-semibold">
            Investor lens
          </h3>
        </div>
        {insight && (
          <span className={`rounded-pill bg-secondary px-3 py-1.5 text-xs font-semibold ${tone}`}>
            {insight.signal} · {Math.round(insight.confidence)}%
          </span>
        )}
      </div>
      {status === "loading" ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading agents…
        </p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Choose agent" className="mt-4 grid grid-cols-2 gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => openAgentWindow(agent.id)}
                className={`pressable rounded-[14px] border px-3 py-2 text-left text-xs font-semibold transition-colors ${selected === agent.id ? "border-primary bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
              >
                {agent.displayName}
              </button>
            ))}
          </div>
          {active && (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{active.investingStyle}</p>
          )}
          {active && (
            <Link
              to={`/agents/${active.id}`}
              className="pressable mt-4 flex items-center justify-between rounded-[14px] border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10"
            >
              <span>Open conversation with {active.displayName}</span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
          <Button
            type="button"
            className="mt-4 w-full"
            onClick={run}
            disabled={status === "running" || agents.length === 0}
          >
            {status === "running" ? "Agent reading…" : "Analyse portfolio"}
          </Button>
          {message && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {message}
            </p>
          )}
          {insight && (
            <article className="mt-4 rounded-[14px] border border-border bg-secondary/30 p-4">
              <p className="text-sm font-semibold">{insight.displayName}</p>
              <p className="mt-2 text-sm leading-6">{insight.summary}</p>
              {insight.insights.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                  {insight.insights.map((item, index) => (
                    <li key={`${insight.snapshotHash}-${index}`}>{item}</li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{insight.reasoning}</p>
            </article>
          )}
        </>
      )}
    </section>
  );
}

type AgentMessage = { role: "user" | "assistant"; content: string };

function AgentView() {
  const { agentId } = useParams();
  const dashboard = useDashboard();
  const [agents, setAgents] = useState<PortfolioAgentDefinition[]>([]);
  const [conversations, setConversations] = useState<Record<string, AgentMessage[]>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchPortfolioAgents()
      .then(setAgents)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Failed to load agents.");
      });
  }, []);

  const agent = agents.find((item) => item.id === agentId);

  const initialMessage: AgentMessage | null = agent
    ? {
        role: "assistant",
        content: `I am ${agent.displayName}. I look at your positions through this lens. Ask a question about concentration, return or risk.`,
      }
    : null;
  const messages = agent ? (conversations[agent.id] ?? [initialMessage!]) : [];

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!agent || !question || sending) return;
    setInput("");
    setError(null);
    setConversations((current) => ({
      ...current,
      [agent.id]: [
        ...(current[agent.id] ?? [initialMessage!]),
        { role: "user", content: question },
      ],
    }));
    setSending(true);
    try {
      const insight = await runPortfolioAgent(agent.id, question);
      const response = [insight.summary, ...insight.insights].filter(Boolean).join("\n\n");
      setConversations((current) => ({
        ...current,
        [agent.id]: [
          ...(current[agent.id] ?? [initialMessage!]),
          { role: "assistant", content: response },
        ],
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent reply failed.");
    } finally {
      setSending(false);
    }
  }

  if (dashboard.status === "loading" || agents.length === 0) return <DashboardLoading />;
  if (dashboard.status === "error") return <DashboardError message={dashboard.message} />;
  if (!agent) {
    return <EmptyState title="Agent not found" description="Choose an agent from the overview." />;
  }

  const contextPositions = [...dashboard.data.positions].sort(
    (left, right) => (right.marketValue ?? -Infinity) - (left.marketValue ?? -Infinity),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="flex min-h-[620px] flex-col rounded-card border border-border bg-card shadow-soft">
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            ← Back to overview
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-primary">
            Portfolio agent
          </p>
          <h2 className="mt-1 font-display text-4xl font-semibold">{agent.displayName}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.investingStyle}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-6" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[86%] whitespace-pre-line rounded-[18px] px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
              >
                {message.content}
              </p>
            </div>
          ))}
          {sending && (
            <p role="status" className="text-sm text-muted-foreground">
              {agent.displayName} is reading positions…
            </p>
          )}
        </div>
        <form onSubmit={sendMessage} className="border-t border-border p-4 sm:p-5">
          <label htmlFor="agent-message" className="sr-only">
            Ask {agent.displayName}
          </label>
          <div className="flex gap-2 rounded-[16px] border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            <input
              id="agent-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your positions…"
              className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
              disabled={sending}
            />
            <Button type="submit" size="sm" disabled={sending || input.trim().length === 0}>
              Send
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {error}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Educational analysis. No personal investment advice.
          </p>
        </form>
      </section>
      <aside
        aria-label="Positions in conversation"
        className="flex min-h-0 flex-col rounded-card border border-border bg-card p-5 shadow-soft lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)]"
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Context</p>
            <h3 className="mt-1 font-display text-2xl font-semibold">Your positions</h3>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {contextPositions.length}
          </span>
        </div>
        <div className="mt-4 min-h-0 max-h-96 flex-1 space-y-1.5 overflow-y-auto pr-1 lg:max-h-none">
          {contextPositions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positions available.</p>
          ) : (
            contextPositions.map((position) => (
              <Link
                key={`${position.symbol}-${position.entity}`}
                to={`/positions/${encodeURIComponent(position.symbol)}`}
                className="pressable flex items-center justify-between gap-3 rounded-[12px] bg-secondary/60 px-3 py-2.5 hover:bg-secondary"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {position.description ?? position.symbol}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {position.symbol} · {position.quantity.toLocaleString("en-GB")} shares
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs font-semibold tabular-nums">
                  {position.marketValue === null
                    ? "Unknown"
                    : position.marketValue.toLocaleString("en-GB", {
                        style: "currency",
                        currency: dashboard.data.presentationCurrency,
                        maximumFractionDigits: 0,
                      })}
                </span>
              </Link>
            ))
          )}
        </div>
        <Link
          to="/positions"
          className="pressable mt-3 shrink-0 text-center text-xs font-semibold text-primary hover:underline"
        >
          View all positions →
        </Link>
      </aside>
    </div>
  );
}

type StatusTone = "neutral" | "active" | "success" | "warning" | "problem";

function StatusChip({
  label,
  value,
  detail,
  tone = "neutral",
  children,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: StatusTone;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "problem"
      ? "border-negative/30 bg-negative/5"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10"
        : tone === "success"
          ? "border-positive/30 bg-positive/5"
          : tone === "active"
            ? "border-primary/20 bg-secondary/40"
            : "border-border bg-secondary/20";
  const dotClass =
    tone === "problem"
      ? "bg-negative"
      : tone === "warning"
        ? "bg-warning"
        : tone === "success"
          ? "bg-positive"
          : tone === "active"
            ? "bg-primary"
            : "bg-muted-foreground";
  return (
    <div className={`rounded-[14px] border px-3 py-2.5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClass}`} />
          {label}
        </span>
        <span className="text-xs font-semibold">{value}</span>
      </div>
      {detail && <p className="mt-1 truncate pl-4 text-[11px] text-muted-foreground">{detail}</p>}
      {children}
    </div>
  );
}

function OverviewStatusRail({ dataVersion }: { dataVersion: number }) {
  const [broker, setBroker] = useState<BrokerProgress | null>(null);
  const [price, setPrice] = useState<PriceProgress | null>(null);
  const [vault, setVault] = useState<"empty" | "locked" | "unlocked" | "unknown">("unknown");
  const refreshedPriceRun = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    let timer: number | null = null;
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const load = async () => {
      const [brokerResult, priceResult, vaultResult] = await Promise.allSettled([
        fetch("/api/brokers/sync/status").then(async (response) =>
          response.ok ? ((await response.json()) as BrokerProgress) : null,
        ),
        fetch("/api/prices/sync/status").then(async (response) =>
          response.ok ? ((await response.json()) as PriceProgress) : null,
        ),
        fetch("/api/brokers/credentials/status").then(async (response) =>
          response.ok ? ((await response.json()) as { status?: string }) : null,
        ),
      ]);
      if (!current) return;
      let active = false;
      if (
        brokerResult.status === "fulfilled" &&
        brokerResult.value &&
        ["idle", "running", "waiting", "completed", "problem"].includes(brokerResult.value.status)
      ) {
        setBroker(brokerResult.value);
        active = active || brokerSyncActive(brokerResult.value.status);
      }
      if (
        priceResult.status === "fulfilled" &&
        priceResult.value &&
        ["idle", "running", "waiting", "paused", "completed", "problem"].includes(
          priceResult.value.status,
        )
      ) {
        setPrice(priceResult.value);
        active = active || priceSyncActive(priceResult.value.status);
        if (
          (priceResult.value.status === "completed" || priceResult.value.status === "problem") &&
          priceResult.value.updatedAt &&
          refreshedPriceRun.current !== priceResult.value.updatedAt
        ) {
          refreshedPriceRun.current = priceResult.value.updatedAt;
          window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
        }
      }
      if (
        vaultResult.status === "fulfilled" &&
        ["empty", "locked", "unlocked"].includes(vaultResult.value?.status ?? "")
      )
        setVault(vaultResult.value!.status as "empty" | "locked" | "unlocked");
      if (active) timer = window.setTimeout(load, 1_000);
    };
    const wake = () => {
      clearTimer();
      void load();
    };
    void load();
    window.addEventListener(BROKER_SYNC_STARTED_EVENT, wake);
    return () => {
      current = false;
      clearTimer();
      window.removeEventListener(BROKER_SYNC_STARTED_EVENT, wake);
    };
  }, []);
  const brokerValue =
    broker?.status === "running"
      ? "In progress"
      : broker?.status === "waiting"
        ? "Waiting"
        : broker?.status === "completed"
          ? "Up to date"
          : broker?.status === "problem"
            ? "Problem"
            : broker?.status === "idle"
              ? "Ready"
              : "Unknown";
  const priceValue =
    price?.status === "running" || price?.status === "paused"
      ? `${price.completed} of ${price.total} loaded`
      : price?.status === "waiting"
        ? "Waiting"
        : price?.status === "completed"
          ? "Up to date"
          : price?.status === "problem"
            ? "Problem"
            : price?.status === "idle"
              ? "Ready"
              : "Unknown";
  const statusTone = (status?: BrokerProgress["status"] | PriceProgress["status"]): StatusTone =>
    status === "problem"
      ? "problem"
      : status === "waiting"
        ? "warning"
        : status === "running" || status === "paused"
          ? "active"
          : status === "completed"
            ? "success"
            : "neutral";
  return (
    <section
      aria-label="Operational status"
      className="rounded-card border border-border bg-card p-4 shadow-soft"
      data-dashboard-section="status"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
        Status
      </p>
      <div className="space-y-2" aria-live="polite">
        <StatusChip
          label="Brokers"
          value={brokerValue}
          tone={statusTone(broker?.status)}
          detail={
            broker?.status === "waiting"
              ? (broker.message ?? "Waiting for API capacity")
              : broker?.status === "problem"
                ? (broker.message ?? "Cached data remains visible")
                : undefined
          }
        />
        <StatusChip
          label="Price history"
          value={priceValue}
          tone={statusTone(price?.status)}
          detail={
            price?.status === "running" || price?.status === "paused"
              ? price.currentSymbol
                ? `${price.currentSymbol} is loading`
                : `${price.remainingSymbols.length} symbols remaining`
              : price?.status === "problem"
                ? `${price.problems.length} symbol problems; cache remains available`
                : undefined
          }
        />
        <StatusChip
          label="Vault"
          value={
            vault === "unlocked"
              ? "Open"
              : vault === "locked"
                ? "Locked"
                : vault === "empty"
                  ? "Not set up"
                  : "Unknown"
          }
          tone={vault === "unlocked" ? "success" : vault === "locked" ? "warning" : "neutral"}
        />
        <StatusChip
          label="Cache"
          value={`Version ${dataVersion}`}
          tone={dataVersion > 0 ? "success" : "neutral"}
        >
          <div className="mt-2 flex justify-end">
            <ClearPriceCache />
          </div>
        </StatusChip>
      </div>
    </section>
  );
}

function AppOpenSync() {
  const [problems, setProblems] = useState<string[]>([]);
  const [consent, setConsent] = useState<"checking" | "required" | "accepted">("checking");
  const [consentBusy, setConsentBusy] = useState(false);
  const runSync = useCallback(async (current: () => boolean) => {
    try {
      notifyBrokerSyncStarted();
      const brokerResponse = await fetch("/api/brokers/sync", { method: "POST" });
      const brokerResult = await readSyncResult(brokerResponse);
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
      if (current()) setProblems(filterVisibleSyncProblems(brokerResult?.problems ?? []));
      const priceProblems = await runPriceSyncUntilComplete(current);
      if (current() && priceProblems.length > 0)
        setProblems((existing) => [...existing, ...priceProblems]);
    } catch {
      if (current()) setProblems(["Broker sync failed."]);
    }
  }, []);
  useEffect(() => {
    let current = true;
    const prepare = async () => {
      try {
        const response = await fetch("/api/market-data/consent");
        const decision = (await response.json()) as { accepted?: boolean };
        if (!response.ok) throw new Error("Consent could not be read.");
        if (!current) return;
        if (!decision.accepted) {
          setConsent("required");
          return;
        }
        setConsent("accepted");
        await runSync(() => current);
      } catch (error) {
        if (current)
          setProblems([error instanceof Error ? error.message : "Consent could not be read."]);
      }
    };
    void prepare();
    return () => {
      current = false;
    };
  }, [runSync]);
  async function acceptYahoo() {
    setConsentBusy(true);
    setProblems([]);
    try {
      const response = await fetch("/api/market-data/consent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      if (!response.ok) throw new Error("Failed to save consent.");
      setConsent("accepted");
      await runSync(() => true);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "Failed to save consent."]);
    } finally {
      setConsentBusy(false);
    }
  }
  if (consent === "required")
    return (
      <section
        aria-labelledby="yahoo-consent-title"
        className="rounded-card border border-warning/30 bg-warning/10 p-5 text-sm"
      >
        <h3 id="yahoo-consent-title" className="font-semibold">
          Yahoo Finance consent
        </h3>
        <p className="mt-2 leading-6 text-muted-foreground">
          LaVega sends tickers and search terms to Yahoo Finance to fetch price history and
          benchmarks. Your choice is stored locally. Without consent, cached data remains visible.
        </p>
        <Button type="button" className="mt-4" onClick={acceptYahoo} disabled={consentBusy}>
          {consentBusy ? "Saving…" : "Allow Yahoo Finance"}
        </Button>
        {problems.length > 0 && (
          <p role="alert" className="mt-3 text-negative">
            {problems[0]}
          </p>
        )}
      </section>
    );
  if (consent === "checking" && problems.length === 0)
    return (
      <div
        role="status"
        className="rounded-card border border-border bg-card p-4 text-sm text-muted-foreground"
      >
        Checking market data consent…
      </div>
    );
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="rounded-card border border-negative/30 bg-negative/5 p-4 text-sm">
      <p className="font-semibold">Sync problems</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {problems.map((problem, index) => (
          <li key={`${problem}-${index}`}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

function ClearPriceCache() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/prices/cache", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to clear");
      setMessage("Price data deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to clear");
    } finally {
      setBusy(false);
    }
  }
  if (confirming)
    return (
      <div className="flex flex-wrap items-center justify-end gap-3" role="alert">
        <span className="text-xs text-negative">This deletes all locally stored price data.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={clear} disabled={busy}>
          {busy ? "Clearing…" : "Yes, delete everything"}
        </Button>
      </div>
    );
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        Clear price data
      </Button>
      {message && (
        <span role="status" className="text-xs text-muted-foreground">
          {message}
        </span>
      )}
    </div>
  );
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
  return (
    <article className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{eyebrow}</p>
      <h3 className="mt-2 font-display text-3xl font-semibold">{name}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-sm font-semibold">Data you need</p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {fields.map((field) => (
            <li key={field} className="flex gap-2">
              <span className="text-primary">✓</span>
              <span>{field}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-sm font-semibold">How to find them</p>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      {warning && (
        <p
          role="note"
          className="mt-6 rounded-[14px] bg-warning/10 px-4 py-3 text-xs leading-5 text-foreground"
        >
          {warning}
        </p>
      )}
    </article>
  );
}

function BrokerSyncAction() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [problems, setProblems] = useState<string[]>([]);

  async function sync() {
    setStatus("loading");
    setProblems([]);
    try {
      notifyBrokerSyncStarted();
      const response = await fetch("/api/brokers/sync?force=true", { method: "POST" });
      const result = (await response.json()) as { problems?: string[] };
      if (!response.ok) throw new Error(result.problems?.[0] ?? "Broker sync failed.");
      const nextProblems = filterVisibleSyncProblems(result.problems ?? []);
      setProblems(nextProblems);
      setStatus(nextProblems.length > 0 ? "error" : "success");
      if (nextProblems.length === 0) window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "Broker sync failed."]);
      setStatus("error");
    }
  }

  return (
    <div className="rounded-card border border-border bg-secondary/40 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-sm font-semibold">Data saved?</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Start a new broker sync now. This bypasses the daily sync cache.
        </p>
      </div>
      <div className="mt-4 shrink-0 sm:mt-0">
        <Button type="button" onClick={sync} disabled={status === "loading"}>
          {status === "loading" ? "Syncing…" : "Start sync"}
        </Button>
      </div>
      {status === "success" && (
        <p role="status" className="mt-3 text-sm text-positive sm:mt-0">
          Sync completed.
        </p>
      )}
      {problems.length > 0 && (
        <div
          role="alert"
          className="mt-4 basis-full rounded-[14px] border border-negative/20 bg-negative/5 px-4 py-3 text-sm"
        >
          <p className="font-semibold">Sync not completed</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((problem, index) => (
              <li key={`${problem}-${index}`}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BrokerSyncProgressCard() {
  const [progress, setProgress] = useState<BrokerProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let current = true;
    let timer: number | null = null;
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const load = async () => {
      try {
        const response = await fetch("/api/brokers/sync/status");
        if (!response.ok) return;
        const next = (await response.json()) as Partial<BrokerProgress>;
        if (
          !current ||
          !["idle", "running", "waiting", "completed", "problem"].includes(next.status ?? "")
        )
          return;
        setProgress(next as BrokerProgress);
        if (brokerSyncActive(next.status)) timer = window.setTimeout(load, 1_000);
      } catch {
        /* Existing sync result surfaces network errors. */
      }
    };
    const wake = () => {
      clearTimer();
      void load();
    };
    void load();
    window.addEventListener(BROKER_SYNC_STARTED_EVENT, wake);
    return () => {
      current = false;
      clearTimer();
      window.removeEventListener(BROKER_SYNC_STARTED_EVENT, wake);
    };
  }, []);

  useEffect(() => {
    if (!progress?.waitUntil || progress.status !== "waiting") return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [progress?.waitUntil, progress?.status]);

  if (!progress || progress.status === "idle" || progress.status === "problem") return null;
  const waiting = progress.status === "waiting";
  const completed = progress.status === "completed";
  const seconds = progress.waitUntil
    ? Math.max(0, Math.ceil((Date.parse(progress.waitUntil) - now) / 1_000))
    : null;
  return (
    <section
      aria-live="polite"
      className={`rounded-card border p-5 ${completed ? "border-positive/30 bg-positive/5" : waiting ? "border-warning/30 bg-warning/10" : "border-primary/20 bg-secondary/40"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">
            Broker sync
          </p>
          <h3 className="mt-2 font-display text-2xl font-semibold">
            {completed ? "Trading 212 synced" : "Trading 212 syncing"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {progress.pages} pages · {progress.ordersRead.toLocaleString("en-GB")} orders read ·{" "}
            {progress.positionsRead} positions
          </p>
        </div>
        <span
          className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${completed ? "bg-positive/10 text-positive" : waiting ? "bg-warning/20 text-foreground" : "bg-primary/10 text-primary"}`}
        >
          {completed ? "Completed" : waiting ? "API pause" : "In progress"}
        </span>
      </div>
      {waiting && (
        <p className="mt-4 text-sm font-medium">
          Waiting for new API capacity{seconds !== null ? ` · continuing in ${seconds} sec.` : ""}
        </p>
      )}
      {!waiting && !completed && (
        <p className="mt-4 text-sm text-muted-foreground">
          Full order history is loading. You may keep this window open, but you don't have to.
        </p>
      )}
    </section>
  );
}

/**
 * Whether this runtime's vault is opened by a passphrase the user types.
 * A vault the server holds the key to has nothing to ask for, so the field and
 * every promise around it have to disappear rather than sit there unused.
 */
function useVaultPassphraseMode(): "checking" | "required" | "unused" {
  const [mode, setMode] = useState<"checking" | "required" | "unused">("checking");
  useEffect(() => {
    let current = true;
    void fetch("/api/brokers/credentials/status")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { passphrase?: string }) : {},
      )
      .then((result) => {
        if (current) setMode(result.passphrase === "unused" ? "unused" : "required");
      })
      .catch(() => {
        if (current) setMode("required");
      });
    return () => {
      current = false;
    };
  }, []);
  return mode;
}

function BrokerVaultUnlock() {
  const [vaultStatus, setVaultStatus] = useState<"checking" | "hidden" | "locked" | "unlocked">(
    "checking",
  );
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetch("/api/brokers/credentials/status")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { status?: string }) : {},
      )
      .then((result) => {
        if (current) setVaultStatus(result.status === "locked" ? "locked" : "hidden");
      })
      .catch(() => {
        if (current) setVaultStatus("hidden");
      });
    return () => {
      current = false;
    };
  }, []);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const unlockResponse = await fetch("/api/brokers/credentials/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const unlockResult = (await unlockResponse.json().catch(() => ({}))) as {
        problems?: string[];
      };
      if (!unlockResponse.ok)
        throw new Error(unlockResult.problems?.[0] ?? "Failed to unlock vault.");
      setPassphrase("");
      notifyBrokerSyncStarted();
      const syncResponse = await fetch("/api/brokers/sync?force=true", { method: "POST" });
      const syncResult = await readSyncResult(syncResponse);
      if (!syncResult) {
        setVaultStatus("unlocked");
        setMessage(`Vault unlocked. ${SYNC_BACKGROUND_MESSAGE}`);
        window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
        void runPriceSyncUntilComplete();
        return;
      }
      if (!syncResponse.ok) throw new Error(syncResult.problems?.[0] ?? "Broker sync failed.");
      setVaultStatus("unlocked");
      setMessage(
        (syncResult.problems ?? []).length === 0
          ? "Vault unlocked. Sync completed."
          : `Vault unlocked. ${syncResult.problems?.join(" · ")}`,
      );
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
      /* An initial sync provides the positions; the prices behind them only arrive while someone keeps asking. This page is that someone. */
      void runPriceSyncUntilComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to unlock vault.");
    } finally {
      setBusy(false);
    }
  }

  if (vaultStatus === "checking" || vaultStatus === "hidden") return null;
  if (vaultStatus === "unlocked")
    return (
      <p
        role="status"
        className="rounded-card border border-positive/30 bg-positive/5 p-4 text-sm text-positive"
      >
        {message}
      </p>
    );
  return (
    <form
      onSubmit={unlock}
      className="rounded-card border border-warning/30 bg-warning/10 p-5 sm:flex sm:items-end sm:gap-4 sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">
          Existing vault
        </p>
        <h3 className="mt-2 font-display text-2xl font-semibold">Unlock vault</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Credentials are stored encrypted on disk. Enter only the vault password; broker keys are
          not needed again.
        </p>
        <label className="mt-4 block text-sm font-semibold">
          Vault password
          <input
            required
            name="unlockPassphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
          />
        </label>
        {message && (
          <p role="alert" className="mt-3 text-sm text-negative">
            {message}
          </p>
        )}
      </div>
      <Button
        data-action="unlock-vault"
        type="submit"
        disabled={busy}
        className="mt-4 shrink-0 sm:mt-0"
      >
        {busy ? "Unlocking…" : "Unlock and sync"}
      </Button>
    </form>
  );
}

function BrokerCredentialForm() {
  const [broker, setBroker] = useState<"ibkr" | "trading212">("ibkr");
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const passphraseMode = useVaultPassphraseMode();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function resetBroker(next: "ibkr" | "trading212") {
    setBroker(next);
    setToken("");
    setQueryId("");
    setSecret("");
    setMessage(null);
    setStatus("idle");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
    const payload = {
      broker,
      token,
      ...(broker === "ibkr" ? { queryId } : { secret }),
      ...(passphraseMode === "unused" ? {} : { passphrase }),
    };
    try {
      const saveResponse = await fetch("/api/brokers/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saveResult = (await saveResponse.json().catch(() => ({}))) as { problems?: string[] };
      if (!saveResponse.ok)
        throw new Error(saveResult.problems?.[0] ?? "Failed to save credentials.");
      notifyBrokerSyncStarted();
      const syncResponse = await fetch("/api/brokers/sync?force=true", { method: "POST" });
      const syncResult = await readSyncResult(syncResponse);
      if (!syncResult) {
        setStatus("success");
        setMessage(`Credentials saved. ${SYNC_BACKGROUND_MESSAGE}`);
        setToken("");
        setQueryId("");
        setSecret("");
        setPassphrase("");
        window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
        return;
      }
      const blocking = (syncResult.problems ?? []).filter(
        (problem) => !otherBrokerUnconfigured(problem, broker),
      );
      if (!syncResponse.ok || blocking.length > 0)
        throw new Error(blocking[0] ?? syncResult.problems?.[0] ?? "Broker sync failed.");
      setStatus("success");
      setMessage("Credentials saved. Sync completed.");
      setToken("");
      setQueryId("");
      setSecret("");
      setPassphrase("");
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to connect broker.");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Step 2</p>
          <h3 className="mt-2 font-display text-3xl font-semibold">Save credentials</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {passphraseMode === "unused"
              ? "LaVega encrypts these details with the server key before storing them. Sync then starts automatically."
              : "LaVega encrypts these details in the local vault. Sync then starts automatically."}
          </p>
        </div>
        <label className="text-sm font-semibold">
          Broker
          <select
            aria-label="Broker"
            value={broker}
            onChange={(event) => resetBroker(event.target.value as "ibkr" | "trading212")}
            className="mt-2 block rounded-pill border border-input bg-background px-3 py-2 text-sm font-normal"
          >
            <option value="ibkr">Interactive Brokers</option>
            <option value="trading212">Trading 212</option>
          </select>
        </label>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          {broker === "ibkr" ? "Flex-token" : "API key"}
          <input
            required
            name="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
          />
        </label>
        {broker === "ibkr" ? (
          <label className="text-sm font-semibold">
            Query ID
            <input
              required
              name="queryId"
              inputMode="numeric"
              value={queryId}
              onChange={(event) => setQueryId(event.target.value)}
              className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
            />
          </label>
        ) : (
          <label className="text-sm font-semibold">
            API secret
            <input
              required
              name="secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
            />
          </label>
        )}
        {passphraseMode !== "unused" && (
          <label className="text-sm font-semibold sm:col-span-2">
            Vault password
            <input
              required
              name="passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
            />
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              New vault? This password becomes the vault key. Keep it safe; LaVega cannot recover
              it.
            </span>
          </label>
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Saving and syncing…" : "Save and sync"}
        </Button>
        {status === "success" && (
          <span role="status" className="text-sm text-positive">
            {message}
          </span>
        )}
        {status === "error" && (
          <span role="alert" className="text-sm text-negative">
            {message}
          </span>
        )}
      </div>
    </form>
  );
}

function BrokerConnect() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="max-w-2xl">
        <Link to="/" className="text-sm font-semibold text-primary hover:underline">
          ← Back to overview
        </Link>
        <p className="mb-2 mt-8 text-sm font-medium text-primary">Secure local connection</p>
        <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Connect broker
        </h2>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          Follow the instructions for your broker. LaVega only uses read-only data and stores
          credentials locally.
        </p>
      </div>
      <BrokerVaultUnlock />
      <BrokerSyncProgressCard />
      <div className="grid gap-5 lg:grid-cols-2">
        <BrokerSetupCard
          name="Interactive Brokers"
          eyebrow="IBKR"
          description="Use IBKR Flex Web Service. This works with daily updated reports, without a local gateway or browser login."
          fields={[
            "Flex-token",
            "Numeric Query ID",
            "Flex Query with Open Positions, Trades, Cash Report and Statement of Funds",
          ]}
          steps={[
            "Open the Interactive Brokers Client Portal.",
            "Go to Performance & Reports → Flex Queries.",
            "Create one query with Open Positions, Trades, Cash Report and Statement of Funds.",
            "Save the query and note the numeric Query ID.",
            "Go to Flex Web Service and generate a token. Note the token immediately; IBKR only shows it briefly.",
          ]}
        />
        <BrokerSetupCard
          name="Trading 212"
          eyebrow="Trading 212"
          description="Use the official Trading 212 API. LaVega reads positions and orders via your own API credentials."
          fields={["API key", "API secret"]}
          steps={[
            "Open the Trading 212 app.",
            "Go to Menu → Settings → API (or API management).",
            "Create an API key for your Invest or Stocks ISA account.",
            "Choose read-only scope if Trading 212 shows that option.",
            "Copy the API key and API secret. The secret may not be shown again afterwards.",
          ]}
          warning="Check the scope before saving. A key without a read-only restriction may be able to place orders."
        />
      </div>
      <BrokerCredentialForm />
      <BrokerSyncAction />
      <p className="rounded-card border border-border bg-secondary/40 p-4 text-sm leading-6 text-muted-foreground">
        Credentials stay on your machine. Never share Flex tokens, API keys or API secrets in chat,
        screenshots, issues or git.
      </p>
    </div>
  );
}

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The investing runtime answers under /api/, and only /api/ is guaranteed to
   * reach it. `${BASE_URL}health` reads /investing/health on lavega.dev, which
   * the CDN serves as the SPA shell: the check parsed a page as JSON and
   * reported the server down while every API route was answering. Deploys
   * differ in what owns the origin root, so /health is not it either. */
  useEffect(() => {
    fetch("/api/investing/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
        return (await response.json().catch(() => {
          throw new Error("Health check returned no server response");
        })) as Health;
      })
      .then(setHealth)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Health check failed"),
      );
  }, []);
  if (error) return <span className="text-negative">Server unavailable: {error}</span>;
  if (!health) return <span>Verbinden met investeringsserver…</span>;
  return (
    <span>
      {health.service ?? "server"}: {health.ok ? "beschikbaar" : "niet beschikbaar"}
    </span>
  );
}

function SignOutLink() {
  const navigate = useNavigate();
  async function handleSignOut() {
    await signOut();
    navigate("/sign-in", { replace: true });
  }
  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="pressable rounded-sm font-semibold text-primary underline-offset-2 hover:underline"
    >
      Sign out
    </button>
  );
}

function Layout() {
  const location = useLocation();
  const detail = location.pathname.startsWith("/positions/");
  const agentView = location.pathname.startsWith("/agents/");
  const connect = location.pathname === "/brokers/connect";
  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-frame bg-background shadow-float sm:min-h-[calc(100vh-3rem)]">
        <header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/" className="pressable group">
            <span className="text-xs font-semibold uppercase tracking-[.2em] text-primary">
              LaVega
            </span>
            <h1 className="font-display text-3xl font-semibold leading-none">Investing</h1>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 rounded-pill bg-secondary p-1"
          >
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`
              }
            >
              Overview
            </NavLink>
            <NavLink
              to="/positions"
              className={({ isActive }) =>
                `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`
              }
            >
              Positions
            </NavLink>
          </nav>
        </header>
        <main className="px-5 py-8 sm:px-8 sm:py-12">
          {!connect && (
            <div className="mb-8 flex items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-sm font-medium text-primary">
                  {detail
                    ? "Position detail"
                    : agentView
                      ? "Agent conversation"
                      : "Your financial overview"}
                </p>
                <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                  {detail ? "Position" : agentView ? "Agent" : "Overview"}
                </h2>
              </div>
              {!detail && !agentView && (
                <Link
                  to="/brokers/connect"
                  className="pressable inline-flex items-center justify-center whitespace-nowrap rounded-pill border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary"
                >
                  Connect broker
                </Link>
              )}
            </div>
          )}
          <Outlet />
        </main>
        <footer className="flex items-center justify-between border-t border-border px-5 py-5 text-xs text-muted-foreground sm:px-8">
          <span role="status">
            <HealthStatus />
          </span>
          <SignOutLink />
        </footer>
      </div>
    </div>
  );
}

function Overview() {
  const state = useDashboard();
  return (
    <div className="space-y-5">
      <AppOpenSync />
      {state.status === "loading" ? (
        <DashboardLoading />
      ) : state.status === "error" ? (
        <DashboardError message={state.message} />
      ) : (
        <>
          {state.refreshError && (
            <div
              role="alert"
              className="rounded-card border border-warning/30 bg-warning/10 p-4 text-sm"
            >
              <p className="font-semibold">Refresh failed</p>
              <p className="mt-1 text-muted-foreground">
                {state.refreshError} Cached data remains visible.
              </p>
            </div>
          )}
          <DashboardProblems problems={state.data.problems} />
          <div
            className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]"
            data-dashboard-layout="overview"
          >
            <div className="min-w-0 space-y-5">
              <div data-dashboard-section="performance">
                <PortfolioBenchmarkChart
                  data={state.data.portfolio}
                  benchmarks={state.data.benchmarks ?? []}
                  externalCashFlows={state.data.externalCashFlows}
                  currency={state.data.presentationCurrency}
                />
              </div>
              <div data-dashboard-section="allocation">
                <AllocationDonut
                  instrument={state.data.allocation.instrument}
                  entity={state.data.allocation.entity}
                  currency={state.data.presentationCurrency}
                />
              </div>
            </div>
            <aside aria-label="Portfolio overview" className="space-y-5">
              <PortfolioKpis data={state.data} />
              <PortfolioSummaryCard currency={state.data.presentationCurrency} />
              <PortfolioAgentCard />
              <OverviewStatusRail dataVersion={state.data.dataVersion} />
            </aside>
          </div>
          <section aria-labelledby="positions-heading" data-dashboard-section="positions">
            <h3 id="positions-heading" className="mb-3 font-display text-2xl font-semibold">
              Positions
            </h3>
            <PositionList
              positions={state.data.positions}
              currency={state.data.presentationCurrency}
            />
          </section>
          <NetWorthChart data={state.data.portfolio} currency={state.data.presentationCurrency} />
        </>
      )}
    </div>
  );
}

function Positions() {
  const state = useDashboard();
  if (state.status === "loading") return <DashboardLoading />;
  if (state.status === "error") return <DashboardError message={state.message} />;
  return (
    <>
      <DashboardProblems problems={state.data.problems} />
      <PositionList positions={state.data.positions} currency={state.data.presentationCurrency} />
    </>
  );
}

const detailDate = longDate;

function PositionDetailSummary({ position }: { position: InvestingPositionDetail }) {
  const [quantityOpen, setQuantityOpen] = useState(false);
  const money = (value: number | null) =>
    value === null
      ? "Unavailable"
      : value.toLocaleString("en-GB", {
          style: "currency",
          currency: position.currency,
          maximumFractionDigits: 2,
          signDisplay: "always",
        });
  const percent = (value: number | null) =>
    value === null
      ? "Unavailable"
      : value.toLocaleString("en-GB", {
          style: "percent",
          maximumFractionDigits: 1,
          signDisplay: "always",
        });
  const available =
    position.returnStatus === "available" || position.returnStatus === "broker-average";
  return (
    <section
      aria-labelledby="position-title"
      className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">
            {position.status === "closed" ? "Closed position" : "Open position"}
          </p>
          <h3 id="position-title" className="mt-1 font-display text-3xl font-semibold">
            {position.description ?? position.symbol}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {position.symbol} · amounts in {position.currency}
          </p>
        </div>
        <span
          className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${position.status === "closed" ? "bg-secondary text-muted-foreground" : "bg-positive/10 text-positive"}`}
        >
          {position.status === "closed" ? "Closed" : "Open"}
        </span>
      </div>
      <dl
        className={`mt-6 grid gap-3 ${position.status === "closed" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
      >
        {position.status === "open" && (
          <div className="rounded-[14px] bg-secondary/40 p-4">
            <dt className="text-xs font-semibold text-muted-foreground">Current value</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {money(position.currentValue).replace(/^\+/, "")}
            </dd>
          </div>
        )}
        {position.status === "open" && (
          <div className="rounded-[14px] bg-secondary/40 p-4">
            <dt className="text-xs font-semibold text-muted-foreground">Daily change</dt>
            <dd
              className={`mt-1 text-xl font-semibold tabular-nums ${position.dailyChange === null ? "text-muted-foreground" : position.dailyChange >= 0 ? "text-positive" : "text-negative"}`}
            >
              {money(position.dailyChange)}
              {position.dailyChangePercentage === null
                ? ""
                : ` (${percent(position.dailyChangePercentage)})`}
            </dd>
          </div>
        )}
        <div className="rounded-[14px] bg-secondary/40 p-4">
          <dt className="text-xs font-semibold text-muted-foreground">Total return</dt>
          <dd
            className={`mt-1 text-xl font-semibold tabular-nums ${!available || position.returns.totalReturn === null ? "text-muted-foreground" : position.returns.totalReturn >= 0 ? "text-positive" : "text-negative"}`}
          >
            {available
              ? `${money(position.returns.totalReturn)}${position.returns.totalReturnPercentage === null ? "" : ` (${percent(position.returns.totalReturnPercentage)})`}`
              : "Unavailable"}
          </dd>
        </div>
        {position.status === "closed" && (
          <div className="rounded-[14px] bg-secondary/40 p-4">
            <dt className="text-xs font-semibold text-muted-foreground">Final status</dt>
            <dd className="mt-1 text-xl font-semibold">0 shares · closed</dd>
          </div>
        )}
      </dl>
      {!available && (
        <p
          role="status"
          className="mt-4 rounded-[14px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
        >
          {position.returnStatus === "missing-fx"
            ? "FX rate missing. Return cannot be calculated."
            : "Import earlier transactions or connect your other brokers to calculate return."}
        </p>
      )}
      {position.returnStatus === "broker-average" && (
        <p
          role="status"
          className="mt-4 rounded-[14px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
        >
          Cost is based on your broker's average purchase price, because not every purchase is in
          the order history. Realised profit and annual return therefore cannot be calculated.
        </p>
      )}
      <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Quantity</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {position.quantity.toLocaleString("en-GB")}
          </dd>
          <button
            type="button"
            aria-expanded={quantityOpen}
            aria-controls="quantity-history"
            onClick={() => setQuantityOpen((open) => !open)}
            className="pressable mt-1 rounded-sm text-xs font-semibold text-primary underline-offset-2 hover:underline"
          >
            {quantityOpen ? "Hide history" : "Show quantity history"}
          </button>
        </div>
        {position.status === "open" && (
          <>
            <div>
              <dt className="text-muted-foreground">Average cost</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {money(position.averageCost).replace(/^\+/, "")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Current price</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {money(position.currentPrice).replace(/^\+/, "")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Unrealised</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {money(position.returns.unrealizedGain)}
                {position.returns.remainingCostBasis && position.returns.unrealizedGain !== null
                  ? ` (${percent(position.returns.unrealizedGain / position.returns.remainingCostBasis)})`
                  : ""}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-muted-foreground">Realised</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {money(position.returns.realizedGain)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dividends received</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {money(position.returns.dividendsReceived)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">First purchase</dt>
          <dd className="mt-1 font-semibold">
            {position.firstBuyDate ? detailDate(position.firstBuyDate) : "Unavailable"}
          </dd>
        </div>
      </dl>
      {position.firstBuyDate && (
        <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
          Since first purchase:{" "}
          <strong
            className={
              position.returns.sinceFirstBuyPercentage === null
                ? "text-muted-foreground"
                : position.returns.sinceFirstBuyPercentage >= 0
                  ? "text-positive"
                  : "text-negative"
            }
          >
            {percent(position.returns.sinceFirstBuyPercentage)}
          </strong>{" "}
          since {position.firstBuyDate}
        </p>
      )}
      {quantityOpen && (
        <ol id="quantity-history" className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          {position.quantityHistory.length === 0 ? (
            <li className="text-muted-foreground">No full quantity history available.</li>
          ) : (
            position.quantityHistory.map((change) => (
              <li
                key={`${change.date}-${change.sourceOrder}`}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  {detailDate(change.date)} · {change.reason === "buy" ? "Buy" : "Sell"}
                </span>
                <span className="font-semibold tabular-nums">
                  {change.delta > 0 ? "+" : ""}
                  {change.delta.toLocaleString("en-GB")} → {change.quantity.toLocaleString("en-GB")}
                </span>
              </li>
            ))
          )}
        </ol>
      )}
    </section>
  );
}

function PositionActivityTable({ position }: { position: InvestingPositionDetail }) {
  const dates = [...new Set(position.activity.map((item) => item.date))];
  const number = (value: number | null | undefined) =>
    value == null ? "—" : value.toLocaleString("en-GB", { maximumFractionDigits: 4 });
  return (
    <section
      aria-labelledby="activity-title"
      className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6"
    >
      <h3 id="activity-title" className="font-display text-2xl font-semibold">
        Activity
      </h3>
      {dates.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No transaction or dividend history available.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div role="table" aria-label="Position activity" className="min-w-[760px] text-sm">
            <div
              role="row"
              className="grid grid-cols-[150px_100px_90px_120px_120px_110px_70px] border-b border-border pb-2 text-xs font-semibold text-muted-foreground"
            >
              <span>Date</span>
              <span>Type</span>
              <span className="text-right">Quantity</span>
              <span className="text-right">Price</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Commission</span>
              <span className="text-right">Currency</span>
            </div>
            {dates.map((date) => (
              <div
                key={date}
                id={`activity-${date}`}
                tabIndex={-1}
                className="scroll-mt-4 border-b border-border/70 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {position.activity
                  .filter((item) => item.date === date)
                  .map((item) => (
                    <div
                      role="row"
                      key={`${item.kind}-${item.sourceOrder}`}
                      className="grid grid-cols-[150px_100px_90px_120px_120px_110px_70px] py-1.5 tabular-nums"
                    >
                      <span>{detailDate(date)}</span>
                      <span className="font-semibold">
                        {item.kind === "buy" ? "Buy" : item.kind === "sell" ? "Sell" : "Dividend"}
                      </span>
                      <span className="text-right">{number(item.quantity)}</span>
                      <span className="text-right">{number(item.executionPrice)}</span>
                      <span className="text-right">{number(item.amount)}</span>
                      <span className="text-right">{number(item.commission)}</span>
                      <span className="text-right">{item.currency}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CompletePositionDetail({ position }: { position: InvestingPositionDetail }) {
  const activate = (date: string) => {
    const row = document.getElementById(`activity-${date}`);
    row?.scrollIntoView?.({ block: "nearest" });
    row?.focus();
  };
  return (
    <>
      <PositionDetailSummary position={position} />
      <PositionPriceChart
        symbol={position.symbol}
        currency={position.priceCurrency}
        points={position.points}
        onMarkerActivate={activate}
      />
      <PositionActivityTable position={position} />
    </>
  );
}

function PositionDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const [searchParams] = useSearchParams();
  const positionSymbol = symbol?.trim().toUpperCase() ?? "";
  const state = useDashboard(positionSymbol || undefined);
  const query = searchParams.toString();
  return (
    <div className="space-y-5">
      <Link
        to={{ pathname: "/positions", search: query ? `?${query}` : "" }}
        className="text-sm font-semibold text-primary hover:underline"
      >
        ← Back to positions
      </Link>
      {!positionSymbol ? (
        <EmptyState
          title="No position selected"
          description="Choose a position to view price history."
        />
      ) : state.status === "loading" ? (
        <DashboardLoading />
      ) : state.status === "error" ? (
        <DashboardError message={state.message} />
      ) : state.data.position?.symbol.toUpperCase() === positionSymbol ? (
        <>
          <DashboardProblems problems={state.data.problems} />
          <CompletePositionDetail position={state.data.position} />
        </>
      ) : (
        <EmptyState
          title="Position not found"
          description="This position is not in the local dashboard model."
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<AuthForm />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/positions/:symbol" element={<PositionDetail />} />
          <Route path="/agents/:agentId" element={<AgentView />} />
          <Route path="/brokers/connect" element={<BrokerConnect />} />
        </Route>
      </Route>
    </Routes>
  );
}
