import type { AgentRunRecord, AgentRunStore } from "./agentRunTypes.js";

let lastTransitionMicrosecond = 0;
function nextTransitionAt(): string {
  lastTransitionMicrosecond = Math.max(Date.now() * 1_000, lastTransitionMicrosecond + 1);
  const milliseconds = Math.floor(lastTransitionMicrosecond / 1_000);
  const micros = lastTransitionMicrosecond % 1_000;
  return `${new Date(milliseconds).toISOString().slice(0, -1)}${String(micros).padStart(3, "0")}Z`;
}

/** Owns durable run transitions. Latest is latest-started, not latest-finished. */
export function createAgentRunController(store: AgentRunStore) {
  const inFlight = new Map<string, Promise<AgentRunRecord>>();
  return {
    run(model: string | undefined, execute: () => Promise<unknown>): Promise<AgentRunRecord> {
      const key = model?.trim() ?? "";
      const existing = inFlight.get(key);
      if (existing) return existing;
      const record: AgentRunRecord = {
        id: crypto.randomUUID(),
        agentId: "portfolio-judgments",
        startedAt: nextTransitionAt(),
        finishedAt: null,
        status: "running",
        summary: null,
        error: null,
      };
      const run = (async () => {
        try {
          const accepted = await store.start(record);
          if (!accepted) throw new Error("Agent run start was superseded");
        } catch (error) {
          throw new Error("Agent run storage failed to start", { cause: error });
        }
        let result: unknown;
        try {
          result = await execute();
        } catch (error) {
          const failed: AgentRunRecord = {
            ...record,
            finishedAt: nextTransitionAt(),
            status: "error",
            error: error instanceof Error ? error.message : "Portfolio agent run failed",
          };
          await store.finish(failed);
          throw error;
        }
        const done: AgentRunRecord = {
          ...record,
          finishedAt: nextTransitionAt(),
          status: "done",
          result,
        };
        await store.finish(done);
        return done;
      })();
      inFlight.set(key, run);
      void run
        .finally(() => {
          if (inFlight.get(key) === run) inFlight.delete(key);
        })
        .catch(() => undefined);
      return run;
    },
  };
}
