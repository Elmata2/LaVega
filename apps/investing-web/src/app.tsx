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
  findMentions,
  type InvestingDashboardData,
  type InvestingPositionDetail,
  type RiskRange,
} from "@lavega/core";
import { EmptyState } from "./components/EmptyState";
import { AgentMessageText } from "./components/AgentMessageText";
import { MentionInput, MentionText } from "./components/MentionInput.js";
import { AllocationDonut } from "./components/AllocationDonut";
import {
  AuthForm,
  CheckEmailPage,
  EmailConfirmedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "./components/AuthForm";
import { Profile } from "./components/Profile";
import { ThemeToggle } from "./components/ThemeToggle";
import { NetWorthPage } from "./components/NetWorthPage.js";
import { AgentsList } from "./components/AgentsList.js";
import { StockResearch } from "./components/StockResearch.js";
import { AgentThreads } from "./components/AgentThreads.js";
import { fetchThreadMessages } from "./lib/agentMemory.js";
import { RequireAuth } from "./components/RequireAuth";
import { Button } from "./components/ui/button";
import { AgentCatalogProblem, PortfolioAgentCard } from "./components/PortfolioAgentCard.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { PositionPriceChart } from "./components/PositionPriceChart";
import { PositionSectorControl } from "./components/PositionSectorControl.js";
import { PortfolioBenchmarkChart } from "./components/PortfolioBenchmarkChart";
import { PortfolioSummaryCard, type SummaryState } from "./components/PortfolioSummaryCard";
import { SectorAllocationCard } from "./components/SectorAllocationCard.js";
import { PortfolioFigureNotes, PortfolioKpiRow } from "./components/PortfolioKpiRow.js";
import { OverviewStatus, mergeStatusItems, type StatusItem } from "./components/OverviewStatus.js";
import { formatMoney, formatSignedPercent, portfolioFigures } from "./lib/portfolioFigures.js";
import { longDate, shortDate } from "./lib/dates.js";
import { readDashboard, useDashboard } from "./lib/dashboardResource";
import { HOME_MODULE, MODULES, investingModulePath } from "./lib/investingRegistry.js";
import { useInvestingLayout } from "./lib/layoutResource.js";
import { useSectors } from "./lib/sectorResource.js";
import { PortfolioLetterCard } from "./components/PortfolioLetterCard.js";
import { letterToText, useLatestLetter } from "./lib/portfolioLetter.js";
import {
  chatErrorMessage,
  currentThreadId,
  forgetThread,
  portfolioChat,
  selectThread,
  startNewThread,
  useAgentCatalog,
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

/** Every reason the Overview's data may be wrong or stale, as one list for the
 *  single status line. Broker credentials that cannot be read keep their
 *  reconnect action. */
function overviewStatusItems({
  refreshError,
  syncProblems,
  readingProblems,
  needsAttention,
}: {
  refreshError: string | null;
  syncProblems: readonly string[];
  readingProblems: readonly string[];
  needsAttention: boolean;
}): StatusItem[] {
  const items: StatusItem[] = [];
  if (refreshError)
    items.push({
      message: `Refresh failed: ${refreshError} Cached data remains visible.`,
      severity: "warning",
    });
  for (const message of syncProblems) items.push({ message, severity: "problem" });
  for (const message of filterVisibleSyncProblems([...readingProblems]))
    items.push({
      message,
      severity: "problem",
      action: /credentials cannot be read/i.test(message)
        ? { to: "/brokers/connect", label: "Reconnect broker" }
        : undefined,
    });
  if (needsAttention)
    items.push({
      message: "Broker or price status needs attention.",
      severity: "warning",
      action: { to: "/profile#brokers", label: "Review it in Profile" },
    });
  return mergeStatusItems(items);
}

/** The status line for pages that show the dashboard read without the open-time
 *  sync: refresh failure and reading problems, merged into one line. */
function DashboardStatus({
  data,
  refreshError,
}: {
  data: InvestingDashboardData;
  refreshError?: string;
}) {
  return (
    <OverviewStatus
      items={overviewStatusItems({
        refreshError: refreshError ?? null,
        syncProblems: [],
        readingProblems: data.problems,
        needsAttention: false,
      })}
    />
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

/** WS4.2: say why a basis is unknown instead of only "return unavailable".
 *  The code is typed in core (`CostBasisUnknownReason`); copy lives here. */
function basisUnknownCopy(
  basis: InvestingDashboardData["positions"][number]["basis"],
): string | null {
  switch (basis?.reason) {
    case "transfer-in":
      return "Basis unknown: units arrived by transfer, so the purchase price is not known.";
    case "missing-fx":
      return "Basis unknown: an FX rate is missing.";
    case "missing-price":
      return "Basis unknown: a trade has no price.";
    case "missing-fee":
      return "Basis unknown: a trade fee is missing.";
    case "quantity-mismatch":
      return "Basis unknown: the trade history does not match the broker quantity.";
    case "provider-incomplete":
      return "Basis unknown: the broker reports only part of the position.";
    case "no-history":
      return "Basis unknown: there is no trade history for this position.";
    default:
      return null;
  }
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
                className="rounded-chip text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                <span className="block truncate font-semibold text-accent">
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
                        {basisUnknownCopy(position.basis) ??
                          "Import earlier transactions or connect your other brokers to calculate return."}
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
  const figures = portfolioFigures(data);
  const { portfolioValue, dailyChange, dailyChangePercentage, totalReturn, since } = figures;
  const money = (value: number | null, signDisplay: "auto" | "always" = "auto") =>
    value === null ? "Value unknown" : formatMoney(value, data.presentationCurrency, signDisplay);
  const percentage = (value: number | null) =>
    value === null ? "Return unknown" : formatSignedPercent(value);
  return (
    <section
      aria-label="Portfolio KPIs"
      className="rounded-card border border-border bg-card p-5"
      data-dashboard-section="kpis"
    >
      <h3 className="font-display text-2xl">Key figures</h3>
      <dl className="mt-4 space-y-4">
        <div>
          <dt className="text-xs text-muted-foreground">Portfolio value</dt>
          <dd
            className={`mt-1 text-3xl font-semibold tabular-nums ${portfolioValue === null ? "text-muted-foreground" : ""}`}
          >
            {money(portfolioValue)}
          </dd>
          {figures.usingPositionsFallback && (
            <dd className="text-xs text-muted-foreground">
              Priced positions only; cash and history are still missing.
            </dd>
          )}
        </div>
        <div className="border-t border-border pt-4">
          <dt className="text-xs text-muted-foreground">Daily change</dt>
          <dd
            className={`mt-1 text-2xl font-semibold tabular-nums ${dailyChange === null ? "text-muted-foreground" : dailyChange >= 0 ? "text-positive" : "text-negative"}`}
          >
            {money(dailyChange, "always")}
          </dd>
          <dd className="text-xs text-muted-foreground">{percentage(dailyChangePercentage)}</dd>
        </div>
        <div className="border-t border-border pt-4">
          <dt className="text-xs text-muted-foreground">Total return</dt>
          <dd
            className={`mt-1 text-2xl font-semibold tabular-nums ${totalReturn === null ? "text-muted-foreground" : totalReturn >= 0 ? "text-positive" : "text-negative"}`}
          >
            {percentage(totalReturn)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {since
              ? `TWR since ${shortDate(since)}, after deposits and withdrawals`
              : "TWR after deposits and withdrawals"}
          </dd>
        </div>
      </dl>
      <PortfolioFigureNotes figures={figures} currency={data.presentationCurrency} />
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
  /* From the URL, not the catalog: the chat is created on first render,
   *  before the catalog has loaded, and keeps the agent it was made with. */
  const personaId = agentId ?? "";
  /* The persona's current thread lives in portfolioAgents; this only
   *  re-renders when it changes. */
  const [, setThreadVersion] = useState(0);
  const threadId = currentThreadId(personaId);
  const [openError, setOpenError] = useState<string | null>(null);
  const { messages, sendMessage, status, error } = useChat({
    chat: portfolioChat(personaId, threadId),
  });
  const sending = status === "submitted" || status === "streaming";
  /* Refetch the list when a turn starts (a new thread appears) and when its
   * reply settles (the thread moves to the top). */
  const threadsKey = `${threadId}:${status === "ready" ? messages.length : "busy"}`;

  function showThread(next: string) {
    selectThread(personaId, next);
    setThreadVersion((value) => value + 1);
    setOpenError(null);
  }

  async function openThread(next: string) {
    if (next === threadId) return;
    try {
      portfolioChat(personaId, next, await fetchThreadMessages(next));
      showThread(next);
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : "Conversation could not be opened.");
    }
  }

  function threadDeleted(deleted: string) {
    forgetThread(deleted);
    if (deleted === threadId) showThread(startNewThread(personaId));
  }
  /* A reply that is still in tool steps has no text yet; the status line
   * stands in for it rather than an empty bubble. */
  const bubbles = messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      /* A tagged agent's reply is named; the page's own agent is not. */
      speaker:
        agents.find(
          (item) =>
            item.id === (message.metadata as { agentId?: unknown } | undefined)?.agentId &&
            item.id !== agentId,
        )?.displayName ?? null,
      text: message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    }))
    .filter((message) => message.text.length > 0);

  /* The first tag in the last question answers it, by the same rule the
   * server uses to pick the responder — full, first or last name. */
  const lastQuestion = bubbles.filter((message) => message.role === "user").at(-1)?.text ?? "";
  const responderId = findMentions(lastQuestion, agents)[0]?.id;
  const responder = agents.find((item) => item.id === responderId) ?? agent;

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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="flex min-h-[620px] flex-col rounded-card border border-border bg-card">
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <Link to="/" className="text-sm font-semibold text-accent hover:underline">
            ← Back to overview
          </Link>
          <h2 className="mt-6 font-display text-5xl">{agent.displayName}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.investingStyle}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-6" aria-live="polite">
          <div className="flex justify-start">
            <p className="max-w-[86%] whitespace-pre-line rounded-tile bg-secondary px-4 py-3 text-sm leading-6 text-foreground">
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
                <p className="max-w-[86%] whitespace-pre-line rounded-tile bg-accent px-4 py-3 text-sm leading-6 text-accent-foreground">
                  <MentionText text={message.text} agents={agents} />
                </p>
              ) : (
                <div className="max-w-[86%] rounded-tile bg-secondary px-4 py-3 text-sm leading-6 text-foreground">
                  {message.speaker && (
                    <p className="mb-1 text-xs font-semibold text-accent">{message.speaker}</p>
                  )}
                  <AgentMessageText text={message.text} />
                </div>
              )}
            </div>
          ))}
          {sending && bubbles.at(-1)?.role !== "assistant" && (
            <p role="status" className="text-sm text-muted-foreground">
              {responder?.displayName ?? agent.displayName} is reading positions…
            </p>
          )}
        </div>
        <form onSubmit={submit} className="border-t border-border p-4 sm:p-5">
          <label htmlFor="agent-message" className="sr-only">
            Ask {agent.displayName}
          </label>
          <div className="rounded-tile border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
            <MentionInput
              id="agent-message"
              value={input}
              onChange={setInput}
              agents={agents}
              selfId={agent.id}
              placeholder="Ask about your positions… or @ another agent"
              className="block max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-hidden"
              disabled={sending}
            />
            <div className="mt-1 flex justify-end">
              <Button type="submit" size="sm" disabled={sending || input.trim().length === 0}>
                Send
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {chatErrorMessage(error)}
            </p>
          )}
          {openError && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {openError}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Educational analysis. No personal investment advice.
          </p>
        </form>
      </section>
      <aside
        aria-label="Conversation context"
        className="flex min-h-0 flex-col rounded-card border border-border bg-card p-5 lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)]"
      >
        <AgentThreads
          agentId={agent.id}
          activeThreadId={threadId}
          refreshKey={threadsKey}
          onOpen={(next) => void openThread(next)}
          onNew={() => showThread(startNewThread(agent.id))}
          onDeleted={threadDeleted}
        />
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-3xl">Your positions</h3>
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
                className="pressable flex items-center justify-between gap-3 rounded-tile bg-secondary/60 px-3 py-2.5 hover:bg-secondary"
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
          className="pressable mt-3 shrink-0 text-center text-xs font-semibold text-accent hover:underline"
        >
          View all positions →
        </Link>
      </aside>
    </div>
  );
}

/** Runs the open-time sync and owns the Yahoo consent prompt. Its problems are
 *  reported up through `onProblems` and shown in the Overview's one status
 *  line; the consent prompt keeps showing its own error because that is the
 *  reader's next action. */
function AppOpenSync({ onProblems }: { onProblems: (problems: string[]) => void }) {
  const [problems, setProblems] = useState<string[]>([]);
  const [consent, setConsent] = useState<"checking" | "required" | "accepted">("checking");
  const [consentBusy, setConsentBusy] = useState(false);
  useEffect(() => {
    onProblems(consent === "required" ? [] : problems);
  }, [consent, problems, onProblems]);
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
        <h3 id="yahoo-consent-title" className="text-xl">
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
        Checking your market data settings…
      </div>
    );
  return null;
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
  /* Operator status stays out of the user's way: silent while the server is
   * fine, one plain line when it is not. */
  if (error || (health && !health.ok))
    return <span>Investing data is offline. Figures may be out of date.</span>;
  if (!health) return <span>Connecting to your investing data…</span>;
  return null;
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

/** The module pill track. On a phone it scrolls sideways: an edge fade says
 *  more is off-screen, and the active pill is scrolled into view on navigation. */
function ModuleNav({ moduleIds }: { moduleIds: Parameters<typeof investingModulePath>[0][] }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  const [fade, setFade] = useState<"none" | "start" | "end" | "both">("none");
  const measure = useCallback(() => {
    const nav = ref.current;
    if (!nav) return;
    const start = nav.scrollLeft > 1;
    const end = nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 1;
    setFade(start && end ? "both" : start ? "start" : end ? "end" : "none");
  }, []);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    // Not every environment (jsdom) implements scrollIntoView.
    if (typeof active?.scrollIntoView === "function")
      active.scrollIntoView({ inline: "center", block: "nearest" });
    measure();
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [location.pathname, moduleIds.length, measure]);
  return (
    <nav
      ref={ref}
      aria-label="Main navigation"
      data-fade={fade}
      onScroll={measure}
      className="scroll-fade-x flex max-w-full items-center gap-1 overflow-x-auto rounded-pill bg-secondary p-1 [scrollbar-width:none]"
    >
      {moduleIds.map((id) => (
        <NavLink
          key={id}
          to={investingModulePath(id)}
          end={id === HOME_MODULE}
          className={({ isActive }) =>
            `flex min-h-11 items-center rounded-pill px-4 text-sm font-semibold whitespace-nowrap transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-background/40 hover:text-foreground"}`
          }
        >
          {MODULES.find((m) => m.id === id)?.label ?? id}
        </NavLink>
      ))}
    </nav>
  );
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useInvestingLayout();
  const detail = location.pathname.startsWith("/positions/");
  const positionsList = location.pathname === "/positions";
  const agentView = location.pathname.startsWith("/agents/");
  const isStockResearch = location.pathname === "/agents/research";
  const pageTitle = detail
    ? "Position"
    : agentView
      ? "Agent"
      : positionsList
        ? "Positions"
        : location.pathname === "/net-worth"
          ? "Net worth"
          : location.pathname === "/agents"
            ? "Agents"
            : null;
  const isProfile = location.pathname === "/profile";
  const isOverview = location.pathname === "/";
  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-frame bg-background sm:min-h-[calc(100vh-3rem)]">
        <header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/" className="pressable group flex items-baseline gap-3">
            <span className="font-display text-3xl">LaVega</span>
            <h1 className="font-sans text-sm font-medium leading-none text-muted-foreground">
              Investing
            </h1>
          </Link>
          <ModuleNav moduleIds={layout.status === "loading" ? [HOME_MODULE] : layout.modules} />
          <div className="ml-auto flex items-center gap-2">
            {/* DE WEG TERUG. Spiegelt de investing-knop in apps/web's NavBar: een
                gewone cross-document link, want de persoonlijke app is een eigen
                deploy en geen route hierbinnen. Zonder dit was de oversteek
                eenrichtingsverkeer — je kwam hier vanuit de kluis en moest daarna
                terug via de browserknop of een getypte URL. */}
            {PERSONAL_URL && (
              <a
                href={PERSONAL_URL}
                className="flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
                className="pressable min-h-11 rounded-pill border border-border bg-card px-4 text-xs font-semibold transition-colors hover:bg-secondary"
              >
                <span aria-hidden="true">+</span> Add widget
              </button>
            )}
            <ThemeToggle />
            <Link
              to="/profile"
              aria-label="Profile"
              className={`pressable flex size-11 items-center justify-center rounded-pill border border-border transition-colors hover:bg-secondary ${isProfile ? "bg-secondary" : ""}`}
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
          {/* Overview has no title here: the headline figures are its title, and the
              nav already says where you are. Its heading stays in the page for
              screen readers. */}
          {!isProfile && !isStockResearch && pageTitle && (
            <h2 className="mb-8 font-display text-5xl sm:text-6xl">{pageTitle}</h2>
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

const LETTER_AGENT_ID = "charlie_munger";

function Overview() {
  const state = useDashboard();
  const navigate = useNavigate();
  const { broker, price, priceProblem, connection, vault } = useSyncSession();
  const layout = useInvestingLayout();
  const [syncProblems, setSyncProblems] = useState<string[]>([]);
  const gate = historyGate(broker?.history);
  /* Until the layout loads, the registry defaults would flash widgets the
   * reader switched off and start their reads, so none render yet. */
  const layoutReady = layout.status === "ready";
  const widgets = new Set(layoutReady ? layout.widgets : []);
  const showRisk = widgets.has("risk");
  const showSectors = widgets.has("sectors");
  /* Overview owns the range/benchmark selection. Risk and composition are
   * projections of the one dashboard read (#216/#223), so the controls select
   * from the model already held and switching a range or benchmark does not
   * fetch. Sectors come from their own tenant-scoped read (#223), keyed on the
   * sector-store revision server-side, so the page makes one dashboard read
   * plus the sector read only while a sector widget is on screen. */
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
  /* The range/benchmark the reader picked, resolved against the projection's
   * default exactly as the summary route resolves it, and read from the held
   * dashboard payload. */
  const riskProjection = state.status === "ready" ? state.data.risk : undefined;
  const riskKey = benchmark || riskProjection?.defaultBenchmark || "";
  const riskReport =
    riskProjection?.byBenchmark?.[riskKey]?.[range] ?? riskProjection?.byBenchmark?.[""]?.[range];
  const summaryState: SummaryState =
    state.status === "ready" && riskReport
      ? {
          status: "ready",
          data: {
            metrics: riskReport.metrics,
            risk: riskReport.risk,
            composition: state.data.composition,
          },
        }
      : state.status === "error"
        ? { status: "error", message: state.message }
        : { status: "loading" };
  const refreshRisk = () => readDashboard();
  const { state: sectorState, refresh: refreshSectors } = useSectors(
    dashboardReady && showSectors,
    `${dataVersion}`,
  );

  const showLetter = widgets.has("agent");
  const letter = useLatestLetter(dashboardReady && showLetter);
  function discussLetter() {
    if (letter.state.status !== "ready") return;
    const threadId = startNewThread(LETTER_AGENT_ID);
    void portfolioChat(LETTER_AGENT_ID, threadId).sendMessage({
      text: letterToText(letter.state.letter),
    });
    navigate(`/agents/${LETTER_AGENT_ID}`);
  }
  const needsAttention =
    connection !== "online" ||
    broker?.status === "problem" ||
    price?.status === "problem" ||
    !!priceProblem ||
    vault === "locked";
  const statusItems =
    state.status === "ready" && gate.kind === "ready"
      ? overviewStatusItems({
          refreshError: state.refreshError ?? null,
          syncProblems,
          readingProblems: state.data.problems,
          needsAttention,
        })
      : [];
  return (
    <div className="space-y-6">
      <h2 className="sr-only">Overview</h2>
      {state.status === "ready" && gate.kind === "ready" && <PortfolioKpiRow data={state.data} />}
      <OverviewStatus items={statusItems} />
      <AppOpenSync onProblems={setSyncProblems} />
      {state.status === "loading" ? (
        <DashboardLoading />
      ) : state.status === "error" ? (
        <DashboardError message={state.message} />
      ) : gate.kind === "first-sync" ? (
        <HistoryLoading brokers={gate.brokers} />
      ) : !layoutReady ? null : widgets.size === 0 ? (
        <OverviewEmptyState />
      ) : (
        <>
          {/* Left stack: the wide, time-based cards. Right rail: the narrow,
              read-and-act cards. Two stacks (not one shared row grid) so a tall
              letter never leaves a hole under a short chart, and any subset a
              saved layout switches on still packs from the top. */}
          <div
            className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]"
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
              {showSectors && (
                <SectorAllocationCard
                  currency={state.data.presentationCurrency}
                  state={sectorState}
                  refresh={refreshSectors}
                />
              )}
            </div>
            <aside aria-label="Portfolio overview" className="min-w-0 space-y-5">
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
                  refresh={refreshRisk}
                  range={range}
                  onRangeChange={setRange}
                  benchmark={benchmark}
                  onBenchmarkChange={(value) =>
                    setBenchmarkSelection({ value, revision: benchmarksRevision })
                  }
                />
              )}
              {showLetter && (
                <PortfolioLetterCard
                  state={letter.state}
                  writeState={letter.writeState}
                  onDiscuss={discussLetter}
                  onWrite={letter.write}
                />
              )}
              {widgets.has("agent") && <PortfolioAgentCard />}
            </aside>
          </div>
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
      <DashboardStatus data={state.data} refreshError={state.refreshError} />
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
      className="rounded-card border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="position-title" className="font-display text-4xl">
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
            : (basisUnknownCopy(position.basis) ??
              "Import earlier transactions or connect your other brokers to calculate return.")}
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
            className="pressable mt-1 rounded-chip text-xs font-semibold text-accent underline-offset-2 hover:underline"
          >
            {quantityOpen ? "Hide history" : "Show quantity history"}
          </button>
        </div>
        {position.status === "open" && (
          <>
            <div>
              <dt className="text-muted-foreground">
                Average cost
                {position.basis?.source === "manual" && position.basis.locked && (
                  <span
                    className="ml-2 text-xs font-medium text-muted-foreground"
                    title="A locked manual cost basis survives broker syncs"
                  >
                    · locked
                  </span>
                )}
              </dt>
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
      className="rounded-card border border-border bg-card p-5 sm:p-6"
    >
      <h3 id="activity-title" className="font-display text-3xl">
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
        className="text-sm font-semibold text-accent hover:underline"
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
          <DashboardStatus data={state.data} refreshError={state.refreshError} />
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
