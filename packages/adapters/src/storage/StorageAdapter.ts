import type { Account, Tx, Rule } from "@lavega/core";

export interface StorageAdapter {
  getAccounts(): Promise<Account[]>;
  putAccounts(a: Account[]): Promise<void>;
  getTxs(): Promise<Tx[]>;
  putTxs(t: Tx[]): Promise<void>;
  getRules(): Promise<Rule[]>;
  putRules(rules: Rule[]): Promise<void>;
  /** Remove a single account row by key. Does NOT touch its transactions — the
   *  caller decides (delete them too, or reassign them first for a merge). */
  deleteAccount(key: string): Promise<void>;
  /** Remove transaction rows by id. */
  deleteTxs(ids: string[]): Promise<void>;
}
