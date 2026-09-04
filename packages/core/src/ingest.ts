import type { Account, Tx } from "./model.js";
import { assignTxIds, txBase } from "./hash.js";
import { merchantKey } from "./subscriptions.js";

/* ===========================================================================
 * ONE PAYMENT, TWO SOURCES.
 *
 * The vault can hold the same ING account twice over: once from a CSV he
 * imported and once from the Enable Banking link. Both deliver the same direct
 * debit, and until now both were kept, because the only thing `ingest` compared
 * was the transaction id — a hash over
 * `accountKey|date|amount|counterparty|description` (`hash.ts`). The CSV writes
 * "SIMYO", the link's `creditor.name` writes "Simyo B.V.", so the hashes differ
 * and the row lands twice.
 *
 * What that costs, measured on four monthly € 11,89 charges delivered by both
 * sources: 8 rows instead of 4, € 95,12 of spending instead of € 47,56, and the
 * subscription detector reading gaps of [0, 29, 0, 30, 0, 32, 0] — median 0,
 * which is in no cadence band, so his Simyo silently disappeared from
 * Optimalisatie. The double count is the wider damage; the missing subscription
 * is only the loudest symptom.
 *
 * THIS IS THE DANGEROUS HALF, and it is treated that way. Two REAL payments of
 * the same amount, on the same day, to the same party genuinely exist: two
 * refuels, two runs to the same supermarket, two identical Tikkies. Throwing
 * away something real is worse than counting something twice — a double is
 * visible and correctable, a deletion is neither. Three rules keep the
 * difference, and each of them is a reason to KEEP a row:
 *
 *  1. NEVER WITHIN ONE BATCH. Only rows already in the vault can absorb an
 *     incoming row; the incoming batch is never matched against itself. Two
 *     genuine refuels arrive together, in one import, from one source — so they
 *     both survive, always. This is what makes the rule safe at all, and it is
 *     why the check lives here (where "what was already there" and "what just
 *     arrived" are two separate arguments) rather than inside the detector.
 *  2. ONE FOR ONE. Each stored row can absorb at most one incoming row. If the
 *     day really held two payments and both sources deliver both, 2 meets 2 and
 *     the count stays 2. If a third genuinely happens later, the stored pair is
 *     used up and the third is kept.
 *  3. ONLY WHEN THE SPELLING DIFFERS AND THE PARTY IS THE SAME. Identical
 *     spelling means one source sent the row twice, which the occurrence
 *     counter in `assignTxIds` already governs — those are ordinary repeats and
 *     are left alone. And the two rows must resolve to the same merchant
 *     (`merchantKey`), so an unrelated € 25,00 on the same day cannot be eaten
 *     by a stored € 25,00 from another shop. A nameless row absorbs nothing:
 *     with no name there is no evidence of sameness, and absence is not proof.
 *
 * The residual risk, stated rather than hidden: a payment that is genuinely new
 * AND matches a stored row on account, date, amount and merchant, in a batch
 * that does not also re-deliver that stored row, is dropped. That needs a
 * source to hand over the second charge of a day without the first — Enable
 * Banking syncs whole date windows and a file import is a whole statement, so a
 * day arrives complete or not at all. When it does happen, the loss is one row
 * of a merchant he was billed twice by on one day at one price.
 * ========================================================================= */

/** The coordinates that identify a payment regardless of how a source spells
 *  it: which account, which day, how much. `toFixed(2)` mirrors `txBase`, so
 *  the two keys can never round apart. */
function dupKey(t: Pick<Tx, "accountKey" | "date" | "amount">): string {
  return `${t.accountKey}|${t.date}|${t.amount.toFixed(2)}`;
}

/** Do these two rows name the same party? Token containment, not equality: one
 *  source writes "SHELL" and the other "Shell Nederland", and `merchantKey`
 *  keeps both words for merchants it does not know by name. Equality alone
 *  would have deduped Simyo (both sides collapse to the dictionary token
 *  "simyo") and missed every merchant outside the dictionary. Empty on either
 *  side is never a match. */
function samePartyKey(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  if (a === b) return true;
  const at = new Set(a.split(" "));
  const bt = new Set(b.split(" "));
  const [small, big] = at.size <= bt.size ? [at, bt] : [bt, at];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

export function ingest(existing: Tx[], incoming: Omit<Tx, "id">[]): Tx[] {
  const seen = new Set(existing.map((t) => t.id));
  const withIds = assignTxIds(incoming);

  /* Stored rows, grouped by their coordinates. A row is REMOVED from its pool
   * once something has been matched against it — that is rule 2, and it is the
   * whole reason this is a pool of rows and not a set of keys. */
  const pools = new Map<string, Tx[]>();
  for (const t of existing) {
    const k = dupKey(t);
    const pool = pools.get(k);
    if (pool) pool.push(t);
    else pools.set(k, [t]);
  }

  const kept: Tx[] = [];
  for (const row of withIds) {
    const pool = pools.get(dupKey(row));
    if (seen.has(row.id)) {
      /* Byte-for-byte the same row: a re-import of a statement he already has.
       * Claim the stored row it corresponds to, so that a second, genuinely
       * different payment on that day is not later mistaken for a duplicate of
       * a row that has already been accounted for. */
      if (pool) {
        const i = pool.findIndex((t) => t.id === row.id);
        if (i >= 0) pool.splice(i, 1);
      }
      continue;
    }
    if (pool) {
      const key = merchantKey(row.counterparty);
      const i = pool.findIndex(
        (t) => txBase(t) !== txBase(row) && samePartyKey(merchantKey(t.counterparty), key),
      );
      if (i >= 0) {
        pool.splice(i, 1);
        continue;
      }
    }
    kept.push(row);
  }
  return [...existing, ...kept];
}

export function consolidate(accounts: Account[], txs: Tx[]) {
  const entityOf = new Map(accounts.map((a) => [a.key, a.entity]));
  const byEntity: Record<string, { in: number; out: number; balance: number | null }> = {};
  for (const a of accounts) {
    const b = (byEntity[a.entity] ??= { in: 0, out: 0, balance: 0 });
    b.balance = a.balance === null || b.balance === null ? null : b.balance + a.balance;
  }
  for (const t of txs) {
    const e = entityOf.get(t.accountKey) ?? "onbekend";
    const b = (byEntity[e] ??= { in: 0, out: 0, balance: null });
    if (t.amount >= 0) b.in += t.amount;
    else b.out += t.amount;
  }
  const balances = Object.values(byEntity).map((b) => b.balance);
  const totalBalance =
    balances.length === 0 || balances.some((x) => x === null)
      ? null
      : balances.reduce((s: number, x) => s + (x as number), 0);
  return { byEntity, totalBalance };
}
