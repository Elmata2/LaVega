import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

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

export function runtimeAgentRunFile(): string {
  return runtimeDataFile("LAVEGA_AGENT_RUN_FILE", "agent-run.json");
}

function isRecord(value: unknown): value is AgentRunRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AgentRunRecord>;
  const optionalString = (item: unknown) => item === undefined || item === null || typeof item === "string";
  return typeof record.id === "string"
    && optionalString(record.agentId)
    && typeof record.startedAt === "string"
    && optionalString(record.finishedAt)
    && (record.status === "running" || record.status === "done" || record.status === "error")
    && optionalString(record.summary)
    && optionalString(record.error);
}

/** Only the latest agent run is kept: this is operational state, not history. */
export function createFileAgentRunStore(filePath = runtimeAgentRunFile()) {
  const store = createJsonFileStore<AgentRunRecord | null>(filePath, {
    empty: null,
    validate: (contents) => {
      try {
        const parsed: unknown = JSON.parse(contents);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
  });

  return {
    async get() {
      return await store.read();
    },
    async put(record: AgentRunRecord) {
      await store.update(() => record);
    },
  };
}

export type AgentRunStore = ReturnType<typeof createFileAgentRunStore>;
