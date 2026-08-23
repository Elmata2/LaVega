import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileAgentRunStore } from "./fileAgentRunStore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function runPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lavega-agent-run-"));
  directories.push(directory);
  return join(directory, "agent-run.json");
}

test("the latest run survives a restart", async () => {
  const filePath = await runPath();
  await createFileAgentRunStore(filePath).put({ id: "1", startedAt: "2026-08-19T12:00:00.000Z", finishedAt: "2026-08-19T12:01:00.000Z", status: "done", summary: "All good", error: null });

  expect(await createFileAgentRunStore(filePath).get()).toEqual({ id: "1", startedAt: "2026-08-19T12:00:00.000Z", finishedAt: "2026-08-19T12:01:00.000Z", status: "done", summary: "All good", error: null });
});

test("only the latest run is kept", async () => {
  const filePath = await runPath();
  const store = createFileAgentRunStore(filePath);
  await store.put({ id: "1", startedAt: "2026-08-19T12:00:00.000Z", finishedAt: null, status: "running", summary: null, error: null });
  await store.put({ id: "2", startedAt: "2026-08-19T18:00:00.000Z", finishedAt: null, status: "running", summary: null, error: null });

  expect((await store.get())?.id).toBe("2");
});

test("a missing or corrupt file reads as no run rather than blocking an agent run", async () => {
  const filePath = await runPath();
  expect(await createFileAgentRunStore(filePath).get()).toBeNull();

  await writeFile(filePath, "{ not json", "utf8");
  expect(await createFileAgentRunStore(filePath).get()).toBeNull();
});
