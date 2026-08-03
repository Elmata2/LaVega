import type { Account, Tx, Rule } from "./model.js";
import { norm } from "./hash.js";
import { NL_CATEGORY_RULES_NORMALIZED } from "./categories.js";

/* Pure derivations behind the Transacties and Rekeningen views. No I/O — these
 * take the already-loaded accounts/txs and return view-ready data, so the
 * React components stay thin and the logic is unit-tested here. */

export type EnrichedTx = Tx & { entity: string; bank: string; accountName: string };

/** Join each tx to its account so the Transacties table can show entity/bank
 *  without a per-row lookup. A tx whose accountKey has no account (shouldn't
 *  normally happen) falls back to entity "onbekend" — matching consolidate. */
export function enrichTxs(txs: Tx[], accounts: Account[]): EnrichedTx[] {
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  return txs.map((t) => {
    const a = byKey.get(t.accountKey);
    return { ...t, entity: a?.entity ?? "onbekend", bank: a?.bank ?? "", accountName: a?.name ?? t.accountKey };
  });
}

export type TxFilter = { entity?: string; accountKey?: string; search?: string; from?: string; to?: string };

/** Apply the (combinable) Transacties filters. Search is case/space-insensitive
 *  over counterparty + description (via norm). from/to bound the date range
 *  inclusively (ISO dates compare lexicographically). Input order is preserved. */
export function filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[] {
  const q = f.search ? norm(f.search) : "";
  return txs.filter((t) => {
    if (f.entity && t.entity !== f.entity) return false;
    if (f.accountKey && t.accountKey !== f.accountKey) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q && !(norm(t.counterparty).includes(q) || norm(t.description).includes(q))) return false;
    return true;
  });
}

export type AccountSummary = { account: Account; txCount: number };

/** Per-account transaction count for the Rekeningen table (balance is already
 *  on the account). Accounts with zero txs are still returned. */
export function accountSummaries(accounts: Account[], txs: Tx[]): AccountSummary[] {
  const counts = new Map<string, number>();
  for (const t of txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
  return accounts.map((a) => ({ account: a, txCount: counts.get(a.key) ?? 0 }));
}

/** Return a new accounts array with one account reassigned to `entity`
 *  (immutable — never mutates the input). The caller persists + re-consolidates. */
export function reassignEntity(accounts: Account[], key: string, entity: string): Account[] {
  return accounts.map((a) => (a.key === key ? { ...a, entity } : a));
}

export type MonthlyTotal = { month: string; in: number; out: number };

/** Per-calendar-month inflow/outflow totals, sorted ascending by month
 *  (YYYY-MM). Drives the Overzicht bar chart. */
export function monthlyTotals(txs: Tx[]): MonthlyTotal[] {
  const byMonth = new Map<string, { in: number; out: number }>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = byMonth.get(m) ?? { in: 0, out: 0 };
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
    byMonth.set(m, b);
  }
  return [...byMonth.entries()]
    .map(([month, b]) => ({ month, in: b.in, out: b.out }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Category for a tx, in precedence order: a non-empty tx.category (manual
 *  override) wins; else the first user rule whose match text is a substring of
 *  counterparty+description (case/space-insensitive); else the first built-in
 *  Dutch default (NL_CATEGORY_RULES) that matches; else "onbekend". So the
 *  defaults categorize out of the box, but a user's own rule or manual label
 *  always takes precedence. */
export function categorize(tx: Tx, rules: Rule[]): string {
  if (tx.category) return tx.category;
  const hay = norm(tx.counterparty + " " + tx.description);
  for (const r of rules) {
    // Guard on the NORMALIZED match: a whitespace-only match norms to "" and
    // would otherwise substring-match every tx, mislabeling the whole dataset.
    const m = norm(r.match);
    if (m && hay.includes(m)) return r.category;
  }
  for (const r of NL_CATEGORY_RULES_NORMALIZED) {
    if (hay.includes(r.m)) return r.category;
  }
  return "onbekend";
}

/** In/out totals grouped by derived category (via categorize). */
export function categoryTotals(txs: Tx[], rules: Rule[]): Record<string, { in: number; out: number }> {
  const out: Record<string, { in: number; out: number }> = {};
  for (const t of txs) {
    const c = categorize(t, rules);
    const b = (out[c] ??= { in: 0, out: 0 });
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
  }
  return out;
}

/** Merge freshly-imported accounts with the existing ones, preserving the user's
 *  manual edits on accounts they already have: their entity, their type (soort),
 *  and — for imports carrying no balance (CSV) — their manually-set saldo. A
 *  fresh statement balance (MT940/ABN, non-null) still wins. New accounts pass
 *  through unchanged. Returns only the imported accounts (the caller upserts
 *  them; untouched existing accounts stay put). */
export function mergeImportedAccounts(existing: Account[], imported: Account[]): Account[] {
  const byKey = new Map(existing.map((a) => [a.key, a]));
  return imported.map((imp) => {
    const prev = byKey.get(imp.key);
    if (!prev) return imp;
    return {
      ...imp,
      entity: prev.entity,
      type: prev.type,
      balance: imp.balance !== null ? imp.balance : prev.balance,
      balanceDate: imp.balance !== null ? imp.balanceDate : prev.balanceDate,
    };
  });
}
