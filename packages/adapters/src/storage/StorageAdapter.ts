import type { Account, Tx, Rule } from "@lavega/core";

export interface StorageAdapter {
  getAccounts(): Promise<Account[]>;
  putAccounts(a: Account[]): Promise<void>;
  getTxs(): Promise<Tx[]>;
  putTxs(t: Tx[]): Promise<void>;
  getRules(): Promise<Rule[]>;
  putRules(rules: Rule[]): Promise<void>;
}
