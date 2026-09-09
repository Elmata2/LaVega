import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { checkBudget, recordUsage, resetBudgetMemory } from "./budget.js";
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

test("recordUsage never throws, and returns void synchronously", () => {
  const result = recordUsage({ route: "extract-invoice", model: MISTRAL_SMALL });
  expect(result).toBeUndefined();
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
