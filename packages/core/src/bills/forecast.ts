/**
 * Bills → forecast adapter (WS2.10, issue #290).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/recurring_transaction/pipeline.rb` (identify →
 * generate occurrences → match → price changes → project) and the recurring
 * occurrence scopes the forecast/budget feed reads. No Ruby is copied.
 *
 * WHY. `forecast.ts` detects recurring streams from transaction history and
 * extrapolates their dates from the last observed payment. The bills
 * workstream (#286–#288) now knows the real committed occurrence DATES and
 * AMOUNTS, including three things a detector cannot see:
 *
 *  - a declared series whose first payment has not happened yet (no history,
 *    so no detected stream),
 *  - a paused/ended series, whose detected stream still projects for up to
 *    three cycles after the last payment,
 *  - a price change on the series, which the history's median amount lags.
 *
 * This adapter turns those occurrences into `ForecastCommitment`s and names the
 * detected streams they explain, so the forecast projects the committed dates
 * instead of the extrapolated ones and NEVER both. The detector is not forked:
 * it is the same `detectRecurringStreams` call the forecast already makes.
 *
 * Deterministic, clock-free (`asOf` is an argument), integer cents. No storage.
 */
import type { Bill, BillDecisions, BillOccurrence } from "./model.js";
import { isEurCurrency } from "../model.js";
import type { Account, Tx } from "../model.js";
import type {
  ClaimedStream,
  ForecastCommitment,
  ForecastCommitmentConfidence,
} from "../forecast.js";
import { detectRecurringStreams, type RecurringStream } from "../forecast.js";
import { occurrencesPerYear } from "./schedule.js";
import { occurrenceAmountCents } from "./occurrences.js";
import { allocatedOccurrenceCents, billMatchesPartyText } from "./match.js";

/** How far ahead occurrences are projected. Matches the forecast's own default
 *  horizon (13 weeks), so the adapter and the projection line up. */
export const BILL_FORECAST_HORIZON_DAYS = 91;

/** A detected stream is claimed when its cadence is within this relative
 *  distance of the bill's cycle. Coarse on purpose: this decides WHICH series
 *  a stream belongs to, not whether it recurs. */
const CADENCE_MATCH_RATIO = 0.35;

/** A stream is claimed by a bill only when their amounts are within half the
 *  bill's amount. Wide, because the point of the claim is to REPLACE the
 *  history's stale median with the series' current amount, not to re-score
 *  the match. */
const AMOUNT_CLAIM_RATIO = 0.5;

/** One bill → detected-stream association, with the reason it was claimed. */
export type BillForecastClaim = {
  billId: string;
  streamKey: string;
  /** The series status at `asOf`; a paused/ended series has no future
   *  occurrence, so claiming its stream is how it stops projecting. */
  billStatus: Bill["status"];
};

export type BillForecastProjection = {
  /** The real committed payments inside the horizon, ascending by date. */
  commitments: ForecastCommitment[];
  /** Streams whose extrapolated dates must not be projected: the committed
   *  dates (or the series' inactivity) carry that money instead. */
  claimedStreams: ClaimedStream[];
  claimed: BillForecastClaim[];
  /** Declared series with no materialized future occurrence (e.g. a paused
   *  series); named so the screen can say why it is not in the line. */
  excludedBillIds: string[];
  /** Series in a non-EUR currency, left out of the EUR projection. */
  excludedCurrencyCount: number;
  /** Detected streams no bill explains; they keep projecting exactly as before
   *  (WS2.6 detection is what would retire them, not this adapter). */
  unclaimedStreamKeys: string[];
};

export type BillForecastInput = {
  bills: readonly Bill[];
  occurrences: readonly BillOccurrence[];
  txs: readonly Tx[];
  decisions?: BillDecisions;
  accounts?: readonly Account[];
  asOf: string;
  horizonDays?: number;
};

/** The bill's expected payment this cycle, in cents: the series strategy,
 *  ignoring a per-occurrence override (used only for claim/confidence scoring). */
function expectedCentsOf(bill: Bill): number {
  return Math.abs(bill.amountCents);
}

/** History payments that look like this bill: same direction, the party named
 *  in the descriptor, and an amount inside the claim band. Counting them is how
 *  the adapter decides how OBSERVED a series is; it never invents a payment. */
function observedPaymentCount(
  bill: Bill,
  txs: readonly Tx[],
  asOf: string,
  accounts: readonly Account[],
): number {
  const expected = expectedCentsOf(bill);
  const band = Math.max(1, Math.round(expected * AMOUNT_CLAIM_RATIO));
  let count = 0;
  for (const tx of txs) {
    if (tx.date > asOf) continue;
    if (allocatedAccountMatch(bill, tx, accounts) === false) continue;
    if (bill.direction === "out" ? tx.amount >= 0 : tx.amount <= 0) continue;
    if (!billMatchesPartyText(bill, `${tx.counterparty ?? ""} ${tx.description ?? ""}`)) continue;
    if (Math.abs(Math.round(Math.abs(tx.amount) * 100) - expected) > band) continue;
    count += 1;
  }
  return count;
}

/** Account hard filter, shared with the matcher: a bill pinned to an account
 *  only sees that account's rows. */
function allocatedAccountMatch(bill: Bill, tx: Tx, _accounts: readonly Account[]): boolean | null {
  if (bill.accountKey == null) return null;
  return tx.accountKey === bill.accountKey;
}

function confidenceFor(observed: number): ForecastCommitmentConfidence {
  if (observed >= 3) return "high";
  if (observed >= 1) return "medium";
  return "low";
}

/** The recorded confidence rule, exported for tests and the docs table. */
export function billCommitmentConfidence(
  observedPaymentCount: number,
): ForecastCommitmentConfidence {
  return confidenceFor(observedPaymentCount);
}

/** Does `stream` look like the same series as `bill`? Sign, party, cadence and
 *  amount, in that order; null when it cannot be the same series. */
function streamClaimScore(bill: Bill, stream: RecurringStream): number | null {
  const sign = bill.direction === "out" ? -1 : 1;
  if (stream.sign !== sign) return null;
  if (!billMatchesPartyText(bill, stream.counterparty)) return null;
  const cycleDays = 365.25 / Math.max(1, occurrencesPerYear(bill));
  if (stream.cadenceDays <= 0) return null;
  if (Math.abs(cycleDays - stream.cadenceDays) / stream.cadenceDays > CADENCE_MATCH_RATIO) {
    return null;
  }
  const expected = expectedCentsOf(bill);
  if (expected <= 0) return null;
  const amountRatio = Math.abs(stream.amountCents - expected) / expected;
  if (amountRatio > AMOUNT_CLAIM_RATIO) return null;
  // Closer amount + closer cadence wins; the exact number is only a tie-break
  // between series, never a confidence.
  return 1 - amountRatio + (1 - Math.abs(cycleDays - stream.cadenceDays) / stream.cadenceDays);
}

/**
 * Project the bills workstream into the forecast: committed occurrence dates
 * and amounts, plus the detected streams those occurrences explain.
 */
export function billForecastProjection(input: BillForecastInput): BillForecastProjection {
  const asOf = input.asOf;
  const decisions = input.decisions;
  const horizonDays = input.horizonDays ?? BILL_FORECAST_HORIZON_DAYS;
  const horizonEnd = addDaysIso(asOf, horizonDays);
  const accounts = input.accounts ?? [];
  const streams = detectRecurringStreams([...input.txs]);

  // One bill ↔ one stream, best association first. A paused/ended series still
  // claims its stream: that is how "no future occurrence" reaches the forecast.
  const proposals: Array<{ bill: Bill; stream: RecurringStream; score: number }> = [];
  for (const bill of [...input.bills].sort((a, b) => a.id.localeCompare(b.id))) {
    let best: { stream: RecurringStream; score: number } | null = null;
    for (const stream of streams) {
      const score = streamClaimScore(bill, stream);
      if (score == null) continue;
      if (best == null || score > best.score) best = { stream, score };
    }
    if (best != null) {
      proposals.push({ bill, stream: best.stream, score: best.score });
    }
  }
  // Resolve conflicts deterministically: highest score claims the stream, ties
  // by bill id (already the iteration order), and one stream feeds one series.
  proposals.sort((a, b) => b.score - a.score || a.bill.id.localeCompare(b.bill.id));
  const claimed = new Map<string, { bill: Bill; stream: RecurringStream }>();
  const billClaimed = new Set<string>();
  for (const proposal of proposals) {
    if (claimed.has(proposal.stream.key) || billClaimed.has(proposal.bill.id)) continue;
    claimed.set(proposal.stream.key, { bill: proposal.bill, stream: proposal.stream });
    billClaimed.add(proposal.bill.id);
  }

  const accountEntity = new Map((input.accounts ?? []).map((a) => [a.key, a.entity]));
  const commitments: ForecastCommitment[] = [];
  const excludedBillIds: string[] = [];
  let excludedCurrencyCount = 0;

  for (const bill of input.bills) {
    if (!isEurCurrency(bill.currency)) {
      excludedCurrencyCount += 1;
      continue;
    }
    if (bill.status !== "active") {
      // A paused/ended/suggested series has no committed future payment. Its
      // detected stream is claimed above, so nothing is projected for it.
      excludedBillIds.push(bill.id);
      continue;
    }
    const observed = observedPaymentCount(bill, input.txs, asOf, accounts);
    const confidence = confidenceFor(observed);
    const entity = bill.accountKey == null ? "" : (accountEntity.get(bill.accountKey) ?? "");
    for (const occurrence of input.occurrences) {
      if (occurrence.billId !== bill.id) continue;
      if (occurrence.status !== "scheduled") continue;
      if (occurrence.dueOn <= asOf || occurrence.dueOn > horizonEnd) continue;
      const expected = occurrenceAmountCents(bill, occurrence, input.occurrences);
      const allocated = decisions == null ? 0 : allocatedOccurrenceCents(occurrence.id, decisions);
      const remaining = expected - allocated;
      if (remaining <= 0) continue;
      commitments.push({
        id: occurrence.id,
        entity,
        label: bill.name,
        sign: bill.direction === "in" ? 1 : -1,
        amountCents: remaining,
        dueDate: occurrence.dueOn,
        confidence,
      });
    }
  }

  commitments.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label));

  const claimedStreams: ClaimedStream[] = [...claimed.values()].map(({ bill, stream }) => ({
    key: stream.key,
    entity: bill.accountKey == null ? "" : (accountEntity.get(bill.accountKey) ?? ""),
  }));

  return {
    commitments,
    claimedStreams,
    claimed: [...claimed.values()].map(({ bill, stream }) => ({
      billId: bill.id,
      streamKey: stream.key,
      billStatus: bill.status,
    })),
    excludedBillIds,
    excludedCurrencyCount,
    unclaimedStreamKeys: streams
      .filter((stream) => !claimed.has(stream.key))
      .map((stream) => stream.key),
  };
}

/** Add whole days to an ISO date via UTC parts (no `new Date(str)` parsing). */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
