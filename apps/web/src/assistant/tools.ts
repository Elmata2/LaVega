import { categorize, type Account, type Rule, type Tx } from "@lavega/core";
import type { AssistantReadIntent } from "@lavega/core";

/*
 * The client-side tools (WS5.8 thin slice, issue #301).
 *
 * Every handler is a pure function over an already-decrypted vault snapshot.
 * There is no fetch, no storage handle and no server route in this module: the
 * only way data can leave it is the value the panel renders. That is the
 * boundary the issue asks to prove — the assistant's tools run in the browser
 * and the server never sees a ledger row.
 */

/** The decrypted slice a tool may read. Assembled by the panel from the vault. */
export type AssistantVaultSnapshot = {
  accounts: readonly Account[];
  txs: readonly Tx[];
  /** The owner's rules, so a category is the same one the app shows. */
  rules: readonly Rule[];
  /** ISO date the turn is asked on; the month default comes from here. */
  asOf: string;
};

export type SpendingCategory = { category: string; outCents: number };

export type SpendingSummary = {
  month: string;
  totalOutCents: number;
  categories: SpendingCategory[];
  countedRows: number;
  pendingRows: number;
};

export type BalanceRow = {
  name: string;
  currency: string;
  balanceCents: number | null;
};

const TOP_CATEGORIES = 4;

/**
 * Spend for one calendar month, from the owner's own rows. Pending and excluded
 * rows are not spending yet, so they are counted separately instead of quietly
 * changing the total.
 *
 * The vault stores transaction amounts and account balances in EUROS (the
 * personal app's existing convention, e.g. `-22.28`); this tool converts to
 * integer cents at its own boundary (ADR 0011), so every figure the panel shows
 * comes from one unit and no float sum drifts.
 */
export function spendingSummary(
  snapshot: AssistantVaultSnapshot,
  month: string | null,
): SpendingSummary {
  const target = month ?? snapshot.asOf.slice(0, 7);
  const totals = new Map<string, number>();
  let totalOutCents = 0;
  let countedRows = 0;
  let pendingRows = 0;
  for (const tx of snapshot.txs) {
    if (!tx.date.startsWith(target)) continue;
    if (tx.excluded) continue;
    if (tx.pending) {
      pendingRows += 1;
      continue;
    }
    if (tx.amount >= 0) continue;
    countedRows += 1;
    const outCents = Math.round(-tx.amount * 100);
    totalOutCents += outCents;
    /* Same precedence the app uses (stored category, then the rules engine,
     * then the built-in defaults), so the answer's categories match the
     * Transacties screen rather than a raw vault field. */
    const category = categorize(tx, [...snapshot.rules]) || "overig";
    totals.set(category, (totals.get(category) ?? 0) + outCents);
  }
  return {
    month: target,
    totalOutCents,
    categories: [...totals.entries()]
      .map(([category, outCents]) => ({ category, outCents }))
      .sort(
        (left, right) =>
          right.outCents - left.outCents || left.category.localeCompare(right.category),
      )
      .slice(0, TOP_CATEGORIES),
    countedRows,
    pendingRows,
  };
}

/** The owner's accounts with the balance the vault holds; null stays unknown. */
export function accountBalances(snapshot: AssistantVaultSnapshot): BalanceRow[] {
  return [...snapshot.accounts]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((account) => ({
      name: account.name || account.key,
      currency: account.currency,
      /* The vault's balance is euros; the tool's own boundary is cents. */
      balanceCents: account.balance === null ? null : Math.round(account.balance * 100),
    }));
}

/** Run one read intent. The panel formats the result; this returns data only. */
export function runReadTool(
  intent: AssistantReadIntent,
  snapshot: AssistantVaultSnapshot,
): SpendingSummary | BalanceRow[] {
  return intent.tool === "spending_summary"
    ? spendingSummary(snapshot, intent.month)
    : accountBalances(snapshot);
}

/** True when a result is the spending summary (used only for narrowing). */
export function isSpendingSummary(value: SpendingSummary | BalanceRow[]): value is SpendingSummary {
  return !Array.isArray(value);
}
