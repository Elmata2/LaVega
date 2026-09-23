import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  createFileAgentRunStore,
  migratePlaintextAgentRun,
  type AgentRunRecord,
} from "./fileAgentRunStore.js";
import { createFileCredentialStore } from "./fileCredentialStore.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function vaultPath() {
  const directory = await mkdtemp(join(tmpdir(), "lavega-agent-run-"));
  directories.push(directory);
  return join(directory, "credentials.json");
}

const running = (id: string, startedAt: string): AgentRunRecord => ({
  id,
  startedAt,
  finishedAt: null,
  status: "running",
  summary: null,
  error: null,
});

test("latest-started run survives restart and older finish cannot replace it", async () => {
  const path = await vaultPath();
  const first = createFileCredentialStore(path);
  await first.setup("passphrase");
  const store = createFileAgentRunStore(first);
  const older = running("1", "2026-08-19T12:00:00.000Z");
  const newer = running("2", "2026-08-19T18:00:00.000Z");
  expect(await store.start(older)).toBe(true);
  expect(await store.start(newer)).toBe(true);
  expect(
    await store.finish({ ...older, status: "done", finishedAt: "2026-08-19T19:00:00.000Z" }),
  ).toBe(false);
  const done = {
    ...newer,
    status: "done" as const,
    finishedAt: "2026-08-19T18:01:00.000Z",
    result: { balance: 12345, reasoning: "private" },
  };
  expect(await store.finish(done)).toBe(true);
  expect(await readFile(path, "utf8")).not.toMatch(/12345|private|balance|reasoning/);

  const cold = createFileCredentialStore(path);
  expect(await cold.unlock("passphrase")).toBe(true);
  expect(await createFileAgentRunStore(cold).get()).toEqual(done);
});

test("older delayed start and terminal-to-running regression are refused", async () => {
  const vault = createFileCredentialStore(await vaultPath());
  await vault.setup("passphrase");
  const store = createFileAgentRunStore(vault);
  const older = running("1", "2026-08-19T12:00:00.000Z");
  const newer = running("2", "2026-08-19T18:00:00.000Z");
  await store.start(newer);
  await store.finish({ ...newer, status: "done", finishedAt: "2026-08-19T18:01:00.000Z" });
  expect(await store.start(older)).toBe(false);
  expect(await store.start(newer)).toBe(false);
  expect((await store.get())?.status).toBe("done");
});

test("legacy plaintext run moves into vault and plaintext file is removed", async () => {
  const path = await vaultPath();
  const legacyPath = path.replace("credentials.json", "agent-run.json");
  const previous = process.env.LAVEGA_AGENT_RUN_FILE;
  process.env.LAVEGA_AGENT_RUN_FILE = legacyPath;
  try {
    const record = {
      ...running("legacy", "2026-08-19T12:00:00.000Z"),
      status: "done" as const,
      finishedAt: "2026-08-19T12:01:00.000Z",
      result: { positions: 42 },
    };
    await writeFile(legacyPath, JSON.stringify(record));
    const vault = createFileCredentialStore(path);
    await vault.setup("passphrase");
    const store = createFileAgentRunStore(vault);
    await migratePlaintextAgentRun(store);
    expect(await store.get()).toEqual(record);
    await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path, "utf8")).not.toContain("positions");
  } finally {
    if (previous === undefined) delete process.env.LAVEGA_AGENT_RUN_FILE;
    else process.env.LAVEGA_AGENT_RUN_FILE = previous;
  }
});

test("legacy plaintext run remains when encrypted migration fails", async () => {
  const path = await vaultPath();
  const legacyPath = path.replace("credentials.json", "agent-run.json");
  const previous = process.env.LAVEGA_AGENT_RUN_FILE;
  process.env.LAVEGA_AGENT_RUN_FILE = legacyPath;
  try {
    await writeFile(legacyPath, JSON.stringify(running("legacy", "2026-08-19T12:00:00.000Z")));
    await expect(
      migratePlaintextAgentRun({
        get: async () => null,
        start: async () => {
          throw new Error("vault write failed");
        },
        finish: async () => false,
      }),
    ).rejects.toThrow("vault write failed");
    expect(await readFile(legacyPath, "utf8")).toContain("legacy");
  } finally {
    if (previous === undefined) delete process.env.LAVEGA_AGENT_RUN_FILE;
    else process.env.LAVEGA_AGENT_RUN_FILE = previous;
  }
});
