/**
 * Account matching, reconciliation, month coverage and the review queue
 * (WS3.5, issue #293).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/account_statement.rb`,
 * `account_statement/{account_matcher,coverage}.rb`. No Ruby is copied.
 *
 * The hard rules, all from Sure and all kept:
 *  - matching is hint-based with fixed weights (institution 0.45, account name
 *    0.25, last four 0.25, currency 0.05), a 0.35 floor, and a REFUSAL to pick
 *    when two accounts tie;
 *  - reconciliation is report-only with a one-cent tolerance. "Verified" is a
 *    claim, so it is true ONLY when at least one check exists and every check
 *    matched; an empty check list is `unavailable`, never a pass;
 *  - a statement with no period stays visible in the review queue and never
 *    silently becomes "matched".
 */
import type { Account, Tx } from "../model.js";
import type { Valuation } from "../balance.js";
import { accountBalanceSeries } from "../balanceSeries.js";
import { documentCoversMonth, isStatement, type VaultDocument } from "./types.js";

/** The metadata one detection pass can produce. */
export type DetectedMetadata = {
  periodFrom: string | null;
  periodTo: string | null;
  accountLast4: string | null;
  institutionHint: string | null;
  accountNameHint: string | null;
  currency: string | null;
  metadataSources: string[];
  parserConfidence: number;
};

/** Sure's `MINIMUM_CONFIDENCE`. */
export const MATCH_MIN_CONFIDENCE = 0.35;

export type AccountMatchHints = {
  institutionHint?: string | null;
  accountNameHint?: string | null;
  accountLast4?: string | null;
  currency?: string | null;
};

/** Sure's confidence tiers, unchanged: a hint can add its weight once, and the
 *  score is capped at 1. */
export function accountMatchConfidence(account: Account, hints: AccountMatchHints): number {
  const institution = normalise(hints.institutionHint);
  const name = normalise(hints.accountNameHint);
  const last4 = normalise(hints.accountLast4);
  if (institution === "" && name === "" && last4 === "") return 0;

  let score = 0;
  const accountText = normalise([account.name, account.bank, account.iban].join(" "));
  if (institution !== "" && accountText.includes(institution)) score += 0.45;
  if (name !== "" && normalise(account.name).includes(name)) score += 0.25;
  if (
    last4 !== "" &&
    normalise([account.name, account.bank, account.iban].join(" ")).includes(last4)
  ) {
    score += 0.25;
  }
  if (normalise(hints.currency ?? "") !== "" && hints.currency === account.currency) {
    score += 0.05;
  }
  return Math.min(1, Math.round(score * 10000) / 10000);
}

function normalise(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type AccountMatch =
  | { status: "matched"; accountKey: string; confidence: number }
  | { status: "ambiguous"; confidence: number; tiedKeys: string[] }
  | { status: "none" };

/** Deterministic hint matcher. Two accounts at the same confidence are a tie,
 *  and a tie is a refusal: the owner resolves it in the review queue. */
export function matchStatementAccount(
  hints: AccountMatchHints,
  accounts: readonly Account[],
): AccountMatch {
  const ranked = accounts
    .map((account) => ({ account, confidence: accountMatchConfidence(account, hints) }))
    .filter((candidate) => candidate.confidence >= MATCH_MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence || a.account.key.localeCompare(b.account.key));
  const best = ranked[0];
  if (best == null) return { status: "none" };
  const tied = ranked.filter((candidate) => candidate.confidence === best.confidence);
  if (tied.length > 1) {
    return {
      status: "ambiguous",
      confidence: best.confidence,
      tiedKeys: tied.map((candidate) => candidate.account.key),
    };
  }
  return { status: "matched", accountKey: best.account.key, confidence: best.confidence };
}

/** The hints a stored document carries, in matcher shape. */
export function hintsOf(doc: VaultDocument): AccountMatchHints {
  return {
    institutionHint: doc.institutionHint,
    accountNameHint: doc.accountNameHint,
    accountLast4: doc.accountLast4,
    currency: doc.currency,
  };
}

/* ── Reconciliation (report-only) ─────────────────────────────────────────── */

/** Sure's one-cent tolerance. */
export const RECONCILIATION_TOLERANCE_CENTS = 1;

export type ReconciliationCheck = {
  key: "opening_balance" | "closing_balance" | "period_movement";
  statementCents: number;
  ledgerCents: number;
  differenceCents: number;
  matched: boolean;
};

export type ReconciliationStatus = "matched" | "mismatched" | "unavailable";

export type ReconciliationReason =
  | null
  | "no-account"
  | "no-period"
  | "no-statement-balances"
  | "no-ledger-value"
  | "difference";

export type Reconciliation = {
  status: ReconciliationStatus;
  /** True ONLY when every check exists and matched. Never true on no checks. */
  verified: boolean;
  checks: ReconciliationCheck[];
  reason: ReconciliationReason;
};

export type ReconcileInput = {
  doc: VaultDocument;
  accounts: readonly Account[];
  txs: readonly Tx[];
  valuations?: readonly Valuation[];
  asOf: string;
};

/** The ledger's signed balance at one date, or null when #291 cannot reach it
 *  (a gap, not a zero). */
function ledgerBalanceCents(input: ReconcileInput, account: Account, date: string): number | null {
  const point = accountBalanceSeries({
    account,
    txs: input.txs,
    valuations: input.valuations,
    from: date,
    to: date,
    asOf: input.asOf,
  })[0];
  return point?.balanceCents ?? null;
}

function check(
  key: ReconciliationCheck["key"],
  statementCents: number,
  ledgerCents: number,
): ReconciliationCheck {
  const differenceCents = statementCents - ledgerCents;
  return {
    key,
    statementCents,
    ledgerCents,
    differenceCents,
    matched: Math.abs(differenceCents) <= RECONCILIATION_TOLERANCE_CENTS,
  };
}

/**
 * Compare a statement's own opening/closing/movement figures with the ledger.
 * Report-only: nothing in the vault changes, and the result cannot claim more
 * than the checks support.
 */
export function reconcileStatement(input: ReconcileInput): Reconciliation {
  const { doc } = input;
  const account =
    doc.accountKey == null ? null : input.accounts.find((a) => a.key === doc.accountKey);
  if (account == null) {
    return { status: "unavailable", verified: false, checks: [], reason: "no-account" };
  }
  if (doc.periodFrom == null || doc.periodTo == null) {
    return { status: "unavailable", verified: false, checks: [], reason: "no-period" };
  }
  if (doc.openingBalanceCents == null && doc.closingBalanceCents == null) {
    return { status: "unavailable", verified: false, checks: [], reason: "no-statement-balances" };
  }

  const openingLedger = ledgerBalanceCents(input, account, doc.periodFrom);
  const closingLedger = ledgerBalanceCents(input, account, doc.periodTo);
  if (openingLedger == null && closingLedger == null) {
    return { status: "unavailable", verified: false, checks: [], reason: "no-ledger-value" };
  }

  const checks: ReconciliationCheck[] = [];
  if (doc.openingBalanceCents != null && openingLedger != null) {
    checks.push(check("opening_balance", doc.openingBalanceCents, openingLedger));
  }
  if (doc.closingBalanceCents != null && closingLedger != null) {
    checks.push(check("closing_balance", doc.closingBalanceCents, closingLedger));
  }
  if (
    doc.openingBalanceCents != null &&
    doc.closingBalanceCents != null &&
    openingLedger != null &&
    closingLedger != null
  ) {
    checks.push(
      check(
        "period_movement",
        doc.closingBalanceCents - doc.openingBalanceCents,
        closingLedger - openingLedger,
      ),
    );
  }
  if (checks.length === 0) {
    return { status: "unavailable", verified: false, checks: [], reason: "no-ledger-value" };
  }
  const mismatched = checks.some((c) => !c.matched);
  return {
    status: mismatched ? "mismatched" : "matched",
    verified: !mismatched && checks.length > 0,
    checks,
    reason: mismatched ? "difference" : null,
  };
}

/* ── Month coverage ───────────────────────────────────────────────────────── */

export type StatementMonthStatus =
  | "covered"
  | "missing"
  | "duplicate"
  | "ambiguous"
  | "mismatched"
  | "not_expected";

export type StatementMonthCoverage = {
  month: string;
  status: StatementMonthStatus;
  documentIds: string[];
  reason:
    | null
    | "no-statement"
    | "two-statements"
    | "tie"
    | "reconciliation-difference"
    | "outside";
};

export type CoverageInput = {
  documents: readonly VaultDocument[];
  accountKey: string;
  /** Oldest first, "YYYY-MM". */
  months: readonly string[];
  accounts: readonly Account[];
  txs: readonly Tx[];
  valuations?: readonly Valuation[];
  asOf: string;
  /** The account's first month of history; earlier months are not expected. */
  expectedFromMonth?: string | null;
};

/** One status per month for one account: Sure's coverage rule, with the
 *  reconciliation outcome folded in so a duplicate or a mismatch is visible
 *  instead of being averaged away. */
export function statementCoverage(input: CoverageInput): StatementMonthCoverage[] {
  const account = input.accounts.find((a) => a.key === input.accountKey) ?? null;
  const linked = input.documents.filter(
    (doc) => isStatement(doc) && doc.accountKey === input.accountKey,
  );
  const unmatched = input.documents.filter(
    (doc) => isStatement(doc) && doc.accountKey == null && doc.reviewStatus !== "linked",
  );
  return input.months.map((month) => {
    if (input.expectedFromMonth != null && month < input.expectedFromMonth) {
      return { month, status: "not_expected", documentIds: [], reason: "outside" };
    }
    const covering = linked.filter((doc) => documentCoversMonth(doc, month));
    if (covering.length > 1) {
      return {
        month,
        status: "duplicate",
        documentIds: covering.map((doc) => doc.id),
        reason: "two-statements",
      };
    }
    if (covering.length === 1) {
      const doc = covering[0] as VaultDocument;
      const reconciliation =
        account == null
          ? null
          : reconcileStatement({
              doc,
              accounts: input.accounts,
              txs: input.txs,
              valuations: input.valuations,
              asOf: input.asOf,
            });
      if (reconciliation?.status === "mismatched") {
        return {
          month,
          status: "mismatched",
          documentIds: [doc.id],
          reason: "reconciliation-difference",
        };
      }
      return { month, status: "covered", documentIds: [doc.id], reason: null };
    }
    // No linked document: a statement that covers this month but could not be
    // matched keeps the month visible as ambiguous rather than missing.
    const ambiguous = unmatched.filter((doc) => documentCoversMonth(doc, month));
    if (ambiguous.length > 0) {
      return {
        month,
        status: "ambiguous",
        documentIds: ambiguous.map((doc) => doc.id),
        reason: "tie",
      };
    }
    return { month, status: "missing", documentIds: [], reason: "no-statement" };
  });
}

/* ── Review queue ─────────────────────────────────────────────────────────── */

export type ReviewReason = "no-period" | "ambiguous" | "no-hint" | "rejected" | "unmatched";

export type ReviewItem = {
  document: VaultDocument;
  suggestion: AccountMatch;
  reason: ReviewReason;
};

/**
 * Everything that still needs the owner, newest first. A document with NO
 * period is always here (Sure's `inbox` scope), and a rejection keeps the row
 * visible instead of hiding it.
 */
export function statementReviewQueue(input: {
  documents: readonly VaultDocument[];
  accounts: readonly Account[];
}): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const doc of input.documents) {
    if (!isStatement(doc)) continue;
    if (doc.reviewStatus === "linked" && doc.accountKey != null) continue;
    const suggestion = matchStatementAccount(hintsOf(doc), input.accounts);
    const reason: ReviewReason =
      doc.periodFrom == null || doc.periodTo == null
        ? "no-period"
        : suggestion.status === "ambiguous"
          ? "ambiguous"
          : suggestion.status === "none"
            ? "no-hint"
            : doc.reviewStatus === "rejected"
              ? "rejected"
              : "unmatched";
    items.push({ document: doc, suggestion, reason });
  }
  return items.sort(
    (a, b) =>
      b.document.uploadedAt.localeCompare(a.document.uploadedAt) ||
      a.document.filename.localeCompare(b.document.filename),
  );
}
