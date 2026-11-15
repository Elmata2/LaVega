import { Clock, DateTime, Effect } from "effect";
import { expect, test } from "vitest";
import type { PartnerIntervals, PartnerKey } from "./PartnerBudget.js";
import { PartnerBudget } from "./PartnerBudget.js";

const INTERVAL_MS = 300;

export type PartnerBudgetHarness = {
  /** Runs one scenario against a budget that starts empty. All time reads inside
   *  the effect come from the same clock the budget uses. */
  run<A, E>(effect: Effect.Effect<A, E, PartnerBudget>): Promise<A>;
};

/**
 * Observable budget behavior, identical for every adapter. It asserts order
 * and spacing only: the memory adapter runs on `TestClock`, the Neon adapter
 * on database `now()`, so nothing here may depend on exact instants.
 *
 * Each test uses a key of its own (`test-<uuid>`), so runs on one database do
 * not interfere.
 */
export function partnerBudgetContract(
  name: string,
  createHarness: (
    intervals: PartnerIntervals,
  ) => PartnerBudgetHarness | Promise<PartnerBudgetHarness>,
) {
  const newKey = (): PartnerKey => ({
    partner: `test-${crypto.randomUUID()}`,
    endpoint: "any",
    scopeId: "shared",
  });
  const intervals: PartnerIntervals = (key) =>
    key.partner.startsWith("test-") ? INTERVAL_MS : undefined;
  const ms = (instant: DateTime.Utc) => DateTime.toEpochMillis(instant);

  test(`${name}: concurrent reserves get distinct slots one interval apart`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const slots = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        return yield* Effect.all(
          Array.from({ length: 10 }, () => budget.reserve(key)),
          { concurrency: "unbounded" },
        );
      }),
    );
    const sorted = slots.map(ms).sort((a, b) => a - b);
    expect(new Set(sorted).size).toBe(10);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]! - sorted[index - 1]!).toBeGreaterThanOrEqual(INTERVAL_MS);
    }
  });

  test(`${name}: a slot after reject is at or after the rejection instant`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const { until, slot } = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const now = yield* Clock.currentTimeMillis;
        const until = DateTime.makeUnsafe(now + 5_000);
        yield* budget.reject(key, until);
        return { until, slot: yield* budget.reserve(key) };
      }),
    );
    expect(ms(slot)).toBeGreaterThanOrEqual(ms(until));
  });

  test(`${name}: remaining 0 blocks the key until one second after the reset`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const { resetAt, slot } = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const now = yield* Clock.currentTimeMillis;
        const resetAt = DateTime.makeUnsafe(now + 4_000);
        yield* budget.observe(key, { remaining: 0, resetAt });
        return { resetAt, slot: yield* budget.reserve(key) };
      }),
    );
    expect(ms(slot)).toBeGreaterThanOrEqual(ms(resetAt) + 1_000);
  });

  test(`${name}: remaining above 0 does not block the key`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const { before, slot } = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const before = yield* Clock.currentTimeMillis;
        yield* budget.observe(key, { remaining: 3, resetAt: DateTime.makeUnsafe(before + 60_000) });
        return { before, slot: yield* budget.reserve(key) };
      }),
    );
    // Database time may sit a little behind this process; it never waits for the reset.
    expect(ms(slot)).toBeLessThan(before + 30_000);
  });

  test(`${name}: a slot is consumed even when the caller never uses it`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const [first, second] = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        return [yield* budget.reserve(key), yield* budget.reserve(key)] as const;
      }),
    );
    expect(ms(second) - ms(first)).toBeGreaterThanOrEqual(INTERVAL_MS);
  });

  test(`${name}: a key with no row yet is seeded with the table interval`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const slots = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const first = yield* budget.reserve(key);
        const second = yield* budget.reserve(key);
        const third = yield* budget.reserve(key);
        return [first, second, third].map(ms);
      }),
    );
    expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(INTERVAL_MS);
    expect(slots[2]! - slots[1]!).toBeGreaterThanOrEqual(INTERVAL_MS);
  });

  test(`${name}: an observed interval spaces the slots that follow it`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const slots = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        yield* budget.observe(key, { intervalMs: 1_000 });
        const first = yield* budget.reserve(key);
        const second = yield* budget.reserve(key);
        return [first, second].map(ms);
      }),
    );
    expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(1_000);
  });

  test(`${name}: an interval outside 1 to 600000 ms is ignored`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const slots = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        yield* budget.observe(key, { intervalMs: 600_001 });
        yield* budget.observe(key, { intervalMs: 0 });
        yield* budget.observe(key, { intervalMs: 2.5 });
        const first = yield* budget.reserve(key);
        const second = yield* budget.reserve(key);
        return [first, second].map(ms);
      }),
    );
    expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(INTERVAL_MS);
    expect(slots[1]! - slots[0]!).toBeLessThan(1_000);
  });

  test(`${name}: a refused reserveBefore leaves the queue unchanged`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const { first, refused, next } = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const now = yield* Clock.currentTimeMillis;
        const first = yield* budget.reserve(key);
        // The next slot is a full interval away; ask for one that is long gone.
        const refused = yield* budget.reserveBefore(key, DateTime.makeUnsafe(now - 60_000));
        const next = yield* budget.reserve(key);
        return { first, refused, next };
      }),
    );
    expect(refused.granted).toBe(false);
    expect(ms(refused.slot)).toBeGreaterThanOrEqual(ms(first) + INTERVAL_MS);
    // The caller that was refused consumed nothing: the next one gets its slot.
    expect(ms(next)).toBe(ms(refused.slot));
  });

  test(`${name}: reserveBefore grants a slot at or before notAfter and consumes it`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const { granted, after } = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const now = yield* Clock.currentTimeMillis;
        const notAfter = DateTime.makeUnsafe(now + 60_000);
        const granted = yield* budget.reserveBefore(key, notAfter);
        const after = yield* budget.reserveBefore(key, notAfter);
        return { granted, after };
      }),
    );
    expect(granted.granted).toBe(true);
    expect(after.granted).toBe(true);
    expect(ms(after.slot) - ms(granted.slot)).toBeGreaterThanOrEqual(INTERVAL_MS);
  });

  test(`${name}: blockedUntil reads a block and changes nothing`, async () => {
    const harness = await createHarness(intervals);
    const key = newKey();
    const { none, until, seen, slot } = await harness.run(
      Effect.gen(function* () {
        const budget = yield* PartnerBudget;
        const none = yield* budget.blockedUntil(key);
        const now = yield* Clock.currentTimeMillis;
        const until = DateTime.makeUnsafe(now + 5_000);
        yield* budget.reject(key, until);
        const seen = yield* budget.blockedUntil(key);
        return { none, until, seen, slot: yield* budget.reserve(key) };
      }),
    );
    expect(none).toBeNull();
    expect(seen && ms(seen)).toBe(ms(until));
    expect(ms(slot)).toBeGreaterThanOrEqual(ms(until));
  });
}
