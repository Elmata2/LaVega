/**
 * Payment matcher (WS2.4, issue #287).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/recurring_transaction/matcher.rb` (confidence
 * scoring, tiers, window, ambiguity guard). No Ruby is copied.
 *
 * WHY. The bills screen (#286) shows what is due, but nothing connects a real
 * bank row to the occurrence it paid. This module is the derived half of that
 * connection: it proposes occurrence↔transaction candidates from the ledger on
 * read, the same way `suggestTransfers` proposes transfer pairs. Only the
 * owner's or the matcher's DECISIONS persist (`bills/allocate.ts` writes them);
 * a stored suggestion would go stale on the next import.
 *
 * Sure's scoring, kept as-is:
 *   merchant / alias / transfer  0.40
 *   bill name                    0.35
 *   amount exact (<1 cent)       0.30
 *   amount within band           0.25 - distance/band * 0.10
 *   date at due date             0.20, linear down to 0.05 at the window edge
 *   account                      0.10
 * Hard filters: currency, account, sign, and a merchant/name/alias/transfer
 * hit — a candidate that names no party is not proposed. Tiers: >= 0.85 is the
 * exact tier (auto-link, never for a pending row), >= 0.60 a suggestion. The
 * ambiguity margin is 0.15: a runner-up that close means the owner decides.
 *
 * Core stays clock-free: the window is measured from the occurrence's due date
 * and the tx's own date, and `asOf` only decides how far an OVERDUE occurrence
 * may look forward.
 */
import type { Bill, BillDecisions, BillMatchDecision, BillOccurrence } from "./model.js";
import type { Account, Tx } from "../model.js";
import { EMPTY_BILL_DECISIONS } from "./model.js";
import { billDaysBetween, occurrencesPerYear } from "./schedule.js";
import { occurrenceAmountCents } from "./occurrences.js";
import { hash } from "../hash.js";
import { magnitudeCents } from "../money.js";
import { canonicalMerchantKey } from "../labels.js";

/** Sure's exact tier (`matcher.rb:11-18`): a match at or above this score is
 *  written as a confirmed allocation, unless the row is pending or another
 *  candidate ties it. */
export const BILL_MATCH_AUTO_TIER = 0.85;

/** Sure's high tier: at or above this score the candidate is proposed. Below
 *  it the candidate is noise and is not shown. */
export const BILL_MATCH_SUGGEST_TIER = 0.6;

/** A runner-up within this margin makes the top candidate ambiguous. The owner
 *  resolves it; the matcher never auto-links either one. */
export const BILL_MATCH_AMBIGUITY_MARGIN = 0.15;

/** Sure's `match_days_early` / `match_days_late` defaults, capped per side at
 *  half a cycle so two adjacent occurrences cannot claim one entry. */
export const BILL_MATCH_EARLY_DAYS = 2;
export const BILL_MATCH_LATE_DAYS = 7;

/** Sure's `amount_tolerance_pct` default; the learned tolerance max is 25. */
export const BILL_AMOUNT_TOLERANCE_PCT = 7.5;
export const BILL_MAX_TOLERANCE_PCT = 25;

/** The score weights, in one table so the tests and the explanation cannot
 *  drift apart. */
export const BILL_MATCH_WEIGHTS = {
  merchant: 0.4,
  name: 0.35,
  transfer: 0.4,
  amountExact: 0.3,
  amountBand: 0.25,
  amountBandDrop: 0.1,
  dateDue: 0.2,
  dateEdge: 0.05,
  account: 0.1,
} as const;

/** Why the matcher proposed this row, kept in the candidate (not persisted:
 *  the stored decision keeps the confidence; the evidence explains the screen). */
export type BillMatchEvidence = {
  /** What named the party: merchant equals/alias, the bill's own name, or a
   *  transfer series matched on its account. */
  matchedOn: "merchant" | "alias" | "transfer" | "name";
  /** Signed difference between the tx magnitude and the expected amount. */
  amountDeltaCents: number;
  /** tx date minus due date, in days (negative = paid early). */
  dateDiffDays: number;
  /** Booked but not settled: a candidate, never an auto-link. */
  pending: boolean;
  /** The party score and the amount score, so the UI can explain a weak match. */
  partyWeight: number;
  amountWeight: number;
};

export type BillMatchCandidate = {
  occurrenceId: string;
  billId: string;
  txId: string;
  /** Positive magnitude in `currency`. The allocation may use less when the
   *  owner splits one payment across bills; the matcher proposes the full row. */
  amountCents: number;
  currency: string;
  /** The tx's own date, carried so a confirm can date the close without a
   *  second lookup. */
  txDate: string;
  /** The tx's display text (counterparty first), for the suggestion line. */
  txName: string;
  confidence: number;
  tier: "auto" | "suggest";
  /** A competing candidate is within `BILL_MATCH_AMBIGUITY_MARGIN`. */
  ambiguous: boolean;
  evidence: BillMatchEvidence;
};

export type BillMatchInput = {
  readonly bills: readonly Bill[];
  readonly occurrences: readonly BillOccurrence[];
  readonly txs: readonly Tx[];
  /** Every stored decision. Confirmed matches claim their transaction's
   *  capacity; rejections suppress exactly that series/transaction pair. */
  readonly decisions?: BillDecisions;
  readonly accounts?: readonly Account[];
  /** ISO day; only used to let an overdue occurrence look forward to "now". */
  readonly asOf: string;
};

/** Language-neutral comparison form: lowercase, no diacritics, one space
 *  between word tokens. Bank labels and bill names meet here. */
function comparisonForm(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Token containment in either direction, with short tokens ignored so "de"
 *  or "b.v." cannot make two unrelated names equal. This is the same loose
 *  reading Sure's name matching does without a second dictionary. */
function nameMatches(needle: string, haystack: string): boolean {
  const a = comparisonForm(needle);
  const b = comparisonForm(haystack);
  if (a === "" || b === "") return false;
  if (a === b) return true;
  const aTokens = a.split(" ").filter((t) => t.length >= 3);
  const bTokens = b.split(" ").filter((t) => t.length >= 3);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  return aTokens.every((t) => b.includes(t)) || bTokens.every((t) => a.includes(t));
}

/** Everything a transaction says about itself, in one string. */
function txText(tx: Pick<Tx, "counterparty" | "description">): string {
  return `${tx.counterparty ?? ""} ${tx.description ?? ""}`.trim();
}

/** The currency identity, so a CSV that wrote "usd" and one that wrote "USD"
 *  are the same currency. An absent currency is EUR via `isEurCurrency`
 *  elsewhere; here an absent value simply reads as the empty string and then
 *  is stamped as EUR by the caller. */
function currencyCode(currency: string | null | undefined): string {
  return String(currency ?? "")
    .trim()
    .toUpperCase();
}

/** The amount band the series currently allows: the owner's tolerance or the
 *  learned one, whichever is wider, capped at 25% (Sure's `max(amount_tolerance_pct,
 *  learned_tolerance)` with a hard cap). */
export function billAmountBandCents(bill: Bill, expectedCents: number): number {
  const pct = Math.min(
    BILL_MAX_TOLERANCE_PCT,
    Math.max(bill.amountTolerancePct ?? BILL_AMOUNT_TOLERANCE_PCT, bill.learnedTolerancePct ?? 0),
  );
  return Math.max(1, Math.round((Math.abs(expectedCents) * Math.max(0, pct)) / 100));
}

/** Half a cycle in days: the hard cap on each side of the match window. A
 *  yearly bill gets a wide cap; a weekly one gets three days. */
function halfCycleDays(bill: Bill): number {
  const perYear = occurrencesPerYear(bill);
  const cycleDays = perYear > 0 ? 365.25 / perYear : 30;
  return Math.max(1, Math.floor(cycleDays / 2));
}

/** The window for one occurrence. An overdue occurrence looks forward to
 *  `asOf` (Sure extends it to today), which is why the CLI pass can match a
 *  bill that was due two weeks ago but paid late. */
export function billMatchWindow(
  bill: Bill,
  occurrence: Pick<BillOccurrence, "dueOn">,
  asOf: string,
): { earlyDays: number; lateDays: number } {
  const half = halfCycleDays(bill);
  const earlyDays = Math.min(Math.max(0, bill.matchDaysEarly ?? BILL_MATCH_EARLY_DAYS), half);
  const configuredLate = Math.min(Math.max(0, bill.matchDaysLate ?? BILL_MATCH_LATE_DAYS), half);
  const overdueDays =
    occurrence.dueOn < asOf ? Math.max(0, billDaysBetween(occurrence.dueOn, asOf)) : 0;
  return { earlyDays, lateDays: Math.max(configuredLate, overdueDays) };
}

/** The content identity of one allocation. Order-free by construction: one
 *  occurrence and one transaction, both named. */
export function billMatchId(occurrenceId: string, txId: string): string {
  return hash(["bill-match", occurrenceId, txId].join("|"));
}

/** The rejection-memory key. Sure keys on (recurring_transaction_id,
 *  entry_id), NOT on the occurrence: the owner said "this payment is not this
 *  series", so no future occurrence of that series may claim that row. */
export function billRejectionKey(billId: string, txId: string): string {
  return `${billId}|${txId}`;
}

/** Stored rejections as a set of `billId|txId`. */
export function rejectedBillMatches(decisions: BillDecisions): Set<string> {
  const set = new Set<string>();
  for (const rejection of decisions.rejections) {
    set.add(billRejectionKey(rejection.billId, rejection.txId));
  }
  return set;
}

/** What a transaction can still fund: its magnitude minus what stored matches
 *  already allocated. A fully-allocated row is not a candidate. */
export function unallocatedTxCents(
  tx: Pick<Tx, "id" | "amount">,
  decisions: BillDecisions,
): number {
  const used = decisions.matches
    .filter((m) => m.txId === tx.id)
    .reduce((sum, m) => sum + Math.abs(m.amountCents), 0);
  return Math.max(0, magnitudeCents(tx.amount) - used);
}

/** What an occurrence already has allocated, in its own currency. */
export function allocatedOccurrenceCents(occurrenceId: string, decisions: BillDecisions): number {
  return decisions.matches
    .filter((m) => m.occurrenceId === occurrenceId)
    .reduce((sum, m) => sum + Math.abs(m.amountCents), 0);
}

/** Amount score, Sure's band formula. `null` means the candidate dies: an
 *  amount outside the band is not a match at all, not a weak one. */
function amountWeight(
  expectedCents: number,
  txCents: number,
  bandCents: number,
): { weight: number; deltaCents: number } | null {
  const deltaCents = txCents - expectedCents;
  if (Math.abs(deltaCents) > bandCents) return null;
  if (deltaCents === 0) return { weight: BILL_MATCH_WEIGHTS.amountExact, deltaCents };
  const drop = (Math.abs(deltaCents) / bandCents) * BILL_MATCH_WEIGHTS.amountBandDrop;
  return { weight: BILL_MATCH_WEIGHTS.amountBand - drop, deltaCents };
}

/** Date score: full weight on the due date, linear down to the edge weight. */
function dateWeight(
  diffDays: number,
  window: { earlyDays: number; lateDays: number },
): number | null {
  const span = diffDays < 0 ? window.earlyDays : window.lateDays;
  const distance = Math.abs(diffDays);
  if (distance > span) return null;
  const fraction = span === 0 ? 1 : 1 - distance / span;
  return (
    BILL_MATCH_WEIGHTS.dateEdge +
    fraction * (BILL_MATCH_WEIGHTS.dateDue - BILL_MATCH_WEIGHTS.dateEdge)
  );
}

/** The party score and what named the party, or null when nothing did (the
 *  hard merchant/name filter). */
function partyScore(
  bill: Bill,
  tx: Tx,
  account: Account | undefined,
): { weight: number; matchedOn: BillMatchEvidence["matchedOn"] } | null {
  const text = txText(tx);
  const merchant = (bill.merchant ?? "").trim();
  if (merchant !== "") {
    const billKey = canonicalMerchantKey(merchant);
    const txKey = canonicalMerchantKey(text);
    if (billKey !== "" && txKey !== "" && billKey === txKey) {
      return { weight: BILL_MATCH_WEIGHTS.merchant, matchedOn: "merchant" };
    }
    if (nameMatches(merchant, text)) {
      return { weight: BILL_MATCH_WEIGHTS.merchant, matchedOn: "merchant" };
    }
  }
  for (const alias of bill.aliases ?? []) {
    if (nameMatches(alias, text))
      return { weight: BILL_MATCH_WEIGHTS.merchant, matchedOn: "alias" };
  }
  if (bill.type === "transfer") {
    // A transfer series is identified by its destination account (Sure). The
    // account hard filter already pinned the row, so the account name is a
    // legitimate second reading of the same evidence.
    if (account != null && tx.accountKey === bill.accountKey) {
      return { weight: BILL_MATCH_WEIGHTS.transfer, matchedOn: "transfer" };
    }
  }
  if (nameMatches(bill.name, text)) {
    return { weight: BILL_MATCH_WEIGHTS.name, matchedOn: "name" };
  }
  return null;
}

/** Every raw candidate before the ambiguity and greedy passes. Visible for
 *  tests: the proposals are derived state, like transfer suggestions. */
export function billMatchCandidates(input: BillMatchInput): BillMatchCandidate[] {
  const decisions = input.decisions ?? EMPTY_BILL_DECISIONS;
  const rejected = rejectedBillMatches(decisions);
  const accounts = new Map((input.accounts ?? []).map((a) => [a.key, a]));
  const bills = new Map(input.bills.map((b) => [b.id, b]));
  const candidates: BillMatchCandidate[] = [];

  for (const occurrence of input.occurrences) {
    if (occurrence.status !== "scheduled") continue;
    const bill = bills.get(occurrence.billId);
    // Only active series: a paused/ended/suggested series proposes nothing.
    // Income series get no suggestions at all (Sure: they have no matcher
    // claim), and a snoozed row is not being paid yet.
    if (bill == null || bill.status !== "active") continue;
    if (bill.direction === "in") continue;
    if (occurrence.snoozedUntil != null && occurrence.snoozedUntil > input.asOf) continue;

    const expectedCents = occurrenceAmountCents(bill, occurrence, input.occurrences);
    if (expectedCents <= 0) continue;
    const allocated = allocatedOccurrenceCents(occurrence.id, decisions);
    // A fully-paid occurrence has no capacity left; a partially-paid one still
    // accepts a second payment until the close rules settle it.
    if (allocated >= expectedCents - 1) continue;

    const bandCents = billAmountBandCents(bill, expectedCents);
    const window = billMatchWindow(bill, occurrence, input.asOf);
    const billCurrency = currencyCode(bill.currency) || "EUR";
    const account = bill.accountKey != null ? accounts.get(bill.accountKey) : undefined;

    for (const tx of input.txs) {
      if (tx.amount === 0) continue;
      if (currencyCode(tx.currency) !== billCurrency) continue;
      if (bill.direction === "out" ? tx.amount >= 0 : tx.amount <= 0) continue;
      if (bill.accountKey != null && tx.accountKey !== bill.accountKey) continue;
      // Capacity: one transaction may fund several bills, but not more than
      // it holds.
      const txCapacity = unallocatedTxCents(tx, decisions);
      if (txCapacity < 1) continue;

      const diffDays = billDaysBetween(occurrence.dueOn, tx.date);
      const date = dateWeight(diffDays, window);
      if (date == null) continue;
      const amount = amountWeight(expectedCents, magnitudeCents(tx.amount), bandCents);
      if (amount == null) continue;
      const party = partyScore(bill, tx, account);
      if (party == null) continue;
      if (rejected.has(billRejectionKey(bill.id, tx.id))) continue;

      const confidence = Math.min(
        1,
        party.weight + amount.weight + date + BILL_MATCH_WEIGHTS.account,
      );
      const pending = tx.pending === true;
      const tier =
        confidence >= BILL_MATCH_AUTO_TIER && !pending
          ? "auto"
          : confidence >= BILL_MATCH_SUGGEST_TIER
            ? "suggest"
            : null;
      if (tier == null) continue;
      candidates.push({
        occurrenceId: occurrence.id,
        billId: bill.id,
        txId: tx.id,
        amountCents: txCapacity,
        currency: billCurrency,
        txDate: tx.date,
        txName: tx.counterparty || tx.description || tx.id,
        confidence,
        tier,
        ambiguous: false,
        evidence: {
          matchedOn: party.matchedOn,
          amountDeltaCents: amount.deltaCents,
          dateDiffDays: diffDays,
          pending,
          partyWeight: party.weight,
          amountWeight: amount.weight,
        },
      });
    }
  }
  // Sure pairs one transaction with the NEAREST open occurrence per series
  // (`matcher.rb:313-329`). Without this an overdue occurrence whose window
  // reaches to `asOf` would compete for every later payment of the same series
  // and each payment would look ambiguous. The nearest occurrence is the one
  // whose due date is closest to the payment.
  const nearest = new Map<string, BillMatchCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.billId}|${candidate.txId}`;
    const current = nearest.get(key);
    const distance = Math.abs(candidate.evidence.dateDiffDays);
    if (current == null) {
      nearest.set(key, candidate);
      continue;
    }
    const currentDistance = Math.abs(current.evidence.dateDiffDays);
    if (
      distance < currentDistance ||
      (distance === currentDistance &&
        candidate.occurrenceId.localeCompare(current.occurrenceId) < 0)
    ) {
      nearest.set(key, candidate);
    }
  }
  return [...nearest.values()];
}

/** Mark every candidate that shares an occurrence or a transaction with a
 *  runner-up inside the ambiguity margin. Sure's guard: the top candidate must
 *  beat the runner-up by 0.15 before it may auto-link. */
function markAmbiguous(candidates: BillMatchCandidate[]): BillMatchCandidate[] {
  const byOccurrence = new Map<string, BillMatchCandidate[]>();
  const byTx = new Map<string, BillMatchCandidate[]>();
  for (const candidate of candidates) {
    const occ = byOccurrence.get(candidate.occurrenceId);
    if (occ) occ.push(candidate);
    else byOccurrence.set(candidate.occurrenceId, [candidate]);
    const tx = byTx.get(candidate.txId);
    if (tx) tx.push(candidate);
    else byTx.set(candidate.txId, [candidate]);
  }
  const ambiguous = new Set<BillMatchCandidate>();
  const visit = (group: BillMatchCandidate[] | undefined) => {
    if (group == null || group.length < 2) return;
    const sorted = [...group].sort((a, b) => b.confidence - a.confidence);
    for (const candidate of sorted) {
      const runnerUp = sorted.find(
        (other) =>
          other !== candidate &&
          other.occurrenceId !== candidate.occurrenceId &&
          Math.abs(other.confidence - candidate.confidence) < BILL_MATCH_AMBIGUITY_MARGIN,
      );
      const tiedOccurrence = sorted.find(
        (other) =>
          other !== candidate &&
          other.occurrenceId === candidate.occurrenceId &&
          other.txId !== candidate.txId &&
          Math.abs(other.confidence - candidate.confidence) < BILL_MATCH_AMBIGUITY_MARGIN,
      );
      if (runnerUp != null || tiedOccurrence != null) ambiguous.add(candidate);
    }
  };
  for (const group of byOccurrence.values()) visit(group);
  for (const group of byTx.values()) visit(group);
  return candidates.map((candidate) =>
    ambiguous.has(candidate) ? { ...candidate, ambiguous: true } : candidate,
  );
}

/**
 * Suggest occurrence↔payment links, best first. Each occurrence and each
 * transaction appears at most once (Sure's greedy consume, `matcher.rb:111-138`):
 * one row funds one bill automatically; splitting one payment across bills is
 * a manual allocation. A candidate tied with a runner-up stays `ambiguous` and
 * can only be confirmed by the owner.
 */
export function suggestBillMatches(input: BillMatchInput): BillMatchCandidate[] {
  const marked = markAmbiguous(billMatchCandidates(input));
  marked.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.occurrenceId.localeCompare(b.occurrenceId) ||
      a.txId.localeCompare(b.txId),
  );
  const usedOccurrences = new Set<string>();
  const usedTxs = new Set<string>();
  const suggestions: BillMatchCandidate[] = [];
  for (const candidate of marked) {
    if (usedOccurrences.has(candidate.occurrenceId) || usedTxs.has(candidate.txId)) continue;
    usedOccurrences.add(candidate.occurrenceId);
    usedTxs.add(candidate.txId);
    suggestions.push(candidate);
  }
  return suggestions;
}

/** The stored decision for one confirmed candidate. `source` distinguishes the
 *  matcher's exact tier from the owner's confirmation; both close the same
 *  way, only the owner's decision is never reopened automatically. */
export function billMatchDecisionFromCandidate(
  candidate: BillMatchCandidate,
  source: "auto" | "user",
  asOf: string,
): BillMatchDecision {
  return {
    id: billMatchId(candidate.occurrenceId, candidate.txId),
    occurrenceId: candidate.occurrenceId,
    billId: candidate.billId,
    txId: candidate.txId,
    amountCents: Math.abs(candidate.amountCents),
    currency: candidate.currency,
    source,
    confidence: source === "auto" ? candidate.confidence : 1,
    decidedAt: asOf,
  };
}
