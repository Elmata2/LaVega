import type { Bill, BillDecisions } from "./bills/model.js";
import { billMatchId, billRejectionKey } from "./bills/match.js";
import type { ImportSession } from "./csvImport.js";
import type { VaultDocument } from "./statements/types.js";

/* References to transaction ids and account keys that live OUTSIDE the ledger,
 * rewritten after Trading 212 accounts are folded into one (ids are re-derived,
 * the old account key disappears). Pure. A stale reference is not harmless for
 * these four stores: a bill loses its payment (the occurrence reopens), a
 * rejection stops rejecting, an import can no longer be reverted exactly, a
 * document points at an account that is gone. */

export type FoldMove = { survivorKey: string; duplicateKey: string };

const keyAfter = (key: string, folds: readonly FoldMove[]): string =>
  folds.find((f) => f.duplicateKey === key)?.survivorKey ?? key;

const idAfter = (id: string, remap: ReadonlyMap<string, string | null>): string | null =>
  remap.has(id) ? (remap.get(id) ?? null) : id;

/** Match decisions and rejections follow their row; one whose row was absorbed
 *  with no replacement is dropped (the matcher proposes again). */
export function remapBillDecisions(
  decisions: BillDecisions,
  remap: ReadonlyMap<string, string | null>,
): BillDecisions {
  const matchIds = new Set<string>();
  const matches = decisions.matches.flatMap((m) => {
    const txId = idAfter(m.txId, remap);
    if (txId === null) return [];
    const id = txId === m.txId ? m.id : billMatchId(m.occurrenceId, txId);
    if (matchIds.has(id)) return [];
    matchIds.add(id);
    return [{ ...m, id, txId }];
  });
  const seen = new Set<string>();
  const rejections = decisions.rejections.flatMap((r) => {
    const txId = idAfter(r.txId, remap);
    if (txId === null) return [];
    const key = billRejectionKey(r.billId, txId);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...r, txId }];
  });
  return { ...decisions, matches, rejections };
}

/** A series tied to a folded account follows it to the surviving account. */
export function remapBillAccounts(bills: readonly Bill[], folds: readonly FoldMove[]): Bill[] {
  return bills.map((b) =>
    b.accountKey !== undefined && keyAfter(b.accountKey, folds) !== b.accountKey
      ? { ...b, accountKey: keyAfter(b.accountKey, folds) }
      : b,
  );
}

/** An import keeps exactly the rows it created (revert depends on it). */
export function remapImportSessions(
  sessions: readonly ImportSession[],
  remap: ReadonlyMap<string, string | null>,
  folds: readonly FoldMove[],
): ImportSession[] {
  return sessions.map((s) => ({
    ...s,
    accountKey: keyAfter(s.accountKey, folds),
    txIds: [...new Set(s.txIds.flatMap((id) => idAfter(id, remap) ?? []))],
  }));
}

export function remapDocuments(
  documents: readonly VaultDocument[],
  remap: ReadonlyMap<string, string | null>,
  folds: readonly FoldMove[],
): VaultDocument[] {
  return documents.map((d) => ({
    ...d,
    accountKey: d.accountKey === null ? null : keyAfter(d.accountKey, folds),
    suggestedAccountKey:
      d.suggestedAccountKey === null ? null : keyAfter(d.suggestedAccountKey, folds),
    ...(d.txIds ? { txIds: [...new Set(d.txIds.flatMap((id) => idAfter(id, remap) ?? []))] } : {}),
  }));
}
