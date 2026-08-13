import type { Tx } from "@lavega/core";

/** Ids of every transaction belonging to one account — what a delete has to
 *  remove from storage before the account row itself goes. */
export function txIdsForAccount(txs: Tx[], accountKey: string): string[] {
  return txs.filter((t) => t.accountKey === accountKey).map((t) => t.id);
}

/** The storage writes that turn `prev` into `next`. Storage is upsert-only plus
 *  the two removal primitives, so a state change is expressed as: ids that
 *  disappeared (→ deleteTxs) and rows that are new or changed (→ putTxs).
 *  Diffing by id is enough for a merge because re-keying a transaction to the
 *  survivor regenerates its id (the id hash includes accountKey) — the old id
 *  shows up as removed, the new one as an upsert. */
export function txDiff(prev: Tx[], next: Tx[]): { removedIds: string[]; upserts: Tx[] } {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextIds = new Set(next.map((t) => t.id));
  return {
    removedIds: prev.filter((t) => !nextIds.has(t.id)).map((t) => t.id),
    // A same-id row that changed in place still needs rewriting; the comparison
    // is a cheap serialize (an extra upsert is harmless, a missed one is not).
    upserts: next.filter((t) => {
      const before = prevById.get(t.id);
      return !before || JSON.stringify(before) !== JSON.stringify(t);
    }),
  };
}
