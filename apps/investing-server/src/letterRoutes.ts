import type { Context, Hono } from "hono";
import type { AgentMemoryRepository, PortfolioLetter } from "@lavega/database";
import type { PortfolioChatContext } from "./portfolioChat.js";
import { ensureLetter, type LetterGenerator } from "./portfolioLetter.js";

export type LetterRouteDependencies = {
  resolveTenantId: () => string | Promise<string>;
  /** Null without a database: letters are then unavailable. */
  memory: (tenantId: string) => AgentMemoryRepository | null;
  context: () => Promise<Pick<PortfolioChatContext, "dashboard" | "sectors">>;
  generate: LetterGenerator;
  now?: () => number;
};

export function attachLetterRoutes<T extends Hono>(app: T, deps: LetterRouteDependencies): T {
  const withMemory = async (
    c: Context,
    handle: (memory: AgentMemoryRepository) => Promise<Response>,
  ): Promise<Response> => {
    const memory = deps.memory(await deps.resolveTenantId());
    if (!memory) return c.json({ problems: ["Portfolio letters need a database"] }, 503);
    return handle(memory);
  };

  app.get("/api/letters/latest", async (c) => {
    const memory = deps.memory(await deps.resolveTenantId());
    const letter: PortfolioLetter | null = memory ? await memory.latestLetter() : null;
    return c.json({ letter });
  });

  app.post("/api/letters/ensure", (c) =>
    withMemory(c, async (memory) => {
      try {
        const { dashboard, sectors } = await deps.context();
        const result = await ensureLetter({
          dashboard,
          sectors,
          memory,
          generate: deps.generate,
          ...(deps.now ? { now: deps.now } : {}),
        });
        return c.json(result);
      } catch (error) {
        return c.json(
          { problems: [error instanceof Error ? error.message : "Portfolio letter failed"] },
          502,
        );
      }
    }),
  );

  return app;
}
