---
name: verify-investing
description: Drive the LaVega investing dashboard (https://www.lavega.dev/investing) to prove a change works or to debug why it does not - dashboard that will not load, broker sync that never completes, data that does not reach the frontend. Use when verifying any change under apps/investing-server, apps/investing-web, or the investing mount in apps/server, and when reproducing a user report about the investing side.
---

# Verify the LaVega investing app

The investing side is one API served two ways.

- **Standalone** — `apps/investing-server/src/docker.ts` serves `/health`, `/api/*` and the
  built SPA from `apps/investing-web/dist`. Single tenant (`local`), no auth, state in JSON
  files. This is what `control-investing.mjs up` starts, and it is where you verify logic.
- **Mounted** — `apps/server/src/index.ts` forwards `/api/investing/*`, `/api/brokers/*`,
  `/api/prices/*`, `/api/market-data/*` and `/api/config/status` into the same app, with the
  tenant taken from a better-auth session. This is `https://www.lavega.dev/investing`, and it
  is where auth, tenancy and Neon-backed stores are real.

**The API paths are identical on both.** Only the SPA path differs: `/` standalone,
`/investing/` mounted. Most investing bugs are one of four things, and the CLI separates them
in a single command.

The user checks the **preview**, not the local server. Every preview command prints `page`:
`https://<deploy>/investing/` with no `?verify=1`. Put that URL in the reply so the user can
open it. A local `up` does not replace that URL.

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

Teardown, at the end of every run including failed ones: [Cleanup](#cleanup).

## Cleanup

Run this at the end of every run, including failed ones:

```bash
node .claude/skills/verify-investing/control-investing.mjs cleanup
```

`cleanup` kills only the pid this CLI recorded — never by process name, which would take down
a dev server the user started — removes `/tmp/lavega-verify-investing/run`, and keeps
`/tmp/lavega-verify-investing/evidence`. Do not write `auth.preview.json`. A file under `/tmp`
is not shared with the next agent. Preview login loads `LAVEGA_VERIFY_EMAIL` and
`LAVEGA_VERIFY_PASSWORD` with `vercel env pull`.

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
  `local-destructive`, `local-install` or `browser-action`. A `remote-write` on `--target prod`
  also needs `--allow-prod-write`.
- **Tests.** There are two suites:
  - `pnpm run test:verify-investing` tests the CLI itself: parsing, errors, `--dry-run` and
    the prod guard. It runs against a stub HTTP server and fake `browse` and `vercel`
    binaries, so it is fast and offline, and it can exercise writes such as `prices purge
--yes` without deleting real data. Run it after any change to the CLI, and add a test
    for each new command or flag.
  - `pnpm run test:verify-investing:live` runs the CLI against the real newest preview deploy
    with the preview test user. It proves that real data reaches the API and the rendered
    page. It only reads; every write in it runs with `--dry-run`.     It skips only when neither a readable `auth.preview.json` nor
    `LAVEGA_VERIFY_EMAIL` + `LAVEGA_VERIFY_PASSWORD` is already available.
    `login` itself also runs `vercel env pull` for that pair.
    It uses its own state directory, so it does not move your pin or session.
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
the broker sync progress is readable. On `--target preview` it loads
`LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD` from the process or from
`vercel env pull` before it fails `credentialsFile`. It prints `page`, the preview URL.
It exits non-zero on any failed check. Run this first whenever anything looks off.

## Drive

Targets: `--target local` (default), `--target prod` (`https://www.lavega.dev`), or
`--target preview` with `--base <url>` or `LAVEGA_PREVIEW_URL` for a Vercel preview deploy.
`--base` alone implies `--target preview`. See [Preview](#preview).

```bash
C=".claude/skills/verify-investing/control-investing.mjs"

# the diagnosis sweep — every read-only endpoint, one report
node $C probe --target prod --out /tmp/lavega-verify-investing/evidence/prod-probe.json

# the SPA shell plus every asset it references
node $C assets --target prod

# Preview is the check the user opens. `page` in the JSON is the URL.
node $C preview --refresh
node $C login --target preview          # pulls LAVEGA_VERIFY_* from Vercel when unset
node $C whoami --target preview
# Put json.page in the reply: https://<deploy>/investing/

# Prod still uses a readable auth.json, then the same env pair, then flags.
# Do not write auth.preview.json under /tmp. The next agent cannot read it.
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

# market-data consent stores a decision and fetches nothing.
# Allow Yahoo Finance in the SPA then POSTs /api/brokers/sync (not --force)
# and continues POST /api/prices/sync while the price run is paused, running,
# or waiting. The CLI field `next` lists this path. Do not stop after accept.
node $C consent --accept --dry-run
node $C consent --accept
node $C sync --wait
node $C prices sync --wait          # repeats the POST until completed or problem
node $C wait-settle --timeout 300000
node $C dashboard                   # doctor positionsPriced is the priced check

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

Credential resolution, in this order:

1. **Readable file.** `--target preview` reads
   `/tmp/lavega-verify-investing/auth.preview.json` only when this process can open it.
   `--target prod` reads `/tmp/lavega-verify-investing/auth.json` the same way.
   `--credentials-file` replaces that path. An unreadable file is skipped.
2. **Process environment.** `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD`, both set.
3. **Vercel, preview only.** `vercel env pull --environment preview` (then development, then
   production). Those two names are in the Vercel project Config for development, preview,
   and production. The CLI keeps the values in memory, deletes the pull file, and sets
   `credentialsFrom` to `vercel-env`. It does not write `auth.preview.json`.
4. **CLI flags.** `--email` and `--password`, both set. A password on the command line lands
   in shell history and in the transcript.

Do not write `auth.preview.json` under `/tmp` for a later command. Claude and Codex do that
to keep the password out of the repo, and the next sandbox cannot read the file. Do not ask
for a personal password. Do not invent or sign up an account. Do not print the password.
For prod, a readable `auth.json` is the user's; do not invent an account there either.

After `login`, `doctor`, or `preview`, copy `page` into the reply. That is the preview the
user opens.

Write commands that reach a broker, Yahoo Finance or the price store take `--dry-run` and
print what they would send. `prices purge` also refuses without `--yes`.

For the visual side, use `browser`. Examples are a blank page, a stuck spinner, or a chart
that does not render. It drives shared gstack Chromium through `browse`, works for any agent,
and does not need Computer Use. Install, the browse binary, bun, and evidence paths are in
[Helpers](#helpers).

`doctor`, `probe`, and the API commands can stay inside a sandbox. Any `browser *` step
(`install`, `open`, `snapshot`, `click`, `screenshot`, and every other browser subcommand)
must run escalated, unrestricted, and outside the sandbox. On Codex, escalate or disable the
sandbox for that step. Chromium needs process and Mach-port operations that a workspace-write
sandbox refuses. When `browser install`, `browser open`, or a browse spawn fails with
`EPERM`, `PortRendezvous`, `Permission denied`, `SIGTRAP`, or target-closed
(`Target page, context or browser has been closed`) right after launch, that is
`browse-sandboxed`. Treat it as the sandbox until something else is proven. Re-run the same
browser step outside the sandbox. Do not reinstall Chromium for that failure. Run
`browser install` only when the browse binary is missing (`browse-missing`). Run
`bunx playwright@1.58.2 install chromium` only when the headless shell is missing.
`browser install` does that itself when the shell is missing. The same rule is in
`browser --help` and in `browser <cmd> --help --json` as `sandbox` (`escalate: true`,
code `browse-sandboxed`). Text help and JSON help say the same thing.

```bash
node $C browser open --target prod          # import the CLI session, open /investing/?verify=1
node $C browser snapshot --interactive      # accessibility tree with @e refs
node $C browser click --dry-run @e3         # print the action
node $C browser click @e3                   # live click; Allow Yahoo Finance is the consent button
# full Allow click, PNG, and post-click count: features/prices-and-market-data.md Drive
node $C browser wait-settle                 # network idle
node $C browser screenshot                  # PNG under evidence; --png sets the image path
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
`browser-login.mjs` remains as a shim for `browser open --target prod`.

`browser screenshot --out` is the JSON dump, not the PNG. `--png <file>` is the image. The
two paths must differ. Bare `browser screenshot` writes a PNG under the evidence directory.
`browser raw -- screenshot <path>` writes a PNG at `<path>` and does not use `--out`.

Use the browser when the question is "what does the user see", not "what does the API return".

## Helpers

Browse binary, first match wins: `LAVEGA_BROWSE_BIN`, then
`~/.claude/skills/gstack/browse/dist/browse`, then
`~/.codex/skills/gstack/browse/dist/browse`. Any one of those is enough. The Codex path
alone is enough. Do not invent a path.

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C browser install    # already:true if any browse binary exists; otherwise clone and ./setup
node $C browser install --dry-run
```

`browser install` is idempotent and does not ask you to invent a path.

1. An existing browse binary (`LAVEGA_BROWSE_BIN`, the Claude path, or the Codex path)
   returns `already: true` and is left in place. The Codex path alone is enough. Install
   does not create the Claude path in that case.
2. With no binary, the real command installs bun when `bun` is not on `PATH` and
   `~/.bun/bin/bun` is absent. It runs the pinned installer below. That installer checks
   the bun 1.3.10 checksum. It then puts `~/.bun/bin` on `PATH` for the rest of the
   command. `--dry-run` prints this step and does not run it.
3. It clones `https://github.com/garrytan/gstack` into `~/.claude/skills/gstack` when
   `./setup` is missing, then runs `./setup`, which builds `browse/dist/browse`.
4. When the Playwright headless shell is missing, it runs
   `bunx playwright@1.58.2 install chromium`. A shell that is already on disk is left
   alone. `info` reports `browse.chromium` as true or false before you install.

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10"
export PATH="$HOME/.bun/bin:$PATH"
node $C browser install
```

`bun-missing` means that installer failed. `error.message` names the blocker (no `bash`,
`curl` failed, network, or checksum). `error.fix` names the same curl command,
`LAVEGA_BROWSE_BIN`, and the Codex path. `chromium-missing` means the pinned Playwright
command failed. `error.message` has its output. Visual checks stay **verified-unreachable**
until `browser install` prints `installed: true` and a later `browser open` exits 0. Do not
invent a binary path or a Chromium path.

A `browse-sandboxed` failure is not a missing browser and not a missing bun. Escalate and
retry the same command. Do not reinstall Chromium.

Evidence paths. `cleanup` keeps `/tmp/lavega-verify-investing/evidence` and deletes `run/`.

- A remote write that actually runs (`consent --accept`, `sync`, `prices sync`,
  `prices purge`, `unlock`, and `api` with any method but `GET`) saves its JSON there. The
  printed object includes `evidence` with that path. `--dry-run` does not save a file.
- `--out <file>` writes the command JSON to a path you choose. Keep it under `/tmp`.
  On `browser screenshot`, `--out` is still that JSON dump. The PNG is `--png`, or the
  default file under evidence. `--out` must not be the PNG path.
- `probe --out <file>` saves the sweep and each response body, so the payload is still in
  the file after `cleanup` deletes the run directory.
- Browser screenshots land in the same directory unless `--png` names another path under
  `/tmp`. `browser raw -- screenshot <path>` writes a PNG at `<path>` and does not use `--out`.

## Evidence

Proof goes in `/tmp/lavega-verify-investing/evidence` and survives `cleanup`. The path rules
are in [Helpers](#helpers).

Standards for the proof, not just the pass:

- Exercise the real path. `sync --force` posts to the same route the **Start sync**
  button posts to. Do not reach into a store or call a test-only helper to fake the state.
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
- **Account.** Preview has its own test user, never a real person's login. `login
  --target preview` loads `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD` from the
  process, or runs `vercel env pull`. Those two names are in the Vercel project Config for
  development, preview, and production. Do not write `auth.preview.json`. Do not ask for a
  personal password. Do not invent or sign up an account. `credentialsFrom` is `vercel-env`
  when the pull supplied the password. Each origin gets its own cookie jar, so a preview
  login never replaces the prod session. `doctor --target preview` fails `credentialsFile`
  only when the pull fails, the process env pair is unset, no readable file exists, and
  there is no session. A local `doctor` pass does not satisfy this check.
  `pnpm run test:verify-investing:live` skips only when neither a readable
  `auth.preview.json` nor the process env pair is already available. `login` still pulls
  when you run it yourself.
- **Deployment Protection.** Previews answer without protection today. If it is turned on,
  export `VERCEL_AUTOMATION_BYPASS_SECRET`; the CLI sends it as a header and
  `browser open` sets Vercel's bypass cookie. Neither sends it to prod, and output redacts it.
- **URL.** Every deploy has its own URL, and the CLI finds it for you. The user always
  wants that URL in the reply. The JSON field is `page` (`https://<deploy>/investing/`).
  With no `--base` and no `LAVEGA_PREVIEW_URL`, the first `--target preview` command runs
  `vercel ls` in the main checkout (worktrees are not Vercel-linked). It then pins the
  newest READY preview. Later commands use the pin, so the login and the reads after it
  stay on one host. Run `preview --refresh` to move the pin to the newest deploy, or
  `preview --branch <branch>` to pin the newest deploy of your PR branch. After the pin
  moves, log in again. Say the new `page` URL.

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
