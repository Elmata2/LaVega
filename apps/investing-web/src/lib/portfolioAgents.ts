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
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  summary: string;
  reasoning: string;
  insights: string[];
  model: string;
  snapshotHash: string;
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
      insight.signal === "neutral") &&
    typeof insight.confidence === "number" &&
    typeof insight.summary === "string" &&
    typeof insight.reasoning === "string" &&
    Array.isArray(insight.insights) &&
    typeof insight.model === "string" &&
    typeof insight.snapshotHash === "string"
  );
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
  if (!isPortfolioAgentInsight(payload.result)) throw new Error("Agent gave an invalid answer.");
  return payload.result;
}

export function useAgentCatalog(): { catalog: AgentCatalog; reload: () => void } {
  const [catalog, setCatalog] = useState<AgentCatalog>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setCatalog({ status: "loading" });
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

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
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
