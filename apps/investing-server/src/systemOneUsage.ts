import { createAiUsageRepository } from "@lavega/database";
import { runtimeDatabase } from "./credentialStore.js";

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
  const database = runtimeDatabase();
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
  const database = runtimeDatabase();
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
