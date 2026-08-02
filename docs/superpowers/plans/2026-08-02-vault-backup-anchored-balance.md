# LaVega — Anchored balance + encrypted vault (at-rest) + encrypted back-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. This plan contains **security-critical crypto** — review the crypto tasks with extra rigor; getting encryption wrong is worse than none.

**Goal:** Three features. (A) **Anchored balance** — a per-account balance "as of a date", rolled forward to today with later transactions, so the shown position stays current. (B) **Encrypted vault** — all local data encrypted at rest behind a passphrase (AES-GCM-256, PBKDF2), with a session unlock gate and a safe migration of existing plaintext. (C) **Encrypted back-up** — export/import all data as one passphrase-encrypted file.

**Architecture:** (A) a `balanceDate?: string` field on `Account` + a pure `currentBalance(account, txs)` helper in `@lavega/core`; the app rolls balances forward before display/consolidate/forecast. (B) a `crypto.ts` module (Web Crypto) in `@lavega/adapters` + a `createEncryptedStorage()` `StorageAdapter` that stores ONE AES-GCM blob in IndexedDB and holds the derived key in memory only; App gains an unlock/setup gate + a one-time plaintext→vault migration. (C) pure serialize/parse + reuse the crypto for a downloadable `.lavega` back-up.

**Tech:** Web Crypto (`crypto.subtle`, verified available in Node 22 → testable), `idb`, TypeScript, Vitest (+ jsdom + fake-indexeddb).

## Global Constraints
- **Crypto correctness is paramount.** AES-GCM-256; **12-byte random IV per encryption, never reused** with the same key; PBKDF2-SHA-256 with a **16-byte random salt** and **≥210,000 iterations**; the derived `CryptoKey` is **non-extractable** and lives in memory only — never written to disk/IndexedDB/localStorage. Wrong passphrase → GCM auth failure → surfaced as "onjuist wachtwoord", never a silent empty-decrypt.
- **No data loss on migration.** The plaintext→vault migration must read all existing data, write the encrypted vault, verify it decrypts, and only THEN delete the plaintext stores. On any failure, leave plaintext intact.
- **`packages/core` stays I/O-free** (feature A is pure). Crypto/vault live in `@lavega/adapters` (I/O layer). No new runtime deps (Web Crypto + idb are enough).
- **Backward compatible.** `balanceDate` optional; accounts without it treat `balance` as current. Existing tests stay green.
- Dutch UI copy. **Honest data-loss warnings** on vault setup + a forced back-up prompt.

---

### Task 1: Anchored balance — `balanceDate` + `currentBalance` (pure)

**Files:** modify `packages/core/src/model.ts` (add `balanceDate?: string` to `Account`), create `packages/core/src/balance.ts` + `balance.test.ts`, export from `index.ts`; set `balanceDate` in the MT940 parser (`mt940.ts` — closing-balance date) and ABN CSV (`bankCsv.ts` parseABN — last row's date).

**Interfaces:**
```ts
// Account gains: balanceDate?: string   // ISO date the `balance` is valid as-of; absent => balance is "current"
/** Current balance rolled forward to `asOf`: stored balance + txs strictly after
 *  balanceDate, up to and including asOf. null balance stays null (unknown).
 *  No balanceDate => balance is already current (returned as-is when non-null). */
export function currentBalance(account: Account, txs: Tx[], asOf: string): number | null;
/** Convenience: map accounts to the same accounts with `balance` replaced by
 *  currentBalance(...) so consolidate/forecast/display all see the rolled-forward position. */
export function withCurrentBalances(accounts: Account[], txs: Tx[], asOf: string): Account[];
```
- `currentBalance`: if `account.balance == null` → null. Let `d = account.balanceDate`. `sum = Σ tx.amount` over txs where `tx.accountKey === account.key` AND (`d ? tx.date > d : false`) AND `tx.date <= asOf`. Return `round((account.balance + sum) * 100) / 100` (avoid float drift). If no `d`, `sum` is 0 → returns `account.balance`.
- MT940: `parseMt940` sets `balanceDate` on the account = the date of the `:62F:`/last `:61:` (the closing-balance date — use the max tx date in that block, or the statement's closing date if available). ABN CSV `parseABN`: `balanceDate` = the last row's date (its "close" is that day's balance).
- **TDD:** currentBalance with/without balanceDate; rolls only txs strictly after the date and ≤ asOf; null stays null; withCurrentBalances maps correctly. MT940 fixture asserts balanceDate set.
- App integration (in Task 1's web change OR fold into a later UI task — do it here): compute `withCurrentBalances(scopedAccounts, scopedTxs, asOf)` once and pass to Overzicht/Rekeningen/Forecast; the Rekeningen Saldo editor edits the RAW balance + shows/edits its date (a date input next to the saldo, default today on manual entry). Keep the manual-saldo commit setting `balanceDate = today` when the user sets a value.
- Commit: `feat(core): anchored balance (balanceDate) + currentBalance roll-forward`.

### Task 2: Crypto core (Web Crypto) — pure key/enc/dec

**Files:** create `packages/adapters/src/crypto/vaultCrypto.ts` + `vaultCrypto.test.ts`.
**Interfaces:**
```ts
export type CipherBlob = { v: 1; kdf: "PBKDF2-SHA256"; iterations: number; salt: string; iv: string; ct: string }; // base64 fields
export function newSalt(): Uint8Array;                                   // 16 random bytes
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey>; // AES-GCM 256, non-extractable
export async function encryptJSON(key: CryptoKey, salt: Uint8Array, iterations: number, data: unknown): Promise<CipherBlob>; // fresh 12-byte IV
export async function decryptJSON<T>(key: CryptoKey, blob: CipherBlob): Promise<T>;                            // throws on wrong key (GCM auth)
```
- `deriveKey`: `importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey'])` → `deriveKey({name:'PBKDF2', salt, iterations, hash:'SHA-256'}, ..., {name:'AES-GCM', length:256}, false, ['encrypt','decrypt'])`. Non-extractable.
- `encryptJSON`: `iv = getRandomValues(12)`; `ct = AES-GCM.encrypt(iv, utf8(JSON.stringify(data)))`; base64-encode salt/iv/ct.
- `decryptJSON`: rebuild iv/ct from base64; `AES-GCM.decrypt` (throws on auth failure) → `JSON.parse`.
- Use `globalThis.crypto.subtle` (works in Node 22 + browsers). Base64 via a small helper (no deps).
- **TDD:** round-trip (encrypt→decrypt equals input); **wrong passphrase → decrypt throws** (assert rejects); a different salt/derive gives a different key; IV differs across two `encryptJSON` calls (no reuse); iterations ≥ 210_000 default.
- Commit: `feat(adapters): Web Crypto vault primitives (PBKDF2 + AES-GCM)`.

### Task 3: Encrypted vault storage adapter

**Files:** create `packages/adapters/src/storage/encryptedStorage.ts` + `encryptedStorage.test.ts`.
**Interface:** `createEncryptedStorage()` returns a `StorageAdapter` PLUS a vault-control surface:
```ts
export type VaultStatus = "empty" | "locked" | "unlocked";
export interface VaultStorage extends StorageAdapter {
  status(): Promise<VaultStatus>;              // empty = no vault yet; locked = vault exists, no key; unlocked = key in memory
  setup(passphrase: string, seed?: { accounts: Account[]; txs: Tx[]; rules: Rule[] }): Promise<void>; // create vault (optionally from migrated plaintext), unlock
  unlock(passphrase: string): Promise<boolean>; // derive key, try decrypt; false on wrong passphrase (no throw to caller)
  lock(): void;                                 // drop the in-memory key
  export(): Promise<CipherBlob>;                // the current vault blob (for back-up) — Task 5 uses this
}
```
- IndexedDB DB `lavega-vault`, store `vault` (keyPath none; fixed key "v"): one record = the `CipherBlob`. The derived key + decrypted `{accounts,txs,rules}` are held in a closure (memory) after unlock.
- `getAccounts/putAccounts/...`: operate on the in-memory decrypted data; every `put*` re-encrypts the whole `{accounts,txs,rules}` with a **fresh IV** and writes the blob. Throw if called while locked.
- `unlock`: read blob, `deriveKey(pass, blob.salt, blob.iterations)`, `decryptJSON` — on success cache key+data, return true; on GCM failure return false.
- **TDD (fake-indexeddb + node crypto):** setup→put→lock→unlock(correct)→get round-trips; unlock(wrong)→false and data stays inaccessible; put while locked throws; the on-disk `vault` record is ciphertext (no plaintext account key/counterparty substring present); re-encrypt uses a fresh IV each write.
- Commit: `feat(adapters): encrypted vault StorageAdapter (at-rest AES-GCM)`.

### Task 4: App unlock/setup gate + plaintext→vault migration + Rekeningen date UI

**Files:** modify `apps/web/src/App.tsx` (+ `main.tsx` if needed); create `apps/web/src/components/VaultGate.tsx`; small migration helper.
- On load, `status()`:
  - **empty + legacy plaintext present** (existing `lavega` v2 DB has data) → **migration flow**: show a "Beveilig je data" screen: warn *"wachtwoord kwijt = data kwijt"*, require passphrase (twice) + a checkbox "ik heb dit begrepen", then `setup(pass, seed=<read from plaintext>)`, verify unlock, delete the plaintext `lavega` DB, and **prompt/force a back-up** (Task 5). Never delete plaintext before the vault verifies.
  - **empty + no data** → setup screen (create passphrase, same warning) → empty vault.
  - **locked** → unlock screen (passphrase; wrong → "onjuist wachtwoord, probeer opnieuw").
  - **unlocked** → render the app; all storage goes through the vault.
- A "Vergrendel" button (lock()) in the sidebar footer; re-prompts unlock.
- Rekeningen: add the balanceDate control (date input) beside the editable saldo (Task 1's UI bit can land here if not in Task 1).
- **TDD:** headless — migration seeds a plaintext DB, runs the migration path, asserts the vault holds the data + plaintext DB is gone + a wrong passphrase can't unlock; the "no plaintext-delete before verify" invariant. UI gate logic (a pure `gateState(status, hasLegacy)` helper) unit-tested.
- Commit: `feat(web): vault unlock/setup gate + plaintext→vault migration`.

### Task 5: Encrypted back-up (export + import)

**Files:** create `apps/web/src/views/Backup.tsx` (or a card in Import/Instellingen) + a pure `backup.ts` (serialize/parse) + test.
- **Export:** `{ v:1, exportedAt, accounts, txs, rules }` → `encryptJSON` (reuse the session key OR a fresh passphrase-derived key — default: reuse the unlocked vault key so it's the same passphrase) → download as `lavega-backup-<date>.lavega` (a Blob + anchor click; `exportedAt`/date passed in from the UI, not `new Date()` in pure code).
- **Import:** file → parse `CipherBlob` → `decryptJSON` (prompt passphrase if importing on a fresh machine) → `putAccounts/putTxs/putRules` (replace-all restore). Guard: malformed/other-passphrase file → clear error, no partial write.
- **TDD:** export→import round-trips through the real crypto; wrong passphrase on import → clean failure; malformed file → error, storage untouched.
- Commit: `feat(web): encrypted back-up export + import`.

## Self-Review checklist
- Crypto: AES-GCM-256, fresh 12-byte IV per encrypt (never reused), PBKDF2-SHA256 ≥210k iters + 16-byte random salt, non-extractable key in memory only, wrong passphrase → auth failure surfaced. Migration never deletes plaintext before the vault verifies; no data loss. `balanceDate` optional + backward compatible; currentBalance rolls only post-date, ≤ asOf txs; null stays null. Back-up encrypted; import guarded. Existing tests green. `core` I/O-free (feature A). No new deps.

## Notes
- Data-loss is inherent and accepted (user confirmed): no recovery without the passphrase; the encrypted back-up is the only mitigation, and it needs the same passphrase — the setup flow must force a back-up + warn clearly.
- Deferred: passphrase change/rotation (re-derive + re-encrypt); multi-passphrase; biometric/WebAuthn unlock; per-record (vs whole-blob) encryption (unneeded at this data volume).
- `asOf` for currentBalance/back-up timestamps comes from the App-level `asOf` (one clock read), keeping pure code deterministic.
