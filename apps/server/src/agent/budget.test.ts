import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  checkBudget,
  recordUsage,
  releaseReservation,
  resetBudgetMemory,
  spentCents,
  WORST_CASE_CENTS,
} from "./budget.js";
import { MISTRAL_SMALL } from "./models.js";

let prevDay: string | undefined;
let prevMonth: string | undefined;

beforeEach(() => {
  resetBudgetMemory();
  prevDay = process.env.AI_DAILY_BUDGET_CENTS;
  prevMonth = process.env.AI_MONTHLY_BUDGET_CENTS;
});

afterEach(() => {
  resetBudgetMemory();
  if (prevDay === undefined) delete process.env.AI_DAILY_BUDGET_CENTS;
  else process.env.AI_DAILY_BUDGET_CENTS = prevDay;
  if (prevMonth === undefined) delete process.env.AI_MONTHLY_BUDGET_CENTS;
  else process.env.AI_MONTHLY_BUDGET_CENTS = prevMonth;
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test("checkBudget passes when spend is under both caps", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = "200";
  process.env.AI_MONTHLY_BUDGET_CENTS = "2000";
  expect(await checkBudget()).toEqual({ ok: true });
});

// mistral-small-latest at 1M in / 1M out: (1*0.15 + 1*0.6) USD = 0.75 USD =
// 75 cents, * the 0.92 EUR rate = 69.0 exactly — a clean, rounding-free cost
// per call that makes the cap arithmetic below exact rather than approximate.
const ONE_CALL_CENTS = 69;
function recordOneCall() {
  recordUsage({
    route: "categorize",
    model: MISTRAL_SMALL,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
}

test("checkBudget refuses at the day scope once today's spend meets the daily cap", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = String(ONE_CALL_CENTS - 1);
  process.env.AI_MONTHLY_BUDGET_CENTS = "2000";
  recordOneCall();
  await tick();
  expect(await checkBudget()).toEqual({ ok: false, scope: "day" });
});

test("checkBudget refuses at the month scope when only the monthly cap is exceeded", async () => {
  // Day cap set high enough that today's spend never trips it; month cap set
  // low enough that the same spend trips it instead — both draw from the same
  // "today", so this is the large-single-day-under-day-cap-but-over-month-cap
  // fixture from the task brief, not a multi-day one.
  process.env.AI_DAILY_BUDGET_CENTS = "1000000";
  process.env.AI_MONTHLY_BUDGET_CENTS = String(ONE_CALL_CENTS - 1);
  recordOneCall();
  await tick();
  expect(await checkBudget()).toEqual({ ok: false, scope: "month" });
});

test("recordUsage increments what spentCents next reports", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = "1000000";
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";
  expect(await checkBudget()).toEqual({ ok: true });
  recordOneCall();
  await tick();
  recordOneCall();
  await tick();
  // Two calls cost 2 * ONE_CALL_CENTS — proven by placing the cap strictly
  // between one call's cost and two calls' cost.
  process.env.AI_DAILY_BUDGET_CENTS = String(ONE_CALL_CENTS + 1);
  expect(await checkBudget()).toEqual({ ok: false, scope: "day" });
});

/* The contract changed on 14 Sep and the reason matters. This used to return
 * void and persist in a detached `void (async () => …)()`, so that a logging
 * failure could never fail a request that had already succeeded. On a
 * serverless host the platform may stop the instance once the response is sent,
 * which quietly discards that write: the Mistral call is billed, the ledger
 * never sees it, and the cap answers "under" forever. It is awaited now. The
 * original guarantee survives as "never rejects". */
test("recordUsage is awaitable and never rejects", async () => {
  await expect(
    recordUsage({ route: "extract-invoice", model: MISTRAL_SMALL }),
  ).resolves.toBeUndefined();
});

/* HONEST ABOUT WHAT THIS CANNOT PROVE.
 *
 * This asserts the spend is visible after awaiting, which it is. It does NOT
 * prove the write is attached, and I checked: re-detaching it into a
 * `void (async () => …)()` leaves this test green, because with no
 * DATABASE_URL the memory branch runs synchronously before the IIFE ever
 * yields. The bug being guarded lives on the Neon path, and this file's own
 * header explains why that path is not reachable from here.
 *
 * So the real guard is the return type: `recordUsage` is `async`, the agents
 * `await onUsage?.(…)`, and tsc fails if either stops being true. That is
 * structural rather than behavioural, and it is what actually holds the fix. */
test("recorded spend is visible to the next gate read", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = "1000000";
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";
  const before = (await spentCents()).dayCents;
  await recordUsage({
    route: "categorize",
    model: MISTRAL_SMALL,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  expect((await spentCents()).dayCents).toBeGreaterThan(before);
});

/* THE RACE THIS FILE EXISTS TO CLOSE.
 *
 * checkBudget() used to only READ spend; recordUsage() wrote it afterwards,
 * separately. Two concurrent callers could both read "under cap" before
 * either had written anything, so the cap was decided by a number both of
 * them had already read as stale — the shape that once let 240 concurrent
 * card-terms lookups clear a one-cent cap by EUR 14.39 (see cardTerms.ts).
 * checkBudget() now reserves the worst case atomically as part of the same
 * call that answers "is there room", so this fires ten of them together and
 * asserts exactly one wins.
 *
 * This IS genuinely concurrent, not just fired-and-hoped: Promise.all's
 * array literal invokes each checkBudget() call synchronously, in order,
 * before any of the returned promises are awaited, and the memory path's
 * read-decide-write (see checkBudget's own comment) never hits an `await` —
 * so if it raced, it would race HERE, inside this synchronous phase, not
 * merely appear serialized by a test harness the way the DB-backed
 * equivalent in packages/database/src/aiUsageReservation.test.ts is (that
 * test's own comment explains why PGlite can't offer the same guarantee).
 *
 * Checked by reverting, not just asserted: I temporarily routed this memory
 * path's read through `await spentCents()` instead of a direct, synchronous
 * `memory.get()` — reintroducing exactly the kind of await-shaped gap this
 * function exists to close — and reran this test. It failed, admitting more
 * than one of the ten. Restoring the synchronous read fixed it back to
 * exactly one. */
test("checkBudget admits exactly one of ten concurrent callers when the cap has room for exactly one worst-case reservation", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = String(WORST_CASE_CENTS.categorize + 1); // room for exactly one
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";

  const results = await Promise.all(Array.from({ length: 10 }, () => checkBudget("categorize")));

  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok && r.scope === "day")).toHaveLength(9);
});

test("recordUsage reconciles a reservation to the real cost in place, instead of stacking the real cost on top of the worst case", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = "1000000";
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";
  const budget = await checkBudget("categorize");
  if (!budget.ok) throw new Error("expected the reservation to succeed");
  expect((await spentCents()).dayCents).toBe(WORST_CASE_CENTS.categorize); // held at worst case first

  await recordUsage(
    { route: "categorize", model: MISTRAL_SMALL, inputTokens: 1000, outputTokens: 1000 },
    budget.reservation,
  );

  // A ~1k-token call costs far less than the 5-cent worst case categorize is
  // held at — proves this replaced the hold rather than adding to it.
  expect((await spentCents()).dayCents).toBeLessThan(WORST_CASE_CENTS.categorize);
});

test("releaseReservation frees a hold that never turned into a real call", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = String(WORST_CASE_CENTS.categorize + 1);
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";
  const first = await checkBudget("categorize");
  expect(first.ok).toBe(true);
  expect(await checkBudget("categorize")).toEqual({ ok: false, scope: "day" });

  if (first.ok) await releaseReservation(first.reservation);

  expect((await checkBudget("categorize")).ok).toBe(true);
});

test("releaseReservation after recordUsage is a no-op — a late release cannot erase a charge already recorded", async () => {
  process.env.AI_DAILY_BUDGET_CENTS = "1000000";
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";
  const budget = await checkBudget("categorize");
  if (!budget.ok) throw new Error("expected the reservation to succeed");
  await recordUsage(
    { route: "categorize", model: MISTRAL_SMALL, inputTokens: 1000, outputTokens: 1000 },
    budget.reservation,
  );
  const afterRecord = (await spentCents()).dayCents;

  await releaseReservation(budget.reservation); // e.g. a caller that recorded, then still threw later

  expect((await spentCents()).dayCents).toBe(afterRecord);
});

test("recordUsage with an unrecognized model logs loudly and does not throw or record any spend — pricing.ts's throw is caught here, not propagated to the caller", async () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.AI_DAILY_BUDGET_CENTS = "1000000";
  process.env.AI_MONTHLY_BUDGET_CENTS = "1000000";
  expect(() =>
    recordUsage({
      route: "categorize",
      model: "gpt-renamed-and-forgotten",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
  ).not.toThrow();
  await tick();
  expect(await checkBudget()).toEqual({ ok: true }); // nothing was charged
  expect(
    errSpy.mock.calls.some((c) => String(c.join(" ")).includes("gpt-renamed-and-forgotten")),
  ).toBe(true);
  errSpy.mockRestore();
});
