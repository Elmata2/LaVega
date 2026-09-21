import { useCallback, useEffect, useState } from "react";

export type PortfolioAgentDefinition = {
  id: string;
  displayName: string;
  description: string;
  investingStyle: string;
};

export type PortfolioAgentInsight = {
  agentId: string;
  displayName: string;
  signal: "bullish" | "bearish" | "neutral" | "no_view";
  confidence: number;
  summary: string;
  reasoning: string;
  insights: string[];
  model: string;
  snapshotHash: string;
};
export type PortfolioConversationTurn = { role: "user" | "assistant"; content: string };
export type PortfolioConversationReply = {
  agentId: string;
  displayName: string;
  text: string;
  model: string;
  snapshotHash: string;
  judgment: { signal: "bullish" | "bearish" | "neutral" | "no_view"; confidence: number };
};

/* The catalog has four outcomes and the UI must be able to tell them apart:
 * an empty catalog is a resolved answer, not a load that never finished. */
export type AgentCatalog =
  | { status: "loading" }
  | { status: "ready"; agents: PortfolioAgentDefinition[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export type AgentRequest = { pending: boolean; error: string | null };

const NO_REQUEST: AgentRequest = { pending: false, error: null };

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
      insight.signal === "neutral" ||
      insight.signal === "no_view") &&
    typeof insight.confidence === "number" &&
    typeof insight.summary === "string" &&
    typeof insight.reasoning === "string" &&
    Array.isArray(insight.insights) &&
    typeof insight.model === "string" &&
    typeof insight.snapshotHash === "string"
  );
}

function judgmentInsight(value: unknown, agentId: string): PortfolioAgentInsight | null {
  if (!value || typeof value !== "object") return null;
  const run = value as { model?: unknown; snapshotHash?: unknown; judgments?: unknown };
  if (!Array.isArray(run.judgments) || typeof run.model !== "string" || typeof run.snapshotHash !== "string")
    return null;
  const judgment = run.judgments.find(
    (item): item is { agentId: string; displayName: string; signal: { choice?: unknown; probabilities?: Record<string, unknown> } | null } =>
      !!item && typeof item === "object" &&
      (item as { agentId?: unknown }).agentId === agentId &&
      typeof (item as { displayName?: unknown }).displayName === "string",
  );
  if (!judgment) return null;
  const signal = judgment.signal?.choice;
  if (signal !== "bullish" && signal !== "bearish" && signal !== "neutral" && signal !== "no_view")
    return null;
  const probability = judgment.signal?.probabilities?.[signal];
  const confidence = typeof probability === "number" && Number.isFinite(probability)
    ? Math.round(Math.max(0, Math.min(1, probability)) * 100)
    : 0;
  return {
    agentId,
    displayName: judgment.displayName,
    signal,
    confidence,
    summary: signal === "no_view" ? "No view from this lens. Portfolio data is insufficient." : "Typed portfolio judgment.",
    reasoning: "Educational analysis only. Expand this agent for written explanation.",
    insights: [],
    model: run.model,
    snapshotHash: run.snapshotHash,
  };
}

export async function fetchPortfolioAgents(): Promise<PortfolioAgentDefinition[]> {
  const response = await fetch("/api/agents/portfolio");
  if (!response.ok) throw new Error("Failed to load agents.");
  const payload = (await response.json()) as { agents?: unknown };
  return Array.isArray(payload.agents) ? payload.agents.filter(isPortfolioAgentDefinition) : [];
}

export async function runPortfolioAgent(
  agentId: string,
  prompt?: string,
): Promise<PortfolioAgentInsight> {
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
  if (isPortfolioAgentInsight(payload.result)) return payload.result;
  const insight = judgmentInsight(payload.result, agentId);
  if (!insight) throw new Error("Agent gave an invalid answer.");
  return insight;
}

export async function sendPortfolioAgentMessage(
  agentId: string,
  prompt: string,
  history: readonly PortfolioConversationTurn[],
): Promise<PortfolioConversationReply> {
  const response = await fetch("/api/agents/portfolio/conversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, prompt, history }),
  });
  const payload = (await response.json().catch(() => ({}))) as { result?: unknown; problems?: string[] };
  if (!response.ok) throw new Error(payload.problems?.[0] ?? "Agent reply failed.");
  const result = payload.result as Partial<PortfolioConversationReply> | undefined;
  if (!result || typeof result.text !== "string" || typeof result.agentId !== "string")
    throw new Error("Agent gave an invalid reply.");
  return result as PortfolioConversationReply;
}

export function useAgentCatalog(): { catalog: AgentCatalog; reload: () => void } {
  const [catalog, setCatalog] = useState<AgentCatalog>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void fetchPortfolioAgents()
      .then((agents) => {
        if (!current) return;
        setCatalog(agents.length === 0 ? { status: "empty" } : { status: "ready", agents });
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setCatalog({
          status: "error",
          message: reason instanceof Error ? reason.message : "Failed to load agents.",
        });
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  /* The mount's loading state comes from useState's initial value. A retry
   * is the event that should show loading again, so it sets that state
   * itself instead of the effect inferring it from `attempt` changing. */
  const reload = useCallback(() => {
    setCatalog({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  return { catalog, reload };
}

/* Every run belongs to the persona that started it. Keying by agent id is
 * what keeps a reply or a failure from landing on whichever persona the
 * reader happens to be looking at when the request settles. */
export function useAgentRequests(): {
  requestFor: (agentId: string) => AgentRequest;
  start: (agentId: string) => void;
  settle: (agentId: string, error: string | null) => void;
} {
  const [requests, setRequests] = useState<Record<string, AgentRequest>>({});

  const requestFor = useCallback((agentId: string) => requests[agentId] ?? NO_REQUEST, [requests]);
  const start = useCallback((agentId: string) => {
    setRequests((current) => ({ ...current, [agentId]: { pending: true, error: null } }));
  }, []);
  const settle = useCallback((agentId: string, error: string | null) => {
    setRequests((current) => ({ ...current, [agentId]: { pending: false, error } }));
  }, []);

  return { requestFor, start, settle };
}
