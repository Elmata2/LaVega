import type { Account, Tx } from "./model.js";
import { norm } from "./hash.js";

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

export type TxFilter = { entity?: string; accountKey?: string; search?: string };

/** Apply the (combinable) Transacties filters. Search is case/space-insensitive
 *  over counterparty + description (via norm). Input order is preserved. */
export function filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[] {
  const q = f.search ? norm(f.search) : "";
  return txs.filter((t) => {
    if (f.entity && t.entity !== f.entity) return false;
    if (f.accountKey && t.accountKey !== f.accountKey) return false;
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
