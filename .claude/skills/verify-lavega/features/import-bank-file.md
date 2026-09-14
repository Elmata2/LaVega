# Bank file import

The home card `Importeren` takes a bank export (CSV or MT940, sniffed from the contents, not the extension), assigns it to an entity, parses it into accounts and transactions, and reports problems as text instead of failing.

## Sub-features

- `import-choose` the file input opens the OS picker with no extension filter.
- `import-parse` a valid CSV/MT940 adds an account under Rekeningen and its transactions.
- `import-entity` the entity field decides which BV the account belongs to.
- `import-problems` an unrecognised file shows a `role="alert"` with the problem, the app keeps running.
- `import-dedupe` importing the same file twice does not double the transactions.

## How to get to it (user POV)

- `/app` (Overzicht) → card `Importeren` (section `#import`, `aria-label="Importeren"`).

## Driving it with control-lavega + browser

Preconditions:

- Vault created and unlocked (see vault-gate.md).
- A sample export on disk. The repo ships none; use a real anonymised export from the user or a synthetic MT940 written to `/tmp/lavega-verify/sample.sta`.

- **Locate.** `find` the input with `aria-label="Kies een bankbestand om te importeren"`.
- **Upload.** Use `file_upload` on that input with the sample. The busy state clears and the card reports what was imported.
- **Side effect.** `navigate` to `/app/accounts`; the new account is listed with a balance. `navigate` to `/app/transactions`; the count matches the file. Screenshot `import-02-accounts.png`.
- **Bad file.** Upload a `.txt` of prose. A `role="alert"` paragraph appears; nothing else changes.
- **Dedupe.** Upload the good file again; the transaction count does not change.
- **Proof.** Screenshots before/after plus `get_page_text` of Rekeningen and Transacties.

## Gotchas

- The input resets its value after every pick, so re-uploading the same path is a real second import, which is what the dedupe check needs.
- Format is detected by content: an `.STA` in uppercase is fine, a CSV renamed `.mt940` is parsed as CSV.
- Everything here stays in IndexedDB; nothing is posted to the server, so `probe` shows no trace of an import.
