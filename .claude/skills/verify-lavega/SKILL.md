---
name: verify-lavega
description: Drive the LaVega personal-finance app (apps/server + apps/web, https://www.lavega.dev/app) to prove a change works or to debug why it does not - the session guard, the public feeds, agent/EB configuration, the SPA shell, and the browser-side vault, import and forecast flows. Use when verifying any change under apps/server (except the investing mount, see verify-investing), apps/web, packages/database or packages/core, and when reproducing a user report about the personal side.
---

# Verify the LaVega personal app

The personal side is one Hono server (`apps/server`) that serves the built SPA
(`apps/web/dist`) and a handful of `/api/*` routes. It is **local-first**: the vault
(accounts, transactions, invoices, rules) lives in the browser's IndexedDB, sealed with the
user's password. The server holds only what cannot live in a browser: the session guard,
public feeds (savings rates, ECB FX), the Enable Banking flow, the opt-in AI agents (which
proxy to Mistral), and an opaque encrypted vault backup in Neon.

So there are two kinds of proof here, and they use different tools:

| Question                                                             | Tool                                     |
| -------------------------------------------------------------------- | ---------------------------------------- |
| Does the server answer, refuse, or serve what it should?             | `control-lavega.mjs` (this skill's CLI)  |
| What does the user see and can they do it? (vault, import, forecast) | a real browser: `claude-in-chrome` tools |

Two targets, one API surface:

- **local** — `control-lavega.mjs up` starts `@lavega/server` on port 8797 with the guard
  **open** (`LAVEGA_ALLOW_UNAUTHENTICATED=1`), **no `.env`**, no `DATABASE_URL`, investing
  mount off. Nothing it does can reach Neon or spend an API key. This is where you verify
  logic and the UI.
- **prod** — `https://www.lavega.dev`. Guard closed, Neon-backed, agents need
  `MISTRAL_API_KEY` on Vercel, which is set as of 13 September 2026. Read production; never write to it from here.

What differs between the two, and is not a bug:

| Route                      | local (no DB)                   | prod                    |
| -------------------------- | ------------------------------- | ----------------------- |
| `/api/vault/backup`        | route not registered → SPA HTML | 401 without session     |
| `DELETE /api/account/data` | 404 (needs Neon)                | 401 without session     |
| `POST /api/agent/*`        | 503 "niet geconfigureerd"       | 401; 503 once signed in |
| `/api/investing/*`         | off (`INVESTING_MOUNT=0`)       | 401 without session     |

## Launch

```bash
node .claude/skills/verify-lavega/control-lavega.mjs up            # port 8797
node .claude/skills/verify-lavega/control-lavega.mjs up --port 8798 # a second instance
node .claude/skills/verify-lavega/control-lavega.mjs up --with-ai  # copies MISTRAL_API_KEY from apps/server/.env
```

Ready when `/health` answers `{"ok":true}`; `up` waits for it and prints pid, URL and log
path. Needs `apps/web/dist/index.html`; if it is missing or older than the change you are
verifying:

```bash
pnpm --filter @lavega/web build
```

Teardown, at the end of every run including failed ones:

```bash
node .claude/skills/verify-lavega/control-lavega.mjs cleanup
```

`cleanup` kills only the pid this CLI recorded (never by name, which would take down a
`pnpm dev` the user started), removes `/tmp/lavega-verify/run`, and keeps
`/tmp/lavega-verify/evidence`.

## Doctor

```bash
node .claude/skills/verify-lavega/control-lavega.mjs doctor
node .claude/skills/verify-lavega/control-lavega.mjs doctor --target prod
```

Read-only. Health, SPA shell at `/app`, agent and EB status readable (and whether agents are
dark), guard posture (open locally, 401 on prod), CSP header present. Exits non-zero on any
failed check. Run it first whenever anything looks off.

## Drive

Targets: `--target local` (default), `--target prod`, or `--base <url>` for a preview deploy.

```bash
C=".claude/skills/verify-lavega/control-lavega.mjs"
E=/tmp/lavega-verify/evidence

node $C guard --out $E/guard-local.json                 # every guarded route ≠ 401, public 200
node $C guard --target prod --out $E/guard-prod.json    # every guarded route 401, public 200
node $C probe --target prod --out $E/prod-probe.json    # one sweep of every read-only endpoint
node $C assets                                          # SPA shell + every asset it references
node $C api GET /api/rates                              # anything not wrapped
node $C api POST /api/agent/categorize --body '{"items":[]}'   # writes refuse --target prod
node $C logs --lines 40
```

### Browser side (vault, import, transactions, forecast, agents UI)

Open `http://127.0.0.1:8797/app` in a real browser with the `claude-in-chrome` tools:
`tabs_create_mcp` → `navigate` → `find` / `read_page` to locate handles → `computer` to
click and type → `get_page_text` / screenshot to prove state. Load them in one
`ToolSearch` call (`select:mcp__claude-in-chrome__tabs_context_mcp,...navigate,...find,...computer,...read_page,...get_page_text,...tabs_create_mcp`).

Stable handles (from source, not guessed):

- Vault gate: password inputs `#unlock-pass`, `#setup-pass1`, `#setup-pass2`,
  `#setup-restore-pass`; restore file input `#setup-restore-file` (accepts `.lavega`);
  the labels follow the `lavega_locale` cookie, Dutch or English (`Wachtwoord` /
  `Password`, `Herhaal wachtwoord` / `Repeat password`). With no cookie and a
  non-Dutch browser the app renders ENGLISH, so set the cookie before asserting
  on Dutch text. A new vault
  password needs ≥12 characters and ≥4 distinct ones (`apps/web/src/vaultPassword.ts`);
  unlock and restore do not enforce that.
- Import: `section#import[aria-label="Importeren"]`, file input
  `aria-label="Kies een bankbestand om te importeren"`.
- Views are URL-addressable: `/app` (Overzicht), `/app/transactions`, `/app/accounts`,
  `/app/forecast`, `/app/optimalisatie`, `/app/valuta`, `/app/belasting`, `/app/facturen`,
  `/app/punten`, `/app/koppelingen`, `/app/backup`, `/app/profiel`
  (`apps/web/src/appRoutes.ts`). Each still sits behind the vault gate.

Two browser instances against two `up --port` servers are fully isolated: the vault is per
origin (port), so a second port is a second empty vault. Never drive the user's own
production vault: their password is theirs, and a verification run has no business inside it.

## Evidence

Proof goes in `/tmp/lavega-verify/evidence` and survives `cleanup`. `guard --out` and
`probe --out` write timestamped JSON there; browser screenshots and page-text captures belong
there too, named `<feature>-<step>.png|txt`.

Standards for the proof, not just the pass:

- Exercise the real path. Create the vault through the gate, import through the file input,
  post to the same route the button posts to. Do not seed IndexedDB or call a helper.
- Capture the action and the resulting state: the screen before, the click, the screen
  after, and the API response where one exists.
- Verify the side effect alongside what is visible: after an import, the account appears in
  Rekeningen **and** the transaction count moves; after a vault backup, the `.lavega`
  download exists and restores.
- Prod agents answering 503 with `configured:false` is the documented dark state, not a
  pass for an agent feature. Say so.
- Mock nothing the production boundary does not already isolate. Rates, FX and Mistral
  are real calls from the local server too (`--with-ai` for the last one).

## Isolate

`up --port <n>` per instance; each has its own log and pid file under
`/tmp/lavega-verify/run` (set `VERIFY_LAVEGA_DIR` to separate whole runs). What cannot be
doubled is production: one deployment, one Neon, one owner account. Write commands refuse
`--target prod`; the browser must never be pointed at `www.lavega.dev/app` with the owner's
password during a verification run.

## Feature map

`features/README.md` lists every user-facing feature, how a user reaches it, how to drive it
here, and what proves it works. Read it before driving a feature you have not driven before,
and update it when the app changes (`/maintain-verification-skill`).
