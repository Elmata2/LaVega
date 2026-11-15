import { expect, test, vi } from "vitest";
import { emptyInvestingDashboard, type FundamentalsProvider } from "@lavega/core";
import { createInvestingReadTools, createInvestingTools } from "./investingTools.js";
import { createChatInvestingSource, toAiSdkTools } from "./chatTools.js";
import type { PortfolioChatContext } from "../portfolioChat.js";

/* WS5.3 acceptance (#299): the chat and `/mcp` read the SAME tool definitions —
 * the surface binds a different data source, it does not define its own tools. */

const context = (): PortfolioChatContext => ({
  dashboard: emptyInvestingDashboard(),
  sectors: null,
  trades: () => [],
  price: async () => null,
  fundamentals: { fetch: async () => null } as unknown as FundamentalsProvider,
});

test("the chat registry is the same definitions as the MCP registry", () => {
  const chat = createInvestingTools(createChatInvestingSource(context()));
  const mcp = createInvestingReadTools(async () => ({ status: 200, body: {} }));
  expect(chat.map((tool) => [tool.name, tool.description, tool.scope, tool.schema])).toEqual(
    mcp.map((tool) => [tool.name, tool.description, tool.scope, tool.schema]),
  );
});

test("the AI SDK adapter caps a large tool payload and says it was cut", async () => {
  const tools = toAiSdkTools([
    {
      name: "get_many",
      description: "many rows",
      schema: { type: "object", properties: {}, additionalProperties: false },
      scope: "read",
      handler: async () => ({ rows: Array.from({ length: 300 }, (_, index) => ({ index })) }),
    },
  ]);
  const result = (await tools.get_many!.execute!({}, {} as never)) as {
    rows: unknown[];
    truncated?: boolean;
  };
  expect(result.truncated).toBe(true);
  expect(result.rows).toHaveLength(200);
});

test("the AI SDK adapter turns a thrown tool error into safe data", async () => {
  const tools = toAiSdkTools([
    {
      name: "get_crash",
      description: "crashes",
      schema: { type: "object", properties: {}, additionalProperties: false },
      scope: "read",
      handler: async () => {
        throw new Error("postgres://secret: hunter2 SELECT * FROM investing.api_tokens");
      },
    },
  ]);
  const result = (await tools.get_crash!.execute!({}, {} as never)) as {
    error: string;
    hint: string;
  };
  expect(result).toEqual({
    error: "tool_failed",
    hint: expect.stringContaining("Retry once"),
  });
  expect(JSON.stringify(result)).not.toContain("hunter2");
});

test("the chat source reads the in-process context, not a second copy", async () => {
  const source = createChatInvestingSource({
    ...context(),
    dashboard: {
      ...emptyInvestingDashboard(),
      presentationCurrency: "EUR",
      positions: [
        {
          symbol: "AAPL",
          entity: "personal",
          quantity: 2,
          currency: "USD",
          marketValue: 100,
          portfolioWeight: 1,
          priceStatus: "priced",
          asOf: "2026-11-11",
          returns: {
            status: "available",
            remainingCostBasis: 90,
            realizedCostBasisRemoved: 0,
            unrealizedGain: 10,
            realizedGain: 0,
            dividendsReceived: 0,
            totalReturn: 10,
            totalReturnPercentage: 0.1,
            sinceFirstBuyPercentage: 0.1,
            firstBuyDate: "2026-01-02",
          },
        },
      ],
    },
  });
  const dashboard = await source.dashboard();
  expect((dashboard.positions as unknown[]).length).toBe(1);
  expect(await source.price("AAPL")).toMatchObject({ found: false });
  expect(await source.sectorExposure()).toBe("Sector exposure is unavailable.");
});

test("a chat memory write is refused for a symbol the owner does not hold", async () => {
  const repository = {
    confirmThesis: vi.fn(),
  };
  const memory = {
    repository: repository as never,
    agentId: "warren_buffett" as const,
    threadId: "00000000-0000-4000-8000-00000000000a",
  };
  const { createMemoryToolDefinitions } = await import("./chatTools.js");
  const saveThesis = createMemoryToolDefinitions(memory, new Set(["AAPL"])).find(
    (definition) => definition.name === "save_thesis",
  )!;
  expect(await saveThesis.handler({ symbol: "TSLA", why: "growth" })).toBe(
    "Not saved: the owner does not hold TSLA.",
  );
  expect(repository.confirmThesis).not.toHaveBeenCalled();
});
