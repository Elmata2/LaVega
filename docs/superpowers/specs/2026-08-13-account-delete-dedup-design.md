# Account delete + duplicate detection/merge — design

**Goal:** Let the owner (1) delete an account and its transactions, and (2) find + merge duplicate accounts that arose from importing the same real account two ways (CSV keys by raw BBAN/product-name, MT940/Enable Banking key by full IBAN → two `Account` rows with split transactions).

**Local-first, deterministic, confirm-first.** No LLM, no network. All logic in pure `@lavega/core`; storage gains two removal primitives; the UI lives in Rekeningen.

## Root problem

- Accounts are keyed `findIban(raw) || raw` at every producer, so the same real account gets two keys across formats (`packages/core/src/parsers/*`, `enableBankingMap.ts`).
- `Tx.accountKey` is the only account link, and `Tx.id` is a content hash that **includes `accountKey`** (`hash.ts` `assignTxIds`). Merging by rewriting `accountKey` therefore changes/collides ids — must be regenerated + deduped.
- Storage is **upsert-only** — `putAccounts`/`putTxs` never remove; `putRules` is replace-all. There is no delete of any kind today.

## The two capabilities

Deleting a duplicate row loses that row's transactions (duplicates often hold *different* date ranges), so it is **not** a safe duplicate fix. Merge is. Both are built, from orthogonal storage primitives.

### 1. Duplicate detection (pure core, new `packages/core/src/accounts.ts`)

- `canonicalAccountId(a: Account): string | null` — the domestic account number for matching. From a full IBAN (`findIban(a.iban) ?? findIban(a.key)`) take the BBAN (`iban.slice(8)`), digits-only, leading zeros stripped; else from the raw `key`, digits-only, leading zeros stripped. Require ≥4 digits, else `null` (product-name-only keys like Revolut "Betaalrekening" are deliberately unmatchable → never flagged).
- `findDuplicateAccounts(accounts): DuplicateGroup[]` — group by `canonicalAccountId`; keep groups with ≥2 **distinct keys**; drop a group whose accounts span **two different non-empty banks** (coincidental number collision; empty bank = wildcard). Each group carries an auto-picked `survivor` (score: full IBAN ≫ balance set > type set > name≠key; deterministic tie-break by `key`). Sorted by `canonicalId` for determinism.
- `type DuplicateGroup = { canonicalId: string; accounts: Account[]; survivor: Account }`.

### 2. Merge (pure core, in `accounts.ts`)

- `mergeAccounts(accounts, txs, survivorKey, duplicateKey): { accounts: Account[]; txs: Tx[] }`.
- Transactions: keep the survivor's txs unchanged (stable ids). Re-key the duplicate's txs to `survivorKey` and **union by `txBase`** (the `assignTxIds` base) using **max-count-per-base** — if both statements cover the same day with the same 2 movements, the merged set has 2, not 4; a range the survivor lacks is appended. Surplus copies get ids `hash(base + "#" + occurrence)` continuing the survivor's occurrence count (matches `assignTxIds`).
- Accounts: drop the duplicate; enrich the survivor's `iban` **only** if it was empty (identity field). All other survivor fields (entity/type/balance) are kept as-is.
- No-op guard when `survivorKey === duplicateKey` or either is missing.

To keep merge and id-assignment in sync (DRY), factor the base/id out of `assignTxIds`: export `txBase(row)` and `txId(base, occurrence)` from `hash.ts` and have `assignTxIds` use them.

## Storage — two new removal primitives (both adapters + parity tests)

Add to `StorageAdapter`:
- `deleteAccount(key: string): Promise<void>` — removes the account row **only** (not its txs; deletion of txs is a separate call so merge can reassign first).
- `deleteTxs(ids: string[]): Promise<void>` — removes tx rows by id.

- **indexeddb.ts:** `store.delete(key)` on `accounts`; `store.delete(id)` per id on `txs` (both in one readwrite tx, `db.close()`).
- **encryptedStorage.ts:** filter `data.accounts` / `data.txs` and `persist()`, **through `enqueueWrite`** (same serialization as every mutator — a delete resolving out of order must not revert the blob).

## Web (App + Rekeningen)

- `App`: `duplicateGroups = useMemo(findDuplicateAccounts(accounts))` over the **full** accounts list. Two handlers:
  - `handleDeleteAccount(key)`: compute ids of txs with that key → `deleteTxs(ids)` + `deleteAccount(key)`; `setAccounts`/`setTxs` filtered. Existing self-heal (`App.tsx:294-303`) already clears any filter/scope pointing at the gone account.
  - `handleMergeDuplicates(survivorKey, duplicateKey)`: run `mergeAccounts`; persist the diff (`deleteTxs(old duplicate tx ids)`, `putTxs(new surplus txs)`, `putAccounts([survivor])`, `deleteAccount(duplicateKey)`); `setAccounts`/`setTxs` to the merged arrays.
- `Rekeningen`: new props `onDeleteAccount(key)`, `duplicateGroups`, `onMergeDuplicates(survivorKey, duplicateKey)`.
  - Per-row **"Verwijder"** button (trailing cell) → inline "Weet je het zeker? Ja / Nee" confirm (never `window.confirm`-less one-click) → `onDeleteAccount`. Copy names the tx count being removed.
  - **Duplicate banner** under `<h2>`: one row per group intersecting the current (scoped) view — *"Deze rekeningen lijken dezelfde rekening: ‹A›, ‹B›. LaVega houdt ‹survivor› aan."* + **"Samenvoegen"** (inline confirm) → `onMergeDuplicates`.

## Edge cases

- Merge overlap collapses by `txBase` max-count (no double-count); distinct ranges concatenate.
- `ownAccounts` (transfer detection) and categories recompute from the new accounts/txs automatically (useMemo deps).
- Rekeningen receives `scopedAccounts`; `duplicateGroups` is computed on full `accounts` but the banner only shows groups with ≥1 account in the scoped view.
- Deleting the last account of an entity: self-heal resets `entityScope`/filters.

## Testing

- **core** `accounts.test.ts`: `canonicalAccountId` (IBAN→BBAN, raw BBAN with leading zeros, product-name→null, <4 digits→null); `findDuplicateAccounts` (groups same number+bank; ignores product-name-only; skips cross-bank collision; survivor pick prefers IBAN row); `mergeAccounts` (re-keys + collapses overlap by max-count, regenerates ids, appends distinct range, enriches empty iban, drops duplicate, no-op guard). `hash.test.ts`: `txBase`/`txId` unchanged behavior (assignTxIds parity).
- **adapters** `encryptedStorage.test.ts` + `indexeddb.test.ts`: `deleteAccount` removes only the row; `deleteTxs` removes only those ids; parity across both adapters.
- **web** logic test for the delete/merge storage-diff helper if factored out (tx-id set math).

## Build

Subagent-driven-development, ~5 tasks: core detection → core merge (+hash refactor) → storage primitives → web delete → web dedup/merge banner. Whole-branch review, then merge to master (deploys).
