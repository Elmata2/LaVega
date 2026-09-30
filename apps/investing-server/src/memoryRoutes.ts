import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isRiskTolerance, type AgentMemoryRepository, type ThesisBody } from "@lavega/database";
import { isPortfolioAgentId } from "./portfolioAgent.js";

/*
 * The owner's view of agent memory (ADR 0007): list, reopen and delete
 * threads; view and edit theses and goals; set risk tolerance; export it all.
 * There is no route that deletes a thesis or a goal on its own: only a thread
 * delete (for what came from it) and erase-all-data remove memory.
 */

export type MemoryRouteDependencies = {
  resolveTenantId: () => string | Promise<string>;
  /** Null without a database: memory is then unavailable. */
  memory: (tenantId: string) => AgentMemoryRepository | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYMBOL = /^[A-Z0-9][A-Z0-9.\-^=]{0,19}$/;
const MAX_TEXT = 2_000;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TEXT ? trimmed : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return text(value) ?? undefined;
}

function symbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return SYMBOL.test(normalized) ? normalized : null;
}

function thesisBody(value: unknown): ThesisBody | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const why = text(body.why);
  const worth = optionalText(body.worth);
  const entry = optionalText(body.entry);
  const wrongIf = optionalText(body.wrongIf);
  if (!why || worth === undefined || entry === undefined || wrongIf === undefined) return null;
  return { why, worth, entry, wrongIf };
}

export function attachMemoryRoutes<T extends Hono>(app: T, deps: MemoryRouteDependencies): T {
  app.use(
    "/api/memory/*",
    bodyLimit({
      maxSize: 32_000,
      onError: (c) => c.json({ problems: ["Memory request exceeds size limit"] }, 413),
    }),
  );

  const withMemory = async (
    c: Context,
    handle: (memory: AgentMemoryRepository) => Promise<Response>,
  ): Promise<Response> => {
    const memory = deps.memory(await deps.resolveTenantId());
    if (!memory) return c.json({ problems: ["Agent memory needs a database"] }, 503);
    return handle(memory);
  };

  app.get("/api/memory", (c) =>
    withMemory(c, async (memory) => {
      const [riskTolerance, theses, goals] = await Promise.all([
        memory.getRiskTolerance(),
        memory.listTheses(),
        memory.listGoals(),
      ]);
      return c.json({ riskTolerance, theses, goals });
    }),
  );

  app.get("/api/memory/export", (c) =>
    withMemory(c, async (memory) => {
      c.header("content-disposition", 'attachment; filename="lavega-agent-memory.json"');
      return c.json(await memory.exportAll());
    }),
  );

  app.put("/api/memory/risk-tolerance", (c) =>
    withMemory(c, async (memory) => {
      const body: { riskTolerance?: unknown } = await c.req.json().catch(() => ({}));
      const value = body.riskTolerance ?? null;
      if (value !== null && !isRiskTolerance(value))
        return c.json(
          { problems: ["Risk tolerance is conservative, balanced or aggressive"] },
          400,
        );
      await memory.setRiskTolerance(value);
      return c.json({ riskTolerance: value });
    }),
  );

  app.put("/api/memory/theses/:symbol", (c) =>
    withMemory(c, async (memory) => {
      const key = symbol(c.req.param("symbol"));
      const body = thesisBody(await c.req.json().catch(() => null));
      if (!key || !body)
        return c.json({ problems: ["A thesis needs a symbol and the reason you own it"] }, 400);
      const thesis = await memory.editThesis(key, body);
      return thesis ? c.json({ thesis }) : c.json({ problems: ["No thesis for this symbol"] }, 404);
    }),
  );

  app.put("/api/memory/goals/:id", (c) =>
    withMemory(c, async (memory) => {
      const id = c.req.param("id");
      const body: { text?: unknown; symbol?: unknown } = await c.req.json().catch(() => ({}));
      const goalText = text(body.text);
      const goalSymbol = body.symbol == null || body.symbol === "" ? null : symbol(body.symbol);
      if (!isUuid(id) || !goalText || (body.symbol != null && body.symbol !== "" && !goalSymbol))
        return c.json({ problems: ["A goal needs text"] }, 400);
      const goal = await memory.editGoal(id, { symbol: goalSymbol, text: goalText });
      return goal ? c.json({ goal }) : c.json({ problems: ["No such goal"] }, 404);
    }),
  );

  app.get("/api/memory/threads", (c) =>
    withMemory(c, async (memory) => {
      const agentId = c.req.query("agentId");
      if (!isPortfolioAgentId(agentId))
        return c.json({ problems: ["Unknown portfolio agent"] }, 400);
      return c.json({ threads: await memory.listThreads(agentId) });
    }),
  );

  app.get("/api/memory/threads/:id", (c) =>
    withMemory(c, async (memory) => {
      const id = c.req.param("id");
      const thread = isUuid(id) ? await memory.getThread(id) : null;
      return thread ? c.json({ thread }) : c.json({ problems: ["No such thread"] }, 404);
    }),
  );

  app.delete("/api/memory/threads/:id", (c) =>
    withMemory(c, async (memory) => {
      const id = c.req.param("id");
      const deleted = isUuid(id) && (await memory.deleteThread(id));
      return deleted ? c.body(null, 204) : c.json({ problems: ["No such thread"] }, 404);
    }),
  );

  return app;
}
