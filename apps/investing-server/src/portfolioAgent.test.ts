import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createInMemoryPriceStore } from "@lavega/adapters";
import type { InvestingDashboardData, Position, PriceBar, Trade } from "@lavega/core";
import {
  createPortfolioAgentTools,
  getPortfolioAgent,
  listPortfolioAgents,
  portfolioSnapshotHash,
  renderPortfolioSnapshot,
  resolveAgentConfig,
} from "./portfolioAgent.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const position: Position = {
  entity: "personal",
  symbol: "AAPL",
  quantity: 2,
  averagePrice: 10,
  marketPrice: null,
  marketValue: null,
  currency: "EUR",
  asOf: "2026-08-19",
};
const trade: Trade = {
  id: "t1",
  entity: "personal",
  date: "2026-08-10",
  symbol: "AAPL",
  side: "buy",
  quantity: 2,
  price: 10,
  amount: 20,
  currency: "EUR",
  commission: 0,
};
const bars: PriceBar[] = [
  { symbol: "AAPL", date: "2026-08-18", close: 14, currency: "EUR" },
  { symbol: "AAPL", date: "2026-08-19", close: 15, currency: "EUR" },
];

async function tools() {
  const priceStore = createInMemoryPriceStore();
  await priceStore.upsert("local", bars);
  return createPortfolioAgentTools({
    readBrokerData: () => ({
      positions: [position],
      trades: [trade],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
    }),
    priceStore,
  });
}

const executeOptions = () => ({ toolCallId: `call-${Math.random()}`, messages: [] }) as never;

test("get_positions returns the restored broker positions", async () => {
  expect(await (await tools()).get_positions.execute!({}, executeOptions())).toEqual([position]);
});

test("get_price returns the latest close and honours an as-of date", async () => {
  const agentTools = await tools();
  expect(await agentTools.get_price.execute!({ symbol: "aapl" }, executeOptions())).toEqual({
    symbol: "AAPL",
    date: "2026-08-19",
    close: 15,
    currency: "EUR",
  });
  expect(
    await agentTools.get_price.execute!({ symbol: "AAPL", date: "2026-08-18" }, executeOptions()),
  ).toMatchObject({ date: "2026-08-18", close: 14 });
  expect(await agentTools.get_price.execute!({ symbol: "MSFT" }, executeOptions())).toBeNull();
});

test("compute_portfolio_value delegates to the core portfolio calculation", async () => {
  expect(
    await (
      await tools()
    ).compute_portfolio_value.execute!({}, executeOptions()),
  ).toMatchObject({ date: "2026-08-19", value: 30 });
});

test("runPortfolioAgent refuses to start without an API key", async () => {
  const { runPortfolioAgent } = await import("./portfolioAgent.js");
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  expect(() => resolveAgentConfig()).toThrow(
    "LAVEGA_AGENT_API_KEY or OPENROUTER_API_KEY is not set",
  );
  await expect(runPortfolioAgent({ prompt: "hello" })).rejects.toThrow("LAVEGA_AGENT_API_KEY");
});

test("portfolio agent accepts the standard OpenRouter API key variable", () => {
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-test-key");
  expect(resolveAgentConfig()).toMatchObject({ apiKey: "openrouter-test-key" });
});

test("portfolio agent defaults to the configured free OpenRouter model", () => {
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "test-key");
  vi.stubEnv("LAVEGA_AGENT_MODEL", "");
  expect(resolveAgentConfig()).toMatchObject({
    baseURL: "https://openrouter.ai/api/v1",
    modelId: "inclusionai/ling-3.0-flash-fin:free",
  });
});

test("portfolio agent registry exposes distinct investor personas", () => {
  expect(listPortfolioAgents().map((agent) => agent.id)).toEqual([
    "warren_buffett",
    "charlie_munger",
    "bill_ackman",
    "ben_graham",
    "peter_lynch",
    "stanley_druckenmiller",
  ]);
  expect(getPortfolioAgent("bill_ackman").systemPrompt).toContain("activist investor lens");
  expect(getPortfolioAgent("unknown").id).toBe("warren_buffett");
});

test("compute_portfolio_value bounds price-store concurrency", async () => {
  let inflight = 0;
  let peak = 0;
  const priceStore = createInMemoryPriceStore();
  const symbols = Array.from({ length: 10 }, (_, index) => `SYM${index}`);
  await priceStore.upsert(
    "local",
    symbols.map((symbol) => ({ symbol, date: "2026-08-19", close: 1, currency: "EUR" })),
  );
  const instrumented = {
    ...priceStore,
    getRange: (async (...args: Parameters<typeof priceStore.getRange>) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await priceStore.getRange(...args);
      } finally {
        inflight -= 1;
      }
    }) as typeof priceStore.getRange,
  };
  const agentTools = createPortfolioAgentTools({
    readBrokerData: () => ({
      positions: symbols.map((symbol) => ({ ...position, symbol })),
      trades: [],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
    }),
    priceStore: instrumented,
  });
  await agentTools.compute_portfolio_value.execute!({}, executeOptions());
  expect(peak).toBeLessThanOrEqual(3);
});

function buildSnapshotDashboard(): InvestingDashboardData {
  return {
    dataVersion: 3,
    presentationCurrency: "EUR",
    portfolio: {
      "1M": [],
      "6M": [],
      "1Y": [],
      YTD: [],
      All: [
        {
          date: "2026-08-19",
          positionsValue: 30,
          cashValue: 0,
          value: 30,
          unpriced: [],
          forwardFilled: [],
          cashUnknown: [],
        },
      ],
    },
    benchmarks: [],
    externalCashFlows: [],
    allocation: {
      instrument: {
        buckets: [{ key: "AAPL", label: "AAPL", value: 30, unpriced: false }],
        unpriced: [],
      },
      entity: { buckets: [], unpriced: [] },
    },
    positions: [
      {
        symbol: "AAPL",
        entity: "personal",
        quantity: 2,
        currency: "EUR",
        asOf: "2026-08-19",
        marketValue: 30,
        portfolioWeight: 1,
        priceStatus: "priced",
        returns: {
          status: "broker-unrealized",
          remainingCostBasis: 20,
          realizedCostBasisRemoved: null,
          unrealizedGain: 10,
          realizedGain: null,
          dividendsReceived: 0,
          totalReturn: null,
          totalReturnPercentage: null,
          sinceFirstBuyPercentage: null,
          firstBuyDate: "2026-08-10",
        },
      },
    ],
    position: null,
    problems: [],
  };
}

test("portfolio snapshot renders user position facts for LLM input", () => {
  const dashboard = buildSnapshotDashboard();

  expect(JSON.parse(renderPortfolioSnapshot(dashboard))).toMatchObject({
    dataVersion: 3,
    totalPricedValue: 30,
    topPositions: [{ symbol: "AAPL", weight: 1, totalReturnPercentage: 0.5 }],
  });
});

test("the snapshot names entity allocation as entities and never as sectors", () => {
  const dashboard = buildSnapshotDashboard();
  dashboard.allocation.entity.buckets = [
    { key: "private", label: "private", value: 20, unpriced: false },
    { key: "business", label: "business", value: 10, unpriced: false },
  ];

  const snapshot = JSON.parse(renderPortfolioSnapshot(dashboard)) as Record<string, unknown>;

  expect(snapshot.entityAllocation).toEqual(dashboard.allocation.entity.buckets);
  expect(JSON.stringify(snapshot.sectors)).not.toContain("private");
});

test("the snapshot marks sectors unavailable when no sector profile is resolved", () => {
  expect(JSON.parse(renderPortfolioSnapshot(buildSnapshotDashboard()))).toMatchObject({
    sectors: "unavailable",
  });
  expect(JSON.parse(renderPortfolioSnapshot(buildSnapshotDashboard(), []))).toMatchObject({
    sectors: "unavailable",
  });
});

test("the snapshot carries resolved sector exposure when the sector module supplies it", () => {
  const sectors = [
    { sector: "Technology", weight: 0.75 },
    { sector: "Unknown", weight: 0.25 },
  ];

  expect(JSON.parse(renderPortfolioSnapshot(buildSnapshotDashboard(), sectors))).toMatchObject({
    sectors,
  });
});

test("the snapshot hash follows the resolved sectors", async () => {
  const dashboard = buildSnapshotDashboard();

  expect(await portfolioSnapshotHash(dashboard, [{ sector: "Technology", weight: 1 }])).not.toBe(
    await portfolioSnapshotHash(dashboard),
  );
});

/** Answers the OpenAI-compatible chat endpoint from memory, so these tests
 *  inspect the request body without ever reaching OpenRouter. */
function fakeProvider(content: string) {
  const fetchMock = vi.fn(
    async (_input: unknown, _init: { body?: unknown }) =>
      new Response(
        JSON.stringify({
          id: "fake",
          object: "chat.completion",
          created: 0,
          model: "fake",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "test-key");
  vi.stubEnv("LAVEGA_AGENT_TIMEOUT_MS", "");
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    requestBody: () =>
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        model: string;
        messages: { role: string; content: string }[];
      },
  };
}

const validResponse = JSON.stringify({
  signal: "bullish",
  confidence: 72,
  summary: "Concentrated in one quality name.",
  reasoning: "One position carries the whole portfolio. Cost basis is known.",
  insights: ["AAPL is the entire portfolio", ""],
});

test("a valid provider response keeps the configured model, persona and portfolio values", async () => {
  const { runPortfolioAgent } = await import("./portfolioAgent.js");
  const provider = fakeProvider(validResponse);

  const insight = await runPortfolioAgent({
    agentId: "bill_ackman",
    model: "openai/gpt-5-mini",
    dashboard: buildSnapshotDashboard(),
    sectors: [{ sector: "Technology", weight: 1 }],
  });

  expect(insight).toMatchObject({
    agentId: "bill_ackman",
    displayName: "Bill Ackman",
    signal: "bullish",
    confidence: 72,
    summary: "Concentrated in one quality name.",
    insights: ["AAPL is the entire portfolio"],
    model: "openai/gpt-5-mini",
  });
  expect(insight.snapshotHash).toMatch(/^[0-9a-f]{24}$/);

  const body = provider.requestBody();
  expect(body.model).toBe("openai/gpt-5-mini");
  const messages = JSON.stringify(body.messages);
  expect(messages).toContain("activist investor lens");
  expect(messages).toContain("Technology");
  expect(messages).toContain("totalPricedValue");
  expect(messages).toContain("30");
});

const unusableResponses: [string, string][] = [
  ["an empty object", "{}"],
  [
    "an invalid signal",
    JSON.stringify({ signal: "up", confidence: 50, summary: "s", reasoning: "r", insights: [] }),
  ],
  [
    "an out-of-range confidence",
    JSON.stringify({
      signal: "neutral",
      confidence: 140,
      summary: "s",
      reasoning: "r",
      insights: [],
    }),
  ],
  [
    "a non-numeric confidence",
    JSON.stringify({
      signal: "neutral",
      confidence: "high",
      summary: "s",
      reasoning: "r",
      insights: [],
    }),
  ],
  [
    "an object-valued summary",
    JSON.stringify({
      signal: "neutral",
      confidence: 10,
      summary: { a: 1 },
      reasoning: "r",
      insights: [],
    }),
  ],
  [
    "an empty summary",
    JSON.stringify({
      signal: "neutral",
      confidence: 10,
      summary: "",
      reasoning: "r",
      insights: [],
    }),
  ],
  [
    "non-string insights",
    JSON.stringify({
      signal: "neutral",
      confidence: 10,
      summary: "s",
      reasoning: "r",
      insights: [{ a: 1 }],
    }),
  ],
  [
    "insights that are not an array",
    JSON.stringify({
      signal: "neutral",
      confidence: 10,
      summary: "s",
      reasoning: "r",
      insights: "one",
    }),
  ],
];

test.each(unusableResponses)(
  "a model response with %s fails the run instead of becoming an insight",
  async (_label, content) => {
    const { runPortfolioAgent } = await import("./portfolioAgent.js");
    fakeProvider(content);

    await expect(runPortfolioAgent({ dashboard: buildSnapshotDashboard() })).rejects.toThrow(
      "Portfolio agent returned an unusable response",
    );
  },
);

test("a never-answering provider is aborted on the deadline and no further round starts", async () => {
  const { runPortfolioAgent } = await import("./portfolioAgent.js");
  const fetchMock = vi.fn(
    (_input: unknown, init: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  );
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "test-key");
  vi.stubEnv("LAVEGA_AGENT_TIMEOUT_MS", "40");
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    runPortfolioAgent({ dashboard: buildSnapshotDashboard(), tools: await tools() }),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("the agent deadline defaults to sixty seconds and ignores nonsense overrides", async () => {
  const { resolveAgentTimeoutMs, DEFAULT_PORTFOLIO_AGENT_TIMEOUT_MS } =
    await import("./portfolioAgent.js");
  vi.stubEnv("LAVEGA_AGENT_TIMEOUT_MS", "");
  expect(DEFAULT_PORTFOLIO_AGENT_TIMEOUT_MS).toBe(60_000);
  expect(resolveAgentTimeoutMs()).toBe(DEFAULT_PORTFOLIO_AGENT_TIMEOUT_MS);
  vi.stubEnv("LAVEGA_AGENT_TIMEOUT_MS", "not-a-number");
  expect(resolveAgentTimeoutMs()).toBe(DEFAULT_PORTFOLIO_AGENT_TIMEOUT_MS);
  vi.stubEnv("LAVEGA_AGENT_TIMEOUT_MS", "1500");
  expect(resolveAgentTimeoutMs()).toBe(1500);
});

test("snapshot hash keeps the prior digest and follows the snapshot input", async () => {
  const dashboard = buildSnapshotDashboard();
  const hash = await portfolioSnapshotHash(dashboard);

  expect(hash).toMatch(/^[0-9a-f]{24}$/);
  expect(await portfolioSnapshotHash(dashboard)).toBe(hash);
  expect(hash).toBe(
    createHash("sha256").update(renderPortfolioSnapshot(dashboard)).digest("hex").slice(0, 24),
  );

  const changed = buildSnapshotDashboard();
  changed.positions[0]!.marketValue = 31;
  expect(await portfolioSnapshotHash(changed)).not.toBe(hash);
});
