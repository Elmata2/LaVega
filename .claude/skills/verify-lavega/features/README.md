# LaVega personal-app verification map

This directory is the maintained source for verifying the user-facing behaviour of the LaVega personal app (`/app`). Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .claude/skills/verify-lavega/control-lavega.mjs up` (port 8797, guard open, no `.env`).
- `control-lavega doctor` reports `healthy`.
- The browser (claude-in-chrome) has a fresh tab on `http://127.0.0.1:8797/app` and no vault yet for that origin. A second instance on `--port 8798` is a second, empty vault.
- Never drive an instance this run did not start, and never the owner's production vault.

## Driving conventions

- Server-side facts go through `control-lavega.mjs` (`guard`, `probe`, `api`, `assets`).
- UI actions go through the `claude-in-chrome` tools; locate elements by id, `aria-label` or visible Dutch label, never by coordinates alone.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Restore state after a mutation (delete the test vault, `cleanup`). Never remove evidence.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof is a screenshot plus `get_page_text` capture under `/tmp/lavega-verify/evidence/<feature>-<step>.*`.
- API proof is the `--out` JSON from `guard`/`probe`, or the `api` command's status and body.
- Mutation proof includes a second, read-only view of the stored value (reload the page, reopen the view).
- Report an unreachable path with the attempted command and the unmet precondition. A skipped entry point is not verified through a different path.

## Feature entry contract

Each feature file has an H1, one paragraph of user-visible behaviour, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-lavega + browser`, `Gotchas`.

## Features

- [API session guard](./auth-guard.md) — every non-public `/api/*` route refuses without a session; public feeds answer. Proven 2026-09-07 on local and prod.
- [Vault gate](./vault-gate.md) — create, unlock and restore the encrypted browser vault; the 12-character rule.
- [Bank file import](./import-bank-file.md) — CSV/MT940 import from the home card; entity assignment; problems surfaced, never a crash.
- [Cash-flow forecast](./forecast.md) — 13-week forecast, shortfall banner, per-week drivers.
- [AI agents](./agents.md) — categorize, chat, invoice extraction: opt-in, confirm-first, dark without a key.

Not yet mapped (add as they are driven): Rekeningen, Transacties, Regels, Optimalisatie, Valuta, Belasting, Facturen (manual/CSV/UBL), Punten, Koppelingen (Enable Banking), Back-up (`.lavega` download + server backup), Profiel (erase).
