import type { Account, Tx, Rule, EntityProfile } from "@lavega/core";

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
  /** Per-entity privé/zakelijk classification (BACKLOG item 4). Stored beside
   *  the accounts rather than on them: the classification belongs to the entity,
   *  and every account inherits it (see `entities.ts`). Replace-all, like rules;
   *  an adapter with nothing stored returns [] and every entity is personal. */
  getEntityProfiles(): Promise<EntityProfile[]>;
  putEntityProfiles(profiles: EntityProfile[]): Promise<void>;
}
