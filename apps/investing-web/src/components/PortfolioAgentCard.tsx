import { useState } from "react";
import { Link } from "react-router-dom";
import {
  runPortfolioAgent,
  useAgentCatalog,
  useAgentRequests,
  type PortfolioAgentInsight,
} from "../lib/portfolioAgents.js";
import { Button } from "./ui/button";

export function AgentCatalogProblem({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
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

export function PortfolioAgentCard() {
  const { catalog, reload } = useAgentCatalog();
  const { requestFor, start, settle } = useAgentRequests();
  const [selectedId, setSelectedId] = useState("");
  const [insights, setInsights] = useState<Record<string, PortfolioAgentInsight>>({});

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

  const tone =
    insight?.signal === "bullish"
      ? "text-positive"
      : insight?.signal === "bearish"
        ? "text-negative"
        : "text-muted-foreground";
  return (
    <section
      aria-labelledby="portfolio-agent-title"
      className="rounded-card border border-border bg-card p-5"
      data-dashboard-section="agent"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 id="portfolio-agent-title" className="font-display text-3xl">
          Investor lens
        </h3>
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
          <div className="relative mt-4">
            <select
              aria-label="Choose agent"
              value={active.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="block w-full cursor-pointer appearance-none rounded-tile border border-input bg-secondary py-2.5 pl-3 pr-10 text-sm font-semibold text-foreground"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{active.investingStyle}</p>
          <Button type="button" className="mt-4 w-full" onClick={run} disabled={request.pending}>
            {request.pending ? "Agent reading…" : "Analyse portfolio"}
          </Button>
          <Link
            to={`/agents/${active.id}`}
            className="pressable mt-3 block text-center text-sm font-semibold text-accent hover:underline"
          >
            Open conversation with {active.displayName} →
          </Link>
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
