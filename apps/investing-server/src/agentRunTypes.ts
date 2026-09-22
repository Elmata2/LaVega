export type AgentRunStatus = "running" | "done" | "error";

export type AgentRunRecord = {
  id: string;
  agentId?: string;
  startedAt: string;
  finishedAt: string | null;
  status: AgentRunStatus;
  summary: string | null;
  error: string | null;
  result?: unknown;
};

/** Latest means latest-started. A terminal write succeeds only for its current run. */
export type AgentRunStore = {
  get(): Promise<AgentRunRecord | null>;
  start(record: AgentRunRecord): Promise<boolean>;
  finish(record: AgentRunRecord): Promise<boolean>;
};
