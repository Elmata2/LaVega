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
in a single command:

| Symptom in `probe` | What it is |
| --- | --- |
| `status: 0` | Nothing is listening. Wrong port, or the process died — check `logs`. |
| `401` on every `/api/*` | No session. The mount refuses to guess a tenant rather than serve another user's data. |
| `5xx` | The backend itself failed. |
| `200` with a non-empty `problems` array | Served but degraded. The dashboard deliberately returns an empty-but-valid payload plus problems so reconnect and resync stay reachable. |

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

Targets: `--target local` (default), `--target prod` (`https://www.lavega.dev`), or
`--base <url>` for a preview deploy.

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
node $C sync --target prod --force --wait
node $C unlock --target prod --passphrase <passphrase>

# anything not wrapped
node $C api GET /api/investing/benchmarks --target prod
node $C api PUT /api/investing/benchmarks --target prod --body '{"symbols":["^GSPC"]}'

# the local instance's stdout/stderr
node $C logs --lines 40
```

Credentials are the user's. Ask for them, and take them through the credentials file rather
than a `--password` argument, which would land in shell history and in the run's transcript.
Never invent an account or sign one up.

Write commands that reach a broker, Yahoo Finance or the price store take `--dry-run` and
print what they would send. `prices purge` additionally refuses without `--yes`.

For the visual side — a blank page, a stuck spinner, a chart that does not render — use the
`/browse` skill against `https://www.lavega.dev/investing` (per CLAUDE.md, never the
`mcp__claude-in-chrome__*` tools). The CLI covers everything the frontend asks the backend
for, so reach for the browser when the question is "what does the user see", not "what does
the API return".

## Evidence

Proof goes in `/tmp/lavega-verify-investing/evidence` and survives `cleanup`. `probe --out
<file>` writes a timestamped JSON report there; browser screenshots belong there too.

Standards for the proof, not just the pass:

- Exercise the real path. `sync --force` posts to the same route the **Nu synchroniseren**
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
