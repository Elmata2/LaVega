import type { createFileCredentialStore } from "./fileCredentialStore.js";
import { readFile, unlink } from "node:fs/promises";
import { runtimeDataFile } from "./jsonFileStore.js";
import type { AgentRunRecord, AgentRunStore } from "./agentRunTypes.js";

export type { AgentRunRecord, AgentRunStore, AgentRunStatus } from "./agentRunTypes.js";

/** Single-tenant local adapter; record lives in the encrypted credential vault. */
export function createFileAgentRunStore(
  vault: Pick<
    ReturnType<typeof createFileCredentialStore>,
    "getAgentRun" | "startAgentRun" | "finishAgentRun"
  >,
): AgentRunStore {
  return {
    get: () => vault.getAgentRun(),
    start: (record) => vault.startAgentRun(record),
    finish: (record) => vault.finishAgentRun(record),
  };
}

/** Discard legacy operational state when no unlocked vault can encrypt it. */
export async function discardPlaintextAgentRun(): Promise<void> {
  const path = runtimeDataFile("LAVEGA_AGENT_RUN_FILE", "agent-run.json");
  try {
    await unlink(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

/** Move old plaintext operational state into the vault, then remove its file. */
export async function migratePlaintextAgentRun(store: AgentRunStore): Promise<void> {
  const path = runtimeDataFile("LAVEGA_AGENT_RUN_FILE", "agent-run.json");
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  let record: AgentRunRecord | null = null;
  try {
    const parsed: unknown = JSON.parse(contents);
    if (parsed && typeof parsed === "object") {
      const value = parsed as Partial<AgentRunRecord>;
      if (
        typeof value.id === "string" &&
        typeof value.startedAt === "string" &&
        (value.status === "running" || value.status === "done" || value.status === "error")
      )
        record = value as AgentRunRecord;
    }
  } catch {
    /* malformed legacy state is removed */
  }
  if (record && (await store.start({ ...record, status: "running", finishedAt: null }))) {
    if (record.status !== "running") await store.finish(record);
  }
  await discardPlaintextAgentRun();
}
