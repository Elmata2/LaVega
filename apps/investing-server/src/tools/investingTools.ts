/*
 * The investing tool registry: ONE definition set, two surfaces (plan §3 WS5.1
 * and WS5.3, #285/#299).
 *
 * Sure source: `app/models/assistant/function/*` and `function_tool_caller.rb`
 * at pinned commit 562fe09. Two Sure patterns are copied and one is refused:
 *
 *   - COPY: one registry shared by the in-app chat and `/mcp`, with the
 *     description carrying the data semantics (units, direction, pagination,
 *     unknown rules) so an external agent answers correctly without a second
 *     prompt.
 *   - COPY: errors are result data with a hint, not a thrown exception that
 *     leaks SQL or a stack across the trust boundary.
 *   - REFUSE: Sure's single coarse `read_write` scope. These tools are all
 *     `scope: "read"`; write tools live behind a separate write token (WS5.4).
 *
 * The definitions are the single source for both surfaces: the in-app chat and
 * `/mcp` differ only in the `InvestingToolSource` they bind (in-process context
 * vs the investing app's own HTTP read routes). A tool added here is callable by
 * both, and there is no second inline definition to drift from it (WS5.3).
 */

import { Schema } from "effect";
import type { AgentToolDefinition, AgentToolJsonSchema } from "@lavega/core";

/** One tenant-bound HTTP read of the investing app's own API (the MCP source). */
export type InvestingToolRead = (path: string) => Promise<{ status: number; body: unknown }>;

/**
 * What a tool needs from the surface it runs on. Every method is already bound
 * to the caller's tenant by the surface: a handler can never name one, and no
 * tool argument or header can choose one.
 *
 * A method returns the read model's payload; it THROWS when the read failed, so
 * the shared safe-error boundary answers with `{error, hint}` instead of a
 * tool-specific shape.
 */
export type InvestingToolSource = {
  dashboard(): Promise<Record<string, unknown>>;
  trades(query: { symbol?: string; limit?: number }): Promise<unknown>;
  /** `found: false` payloads are data, not failures; a failed read throws. */
  price(symbol: string, date?: string): Promise<unknown>;
  fundamentals(symbol: string): Promise<unknown>;
  sectorExposure(): Promise<unknown>;
  agentMemory(): Promise<unknown>;
};

const SYMBOL = /^[A-Z0-9][A-Z0-9.\-^=]{0,19}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const TradesInput = Schema.Struct({
  symbol: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
});
const PriceInput = Schema.Struct({
  symbol: Schema.String,
  date: Schema.optional(Schema.String),
});
const FundamentalsInput = Schema.Struct({ symbol: Schema.String });
const RiskInput = Schema.Struct({ range: Schema.optional(Schema.Literals(["6M", "1Y", "All"])) });

const noArguments: AgentToolJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const symbolArgument = (description: string) => ({
  type: "string",
  description,
  pattern: SYMBOL.source,
});

const objectBody = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

const arrayBody = (body: unknown, key: string): unknown[] => {
  const value = objectBody(body)[key];
  return Array.isArray(value) ? value : [];
};

/** Effect Schema is the decoder for untrusted tool input; excess properties are stripped. */
const decodeTrades = Schema.decodeUnknownSync(TradesInput);
const decodePrice = Schema.decodeUnknownSync(PriceInput);
const decodeFundamentals = Schema.decodeUnknownSync(FundamentalsInput);
const decodeRisk = Schema.decodeUnknownSync(RiskInput);

/** A read the caller should have answered 200; anything else is a safe refusal. */
export class InvestingReadRefused extends Error {
  constructor(readonly problem: string) {
    super(problem);
  }
}

const normalizeSymbol = (raw: string): string | null => {
  const value = raw.trim().toUpperCase();
  return SYMBOL.test(value) ? value : null;
};

/** Projects one dashboard holding into the shape an agent reasons over. */
const projectPosition = (position: Record<string, unknown>) => {
  const returns = objectBody(position.returns);
  return {
    symbol: position.symbol,
    name: position.description ?? null,
    quantity: position.quantity,
    currency: position.currency,
    marketValue: position.marketValue,
    weight: position.portfolioWeight,
    priceStatus: position.priceStatus,
    costBasis: returns.remainingCostBasis ?? null,
    unrealizedGain: returns.unrealizedGain ?? null,
    realizedGain: returns.realizedGain ?? null,
    dividendsReceived: returns.dividendsReceived ?? null,
    totalReturn: returns.totalReturn ?? null,
    totalReturnPercentage: returns.totalReturnPercentage ?? null,
    firstBuyDate: returns.firstBuyDate ?? null,
  };
};

/** One tool's name, description, schema and handler. `createInvestingTools`
 *  binds the handler to a source; the definition itself is shared. */
type InvestingToolSpec = Omit<AgentToolDefinition, "handler"> & {
  handler: (source: InvestingToolSource, input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * The single definition set. Descriptions are the contract `tools/list`
 * publishes and docs/investing/MCP.md is generated from, so they live here and
 * nowhere else.
 */
export const INVESTING_TOOL_SPECS: readonly InvestingToolSpec[] = [
  {
    name: "get_positions",
    description:
      "Every open investing holding: symbol, name, quantity, market value, portfolio weight, cost basis, returns and first buy date. Money is a decimal amount in the portfolio's presentation currency (1234.56 means 1234.56, not cents); weights and percentages are fractions (0.12 means 12%). A field the read model does not know is null, never zero. One row per current holding; there is no pagination. Empty array means the broker has no holdings, which can be a sync that has not landed yet.",
    schema: noArguments,
    scope: "read",
    handler: async (source) => {
      const dashboard = await source.dashboard();
      return {
        presentationCurrency: dashboard.presentationCurrency ?? null,
        dataVersion: dashboard.dataVersion ?? null,
        positions: arrayBody(dashboard, "positions").map((position) =>
          projectPosition(objectBody(position)),
        ),
      };
    },
  },
  {
    name: "get_portfolio_value",
    description:
      "The latest total investing portfolio value: the last point of the 'All' value series, with its date. Money is a decimal amount in the presentation currency (ADR 0011: an unknown value is null, never 0). No series (a brand-new portfolio) returns value null and problems instead of a fabricated zero.",
    schema: noArguments,
    scope: "read",
    handler: async (source) => {
      const dashboard = await source.dashboard();
      const portfolio = objectBody(dashboard.portfolio);
      const all = Array.isArray(portfolio.All) ? portfolio.All : [];
      const latest = objectBody(all.at(-1));
      if (!latest.date)
        return {
          value: null,
          currency: dashboard.presentationCurrency ?? null,
          problems: ["No portfolio valuation yet"],
        };
      return {
        date: latest.date,
        value: latest.value ?? null,
        currency: dashboard.presentationCurrency ?? null,
      };
    },
  },
  {
    name: "get_trades",
    description:
      "The owner's executed trades, newest first, at most 60 rows per call (the read route caps it and says so in `truncated`). Optional symbol filters to one ticker. `side` is buy or sell; `quantity` and `price` are per-unit decimals in the trade's own currency. `executionAt` may be absent on older broker rows.",
    schema: {
      type: "object",
      properties: {
        symbol: symbolArgument("Optional ticker; omit for every symbol."),
        limit: {
          type: "number",
          description: "1-60, newest first; default 60.",
          minimum: 1,
          maximum: 60,
        },
      },
      additionalProperties: false,
    },
    scope: "read",
    handler: async (source, input) => {
      const { symbol, limit } = decodeTrades(input);
      let normalized: string | undefined;
      if (symbol !== undefined) {
        const value = normalizeSymbol(symbol);
        if (!value) return { problems: [`${symbol} is not a ticker`], trades: [] };
        normalized = value;
      }
      return source.trades({
        ...(normalized !== undefined ? { symbol: normalized } : {}),
        ...(limit !== undefined ? { limit: Math.min(60, Math.max(1, limit)) } : {}),
      });
    },
  },
  {
    name: "get_price",
    description:
      "One closing price for a ticker: the latest close, or the last close on or before `date` (YYYY-MM-DD). `close` is a decimal amount in `currency`. A symbol with no stored bar returns found:false and a problem, never a guessed or forward-zero price.",
    schema: {
      type: "object",
      properties: {
        symbol: symbolArgument("Ticker, for example AAPL."),
        date: { type: "string", description: "YYYY-MM-DD; omit for the latest close." },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
    scope: "read",
    handler: async (source, input) => {
      const { symbol, date } = decodePrice(input);
      const normalized = normalizeSymbol(symbol);
      if (!normalized) return { problems: [`${symbol} is not a ticker`] };
      if (date !== undefined && !DATE.test(date)) return { problems: ["date must be YYYY-MM-DD"] };
      return source.price(normalized, date);
    },
  },
  {
    name: "get_fundamentals",
    description:
      "Company fundamentals for one ticker as a compact brief: valuation, margins, returns, balance sheet, statement history, quarters and analyst estimates. Consent-gated: when the owner has not accepted Yahoo Finance market-data use, the result carries consentRequired:true and a problem instead of data. A fund or an unknown symbol returns brief:null with a problem.",
    schema: {
      type: "object",
      properties: {
        symbol: symbolArgument("Ticker, for example AAPL."),
      },
      required: ["symbol"],
      additionalProperties: false,
    },
    scope: "read",
    handler: async (source, input) => {
      const { symbol } = decodeFundamentals(input);
      const normalized = normalizeSymbol(symbol);
      if (!normalized) return { problems: [`${symbol} is not a ticker`] };
      return source.fundamentals(normalized);
    },
  },
  {
    name: "get_sector_exposure",
    description:
      "Portfolio weight by sector, with funds looked through to their holdings. `coverage` says how much of the portfolio the sectors explain; a symbol the taxonomy does not know is counted as Unknown rather than dropped. Weights are fractions (0.12 means 12%).",
    schema: noArguments,
    scope: "read",
    handler: async (source) => source.sectorExposure(),
  },
  {
    name: "get_risk",
    description:
      "Historical risk of the portfolio against its default benchmark over one range: volatility, beta, alpha, max drawdown, observation days and coverage. `range` is 6M, 1Y (default) or All. A nullable metric is null when the coverage does not support it (ADR 0011), never 0.",
    schema: {
      type: "object",
      properties: {
        range: {
          type: "string",
          enum: ["6M", "1Y", "All"],
          description: "Observation window; default 1Y.",
        },
      },
      additionalProperties: false,
    },
    scope: "read",
    handler: async (source, input) => {
      const { range } = decodeRisk(input);
      const dashboard = await source.dashboard();
      const risk = objectBody(dashboard.risk);
      const byBenchmark = objectBody(risk.byBenchmark);
      const benchmark = typeof risk.defaultBenchmark === "string" ? risk.defaultBenchmark : "";
      const report = objectBody(objectBody(byBenchmark[benchmark])[range ?? "1Y"]);
      const riskReport = report.risk;
      if (!riskReport)
        return {
          range: range ?? "1Y",
          benchmark: benchmark || null,
          risk: null,
          problems: ["Risk is unavailable for this benchmark and range"],
        };
      return { range: range ?? "1Y", benchmark, risk: riskReport };
    },
  },
  {
    name: "get_agent_memory",
    description:
      "The owner's stored investing agent memory: risk tolerance, per-symbol theses (why they own it, what would make them wrong) and goals. Read-only; there are no write tools in this seed. Without a database the result carries available:false and a problem rather than an empty memory.",
    schema: noArguments,
    scope: "read",
    handler: async (source) => source.agentMemory(),
  },
];

/** Bind the shared definitions to one surface's data source. This is the ONLY
 *  difference between the in-app chat and `/mcp`: the definitions do not fork. */
export function createInvestingTools(source: InvestingToolSource): AgentToolDefinition[] {
  return INVESTING_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    scope: spec.scope,
    ...(spec.preview !== undefined ? { preview: spec.preview } : {}),
    handler: (input) => spec.handler(source, input),
  }));
}

/** A source over the investing app's own HTTP read routes (the MCP surface). */
export function createInvestingReadTools(read: InvestingToolRead): AgentToolDefinition[] {
  const requireOk = async (path: string): Promise<Record<string, unknown>> => {
    const { status, body } = await read(path);
    if (status !== 200)
      throw new InvestingReadRefused("The investing data could not be read right now");
    return objectBody(body);
  };
  const source: InvestingToolSource = {
    dashboard: () => requireOk("/api/investing/dashboard"),
    trades: async ({ symbol, limit }) => {
      const query = new URLSearchParams();
      if (symbol !== undefined) query.set("symbol", symbol);
      if (limit !== undefined) query.set("limit", String(limit));
      return requireOk(`/api/investing/trades${query.size > 0 ? `?${query}` : ""}`);
    },
    price: async (symbol, date) => {
      const query = date === undefined ? "" : `?date=${encodeURIComponent(date)}`;
      const { status, body } = await read(`/api/investing/prices/${symbol}${query}`);
      if (status === 404)
        return { symbol, found: false, problems: [`No stored price for ${symbol}`] };
      if (status !== 200)
        return { symbol, found: false, problems: ["Prices could not be read right now"] };
      return { found: true, ...objectBody(body) };
    },
    fundamentals: async (symbol) => {
      const { status, body } = await read(`/api/investing/fundamentals/${symbol}`);
      const payload = objectBody(body);
      if (status === 200) return payload;
      if (status === 428)
        return { consentRequired: true, problems: ["Yahoo Finance consent required"] };
      return {
        ...payload,
        problems: payload.problems ?? ["Fundamentals are unavailable right now"],
      };
    },
    sectorExposure: () => requireOk("/api/investing/sectors"),
    agentMemory: async () => {
      const { status, body } = await read("/api/memory");
      if (status === 200) return { available: true, ...objectBody(body) };
      return {
        available: false,
        riskTolerance: null,
        theses: [],
        goals: [],
        problems: ["Agent memory needs a database"],
      };
    },
  };
  return createInvestingTools(source);
}
