import type { Hono } from "hono";
import { createPersonalNetWorthRepository } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { investingTenantId } from "./investing-mount.js";

/** A generous bound, matching 0019_personal_net_worth_totals.sql's CHECK: only
 *  wide enough to reject a garbage or overflowed value before it ever reaches
 *  the database. */
const MAX_ABS_CENTS = 1_000_000_000_000;

/** Nothing this feature shares can predate the feature itself. A floor this
 *  far back exists only to reject a client-side date bug (bad timezone math,
 *  a corrupted `asOf`) before it reaches the database — not a real business
 *  boundary. */
const MIN_DATE = "2000-01-01";

/** Strict YYYY-MM-DD. Rejects what `new Date(str)` would otherwise silently
 *  roll over (2026-13-40 has no business becoming 2027-02-09). */
function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return raw;
}

function isInFuture(date: string, today: string): boolean {
  return date > today;
}

function isBeforeMinDate(date: string): boolean {
  return date < MIN_DATE;
}

function parseTotalCents(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return Math.abs(raw) <= MAX_ABS_CENTS ? raw : null;
}

export type NetWorthRouteDependencies = {
  tenantId: (request: Request) => Promise<string | null>;
  repository: (tenantId: string) => {
    put(date: string, totalCents: number): Promise<void>;
    deleteAll(): Promise<void>;
  };
  /** Injectable so a test can fix "today" instead of racing the clock. */
  today?: () => string;
};

/**
 * The owner's opt-in share of Personal's own "Totale positie" into Investing's
 * net worth. Personal computes the number (`positionSeries` in
 * apps/web/src/totalePositie.ts, already in EUR) and sends this route exactly
 * that number — never a transaction, account or entity name. See
 * docs/investing/DASHBOARD.md's net worth section and
 * apps/web/src/netWorthShare.ts, which is the only caller.
 */
export function registerNetWorthRoutes(app: Hono, dependencies: NetWorthRouteDependencies): void {
  const today = dependencies.today ?? (() => new Date().toISOString().slice(0, 10));

  app.put("/api/personal/net-worth-total", async (c) => {
    const tenantId = await dependencies.tenantId(c.req.raw);
    if (!tenantId) return c.json({ problems: ["Authentication is required"] }, 401);

    const body: { date?: unknown; totalCents?: unknown; currency?: unknown } = await c.req
      .json<{ date?: unknown; totalCents?: unknown; currency?: unknown }>()
      .catch(() => ({}));

    const date = parseIsoDate(body.date);
    if (!date) return c.json({ problems: ["date must be YYYY-MM-DD"] }, 400);
    if (isInFuture(date, today())) return c.json({ problems: ["date must not be in the future"] }, 400);
    if (isBeforeMinDate(date))
      return c.json({ problems: [`date must not be before ${MIN_DATE}`] }, 400);
    if (body.currency !== "EUR") return c.json({ problems: ["currency must be EUR"] }, 400);
    const totalCents = parseTotalCents(body.totalCents);
    if (totalCents === null) return c.json({ problems: ["totalCents must be a bounded integer"] }, 400);

    await dependencies.repository(tenantId).put(date, totalCents);
    return c.json({ stored: true });
  });

  app.delete("/api/personal/net-worth-total", async (c) => {
    const tenantId = await dependencies.tenantId(c.req.raw);
    if (!tenantId) return c.json({ problems: ["Authentication is required"] }, 401);
    await dependencies.repository(tenantId).deleteAll();
    return c.json({ deleted: true });
  });
}

/** Wiring for the real server: session identity, Neon storage. Without a
 *  database there is nowhere to put a total, so the route is not mounted at
 *  all — matching account-routes.ts and vault-routes.ts. */
export function netWorthRouteDependencies(): NetWorthRouteDependencies | null {
  const database = runtimeDatabase();
  if (!database) return null;
  return {
    tenantId: investingTenantId,
    repository: (tenantId) => createPersonalNetWorthRepository(database, tenantId),
  };
}
