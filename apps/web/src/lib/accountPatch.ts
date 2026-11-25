import type { Account } from "@lavega/core";

/** Applies `patch` to one account in the latest list (the ref), not in the list a
 *  render closed over, so two edits in the same moment compose instead of the second
 *  overwriting the first. Returns the changed account, or null for an unknown key. */
export function patchAccount(
  ref: { current: readonly Account[] },
  key: string,
  patch: Partial<Account>,
): Account | null {
  const prev = ref.current.find((a) => a.key === key);
  if (prev === undefined) return null;
  const changed = { ...prev, ...patch };
  ref.current = ref.current.map((a) => (a.key === key ? changed : a));
  return changed;
}

/** The state updater for a patch: merges into the account as it is now, so a field
 *  saved by another path that has not rendered yet is kept. */
export const mergePatch =
  (key: string, patch: Partial<Account>) =>
  (cur: Account[]): Account[] =>
    cur.map((a) => (a.key === key ? { ...a, ...patch } : a));

export type AccountEditorStore = {
  /** The latest account list. The editor reads and writes it synchronously. */
  ref: { current: readonly Account[] };
  /** React state, set through a merging updater. */
  setState(update: (cur: Account[]) => Account[]): void;
  put(accounts: Account[]): Promise<void>;
};

type Books = {
  /** Last value known to be in storage, per field that has a pending write. */
  persisted: Record<string, unknown>;
  /** The newest edit that set each field. */
  latest: Record<string, number>;
  pending: number;
};

/** The one path for single-account edits. An edit changes the latest list and the
 *  state at once. With `persist`, the merged current account is written, after any
 *  earlier write of the same account (other accounts do not wait). A failed write
 *  puts a field back to what storage holds, but only if no newer edit set that field
 *  since: that newer edit's own write decides. The error is rethrown. */
export function createAccountEditor(store: AccountEditorStore) {
  const chains = new Map<string, Promise<unknown>>();
  const books = new Map<string, Books>();
  let counter = 0;
  const find = (key: string) => store.ref.current.find((a) => a.key === key);
  const gone = (key: string) => new Error(`Account ${key} no longer exists`);

  async function edit(
    key: string,
    patch: Partial<Account>,
    opts: { persist?: boolean } = {},
  ): Promise<void> {
    const prev = find(key);
    if (prev === undefined) {
      if (opts.persist === true) throw gone(key);
      return;
    }
    const fields = Object.keys(patch) as (keyof Account)[];
    let b: Books | undefined;
    const id = ++counter;
    if (opts.persist === true) {
      b = books.get(key) ?? { persisted: {}, latest: {}, pending: 0 };
      books.set(key, b);
      for (const f of fields) {
        if (!(f in b.persisted)) b.persisted[f] = prev[f];
        b.latest[f] = id;
      }
      b.pending++;
    }
    patchAccount(store.ref, key, patch);
    store.setState(mergePatch(key, patch));
    if (b === undefined) return;
    const book = b;
    const run = async () => {
      const current = find(key);
      if (current === undefined) throw gone(key);
      try {
        await store.put([current]);
        for (const f of Object.keys(book.persisted))
          book.persisted[f] = current[f as keyof Account];
      } catch (e) {
        const undo: Partial<Account> = {};
        for (const f of fields)
          if (book.latest[f] === id) (undo as Record<string, unknown>)[f] = book.persisted[f];
        if (find(key) !== undefined) {
          patchAccount(store.ref, key, undo);
          store.setState(mergePatch(key, undo));
        }
        throw e;
      }
    };
    const task = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    chains.set(key, task);
    try {
      await task;
    } finally {
      if (--book.pending === 0) {
        books.delete(key);
        if (chains.get(key) === task) chains.delete(key);
      }
    }
  }
  return { edit };
}
