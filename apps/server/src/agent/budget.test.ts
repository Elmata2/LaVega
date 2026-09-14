import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { checkBudget, recordUsage, resetBudgetMemory, spentCents } from "./budget.js";
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
