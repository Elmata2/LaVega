# Vault gate

Before any view loads, the user creates or unlocks an encrypted vault in the browser. The password never leaves the device; losing it loses the data, and the gate says so.

## Sub-features

- `vault-create` first visit shows `Kluis instellen`; two matching passwords create the vault and open Overzicht.
- `vault-password-rule` a new password under 12 characters or with fewer than 4 distinct characters is refused with a Dutch explanation.
- `vault-unlock` a return visit shows `Kluis ontgrendelen`; the right password opens the app, a wrong one stays on the gate.
- `vault-restore` `Herstel uit back-up` takes a `.lavega` file plus its password and opens the restored vault.
- `vault-migrate` legacy unencrypted data shows `Bestaande data versleutelen`, then `Migratie geslaagd` with a prompt to back up.

## How to get to it (user POV)

- Open `/app` (or any `/app/<view>` URL) in a browser with no vault for that origin.
- Header link `Inloggen` on the landing page.

## Driving it with control-lavega + browser

Preconditions:

- Local instance up; a fresh browser tab on `http://127.0.0.1:8797/app` whose origin has no vault (use a new `--port` for a clean origin).

- **Gate shown.** `navigate` to `/app`. `get_page_text` contains `Kluis instellen` and a `Wachtwoord` label. Screenshot `vault-gate-00-setup.png`.
- **Rule refused.** Type `short1` into `#setup-pass1` and `#setup-pass2`, submit. Page text contains `Gebruik minstens 12 tekens`. Screenshot `vault-gate-01-rule.png`.
- **Create.** Type `verify horse battery staple 2026` into both fields, submit. The gate disappears; the nav rail `aria-label="Weergaven"` is visible and the URL is `/app`. Screenshot `vault-gate-02-created.png`.
- **Persist and unlock.** Reload the tab. Page text contains `Kluis ontgrendelen`. Type the same password into `#unlock-pass`, submit; the app opens again. Screenshot `vault-gate-03-unlocked.png`.
- **Wrong password.** Reload, type `wrong password here`, submit. Still on the gate, an error is shown, no view loaded.
- **Proof.** The four screenshots plus the page-text captures in `/tmp/lavega-verify/evidence/`.

## Gotchas

- The submit button is disabled until the second field matches; `Wachtwoorden komen niet overeen.` means the two inputs differ, not that the rule failed.
- Unlock and restore do not apply the 12-character rule on purpose (old backups); do not file that as a bug.
- The vault is per origin. `127.0.0.1:8797` and `localhost:8797` are two different vaults.
