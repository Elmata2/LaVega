# Account-held vault key

## Status

Accepted 2026-10-07. Replaces the vault password for the personal vault. Amends
[0004](0004-neon-data-boundaries.md): Neon now holds the personal vault's key, sealed.

## Context

The personal vault (accounts, transactions, invoices, rules) was encrypted in the browser
with a key derived from a vault password, separate from the account password. The server
could not read the vault, and nobody could recover it: a forgotten vault password lost the
data. Every sign-in also asked for a second password.

Public sign-up opens on 2026-10-08. New users expect one sign-in, and a password reset that
does not erase their data. That is how banks and personal-finance apps work.

## Decision

Each account has one random 256-bit vault key.

1. The first signed-in `GET /api/vault/key` creates the key and stores it in
   `personal.vault_keys`, sealed with `LAVEGA_ENCRYPTION_KEY` (`encryptBlob`). The key never
   exists before the user signs in, and an account that never opens Personal has none.
2. The route returns the raw key to its owner only, with `Cache-Control: private, no-store`.
3. The browser imports it as a non-extractable AES-GCM key and seals the vault with it
   (`{ v: 2, kdf: "account-key", iv, ct }`). The vault stays in IndexedDB, one database per
   account (`lavega-vault:user:<id>`).
4. The key is never replaced. The table grants no `UPDATE` to `lavega_runtime`.
5. Account erasure deletes the key. Every copy of that vault, in any browser or in
   `personal.vaults`, becomes unreadable.

A deployment with no accounts (self-hosted, no `DATABASE_URL`) makes the key in the browser
and keeps it in IndexedDB as a non-extractable `CryptoKey`.

## Migration of existing vaults

A browser that still holds a password vault (`v: 1`, database `lavega-vault`) shows
"Move your data over" once. The old password decrypts it; the data is re-sealed under the
account key and the password copy is deleted. "Start empty" leaves the old vault in place and
is not asked again. Old `.lavega` back-up files restore with their old password and are
re-sealed under the account key.

## Consequences

- The server can technically decrypt a personal vault: it holds both the sealed key and
  `LAVEGA_ENCRYPTION_KEY`, and `personal.vaults` holds the back-up blob. No server code
  decrypts a vault; `createVaultKeyRepository` reads only `personal.vault_keys`. The privacy
  policy must not claim that LaVega cannot read personal data.
- Losing `LAVEGA_ENCRYPTION_KEY` loses every vault key, as it already loses every broker
  credential. Back it up.
- A password reset no longer loses personal data.
- "Vergrendel" became "Uitloggen": the key returns with the next sign-in, so locking is
  signing out. The 15-minute idle lock (security review M7) signs out.
- Investing is unchanged: broker vaults already used `LAVEGA_ENCRYPTION_KEY`.
- Vault data still lives in the browser. Moving it to Neon (sync across devices without a
  manual back-up) needs no new key decision, only a storage adapter.
