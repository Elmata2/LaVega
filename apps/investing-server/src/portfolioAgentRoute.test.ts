import { expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { createRuntimeApp, type RuntimeApp } from "./index.js";
import type { AgentRunRecord, AgentRunStore } from "./fileAgentRunStore.js";

function memoryAgentRunStore() {
  let record: AgentRunRecord | null = null;
  return {
    async get() {
      return record;
    },
    async put(next: AgentRunRecord) {
      record = next;
    },
  } satisfies AgentRunStore;
}

async function appWith(runAgent: (options: { prompt: string }) => Promise<string>) {
  const agentRunStore = memoryAgentRunStore();
  const runtimeApp: RuntimeApp = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    agentRunStore,
    runAgent,
  });
  return { runtimeApp, agentRunStore };
}

const post = async (runtimeApp: RuntimeApp) =>
  runtimeApp.request("http://localhost/api/agents/portfolio/run", { method: "POST" });

test("the portfolio agent route returns the model summary, insight payload and persists a done run", async () => {
  const runAgent = vi.fn(async () => "Portfolio is healthy.");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await post(runtimeApp);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    summary: "Portfolio is healthy.",
    result: {
      agentId: "warren_buffett",
      displayName: "Warren Buffett",
      summary: "Portfolio is healthy.",
    },
  });
  expect(runAgent).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: expect.stringContaining("portfolio health assistant") }),
  );
  expect(await agentRunStore.get()).toMatchObject({
    agentId: "warren_buffett",
    status: "done",
    summary: "Portfolio is healthy.",
    error: null,
  });
});

test("a failed agent run returns 502 and persists the error", async () => {
  const { runtimeApp, agentRunStore } = await appWith(
    vi.fn(async () => {
      throw new Error("model unavailable");
    }),
  );

  const response = await post(runtimeApp);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ problems: ["model unavailable"] });
  expect(await agentRunStore.get()).toMatchObject({ status: "error", error: "model unavailable" });
});

test("concurrent runs share a single in-flight agent execution", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const runAgent = vi.fn(async () => {
    await gate;
    return "done";
  });
  const { runtimeApp } = await appWith(runAgent);

  const pending = [post(runtimeApp), post(runtimeApp)];
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const [first, second] = await Promise.all(pending);

  expect([first.status, second.status]).toEqual([200, 200]);
  expect(runAgent).toHaveBeenCalledOnce();
});

test("concurrent runs with different prompts execute separately", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const runAgent = vi.fn(async ({ prompt }: { prompt: string }) => {
    await gate;
    return prompt;
  });
  const { runtimeApp } = await appWith(runAgent);

  const pending = [
    runtimeApp.request("http://localhost/api/agents/portfolio/run", {
      method: "POST",
      body: JSON.stringify({ prompt: "Assess concentration." }),
    }),
    runtimeApp.request("http://localhost/api/agents/portfolio/run", {
      method: "POST",
      body: JSON.stringify({ prompt: "Assess liquidity." }),
    }),
  ];
  try {
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
  } finally {
    release();
  }
  const responses = await Promise.all(pending);

  expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
    expect.objectContaining({ summary: "Assess concentration." }),
    expect.objectContaining({ summary: "Assess liquidity." }),
  ]);
});

test("the portfolio agent route accepts a selected investor persona", async () => {
  const runAgent = vi.fn(async () => "Ackman view.");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ agentId: "bill_ackman" }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    result: { agentId: "bill_ackman", displayName: "Bill Ackman" },
  });
  expect(await agentRunStore.get()).toMatchObject({
    agentId: "bill_ackman",
    summary: "Ackman view.",
  });
});

test("the portfolio agent route accepts a model override", async () => {
  const runAgent = vi.fn(async () => "Munger view.");
  const { runtimeApp } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ agentId: "charlie_munger", model: "openai/gpt-5-mini" }),
  });

  expect(response.status).toBe(200);
  expect(runAgent).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "charlie_munger", model: "openai/gpt-5-mini" }),
  );
});

test("the portfolio agent route forwards a custom prompt and returns its result", async () => {
  const prompt = "Assess concentration risk in my current positions.";
  const runAgent = vi.fn(
    async ({ prompt: receivedPrompt }: { prompt: string }) => `Response to: ${receivedPrompt}`,
  );
  const { runtimeApp } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

  expect(response.status).toBe(200);
  expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ prompt }));
  expect(await response.json()).toMatchObject({
    summary: `Response to: ${prompt}`,
    result: { summary: `Response to: ${prompt}` },
  });
});

test("an unusable model response fails the run and answers 502 on the existing shape", async () => {
  const { runtimeApp, agentRunStore } = await appWith(
    vi.fn(async () => {
      throw new Error("Portfolio agent returned an unusable response: signal must be exactly");
    }),
  );

  const response = await post(runtimeApp);

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    problems: ["Portfolio agent returned an unusable response: signal must be exactly"],
  });
  expect(await agentRunStore.get()).toMatchObject({ status: "error" });
});

test("an unknown explicit persona is rejected before any snapshot or model side effect", async () => {
  const runAgent = vi.fn(async () => "never runs");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ agentId: "gordon_gekko" }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ problems: ["Unknown portfolio agent"] });
  expect(runAgent).not.toHaveBeenCalled();
  expect(await agentRunStore.get()).toBeNull();
});

test("a malformed request body is rejected before any snapshot or model side effect", async () => {
  const runAgent = vi.fn(async () => "never runs");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: "{ not json",
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ problems: ["Request body must be a JSON object"] });
  expect(runAgent).not.toHaveBeenCalled();
  expect(await agentRunStore.get()).toBeNull();
});

test("a non-string model or prompt is rejected", async () => {
  const runAgent = vi.fn(async () => "never runs");
  const { runtimeApp } = await appWith(runAgent);

  const model = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ model: 7 }),
  });
  const prompt = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ prompt: { text: "hi" } }),
  });

  expect([model.status, prompt.status]).toEqual([400, 400]);
  expect(runAgent).not.toHaveBeenCalled();
});

test("the agent snapshot carries stored sector exposure, never the entity allocation", async () => {
  const runAgent = vi.fn(async () => "ok");
  const { runtimeApp } = await appWith(runAgent);

  await post(runtimeApp);

  expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ sectors: expect.any(Array) }));
});

test("the portfolio agent registry exposes investor personas", async () => {
  const { runtimeApp } = await appWith(vi.fn(async () => "unused"));

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    agents: expect.arrayContaining([
      expect.objectContaining({ id: "warren_buffett", displayName: "Warren Buffett" }),
      expect.objectContaining({ id: "charlie_munger", displayName: "Charlie Munger" }),
      expect.objectContaining({ id: "bill_ackman", displayName: "Bill Ackman" }),
    ]),
  });
});
