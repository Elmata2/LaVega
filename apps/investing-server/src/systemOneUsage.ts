import { createAiUsageRepository, type Database } from "@lavega/database";

/* THE DATABASE IS HANDED TO US, NOT FETCHED.
 *
 * This used to import the per-request database from ./credentialStore.js,
 * which put node:async_hooks on the investing-server REQUEST path:
 * app.ts -> portfolioAgent.ts -> systemOne.ts -> here -> credentialStore.ts.
 * import-boundaries.test.ts caught it, and it is a real constraint rather than
 * a style rule: that path has to stay free of Node builtins.
 *
 * index.ts is the entry point, where those builtins are fine, and wires this
 * once at startup. Behaviour is unchanged — the same per-request lookup still
 * happens, through a reference instead of a static import. Left unset, this
 * falls back to the same in-memory counters used whenever Neon is absent. */
let databaseSource: () => Database | null = () => null;

export function useDatabaseSource(source: () => Database | null): void {
  databaseSource = source;
}

const INPUT_EUR_CENTS_PER_MILLION = 0.042 * 0.92 * 100;
const WORST_CASE_CENTS = 1;
const memory = new Map<string, number>();

export type SystemOneBudget = { ok: true } | { ok: false; scope: "day" | "month" };

function parts() {
  const iso = new Date().toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function cap(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function checkSystemOneBudget(): Promise<SystemOneBudget> {
  const { day, month } = parts();
  const database = databaseSource();
  const spent = database
    ? await createAiUsageRepository(database).spentCents({ day, month })
    : { dayCents: memory.get(`day:${day}`) ?? 0, monthCents: memory.get(`month:${month}`) ?? 0 };
  if (spent.dayCents + WORST_CASE_CENTS >= cap(process.env.AI_DAILY_BUDGET_CENTS, 400))
    return { ok: false, scope: "day" };
  if (spent.monthCents + WORST_CASE_CENTS >= cap(process.env.AI_MONTHLY_BUDGET_CENTS, 2000))
    return { ok: false, scope: "month" };
  return { ok: true };
}

export async function recordSystemOneUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const { day, month } = parts();
  const costCents = Math.max(1, Math.ceil((inputTokens / 1_000_000) * INPUT_EUR_CENTS_PER_MILLION));
  const database = databaseSource();
  if (database) {
    await createAiUsageRepository(database).record({
      day,
      route: "portfolio-persona",
      model,
      inputTokens,
      outputTokens,
      pages: 0,
      searches: 0,
      costCents,
    });
    return;
  }
  memory.set(`day:${day}`, (memory.get(`day:${day}`) ?? 0) + costCents);
  memory.set(`month:${month}`, (memory.get(`month:${month}`) ?? 0) + costCents);
}

export function resetSystemOneUsageMemory(): void {
  memory.clear();
}
