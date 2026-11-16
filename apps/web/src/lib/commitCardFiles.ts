import { applyCardFiles, type Account, type CardFileInput, type Tx } from "@lavega/core";

type Store = {
  putAccounts(a: Account[]): Promise<void>;
  putTxs(t: Tx[]): Promise<void>;
  getAccounts(): Promise<Account[]>;
  getTxs(): Promise<Tx[]>;
};

export type CommitResult =
  | { ok: true; count: number; accounts: Account[]; txs: Tx[] }
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
): Promise<CommitResult> {
  let wrote = false;
  try {
    const out = applyCardFiles(held, files, asOf);
    await store.putAccounts(out.accounts);
    wrote = true;
    await store.putTxs(out.txs);
    const [accounts, txs] = await Promise.all([store.getAccounts(), store.getTxs()]);
    await after(accounts, txs);
    return { ok: true, count: out.added, accounts, txs };
  } catch {
    try {
      const [accounts, txs] = await Promise.all([store.getAccounts(), store.getTxs()]);
      return { ok: false, partial: wrote, accounts, txs };
    } catch {
      return { ok: false, partial: wrote, accounts: null, txs: null };
    }
  }
}
