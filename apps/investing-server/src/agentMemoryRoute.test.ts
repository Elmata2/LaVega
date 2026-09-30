import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { createAgentMemoryRepository, type Database } from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { createRuntimeApp } from "./index.js";

/* The dev fixture holds AAPL, MSFT and ASML. Memory runs on real Postgres
 * with RLS, so what a turn stores is what the owner reads back. */

const THREAD = "00000000-0000-4000-8000-000000000001";
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "33".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
  await pglite.close();
});

beforeEach(async () => {
  vi.stubEnv("INVESTING_DEV_FIXTURE", "1");
  vi.stubEnv("LAVEGA_VAULT_FILE", join(tmpdir(), `lavega-missing-${Date.now()}.json`));
  await pglite.exec(
    `RESET ROLE;
     DELETE FROM investing.agent_observations; DELETE FROM investing.agent_messages;
     DELETE FROM investing.goals; DELETE FROM investing.theses;
     DELETE FROM investing.agent_threads; DELETE FROM investing.preferences;
     SET ROLE lavega_runtime;`,
  );
});

type Step = { text: string } | { tool: string; input: Record<string, unknown> };

function scriptedModel(steps: Step[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[Math.min(call++, steps.length - 1)]!;
      if ("text" in step)
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: step.text },
              { type: "text-end" as const, id: "t" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                usage,
              },
            ],
          }),
        };
      return {
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${call}`,
              toolName: step.tool,
              input: JSON.stringify(step.input),
            },
            {
              type: "finish" as const,
              finishReason: { unified: "tool-calls" as const, raw: undefined },
              usage,
            },
          ],
        }),
      };
    },
  });
}

async function runtime(chatModel = scriptedModel([{ text: "Noted." }]), tenant = "alice") {
  return createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    chatModel,
    resolveTenantId: () => tenant,
    agentMemory: (tenantId) => createAgentMemoryRepository(db, tenantId),
  });
}

async function turn(
  app: Awaited<ReturnType<typeof runtime>>,
  text: string,
  { id = THREAD, agentId = "charlie_munger" }: { id?: string | null; agentId?: string } = {},
) {
  const response = await app.request("http://localhost/api/agents/portfolio/conversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId,
      ...(id ? { id } : {}),
      messages: [{ id: `u-${text}`, role: "user", parts: [{ type: "text", text }] }],
    }),
  });
  const body = await response.text();
  return { status: response.status, body };
}

const json = async (app: Awaited<ReturnType<typeof runtime>>, path: string, init?: RequestInit) =>
  (await app.request(`http://localhost${path}`, init)).json();

test("a conversation is saved as a thread of its agent and reopens with the reply", async () => {
  const app = await runtime(scriptedModel([{ text: "Why do you own it?" }]));
  expect((await turn(app, "What about ASML?")).status).toBe(200);

  expect(await json(app, "/api/memory/threads?agentId=charlie_munger")).toEqual({
    threads: [
      expect.objectContaining({ id: THREAD, agentId: "charlie_munger", title: "What about ASML?" }),
    ],
  });
  expect(await json(app, "/api/memory/threads?agentId=warren_buffett")).toEqual({ threads: [] });
  const { thread } = (await json(app, `/api/memory/threads/${THREAD}`)) as {
    thread: { messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> };
  };
  expect(thread.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(thread.messages[1]?.parts.find((part) => part.type === "text")?.text).toBe(
    "Why do you own it?",
  );
});

test("the agent asks for a missing thesis and stores the one the owner confirms", async () => {
  const first = scriptedModel([{ text: "Why do you own ASML?" }]);
  const app = await runtime(first);
  await turn(app, "What about ASML?");
  const prompt = JSON.stringify(first.doStreamCalls[0]?.prompt);
  expect(prompt).toContain("They hold ASML and have no thesis for it");
  expect(prompt).toContain("Risk tolerance: not set");

  const saving = scriptedModel([
    {
      tool: "save_thesis",
      input: { symbol: "asml", why: "Only EUV supplier", worth: "€900 a share" },
    },
    { text: "Saved your thesis for ASML." },
  ]);
  await turn(await runtime(saving), "Yes, save that: only EUV supplier, worth €900.");

  const { theses } = (await json(await runtime(), "/api/memory")) as {
    theses: Array<Record<string, unknown>>;
  };
  expect(theses).toEqual([
    expect.objectContaining({
      symbol: "ASML",
      status: "active",
      why: "Only EUV supplier",
      worth: "€900 a share",
    }),
  ]);

  const next = scriptedModel([{ text: "Still true?" }]);
  await turn(await runtime(next), "Is ASML still a buy?");
  expect(JSON.stringify(next.doStreamCalls[0]?.prompt)).toContain(
    "Thesis for ASML: why they own it: Only EUV supplier",
  );
});

test("a thesis for a symbol the owner does not hold is refused", async () => {
  const model = scriptedModel([
    { tool: "save_thesis", input: { symbol: "NVDA", why: "AI" } },
    { text: "ok" },
  ]);
  await turn(await runtime(model), "Save NVDA");
  expect(await json(await runtime(), "/api/memory")).toMatchObject({ theses: [] });
});

test("deleting a thread through the API keeps the goal agreed in it", async () => {
  const model = scriptedModel([
    { tool: "save_goal", input: { text: "€500 a month in dividends" } },
    { tool: "note_observation", input: { text: "Wants income before 60" } },
    { text: "Saved." },
  ]);
  const app = await runtime(model);
  await turn(app, "My goal is €500 a month in dividends.");

  expect(
    (await app.request(`http://localhost/api/memory/threads/${THREAD}`, { method: "DELETE" }))
      .status,
  ).toBe(204);
  expect((await app.request(`http://localhost/api/memory/threads/${THREAD}`)).status).toBe(404);
  expect(await json(app, "/api/memory/export")).toMatchObject({
    threads: [],
    observations: [],
    goals: [{ text: "€500 a month in dividends", sourceThreadId: null }],
  });
});

test("a turn needs a thread id when memory is on, and cannot write into another agent's thread", async () => {
  const app = await runtime();
  expect((await turn(app, "hi", { id: null })).status).toBe(400);
  await turn(app, "hi");
  expect((await turn(app, "hi", { agentId: "warren_buffett" })).status).toBe(502);
});

test("another owner sees none of it", async () => {
  await turn(await runtime(), "What about ASML?");
  const bob = await runtime(undefined, "bob");
  expect(await json(bob, "/api/memory/threads?agentId=charlie_munger")).toEqual({ threads: [] });
  expect(
    (await bob.request(`http://localhost/api/memory/threads/${THREAD}`, { method: "DELETE" }))
      .status,
  ).toBe(404);
});

test("the owner sets risk tolerance and edits theses and goals, within the rules", async () => {
  const app = await runtime();
  const put = (path: string, body: unknown) =>
    app.request(`http://localhost${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await put("/api/memory/risk-tolerance", { riskTolerance: "reckless" })).status).toBe(400);
  expect((await put("/api/memory/risk-tolerance", { riskTolerance: "balanced" })).status).toBe(200);
  expect(await json(app, "/api/memory")).toMatchObject({ riskTolerance: "balanced" });

  expect((await put("/api/memory/theses/ASML", { why: "Monopoly" })).status).toBe(404);
  const repository = createAgentMemoryRepository(db, "alice");
  await repository.confirmThesis("ASML", {
    why: "Monopoly",
    worth: null,
    entry: null,
    wrongIf: null,
  });
  const goal = await repository.confirmGoal({ symbol: null, text: "Income", sourceThreadId: null });

  expect((await put("/api/memory/theses/ASML", { why: "" })).status).toBe(400);
  expect(
    (await put("/api/memory/theses/asml", { why: "EUV monopoly", wrongIf: "China" })).status,
  ).toBe(200);
  expect(
    (await put(`/api/memory/goals/${goal.id}`, { text: "More income", symbol: "ko" })).status,
  ).toBe(200);
  expect(await json(app, "/api/memory")).toMatchObject({
    theses: [{ symbol: "ASML", why: "EUV monopoly", wrongIf: "China" }],
    goals: [{ symbol: "KO", text: "More income" }],
  });
  expect(
    (await app.request("http://localhost/api/memory/theses/ASML", { method: "DELETE" })).status,
  ).toBe(404);
});

test("without a database memory answers 503 and the chat still works", async () => {
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    chatModel: scriptedModel([{ text: "Hello." }]),
  });
  expect((await app.request("http://localhost/api/memory")).status).toBe(503);
  expect((await turn(app, "hi", { id: null })).body).toContain("Hello.");
});
