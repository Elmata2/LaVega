import {
  applyCardFiles,
  mergeValuations,
  reconcileTransfers,
  remapBillAccounts,
  remapBillDecisions,
  remapDocuments,
  remapImportSessions,
  type Account,
  type AccountFold,
  type Bill,
  type BillDecisions,
  type BillOccurrence,
  type CardFileInput,
  type ImportSession,
  type TransferPair,
  type Tx,
  type Valuation,
  type VaultDocument,
} from "@lavega/core";
import { txDiff } from "../accountActions.js";

/** Every stored record that points at a transaction id or an account key. A fold
 *  changes both, so each is rewritten (see `writeFoldReferences`). */
export type FoldRefsState = {
  transfers: TransferPair[];
  valuations: Valuation[];
  bills: Bill[];
  billOccurrences: BillOccurrence[];
  decisions: BillDecisions;
  sessions: ImportSession[];
  documents: VaultDocument[];
};

export type FoldRefsStore = {
  putTransfers(p: TransferPair[]): Promise<void>;
  putValuations(v: Valuation[]): Promise<void>;
  putBillPlan(b: Bill[], o: BillOccurrence[], d: BillDecisions): Promise<void>;
  putImportSessions(s: ImportSession[]): Promise<void>;
  putDocuments(d: VaultDocument[]): Promise<void>;
};

const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);

/** Rewrite the records that point at folded rows or accounts, from the pure
 *  result of the fold. Each store is written only when it changed, in this
 *  order; every later step can be repeated (a repeat finds nothing to change). */
export async function writeFoldReferences(
  state: FoldRefsState,
  store: FoldRefsStore,
  out: { folds: AccountFold[]; txIdRemap: Map<string, string | null> },
  onStep: (next: FoldRefsState) => void = () => {},
): Promise<FoldRefsState> {
  let next = state;
  const transfers = reconcileTransfers(state.transfers, out.txIdRemap).pairs;
  if (changed(transfers, state.transfers)) {
    await store.putTransfers(transfers);
    next = { ...next, transfers };
    onStep(next);
  }
  let valuations = state.valuations;
  for (const f of out.folds)
    valuations = mergeValuations(valuations, f.survivorKey, f.duplicateKey).valuations;
  if (changed(valuations, state.valuations)) {
    await store.putValuations(valuations);
    next = { ...next, valuations };
    onStep(next);
  }
  const decisions = remapBillDecisions(state.decisions, out.txIdRemap);
  const bills = remapBillAccounts(state.bills, out.folds);
  if (changed(decisions, state.decisions) || changed(bills, state.bills)) {
    await store.putBillPlan(bills, state.billOccurrences, decisions);
    next = { ...next, bills, decisions };
    onStep(next);
  }
  const sessions = remapImportSessions(state.sessions, out.txIdRemap, out.folds);
  if (changed(sessions, state.sessions)) {
    await store.putImportSessions(sessions);
    next = { ...next, sessions };
    onStep(next);
  }
  const documents = remapDocuments(state.documents, out.txIdRemap, out.folds);
  if (changed(documents, state.documents)) {
    await store.putDocuments(documents);
    next = { ...next, documents };
    onStep(next);
  }
  return next;
}

type Store = {
  putAccounts(a: Account[]): Promise<void>;
  putTxs(t: Tx[]): Promise<void>;
  getAccounts(): Promise<Account[]>;
  getTxs(): Promise<Tx[]>;
  deleteTxs(ids: string[]): Promise<void>;
  deleteAccount(key: string): Promise<void>;
};

export type CommitResult =
  | {
      ok: true;
      count: number;
      accounts: Account[];
      txs: Tx[];
      /** The accounts this import wrote, as stored (the dialog asks for missing balances). */
      written: Account[];
      /** Trading 212 accounts folded into the one account by this commit (empty when none). */
      folds: AccountFold[];
      /** Old tx id -> id after the fold (null = absorbed), for records that point at txs. */
      txIdRemap: Map<string, string | null>;
    }
  | {
      ok: false;
      /** Something had already been written when it failed. */
      partial: boolean;
      /** The vault as it is now, when it could be re-read; the caller shows it. */
      accounts: Account[] | null;
      txs: Tx[] | null;
    };

/** Write the files, planned against the vault as it is passed in (the caller
 *  hands the CURRENT state, not the one the previews were made on). `after` runs
 *  the follow-up steps (invoices, bills) on the stored data; a failure there is
 *  also reported, because the rows are already in. On any failure the stores are
 *  re-read so the app state matches what is really saved. */
export async function commitToStorage(
  store: Store,
  held: { accounts: readonly Account[]; txs: readonly Tx[] },
  files: CardFileInput[],
  asOf: string,
  after: (accounts: Account[], txs: Tx[]) => Promise<void>,
  refs?: {
    state: FoldRefsState;
    store: FoldRefsStore;
    /** Called after each successful rewrite with the state as stored. */
    onWritten: (next: FoldRefsState) => void;
  },
): Promise<CommitResult> {
  let wrote = false;
  try {
    const out = applyCardFiles(held, files, asOf);
    const { upserts } = txDiff([...held.txs], out.txs);
    await store.putAccounts(out.accounts);
    wrote = true;
    if (upserts.length > 0) await store.putTxs(upserts);
    // A fold moved rows to the one account (new ids) and drops the old account.
    // Order: new rows (above), then every record that points at the old rows or
    // account, THEN the deletes. A failure anywhere leaves the old rows and
    // account in place, so the next import folds again and finishes the job.
    if (out.folds.length > 0 && refs !== undefined)
      await writeFoldReferences(refs.state, refs.store, out, refs.onWritten);
    if (out.removedTxIds.length > 0) await store.deleteTxs(out.removedTxIds);
    for (const key of out.removedAccountKeys) await store.deleteAccount(key);
    const [accounts, txs] = await Promise.all([store.getAccounts(), store.getTxs()]);
    await after(accounts, txs);
    const keys = new Set(out.accounts.map((a) => a.key));
    return {
      ok: true,
      count: out.added,
      accounts,
      txs,
      written: accounts.filter((a) => keys.has(a.key)),
      folds: out.folds,
      txIdRemap: out.txIdRemap,
    };
  } catch {
    try {
      const [accounts, txs] = await Promise.all([store.getAccounts(), store.getTxs()]);
      return { ok: false, partial: wrote, accounts, txs };
    } catch {
      return { ok: false, partial: wrote, accounts: null, txs: null };
    }
  }
}
