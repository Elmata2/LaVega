import { expect, test } from "vitest";
import type { Position, Trade } from "./model.js";
import { calculatePositionReturn } from "./positions.js";
import {
  addUnknownUnits,
  applyBuy,
  applySell,
  applySplit,
  averageCost,
  carryForwardCostBasis,
  createLotBook,
  openLotQuantity,
  poolCost,
  reconcileCostBasis,
  replayCostBasis,
  selectCostBasis,
  type CostBasisReplay,
  type CostBasisUnknownReason,
} from "./costBasis.js";

/* Hand-calculated fixtures from Sure's lot book (commit 562fe09,
 * `app/models/holding/lot_book.rb`) and its edge tests
 * (`test/models/holding/lot_book_test.rb`). Every number below is arithmetic
 * that a reader can check on paper; that is the point of the port. */

const trade = (overrides: Partial<Trade>): Trade => ({
  id: crypto.randomUUID(),
  entity: "Holding BV",
  date: "2026-01-02",
  symbol: "ACME",
  side: "buy",
  quantity: 10,
  price: 10,
  amount: 100,
  currency: "EUR",
  commission: 0,
  ...overrides,
});

test("moving average: buys average, a sell leaves the per-share average unchanged", () => {
  const book = createLotBook();
  applyBuy(book, { quantity: 10, unitCost: 100, acquiredOn: "2026-01-02", sourceId: "b1" });
  applyBuy(book, { quantity: 10, unitCost: 120, acquiredOn: "2026-01-03", sourceId: "b2" });

  // (10 × 100 + 10 × 120) / 20 = 110 per share.
  expect(poolCost(book)).toBe(2200);
  expect(openLotQuantity(book)).toBe(20);
  expect(averageCost(book)).toBe(110);

  applySell(book, 5);

  // 5 × 110 = 550 relieved; 1650 / 15 = 110, so the average did not move.
  expect(poolCost(book)).toBe(1650);
  expect(openLotQuantity(book)).toBe(15);
  expect(averageCost(book)).toBe(110);
});

test("acquisition fee is part of the basis, not a separate return cost", () => {
  const book = createLotBook();
  // Sure folds a buy fee into the effective price: price + fee / qty.
  applyBuy(book, { quantity: 10, unitCost: 100 + 10 / 10 });
  expect(poolCost(book)).toBe(1010);
  expect(averageCost(book)).toBe(101);
});

test("a full liquidation resets the pool, so a repurchase starts from a clean basis", () => {
  const book = createLotBook();
  applyBuy(book, { quantity: 10, unitCost: 100 });
  applySell(book, 10);

  expect(poolCost(book)).toBe(0);
  expect(openLotQuantity(book)).toBe(0);
  expect(averageCost(book)).toBeNull();

  applyBuy(book, { quantity: 5, unitCost: 30 });
  // Not 5 × 30 plus a float remainder of the closed pool.
  expect(poolCost(book)).toBe(150);
  expect(averageCost(book)).toBe(30);
});

test("an oversell is capped at the held quantity and never leaves a negative pool", () => {
  const book = createLotBook();
  applyBuy(book, { quantity: 10, unitCost: 100 });
  applySell(book, 15);

  expect(openLotQuantity(book)).toBe(0);
  expect(poolCost(book)).toBe(0);
  expect(averageCost(book)).toBeNull();
});

test("a transfer-in makes the whole position's basis unknown, even with priced units held", () => {
  const book = createLotBook();
  applyBuy(book, { quantity: 5, unitCost: 20 });
  addUnknownUnits(book, 5);
  expect(averageCost(book)).toBeNull();

  const replay = replayCostBasis({
    trades: [
      trade({ id: "buy", quantity: 5, price: 20, amount: 100 }),
      trade({ id: "transfer", side: "other", quantity: 5, price: null, amount: null }),
    ],
    presentationCurrency: "EUR",
    fxRates: undefined,
    expectedQuantity: 10,
  });
  expect(replay).toMatchObject({ status: "unknown", reason: "transfer-in" });
});

test("an outbound transfer relieves at the running average like a sell", () => {
  const replay = replayCostBasis({
    trades: [
      trade({ id: "buy", quantity: 10, price: 10, amount: 100 }),
      // LaVega has no signed amount for `other`; the sign of quantity carries
      // the direction, as `normalizeTradeQuantity` preserves it.
      trade({ id: "transfer-out", side: "other", quantity: -4, price: null, amount: null }),
    ],
    presentationCurrency: "EUR",
    fxRates: undefined,
    expectedQuantity: 6,
  });
  expect(replay).toMatchObject({ status: "known", quantity: 6, totalCost: 60, averageCost: 10 });
});

test("the unknown mark releases only on a genuine downward crossing through zero", () => {
  // Transfer-in while holding, then sell everything: the mark clears, so the
  // next buy has a knowable basis.
  const replay = replayCostBasis({
    trades: [
      trade({ id: "buy", quantity: 5, price: 20, amount: 100 }),
      trade({ id: "transfer-in", side: "other", quantity: 5, price: null, amount: null }),
      trade({ id: "sell-all", side: "sell", quantity: 10, price: 30, amount: 300 }),
      trade({ id: "rebuy", date: "2026-02-01", quantity: 1, price: 30, amount: 30 }),
    ],
    presentationCurrency: "EUR",
    fxRates: undefined,
    expectedQuantity: 1,
  });
  expect(replay).toMatchObject({ status: "known", quantity: 1, totalCost: 30, averageCost: 30 });
});

test("a split restates quantities and per-share cost exactly, keeping total cost", () => {
  const book = createLotBook();
  applyBuy(book, { quantity: 10, unitCost: 20 });
  applySplit(book, 2);

  expect(openLotQuantity(book)).toBe(20);
  expect(poolCost(book)).toBe(200);
  expect(averageCost(book)).toBe(10);
  expect(book.lots[0]?.unitCost).toBe(10);

  applySell(book, 10);
  // Half the restated units relieve half the unchanged total cost.
  expect(poolCost(book)).toBe(100);
  expect(openLotQuantity(book)).toBe(10);
  expect(averageCost(book)).toBe(10);
});

test("replaying raw trades restates a split at its ex-date before that day's trades", () => {
  const replay = replayCostBasis({
    trades: [
      trade({ id: "buy", date: "2026-01-02", quantity: 10, price: 20, amount: 200 }),
      trade({ id: "sell", date: "2026-01-20", side: "sell", quantity: 10, price: 30, amount: 300 }),
    ],
    splits: [{ date: "2026-01-10", ratio: 2 }],
    presentationCurrency: "EUR",
    fxRates: undefined,
    expectedQuantity: 10,
  });
  // 20 shares after the split; selling 10 relieves 100 of the 200 cost.
  expect(replay).toMatchObject({ status: "known", quantity: 10, totalCost: 100, averageCost: 10 });
});

test("a trade-date without an FX rate makes the basis unknown, never converted 1:1", () => {
  const rates = [{ base: "EUR", date: "2026-01-02", rates: { USD: 2 } }];
  const replay = replayCostBasis({
    trades: [trade({ date: "2025-01-02", currency: "USD" })],
    presentationCurrency: "EUR",
    fxRates: rates,
    expectedQuantity: 10,
  });
  expect(replay).toMatchObject({ status: "unknown", reason: "missing-fx" });
});

test("missing history, price or fee each carry their own typed reason", () => {
  const replay = (trades: Trade[]) =>
    replayCostBasis({ trades, presentationCurrency: "EUR", fxRates: undefined });
  expect(replay([])).toMatchObject({ status: "unknown", reason: "no-history" });
  expect(replay([trade({ amount: null, price: null })])).toMatchObject({
    status: "unknown",
    reason: "missing-price",
  });
  expect(replay([trade({ commission: null })])).toMatchObject({
    status: "unknown",
    reason: "missing-fee",
  });
  expect(
    replayCostBasis({
      trades: [trade({ quantity: 1 })],
      presentationCurrency: "EUR",
      fxRates: undefined,
      expectedQuantity: 10,
    }),
  ).toMatchObject({ status: "unknown", reason: "quantity-mismatch" });
});

test("the lot book reconciles with calculatePositionReturn for trade-only books", () => {
  const trades = [
    trade({ id: "b1", quantity: 10, price: 100, amount: 1000, commission: 2 }),
    trade({ id: "b2", date: "2026-01-03", quantity: 2, price: 120, amount: 240, commission: 1 }),
    trade({
      id: "s1",
      date: "2026-01-04",
      side: "sell",
      quantity: 6,
      price: 150,
      amount: 900,
      commission: 3,
    }),
  ];
  const returns = calculatePositionReturn(6, 480, trades, [], "EUR", undefined);
  const replay = replayCostBasis({
    trades,
    presentationCurrency: "EUR",
    fxRates: undefined,
    expectedQuantity: 6,
  });
  expect(replay.status).toBe("known");
  if (replay.status !== "known") return;
  // Byte-for-byte the same arithmetic: same buys, same average-cost relief.
  expect(replay.totalCost).toBe(returns.remainingCostBasis);
  expect(replay.averageCost).toBe(returns.remainingCostBasis! / 6);
});

/* Provenance (WS4.2): priority manual > calculated > provider, with a lock. */

const calculated = (totalCost: number): CostBasisReplay => ({
  status: "known",
  totalCost,
  quantity: 1,
  averageCost: totalCost,
  firstBuyDate: "2026-01-02",
});
const unknown = (reason: CostBasisUnknownReason): CostBasisReplay => ({
  status: "unknown",
  reason,
  firstBuyDate: null,
});

test("basis source priority is manual > calculated > provider, and a lock keeps manual", () => {
  const provider = {
    status: "complete" as const,
    legs: [{ amount: 70, currency: "EUR", date: "2026-01-01" }],
  };
  const manual = (locked: boolean) => ({
    legs: [{ amountCents: 9900, currency: "EUR", date: "2026-01-01", locked }],
  });

  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: undefined,
      manual: manual(true),
      calculated: calculated(100),
      provider,
    }),
  ).toMatchObject({ status: "known", source: "manual", amountCents: 9900, locked: true });

  // An unlocked manual value is the user opting into recalculation, so the
  // calculated basis replaces it.
  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: undefined,
      manual: manual(false),
      calculated: calculated(100),
      provider,
    }),
  ).toMatchObject({ status: "known", source: "calculated", amountCents: 10000, locked: false });

  // Calculated outranks provider, but a provider basis is better than unknown.
  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: undefined,
      calculated: calculated(100),
      provider,
    }),
  ).toMatchObject({ status: "known", source: "calculated" });
  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: undefined,
      calculated: unknown("no-history"),
      provider,
    }),
  ).toMatchObject({ status: "known", source: "provider", amountCents: 7000 });
});

test("an unknown basis is null with a typed reason, never a guessed number", () => {
  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: undefined,
      calculated: unknown("transfer-in"),
      provider: { status: "incomplete" },
    }),
  ).toMatchObject({ status: "unknown", source: null, amountCents: null, reason: "transfer-in" });

  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: undefined,
      calculated: unknown("no-history"),
      provider: { status: "incomplete" },
    }),
  ).toMatchObject({ status: "unknown", reason: "provider-incomplete" });

  // No rate for the provider legs: null, never the raw number.
  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: [{ base: "EUR", date: "2025-01-01", rates: { USD: 2 } }],
      calculated: unknown("transfer-in"),
      provider: { status: "complete", legs: [{ amount: 50, currency: "USD", date: "2026-09-01" }] },
    }),
  ).toMatchObject({ status: "unknown", reason: "transfer-in" });

  expect(
    selectCostBasis({
      presentationCurrency: "EUR",
      fxRates: [{ base: "EUR", date: "2025-01-01", rates: { USD: 2 } }],
      calculated: unknown("no-history"),
      provider: { status: "complete", legs: [{ amount: 50, currency: "USD", date: "2026-09-01" }] },
    }),
  ).toMatchObject({ status: "unknown", reason: "missing-fx", amountCents: null });
});

test("the reconciler never overwrites a lock, clears stale calculated basis, and treats provider zero as unknown", () => {
  const existing = {
    amountCents: 9900,
    currency: "EUR",
    source: "manual" as const,
    locked: true,
  };
  expect(
    reconcileCostBasis(existing, { source: "calculated", amountCents: 12000, currency: "EUR" }),
  ).toEqual({ value: existing, updated: false });

  // Provider 0 is "unknown", not a free position.
  expect(reconcileCostBasis(null, { source: "provider", amountCents: 0, currency: "EUR" })).toEqual(
    { value: null, updated: false },
  );

  // A transfer-in clears a stale calculated figure; manual and provider stay.
  expect(
    reconcileCostBasis(
      { amountCents: 10000, currency: "EUR", source: "calculated", locked: false },
      { source: "calculated", amountCents: null, currency: "EUR" },
    ),
  ).toEqual({ value: null, updated: true });

  // Unlocked manual is replaceable only by calculated, per Sure.
  expect(
    reconcileCostBasis(
      { amountCents: 10000, currency: "EUR", source: "manual", locked: false },
      { source: "provider", amountCents: 20000, currency: "EUR" },
    ).updated,
  ).toBe(false);
  expect(
    reconcileCostBasis(
      { amountCents: 10000, currency: "EUR", source: "manual", locked: false },
      { source: "calculated", amountCents: 20000, currency: "EUR" },
    ),
  ).toEqual({
    value: { amountCents: 20000, currency: "EUR", source: "calculated", locked: false },
    updated: true,
  });

  // A same-value same-source write is a no-op.
  expect(
    reconcileCostBasis(
      { amountCents: 10000, currency: "EUR", source: "calculated", locked: false },
      { source: "calculated", amountCents: 10000, currency: "EUR" },
    ).updated,
  ).toBe(false);
});

test("a sync carries a manual basis and lock forward, and only carries provider basis when nothing moved", () => {
  const stored: Position[] = [
    {
      entity: "personal",
      broker: "ibkr",
      account: "U1",
      symbol: "ACME",
      quantity: 10,
      averagePrice: 100,
      marketPrice: 110,
      marketValue: 1100,
      currency: "EUR",
      asOf: "2026-01-01",
      brokerCost: { status: "known", amount: 1000, currency: "EUR" },
      manualCostBasis: { amountCents: 123400, currency: "EUR", locked: true },
    },
    {
      entity: "personal",
      broker: "ibkr",
      account: "U1",
      symbol: "BETA",
      quantity: 3,
      averagePrice: 10,
      marketPrice: 10,
      marketValue: 30,
      currency: "EUR",
      asOf: "2026-01-01",
      brokerCost: { status: "known", amount: 30, currency: "EUR" },
    },
  ];
  const incoming: Position[] = [
    {
      ...stored[0]!,
      quantity: 12,
      asOf: "2026-01-02",
      brokerCost: { status: "unknown", reason: "not-reported" },
      manualCostBasis: undefined,
    },
    {
      ...stored[1]!,
      quantity: 3,
      asOf: "2026-01-02",
      brokerCost: { status: "unknown", reason: "not-reported" },
    },
  ];

  const carried = carryForwardCostBasis(stored, incoming);
  // A manual value and its lock survive a provider sync.
  expect(carried[0]?.manualCostBasis).toEqual({
    amountCents: 123400,
    currency: "EUR",
    locked: true,
  });
  // The quantity changed, so an old total basis would be a stale number.
  expect(carried[0]?.brokerCost).toEqual({ status: "unknown", reason: "not-reported" });
  // Nothing moved, so the provider basis carries forward.
  expect(carried[1]?.brokerCost).toEqual({ status: "known", amount: 30, currency: "EUR" });
});
