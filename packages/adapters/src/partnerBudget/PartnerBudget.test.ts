import { DateTime, Effect, Exit, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import {
  PartnerBudget,
  PartnerBudgetUnavailable,
  PartnerWait,
  awaitSlot,
  createPartnerBudgetClient,
  isPartnerBudgetUnavailable,
  isPartnerWait,
  type PartnerBudgetStore,
  type PartnerKey,
} from "./PartnerBudget.js";
import { partnerBudgetContract } from "./partnerBudget.contract.js";
import { itEffect } from "./testing.js";

const key: PartnerKey = { partner: "yahoo", endpoint: "any", scopeId: "shared" };
const at = (ms: number) => DateTime.makeUnsafe(ms);
const ms = (instant: DateTime.Utc) => DateTime.toEpochMillis(instant);
const memory = Effect.provide(PartnerBudget.memoryLayer);

partnerBudgetContract("memory", (intervals) => ({
  run: (effect) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(PartnerBudget.memoryLayerWith(intervals)),
        Effect.provide(TestClock.layer()),
      ),
    ),
}));

itEffect("memory: slots on a fresh key are exact, one table interval apart", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    yield* TestClock.setTime(10_000);
    const slots = [
      yield* budget.reserve(key),
      yield* budget.reserve(key),
      yield* budget.reserve(key),
    ].map(ms);
    expect(slots).toEqual([10_000, 10_300, 10_600]);
  }).pipe(memory),
);

itEffect("memory: the budget is per scope id, so two accounts do not queue behind each other", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    const a: PartnerKey = {
      partner: "trading212",
      endpoint: "positions",
      scopeId: "aaaaaaaaaaaaaaaa",
    };
    const b: PartnerKey = { ...a, scopeId: "bbbbbbbbbbbbbbbb" };
    expect([ms(yield* budget.reserve(a)), ms(yield* budget.reserve(b))]).toEqual([0, 0]);
    expect(ms(yield* budget.reserve(a))).toBe(1_000);
  }).pipe(memory),
);

itEffect("memory: after a block at T the first slot is exactly T, then one interval later", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    yield* budget.reject(key, at(5_000));
    const slots = [yield* budget.reserve(key), yield* budget.reserve(key)].map(ms);
    expect(slots).toEqual([5_000, 5_300]);
  }).pipe(memory),
);

itEffect("memory: observe blocks until reset plus one second and leaves next_at alone", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    yield* budget.observe(key, { remaining: 0, resetAt: at(4_000) });
    expect(ms(yield* budget.reserve(key))).toBe(5_000);
  }).pipe(memory),
);

itEffect("memory: a block never moves earlier and a past block has no effect", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    yield* budget.reject(key, at(9_000));
    yield* budget.reject(key, at(2_000));
    expect(ms(yield* budget.reserve(key))).toBe(9_000);
    yield* TestClock.setTime(20_000);
    yield* budget.reject(key, at(1_000));
    expect(ms(yield* budget.reserve(key))).toBe(20_000);
  }).pipe(memory),
);

itEffect("memory: each header pair acts alone", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    const interval: PartnerKey = {
      partner: "trading212",
      endpoint: "positions",
      scopeId: "aaaaaaaaaaaaaaaa",
    };
    // interval pair only: spacing changes, nothing is blocked
    yield* budget.observe(interval, { intervalMs: 2_000 });
    expect([ms(yield* budget.reserve(interval)), ms(yield* budget.reserve(interval))]).toEqual([
      0, 2_000,
    ]);
    // remaining pair only: blocks, spacing stays at the table interval
    const blocked: PartnerKey = { ...interval, scopeId: "bbbbbbbbbbbbbbbb" };
    yield* budget.observe(blocked, { remaining: 0, resetAt: at(3_000) });
    expect([ms(yield* budget.reserve(blocked)), ms(yield* budget.reserve(blocked))]).toEqual([
      4_000, 5_000,
    ]);
    // remaining without a reset time cannot block
    const unblocked: PartnerKey = { ...interval, scopeId: "cccccccccccccccc" };
    yield* budget.observe(unblocked, { remaining: 0 });
    expect(ms(yield* budget.reserve(unblocked))).toBe(0);
  }).pipe(memory),
);

itEffect("memory: a changed interval applies to later slots only", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    expect(ms(yield* budget.reserve(key))).toBe(0); // next_at = 300
    yield* budget.observe(key, { intervalMs: 1_000 });
    expect(ms(yield* budget.reserve(key))).toBe(300); // keeps the old next_at
    expect(ms(yield* budget.reserve(key))).toBe(1_300); // new spacing
  }).pipe(memory),
);

itEffect("memory: a key that is not in the limit table is a defect, not a silent default", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    const exit = yield* Effect.exit(
      budget.reserve({ partner: "nope", endpoint: "x", scopeId: "shared" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.hasDies(exit)).toBe(true);
  }).pipe(memory),
);

itEffect("awaitSlot: sleeps until the slot", () =>
  Effect.gen(function* () {
    const done = yield* Ref.make(false);
    yield* Effect.gen(function* () {
      yield* (yield* PartnerBudget).reserve(key); // slot 0, next 300
    });
    const fiber = yield* Effect.forkChild(
      awaitSlot(key).pipe(Effect.tap(() => Ref.set(done, true))),
    );
    yield* TestClock.adjust(299);
    expect(yield* Ref.get(done)).toBe(false);
    yield* TestClock.adjust(1);
    yield* Fiber.join(fiber);
    expect(yield* Ref.get(done)).toBe(true);
  }).pipe(memory),
);

itEffect("awaitSlot: a slot after deadline minus one second fails with PartnerWait", () =>
  Effect.gen(function* () {
    yield* (yield* PartnerBudget).reserve(key); // next slot 300
    const error = yield* Effect.flip(awaitSlot(key, 1_299)); // 300 > 1_299 - 1_000
    expect(isPartnerWait(error)).toBe(true);
    expect(error).toBeInstanceOf(PartnerWait);
    expect(ms((error as PartnerWait).until)).toBe(300);
  }).pipe(memory),
);

itEffect("awaitSlot: a slot exactly one second before the deadline proceeds", () =>
  Effect.gen(function* () {
    yield* (yield* PartnerBudget).reserve(key); // next slot 300
    // slot 300 is not after 1_300 - 1_000, so it proceeds
    const fiber = yield* Effect.forkChild(awaitSlot(key, 1_300));
    yield* TestClock.adjust(300);
    yield* Fiber.join(fiber);
  }).pipe(memory),
);

itEffect("awaitSlot: with no deadline it always sleeps", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    yield* budget.reject(key, at(600_000));
    const fiber = yield* Effect.forkChild(awaitSlot(key));
    yield* TestClock.adjust(600_000);
    yield* Fiber.join(fiber);
  }).pipe(memory),
);

const brokenStore: PartnerBudgetStore = {
  reserve: () => Promise.reject(new Error("connection refused")),
  reserveBefore: () => Promise.reject(new Error("connection refused")),
  blockedUntil: () => Promise.reject(new Error("connection refused")),
  observe: () => Promise.reject(new Error("connection refused")),
  reject: () => Promise.reject(new Error("connection refused")),
};

itEffect("awaitSlot: a store failure surfaces as PartnerBudgetUnavailable", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(awaitSlot(key));
    expect(isPartnerBudgetUnavailable(error)).toBe(true);
    expect(error).toBeInstanceOf(PartnerBudgetUnavailable);
  }).pipe(Effect.provide(PartnerBudget.storeLayer(brokenStore))),
);

itEffect("store layer: observe and reject failures are PartnerBudgetUnavailable too", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    expect(
      isPartnerBudgetUnavailable(yield* Effect.flip(budget.observe(key, { intervalMs: 5 }))),
    ).toBe(true);
    expect(isPartnerBudgetUnavailable(yield* Effect.flip(budget.reject(key, at(1))))).toBe(true);
  }).pipe(Effect.provide(PartnerBudget.storeLayer(brokenStore))),
);

itEffect("store layer: passes the table interval and maps a Date back to an instant", () => {
  const calls: Array<[PartnerKey, number]> = [];
  const store: PartnerBudgetStore = {
    reserve: async (candidate, intervalMs) => {
      calls.push([candidate, intervalMs]);
      return new Date(42_000);
    },
    reserveBefore: async () => ({ slot: new Date(42_000), granted: true }),
    blockedUntil: async () => null,
    observe: async () => undefined,
    reject: async () => undefined,
  };
  return Effect.gen(function* () {
    const slot = yield* (yield* PartnerBudget).reserve(key);
    expect(ms(slot)).toBe(42_000);
    expect(calls).toEqual([[key, 300]]);
  }).pipe(Effect.provide(PartnerBudget.storeLayer(store)));
});

test("client bridge: rejects with the typed errors the adapters map", async () => {
  const wait = createPartnerBudgetClient(PartnerBudget.memoryLayer);
  await wait.reject(key, Date.now() + 60_000);
  const rejected = await wait.awaitSlot(key, Date.now() + 10_000).catch((error: unknown) => error);
  expect(rejected).toBeInstanceOf(PartnerWait);
  expect(isPartnerWait(rejected)).toBe(true);

  const broken = createPartnerBudgetClient(PartnerBudget.storeLayer(brokenStore));
  const unavailable = await broken.awaitSlot(key).catch((error: unknown) => error);
  expect(unavailable).toBeInstanceOf(PartnerBudgetUnavailable);
  await expect(broken.observe(key, { intervalMs: 5 })).rejects.toBeInstanceOf(
    PartnerBudgetUnavailable,
  );
  await expect(broken.reject(key, 1)).rejects.toBeInstanceOf(PartnerBudgetUnavailable);
  await wait.dispose();
  await broken.dispose();
});

itEffect("awaitSlot: callers refused at their deadline do not push the queue into the future", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    // Three granted slots: the next free one is at 900.
    yield* budget.reserve(key);
    yield* budget.reserve(key);
    yield* budget.reserve(key);
    // 20 callers whose deadline is 500: each is refused, none consumes a slot.
    for (let caller = 0; caller < 20; caller += 1) {
      const error = yield* Effect.flip(awaitSlot(key, 500));
      expect(isPartnerWait(error)).toBe(true);
      expect(ms((error as PartnerWait).until)).toBe(900);
    }
    expect(ms(yield* budget.reserve(key))).toBe(900);
  }).pipe(memory),
);

itEffect("awaitSlot: a block set while the caller sleeps holds it until the block ends", () =>
  Effect.gen(function* () {
    const budget = yield* PartnerBudget;
    const done = yield* Ref.make(false);
    yield* budget.reserve(key); // next slot 300
    const fiber = yield* Effect.forkChild(
      awaitSlot(key).pipe(Effect.tap(() => Ref.set(done, true))),
    );
    yield* TestClock.adjust(100);
    yield* budget.reject(key, at(5_000)); // another caller got a 429
    yield* TestClock.adjust(200); // wakes at its slot, 300
    yield* TestClock.adjust(4_699); // now 4_999
    expect(yield* Ref.get(done)).toBe(false);
    yield* TestClock.adjust(1);
    yield* Fiber.join(fiber);
    expect(yield* Ref.get(done)).toBe(true);
  }).pipe(memory),
);

itEffect(
  "awaitSlot: a block set while the caller sleeps fails it with PartnerWait when it ends after the deadline",
  () =>
    Effect.gen(function* () {
      const budget = yield* PartnerBudget;
      yield* budget.reserve(key); // next slot 300
      const fiber = yield* Effect.forkChild(Effect.flip(awaitSlot(key, 2_000)));
      yield* TestClock.adjust(100);
      yield* budget.reject(key, at(5_000)); // 5_000 > 2_000 - 1_000
      yield* TestClock.adjust(200);
      const error = yield* Fiber.join(fiber);
      expect(isPartnerWait(error)).toBe(true);
      expect(ms((error as PartnerWait).until)).toBe(5_000);
    }).pipe(memory),
);

itEffect("awaitSlot: a caller that did not sleep makes exactly one store call", () => {
  const calls: string[] = [];
  const store: PartnerBudgetStore = {
    reserve: async () => (calls.push("reserve"), new Date(0)),
    reserveBefore: async () => (calls.push("reserveBefore"), { slot: new Date(0), granted: true }),
    blockedUntil: async () => (calls.push("blockedUntil"), null),
    observe: async () => undefined,
    reject: async () => undefined,
  };
  return Effect.gen(function* () {
    yield* awaitSlot(key);
    yield* awaitSlot(key, 100_000);
    expect(calls).toEqual(["reserve", "reserveBefore"]);
  }).pipe(Effect.provide(PartnerBudget.storeLayer(store)));
});
