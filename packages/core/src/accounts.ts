import type { Account, Tx } from "./model.js";
import { findIban } from "./parsers/primitives.js";
import { norm, txBase, txId } from "./hash.js";

/** Strip the suffix a browser appends when you download a file you already have
 *  ("activity.csv" → "activity (1).csv"). Statements from Amex/Revolut/Trading
 *  212 carry no account column, so their account key comes from the FILENAME —
 *  which means that suffix silently turns one real card into two accounts. It
 *  is never part of a real account identity, so it goes before any matching. */
export function stripDownloadSuffix(key: string): string {
  return String(key ?? "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
}

/** The domestic account number used to spot the SAME real account imported two
 *  ways: CSV keys an account by its raw column (a BBAN, or even a product name),
 *  while MT940 and Enable Banking key by the full IBAN. From a full IBAN we take
 *  the BBAN (`slice(8)` drops CC+check+the 4-char bank code — NL layout); from a
 *  raw key we take its digits. Both are reduced to digits with leading zeros
 *  stripped, so `NL12ABNA0123456789` and the raw `0123456789` collapse to the
 *  same `123456789`. Returns null when there's nothing safe to match on (a
 *  product-name-only key, or fewer than 4 digits) — deliberately unmatchable by
 *  number, and left to the name-based pass in `findDuplicateAccounts`. */
export function canonicalAccountId(a: Account): string | null {
  const key = stripDownloadSuffix(a.key); // else "(1)" would pollute the digits
  const iban = findIban(a.iban) ?? findIban(key);
  const raw = iban ? iban.slice(8) : key;
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 4 ? digits : null;
}

export type DuplicateGroup = { canonicalId: string; accounts: Account[]; survivor: Account };

/** Higher = better survivor: a full IBAN dominates, then a known balance, then a
 *  set type, then a real name (not just the key echoed back). */
function survivorScore(a: Account): number {
  return (
    (findIban(a.iban) ? 8 : 0) +
    (a.balance != null ? 4 : 0) +
    (a.type ? 2 : 0) +
    (a.name && a.name !== a.key ? 1 : 0)
  );
}

/** Auto-pick the account to keep when merging a duplicate group. Deterministic:
 *  best score wins, ties broken by key string order. */
export function pickSurvivor(accs: Account[]): Account {
  return [...accs].sort(
    (a, b) => survivorScore(b) - survivorScore(a) || a.key.localeCompare(b.key),
  )[0];
}

function addTo(map: Map<string, Account[]>, key: string, a: Account): void {
  const list = map.get(key);
  if (list) list.push(a);
  else map.set(key, [a]);
}

/** Turn candidate buckets into duplicate groups. A group needs ≥2 DISTINCT keys
 *  (the same key twice is one account, not a duplicate), and a bucket spanning
 *  two different non-empty banks is a coincidental collision, not a duplicate
 *  (an empty bank is a wildcard). */
function toGroups(buckets: Map<string, Account[]>): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [id, accs] of buckets) {
    const seenKey = new Set<string>();
    const distinct = accs.filter((a) => (seenKey.has(a.key) ? false : (seenKey.add(a.key), true)));
    if (distinct.length < 2) continue;
    const banks = new Set(distinct.map((a) => norm(a.bank)).filter(Boolean));
    if (banks.size > 1) continue;
    groups.push({ canonicalId: id, accounts: distinct, survivor: pickSurvivor(distinct) });
  }
  return groups;
}

/** Find groups of accounts that look like the same real account. Two ways in:
 *  1. Same canonical domestic number — an IBAN import meeting a raw-number one.
 *  2. For rows with no usable number at all (filename-keyed card/product
 *     exports), the same name at the same bank once the download suffix is
 *     stripped: "activity" and "activity (1)" are one Amex card, downloaded
 *     twice. Two keys that differ by nothing BUT that suffix can't be two real
 *     accounts — an actual second account would have its own name.
 *  Sorted by canonicalId for determinism; each group carries a picked survivor. */
export function findDuplicateAccounts(accounts: Account[]): DuplicateGroup[] {
  const byNumber = new Map<string, Account[]>();
  const byName = new Map<string, Account[]>();
  for (const a of accounts) {
    const id = canonicalAccountId(a);
    if (id) addTo(byNumber, id, a);
    else {
      // No number to match on — fall back to the de-suffixed name. Buckets can't
      // collide with the number ones: anything with ≥4 digits went there.
      const name = norm(stripDownloadSuffix(a.key));
      if (name) addTo(byName, name, a);
    }
  }
  return [...toGroups(byNumber), ...toGroups(byName)].sort((a, b) =>
    a.canonicalId.localeCompare(b.canonicalId),
  );
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
  const untouched = txs.filter(
    (t) => t.accountKey !== survivorKey && t.accountKey !== duplicateKey,
  );

  // How many the survivor already holds per identity base. Its base already uses
  // survivorKey, and (from assignTxIds) its occurrences are exactly 1..count.
  const survivorCount = new Map<string, number>();
  for (const t of survivorTxs)
    survivorCount.set(txBase(t), (survivorCount.get(txBase(t)) ?? 0) + 1);

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
