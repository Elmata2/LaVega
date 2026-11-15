import type { Account, Tx } from "./model.js";
import { isEurCurrency } from "./model.js";
import type { ConversionMode } from "./fx.js";
import { toEur } from "./fx.js";
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
  const upgraded = new Map<string, Tx>();
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
      /* Rule 4, the one exception to "a nameless row absorbs nothing": a stored
       * row with NO counterparty and the SAME description is this very row,
       * stored before the mapper learned to read the party off the payment
       * reference. It is upgraded in place, not counted twice — but only when
       * exactly one stored row matches. Two nameless stored rows sharing the
       * same description give no evidence for which one this incoming row is,
       * so guessing is refused: neither is touched, and the incoming row is
       * dropped rather than kept as a duplicate. */
      const candidates = pool.filter(
        (t) =>
          t.counterparty === "" && row.counterparty !== "" && t.description === row.description,
      );
      if (candidates.length === 1) {
        const stale = candidates[0]!;
        pool.splice(pool.indexOf(stale), 1);
        upgraded.set(stale.id, { ...stale, counterparty: row.counterparty });
        continue;
      }
      if (candidates.length > 1) continue;
    }
    kept.push(row);
  }
  return [...existing.map((t) => upgraded.get(t.id) ?? t), ...kept];
}

export function consolidate(
  accounts: Account[],
  txs: Tx[],
  asOf: string,
  conversion: { fxHistory: Record<string, Record<string, number>>; mode: ConversionMode },
) {
  const entityOf = new Map(accounts.map((a) => [a.key, a.entity]));
  const byEntity: Record<string, { in: number; out: number; balance: number | null }> = {};
  const eurAccountEntities = new Set<string>();
  for (const a of accounts) {
    const b = (byEntity[a.entity] ??= { in: 0, out: 0, balance: 0 });
    if (isEurCurrency(a.currency)) {
      eurAccountEntities.add(a.entity);
      b.balance = a.balance === null || b.balance === null ? null : b.balance + a.balance;
      continue;
    }
    // "separate" mode: excluded, not folded in at face value — but unlike a
    // missing balance it does not make the rest of the entity's balance
    // unknown, as long as the entity has at least one EUR(-equivalent)
    // account to sum (the fix-up loop below handles the entity that has
    // none). "convert" mode folds it in at `asOf`'s rate instead. Two
    // different unknowns live on this path and must not share a `continue`:
    // a genuinely missing `a.balance` means the same thing it means for an
    // EUR account three lines up (this account's contribution is unknown),
    // so it nulls the entity; a `null` from `toEur` means only that no rate
    // was found for a balance that IS known, which excludes this account's
    // contribution exactly like "separate" mode, not the entity's balance.
    if (conversion.mode !== "convert") continue;
    if (a.balance === null) {
      eurAccountEntities.add(a.entity);
      b.balance = null;
      continue;
    }
    const converted = toEur(a.balance, a.currency, asOf, conversion.fxHistory);
    if (converted === null) continue;
    eurAccountEntities.add(a.entity);
    b.balance = b.balance === null ? null : b.balance + converted;
  }
  // An entity whose accounts are ALL non-EUR never ran the sum above, so it is
  // still sitting at the `??=` seed of 0 — a confident "this entity holds
  // nothing", when the truth is LaVega has no EUR-denominated balance for it
  // at all. That is the same "unknown" a missing balance already reports, not
  // a real zero.
  for (const entity of Object.keys(byEntity)) {
    if (!eurAccountEntities.has(entity)) byEntity[entity]!.balance = null;
  }
  for (const t of txs) {
    const e = entityOf.get(t.accountKey) ?? "onbekend";
    const b = (byEntity[e] ??= { in: 0, out: 0, balance: null });
    // A transaction converts at its OWN date, unlike the balance above: a flow
    // has a date already, so there is no `asOf` fallback to reach for.
    const eurAmount = isEurCurrency(t.currency)
      ? t.amount
      : conversion.mode === "convert"
        ? toEur(t.amount, t.currency, t.date, conversion.fxHistory)
        : null;
    if (eurAmount === null) continue;
    if (eurAmount >= 0) b.in += eurAmount;
    else b.out += eurAmount;
  }
  const balances = Object.values(byEntity).map((b) => b.balance);
  const totalBalance =
    balances.length === 0 || balances.some((x) => x === null)
      ? null
      : balances.reduce((s: number, x) => s + (x as number), 0);
  return { byEntity, totalBalance };
}
