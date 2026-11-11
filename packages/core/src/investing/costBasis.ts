import type { ManualCostBasis, Position, Trade } from "./model.js";
import { fromCents, toCents } from "../money.js";
import { convertCurrency, MissingFxRateError, type FxRates } from "./portfolio.js";
import { orderTrades } from "./quantity.js";

/* Cost-basis lot book and basis provenance (plan §3 WS4.1 + WS4.2, #295).
 *
 * Ported from Sure commit 562fe09 (AGPL-3.0):
 *  - `app/models/holding/lot_book.rb` — moving average, acquisition fee inside
 *    the basis, full-liquidation reset, transfer-in as unknown cost, exact
 *    split restatement.
 *  - `app/models/holding/forward_calculator.rb:96-128` — an inbound transfer
 *    marks the whole position unknown, and only a genuine downward crossing
 *    through zero releases the mark.
 *  - `app/models/holding.rb:7-14, 221-251` and
 *    `app/models/holding/cost_basis_reconciler.rb` — source priority
 *    manual > calculated > provider, a user lock, and provider carry-forward.
 *  - `app/models/holding/materializer.rb:102-118` — a transfer-in clears a
 *    stale calculated basis instead of leaving the old number standing.
 *
 * What is deliberately different: Sure stores outflow positive; LaVega's Trade
 * carries an explicit side and a positive quantity magnitude. The lot book is
 * currency-agnostic and takes presentation-currency decimal amounts, because it
 * must reconcile digit-for-digit with `calculatePositionReturn`, whose returns
 * math stays decimal (ADR 0011 allows decimal returns math; integer cents are
 * used only at the persisted provenance boundary below).
 *
 * There is no clock here. Callers pass `asOf` dates and pre-ordered splits.
 */

export type CostBasisUnknownReason =
  | "no-history"
  | "transfer-in"
  | "missing-fx"
  | "missing-price"
  | "missing-fee"
  | "quantity-mismatch"
  | "provider-incomplete";

export type CostBasisSource = "manual" | "calculated" | "provider";

const EPSILON = 1e-9;

/** One open lot. A transfer-in is a lot with `unitCost: null`: nothing in the
 *  trade history says what it cost, so averaging it into priced units would
 *  fabricate a basis. */
export type LotBookLot = {
  sourceId: string | null;
  acquiredOn: string | null;
  quantity: number;
  /** Presentation-currency cost per unit, acquisition fee included. */
  unitCost: number | null;
};

/** The running pool and the lots that back it. `totalQuantity`/`totalCost` hold
 *  priced units only, exactly like Sure's `@total_qty`/`@total_cost`; the lots
 *  also track transferred-in units so relief stays pro rata across both. */
export type LotBook = {
  lots: LotBookLot[];
  totalQuantity: number;
  totalCost: number;
  unknownCost: boolean;
};

export function createLotBook(): LotBook {
  return { lots: [], totalQuantity: 0, totalCost: 0, unknownCost: false };
}

export function openLotQuantity(book: LotBook): number {
  return book.lots.reduce((sum, lot) => sum + lot.quantity, 0);
}

/** Presentation-currency cost of the priced pool. */
export function poolCost(book: LotBook): number {
  return book.totalCost;
}

/** Weighted-average cost per share, or null when nothing is held or any held
 *  unit arrived with an unknown cost. */
export function averageCost(book: LotBook): number | null {
  if (book.unknownCost || book.totalQuantity <= EPSILON) return null;
  return book.totalCost / book.totalQuantity;
}

export function addPricedUnits(
  book: LotBook,
  input: {
    quantity: number;
    /** Total presentation-currency cost of these units, fee included. */
    cost: number;
    sourceId?: string;
    acquiredOn?: string;
  },
): void {
  if (!(input.quantity > EPSILON)) return;
  book.lots.push({
    sourceId: input.sourceId ?? null,
    acquiredOn: input.acquiredOn ?? null,
    quantity: input.quantity,
    unitCost: input.cost / input.quantity,
  });
  book.totalQuantity += input.quantity;
  book.totalCost += input.cost;
}

/** Acquisition at a known per-unit cost (the port's public shape). */
export function applyBuy(
  book: LotBook,
  input: {
    quantity: number;
    unitCost: number;
    sourceId?: string;
    acquiredOn?: string;
  },
): void {
  if (!(input.quantity > EPSILON)) return;
  addPricedUnits(book, {
    quantity: input.quantity,
    cost: input.unitCost * input.quantity,
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
    ...(input.acquiredOn !== undefined ? { acquiredOn: input.acquiredOn } : {}),
  });
}

/** Internal inbound movement: units at a cost nothing here knows. */
export function addUnknownUnits(
  book: LotBook,
  quantity: number,
  input: { sourceId?: string; acquiredOn?: string } = {},
): void {
  if (!(quantity > EPSILON)) return;
  book.lots.push({
    sourceId: input.sourceId ?? null,
    acquiredOn: input.acquiredOn ?? null,
    quantity,
    unitCost: null,
  });
  book.unknownCost = true;
}

function resetBook(book: LotBook): void {
  book.lots = [];
  book.totalQuantity = 0;
  book.totalCost = 0;
  book.unknownCost = false;
}

/** Pro-rata relief across every open lot, with the rounding drift settled on
 *  the last lot so the open sum stays exact. */
function relieveLots(book: LotBook, quantity: number): void {
  const open = openLotQuantity(book);
  if (open <= EPSILON) return;
  const remaining = open - Math.min(quantity, open);
  if (remaining <= EPSILON) {
    book.lots = [];
    return;
  }
  const scaled = book.lots.map((lot) => ({ ...lot, quantity: (lot.quantity * remaining) / open }));
  const drift = remaining - scaled.reduce((sum, lot) => sum + lot.quantity, 0);
  const last = scaled.at(-1);
  if (last && Math.abs(drift) > EPSILON) last.quantity += drift;
  book.lots = scaled.filter((lot) => lot.quantity > EPSILON);
}

/** A disposal relieves at the running average, so the per-share average does
 *  not move. A full liquidation resets the pool: a later repurchase starts
 *  from a clean basis, and float drift cannot leave a phantom remainder. */
export function applySell(book: LotBook, quantity: number): void {
  if (!(quantity > EPSILON)) return;
  relieveLots(book, quantity);
  // Sure returns here when no priced pool exists (a transfer-only position):
  // its lots keep shrinking and the unknown mark stays until a real crossing.
  if (book.totalQuantity <= EPSILON) return;
  const relieved = Math.min(quantity, book.totalQuantity);
  book.totalCost -= (book.totalCost / book.totalQuantity) * relieved;
  book.totalQuantity -= relieved;
  if (book.totalQuantity <= EPSILON) resetBook(book);
}

/** A split changes the share count and not the money invested, so total cost
 *  stays and every lot's per-share cost moves by the inverse ratio. */
export function applySplit(book: LotBook, ratio: number): void {
  if (!(ratio > 0) || Math.abs(ratio - 1) <= EPSILON) return;
  book.totalQuantity *= ratio;
  for (const lot of book.lots) {
    lot.quantity *= ratio;
    if (lot.unitCost !== null) lot.unitCost /= ratio;
  }
}

export type CostBasisReplay =
  | {
      status: "known";
      /** Presentation-currency total basis of what is still held. */
      totalCost: number;
      quantity: number;
      averageCost: number | null;
      firstBuyDate: string | null;
    }
  | {
      status: "unknown";
      reason: CostBasisUnknownReason;
      firstBuyDate: string | null;
    };

function tradeValue(trade: Trade): number | null {
  if (trade.amount !== null) return Math.abs(trade.amount);
  if (trade.price !== null) return Math.abs(trade.price * trade.quantity);
  return null;
}

/** Replay a trade history into a lot book, converting at each trade's own date
 *  (a basis is what was paid then and must not drift with later FX). `other`
 *  trades are internal movements: a positive quantity arrived from another
 *  account at a cost nothing here knows; a negative one left and relieves at
 *  the running average like a sell.
 *
 *  `splits` restate raw trades. Callers that already fed trades through
 *  `splits.ts` must not pass them again. */
export function replayCostBasis(input: {
  trades: readonly Trade[];
  presentationCurrency: string;
  fxRates: FxRates;
  splits?: readonly { date: string; ratio: number }[];
  /** When set, the replay must reconstruct exactly this held quantity. A
   *  mismatch means the history does not describe the position, so the basis
   *  it produced does not either. */
  expectedQuantity?: number | null;
}): CostBasisReplay {
  const ordered = orderTrades(input.trades);
  const firstBuyDate = ordered.find((trade) => trade.side === "buy")?.date ?? null;
  if (ordered.length === 0) return { status: "unknown", reason: "no-history", firstBuyDate };

  const splits = [...(input.splits ?? [])]
    .filter((split) => split.ratio > 0 && Math.abs(split.ratio - 1) > EPSILON)
    .sort((left, right) => left.date.localeCompare(right.date));
  let splitIndex = 0;
  const applySplitsThrough = (date: string) => {
    while (splitIndex < splits.length && splits[splitIndex]!.date <= date) {
      applySplit(book, splits[splitIndex]!.ratio);
      splitIndex += 1;
    }
  };

  const book = createLotBook();
  let transferredIn = false;
  /** Sure releases the transfer mark only on a genuine downward crossing
   *  through zero: a position already at zero never held these units. */
  const releaseIfCrossed = (before: number) => {
    if (before > EPSILON && openLotQuantity(book) <= EPSILON) {
      transferredIn = false;
      book.unknownCost = false;
    }
  };

  for (const trade of ordered) {
    applySplitsThrough(trade.date);
    const before = openLotQuantity(book);

    if (trade.side === "other") {
      if (trade.quantity > EPSILON) {
        addUnknownUnits(book, trade.quantity, {
          sourceId: trade.id,
          acquiredOn: trade.date,
        });
        transferredIn = true;
      } else if (trade.quantity < -EPSILON) {
        applySell(book, -trade.quantity);
      }
      releaseIfCrossed(before);
      continue;
    }

    const gross = tradeValue(trade);
    if (gross === null || !(trade.quantity > EPSILON))
      return { status: "unknown", reason: "missing-price", firstBuyDate };
    if (trade.commission === null)
      return { status: "unknown", reason: "missing-fee", firstBuyDate };

    let grossPresented: number;
    let feePresented: number;
    try {
      grossPresented = convertCurrency(
        gross,
        trade.currency,
        input.presentationCurrency,
        trade.date,
        input.fxRates,
      );
      feePresented = convertCurrency(
        Math.abs(trade.commission),
        trade.currency,
        input.presentationCurrency,
        trade.date,
        input.fxRates,
      );
    } catch (error) {
      if (error instanceof MissingFxRateError)
        return { status: "unknown", reason: "missing-fx", firstBuyDate };
      // An unknown currency is still an unconvertible leg; never guess 1:1.
      return { status: "unknown", reason: "missing-fx", firstBuyDate };
    }

    if (trade.side === "buy") {
      // Sure folds the acquisition fee into the effective price:
      // `price + fee / qty` (trade_calculator_helpers.rb:33-42).
      addPricedUnits(book, {
        quantity: trade.quantity,
        cost: grossPresented + feePresented,
        sourceId: trade.id,
        acquiredOn: trade.date,
      });
    } else {
      applySell(book, trade.quantity);
    }
    releaseIfCrossed(before);
  }
  while (splitIndex < splits.length) {
    applySplit(book, splits[splitIndex]!.ratio);
    splitIndex += 1;
  }

  const held = openLotQuantity(book);
  if (
    input.expectedQuantity !== undefined &&
    input.expectedQuantity !== null &&
    Math.abs(held - input.expectedQuantity) > EPSILON
  )
    return { status: "unknown", reason: "quantity-mismatch", firstBuyDate };
  if (held <= EPSILON)
    return { status: "known", totalCost: 0, quantity: 0, averageCost: null, firstBuyDate };
  if (transferredIn || book.unknownCost)
    return { status: "unknown", reason: "transfer-in", firstBuyDate };
  return {
    status: "known",
    totalCost: Math.max(0, book.totalCost),
    quantity: held,
    averageCost: averageCost(book),
    firstBuyDate,
  };
}

/* ---------------------------------------------------------------------------
 * Basis provenance (WS4.2)
 * ------------------------------------------------------------------------- */

/** A persisted basis value plus the source that earned it. `ManualCostBasis`
 *  itself is the snapshot field on `Position`. */
export type StoredCostBasis = ManualCostBasis & { source: CostBasisSource };

export type CostBasisSummary = {
  status: "known" | "unknown";
  source: CostBasisSource | null;
  /** Presentation-currency total in integer cents. Null when unknown. */
  amountCents: number | null;
  currency: string;
  locked: boolean;
  /** Why the basis is unknown; null when known. Developer-facing typed code;
   *  the UI maps it to copy. */
  reason: CostBasisUnknownReason | null;
  firstBuyDate: string | null;
};

type ProviderLeg = { amount: number; currency: string; date: string };
type ManualLeg = { amountCents: number; currency: string; date: string; locked: boolean };

const SOURCE_PRIORITY: Record<CostBasisSource, number> = {
  manual: 3,
  calculated: 2,
  provider: 1,
};

function convertLegs(
  legs: readonly { amount: number; currency: string; date: string }[],
  presentationCurrency: string,
  fxRates: FxRates,
): number | null {
  try {
    return legs.reduce(
      (sum, leg) =>
        sum + convertCurrency(leg.amount, leg.currency, presentationCurrency, leg.date, fxRates),
      0,
    );
  } catch {
    return null;
  }
}

/** Pick the basis a reader should show. Priority is manual > calculated >
 *  provider. A locked manual value always wins; an unlocked manual value is the
 *  user opting into recalculation, so a calculated basis replaces it (Sure's
 *  `cost_basis_replaceable_by?`). Unknown is a typed reason, never a number. */
export function selectCostBasis(input: {
  presentationCurrency: string;
  fxRates: FxRates;
  manual?: { legs: readonly ManualLeg[] } | null;
  calculated: CostBasisReplay;
  provider?: { status: "complete"; legs: readonly ProviderLeg[] } | { status: "incomplete" } | null;
}): CostBasisSummary {
  const { presentationCurrency, calculated } = input;
  const firstBuyDate = calculated.firstBuyDate;

  let manualValue: number | null = null;
  let manualLocked = false;
  if (input.manual && input.manual.legs.length > 0) {
    manualLocked = input.manual.legs.every((leg) => leg.locked);
    manualValue = convertLegs(
      input.manual.legs.map((leg) => ({
        amount: fromCents(leg.amountCents),
        currency: leg.currency,
        date: leg.date,
      })),
      presentationCurrency,
      input.fxRates,
    );
  }

  const providerComplete = input.provider?.status === "complete";
  const providerValue =
    providerComplete && input.provider?.status === "complete"
      ? convertLegs(input.provider.legs, presentationCurrency, input.fxRates)
      : null;

  const known = (source: CostBasisSource, amount: number, locked: boolean): CostBasisSummary => ({
    status: "known",
    source,
    amountCents: toCents(amount),
    currency: presentationCurrency,
    locked,
    reason: null,
    firstBuyDate,
  });

  if (manualValue !== null && (manualLocked || calculated.status !== "known"))
    return known("manual", manualValue, manualLocked);
  if (calculated.status === "known") return known("calculated", calculated.totalCost, false);
  if (providerValue !== null) return known("provider", providerValue, false);

  const reason: CostBasisUnknownReason =
    calculated.reason !== "no-history"
      ? calculated.reason
      : providerComplete || input.manual
        ? "missing-fx"
        : input.provider
          ? "provider-incomplete"
          : calculated.reason;
  return {
    status: "unknown",
    source: null,
    amountCents: null,
    currency: presentationCurrency,
    locked: false,
    reason,
    firstBuyDate,
  };
}

/** Decide the stored basis value and source for one holding, following Sure's
 *  `Holding::CostBasisReconciler`: provider zero is unknown, a lock is never
 *  overwritten, and a transfer-in clears a stale calculated figure. */
export function reconcileCostBasis(
  existing: StoredCostBasis | null | undefined,
  incoming:
    | { source: "manual"; amountCents: number; currency: string; locked?: boolean }
    | { source: "calculated" | "provider"; amountCents: number | null; currency: string },
): { value: StoredCostBasis | null; updated: boolean } {
  const keep = { value: existing ?? null, updated: false };
  let amountCents = incoming.amountCents;
  // A provider zero states "no basis reported", not a free position.
  if (incoming.source === "provider" && (amountCents === 0 || amountCents === null))
    amountCents = null;

  if (!existing) {
    if (amountCents === null) return keep;
    const locked = incoming.source === "manual" ? (incoming.locked ?? true) : false;
    return {
      value: { amountCents, currency: incoming.currency, source: incoming.source, locked },
      updated: true,
    };
  }

  if (existing.locked) return keep;

  const replaceable =
    existing.source === "manual"
      ? incoming.source === "calculated"
      : SOURCE_PRIORITY[incoming.source] >= SOURCE_PRIORITY[existing.source];
  if (!replaceable) return keep;

  if (amountCents === null) {
    // Materializer: a transfer-in has no basis this app can know, so the old
    // calculated number must not survive as if it were still true.
    if (incoming.source === "calculated" && existing.source === "calculated")
      return { value: null, updated: true };
    return keep;
  }

  if (existing.source === incoming.source && existing.amountCents === amountCents) return keep;
  const locked = incoming.source === "manual" ? (incoming.locked ?? true) : false;
  return {
    value: { amountCents, currency: incoming.currency, source: incoming.source, locked },
    updated: true,
  };
}

function positionCostBasisKey(position: Position): string {
  // A restored snapshot is trusted data, but a damaged row must not abort the
  // whole sync; an unreadable key simply carries nothing forward.
  const symbol = typeof position.symbol === "string" ? position.symbol.toUpperCase() : "";
  return JSON.stringify([
    position.entity ?? "",
    position.broker ?? "",
    position.account ?? "",
    symbol,
  ]);
}

/** Carry user data across a provider sync. A manual basis and its lock always
 *  survive, because a sync has no authority over a user assertion. A provider
 *  basis carries forward only when the row is the same holding with the same
 *  quantity: a changed quantity would make the old total a stale number. */
export function carryForwardCostBasis(
  stored: readonly Position[],
  incoming: readonly Position[],
): Position[] {
  const previous = new Map(stored.map((position) => [positionCostBasisKey(position), position]));
  return incoming.map((position) => {
    const before = previous.get(positionCostBasisKey(position));
    if (!before) return position;
    let next = position;
    if (before.manualCostBasis) next = { ...next, manualCostBasis: before.manualCostBasis };
    if (
      next.brokerCost?.status !== "known" &&
      before.brokerCost?.status === "known" &&
      before.currency === next.currency &&
      Math.abs(before.quantity - next.quantity) <= EPSILON
    )
      next = { ...next, brokerCost: before.brokerCost };
    return next;
  });
}
