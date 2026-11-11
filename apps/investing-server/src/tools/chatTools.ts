/*
 * The in-app chat's binding of the ONE investing tool registry (plan §3 WS5.3,
 * #299), plus the memory tools that only the chat may use.
 *
 * Sure source: `app/models/assistant/function_tool_caller.rb` at pinned commit
 * 562fe09. Sure builds the same function set for the chat and the MCP surface
 * and filters per caller; this file is LaVega's chat projection: it supplies an
 * in-process `InvestingToolSource` instead of the HTTP one `/mcp` uses, so the
 * tool definitions in `investingTools.ts` are not duplicated here.
 *
 * Every tool result crosses the same boundary the MCP surface uses:
 * `capAgentToolResult` truncates an oversized payload, and any thrown error
 * becomes safe `{error, hint}` data instead of an exception the model cannot
 * read (WS5.6).
 */

import { jsonSchema, tool, type ToolSet } from "ai";
import { capAgentToolResult, safeAgentToolError, type AgentToolDefinition } from "@lavega/core";
import { isRiskTolerance, RISK_TOLERANCES, type RiskTolerance } from "@lavega/database";
import { renderFundamentalsBrief, type FundamentalsProvider } from "@lavega/core";
import type { InvestingToolSource } from "./investingTools.js";
import type { PortfolioChatContext } from "../portfolioChat.js";
import type { ThreadMemory } from "../chatMemory.js";

const PREFETCH_TIMEOUT_MS = 5_000;
const CHAT_MAX_TRADES = 60;

async function fundamentalsSection(provider: FundamentalsProvider, symbol: string) {
  try {
    const fundamentals = await Promise.race([
      provider.fetch(symbol),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), PREFETCH_TIMEOUT_MS).unref?.(),
      ),
    ]);
    return fundamentals
      ? renderFundamentalsBrief(fundamentals)
      : `${symbol}: no company fundamentals (a fund, or a symbol the provider does not know).`;
  } catch {
    return `${symbol}: fundamentals unavailable right now.`;
  }
}

/** The in-process data source for the chat surface. Every method is bound to the
 *  caller's tenant by the runtime that built the context. */
export function createChatInvestingSource(
  context: PortfolioChatContext,
  memory?: ThreadMemory,
): InvestingToolSource {
  return {
    dashboard: async () => context.dashboard as unknown as Record<string, unknown>,
    trades: async ({ symbol, limit }) => {
      const cap = Math.min(CHAT_MAX_TRADES, limit ?? CHAT_MAX_TRADES);
      return context
        .trades()
        .filter((trade) => !symbol || trade.symbol.toUpperCase() === symbol.trim().toUpperCase())
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, cap)
        .map(({ date, symbol: tradeSymbol, side, quantity, price, currency }) => ({
          date,
          symbol: tradeSymbol,
          side,
          quantity,
          price,
          currency,
        }));
    },
    price: async (symbol, date) => {
      const bar = await context.price(symbol, date);
      return bar
        ? { found: true, ...bar }
        : { symbol, found: false, problems: [`No stored price for ${symbol}`] };
    },
    fundamentals: async (symbol) => fundamentalsSection(context.fundamentals, symbol),
    sectorExposure: async () => context.sectors ?? "Sector exposure is unavailable.",
    agentMemory: async () => {
      if (!memory)
        return {
          available: false,
          riskTolerance: null,
          theses: [],
          goals: [],
          problems: ["Agent memory needs a database"],
        };
      const [riskTolerance, theses, goals] = await Promise.all([
        memory.repository.getRiskTolerance(),
        memory.repository.listTheses(),
        memory.repository.listGoals(),
      ]);
      return { available: true, riskTolerance, theses, goals };
    },
  };
}

const optionalText = { type: "string" as const };

const symbolOrNull = (symbol: string | undefined) => symbol?.trim().toUpperCase() || null;

/** Memory tool definitions. These are chat-only (they write owner-confirmed
 *  memory, not investing data), so they live beside the chat projection rather
 *  than in the shared read registry. Definitions are data, like the read ones. */
export function createMemoryToolDefinitions(
  memory: ThreadMemory,
  held: ReadonlySet<string>,
): AgentToolDefinition[] {
  const { repository, agentId, threadId } = memory;
  const RECALL_LIMIT = 20;
  return [
    {
      name: "recall_memory",
      description:
        "Read saved memory. theses: the owner's current theses. goals: their goals. observations: what you noted in earlier conversations. threads: titles and dates of your earlier conversations with them. Filter by symbol, and for observations and threads by a start date.",
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["theses", "goals", "observations", "threads"] },
          symbol: optionalText,
          since: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      scope: "read",
      handler: async (input) => {
        const kind = typeof input.kind === "string" ? input.kind : "";
        const symbol = typeof input.symbol === "string" ? input.symbol : undefined;
        const since = typeof input.since === "string" ? input.since : undefined;
        const filter = { symbol: symbolOrNull(symbol) ?? undefined };
        const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : undefined;
        return repository.recall(
          kind === "observations"
            ? { kind, agentId, ...filter, since: from }
            : kind === "threads"
              ? { kind, agentId, since: from }
              : { kind: kind === "goals" ? "goals" : "theses", ...filter },
          RECALL_LIMIT,
        );
      },
    },
    {
      name: "save_thesis",
      description:
        "Save the owner's thesis for a holding, after they confirmed it. Replaces the previous thesis for that symbol and makes it current.",
      schema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          why: { type: "string", description: "Why they own it." },
          worth: { type: "string", description: "What they think it is worth." },
          entry: { type: "string", description: "Why they bought when they did." },
          wrong_if: { type: "string", description: "What would prove them wrong." },
        },
        required: ["symbol", "why"],
        additionalProperties: false,
      },
      scope: "write",
      handler: async (input) => {
        const symbol = typeof input.symbol === "string" ? input.symbol : "";
        const key = symbolOrNull(symbol);
        if (!key || !held.has(key)) return `Not saved: the owner does not hold ${symbol}.`;
        const why = typeof input.why === "string" ? input.why.trim() : "";
        if (!why) return "Not saved: a thesis needs the reason they own it.";
        const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
        const thesis = await repository.confirmThesis(key, {
          why,
          worth: text(input.worth) || null,
          entry: text(input.entry) || null,
          wrongIf: text(input.wrong_if) || null,
        });
        return { saved: "thesis", symbol: thesis.symbol };
      },
    },
    {
      name: "save_goal",
      description:
        "Save a goal the owner confirmed: a target outcome for the whole portfolio, or for one holding when symbol is given.",
      schema: {
        type: "object",
        properties: { text: { type: "string" }, symbol: optionalText },
        required: ["text"],
        additionalProperties: false,
      },
      scope: "write",
      handler: async (input) => {
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text) return "Not saved: the goal is empty.";
        const symbol = typeof input.symbol === "string" ? input.symbol : undefined;
        const goal = await repository.confirmGoal({
          symbol: symbolOrNull(symbol),
          text,
          sourceThreadId: threadId,
        });
        return { saved: "goal", id: goal.id };
      },
    },
    {
      name: "note_observation",
      description:
        "Note something the owner said that is worth bringing up later. Belongs to this conversation and is deleted with it.",
      schema: {
        type: "object",
        properties: { text: { type: "string" }, symbol: optionalText },
        required: ["text"],
        additionalProperties: false,
      },
      scope: "write",
      handler: async (input) => {
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text) return "Not noted: the observation is empty.";
        const symbol = typeof input.symbol === "string" ? input.symbol : undefined;
        await repository.addObservation({
          agentId,
          threadId,
          symbol: symbolOrNull(symbol),
          text,
        });
        return { noted: true };
      },
    },
    {
      name: "set_risk_tolerance",
      description: "Save the owner's risk tolerance after they told you what it is.",
      schema: {
        type: "object",
        properties: { level: { type: "string", enum: [...RISK_TOLERANCES] } },
        required: ["level"],
        additionalProperties: false,
      },
      scope: "write",
      handler: async (input) => {
        const level = input.level;
        if (!isRiskTolerance(level)) return "Not saved: use conservative, balanced or aggressive.";
        await repository.setRiskTolerance(level as RiskTolerance);
        return { saved: "risk tolerance", level };
      },
    },
  ];
}

/** One payload that says it was cut, so the model knows the list is partial. */
function cappedChatValue(value: unknown): unknown {
  const capped = capAgentToolResult(value);
  if (!capped.truncated) return capped.value;
  if (typeof capped.value === "object" && capped.value !== null && !Array.isArray(capped.value))
    return { ...(capped.value as Record<string, unknown>), truncated: true };
  return {
    value: capped.value,
    truncated: true,
    totalRows: capped.totalRows,
    keptRows: capped.keptRows,
  };
}

/** Convert registry definitions into the AI SDK tool set the chat agent calls.
 *  This is the single adapter: caps and the safe-error boundary are applied
 *  here for every tool, so no definition can bypass them. */
export function toAiSdkTools(definitions: readonly AgentToolDefinition[]): ToolSet {
  const tools: ToolSet = {};
  for (const definition of definitions) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(
        definition.schema as unknown as Parameters<typeof jsonSchema>[0],
      ),
      execute: async (input: Record<string, unknown>) => {
        try {
          return cappedChatValue(await definition.handler(input));
        } catch (error) {
          return safeAgentToolError(error);
        }
      },
    });
  }
  return tools;
}
