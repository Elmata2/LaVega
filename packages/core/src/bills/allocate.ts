/**
 * Allocation and close rules (WS2.5, issue #287).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/recurring_transaction/allocator.rb`,
 * `app/models/recurring_transaction/price_change_detector.rb`. No Ruby is
 * copied.
 *
 * This is the only write path for bills. `bills/match.ts` derives proposals;
 * this module turns a proposal (or a mark, or a rejection) into a persisted
 * decision and applies Sure's close rules to the occurrence:
 *
 *  - a single confirmed allocation within the amount band → paid;
 *  - otherwise the sum of allocations covers the expected amount to the cent
 *    epsilon → paid (an overpayment settles too);
 *  - anything short of that is a partial payment: the occurrence stays open
 *    with a remaining amount, and a second payment can finish it.
 *
 * Learning and history, all from Sure and all bounded:
 *  - a manual match outside the band that SETTLES the occurrence widens the
 *    learned tolerance, capped at 25%;
 *  - that same manual match teaches the counterparty spelling as an alias;
 *  - a single settled payment that differs from the expected amount records a
 *    price change, and a `fixed` series takes the new price.
 *
 * User closes never reopen automatically. A user mark is a decision; the
 * reconciliation pass only reopens a row the MATCHER closed whose transaction
 * disappeared (a replaced entry, Sure's `repair_orphan_allocations`).
 */
import type {
  Bill,
  BillDecisions,
  BillMark,
  BillMatchDecision,
  BillOccurrence,
  BillPriceChange,
  BillRejection,
} from "./model.js";
import { billDecisionsOf } from "./model.js";
import type { Account, Tx } from "../model.js";
import type { BillMatchCandidate, BillMatchInput } from "./match.js";
import {
  billAmountBandCents,
  billMatchDecisionFromCandidate,
  billRejectionKey,
  suggestBillMatches,
} from "./match.js";
import { occurrenceAmountCents } from "./occurrences.js";

/** One cent of slack on the "covered" rule. Sure compares `sum >= expected -
 *  0.01`; integer cents make that exactly one cent. */
export const BILL_CENT_EPSILON = 1;

/** The learned band never grows past Sure's 25% cap (WS2.5, allocator). */
export const BILL_MAX_LEARNED_TOLERANCE_PCT = 25;

/** How many learned aliases one series keeps; a hint list, not a dictionary. */
export const BILL_MAX_ALIASES = 8;

export type BillSettlementState = "open" | "partial" | "paid";

/** What one occurrence looks like after the stored decisions are read. Pure
 *  and derived: the vault stores the matches, the screen shows this. */
export type BillSettlement = {
  occurrenceId: string;
  billId: string;
  expectedCents: number;
  allocatedCents: number;
  /** Positive when the occurrence still needs money; 0 once it is settled. */
  remainingCents: number;
  paidAmountCents: number | null;
  state: BillSettlementState;
  closedSource: "auto" | "user" | null;
  matches: BillMatchDecision[];
  mark: BillMark | null;
};

/** The close rule for one occurrence: does the money on it settle it? */
export function billCloseRule(
  expectedCents: number,
  matches: readonly BillMatchDecision[],
  bandCents: number,
): { close: boolean; paidAmountCents: number } {
  const paidAmountCents = matches.reduce((sum, m) => sum + Math.abs(m.amountCents), 0);
  if (matches.length === 0) return { close: false, paidAmountCents };
  const singleWithinBand =
    matches.length === 1 && Math.abs(paidAmountCents - expectedCents) <= bandCents;
  const covers = paidAmountCents >= expectedCents - BILL_CENT_EPSILON;
  return { close: singleWithinBand || covers, paidAmountCents };
}

/** Read-model for every occurrence: expected, allocated, remaining, close
 *  state. The screen uses it for the partial badge and the "mark paid"
 *  amount; the matcher uses the same numbers to skip settled rows. */
export function billSettlement(
  bill: Bill,
  occurrence: BillOccurrence,
  occurrences: readonly BillOccurrence[],
  decisions: BillDecisions,
): BillSettlement {
  const expectedCents = occurrenceAmountCents(bill, occurrence, occurrences);
  const matches = decisions.matches.filter((m) => m.occurrenceId === occurrence.id);
  const mark = decisions.marks.find((m) => m.occurrenceId === occurrence.id) ?? null;
  const allocatedCents = matches.reduce((sum, m) => sum + Math.abs(m.amountCents), 0);
  const bandCents = billAmountBandCents(bill, expectedCents);
  const { close, paidAmountCents } = billCloseRule(expectedCents, matches, bandCents);
  const state: BillSettlementState = close
    ? "paid"
    : occurrence.status === "paid"
      ? "paid"
      : allocatedCents > 0
        ? "partial"
        : "open";
  return {
    occurrenceId: occurrence.id,
    billId: bill.id,
    expectedCents,
    allocatedCents,
    remainingCents: Math.max(0, expectedCents - allocatedCents),
    paidAmountCents:
      occurrence.paidAmountCents != null
        ? occurrence.paidAmountCents
        : close
          ? paidAmountCents
          : null,
    state,
    closedSource: occurrence.closedSource ?? null,
    matches,
    mark,
  };
}

/** Every occurrence's settlement, keyed by occurrence id. One map so the
 *  screen does not filter the match list per row. */
export function billSettlements(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
  decisions: BillDecisions,
): Map<string, BillSettlement> {
  const byId = new Map(bills.map((b) => [b.id, b]));
  const out = new Map<string, BillSettlement>();
  for (const occurrence of occurrences) {
    const bill = byId.get(occurrence.billId);
    if (bill == null) continue;
    out.set(occurrence.id, billSettlement(bill, occurrence, occurrences, decisions));
  }
  return out;
}

export type BillAction =
  | { kind: "confirm-match"; candidate: BillMatchCandidate; source?: "auto" | "user" }
  | { kind: "reject-match"; candidate: BillMatchCandidate }
  | { kind: "mark-paid"; occurrenceId: string; amountCents?: number };

export type BillActionInput = {
  bills: readonly Bill[];
  occurrences: readonly BillOccurrence[];
  decisions?: BillDecisions;
  txs?: readonly Tx[];
  accounts?: readonly Account[];
  asOf: string;
  action: BillAction;
};

export type BillActionOutcome = {
  bills: Bill[];
  occurrences: BillOccurrence[];
  decisions: BillDecisions;
  changed: boolean;
  /** A price change this action recorded, for the screen to announce. */
  priceChange: BillPriceChange | null;
};

/** The currency a bill counts in; an absent value is EUR, as everywhere else. */
function billCurrency(bill: Bill): string {
  return (
    String(bill.currency ?? "")
      .trim()
      .toUpperCase() || "EUR"
  );
}

/** Normalize a descriptor for alias comparison: lowercase, one space between
 *  tokens. Kept local so allocate.ts has no dependency on the label packs. */
function aliasForm(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Apply the close rules after a payment decision, and return what changed.
 *  Pure: the caller merges the result into one vault save. */
function settleOccurrence(args: {
  bill: Bill;
  occurrence: BillOccurrence;
  occurrences: readonly BillOccurrence[];
  decisions: BillDecisions;
  txById: ReadonlyMap<string, Tx>;
  asOf: string;
  source: "auto" | "user";
}): { bill: Bill; occurrence: BillOccurrence; priceChange: BillPriceChange | null } {
  const { occurrence, occurrences, decisions, txById, asOf, source } = args;
  let bill = args.bill;
  // A closed row was closed by an earlier decision; auto work never edits it.
  if (occurrence.status !== "scheduled") return { bill, occurrence, priceChange: null };

  const matches = decisions.matches.filter((m) => m.occurrenceId === occurrence.id);
  const expectedCents = occurrenceAmountCents(bill, occurrence, occurrences);
  const bandCents = billAmountBandCents(bill, expectedCents);
  const { close, paidAmountCents } = billCloseRule(expectedCents, matches, bandCents);
  if (!close) return { bill, occurrence, priceChange: null };

  const tx = matches.length === 1 ? txById.get(matches[0].txId) : undefined;
  const nextOccurrence: BillOccurrence = {
    ...occurrence,
    status: "paid",
    paidOn: tx?.date ?? asOf,
    paidAmountCents,
    closedAt: asOf,
    closedSource: source,
  };

  let priceChange: BillPriceChange | null = null;
  const delta = paidAmountCents - expectedCents;
  if (matches.length === 1 && Math.abs(delta) > BILL_CENT_EPSILON) {
    const already = decisions.priceChanges.some(
      (pc) =>
        pc.billId === bill.id &&
        pc.effectiveOn === occurrence.dueOn &&
        pc.newAmountCents === paidAmountCents,
    );
    if (!already) {
      priceChange = {
        billId: bill.id,
        effectiveOn: occurrence.dueOn,
        oldAmountCents: expectedCents,
        newAmountCents: paidAmountCents,
        currency: billCurrency(bill),
        detectedAt: asOf,
        source,
      };
      decisions.priceChanges.push(priceChange);
    }
    // Only a fixed price is a stored price. `average` and `last` derive their
    // amount on read (ADR 0011: no sweep over rows), so writing one here
    // would fight the strategy.
    if (bill.amountStrategy === "fixed") {
      bill = { ...bill, amountCents: Math.abs(paidAmountCents) };
    }
  }

  // Learning is the owner's own correction: a manual match outside the band
  // that settles the occurrence widens the band and teaches the spelling.
  if (source === "user" && matches.length === 1) {
    if (expectedCents > 0 && Math.abs(delta) > bandCents) {
      const learned = Math.min(
        BILL_MAX_LEARNED_TOLERANCE_PCT,
        Math.ceil((Math.abs(delta) / expectedCents) * 100),
      );
      if (learned > (bill.learnedTolerancePct ?? 0)) {
        bill = { ...bill, learnedTolerancePct: learned };
      }
    }
    const alias = (tx?.counterparty ?? "").trim();
    if (alias !== "") {
      const form = aliasForm(alias);
      const aliases = bill.aliases ?? [];
      const known = aliases.some((a) => aliasForm(a) === form) || aliasForm(bill.name) === form;
      if (!known && aliases.length < BILL_MAX_ALIASES) {
        bill = { ...bill, aliases: [...aliases, alias] };
      }
    }
  }

  return { bill, occurrence: nextOccurrence, priceChange };
}

/** Turn one user or matcher action into the next persisted state. The caller
 *  writes all three lists in ONE `putBillPlan` save. */
export function applyBillAction(input: BillActionInput): BillActionOutcome {
  const decisions = billDecisionsOf(input.decisions);
  const bills = [...input.bills];
  const occurrences = [...input.occurrences];
  const txById = new Map((input.txs ?? []).map((tx) => [tx.id, tx]));
  const billIndex = new Map(bills.map((b, i) => [b.id, i]));
  const occurrenceIndex = new Map(occurrences.map((o, i) => [o.id, i]));
  let changed = false;
  let priceChange: BillPriceChange | null = null;

  const action = input.action;
  if (action.kind === "reject-match") {
    const key = billRejectionKey(action.candidate.billId, action.candidate.txId);
    if (!decisions.rejections.some((r) => billRejectionKey(r.billId, r.txId) === key)) {
      const rejection: BillRejection = {
        billId: action.candidate.billId,
        txId: action.candidate.txId,
        occurrenceId: action.candidate.occurrenceId,
        rejectedAt: input.asOf,
      };
      decisions.rejections.push(rejection);
      changed = true;
    }
    return { bills, occurrences, decisions, changed, priceChange: null };
  }

  if (action.kind === "mark-paid") {
    const index = occurrenceIndex.get(action.occurrenceId);
    if (index == null) {
      return { bills, occurrences, decisions, changed: false, priceChange: null };
    }
    const occurrence = occurrences[index];
    const bill = bills[billIndex.get(occurrence.billId) ?? -1];
    if (bill == null) return { bills, occurrences, decisions, changed: false, priceChange: null };
    const expectedCents = occurrenceAmountCents(bill, occurrence, occurrences);
    const amountCents = Math.max(0, action.amountCents ?? expectedCents);
    const mark: BillMark = {
      occurrenceId: occurrence.id,
      billId: occurrence.billId,
      paidOn: input.asOf,
      amountCents,
      currency: billCurrency(bill),
      markedAt: input.asOf,
    };
    const existing = decisions.marks.findIndex((m) => m.occurrenceId === occurrence.id);
    if (existing >= 0) decisions.marks[existing] = mark;
    else decisions.marks.push(mark);
    occurrences[index] = {
      ...occurrence,
      status: "paid",
      paidOn: input.asOf,
      paidAmountCents: amountCents,
      closedAt: input.asOf,
      // A user close is final: a later matcher pass never reopens it.
      closedSource: "user",
    };
    changed = true;
    return { bills, occurrences, decisions, changed, priceChange: null };
  }

  // confirm-match (matcher's exact tier or the owner)
  const source = action.source ?? "user";
  const match = billMatchDecisionFromCandidate(action.candidate, source, input.asOf);
  if (decisions.matches.some((m) => m.id === match.id)) {
    return { bills, occurrences, decisions, changed: false, priceChange: null };
  }
  const occurrence = occurrences[occurrenceIndex.get(match.occurrenceId) ?? -1];
  const billIndexForMatch = billIndex.get(match.billId);
  if (occurrence == null || billIndexForMatch == null) {
    return { bills, occurrences, decisions, changed: false, priceChange: null };
  }
  decisions.matches.push(match);
  changed = true;
  const settled = settleOccurrence({
    bill: bills[billIndexForMatch],
    occurrence,
    occurrences,
    decisions,
    txById,
    asOf: input.asOf,
    source,
  });
  bills[billIndexForMatch] = settled.bill;
  occurrences[occurrenceIndex.get(match.occurrenceId) as number] = settled.occurrence;
  priceChange = settled.priceChange;
  return { bills, occurrences, decisions, changed, priceChange };
}

export type BillReconcileInput = {
  bills: readonly Bill[];
  occurrences: readonly BillOccurrence[];
  decisions?: BillDecisions;
  txs: readonly Tx[];
};

export type BillReconcileResult = {
  bills: Bill[];
  occurrences: BillOccurrence[];
  decisions: BillDecisions;
  dropped: {
    matches: BillMatchDecision[];
    marks: BillMark[];
    rejections: BillRejection[];
    priceChanges: BillPriceChange[];
  };
  reopened: BillOccurrence[];
  changed: boolean;
};

/**
 * Sure's `repair_orphan_allocations`, adapted to a content-addressed ledger.
 * A `tx.id` can disappear after a re-import that rewrote a descriptor; a
 * closed-by-matcher occurrence whose only payment is gone must not stay
 * "paid". Mark/owner closes are decisions and are left alone.
 */
export function reconcileBillDecisions(input: BillReconcileInput): BillReconcileResult {
  const decisions = billDecisionsOf(input.decisions);
  const billIds = new Set(input.bills.map((b) => b.id));
  const occurrenceIds = new Set(input.occurrences.map((o) => o.id));
  const txIds = new Set(input.txs.map((tx) => tx.id));

  const dropped: BillReconcileResult["dropped"] = {
    matches: [],
    marks: [],
    rejections: [],
    priceChanges: [],
  };
  // Occurrences that HAD a stored allocation before this pass. A row that was
  // already closed without one (a #286 vault with fixture history, or a close
  // written by an older build) is not reopened: the repair pass exists for a
  // payment whose transaction disappeared, not to reopen settled history.
  const hadMatches = new Set<string>();
  for (const match of decisions.matches) hadMatches.add(match.occurrenceId);
  const matchIds = new Set<string>();
  decisions.matches = decisions.matches.filter((match) => {
    const keep =
      billIds.has(match.billId) && occurrenceIds.has(match.occurrenceId) && txIds.has(match.txId);
    if (!keep) dropped.matches.push(match);
    else matchIds.add(match.occurrenceId);
    return keep;
  });
  decisions.marks = decisions.marks.filter((mark) => {
    const keep = billIds.has(mark.billId) && occurrenceIds.has(mark.occurrenceId);
    if (!keep) dropped.marks.push(mark);
    return keep;
  });
  decisions.rejections = decisions.rejections.filter((rejection) => {
    const keep = billIds.has(rejection.billId) && txIds.has(rejection.txId);
    if (!keep) dropped.rejections.push(rejection);
    return keep;
  });
  decisions.priceChanges = decisions.priceChanges.filter((priceChange) => {
    const keep = billIds.has(priceChange.billId);
    if (!keep) dropped.priceChanges.push(priceChange);
    return keep;
  });

  const reopened: BillOccurrence[] = [];
  const occurrences = input.occurrences.map((occurrence) => {
    const autoClosed = occurrence.status === "paid" && occurrence.closedSource === "auto";
    if (!autoClosed || !hadMatches.has(occurrence.id) || matchIds.has(occurrence.id)) {
      return occurrence;
    }
    const next: BillOccurrence = { ...occurrence, status: "scheduled" };
    delete next.paidOn;
    delete next.paidAmountCents;
    delete next.closedAt;
    delete next.closedSource;
    reopened.push(next);
    return next;
  });

  const changed =
    dropped.matches.length > 0 ||
    dropped.marks.length > 0 ||
    dropped.rejections.length > 0 ||
    dropped.priceChanges.length > 0 ||
    reopened.length > 0;
  return { bills: [...input.bills], occurrences, decisions, dropped, reopened, changed };
}

export type BillMatcherRun = {
  bills: Bill[];
  occurrences: BillOccurrence[];
  decisions: BillDecisions;
  /** Decisions the exact tier added in this pass. */
  added: BillMatchDecision[];
  priceChanges: BillPriceChange[];
  changed: boolean;
};

/**
 * The full lazy pipeline for unlock/import: repair, derive suggestions, let
 * the exact tier write itself, and settle what it settled. One call, one
 * resulting state, one vault save by the caller. Idempotent: a second run
 * over its own output adds nothing.
 */
export function runBillMatcher(input: BillMatchInput): BillMatcherRun {
  const repaired = reconcileBillDecisions({
    bills: input.bills,
    occurrences: input.occurrences,
    decisions: input.decisions,
    txs: input.txs,
  });
  let bills = repaired.bills;
  let occurrences = repaired.occurrences;
  let decisions = repaired.decisions;
  const added: BillMatchDecision[] = [];
  const priceChanges: BillPriceChange[] = [];

  const candidates = suggestBillMatches({ ...input, bills, occurrences, decisions });
  for (const candidate of candidates) {
    if (candidate.tier !== "auto" || candidate.ambiguous || candidate.evidence.pending) continue;
    // The candidate list already claimed each occurrence and transaction once;
    // this guard keeps the pass safe if a settlement closed an earlier row.
    const occurrence = occurrences.find((o) => o.id === candidate.occurrenceId);
    if (occurrence == null || occurrence.status !== "scheduled") continue;
    const outcome = applyBillAction({
      bills,
      occurrences,
      decisions,
      txs: input.txs,
      accounts: input.accounts,
      asOf: input.asOf,
      action: { kind: "confirm-match", candidate, source: "auto" },
    });
    if (!outcome.changed) continue;
    bills = outcome.bills;
    occurrences = outcome.occurrences;
    decisions = outcome.decisions;
    added.push(decisions.matches[decisions.matches.length - 1] as BillMatchDecision);
    if (outcome.priceChange != null) priceChanges.push(outcome.priceChange);
  }

  return {
    bills,
    occurrences,
    decisions,
    added,
    priceChanges,
    changed: repaired.changed || added.length > 0,
  };
}

/** The decisions section, safe to hand to a view: never the stored object. */
export function readBillDecisions(decisions?: BillDecisions): BillDecisions {
  return billDecisionsOf(decisions);
}
