# Vault gate

The personal vault is encrypted in the browser with the account's vault key (docs/adr/0009-account-held-vault-key.md). The server creates that key on the first signed-in `GET /api/vault/key` and hands it only to its owner. There is no vault password: a signed-in user goes straight to Overzicht. A deployment with no accounts (no `DATABASE_URL`) uses a key made in the browser instead.

## Sub-features

- `vault-open` a signed-in user lands on Overzicht with no password prompt. The first visit creates the key and an empty vault; later visits reopen it.
- `vault-key-route` `GET /api/vault/key` answers 401 without a session, and `{ key }` (base64, 32 bytes) with `Cache-Control: private, no-store` with one. The same session always gets the same key.
- `vault-per-account` two accounts that sign in on the same browser each get their own vault (IndexedDB database `lavega-vault:user:<id>`).
- `vault-adopt` a browser that still holds a password vault from before account keys (IndexedDB database `lavega-vault`) shows `Zet je gegevens over` once. The old password moves the data under the account key; `Begin leeg` leaves the old vault alone and starts empty.
- `vault-signout` the `Uitloggen` card in Profiel, and 15 minutes without activity, sign the user out and clear the vault from memory.
- `vault-restore` Back-up restores a `.lavega` file from the same account with no password. A file from before account keys needs its old vault password.

## How to get to it (user POV)

- Sign in from the landing page (`Inloggen`), then `/app` opens.

## Driving it with control-lavega + browser

Preconditions:

- Local instance up with a database and auth configured, and a verified test account. Do not use the user's own account.
- A fresh browser origin (new `--port`) so no old vault exists there.

- **Open.** Sign in, `navigate` to `/app`. Page text has no `Kluiswachtwoord` field; the nav rail `aria-label="Weergaven"` is visible. Screenshot `vault-gate-00-open.png`.
- **Key route.** `control-lavega` `GET /api/vault/key` with the session: 200, a `key`, and `cache-control: private, no-store`. Without the session: 401.
- **Persist.** Import a bank file, reload. The same accounts show; no gate. Screenshot `vault-gate-01-reload.png`.
- **Sign out.** Profiel → `Uitloggen`. The landing page shows; `/app` redirects to `/`.
- **Proof.** Screenshots and the key-route responses (redact the key) in `/tmp/lavega-verify/evidence/`.

## Gotchas

- Never print or save the key value in evidence. Record only its length and the headers.
- A 500 with `code: "vault-key-unreadable"` means `LAVEGA_ENCRYPTION_KEY` differs from the one that sealed the key. The data is not lost; fix the env, do not delete the row.
- The vault is per origin and per account. `127.0.0.1:8797` and `localhost:8797` are two different vaults.
