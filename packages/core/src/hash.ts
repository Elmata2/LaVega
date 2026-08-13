import type { Tx } from "./model.js";

export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const norm = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The stable identity string for a transaction: accountKey + date + amount +
 *  trimmed counterparty/description. Shared by `assignTxIds` and the account
 *  merge (`mergeAccounts`) so both derive tx ids identically — the merge
 *  re-keys a duplicate's txs to the survivor and must land on the same ids. */
export function txBase(r: Pick<Tx, "accountKey" | "date" | "amount" | "counterparty" | "description">): string {
  return [r.accountKey, r.date, r.amount.toFixed(2),
    norm(r.counterparty).slice(0, 40), norm(r.description).slice(0, 60)].join("|");
}

/** The tx id for a base + 1-based occurrence (identical bases in one set get
 *  1, 2, … so genuine same-day repeats stay distinct). The counter is hashed
 *  IN, so the id itself is a single djb2 token with no literal "#". */
export function txId(base: string, occurrence: number): string {
  return hash(base + "#" + occurrence);
}

export function assignTxIds(rows: Omit<Tx, "id">[]): Tx[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = txBase(r);
    const n = (seen.get(base) ?? 0) + 1;   // 1-based, matches Kasoverzicht
    seen.set(base, n);
    return { ...r, id: txId(base, n) };
  });
}
