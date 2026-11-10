/**
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-10.
 *
 * Sure source: `app/models/family/auto_transfer_matchable.rb`,
 * `app/models/transfer.rb`, `app/models/transaction/transferable.rb`,
 * `app/models/rejected_transfer.rb` — AGPL-3.0. No Ruby is copied; the
 * matching rules and lifecycle are reimplemented for LaVega's ledger.
 *
 * Sure stores outflow POSITIVE (`app/models/entry.rb:325-327`). This module
 * reads LaVega's `Tx` (negative = outflow) at the boundary through
 * `money.ts` and compares positive magnitudes in integer cents.
 *
 * ONE TRANSFER IS A RECORD, NOT A CATEGORY GUESS. Today an internal move only
 * becomes "Eigen overboeking" when the counterparty text happens to name
 * another imported account (`views.ts:182-194`); nothing persists the pair, so
 * an unnamed move counts as spending on both legs and an account merge can
 * never reconcile it. A `TransferPair` is that missing record: two existing
 * `tx.id`s, a lifecycle status, and the evidence that joined them. `tx.id`
 * and its hash inputs stay untouched (ADR 0011, plan §2.2).
 *
 * Lifecycle (plan §6, research 03-lavega-state §8.2):
 *   suggested → confirmed | rejected
 * Suggestions are DERIVED on read from the current ledger, never stored: a
 * new import can invalidate a pending suggestion, so persisting one would leave
 * a stale claim in the vault. Only DECISIONS are stored: `confirmed` pairs
 * (which drive spend exclusion and the row badge) and `rejected` pairs (the
 * rejection memory: the same two legs are not proposed again). This is Sure's
 * pending/confirmed split with the pending row recomputed instead of a table
 * (`transfer.rb:186-206`, `rejected_transfer.rb`).
 */
import type { Account, Tx } from "./model.js";

/** The category a confirmed transfer is projected into for every spend
 *  aggregation. Same string `views.ts` already uses for its heuristic, because
 *  the exclusion rules downstream (`MOVED_CATEGORIES`, forecast incidentals,
 *  `cleanTxs`) key on it; one category, one meaning. */
export const TRANSFER_CATEGORY = "Eigen overboeking";

/** Four days, same measured-not-yet number as the boundary module
 *  (`crossScope.ts:345`): same-day or next-day SEPA, and a credit card can lag
 *  a couple of days before it books a payment. Too narrow drops a real pair
 *  (the total shrinks), too wide pairs unrelated rows (invisible inflation). */
export const TRANSFER_PAIR_WINDOW_DAYS = 4;

/** Sure's default cross-currency tolerance (`auto_transfer_matchable.rb:6`).
 *  A same-currency pair must match to the cent; only an FX leg gets a band. */
export const TRANSFER_FX_TOLERANCE = 0.1;

/** Sure caps a configured tolerance at 50% (`auto_transfer_matchable.rb:10`). */
export const TRANSFER_MAX_FX_TOLERANCE = 0.5;

export type TransferStatus = "suggested" | "confirmed" | "rejected";

/** Sure's transfer kinds, mapped to LaVega's account kinds where one exists
 *  (`transfer.rb:31-47`). `loan_payment` needs an account that names itself a
 *  loan; LaVega has no liability account kind yet, so it is derived from the
 *  destination account's NAME until WS3.1 lands a real kind. */
export type TransferKind =
  | "funds_movement"
  | "cc_payment"
  | "loan_payment"
  | "investment_contribution";

/** Why the matcher joined these two legs, kept on the record so the UI can
 *  explain a match instead of asking the owner to trust it. */
export type TransferMatchEvidence = {
  /** `exact`: same currency, equal magnitudes to the cent (Sure match_rank 0).
   *  `fx`: different currencies within the tolerance band (match_rank 1). */
  rank: "exact" | "fx";
  dateDiffDays: number;
  /** Absolute EUR-cent difference between the two legs after conversion.
   *  Always 0 for `exact`. */
  amountDeltaCents: number;
  /** Inflow units per 1 outflow currency; null for `exact`. */
  crossRate: number | null;
};

/** One stored decision (confirmed or rejected) or one derived suggestion.
 *
 *  Plan §6 shape `{id, outflowTxId, inflowTxId, status, kind, feeTxIds?,
 *  createdAt, decidedAt}`, plus the ADR 0011 magnitude and the evidence. */
export type TransferPair = {
  /** Content id over the two tx ids, order-insensitive: a re-import that keeps
   *  the same transactions keeps the same transfer identity. */
  id: string;
  /** The negative leg (money left this account). */
  outflowTxId: string;
  /** The positive leg (money entered that account). */
  inflowTxId: string;
  status: TransferStatus;
  kind: TransferKind;
  /** Positive magnitude of the outflow leg, in `currency` (ADR 0011: a record
   *  carries direction via its two ids, never a bare signed amount). */
  amountCents: number;
  currency: string;
  /** Fee legs belong to the transfer but are charged rows in their own right;
   *  Sure creates them only from the manual creator, never from auto-matching
   *  (`transfer/creator.rb:56-61`, `transfer.rb:5`). Nothing creates them in
   *  this slice; the field exists so reconciliation never orphans one. */
  feeTxIds?: string[];
  createdAt: string;
  /** Set when the pair moves to confirmed/rejected; absent while suggested. */
  decidedAt?: string;
  evidence?: TransferMatchEvidence;
};

/** A suggestion plus whether another candidate competes for one of its legs.
 *  An ambiguous pair is never auto-confirmed; the owner resolves it. */
export type TransferCandidate = { pair: TransferPair; ambiguous: boolean };

export type TransferMatchInput = {
  readonly txs: readonly Tx[];
  readonly accounts: readonly Account[];
  /** Every stored decision. Their legs are never proposed again, and a
   *  rejected pair suppresses the same two legs forever (memory). */
  readonly pairs?: readonly TransferPair[];
  /** ECB per-currency history (`units per 1 EUR`) for the cross-currency
   *  branch. Absent means no FX candidates: an unknown rate is skipped, never
   *  treated as 1 (ADR 0011 §9). */
  readonly fxHistory?: Record<string, Record<string, number>>;
  /** Defaults to `TRANSFER_PAIR_WINDOW_DAYS`. */
  readonly windowDays?: number;
  /** Defaults to `TRANSFER_FX_TOLERANCE`, clamped to `TRANSFER_MAX_FX_TOLERANCE`. */
  readonly fxTolerance?: number;
  /** ISO day a new decision is dated (`createdAt` / `decidedAt`). Core stays
   *  clock-free (plan §2.3). */
  readonly asOf: string;
};

/** Stable identity for a pair: sorted legs, so the two ids in either order hash
 *  the same. */
export function transferPairId(outflowTxId: string, inflowTxId: string): string {
  throw new Error("not implemented: transferPairId");
}

/** One suggestion per unclaimed leg pair, best candidate first, each leg used
 *  at most once (Sure's greedy consume, `auto_transfer_matchable.rb:140-157`).
 *  Ranking: exact before FX, then smaller date gap, then stable ids. Legs
 *  already carried by a stored decision are excluded. */
export function suggestTransfers(input: TransferMatchInput): TransferCandidate[] {
  throw new Error("not implemented: suggestTransfers");
}

/** Promote the unambiguous exact two-leg proofs into stored `confirmed` pairs
 *  and return the full list to persist. Everything else stays a suggestion.
 *  Deterministic and idempotent: running it again over its own output adds
 *  nothing. */
export function autoConfirmTransfers(input: TransferMatchInput): {
  pairs: TransferPair[];
  added: TransferPair[];
} {
  throw new Error("not implemented: autoConfirmTransfers");
}

/** A suggestion becomes a decision the owner can defend later. The kind was
 *  derived when the pair was proposed; confirming keeps it. */
export function confirmTransfer(pair: TransferPair, asOf: string): TransferPair {
  throw new Error("not implemented: confirmTransfer");
}

/** Rejection memory (Sure `rejected_transfers`): the pair is kept as
 *  `rejected` so the matcher never proposes the same two legs again. */
export function rejectTransfer(pair: TransferPair, asOf: string): TransferPair {
  throw new Error("not implemented: rejectTransfer");
}

/** Sure's `Transfer.kind_for_account` (`transfer.rb:31-47`): the outflow leg's
 *  kind follows the DESTINATION account, and investment → investment stays a
 *  funds movement rather than a contribution. */
export function deriveTransferKind(
  outflow: Tx,
  inflow: Tx,
  accounts: readonly Account[],
): TransferKind {
  throw new Error("not implemented: deriveTransferKind");
}

/** Reconcile stored pairs after account operations that re-key or remove
 *  `tx.id`s (plan §2.2). `remap` maps an old id to its new id, or to null when
 *  the row itself disappeared (a merged overlap). A pair survives only when
 *  both legs AND every fee leg survive; the dropped ones come back so the UI
 *  can say what was lost instead of orphaning silently.
 *
 *  Merge: the `txIdRemap` returned by `mergeAccounts`.
 *  Delete: every removed id mapped to null (`txIdsForAccount`). */
export function reconcileTransfers(
  pairs: readonly TransferPair[],
  remap: ReadonlyMap<string, string | null>,
): { pairs: TransferPair[]; dropped: TransferPair[] } {
  throw new Error("not implemented: reconcileTransfers");
}

/** Read-model projection: copy the ledger with every CONFIRMED transfer leg
 *  carrying `TRANSFER_CATEGORY`. All existing spend surfaces already exclude
 *  that category (`MOVED_CATEGORIES`, forecast incidentals, `cleanTxs`,
 *  `categoryComparison`), so this is the one place the record becomes
 *  authoritative (plan risk: "make one predicate: confirmed transfer pair is
 *  authoritative").
 *
 *  NEVER persisted: this is derived on read exactly because a manual category
 *  and a rule must not be rewritten by a transfer confirmation (rejecting the
 *  pair later must restore what the row said before). */
export function applyTransferDecisions(txs: readonly Tx[], pairs: readonly TransferPair[]): Tx[] {
  throw new Error("not implemented: applyTransferDecisions");
}

/** Ids of every leg of a confirmed pair, for callers that need the predicate
 *  without rebuilding the projection. */
export function confirmedTransferTxIds(pairs: readonly TransferPair[]): Set<string> {
  throw new Error("not implemented: confirmedTransferTxIds");
}
