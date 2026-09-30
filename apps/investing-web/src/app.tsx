import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
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
  type RiskRange,
} from "@lavega/core";
import { EmptyState } from "./components/EmptyState";
import { AgentMessageText } from "./components/AgentMessageText";
import { AllocationDonut } from "./components/AllocationDonut";
import {
  AuthForm,
  CheckEmailPage,
  EmailConfirmedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "./components/AuthForm";
import { Profile } from "./components/Profile";
import { NetWorthPage } from "./components/NetWorthPage.js";
import { AgentsList } from "./components/AgentsList.js";
import { StockResearch } from "./components/StockResearch.js";
import { RequireAuth } from "./components/RequireAuth";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { PositionPriceChart } from "./components/PositionPriceChart";
import { PositionSectorControl } from "./components/PositionSectorControl.js";
import { PortfolioBenchmarkChart } from "./components/PortfolioBenchmarkChart";
import { PortfolioSummaryCard } from "./components/PortfolioSummaryCard";
import { SectorAllocationCard } from "./components/SectorAllocationCard.js";
import { longDate } from "./lib/dates.js";
import { useDashboard } from "./lib/dashboardResource";
import { HOME_MODULE, MODULES, investingModulePath } from "./lib/investingRegistry.js";
import { useInvestingLayout } from "./lib/layoutResource.js";
import { usePortfolioSummary } from "./lib/summaryResource.js";
import {
  chatErrorMessage,
  portfolioChat,
  runPortfolioAgent,
  useAgentCatalog,
  useAgentRequests,
  type PortfolioAgentDefinition,
  type PortfolioAgentInsight,
} from "./lib/portfolioAgents";
import { priceOutcomeProblems } from "./lib/priceSync";
import {
  continuePriceSync,
  filterVisibleSyncProblems,
  startBrokerSync,
  useSyncSession,
} from "./lib/syncSession";
import { PERSONAL_URL } from "./lib/personal";
import { brokerLabel, historyGate } from "./lib/historyGate";

/* `service` only comes back from the investing server itself. Mounted on
 * lavega.dev the personal server answers /health, and it names no service. */
type Health = { ok: boolean; service?: string };
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

function DashboardRefreshError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-card border border-warning/30 bg-warning/10 p-4 text-sm">
      <p className="font-semibold">Refresh failed</p>
      <p className="mt-1 text-muted-foreground">{message} Cached data remains visible.</p>
    </div>
  );
}

function DashboardProblems({ problems }: { problems: string[] }) {
  const visibleProblems = filterVisibleSyncProblems(problems);
  if (visibleProblems.length === 0) return null;
  return (
    <div role="alert" className="rounded-card border border-negative/30 bg-negative/5 p-4 text-sm">
      <p className="font-semibold">Reading problems</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {visibleProblems.map((problem, index) => (
          <li key={`${problem}-${index}`}>
            {problem}{" "}
            {/credentials cannot be read/i.test(problem) && (
              <Link
                to="/brokers/connect"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Reconnect broker
              </Link>
            )}
          </li>
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
                className="rounded-xs text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              className="group grid grid-cols-[minmax(220px,1.35fr)_minmax(130px,.8fr)_minmax(130px,.7fr)_minmax(220px,1fr)] items-center px-5 py-4 outline-hidden hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                      <span
                        className="ml-2 text-xs font-medium text-warning"
                        title="Price is estimated from latest available market data"
                      >
                        · <span aria-hidden="true">est.</span>
                        <span className="sr-only">Estimated price</span>
                      </span>
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
                {position.returns.status === "broker-unrealized" &&
                position.returns.unrealizedGain !== null ? (
                  <>
                    <span
                      className={
                        position.returns.unrealizedGain >= 0
                          ? "font-semibold text-positive"
                          : "font-semibold text-negative"
                      }
                    >
                      {money(position.returns.unrealizedGain)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      unrealized return on broker cost
                    </span>
                  </>
                ) : position.returns.status === "available" &&
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
                    <span className="block text-xs text-muted-foreground">total return</span>
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
      className="rounded-card border border-border bg-card p-5 shadow-md"
      data-dashboard-section="kpis"
    >
      <p className="text-xs font-semibold uppercase tracking-eyebrow text-muted-foreground">
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
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Estimated prices ({latest.forwardFilled.length})
          </summary>
          <p className="mt-1 break-words">
            <span className="sr-only">Estimated price: </span>
            {latest.forwardFilled.join(", ")}
          </p>
        </details>
      )}
      {latest && (latest.unpriced.length > 0 || latest.cashUnknown.length > 0) && (
        <div
          role="status"
          className="mt-4 rounded-tile border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5"
        >
          <p className="font-semibold">Value partly unknown</p>
          {latest.unpriced.length > 0 && <p>No usable price: {latest.unpriced.join(", ")}</p>}
          {latest.cashUnknown.length > 0 && (
            <p>Cash history unknown: {latest.cashUnknown.join(", ")}</p>
          )}
          {Object.entries(latest.cashShortfall ?? {}).map(([wallet, amount]) => (
            <p key={wallet}>
              {wallet} is missing about {money(Math.abs(amount))} of{" "}
              {amount < 0 ? "funding" : "spending"} before its balances add up.
            </p>
          ))}
        </div>
      )}
      {latest && (latest.cashEstimated?.length ?? 0) > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Estimated cash: {latest.cashEstimated?.join(", ")}. Walked from movements your broker
          reported without proving the history complete.
        </p>
      )}
    </section>
  );
}

function AgentCatalogProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4">
      <p role="alert" className="text-sm text-negative">
        {message}
      </p>
      <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function PersonaRadioGroup({
  agents,
  selectedId,
  onSelect,
  onOpen,
}: {
  agents: PortfolioAgentDefinition[];
  selectedId: string;
  onSelect: (agentId: string) => void;
  onOpen: (agentId: string) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function moveSelection(from: number, step: number) {
    const next = (from + step + agents.length) % agents.length;
    onSelect(agents[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Choose agent" className="mt-4 grid grid-cols-2 gap-2">
      {agents.map((agent, index) => {
        const checked = agent.id === selectedId;
        return (
          <button
            key={agent.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              onSelect(agent.id);
              onOpen(agent.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(index, -1);
              }
            }}
            className={`pressable rounded-tile border px-3 py-2 text-left text-xs font-semibold transition-colors ${checked ? "border-primary bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
          >
            {agent.displayName}
          </button>
        );
      })}
    </div>
  );
}

function PortfolioAgentCard() {
  const { catalog, reload } = useAgentCatalog();
  const { requestFor, start, settle } = useAgentRequests();
  const [selectedId, setSelectedId] = useState("");
  const [insights, setInsights] = useState<Record<string, PortfolioAgentInsight>>({});
  const navigate = useNavigate();

  const agents = catalog.status === "ready" ? catalog.agents : [];
  /* Selection is derived, so a catalog reload that drops the chosen persona
   * falls back to the first one instead of leaving Analyse pointed at an id
   * the reader can no longer see. */
  const active = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const request = requestFor(active?.id ?? "");
  const insight = active ? insights[active.id] : undefined;

  async function run() {
    if (!active) return;
    const agentId = active.id;
    start(agentId);
    try {
      const result = await runPortfolioAgent(agentId);
      setInsights((current) => ({ ...current, [agentId]: result }));
      settle(agentId, null);
    } catch (error) {
      settle(agentId, error instanceof Error ? error.message : "Agent run failed.");
    }
  }

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
      className="rounded-card border border-border bg-card p-5 shadow-md"
      data-dashboard-section="agent"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-primary">Agent</p>
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
      {catalog.status === "loading" && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading agents…
        </p>
      )}
      {catalog.status === "error" && (
        <AgentCatalogProblem message={catalog.message} onRetry={reload} />
      )}
      {catalog.status === "empty" && (
        <AgentCatalogProblem message="No portfolio agents available." onRetry={reload} />
      )}
      {active && (
        <>
          <PersonaRadioGroup
            agents={agents}
            selectedId={active.id}
            onSelect={setSelectedId}
            onOpen={openAgentWindow}
          />
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{active.investingStyle}</p>
          <Link
            to={`/agents/${active.id}`}
            className="pressable mt-4 flex items-center justify-between rounded-tile border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <span>Open conversation with {active.displayName}</span>
            <span aria-hidden="true">→</span>
          </Link>
          <Button type="button" className="mt-4 w-full" onClick={run} disabled={request.pending}>
            {request.pending ? "Agent reading…" : "Analyse portfolio"}
          </Button>
          {request.error && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {request.error}
            </p>
          )}
          {insight && (
            <article className="mt-4 rounded-tile border border-border bg-secondary/30 p-4">
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

function AgentView() {
  const { agentId } = useParams();
  const dashboard = useDashboard();
  const { catalog, reload } = useAgentCatalog();
  const [input, setInput] = useState("");

  const agents = catalog.status === "ready" ? catalog.agents : [];
  const agent = agents.find((item) => item.id === agentId);
  const { messages, sendMessage, status, error } = useChat({
    chat: portfolioChat(agent?.id ?? ""),
  });
  const sending = status === "submitted" || status === "streaming";
  /* A reply that is still in tool steps has no text yet; the status line
   * stands in for it rather than an empty bubble. */
  const bubbles = messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    }))
    .filter((message) => message.text.length > 0);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!agent || !question || sending) return;
    setInput("");
    void sendMessage({ text: question });
  }

  if (dashboard.status === "loading" || catalog.status === "loading") return <DashboardLoading />;
  if (dashboard.status === "error") return <DashboardError message={dashboard.message} />;
  if (catalog.status === "error" || catalog.status === "empty") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agents unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentCatalogProblem
            message={
              catalog.status === "error" ? catalog.message : "No portfolio agents available."
            }
            onRetry={reload}
          />
        </CardContent>
      </Card>
    );
  }
  /* Only a resolved catalog can say an id is unknown. */
  if (!agent) {
    return <EmptyState title="Agent not found" description="Choose an agent from the overview." />;
  }

  const contextPositions = [...dashboard.data.positions].sort(
    (left, right) => (right.marketValue ?? -Infinity) - (left.marketValue ?? -Infinity),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="flex min-h-[620px] flex-col rounded-card border border-border bg-card shadow-md">
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            ← Back to overview
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-eyebrow text-primary">
            Portfolio agent
          </p>
          <h2 className="mt-1 font-display text-4xl font-semibold">{agent.displayName}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.investingStyle}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-6" aria-live="polite">
          <div className="flex justify-start">
            <p className="max-w-[86%] whitespace-pre-line rounded-lg bg-secondary px-4 py-3 text-sm leading-6 text-foreground">
              I am {agent.displayName}. I look at your positions through this lens. Ask a question
              about a holding, concentration, return or risk.
            </p>
          </div>
          {bubbles.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "user" ? (
                <p className="max-w-[86%] whitespace-pre-line rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                  {message.text}
                </p>
              ) : (
                <div className="max-w-[86%] rounded-lg bg-secondary px-4 py-3 text-sm leading-6 text-foreground">
                  <AgentMessageText text={message.text} />
                </div>
              )}
            </div>
          ))}
          {sending && bubbles.at(-1)?.role !== "assistant" && (
            <p role="status" className="text-sm text-muted-foreground">
              {agent.displayName} is reading positions…
            </p>
          )}
        </div>
        <form onSubmit={submit} className="border-t border-border p-4 sm:p-5">
          <label htmlFor="agent-message" className="sr-only">
            Ask {agent.displayName}
          </label>
          <div className="flex gap-2 rounded-2xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            <input
              id="agent-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your positions…"
              className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-hidden"
              disabled={sending}
            />
            <Button type="submit" size="sm" disabled={sending || input.trim().length === 0}>
              Send
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {chatErrorMessage(error)}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Educational analysis. No personal investment advice.
          </p>
        </form>
      </section>
      <aside
        aria-label="Positions in conversation"
        className="flex min-h-0 flex-col rounded-card border border-border bg-card p-5 shadow-md lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)]"
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-eyebrow text-primary">Context</p>
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
                className="pressable flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2.5 hover:bg-secondary"
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

function AppOpenSync() {
  const [problems, setProblems] = useState<string[]>([]);
  const [consent, setConsent] = useState<"checking" | "required" | "accepted">("checking");
  const [consentBusy, setConsentBusy] = useState(false);
  const runSync = useCallback(async (current: () => boolean) => {
    try {
      const brokerResult = await startBrokerSync();
      if (current()) setProblems(filterVisibleSyncProblems(brokerResult?.problems ?? []));
      const priceProblems = priceOutcomeProblems(await continuePriceSync());
      if (current() && priceProblems.length > 0)
        setProblems((existing) => [...existing, ...priceProblems]);
    } catch {
      if (current()) setProblems(["Broker sync failed."]);
    }
  }, []);
  useEffect(() => {
    let current = true;
    const verificationMode = new URLSearchParams(window.location.search).has("verify");
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
        if (verificationMode) return;
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
      {health.service ?? "server"}: {health.ok ? "available" : "unavailable"}
    </span>
  );
}

function ModuleRoute({
  moduleId,
  children,
}: {
  moduleId: Exclude<ReturnType<typeof useInvestingLayout>["modules"][number], typeof HOME_MODULE>;
  children: React.ReactNode;
}) {
  const layout = useInvestingLayout();
  if (layout.status === "loading") return null;
  if (!layout.modules.includes(moduleId)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useInvestingLayout();
  const detail = location.pathname.startsWith("/positions/");
  const positionsList = location.pathname === "/positions";
  const agentView = location.pathname.startsWith("/agents/");
  const isStockResearch = location.pathname === "/agents/research";
  const isProfile = location.pathname === "/profile";
  const isOverview = location.pathname === "/";
  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-frame bg-background shadow-xl sm:min-h-[calc(100vh-3rem)]">
        <header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/" className="pressable group">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              LaVega
            </span>
            <h1 className="font-display text-3xl font-semibold leading-none">Investing</h1>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 rounded-pill bg-secondary p-1"
          >
            {(layout.status === "loading" ? [HOME_MODULE] : layout.modules).map((id) => (
              <NavLink
                key={id}
                to={investingModulePath(id)}
                end={id === HOME_MODULE}
                className={({ isActive }) =>
                  `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`
                }
              >
                {MODULES.find((m) => m.id === id)?.label ?? id}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* DE WEG TERUG. Spiegelt de investing-knop in apps/web's NavBar: een
                gewone cross-document link, want de persoonlijke app is een eigen
                deploy en geen route hierbinnen. Zonder dit was de oversteek
                eenrichtingsverkeer — je kwam hier vanuit de kluis en moest daarna
                terug via de browserknop of een getypte URL. */}
            {PERSONAL_URL && (
              <a
                href={PERSONAL_URL}
                className="flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
                <span>Personal</span>
              </a>
            )}
            {isOverview && (
              <button
                type="button"
                onClick={() => navigate("/profile#widgets")}
                className="pressable rounded-pill border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary"
              >
                <span aria-hidden="true">+</span> Add widget
              </button>
            )}
            <Link
              to="/profile"
              aria-label="Profile"
              className={`pressable flex size-9 items-center justify-center rounded-pill border border-border transition-colors hover:bg-secondary ${isProfile ? "bg-secondary" : ""}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8.5" r="3.5" />
                <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
              </svg>
            </Link>
          </div>
        </header>
        <main className="px-5 py-8 sm:px-8 sm:py-12">
          {!isProfile && !isStockResearch && (
            <div className="mb-8 flex items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-sm font-medium text-primary">
                  {detail
                    ? "Position detail"
                    : agentView
                      ? "Agent conversation"
                      : positionsList
                        ? "Positions"
                        : location.pathname === "/net-worth"
                          ? "Net worth"
                          : location.pathname === "/agents"
                            ? "Agents"
                            : "Your financial overview"}
                </p>
                <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                  {detail
                    ? "Position"
                    : agentView
                      ? "Agent"
                      : positionsList
                        ? "Positions"
                        : location.pathname === "/net-worth"
                          ? "Net worth"
                          : location.pathname === "/agents"
                            ? "Agents"
                            : "Overview"}
                </h2>
              </div>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="flex items-center justify-between border-t border-border px-5 py-5 text-xs text-muted-foreground sm:px-8">
          <span role="status">
            <HealthStatus />
          </span>
        </footer>
      </div>
    </div>
  );
}

/* HET SCHERM TERWIJL DE EERSTE GESCHIEDENIS NOG BINNENKOMT.
 *
 * Niet de cijfers met een spinner erbij, maar in plaats van de cijfers. Zie
 * `historyGate`: met de helft van de transacties is het rendement niet
 * onvolledig maar fout, en het zou er met twee decimalen bij staan alsof dat
 * niet zo is. Wat er wel staat is wat er tot nu toe is binnengehaald, zodat
 * zichtbaar blijft dat er iets gebeurt. */
function HistoryLoading({ brokers }: { brokers: string[] }) {
  const { broker } = useSyncSession();
  const names = brokers.map(brokerLabel).join(" and ");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Still loading your history</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
          <p>
            {names} {brokers.length > 1 ? "are" : "is"} still sending transactions. LaVega fetches
            them a page at a time and picks up where it left off, so this survives a timeout — it
            may take a few runs on a large account.
          </p>
          <p>
            Your figures stay hidden until it finishes. Returns and cost basis are worked out from
            the full transaction history, so a half-loaded one would not be a smaller answer — it
            would be a wrong one.
          </p>
          {broker && (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
              <dt>pages</dt>
              <dd className="m-0">{broker.pages}</dd>
              <dt>orders</dt>
              <dd className="m-0">{broker.ordersRead}</dd>
              <dt>positions</dt>
              <dd className="m-0">{broker.positionsRead}</dd>
            </dl>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="rounded-card border border-dashed border-border bg-transparent p-10 text-center">
      <p className="text-sm text-muted-foreground">
        Every Overview card is switched off. Add one to see your portfolio here.
      </p>
      <Button type="button" className="mt-4" onClick={() => navigate("/profile#widgets")}>
        <span aria-hidden="true">+</span> Add widget
      </Button>
    </div>
  );
}

function Overview() {
  const state = useDashboard();
  const { broker, price, priceProblem, connection, vault } = useSyncSession();
  const layout = useInvestingLayout();
  const gate = historyGate(broker?.history);
  /* Until the layout loads, the registry defaults would flash widgets the
   * reader switched off and start their reads, so none render yet. */
  const layoutReady = layout.status === "ready";
  const widgets = new Set(layoutReady ? layout.widgets : []);
  const showRisk = widgets.has("risk");
  const showSectors = widgets.has("sectors");
  /* Overview owns the range/benchmark selection and the one summary read
   * shared between PortfolioSummaryCard (risk) and SectorAllocationCard
   * (sectors): /api/investing/summary is the slowest call on the page, so
   * neither widget may mount a second copy of this fetch. */
  const dashboardReady = state.status === "ready" && gate.kind === "ready";
  const dataVersion = dashboardReady ? state.data.dataVersion : 0;
  const benchmarksRevision = dashboardReady
    ? state.data.benchmarks.map((item) => item.symbol).join(",")
    : "";
  const [range, setRange] = useState<RiskRange>("1Y");
  const [benchmarkSelection, setBenchmarkSelection] = useState({
    value: "",
    revision: benchmarksRevision,
  });
  const benchmark =
    benchmarkSelection.revision === benchmarksRevision ? benchmarkSelection.value : "";
  const { state: summaryState, refresh: refreshSummary } = usePortfolioSummary(
    range,
    benchmark,
    `${dataVersion}:${benchmarksRevision}`,
    dashboardReady && (showRisk || showSectors),
  );
  return (
    <div className="space-y-5">
      <AppOpenSync />
      {state.status === "loading" ? (
        <DashboardLoading />
      ) : state.status === "error" ? (
        <DashboardError message={state.message} />
      ) : gate.kind === "first-sync" ? (
        <HistoryLoading brokers={gate.brokers} />
      ) : (
        <>
          {state.refreshError && <DashboardRefreshError message={state.refreshError} />}
          <DashboardProblems problems={state.data.problems} />
          {(connection !== "online" ||
            broker?.status === "problem" ||
            price?.status === "problem" ||
            priceProblem ||
            vault === "locked") && (
            <div role="alert" className="rounded-card border border-warning/30 bg-warning/10 p-4 text-sm">
              <p>
                Status needs attention.{" "}
                <Link to="/profile#brokers" className="font-semibold underline">
                  Review it in Profile
                </Link>
              </p>
            </div>
          )}
          {!layoutReady ? null : widgets.size === 0 ? (
            <OverviewEmptyState />
          ) : (
            <>
              <div
                className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]"
                data-dashboard-layout="overview"
              >
                <div className="min-w-0 space-y-5">
                  {widgets.has("performance") && (
                    <div data-dashboard-section="performance">
                      <PortfolioBenchmarkChart
                        data={state.data.portfolio}
                        benchmarks={state.data.benchmarks}
                        externalCashFlows={state.data.externalCashFlows}
                        currency={state.data.presentationCurrency}
                      />
                    </div>
                  )}
                  {widgets.has("allocation") && (
                    <div data-dashboard-section="allocation">
                      <AllocationDonut
                        instrument={state.data.allocation.instrument}
                        entity={state.data.allocation.entity}
                        currency={state.data.presentationCurrency}
                      />
                    </div>
                  )}
                </div>
                <aside aria-label="Portfolio overview" className="space-y-5">
                  {widgets.has("kpis") && <PortfolioKpis data={state.data} />}
                  {showRisk && (
                    <PortfolioSummaryCard
                      /* De kaart is presentational; of er nog iets binnenkomt weet
                         dit scherm, dat de sync-sessie toch al leest. */
                      stillLoading={
                        gate.updating.length > 0 ||
                        broker?.status === "running" ||
                        broker?.status === "waiting" ||
                        price?.status === "running" ||
                        price?.status === "paused" ||
                        (price?.remainingSymbols?.length ?? 0) > 0
                      }
                      currency={state.data.presentationCurrency}
                      state={summaryState}
                      refresh={refreshSummary}
                      range={range}
                      onRangeChange={setRange}
                      benchmark={benchmark}
                      onBenchmarkChange={(value) =>
                        setBenchmarkSelection({ value, revision: benchmarksRevision })
                      }
                    />
                  )}
                </aside>
              </div>
              {showSectors && (
                <SectorAllocationCard
                  currency={state.data.presentationCurrency}
                  state={summaryState}
                  refresh={refreshSummary}
                />
              )}
              {widgets.has("agent") && <PortfolioAgentCard />}
            </>
          )}
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
      {state.refreshError && <DashboardRefreshError message={state.refreshError} />}
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
  const available = position.returnStatus === "available";
  const brokerUnrealized = position.returnStatus === "broker-unrealized";
  return (
    <section
      aria-labelledby="position-title"
      className="rounded-card border border-border bg-card p-5 shadow-md sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-primary">
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
          <div className="rounded-tile bg-secondary/40 p-4">
            <dt className="text-xs font-semibold text-muted-foreground">Current value</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {position.currentValue === null ? (
                <span className="text-base text-muted-foreground">
                  {position.priceStatus === "missing-fx" ? "FX rate missing" : "Value unknown"}
                </span>
              ) : (
                money(position.currentValue).replace(/^\+/, "")
              )}
            </dd>
            {position.priceStatus === "forward-filled" && position.quoteDate && (
              <p className="mt-1 text-xs text-warning">Estimated price of {position.quoteDate}</p>
            )}
          </div>
        )}
        {position.status === "open" && (
          <div className="rounded-tile bg-secondary/40 p-4">
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
        <div className="rounded-tile bg-secondary/40 p-4">
          <dt className="text-xs font-semibold text-muted-foreground">
            {brokerUnrealized ? "Unrealized return" : "Total return"}
          </dt>
          <dd
            className={`mt-1 text-xl font-semibold tabular-nums ${brokerUnrealized && position.returns.unrealizedGain !== null ? (position.returns.unrealizedGain >= 0 ? "text-positive" : "text-negative") : !available || position.returns.totalReturn === null ? "text-muted-foreground" : position.returns.totalReturn >= 0 ? "text-positive" : "text-negative"}`}
          >
            {brokerUnrealized
              ? money(position.returns.unrealizedGain)
              : available
                ? `${money(position.returns.totalReturn)}${position.returns.totalReturnPercentage === null ? "" : ` (${percent(position.returns.totalReturnPercentage)})`}`
                : "Unavailable"}
          </dd>
        </div>
        {position.status === "closed" && (
          <div className="rounded-tile bg-secondary/40 p-4">
            <dt className="text-xs font-semibold text-muted-foreground">Final status</dt>
            <dd className="mt-1 text-xl font-semibold">0 shares · closed</dd>
          </div>
        )}
      </dl>
      {!available && !brokerUnrealized && (
        <p
          role="status"
          className="mt-4 rounded-tile border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
        >
          {position.returnStatus === "missing-fx"
            ? "FX rate missing. Return cannot be calculated."
            : "Import earlier transactions or connect your other brokers to calculate return."}
        </p>
      )}
      {brokerUnrealized && (
        <p
          role="status"
          className="mt-4 rounded-tile border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
        >
          Unrealized return uses your broker's current cost basis. Lifetime return remains
          unavailable because trade history is incomplete.
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
            className="pressable mt-1 rounded-xs text-xs font-semibold text-primary underline-offset-2 hover:underline"
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
      <PositionSectorControl symbol={position.symbol} />
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
      className="rounded-card border border-border bg-card p-5 shadow-md sm:p-6"
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
                className="scroll-mt-4 border-b border-border/70 py-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
          {state.refreshError && <DashboardRefreshError message={state.refreshError} />}
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
      <Route path="/sign-up" element={<AuthForm mode="sign-up" />} />
      <Route path="/sign-in" element={<AuthForm mode="sign-in" />} />
      <Route path="/check-email" element={<CheckEmailPage />} />
      <Route path="/email-confirmed" element={<EmailConfirmedPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route
            path="/positions"
            element={
              <ModuleRoute moduleId="positions">
                <Positions />
              </ModuleRoute>
            }
          />
          <Route
            path="/positions/:symbol"
            element={
              <ModuleRoute moduleId="positions">
                <PositionDetail />
              </ModuleRoute>
            }
          />
          <Route
            path="/net-worth"
            element={
              <ModuleRoute moduleId="net-worth">
                <NetWorthPage />
              </ModuleRoute>
            }
          />
          <Route
            path="/agents"
            element={
              <ModuleRoute moduleId="agents">
                <AgentsList />
              </ModuleRoute>
            }
          />
          <Route
            path="/agents/research"
            element={
              <ModuleRoute moduleId="agents">
                <StockResearch />
              </ModuleRoute>
            }
          />
          <Route
            path="/agents/:agentId"
            element={
              <ModuleRoute moduleId="agents">
                <AgentView />
              </ModuleRoute>
            }
          />
          <Route path="/profile" element={<Profile />} />
          <Route path="/brokers/connect" element={<Navigate to="/profile#brokers" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
