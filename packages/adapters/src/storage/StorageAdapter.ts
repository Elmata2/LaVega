import type { Account, Tx } from "@lavega/core";

export interface StorageAdapter {
  getAccounts(): Promise<Account[]>;
  putAccounts(a: Account[]): Promise<void>;
  getTxs(): Promise<Tx[]>;
  putTxs(t: Tx[]): Promise<void>;
}
