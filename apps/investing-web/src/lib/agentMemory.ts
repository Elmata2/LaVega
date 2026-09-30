import type { UIMessage } from "ai";

/* Client side of /api/memory (ADR 0007). Terms follow the investing glossary
 * in docs/CONTEXT.md. A server without a database answers 503, and the
 * memory UI then stays out of the way. */

export type RiskTolerance = "conservative" | "balanced" | "aggressive";
export const RISK_TOLERANCE_LABELS: Record<RiskTolerance, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

export type ThreadSummary = { id: string; agentId: string; title: string; updatedAt: string };
export type Thesis = {
  symbol: string;
  status: "active" | "dormant";
  why: string;
  worth: string | null;
  entry: string | null;
  wrongIf: string | null;
  updatedAt: string;
};
export type Goal = { id: string; symbol: string | null; text: string; updatedAt: string };
export type Memory = { riskTolerance: RiskTolerance | null; theses: Thesis[]; goals: Goal[] };

async function problem(response: Response, fallback: string): Promise<Error> {
  const body: { problems?: unknown } = await response.json().catch(() => ({}));
  const first = Array.isArray(body.problems) ? body.problems[0] : null;
  return new Error(typeof first === "string" ? first : fallback);
}

/** Null when memory is unavailable on this server. */
export async function fetchThreads(agentId: string): Promise<ThreadSummary[] | null> {
  const response = await fetch(`/api/memory/threads?agentId=${encodeURIComponent(agentId)}`);
  if (!response.ok) return null;
  const body: { threads?: unknown } = await response.json().catch(() => ({}));
  return Array.isArray(body.threads) ? (body.threads as ThreadSummary[]) : null;
}

export async function fetchThreadMessages(threadId: string): Promise<UIMessage[]> {
  const response = await fetch(`/api/memory/threads/${threadId}`);
  if (!response.ok) throw await problem(response, "Conversation could not be opened.");
  const body = (await response.json()) as { thread?: { messages?: UIMessage[] } };
  return body.thread?.messages ?? [];
}

export async function deleteThread(threadId: string): Promise<void> {
  const response = await fetch(`/api/memory/threads/${threadId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404)
    throw await problem(response, "Conversation could not be deleted.");
}

/** Null when memory is unavailable on this server. */
export async function fetchMemory(): Promise<Memory | null> {
  const response = await fetch("/api/memory");
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as Partial<Memory>;
  return Array.isArray(body.theses) && Array.isArray(body.goals)
    ? { riskTolerance: body.riskTolerance ?? null, theses: body.theses, goals: body.goals }
    : null;
}

async function put<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await problem(response, fallback);
  return (await response.json()) as T;
}

export const saveRiskTolerance = (riskTolerance: RiskTolerance | null) =>
  put<{ riskTolerance: RiskTolerance | null }>(
    "/api/memory/risk-tolerance",
    { riskTolerance },
    "Risk tolerance could not be saved.",
  );

export const saveThesis = (
  thesis: Pick<Thesis, "symbol" | "why" | "worth" | "entry" | "wrongIf">,
) =>
  put<{ thesis: Thesis }>(
    `/api/memory/theses/${encodeURIComponent(thesis.symbol)}`,
    thesis,
    "Thesis could not be saved.",
  ).then((body) => body.thesis);

export const saveGoal = (goal: Pick<Goal, "id" | "symbol" | "text">) =>
  put<{ goal: Goal }>(
    `/api/memory/goals/${goal.id}`,
    { text: goal.text, symbol: goal.symbol },
    "Goal could not be saved.",
  ).then((body) => body.goal);
