/*
 * The read routes the external MCP tools need, served by the app that owns the
 * read models (plan §3 WS5.1/WS5.2).
 *
 * The chat tools in `portfolioChat.ts` already answer from an in-process
 * `PortfolioChatContext`; an external caller arrives over HTTP. Rather than
 * copying the broker snapshot, the price store and the consent gate into
 * `apps/server` — where they would drift from the dashboard's own read — these
 * three routes project that SAME context under the request's tenant. They are
 * plain `/api/investing/*` reads: the mounted server's `apiGuard` already
 * refuses an unauthenticated caller, and the tenant comes from
 * AsyncLocalStorage, never from a header or a tool argument.
 *
 * Read-only by construction: there is no write route here and no handler that
 * mutates a store.
 */

import type { Hono } from "hono";
import { renderFundamentalsBrief, type Trade } from "@lavega/core";
import type { PortfolioChatContext } from "../portfolioChat.js";

/** The most trades one read returns. Same ceiling the chat tool uses. */
export const MAX_MCP_TRADES = 60;

const SYMBOL = /^[A-Z0-9][A-Z0-9.\-^=]{0,19}$/;

export type McpReadRouteDependencies = {
  /** Whose data this request is for; the runtime resolves it, not the caller. */
  resolveTenantId: () => string | Promise<string>;
  /** The tenant-scoped read context the in-app chat uses. */
  context: () => Promise<PortfolioChatContext>;
  /** Whether the owner accepted Yahoo Finance / AI market-data use. */
  consent: () => Promise<boolean>;
};

const normalizeSymbol = (raw: string | undefined): string | null => {
  const value = raw?.trim().toUpperCase();
  return value && SYMBOL.test(value) ? value : null;
};

/** What one trade looks like to an agent: the signed order, not the vault row. */
const projectTrade = (trade: Trade) => ({
  date: trade.date,
  symbol: trade.symbol,
  side: trade.side,
  quantity: trade.quantity,
  price: trade.price,
  currency: trade.currency,
});

export function attachMcpReadRoutes<T extends Hono>(app: T, deps: McpReadRouteDependencies): T {
  /* Trades, newest first. The dashboard read model does not carry the trade
   * ledger, so this is the route that does — one row cap, one ordering, and
   * `truncated` so an agent can say it saw only the recent part. */
  app.get("/api/investing/trades", async (c) => {
    const symbol = c.req.query("symbol");
    const normalized = symbol === undefined ? undefined : normalizeSymbol(symbol);
    if (symbol !== undefined && !normalized)
      return c.json({ problems: ["symbol must be a ticker, for example AAPL"] }, 400);
    const requested = Number(c.req.query("limit") ?? MAX_MCP_TRADES);
    const limit = Number.isFinite(requested)
      ? Math.min(MAX_MCP_TRADES, Math.max(1, Math.floor(requested)))
      : MAX_MCP_TRADES;
    const context = await deps.context();
    const all = context
      .trades()
      .filter((trade) => !normalized || trade.symbol.toUpperCase() === normalized)
      .sort((left, right) => right.date.localeCompare(left.date));
    return c.json({
      trades: all.slice(0, limit).map(projectTrade),
      total: all.length,
      truncated: all.length > limit,
    });
  });

  /* One closing price: the latest, or the last on or before `date`. A missing
   * symbol or a gap in the series is a 404 with a problem, never a fabricated
   * price (ADR 0011: an unknown magnitude is null, not zero). */
  app.get("/api/investing/prices/:symbol", async (c) => {
    const symbol = normalizeSymbol(c.req.param("symbol"));
    if (!symbol) return c.json({ problems: ["symbol must be a ticker, for example AAPL"] }, 400);
    const date = c.req.query("date");
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return c.json({ problems: ["date must be YYYY-MM-DD"] }, 400);
    const context = await deps.context();
    const bar = await context.price(symbol, date);
    if (!bar) return c.json({ problems: [`No price for ${symbol}`] }, 404);
    return c.json(bar);
  });

  /* Company fundamentals, consent-gated exactly as the chat path gates them:
   * without the Yahoo Finance decision the provider is unavailable, so the
   * answer is 428 and a machine-readable flag rather than a silent empty. */
  app.get("/api/investing/fundamentals/:symbol", async (c) => {
    const symbol = normalizeSymbol(c.req.param("symbol"));
    if (!symbol) return c.json({ problems: ["symbol must be a ticker, for example AAPL"] }, 400);
    if (!(await deps.consent()))
      return c.json(
        { consentRequired: true, problems: ["Yahoo Finance consent required"] },
        428,
      );
    const context = await deps.context();
    try {
      const fundamentals = await context.fundamentals.fetch(symbol);
      if (!fundamentals)
        return c.json({
          symbol,
          brief: null,
          problems: [
            "No company fundamentals: a fund, or a symbol the provider does not know.",
          ],
        });
      return c.json({ symbol, brief: renderFundamentalsBrief(fundamentals) });    } catch {
      return c.json({ problems: ["Fundamentals are unavailable right now"] }, 502);
    }
  });

  return app;
}
