import type { Account, Tx } from "./model.js";
import { findIban } from "./parsers/primitives.js";
import { norm, txBase, txId } from "./hash.js";

/** The domestic account number used to spot the SAME real account imported two
 *  ways: CSV keys an account by its raw column (a BBAN, or even a product name),
 *  while MT940 and Enable Banking key by the full IBAN. From a full IBAN we take
 *  the BBAN (`slice(8)` drops CC+check+the 4-char bank code — NL layout); from a
 *  raw key we take its digits. Both are reduced to digits with leading zeros
 *  stripped, so `NL12ABNA0123456789` and the raw `0123456789` collapse to the
 *  same `123456789`. Returns null when there's nothing safe to match on (a
 *  product-name-only key, or fewer than 4 digits) — deliberately unmatchable so
 *  those are never flagged as duplicates. */
export function canonicalAccountId(a: Account): string | null {
  const iban = findIban(a.iban) ?? findIban(a.key);
  const raw = iban ? iban.slice(8) : String(a.key ?? "");
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 4 ? digits : null;
}

export type DuplicateGroup = { canonicalId: string; accounts: Account[]; survivor: Account };

/** Higher = better survivor: a full IBAN dominates, then a known balance, then a
 *  set type, then a real name (not just the key echoed back). */
function survivorScore(a: Account): number {
  return (findIban(a.iban) ? 8 : 0) + (a.balance != null ? 4 : 0) + (a.type ? 2 : 0) + (a.name && a.name !== a.key ? 1 : 0);
}

/** Auto-pick the account to keep when merging a duplicate group. Deterministic:
 *  best score wins, ties broken by key string order. */
export function pickSurvivor(accs: Account[]): Account {
  return [...accs].sort((a, b) => survivorScore(b) - survivorScore(a) || a.key.localeCompare(b.key))[0];
}

/** Find groups of accounts that look like the same real account (same canonical
 *  domestic number). A group needs ≥2 DISTINCT keys. A number shared across two
 *  different non-empty banks is treated as a coincidental collision and skipped
 *  (an empty bank is a wildcard). Sorted by canonicalId for determinism. Each
 *  group carries an auto-picked survivor. */
export function findDuplicateAccounts(accounts: Account[]): DuplicateGroup[] {
  const byId = new Map<string, Account[]>();
  for (const a of accounts) {
    const id = canonicalAccountId(a);
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(a);
    else byId.set(id, [a]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [id, accs] of byId) {
    const seenKey = new Set<string>();
    const distinct = accs.filter((a) => (seenKey.has(a.key) ? false : (seenKey.add(a.key), true)));
    if (distinct.length < 2) continue;
    const banks = new Set(distinct.map((a) => norm(a.bank)).filter(Boolean));
    if (banks.size > 1) continue; // same number, different banks → not a duplicate
    groups.push({ canonicalId: id, accounts: distinct, survivor: pickSurvivor(distinct) });
  }
  return groups.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}

/** Merge `duplicateKey` into `survivorKey`: reassign the duplicate's txs to the
 *  survivor and union them by `txBase` with MAX-count-per-base, so an overlapping
 *  range imported in both statements collapses (2 movements, not 4) while a range
 *  only one statement has is appended. Surplus copies get ids continuing the
 *  survivor's occurrence count (matches `assignTxIds`). The duplicate account is
 *  dropped; the survivor inherits the duplicate's IBAN only if it had none (all
 *  other survivor fields — entity/type/balance — are kept). Pure; returns fresh
 *  arrays. No-op if the keys are equal or either account is missing. */
export function mergeAccounts(
  accounts: Account[],
  txs: Tx[],
  survivorKey: string,
  duplicateKey: string,
): { accounts: Account[]; txs: Tx[] } {
  const survivor = accounts.find((a) => a.key === survivorKey);
  const duplicate = accounts.find((a) => a.key === duplicateKey);
  if (survivorKey === duplicateKey || !survivor || !duplicate) return { accounts, txs };

  const survivorTxs = txs.filter((t) => t.accountKey === survivorKey);
  const dupTxs = txs.filter((t) => t.accountKey === duplicateKey);
  const untouched = txs.filter((t) => t.accountKey !== survivorKey && t.accountKey !== duplicateKey);

  // How many the survivor already holds per identity base. Its base already uses
  // survivorKey, and (from assignTxIds) its occurrences are exactly 1..count.
  const survivorCount = new Map<string, number>();
  for (const t of survivorTxs) survivorCount.set(txBase(t), (survivorCount.get(txBase(t)) ?? 0) + 1);

  // Re-key the duplicate's txs to the survivor and group by base.
  const dupByBase = new Map<string, Tx[]>();
  for (const t of dupTxs) {
    const rekeyed = { ...t, accountKey: survivorKey };
    const base = txBase(rekeyed);
    const arr = dupByBase.get(base);
    if (arr) arr.push(rekeyed);
    else dupByBase.set(base, [rekeyed]);
  }

  // Append only the surplus beyond what the survivor already has for each base
  // (union with max-count: the overlap collapses, distinct occurrences stay).
  // Surplus copies get occurrences have+1..dupCount → ids that can't collide
  // with the survivor's existing 1..have.
  const added: Tx[] = [];
  for (const [base, group] of dupByBase) {
    const have = survivorCount.get(base) ?? 0;
    for (let k = have; k < group.length; k++) added.push({ ...group[k], id: txId(base, k + 1) });
  }

  const nextTxs = [...untouched, ...survivorTxs, ...added];
  const mergedSurvivor: Account = survivor.iban ? survivor : { ...survivor, iban: duplicate.iban };
  const nextAccounts = accounts
    .filter((a) => a.key !== duplicateKey)
    .map((a) => (a.key === survivorKey ? mergedSurvivor : a));
  return { accounts: nextAccounts, txs: nextTxs };
}
