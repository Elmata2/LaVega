import { expect, test } from "vitest";
import { createAgentRunController } from "./agentRun.js";
import type { AgentRunRecord, AgentRunStore } from "./fileAgentRunStore.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function memoryStore(): AgentRunStore {
  let current: AgentRunRecord | null = null;
  return {
    get: async () => current,
    start: async (record) => {
      if (current && current.startedAt > record.startedAt) return false;
      current = record;
      return true;
    },
    finish: async (record) => {
      if (current?.id !== record.id || current.status !== "running") return false;
      current = record;
      return true;
    },
  };
}

test("start must persist before model work; rejected start reports storage failure", async () => {
  const start = deferred<boolean>();
  const store = memoryStore();
  let modelCalls = 0;
  const controller = createAgentRunController({ ...store, start: () => start.promise });
  const run = controller.run(undefined, async () => {
    modelCalls++;
    return {};
  });
  expect(modelCalls).toBe(0);
  start.reject(new Error("disk full"));
  await expect(run).rejects.toThrow("Agent run storage failed to start");
  expect(modelCalls).toBe(0);
});
