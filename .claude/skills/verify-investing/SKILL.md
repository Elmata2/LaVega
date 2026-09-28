---
name: verify-investing
description: Drive the LaVega investing dashboard (https://www.lavega.dev/investing) to prove a change works or to debug why it does not - dashboard that will not load, broker sync that never completes, data that does not reach the frontend. Use when verifying any change under apps/investing-server, apps/investing-web, or the investing mount in apps/server, and when reproducing a user report about the investing side.
---

# Verify the LaVega investing app

The investing side is one API served two ways.

- **Standalone** — `apps/investing-server/src/docker.ts` serves `/health`, `/api/*` and the
  built SPA from `apps/investing-web/dist`. Single tenant (`local`), state in JSON files.
  Auth is unconfigured: `/api/auth/*` answers `503` with `Authentication is not configured`,
  and the SPA gate opens. This is what `control-investing.mjs up` starts, and it is where
  you verify logic.
- **Mounted** — `apps/server/src/index.ts` forwards `/api/investing/*`, `/api/brokers/*`,
  `/api/prices/*`, `/api/market-data/*` and `/api/config/status` into the same app, with the
  tenant taken from a better-auth session. This is `https://www.lavega.dev/investing`, and it
  is where auth, tenancy and Neon-backed stores are real.

**The API paths are identical on both.** Only the SPA path differs: `/` standalone,
`/investing/` mounted. Most investing bugs are one of four things, and the CLI separates them
in a single command:

| Symptom in `probe`                                             | What it is                                                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status: 0`                                                    | Nothing is listening. Wrong port, or the process died — check `logs`.                                                                                                                  |
| `401` on every `/api/*`                                        | No session. The mount refuses to guess a tenant rather than serve another user's data.                                                                                                 |
| `5xx`                                                          | The backend itself failed.                                                                                                                                                             |
| `200` with a non-empty `problems` array                        | Served but degraded. The dashboard deliberately returns an empty-but-valid payload plus problems so reconnect and resync stay reachable.                                               |
| `200`, no problems, positions all `unpriced` or `missing-cost` | Served and empty of meaning. Holdings arrived, prices or trades did not join them, and nothing in the payload says so. `doctor` names this as `positionsPriced` and `positionsCosted`. |

## Launch

```bash
node .claude/skills/verify-investing/control-investing.mjs up
```

Starts the standalone server on port 8799 with its own data directory under
`/tmp/lavega-verify-investing/run/data` and no `DATABASE_URL`, so a verification run never
touches the tenant rows behind the deployed dashboard. It waits for `/health` to answer
`{"service":"investing-server"}` and prints the pid, port and log path. Child stdout/stderr
go to a log file, not a pipe: `up` exits after `/health`, and a pipe would EPIPE-kill the
child on the first Trading 212 diagnostic log.

Needs `apps/investing-web/dist` to exist. If it does not:

```bash
pnpm --filter @lavega/investing-web build
```

Teardown, at the end of every run including failed ones:

```bash
node .claude/skills/verify-investing/control-investing.mjs cleanup
```

`cleanup` kills only the pid this CLI recorded — never by process name, which would take down
a dev server the user started — removes the run directory, and keeps
`/tmp/lavega-verify-investing/evidence`.

## CLI contract

The CLI is built for an agent to drive. Learn it from the CLI, not from this page:

```bash
node .claude/skills/verify-investing/control-investing.mjs help          # overview by group
node .claude/skills/verify-investing/control-investing.mjs sync --help   # one command: flags, effect, examples
node .claude/skills/verify-investing/control-investing.mjs browser --help
node .claude/skills/verify-investing/control-investing.mjs help --json   # the whole surface as JSON
```

- **Output.** Every command prints JSON on stdout. `watch` prints one JSON object per line.
- **Errors.** Errors print on stderr as `{"ok":false,"command":…,"error":{"code","message","fix"}}`.
  `fix` names the command or change to make next. Unknown commands and flags fail with a
  did-you-mean. Numbers, enums and required arguments are checked before any request.
- **Exit codes.** `0` ok, `1` a check or request failed, `2` usage error or refused.
- **Side effects.** Every command with a side effect takes `--dry-run`, which prints the
  request or action and changes nothing. `help --json` lists each effect as `remote-write`,
  `local-destructive` or `browser-action`. A `remote-write` on `--target prod` also needs
  `--allow-prod-write`.
- **Tests.** There are two suites:
  - `pnpm run test:verify-investing` tests the CLI itself: parsing, errors, `--dry-run` and
    the prod guard. It runs against a stub HTTP server and fake `browse` and `vercel`
    binaries, so it is fast and offline, and it can exercise writes such as `prices purge
    --yes` without deleting real data. Run it after any change to the CLI, and add a test
    for each new command or flag.
  - `pnpm run test:verify-investing:live` runs the CLI against the real newest preview deploy
    with the preview test user. It proves that real data reaches the API and the rendered
    page. It only reads; every write in it runs with `--dry-run`. It skips when
    `auth.preview.json` is missing, and it uses its own state directory, so it does not move
    your pin or session.
- **Files.** `browse` only reads and writes under `/tmp` or its working directory, so keep
  `VERIFY_INVESTING_DIR` and `--out` paths under `/tmp`.

## Doctor

```bash
node .claude/skills/verify-investing/control-investing.mjs doctor              # local
node .claude/skills/verify-investing/control-investing.mjs doctor --target prod
```

Read-only. Answers whether an instance is worth driving: `/health` responds and identifies
itself as `investing-server`, a session exists or auth is unconfigured, the dashboard returns
without a problems list, key status is known, the vault is `empty`/`locked`/`unlocked`, and
the broker sync progress is readable. Exits non-zero on any failed check. Run this first
whenever anything looks off.

## Drive

Targets: `--target local` (default for the CLI), `--target prod` (`https://www.lavega.dev`), or
`--target preview` with `--base <url>` or `LAVEGA_PREVIEW_URL` for a Vercel preview deploy.
`--base` alone implies `--target preview`. See [Preview](#preview).

**Which target to use.** Proving the investing app with the dev portfolio means
`--target preview`, signed in as the preview test user. The empty local server has no
session and no broker, so it cannot show those positions. Use `up` only for a change that
is not deployed yet, or for a screen that must work with an empty vault.

Sign in before any preview read:

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C doctor --target preview
node $C login --target preview
node $C whoami --target preview
node $C dashboard --target preview
```

`login` reads `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD` from the agent
environment, or `/tmp/lavega-verify-investing/auth.preview.json`. A password stored as a
Vercel project env var is not visible here. If both are missing, stop and say so. Do not
invent an account, and do not fall back to the empty local server and call that a pass for
the portfolio.

```bash
C=".claude/skills/verify-investing/control-investing.mjs"

# the diagnosis sweep — every read-only endpoint, one report
node $C probe --target prod --out /tmp/lavega-verify-investing/evidence/prod-probe.json

# the SPA shell plus every asset it references
node $C assets --target prod

# production needs a session before any /api call works.
# login reads /tmp/lavega-verify-investing/auth.json, which the user writes:
#   umask 077 && printf '{"email":"%s","password":"%s"}' "<email>" "<password>" \
#     > /tmp/lavega-verify-investing/auth.json
node $C login --target prod
node $C whoami --target prod

# read the dashboard the way the frontend does
node $C dashboard --target prod
node $C dashboard --target prod --symbol AAPL
node $C summary --target prod

# broker + price sync and the vault behind them
node $C sync-status --target prod
node $C sync --target preview --force --wait
node $C unlock --target preview --passphrase <passphrase>

# anything not wrapped
node $C api GET /api/investing/benchmarks --target prod
node $C api PUT /api/investing/benchmarks --target preview --body '{"symbols":["^GSPC"]}'

# wait until broker and price sync stop working
node $C wait-settle --target preview --timeout 300000

# time the reads the dashboard page makes
node $C perf --target prod --runs 10

# the local instance: where things are, its log, restart, keep it alive while editing
node $C info
node $C logs --lines 40
node $C restart
node $C watch --restart          # run in the background; one JSON line per up/down
```

Credentials are the user's. Ask for them, and take them through the credentials file rather
than a `--password` argument, which would land in shell history and in the run's transcript.
Never invent an account or sign one up.

Write commands that reach a broker, Yahoo Finance or the price store take `--dry-run` and
print what they would send. `prices purge` also refuses without `--yes`.

For the visual side, use `browser`. Examples are a blank page, a stuck spinner, or a chart
that does not render. It drives shared gstack Chromium through `browse`, works for any agent,
and does not need Computer Use.

```bash
node $C browser open --target prod          # import the CLI session, open /investing/?verify=1
node $C browser snapshot --interactive      # accessibility tree with @e refs
node $C browser click @e3                   # --dry-run prints the action instead
node $C browser wait-settle                 # network idle
node $C browser screenshot                  # PNG into the evidence directory
node $C browser console --errors
node $C browser network
node $C browser perf
node $C browser eval "document.title"
node $C browser raw -- viewport 390x844     # any browse command not wrapped
node $C browser stop
```

`browser open` imports the CLI session for the target's host and never prints a cookie
value. On local it needs no session. `?verify=1` puts the app in verification mode, so the
app-open effect does not start a broker or price sync. Normal users keep the automatic sync.
`browser-login.mjs` remains as a shim for `browser open --target prod`. If `browse` reports
missing Chromium, install the pinned build once with
`bunx playwright@1.58.2 install chromium`.

Use the browser when the question is "what does the user see", not "what does the API return".

## Evidence

Proof goes in `/tmp/lavega-verify-investing/evidence` and survives `cleanup`. `probe --out
<file>` writes a timestamped JSON report there; browser screenshots belong there too.

Standards for the proof, not just the pass:

- Exercise the real path. `sync --force` posts to the same route the **Start sync** button
  posts to. Do not reach into a store or call a test-only helper to fake the state.
- Capture the action and the resulting state, not only the end screen. For a sync: the status
  before, the POST response, the settled progress, and the dashboard afterwards.
- Verify the side effect alongside what is visible. A sync that "worked" should move
  `positionsRead`/`ordersRead` off zero and land rows in the store — a completed status with
  an unchanged dashboard is a failure, not a pass.
- The empty-but-valid dashboard is a real state, not a passing one. `dashboard` reports
  `shape: "degraded (empty + problems)"` for it; treat that as a failure to explain.
- Mock nothing the production boundary does not already isolate. Yahoo Finance and the broker
  APIs are real calls from the standalone server too.

## Preview

A preview deploy is where logic meets real auth and a real Neon database without touching a
real tenant. Prefer it over prod for anything that writes.

- **Database.** Previews use the Neon branch `preview`, not production. Before a run,
  confirm it has every migration and the same `LAVEGA_ENCRYPTION_KEY` as Production.
  `doctor` fails `positionsPresent` when a connected broker shows zero positions, which is
  the symptom of either gap.
- **Account.** Preview has its own test user, never a real person's login. That user is the
  one verification signs in as. Credentials are `LAVEGA_VERIFY_EMAIL` and
  `LAVEGA_VERIFY_PASSWORD` in the agent environment, or
  `/tmp/lavega-verify-investing/auth.preview.json`. They are separate from prod's
  `auth.json`. Setting them on the Vercel project does not sign an agent in. Each origin
  gets its own cookie jar, so a preview login never replaces the prod session.
- **Deployment Protection.** Previews answer without protection today. If it is turned on,
  export `VERCEL_AUTOMATION_BYPASS_SECRET`; the CLI sends it as a header and
  `browser open` sets Vercel's bypass cookie. Neither sends it to prod, and output redacts it.
- **URL.** Every deploy has its own URL, and the CLI finds it for you. With no `--base` and
  no `LAVEGA_PREVIEW_URL`, the first `--target preview` command runs `vercel ls` in the main
  checkout (worktrees are not Vercel-linked). It then pins the newest READY preview. Later
  commands use the pin, so the login and the reads after it stay on one host. Run
  `preview --refresh` to move the pin to the newest deploy, or `preview --branch <branch>` to
  pin the newest deploy of your PR branch. After the pin moves, log in again.

```bash
node $C preview --branch my-feature      # optional: verify this branch's deploy
node $C doctor --target preview
node $C login --target preview
node $C sync --target preview --force --wait
node $C browser open --target preview
```

Write commands on `--target prod` (`sync`, `prices sync`, `prices purge`, `consent --accept`,
`unlock`, and `api` with any method but `GET`) refuse to run without `--allow-prod-write`.
Add it only when the user says so for that run.

## Isolate

Two instances can run side by side: `up --port <n> --data <dir>` gives each its own port and
its own JSON stores. What cannot be doubled is production — there is one deployed instance
and one set of tenant rows behind it. Never drive `--target prod` with write commands
(`sync`, `prices purge`, `consent --accept`, `unlock`) unless the user asked for it on that
target; verify logic locally and read production.

## Feature map

`features/README.md` lists every user-facing feature, how a user reaches it, how to drive it
here, and what proves it works. Read it before driving a feature you have not driven before,
and update it when the app changes.
