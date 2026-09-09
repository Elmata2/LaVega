import { createAiUsageRepository, type AiUsage } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { loadBudgetConfig } from "../config.js";
import { totalCostCents } from "./pricing.js";

export type UsageInput = {
  route: AiUsage["route"];
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  pages?: number;
  // Callers of a chatWithSearch-based route (chat, travel) always pass 1 here
  // regardless of whether the model actually invoked the web_search tool —
  // deliberately conservative (over-attributes cost, never under-attributes
  // it), traded for not having to parse tool-invocation detail out of every
  // response just to price a call correctly.
  searches?: number;
};

export type BudgetGate = { ok: true } | { ok: false; scope: "day" | "month" };

// Per-process fallback for a deployment with no DATABASE_URL (local dev,
// self-hosting). Keyed by "day:<YYYY-MM-DD>" / "month:<YYYY-MM>" so day and
// month totals never collide. Lost on restart — acceptable, the guard it
// feeds only needs to be roughly right within one process's lifetime.
const memory = new Map<string, number>();
let warnedNoDatabase = false;

// UTC day/month boundary, not Europe/Amsterdam — the caps only need to reset
// roughly once a day, so the 1-2 hour skew near local midnight (the Dutch
// "vandaag"/"deze maand" wording implies the owner's own calendar) is an
// accepted tradeoff rather than a bug to fix.
function todayParts(): { day: string; month: string } {
  const iso = new Date().toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export async function spentCents(): Promise<{ dayCents: number; monthCents: number }> {
  const { day, month } = todayParts();
  const db = runtimeDatabase();
  if (db) return createAiUsageRepository(db).spentCents({ day, month });
  if (!warnedNoDatabase) {
    warnedNoDatabase = true;
    console.warn("agent/budget: no DATABASE_URL — using an in-memory, per-process spend counter");
  }
  return {
    dayCents: memory.get(`day:${day}`) ?? 0,
    monthCents: memory.get(`month:${month}`) ?? 0,
  };
}

// checkBudget()'s read and recordUsage()'s write are not atomic — concurrent
// requests can both read "under cap" before either's spend lands, so the cap
// is best-effort, not a hard ceiling. Accepted for a single-owner, low-volume
// deployment; closing it for real would need a reservation step (check AND
// provisionally charge before the call, reconcile after), not worth it here.
export async function checkBudget(): Promise<BudgetGate> {
  const caps = loadBudgetConfig();
  const spent = await spentCents();
  if (spent.dayCents >= caps.dayCents) return { ok: false, scope: "day" };
  if (spent.monthCents >= caps.monthCents) return { ok: false, scope: "month" };
  return { ok: true };
}

/** Log and persist one AI call's cost. Fire-and-forget: an AI-usage-logging
 *  failure must never fail a request that already succeeded, so persistence
 *  runs detached and this function itself never throws or returns a Promise. */
export function recordUsage(input: UsageInput): void {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const pages = input.pages ?? 0;
  const searches = input.searches ?? 0;
  let costCents: number;
  try {
    costCents = totalCostCents({ model: input.model, inputTokens, outputTokens, pages, searches });
  } catch (e) {
    // pricing.ts refuses to price an unrecognized model rather than silently
    // charging 0 (see its own comment) — that protects the cap from a renamed
    // model going invisibly free, but this function's own contract is to never
    // fail a request that already succeeded, so the failure surfaces as a
    // loud log instead of a thrown error, and this one call's spend is not
    // recorded.
    console.error(`agent/budget: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  console.log(
    `ai.usage route=${input.route} model=${input.model} in=${inputTokens} out=${outputTokens} pages=${pages} cost_cents=${costCents}`,
  );

  void (async () => {
    try {
      const { day, month } = todayParts();
      const db = runtimeDatabase();
      if (db) {
        await createAiUsageRepository(db).record({
          day,
          route: input.route,
          model: input.model,
          inputTokens,
          outputTokens,
          pages,
          searches,
          costCents,
        });
        return;
      }
      memory.set(`day:${day}`, (memory.get(`day:${day}`) ?? 0) + costCents);
      memory.set(`month:${month}`, (memory.get(`month:${month}`) ?? 0) + costCents);
    } catch (e) {
      console.error(
        `agent/budget: failed to persist usage: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  })();
}

/** Test seam: clears the in-memory counter and the "warned once" flag. Cannot
 *  reset credentialStore.ts's own pool singleton cleanly, so DB-path coverage
 *  is out of scope for tests here — no DATABASE_URL is set anywhere in this
 *  test env. */
export function resetBudgetMemory(): void {
  memory.clear();
  warnedNoDatabase = false;
}
