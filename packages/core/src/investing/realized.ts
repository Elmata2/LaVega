/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 */

import { Schema } from "effect";
import { toCents } from "../money.js";
import type { CashFlow, Position, PriceBar, Trade } from "./model.js";
import type { Dividend } from "./dividend.js";
import {
  ACCOUNT_WRAPPERS,
  TAX_TREATMENTS,
  accountWrapperKey,
  type AccountWrapper,
  type AccountWrapperEntry,
  type TaxTreatment,
} from "./model.js";
import {
  addPricedUnits,
  addUnknownUnits,
  applySell,
  averageCost,
  createLotBook,
  openLotQuantity,
  type CostBasisUnknownReason,
} from "./costBasis.js";
import { latestOwnershipAnchors } from "./ownership.js";
import { convertCurrency, type FxRates } from "./portfolio.js";
import { orderTrades } from "./quantity.js";
import type { DeepMutable } from "./schema.js";
import { inCurrentShareUnits } from "./splits.js";
import { valuePosition } from "./valuation.js";

/* Realised-gain and income report (plan §3 WS4.3 + WS4.4, #296).
 *
 * Sure sources (AGPL-3.0, pinned commit above):
 *  - `app/models/trade.rb:159-267` — realised gain per disposal is proceeds
 *    minus basis; the basis is the holding snapshot's average cost, so a
 *    partial trade history still answers; proceeds are converted at the
 *    disposal's own date; a disposal fee reduces proceeds; a missing or
 *    non-positive FX rate is nil, never zero and never 1:1; an internal
 *    movement is nil.
 *  - `app/models/investment_statement/totals.rb:33-121` — dividends and
 *    interest are the two income buckets, each converted at the entry's date.
 *  - `app/controllers/reports_controller.rb:552-649` — the report groups
 *    realised and unrealised gains by account tax treatment.
 *
 * Reimplemented in TypeScript over LaVega's snapshot types, not copied. The
 * lot book itself stays in `costBasis.ts`: this module replays the same
 * exported primitives and never keeps a second averaging implementation.
 *
 * Money at this boundary is integer cents (ADR 0011). Internally the replay
 * stays decimal because that is what the lot book and the existing returns
 * math use; every figure leaves through `toCents`.
 *
 * There is no clock here. The caller passes `today`, the snapshot rows and the
 * FX rates it already loaded.
 */

export const REALIZED_REPORT_NOTICE =
  "Grouped by account tax treatment for reporting only. LaVega does not file taxes and this is not tax advice.";

const EPSILON = 1e-9;
/** A broker converts at its own rate; the same half-percent tolerance the
 *  Trading 212 cash proof uses keeps a rate difference from reading as an
 *  unreconciled disposal, while a missing movement stays a real difference. */
const RECONCILIATION_TOLERANCE = 0.005;

/** The tax treatment a wrapper label groups under. This is a label mapping,
 *  not a tax computation: it decides which bucket a row appears in and
 *  nothing else. */
export function wrapperTaxTreatment(wrapper: AccountWrapper): TaxTreatment {
  switch (wrapper) {
    case "brokerage":
    case "pillar-3b":
      return "taxable";
    case "sipp":
    case "private-pension":
    case "pillar-3a":
    case "ira":
    case "401k":
      return "tax-deferred";
    case "isa":
    case "lisa":
    case "pea":
    case "roth-ira":
      return "tax-exempt";
    case "assurance-vie":
      return "tax-advantaged";
    default:
      return "unknown";
  }
}

/** The account's label, or `unknown` when nobody set one. Never guessed. */
export function resolveAccountWrapper(
  entries: readonly AccountWrapperEntry[],
  broker: string,
  account: string,
): AccountWrapper {
  const key = accountWrapperKey(broker, account);
  for (const entry of entries)
    if (accountWrapperKey(entry.broker, entry.account) === key) return entry.wrapper;
  return "unknown";
}

export type RealizedBasisSource = "calculated" | "provider";

export type RealizedDisposalReconciliation =
  | {
      status: "reconciled";
      brokerCashCents: number;
      netProceedsCents: number;
      differenceCents: number;
    }
  | {
      status: "difference";
      brokerCashCents: number;
      netProceedsCents: number;
      differenceCents: number;
    }
  /** The broker reports no settled cash for this trade (IBKR Flex carries no
   *  per-trade cash in LaVega's snapshot), so nothing proves it. Not a failure:
   *  an absence of evidence is not evidence of a mismatch. */
  | { status: "broker-not-reported" }
  /** Proceeds or fee is missing from the trade, so there is nothing to
   *  reconcile against. */
  | { status: "not-computable" }
  | { status: "missing-fx" };

export type RealizedDisposal = {
  /** The trade id, so a row is traceable to the snapshot. */
  id: string;
  date: string;
  symbol: string;
  isin?: string;
  description?: string;
  entity: string;
  broker: string;
  account: string;
  quantity: number;
  /** The trade's own currency, before presentation conversion. */
  tradeCurrency: string;
  /** Gross proceeds in presentation cents; null when no price exists. */
  grossProceedsCents: number | null;
  /** Disposal fee in presentation cents, positive. */
  feesCents: number | null;
  /** Gross proceeds minus the disposal fee. */
  netProceedsCents: number | null;
  /** Basis relieved at disposal, in presentation cents. */
  costBasisCents: number | null;
  realizedGainCents: number | null;
  /** Where the relieved basis came from: the trade replay, or a broker
   *  snapshot when the trade history is partial. Null when neither answered. */
  basisSource: RealizedBasisSource | null;
  /** Typed reason the gain is unknown; null when known. */
  reason: CostBasisUnknownReason | null;
  reconciliation: RealizedDisposalReconciliation;
  wrapper: AccountWrapper;
  treatment: TaxTreatment;
};

/** The realised side of one security, as the position detail shows it. */
export type PositionRealizedSummary = {
  disposals: number;
  unknownDisposals: number;
  netProceedsCents: number | null;
  realizedGainCents: number | null;
};

export function summarizeDisposals(
  disposals: readonly RealizedDisposal[],
): PositionRealizedSummary {
  return {
    disposals: disposals.length,
    unknownDisposals: disposals.filter((row) => row.realizedGainCents === null).length,
    netProceedsCents: sumCents(disposals.map((row) => row.netProceedsCents)),
    realizedGainCents: sumCents(disposals.map((row) => row.realizedGainCents)),
  };
}

export type RealizedHolding = {
  symbol: string;
  entity: string;
  broker: string;
  account: string;
  quantity: number;
  currency: string;
  marketValueCents: number | null;
  costBasisCents: number | null;
  unrealizedGainCents: number | null;
  basisSource: RealizedBasisSource | null;
  reason: CostBasisUnknownReason | null;
  wrapper: AccountWrapper;
  treatment: TaxTreatment;
};

export type RealizedTreatmentGroup = {
  treatment: TaxTreatment;
  realizedGainCents: number | null;
  unrealizedGainCents: number | null;
  incomeCents: number | null;
  disposals: number;
  unknownDisposals: number;
  holdings: number;
  unknownHoldings: number;
};

export type RealizedAccountSummary = {
  broker: string;
  account: string;
  wrapper: AccountWrapper;
  treatment: TaxTreatment;
  realizedGainCents: number | null;
  unrealizedGainCents: number | null;
  incomeCents: number | null;
  disposals: number;
  unknownDisposals: number;
  holdings: number;
  unknownHoldings: number;
};

export type IncomeKind = "dividend" | "interest";

export type IncomeRow = {
  /** The dividend or cash-flow id the row came from. */
  id: string;
  kind: IncomeKind;
  /** The paying security; interest has no symbol and stays null. */
  symbol: string | null;
  date: string;
  /** Calendar month, `YYYY-MM`, the period the report groups by. */
  period: string;
  currency: string;
  /** Presentation cents; null when FX is missing. */
  amountCents: number | null;
  reason: "missing-fx" | null;
  broker: string;
  account: string;
  wrapper: AccountWrapper;
  treatment: TaxTreatment;
  /** Which cash-event array the row came from. */
  source: "dividend" | "cash-flow";
};

export type IncomeGroup = {
  kind: IncomeKind;
  symbol: string | null;
  period: string;
  amountCents: number | null;
  rows: number;
  unknownRows: number;
};

export type IncomeTieOut = {
  dividendTotalCents: number | null;
  interestTotalCents: number | null;
  totalCents: number | null;
  /** The interest rows aggregated straight from `CashFlow` rows of kind
   *  "interest", converted at each row's own date. The income section reads the
   *  same rows, so this is the tie-out: it must equal `interestTotalCents`. */
  sourceTotalCents: number | null;
  differenceCents: number | null;
  status: "tied" | "difference" | "missing-fx" | "no-income";
};

export type IncomeTreatmentGroup = {
  treatment: TaxTreatment;
  amountCents: number | null;
  rows: number;
  unknownRows: number;
};

export type RealizedIncomeSection = {
  rows: IncomeRow[];
  groups: IncomeGroup[];
  byTreatment: IncomeTreatmentGroup[];
  tieOut: IncomeTieOut;
};

export type RealizedIncomeReport = {
  /** The presentation currency every cents figure uses. */
  currency: string;
  asOf: string;
  disposals: RealizedDisposal[];
  holdings: RealizedHolding[];
  byTreatment: RealizedTreatmentGroup[];
  accounts: RealizedAccountSummary[];
  income: RealizedIncomeSection;
  problems: string[];
  /** Fixed copy. The report never makes a tax-filing claim. */
  notice: string;
};

/* ---------------------------------------------------------------------------
 * Wire contract
 * ------------------------------------------------------------------------- */

const NullableNumber = Schema.NullOr(Schema.Number);
const NullableString = Schema.NullOr(Schema.String);
const TreatmentSchema = Schema.Union(TAX_TREATMENTS.map((treatment) => Schema.Literal(treatment)));
const WrapperSchema = Schema.Union(ACCOUNT_WRAPPERS.map((wrapper) => Schema.Literal(wrapper)));
const BasisSourceSchema = Schema.NullOr(
  Schema.Union([Schema.Literal("calculated"), Schema.Literal("provider")]),
);
const UnknownReasonSchema = Schema.NullOr(
  Schema.Union([
    Schema.Literal("no-history"),
    Schema.Literal("transfer-in"),
    Schema.Literal("missing-fx"),
    Schema.Literal("missing-price"),
    Schema.Literal("missing-fee"),
    Schema.Literal("quantity-mismatch"),
    Schema.Literal("provider-incomplete"),
  ]),
);
const ReconciliationSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("reconciled"),
    brokerCashCents: Schema.Number,
    netProceedsCents: Schema.Number,
    differenceCents: Schema.Number,
  }),
  Schema.Struct({
    status: Schema.Literal("difference"),
    brokerCashCents: Schema.Number,
    netProceedsCents: Schema.Number,
    differenceCents: Schema.Number,
  }),
  Schema.Struct({ status: Schema.Literal("broker-not-reported") }),
  Schema.Struct({ status: Schema.Literal("not-computable") }),
  Schema.Struct({ status: Schema.Literal("missing-fx") }),
]);
const DisposalSchema = Schema.Struct({
  id: Schema.String,
  date: Schema.String,
  symbol: Schema.String,
  isin: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  entity: Schema.String,
  broker: Schema.String,
  account: Schema.String,
  quantity: Schema.Number,
  tradeCurrency: Schema.String,
  grossProceedsCents: NullableNumber,
  feesCents: NullableNumber,
  netProceedsCents: NullableNumber,
  costBasisCents: NullableNumber,
  realizedGainCents: NullableNumber,
  basisSource: BasisSourceSchema,
  reason: UnknownReasonSchema,
  reconciliation: ReconciliationSchema,
  wrapper: WrapperSchema,
  treatment: TreatmentSchema,
});
const HoldingSchema = Schema.Struct({
  symbol: Schema.String,
  entity: Schema.String,
  broker: Schema.String,
  account: Schema.String,
  quantity: Schema.Number,
  currency: Schema.String,
  marketValueCents: NullableNumber,
  costBasisCents: NullableNumber,
  unrealizedGainCents: NullableNumber,
  basisSource: BasisSourceSchema,
  reason: UnknownReasonSchema,
  wrapper: WrapperSchema,
  treatment: TreatmentSchema,
});
const TreatmentGroupSchema = Schema.Struct({
  treatment: TreatmentSchema,
  realizedGainCents: NullableNumber,
  unrealizedGainCents: NullableNumber,
  incomeCents: NullableNumber,
  disposals: Schema.Number,
  unknownDisposals: Schema.Number,
  holdings: Schema.Number,
  unknownHoldings: Schema.Number,
});
const AccountSummarySchema = Schema.Struct({
  broker: Schema.String,
  account: Schema.String,
  wrapper: WrapperSchema,
  treatment: TreatmentSchema,
  realizedGainCents: NullableNumber,
  unrealizedGainCents: NullableNumber,
  incomeCents: NullableNumber,
  disposals: Schema.Number,
  unknownDisposals: Schema.Number,
  holdings: Schema.Number,
  unknownHoldings: Schema.Number,
});
const IncomeRowSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Union([Schema.Literal("dividend"), Schema.Literal("interest")]),
  symbol: NullableString,
  date: Schema.String,
  period: Schema.String,
  currency: Schema.String,
  amountCents: NullableNumber,
  reason: Schema.NullOr(Schema.Literal("missing-fx")),
  broker: Schema.String,
  account: Schema.String,
  wrapper: WrapperSchema,
  treatment: TreatmentSchema,
  source: Schema.Union([Schema.Literal("dividend"), Schema.Literal("cash-flow")]),
});
const IncomeGroupSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("dividend"), Schema.Literal("interest")]),
  symbol: NullableString,
  period: Schema.String,
  amountCents: NullableNumber,
  rows: Schema.Number,
  unknownRows: Schema.Number,
});
const IncomeTieOutSchema = Schema.Struct({
  dividendTotalCents: NullableNumber,
  interestTotalCents: NullableNumber,
  totalCents: NullableNumber,
  sourceTotalCents: NullableNumber,
  differenceCents: NullableNumber,
  status: Schema.Union([
    Schema.Literal("tied"),
    Schema.Literal("difference"),
    Schema.Literal("missing-fx"),
    Schema.Literal("no-income"),
  ]),
});
const IncomeTreatmentGroupSchema = Schema.Struct({
  treatment: TreatmentSchema,
  amountCents: NullableNumber,
  rows: Schema.Number,
  unknownRows: Schema.Number,
});
const IncomeSectionSchema = Schema.Struct({
  rows: Schema.Array(IncomeRowSchema),
  groups: Schema.Array(IncomeGroupSchema),
  byTreatment: Schema.Array(IncomeTreatmentGroupSchema),
  tieOut: IncomeTieOutSchema,
});

export const RealizedIncomeReportSchema = Schema.Struct({
  currency: Schema.String,
  asOf: Schema.String,
  disposals: Schema.Array(DisposalSchema),
  holdings: Schema.Array(HoldingSchema),
  byTreatment: Schema.Array(TreatmentGroupSchema),
  accounts: Schema.Array(AccountSummarySchema),
  income: IncomeSectionSchema,
  problems: Schema.Array(Schema.String),
  notice: Schema.String,
});

export type RealizedIncomeReportData = DeepMutable<
  Schema.Schema.Type<typeof RealizedIncomeReportSchema>
>;

/* ---------------------------------------------------------------------------
 * Report builder
 * ------------------------------------------------------------------------- */

type Ownership = { entity: string; broker: string; account: string };

function ownershipOf(row: { entity: string; broker?: string; account?: string }): Ownership {
  return { entity: row.entity, broker: row.broker ?? "", account: row.account ?? "" };
}

function ownershipKey(value: Ownership): string {
  return JSON.stringify([value.entity, value.broker, value.account]);
}

function holdingKey(value: Ownership, symbol: string): string {
  return `${ownershipKey(value)}\u0000${symbol.toUpperCase()}`;
}

function convertOrNull(
  value: number,
  from: string,
  to: string,
  date: string,
  fxRates: FxRates,
): number | null {
  try {
    return convertCurrency(value, from, to, date, fxRates);
  } catch {
    // A missing rate and an unknown currency are both "cannot convert": the
    // report shows unknown, never a 1:1 guess.
    return null;
  }
}

function tradeGross(trade: Trade): number | null {
  if (trade.amount !== null) return Math.abs(trade.amount);
  if (trade.price !== null) return Math.abs(trade.price * trade.quantity);
  return null;
}

/** Sum a list of cents figures, keeping null only when nothing is known. */
function sumCents(values: readonly (number | null)[]): number | null {
  let total = 0;
  let known = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    known = true;
  }
  return known ? total : null;
}

/** One snapshot row's basis per unit, in presentation currency at `date`, with
 *  the provenance priority manual > provider. Used when the trade replay cannot
 *  answer, which is exactly Sure's "basis from the holding snapshot" path. */
function snapshotUnitBasis(
  rows: readonly Position[],
  presentationCurrency: string,
  fxRates: FxRates,
  date: string,
): number | null {
  for (const row of rows) {
    if (!(row.quantity > EPSILON)) continue;
    if (row.manualCostBasis) {
      const total = convertOrNull(
        row.manualCostBasis.amountCents / 100,
        row.manualCostBasis.currency,
        presentationCurrency,
        date,
        fxRates,
      );
      if (total !== null) return total / row.quantity;
    }
    if (row.brokerCost?.status === "known") {
      const total = convertOrNull(
        row.brokerCost.amount,
        row.brokerCost.currency,
        presentationCurrency,
        date,
        fxRates,
      );
      if (total !== null) return total / row.quantity;
    }
    if (row.averagePrice !== null) {
      const unit = convertOrNull(
        row.averagePrice,
        row.currency,
        presentationCurrency,
        date,
        fxRates,
      );
      if (unit !== null) return unit;
    }
  }
  return null;
}

/** The basis still held, in presentation currency, from the snapshot anchors.
 *  Follows the same priority as `selectCostBasis`: manual when every anchor
 *  carries one, else provider cost, else broker-reported average price. */
function snapshotRemainingBasis(
  anchors: readonly Position[],
  presentationCurrency: string,
  fxRates: FxRates,
): number | null {
  if (anchors.length === 0) return null;
  if (anchors.every((anchor) => anchor.manualCostBasis)) {
    const total = sumCents(
      anchors.map((anchor) =>
        convertOrNull(
          anchor.manualCostBasis!.amountCents / 100,
          anchor.manualCostBasis!.currency,
          presentationCurrency,
          anchor.asOf,
          fxRates,
        ),
      ),
    );
    if (total !== null) return total;
  }
  const providerLegs = anchors.map((anchor) =>
    anchor.brokerCost?.status === "known" ? anchor.brokerCost : null,
  );
  if (providerLegs.every((leg): leg is NonNullable<typeof leg> => leg !== null)) {
    const total = sumCents(
      anchors.map((anchor, index) =>
        convertOrNull(
          providerLegs[index]!.amount,
          providerLegs[index]!.currency,
          presentationCurrency,
          anchor.asOf,
          fxRates,
        ),
      ),
    );
    if (total !== null) return total;
  }
  if (anchors.every((anchor) => anchor.averagePrice !== null)) {
    const total = sumCents(
      anchors.map((anchor) =>
        convertOrNull(
          anchor.averagePrice! * anchor.quantity,
          anchor.currency,
          presentationCurrency,
          anchor.asOf,
          fxRates,
        ),
      ),
    );
    if (total !== null) return total;
  }
  return null;
}

/** Replay one ownership+symbol trade history into disposals.
 *
 *  The lot book primitives are `costBasis.ts`'s; this loop only records what
 *  each sale relieved. A buy whose FX cannot be resolved becomes unknown-cost
 *  units (never a 1:1 basis), exactly like a transfer-in, so a later disposal
 *  falls back to the broker snapshot instead of inventing a number. */
function replayDisposals(input: {
  trades: readonly Trade[];
  positions: readonly Position[];
  presentationCurrency: string;
  fxRates: FxRates;
  wrappers: readonly AccountWrapperEntry[];
}): RealizedDisposal[] {
  const ordered = orderTrades(input.trades);
  const book = createLotBook();
  const disposals: RealizedDisposal[] = [];
  const ownership = ownershipOf(ordered[0]!);

  for (const trade of ordered) {
    const before = openLotQuantity(book);
    if (trade.side === "other") {
      if (trade.quantity > EPSILON) addUnknownUnits(book, trade.quantity);
      else if (trade.quantity < -EPSILON) applySell(book, -trade.quantity);
      continue;
    }

    const grossValue = tradeGross(trade);
    const feeValue = trade.commission === null ? null : Math.abs(trade.commission);
    const grossPresented =
      grossValue === null
        ? null
        : convertOrNull(
            grossValue,
            trade.currency,
            input.presentationCurrency,
            trade.date,
            input.fxRates,
          );
    const feePresented =
      feeValue === null
        ? null
        : convertOrNull(
            feeValue,
            trade.currency,
            input.presentationCurrency,
            trade.date,
            input.fxRates,
          );
    const grossKnown = grossValue !== null && grossPresented !== null;
    const feeKnown = feeValue !== null && feePresented !== null;

    if (trade.side === "buy") {
      if (!grossKnown || !feeKnown) addUnknownUnits(book, trade.quantity);
      else
        addPricedUnits(book, {
          quantity: trade.quantity,
          cost: grossPresented + feePresented,
          sourceId: trade.id,
          acquiredOn: trade.date,
        });
      continue;
    }

    // A sell: relieve first, then record what the pool said before the relief.
    const unitCost = averageCost(book);
    const heldBefore = before;
    applySell(book, trade.quantity);

    const snapshotRows = input.positions
      .filter((position) => {
        const owner = ownershipOf(position);
        return (
          ownershipKey(owner) === ownershipKey(ownership) &&
          position.symbol.toUpperCase() === trade.symbol.toUpperCase() &&
          position.asOf <= trade.date
        );
      })
      .sort((left, right) => right.asOf.localeCompare(left.asOf));

    let costBasis: number | null = null;
    let basisSource: RealizedBasisSource | null = null;
    let reason: CostBasisUnknownReason | null = null;
    if (unitCost !== null && trade.quantity <= heldBefore + EPSILON) {
      costBasis = unitCost * trade.quantity;
      basisSource = "calculated";
    } else {
      const snapshotUnit = snapshotUnitBasis(
        snapshotRows,
        input.presentationCurrency,
        input.fxRates,
        trade.date,
      );
      if (snapshotUnit !== null) {
        costBasis = snapshotUnit * trade.quantity;
        basisSource = "provider";
      } else if (grossValue === null) reason = "missing-price";
      else if (!grossKnown) reason = "missing-fx";
      else if (heldBefore <= EPSILON) reason = "no-history";
      else reason = book.unknownCost ? "transfer-in" : "quantity-mismatch";
    }

    const netProceeds = grossKnown && feeKnown ? grossPresented - feePresented : null;

    let reconciliation: RealizedDisposalReconciliation;
    if (grossValue === null || feeValue === null) {
      reconciliation = { status: "not-computable" };
    } else if (!grossKnown || !feeKnown) {
      reconciliation = { status: "missing-fx" };
    } else if (!trade.settlement) {
      reconciliation = { status: "broker-not-reported" };
    } else {
      const brokerCash = convertOrNull(
        trade.settlement.amount,
        trade.settlement.currency,
        input.presentationCurrency,
        trade.date,
        input.fxRates,
      );
      if (brokerCash === null) reconciliation = { status: "missing-fx" };
      else {
        const tolerance = Math.max(0.01, Math.abs(netProceeds!) * RECONCILIATION_TOLERANCE);
        const difference = netProceeds! - brokerCash;
        const reconciled = Math.abs(difference) <= tolerance;
        reconciliation = {
          status: reconciled ? "reconciled" : "difference",
          brokerCashCents: toCents(brokerCash),
          netProceedsCents: toCents(netProceeds!),
          differenceCents: toCents(netProceeds!) - toCents(brokerCash),
        };
      }
    }

    if (reason === null && netProceeds === null && grossKnown && !feeKnown) reason = "missing-fee";

    const wrapper = resolveAccountWrapper(input.wrappers, ownership.broker, ownership.account);
    disposals.push({
      id: trade.id,
      date: trade.date,
      symbol: trade.symbol,
      ...(trade.isin ? { isin: trade.isin } : {}),
      ...(trade.description ? { description: trade.description } : {}),
      entity: trade.entity,
      broker: ownership.broker,
      account: ownership.account,
      quantity: trade.quantity,
      tradeCurrency: trade.currency,
      grossProceedsCents: grossPresented === null ? null : toCents(grossPresented),
      feesCents: feePresented === null ? null : toCents(feePresented),
      netProceedsCents: netProceeds === null ? null : toCents(netProceeds),
      costBasisCents: costBasis === null ? null : toCents(costBasis),
      realizedGainCents:
        costBasis === null || netProceeds === null
          ? null
          : toCents(netProceeds) - toCents(costBasis),
      basisSource,
      reason,
      reconciliation,
      wrapper,
      treatment: wrapperTaxTreatment(wrapper),
    });
  }
  return disposals;
}

function buildHoldings(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
  priceBars: readonly PriceBar[];
  presentationCurrency: string;
  fxRates: FxRates;
  today: string;
  wrappers: readonly AccountWrapperEntry[];
}): RealizedHolding[] {
  const groups = new Map<string, Position[]>();
  for (const position of input.positions) {
    const key = holdingKey(ownershipOf(position), position.symbol);
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }
  const barsBySymbol = new Map<string, PriceBar[]>();
  for (const bar of input.priceBars) {
    const key = bar.symbol.toUpperCase();
    barsBySymbol.set(key, [...(barsBySymbol.get(key) ?? []), bar]);
  }
  const tradesByHolding = new Map<string, Trade[]>();
  for (const trade of input.trades) {
    const key = holdingKey(ownershipOf(trade), trade.symbol);
    tradesByHolding.set(key, [...(tradesByHolding.get(key) ?? []), trade]);
  }

  const holdings: RealizedHolding[] = [];
  for (const [key, rows] of groups) {
    const anchors = latestOwnershipAnchors(rows);
    const sample = anchors[0]!;
    const quantity = anchors.reduce((sum, row) => sum + row.quantity, 0);
    if (Math.abs(quantity) <= EPSILON) continue;
    const ownership = ownershipOf(sample);
    const valuation = valuePosition({
      bars: barsBySymbol.get(sample.symbol.toUpperCase()) ?? [],
      quantity,
      valuationDate: input.today,
      presentationCurrency: input.presentationCurrency,
      fxRates: input.fxRates,
    });
    const book = createLotBook();
    for (const trade of orderTrades(tradesByHolding.get(key) ?? [])) {
      if (trade.side === "other") {
        if (trade.quantity > EPSILON) addUnknownUnits(book, trade.quantity);
        else if (trade.quantity < -EPSILON) applySell(book, -trade.quantity);
        continue;
      }
      const gross = tradeGross(trade);
      const fee = trade.commission === null ? null : Math.abs(trade.commission);
      const grossPresented =
        gross === null
          ? null
          : convertOrNull(
              gross,
              trade.currency,
              input.presentationCurrency,
              trade.date,
              input.fxRates,
            );
      const feePresented =
        fee === null
          ? null
          : convertOrNull(
              fee,
              trade.currency,
              input.presentationCurrency,
              trade.date,
              input.fxRates,
            );
      if (trade.side === "buy") {
        if (grossPresented === null || feePresented === null) addUnknownUnits(book, trade.quantity);
        else
          addPricedUnits(book, {
            quantity: trade.quantity,
            cost: grossPresented + feePresented,
            sourceId: trade.id,
            acquiredOn: trade.date,
          });
      } else applySell(book, trade.quantity);
    }
    const held = openLotQuantity(book);
    let costBasis: number | null;
    let basisSource: RealizedBasisSource | null;
    if (!book.unknownCost && held > EPSILON && Math.abs(held - quantity) <= EPSILON) {
      costBasis = book.totalCost;
      basisSource = "calculated";
    } else {
      costBasis = snapshotRemainingBasis(anchors, input.presentationCurrency, input.fxRates);
      basisSource = costBasis === null ? null : "provider";
    }
    const wrapper = resolveAccountWrapper(input.wrappers, ownership.broker, ownership.account);
    holdings.push({
      symbol: sample.symbol,
      entity: sample.entity,
      broker: ownership.broker,
      account: ownership.account,
      quantity,
      currency: sample.currency,
      marketValueCents: valuation.value === null ? null : toCents(valuation.value),
      costBasisCents: costBasis === null ? null : toCents(costBasis),
      unrealizedGainCents:
        valuation.value === null || costBasis === null
          ? null
          : toCents(valuation.value) - toCents(costBasis),
      basisSource,
      reason:
        costBasis !== null
          ? null
          : book.unknownCost
            ? "transfer-in"
            : held <= EPSILON
              ? "no-history"
              : "quantity-mismatch",
      wrapper,
      treatment: wrapperTaxTreatment(wrapper),
    });
  }
  return holdings;
}

function buildIncome(input: {
  dividends: readonly Dividend[];
  cashFlows: readonly CashFlow[];
  presentationCurrency: string;
  fxRates: FxRates;
  wrappers: readonly AccountWrapperEntry[];
}): RealizedIncomeSection {
  const rows: IncomeRow[] = [];
  const pushRow = (row: {
    id: string;
    kind: IncomeKind;
    symbol: string | null;
    date: string;
    currency: string;
    amount: number;
    broker: string;
    account: string;
    source: IncomeRow["source"];
  }) => {
    const converted = convertOrNull(
      row.amount,
      row.currency,
      input.presentationCurrency,
      row.date,
      input.fxRates,
    );
    const wrapper = resolveAccountWrapper(input.wrappers, row.broker, row.account);
    rows.push({
      id: row.id,
      kind: row.kind,
      symbol: row.symbol,
      date: row.date,
      period: row.date.slice(0, 7),
      currency: row.currency,
      amountCents: converted === null ? null : toCents(converted),
      reason: converted === null ? "missing-fx" : null,
      broker: row.broker,
      account: row.account,
      wrapper,
      treatment: wrapperTaxTreatment(wrapper),
      source: row.source,
    });
  };

  for (const dividend of input.dividends)
    pushRow({
      id: dividend.id,
      kind: "dividend",
      symbol: dividend.symbol,
      date: dividend.date,
      currency: dividend.currency,
      amount: dividend.amount,
      broker: dividend.broker,
      account: dividend.account ?? "",
      source: "dividend",
    });
  // Interest is a cash-flow kind in LaVega's model; the report reads the same
  // rows, so the tie-out below is a real re-aggregation, not a copy.
  const interestFlows = input.cashFlows.filter((flow) => flow.kind === "interest");
  for (const flow of interestFlows) {
    if (flow.amount === null) {
      const wrapper = resolveAccountWrapper(input.wrappers, flow.broker, flow.account ?? "");
      rows.push({
        id: flow.id,
        kind: "interest",
        symbol: null,
        date: flow.date,
        period: flow.date.slice(0, 7),
        currency: flow.currency,
        amountCents: null,
        reason: "missing-fx",
        broker: flow.broker,
        account: flow.account ?? "",
        wrapper,
        treatment: wrapperTaxTreatment(wrapper),
        source: "cash-flow",
      });
      continue;
    }
    pushRow({
      id: flow.id,
      kind: "interest",
      symbol: null,
      date: flow.date,
      currency: flow.currency,
      amount: flow.amount,
      broker: flow.broker,
      account: flow.account ?? "",
      source: "cash-flow",
    });
  }

  const groupMap = new Map<string, IncomeGroup>();
  for (const row of rows) {
    const key = JSON.stringify([row.kind, row.symbol, row.period]);
    const existing = groupMap.get(key);
    if (existing) {
      existing.rows += 1;
      if (row.amountCents === null) existing.unknownRows += 1;
      else existing.amountCents = (existing.amountCents ?? 0) + row.amountCents;
    } else {
      groupMap.set(key, {
        kind: row.kind,
        symbol: row.symbol,
        period: row.period,
        amountCents: row.amountCents,
        rows: 1,
        unknownRows: row.amountCents === null ? 1 : 0,
      });
    }
  }
  const groups = [...groupMap.values()].sort(
    (left, right) =>
      left.period.localeCompare(right.period) ||
      left.kind.localeCompare(right.kind) ||
      (left.symbol ?? "").localeCompare(right.symbol ?? ""),
  );

  const dividendRows = rows.filter((row) => row.kind === "dividend");
  const interestRows = rows.filter((row) => row.kind === "interest");
  const dividendTotalCents = sumCents(dividendRows.map((row) => row.amountCents));
  const interestTotalCents = sumCents(interestRows.map((row) => row.amountCents));
  // Re-aggregate the interest rows straight from the cash-flow array, the same
  // way `InvestmentStatement::Totals` sums its entries. A missing FX rate stays
  // unknown; there is no `COALESCE(rate, 1)` fallback on this path.
  const sourceTotalCents =
    interestFlows.length === 0
      ? 0
      : sumCents(
          interestFlows.map((flow) => {
            if (flow.amount === null) return null;
            const converted = convertOrNull(
              flow.amount,
              flow.currency,
              input.presentationCurrency,
              flow.date,
              input.fxRates,
            );
            return converted === null ? null : toCents(converted);
          }),
        );
  const knownTotalCents = sumCents([dividendTotalCents, interestTotalCents]);
  const unknownRows = rows.filter((row) => row.amountCents === null).length;
  const differenceCents =
    knownTotalCents === null || sourceTotalCents === null
      ? null
      : knownTotalCents - (sourceTotalCents + (dividendTotalCents ?? 0));
  const tieOut: IncomeTieOut = {
    dividendTotalCents,
    interestTotalCents,
    totalCents: knownTotalCents,
    sourceTotalCents,
    differenceCents,
    status:
      rows.length === 0
        ? "no-income"
        : unknownRows > 0
          ? "missing-fx"
          : differenceCents !== null && differenceCents === 0
            ? "tied"
            : "difference",
  };

  const byTreatment: IncomeTreatmentGroup[] = TAX_TREATMENTS.map((treatment) => {
    const treatmentRows = rows.filter((row) => row.treatment === treatment);
    return {
      treatment,
      amountCents: sumCents(treatmentRows.map((row) => row.amountCents)),
      rows: treatmentRows.length,
      unknownRows: treatmentRows.filter((row) => row.amountCents === null).length,
    };
  }).filter((group) => group.rows > 0);

  return { rows, groups, byTreatment, tieOut };
}

/** A report with no rows. Used by the route when a dashboard snapshot stored
 *  before the report existed is served, so the surface always has the shape it
 *  renders instead of an error. */
export function emptyRealizedReport(
  presentationCurrency: string,
  today: string,
  problems: readonly string[] = [],
): RealizedIncomeReportData {
  return {
    currency: presentationCurrency,
    asOf: today,
    disposals: [],
    holdings: [],
    byTreatment: [],
    accounts: [],
    income: {
      rows: [],
      groups: [],
      byTreatment: [],
      tieOut: {
        dividendTotalCents: null,
        interestTotalCents: null,
        totalCents: null,
        sourceTotalCents: null,
        differenceCents: null,
        status: "no-income",
      },
    },
    problems: [...problems],
    notice: REALIZED_REPORT_NOTICE,
  };
}

/** Build the realised-gain + income report from one broker snapshot.
 *
 *  Inputs are raw snapshot rows: splits are restated here (`splits.ts`), so a
 *  caller that already restated them must not pass this report's inputs
 *  through it a second time. */
export function buildRealizedReport(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
  dividends: readonly Dividend[];
  cashFlows?: readonly CashFlow[];
  priceBars?: readonly PriceBar[];
  presentationCurrency: string;
  fxRates: FxRates;
  accountWrappers?: readonly AccountWrapperEntry[];
  today: string;
}): RealizedIncomeReportData {
  const restated = inCurrentShareUnits(input.positions, input.trades, input.priceBars ?? []);
  const wrappers = input.accountWrappers ?? [];

  const tradeGroups = new Map<string, Trade[]>();
  for (const trade of restated.trades) {
    const key = holdingKey(ownershipOf(trade), trade.symbol);
    tradeGroups.set(key, [...(tradeGroups.get(key) ?? []), trade]);
  }
  const disposals: RealizedDisposal[] = [];
  for (const trades of tradeGroups.values())
    disposals.push(
      ...replayDisposals({
        trades,
        positions: restated.positions,
        presentationCurrency: input.presentationCurrency,
        fxRates: input.fxRates,
        wrappers,
      }),
    );
  disposals.sort((left, right) => left.date.localeCompare(right.date));

  const holdings = buildHoldings({
    positions: restated.positions,
    trades: restated.trades,
    priceBars: input.priceBars ?? [],
    presentationCurrency: input.presentationCurrency,
    fxRates: input.fxRates,
    today: input.today,
    wrappers,
  });
  const income = buildIncome({
    dividends: input.dividends,
    cashFlows: input.cashFlows ?? [],
    presentationCurrency: input.presentationCurrency,
    fxRates: input.fxRates,
    wrappers,
  });

  const byTreatment: RealizedTreatmentGroup[] = TAX_TREATMENTS.map((treatment) => {
    const treatmentDisposals = disposals.filter((row) => row.treatment === treatment);
    const treatmentHoldings = holdings.filter((row) => row.treatment === treatment);
    return {
      treatment,
      realizedGainCents: sumCents(treatmentDisposals.map((row) => row.realizedGainCents)),
      unrealizedGainCents: sumCents(treatmentHoldings.map((row) => row.unrealizedGainCents)),
      incomeCents: sumCents(
        income.rows.filter((row) => row.treatment === treatment).map((row) => row.amountCents),
      ),
      disposals: treatmentDisposals.length,
      unknownDisposals: treatmentDisposals.filter((row) => row.realizedGainCents === null).length,
      holdings: treatmentHoldings.length,
      unknownHoldings: treatmentHoldings.filter((row) => row.unrealizedGainCents === null).length,
    };
  }).filter((group) => group.disposals > 0 || group.holdings > 0 || group.incomeCents !== null);

  const accountKeys = new Map<string, { broker: string; account: string }>();
  const rememberAccount = (row: { broker?: string; account?: string }) => {
    const broker = row.broker ?? "";
    const account = row.account ?? "";
    accountKeys.set(accountWrapperKey(broker, account), { broker, account });
  };
  for (const row of restated.positions) rememberAccount(row);
  for (const row of restated.trades) rememberAccount(row);
  for (const row of input.dividends) rememberAccount(row);
  for (const row of input.cashFlows ?? []) rememberAccount(row);

  const accounts: RealizedAccountSummary[] = [...accountKeys.values()]
    .map(({ broker, account }) => {
      const wrapper = resolveAccountWrapper(wrappers, broker, account);
      const accountDisposals = disposals.filter(
        (row) => row.broker === broker && row.account === account,
      );
      const accountHoldings = holdings.filter(
        (row) => row.broker === broker && row.account === account,
      );
      return {
        broker,
        account,
        wrapper,
        treatment: wrapperTaxTreatment(wrapper),
        realizedGainCents: sumCents(accountDisposals.map((row) => row.realizedGainCents)),
        unrealizedGainCents: sumCents(accountHoldings.map((row) => row.unrealizedGainCents)),
        incomeCents: sumCents(
          income.rows
            .filter((row) => row.broker === broker && row.account === account)
            .map((row) => row.amountCents),
        ),
        disposals: accountDisposals.length,
        unknownDisposals: accountDisposals.filter((row) => row.realizedGainCents === null).length,
        holdings: accountHoldings.length,
        unknownHoldings: accountHoldings.filter((row) => row.unrealizedGainCents === null).length,
      };
    })
    .sort(
      (left, right) =>
        left.broker.localeCompare(right.broker) || left.account.localeCompare(right.account),
    );

  const differences = disposals.filter((row) => row.reconciliation.status === "difference");
  const missingFx = disposals.filter((row) => row.reason === "missing-fx");
  const problems: string[] = [];
  if (differences.length > 0)
    problems.push(
      `${differences.length} ${differences.length === 1 ? "disposal does" : "disposals do"} not reconcile to broker-reported cash minus fees.`,
    );
  if (missingFx.length > 0)
    problems.push(
      `${missingFx.length} ${missingFx.length === 1 ? "disposal has" : "disposals have"} no exact-date FX rate, so the gain stays unknown.`,
    );
  if (income.tieOut.status === "missing-fx")
    problems.push(
      "Some income rows have no exact-date FX rate, so the income total stays unknown.",
    );

  return {
    currency: input.presentationCurrency,
    asOf: input.today,
    disposals,
    holdings,
    byTreatment,
    accounts,
    income,
    problems,
    notice: REALIZED_REPORT_NOTICE,
  };
}
