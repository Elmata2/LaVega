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
import { isEurCurrency } from "./model.js";
import { accountTypeKind } from "./balance.js";
import { hash } from "./hash.js";
import { directionOfTx, magnitudeCents, toCents } from "./money.js";
import { toEur } from "./fx.js";

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
  /** Every stored decision. A confirmed pair's legs are never proposed again;
   *  a rejected pair suppresses exactly that combination forever (memory), and
   *  Sure's `rejected_transfers` join leaves its individual legs matchable. */
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

const DAY_MS = 86_400_000;

/** Absolute day number of an ISO date, for window arithmetic without a Date
 *  object per candidate. NaN for a malformed date: such a row never pairs. */
function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** A currency code that can be compared for equality. An absent/blank currency
 *  is EUR (`isEurCurrency` owns that default everywhere else), and case is not
 *  identity — a CSV import that wrote "usd" is the same currency as "USD". */
function currencyCode(currency: string): string {
  return isEurCurrency(currency)
    ? "EUR"
    : String(currency ?? "")
        .trim()
        .toUpperCase();
}

function clampFxTolerance(tolerance: number | undefined): number {
  const t = tolerance ?? TRANSFER_FX_TOLERANCE;
  if (!Number.isFinite(t)) return TRANSFER_FX_TOLERANCE;
  return Math.min(Math.max(t, 0), TRANSFER_MAX_FX_TOLERANCE);
}

/** Legs a CONFIRMED record already owns. Sure's candidate SQL excludes every
 *  row linked to an existing transfer (`existing_transfers.id IS NULL`); a
 *  rejected pair is NOT a transfer, so it claims no leg here — see
 *  `rejectedPairIds`. Fee rows count too: a fee leg belongs to that transfer and
 *  must not be re-used as the main leg of another. */
function claimedLegIds(pairs: readonly TransferPair[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pairs) {
    if (p.status !== "confirmed") continue;
    ids.add(p.outflowTxId);
    ids.add(p.inflowTxId);
    for (const fee of p.feeTxIds ?? []) ids.add(fee);
  }
  return ids;
}

/** The rejection memory, exactly as Sure stores it: one row per rejected PAIR
 *  (`rejected_transfers.inflow_transaction_id, outflow_transaction_id`), which
 *  the candidate query drops only when BOTH legs are that pair. A rejected leg
 *  stays matchable with another row: the owner said these two rows are not one
 *  transfer, not that one of them can never move. That distinction is why the
 *  memory exists beside the transfers table at all. */
function rejectedPairIds(pairs: readonly TransferPair[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pairs) {
    if (p.status === "rejected") ids.add(transferPairId(p.outflowTxId, p.inflowTxId));
  }
  return ids;
}

/** Stable identity for a pair: sorted legs, so the two ids in either order hash
 *  the same. */
export function transferPairId(outflowTxId: string, inflowTxId: string): string {
  return hash(["transfer", ...[outflowTxId, inflowTxId].sort()].join("|"));
}

/** Why these two legs may be one movement, or null when they may not. The
 *  same-currency branch is exact to the cent (Sure rank 0); only a genuinely
 *  different currency gets a band, and only with a rate that exists on both
 *  days — an unknown rate is a gap, never 1 (ADR 0011 §8-9). */
function matchEvidence(
  outflow: Tx,
  inflow: Tx,
  dateDiffDays: number,
  fxHistory: Record<string, Record<string, number>> | undefined,
  tolerance: number,
): TransferMatchEvidence | null {
  const outMagCents = magnitudeCents(outflow.amount);
  const inMagCents = magnitudeCents(inflow.amount);
  if (outMagCents === 0 || inMagCents === 0) return null;

  const outCode = currencyCode(outflow.currency);
  const inCode = currencyCode(inflow.currency);
  if (outCode === inCode) {
    if (outMagCents !== inMagCents) return null;
    return { rank: "exact", dateDiffDays, amountDeltaCents: 0, crossRate: null };
  }
  if (!fxHistory) return null;

  const outEur = toEur(Math.abs(outflow.amount), outflow.currency, outflow.date, fxHistory);
  const inEur = toEur(Math.abs(inflow.amount), inflow.currency, inflow.date, fxHistory);
  if (outEur === null || inEur === null) return null;
  const outEurCents = toCents(outEur);
  const inEurCents = toCents(inEur);
  if (outEurCents <= 0 || inEurCents <= 0) return null;

  // Sure compares the converted magnitudes with a relative band around the
  // OUTFLOW: |inflow / (outflow * rate)| ∈ [1-tol, 1+tol]. Measuring the
  // relative delta against the outflow keeps that reading without dividing by
  // the rate twice.
  const amountDeltaCents = Math.abs(outEurCents - inEurCents);
  if (amountDeltaCents > outEurCents * tolerance) return null;
  return {
    rank: "fx",
    dateDiffDays,
    amountDeltaCents,
    // Raw magnitude ratio: the inflow's units per 1 unit of the outflow
    // currency, which is what the UI quotes when it explains an FX match.
    crossRate: inMagCents / outMagCents,
  };
}

/** True when an account sits in the investment scope. LaVega's five canonical
 *  account types have no crypto entry (`ACCOUNT_TYPES` in `balance.ts`), so the
 *  owner's explicit type spelling crypto counts as investment scope too: the
 *  plan's WS4.7 distinction is "money in an investment or crypto account", not
 *  the asset class. The NAME is never consulted — a "Crypto" card is a card. */
export function isInvestmentAccount(account: Account): boolean {
  if (accountTypeKind(account) === "investment") return true;
  return /^(crypto|cripto)/i.test(account.type?.trim() ?? "");
}

/** Sure's `Transfer.kind_for_account` (`transfer.rb:31-47`): the outflow leg's
 *  kind follows the DESTINATION account, and investment → investment stays a
 *  funds movement rather than a contribution. */
export function deriveTransferKind(
  outflow: Tx,
  inflow: Tx,
  accounts: readonly Account[],
): TransferKind {
  const destination = accounts.find((a) => a.key === inflow.accountKey);
  if (!destination) return "funds_movement"; // not one of his known accounts: no claim about kind
  if (isInvestmentAccount(destination)) {
    const source = accounts.find((a) => a.key === outflow.accountKey);
    return source && isInvestmentAccount(source) ? "funds_movement" : "investment_contribution";
  }
  const kind = accountTypeKind(destination);
  if (kind === "credit") return "cc_payment";
  // No liability account kind exists yet (WS3.1), so a loan is recognised only
  // from a destination the owner typed as "Overig" AND that names itself a
  // loan. A name alone is not enough: "Kredietbank" is a bank, "lening" on a
  // current account is a note.
  if (kind === "other" && /lening|loan|hypotheek|mortgage|krediet/i.test(destination.name)) {
    return "loan_payment";
  }
  return "funds_movement";
}

/** Exact (rank 0) always outranks FX (rank 1), and the greedy consume must
 *  see that order first (Sure `:483`: match_rank dominates date_diff). */
const rankOrder = (c: TransferCandidate): number => (c.pair.evidence?.rank === "exact" ? 0 : 1);

type EvidenceDraft = { outflow: Tx; inflow: Tx; evidence: TransferMatchEvidence };

/** One suggestion per unclaimed leg pair, best candidate first, each leg used
 *  at most once (Sure's greedy consume, `auto_transfer_matchable.rb:140-157`).
 *  Ranking: exact before FX, then smaller date gap, then stable ids. Legs of a
 *  confirmed pair and pair combinations already rejected are never proposed
 *  again; a rejected pair's individual rows stay available for another pairing,
 *  exactly as Sure's `rejected_transfers` join leaves them. */
export function suggestTransfers(input: TransferMatchInput): TransferCandidate[] {
  const { txs, accounts } = input;
  const windowDays = Math.max(0, Math.floor(input.windowDays ?? TRANSFER_PAIR_WINDOW_DAYS));
  const tolerance = clampFxTolerance(input.fxTolerance);
  const fxHistory = input.fxHistory;
  const decisions = input.pairs ?? [];
  const claimed = claimedLegIds(decisions);
  const rejected = rejectedPairIds(decisions);

  const outflows: { tx: Tx; day: number }[] = [];
  const inflows: { tx: Tx; day: number }[] = [];
  for (const tx of txs) {
    if (tx.amount === 0) continue;
    const day = dayNumber(tx.date);
    if (!Number.isFinite(day)) continue;
    (directionOfTx(tx) === "out" ? outflows : inflows).push({ tx, day });
  }
  // The accountKey IS the account identity in this ledger (a Tx cannot belong to
  // an account it does not name); the account ROWS are needed only for the kind,
  // which falls back to a funds movement when one is missing. So a torn vault
  // still pairs its own money instead of silently losing the movement.
  const outCandidates = outflows;
  const inCandidates = inflows.sort((a, b) => a.day - b.day || a.tx.id.localeCompare(b.tx.id));
  const inflowDays = inCandidates.map((i) => i.day);

  // Date-indexed scan: only rows inside the window are ever compared, so the
  // matcher is O(n × rows-in-window), not O(n²) over the whole ledger.
  const drafts: EvidenceDraft[] = [];
  const firstAtOrAfter = (day: number): number => {
    let lo = 0;
    let hi = inflowDays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inflowDays[mid] < day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const out of outCandidates) {
    const from = out.day - windowDays;
    const to = out.day + windowDays;
    for (let i = firstAtOrAfter(from); i < inCandidates.length && inflowDays[i] <= to; i++) {
      const inflow = inCandidates[i];
      // Same tx cannot be both legs, even if a malformed ledger repeats an id.
      if (inflow.tx.id === out.tx.id) continue;
      if (inflow.tx.accountKey === out.tx.accountKey) continue; // a transfer needs two accounts
      const dateDiffDays = Math.abs(inflow.day - out.day);
      const evidence = matchEvidence(out.tx, inflow.tx, dateDiffDays, fxHistory, tolerance);
      if (evidence) drafts.push({ outflow: out.tx, inflow: inflow.tx, evidence });
    }
  }

  // Narrow the viable set before ambiguity is counted: a confirmed leg is
  // already part of a recorded transfer, and the rejection memory removes
  // exactly the pair the owner said was wrong. Neither competes with a
  // suggestion, so neither may make one look ambiguous.
  const viable = drafts.filter(
    (d) =>
      !rejected.has(transferPairId(d.outflow.id, d.inflow.id)) &&
      !claimed.has(d.outflow.id) &&
      !claimed.has(d.inflow.id),
  );

  // Ambiguity, measured over the FULL viable set before any leg is consumed:
  // when another candidate shares either leg, the owner must decide — even if
  // the greedy pass would have paired it anyway. This is what makes
  // auto-confirm safe (Sure's "pending" vs "confirmed" distinction).
  const touches = new Map<string, number>();
  const touch = (id: string): void => {
    touches.set(id, (touches.get(id) ?? 0) + 1);
  };
  for (const d of viable) {
    touch(d.outflow.id);
    touch(d.inflow.id);
  }

  const candidates: TransferCandidate[] = viable.map((d) => ({
    pair: {
      id: transferPairId(d.outflow.id, d.inflow.id),
      outflowTxId: d.outflow.id,
      inflowTxId: d.inflow.id,
      status: "suggested",
      kind: deriveTransferKind(d.outflow, d.inflow, accounts),
      amountCents: magnitudeCents(d.outflow.amount),
      currency: d.outflow.currency,
      createdAt: input.asOf,
      evidence: d.evidence,
    },
    ambiguous: (touches.get(d.outflow.id) ?? 0) > 1 || (touches.get(d.inflow.id) ?? 0) > 1,
  }));
  candidates.sort(
    (a, b) =>
      rankOrder(a) - rankOrder(b) ||
      (a.pair.evidence?.dateDiffDays ?? 0) - (b.pair.evidence?.dateDiffDays ?? 0) ||
      a.pair.outflowTxId.localeCompare(b.pair.outflowTxId) ||
      a.pair.inflowTxId.localeCompare(b.pair.inflowTxId),
  );

  const used = new Set(claimed);
  const suggestions: TransferCandidate[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.pair.outflowTxId) || used.has(candidate.pair.inflowTxId)) continue;
    used.add(candidate.pair.outflowTxId);
    used.add(candidate.pair.inflowTxId);
    suggestions.push(candidate);
  }
  return suggestions;
}

/** Promote the unambiguous exact two-leg proofs into stored `confirmed` pairs
 *  and return the full list to persist. Everything else stays a suggestion.
 *  Deterministic and idempotent: running it again over its own output adds
 *  nothing. */
export function autoConfirmTransfers(input: TransferMatchInput): {
  pairs: TransferPair[];
  added: TransferPair[];
} {
  // Suggestions are derived, never stored; a stored `suggested` row is not a
  // decision and must not claim its legs or be carried forward.
  const decisions = (input.pairs ?? []).filter((p) => p.status !== "suggested");
  const candidates = suggestTransfers({ ...input, pairs: decisions });
  const added = candidates
    .filter((c) => !c.ambiguous && c.pair.evidence?.rank === "exact")
    .map((c) => confirmTransfer(c.pair, input.asOf));
  return { pairs: [...decisions, ...added], added };
}

/** A suggestion becomes a decision the owner can defend later. The kind was
 *  derived when the pair was proposed; confirming keeps it. */
export function confirmTransfer(pair: TransferPair, asOf: string): TransferPair {
  return { ...pair, status: "confirmed", decidedAt: asOf };
}

/** Rejection memory (Sure `rejected_transfers`): the pair is kept as
 *  `rejected` so the matcher never proposes the same two legs again. */
export function rejectTransfer(pair: TransferPair, asOf: string): TransferPair {
  return { ...pair, status: "rejected", decidedAt: asOf };
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
  // undefined = the id was not touched by the operation, so it survives as is;
  // an explicit null = the row is gone.
  const resolve = (id: string): string | null => (remap.has(id) ? (remap.get(id) ?? null) : id);

  const kept: TransferPair[] = [];
  const dropped: TransferPair[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const outflowTxId = resolve(pair.outflowTxId);
    const inflowTxId = resolve(pair.inflowTxId);
    const feeTxIds = pair.feeTxIds?.map(resolve);
    const everyFeeSurvives = feeTxIds?.every((id) => id !== null) ?? true;
    if (outflowTxId === null || inflowTxId === null || !everyFeeSurvives) {
      dropped.push(pair);
      continue;
    }
    const next: TransferPair = {
      ...pair,
      id: transferPairId(outflowTxId, inflowTxId),
      outflowTxId,
      inflowTxId,
    };
    if (feeTxIds) next.feeTxIds = feeTxIds as string[];
    // Two stored pairs can collapse onto the same legs after a merge (the
    // absorbed twin was the same movement). The record is still lost, so it is
    // reported rather than silently deduplicated.
    if (seen.has(next.id)) {
      dropped.push(pair);
      continue;
    }
    seen.add(next.id);
    kept.push(next);
  }
  return { pairs: kept, dropped };
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
  // Only the two main legs. A fee row is a real charge in its own right and
  // must keep counting as spending; `confirmedTransferTxIds` says the same.
  const legs = confirmedTransferTxIds(pairs);
  return txs.map((tx) => (legs.has(tx.id) ? { ...tx, category: TRANSFER_CATEGORY } : tx));
}

/** Ids of every leg of a confirmed pair, for callers that need the predicate
 *  without rebuilding the projection. Fee rows are not legs of the movement:
 *  they are charged rows, so they are deliberately absent here. */
export function confirmedTransferTxIds(pairs: readonly TransferPair[]): Set<string> {
  const ids = new Set<string>();
  for (const pair of pairs) {
    if (pair.status !== "confirmed") continue;
    ids.add(pair.outflowTxId);
    ids.add(pair.inflowTxId);
  }
  return ids;
}

/** A CONFIRMED pair that moved money from a non-investment account into an
 *  investment (or crypto) one. Only a decision counts: a suggestion is a guess
 *  and must never move a total; and an investment → investment move is funds
 *  movement, not a contribution, because nothing entered the investment scope. */
export function isInvestmentContribution(pair: TransferPair): boolean {
  return pair.status === "confirmed" && pair.kind === "investment_contribution";
}

/** Confirmed pairs summed per kind, in integer cents (ADR 0011).
 *
 *  Only EUR pairs are summed. A pair stores `createdAt`/`decidedAt`, the day
 *  the owner decided — not the day the money moved — so there is no honest rate
 *  date for another currency. Those pairs are named in `unconvertedPairIds`
 *  (counted, visible) and never converted 1:1.
 *
 *  This is the one place a contribution total comes from, so the spend surface
 *  (`applyTransferDecisions`) and any net-worth bridge read the same
 *  classification instead of re-deriving it. */
export type ConfirmedTransferTotals = {
  contributionCents: number;
  fundsMovementCents: number;
  ccPaymentCents: number;
  loanPaymentCents: number;
  unconvertedPairIds: string[];
};

export function summarizeConfirmedTransfers(
  pairs: readonly TransferPair[],
): ConfirmedTransferTotals {
  const totals: ConfirmedTransferTotals = {
    contributionCents: 0,
    fundsMovementCents: 0,
    ccPaymentCents: 0,
    loanPaymentCents: 0,
    unconvertedPairIds: [],
  };
  for (const pair of pairs) {
    if (pair.status !== "confirmed") continue;
    if (!isEurCurrency(pair.currency)) {
      totals.unconvertedPairIds.push(pair.id);
      continue;
    }
    switch (pair.kind) {
      case "investment_contribution":
        totals.contributionCents += pair.amountCents;
        break;
      case "cc_payment":
        totals.ccPaymentCents += pair.amountCents;
        break;
      case "loan_payment":
        totals.loanPaymentCents += pair.amountCents;
        break;
      case "funds_movement":
        totals.fundsMovementCents += pair.amountCents;
        break;
    }
  }
  return totals;
}
