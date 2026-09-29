import { createAgentUIStreamResponse, ToolLoopAgent, type LanguageModel, type UIMessage } from "ai";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { FundamentalsProvider } from "@lavega/core";
import type { MarketDataConsentStore } from "./marketDataConsent.js";
import { resolvePortfolioChatModel } from "./portfolioChat.js";
import type { SystemOneProvider } from "./systemOne.js";
import {
  assertResearchSigningConfigured,
  isStockResearchAgentId,
  normalizeResearchSymbol,
  runStockResearch,
  signResearchReport,
  stockResearchChatInstructions,
  verifyResearchReport,
} from "./stockResearch.js";

export type StockResearchRouteDependencies = {
  resolveTenantId: () => string | Promise<string>;
  consent: MarketDataConsentStore;
  fundamentals: FundamentalsProvider;
  chatModel?: LanguageModel;
  judge?: SystemOneProvider;
  tokenSecret?: string;
  now?: () => number;
};
function validatedMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40)
    throw new Error("Conversation requires 1–40 messages");
  if (JSON.stringify(value).length > 30_000)
    throw new Error("Conversation exceeds 30,000 character limit");
  const messages = value.map((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      (item.role !== "user" && item.role !== "assistant") ||
      !Array.isArray(item.parts) ||
      item.parts.length === 0 ||
      !item.parts.every(
        (part: { type?: unknown; text?: unknown }) =>
          part?.type === "text" && typeof part.text === "string",
      )
    )
      throw new Error("Conversation messages must contain text only");
    return {
      id: item.id,
      role: item.role,
      parts: item.parts.map((part: { text: string }) => ({ type: "text", text: part.text })),
    } as UIMessage;
  });
  const last = messages.at(-1)!;
  if (last.role !== "user" || !last.parts.some((part) => part.type === "text" && part.text.trim()))
    throw new Error("Conversation message is required");
  return messages;
}
export function attachStockResearchRoutes<T extends Hono>(
  app: T,
  deps: StockResearchRouteDependencies,
): T {
  app.use(
    "/api/agents/research/*",
    bodyLimit({
      maxSize: 256_000,
      onError: (c) => c.json({ problems: ["Research request exceeds size limit"] }, 413),
    }),
  );
  app.post("/api/agents/research/run", async (c) => {
    const parsed = await c.req.json().catch(() => ({}));
    const body = parsed && typeof parsed === "object" ? parsed : {};
    let symbol: string;
    try {
      symbol = normalizeResearchSymbol(body.symbol);
    } catch (error) {
      return c.json({ problems: [(error as Error).message] }, 400);
    }
    try {
      const tenantId = await deps.resolveTenantId();
      if (!(await deps.consent.get(tenantId)).accepted)
        return c.json(
          { problems: ["Allow Yahoo Finance market data before researching a stock"] },
          403,
        );
      assertResearchSigningConfigured(deps.tokenSecret);
      const company = await deps.fundamentals.fetch(symbol);
      if (!company)
        return c.json({ problems: ["No company financials found for this ticker"] }, 404);
      const report = await runStockResearch({
        company,
        tenantId,
        provider: deps.judge,
        now: deps.now?.(),
      });
      return c.json({
        report,
        reportToken: signResearchReport(report, tenantId, deps.tokenSecret),
      });
    } catch (error) {
      return c.json(
        { problems: [error instanceof Error ? error.message : "Stock research failed"] },
        502,
      );
    }
  });
  app.post("/api/agents/research/conversation", async (c) => {
    const parsed = await c.req.json().catch(() => ({}));
    const body = parsed && typeof parsed === "object" ? parsed : {};
    if (!isStockResearchAgentId(body.agentId))
      return c.json({ problems: ["Unknown research lens"] }, 400);
    try {
      const tenantId = await deps.resolveTenantId();
      if (!(await deps.consent.get(tenantId)).accepted)
        return c.json(
          { problems: ["Allow Yahoo Finance market data before discussing a stock"] },
          403,
        );
      let report;
      let messages;
      try {
        report = verifyResearchReport(body.reportToken, tenantId, deps.tokenSecret, deps.now?.());
        messages = validatedMessages(body.messages);
      } catch (error) {
        return c.json(
          { problems: [error instanceof Error ? error.message : "Invalid research conversation"] },
          400,
        );
      }
      const agent = new ToolLoopAgent({
        model: deps.chatModel ?? resolvePortfolioChatModel(),
        instructions: stockResearchChatInstructions(report, body.agentId),
      });
      return await createAgentUIStreamResponse({
        agent,
        uiMessages: messages,
        abortSignal: c.req.raw.signal,
        onError: () => "The research lens could not answer. Try again.",
      });
    } catch (error) {
      return c.json(
        { problems: [error instanceof Error ? error.message : "Research conversation failed"] },
        502,
      );
    }
  });
  return app;
}
