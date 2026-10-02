# Prices, benchmarks and market-data consent

Everything that turns synced holdings into valued ones: the price backfill, the benchmark
overlay, and the consent gate in front of Yahoo Finance.

## Reach

Overview, before the first Yahoo fetch. While `GET /api/market-data/consent` is in flight
the status is `Checking market data consent…`. When that GET returns `accepted: false`, the
section heading is `Yahoo Finance consent`. The button label is `Allow Yahoo Finance`
(`Saving…` while the PUT is in flight). The disclosure says LaVega sends tickers and search
terms to Yahoo Finance. Without consent, cached data remains visible.

After accept, the button unmounts from Overview. Overview does not show the status chips.

The chips are on Profile, `/profile#status`, section `aria-label="Status"`, title `Status`:

- `Brokers`. A running sync reads `In progress`. A waiting sync's detail falls back to
  `Waiting for API capacity`.
- `Price history`. Idle value is `Ready`. A running or paused run shows
  `<completed> of <total> loaded`. Other values, verbatim: `Waiting`, `Up to date`,
  `Problem`, `Incomplete`, `Unknown`. Completed is `Up to date`. The price chip does not
  use `In progress`.
- `Vault`: `Not set up`, `Locked`, `Open`, or `Unknown`.
- `Cache`: `Version <dataVersion>` or `Loading…`, and the button `Clear price data`.
  Confirm is `Yes, delete everything`, then `Price data deleted`, or `Failed to clear`.
- `Connection` renders only when the connection is not online (`Reconnecting` or `Offline`).

When the connection is not `online`, broker or price status is `problem`, a price problem
is set, or the vault is `locked`, Overview shows `Status needs attention` and
`Review it in Profile`. That alert is not the chip panel.

Benchmark search calls `/api/investing/benchmarks/search?q=`.

## Drive

`Allow Yahoo Finance` PUTs `/api/market-data/consent` with `{accepted:true}`, then calls
`startBrokerSync`, which POSTs `/api/brokers/sync` (not `?force=true`). A non-OK broker
response throws only when the body parses as JSON. The catch then sets the visible string
`Broker sync failed.` and does not call price sync. A non-OK response with no JSON body
(a proxy cutting the request off) does not throw, and `startBrokerSync` still calls
`continuePriceSync`. An empty local vault is the JSON failure: broker `status` becomes
`problem`, `message` is `credential vault is locked`, `updatedAt` is set, `positionsRead`
stays `0`. The price chip stays `Ready` until a later `prices sync --wait`. After that
failure, dry-run then one `prices sync --wait`. That POST is the price continuation the
button would have reached. The PUT alone fetches nothing.

`?verify=1` skips the automatic sync only when consent is already accepted. The click still
runs the broker POST. `browser open` adds `?verify=1`.

Save pre-state, dry-run, then one live accept. Do not accept twice.

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
E="/tmp/lavega-verify-investing/evidence"
node $C consent --out "$E/pre-consent.json"                 # body.accepted false
node $C sync-status --out "$E/pre-sync-status.json"         # broker + prices + credentials
node $C dashboard --out "$E/pre-dashboard.json"
node $C consent --accept --dry-run --out "$E/consent-dry-run.json"
node $C sync --dry-run --out "$E/sync-dry-run.json"         # POST /api/brokers/sync
node $C browser install
node $C browser open
node $C browser wait-settle
node $C browser snapshot --interactive --out "$E/pre-allow-snapshot.json"
# click the @e ref whose name is Allow Yahoo Finance. Dry-run, then the live click.
node $C browser click --dry-run @eN
node $C browser click @eN
node $C browser wait-settle
node $C browser snapshot --interactive --out "$E/post-allow-snapshot.json"
node $C browser screenshot --png "$E/after-allow.png"   # $E is under /tmp; the CLI creates it
node $C consent --out "$E/post-consent.json"
node $C sync-status --out "$E/post-sync-status.json"
# When the broker POST failed, the button did not start price sync. Dry-run, then one live wait.
node $C prices sync --dry-run --out "$E/prices-dry-run.json"
node $C prices sync --wait --out "$E/post-prices-sync.json"
node $C browser goto '/profile#status'   # local. Mounted: /investing/profile#status
node $C browser wait-settle
node $C browser text --out "$E/post-price-text.json"
node $C dashboard --out "$E/post-dashboard.json"
```

API-only accept, when the button is not on screen, is the same POST the button's
`acceptYahoo` starts. Still dry-run first. One live PUT, then the live broker POST:

```bash
node $C consent --accept --dry-run
node $C consent --accept          # evidence JSON includes next
node $C sync --dry-run
node $C sync --wait               # POST /api/brokers/sync, then poll status
node $C prices sync --wait        # POST /api/prices/sync until completed or problem
```

`prices sync` without `--wait` is one slice. HTTP 202 or body `status` `paused`, `running`,
or `waiting` means symbols remain. `--wait` posts again, up to 40 rounds.

## Observable success

Both of these. A loaded page is not success.

1. **Consent.** `post-consent.json` `body.accepted` is `true` and `body.disclosureVersion` is
   `yahoo-finance-v1`. Pre-state `body.accepted` was `false`.
2. **Price signal.** `post-allow-snapshot.json` contains the string `Allow Yahoo Finance`
   zero times. `post-prices-sync.json` `body.status` is `completed` and `body.message` is a
   string. Empty book message, verbatim: `No price symbols to synchronize`. With symbols,
   `body.completed` equals `body.total` and `body.remainingSymbols` is `[]`. After the reload
   in Drive, browser text on Profile `#status` contains `Price history` and `Up to date`.
   Those strings are not on `/?verify=1`.
   An empty vault's click also shows `Broker sync failed.` and broker `message`
   `credential vault is locked`. That broker post-state is success for "the button POSTed
   sync". It is not the price signal. The price signal is the `prices sync --wait` body.

Before accept, `prices sync` and `GET /api/investing/benchmarks/search?q=AAPL` exit non-zero
with HTTP 428, `consentRequired: true`, and problem `Yahoo Finance consent required`.

Sync proof is the trio in `$E`: `pre-sync-status.json`, the live `sync` or the click's POST
`/api/brokers/sync`, then `post-sync-status.json`. Assert `broker.body.status`,
`broker.body.positionsRead`, and `broker.body.history.trading212.lastSyncedAt` (and `ibkr`).
There is no separate job id. `positionsRead` and `lastSyncedAt` are the refresh fields.
`dashboard` `positions` is the positions refresh.

## Verified-unreachable

- Preview or prod with no session: 401 on `/api/*`. Prerequisite: `login --target preview`
  exit 0 (`credentialsFrom` `vercel-env` or `environment`). See
  [auth-session.md](auth-session.md). Report `page`.
- A priced holding (`priceStatus` `priced` and `marketValue` not null): prerequisite is
  `positionsRead` > 0. Consent plus an empty book can still pass observable success 1 and 2
  via `No price symbols to synchronize` and Profile `Price history` / `Up to date`. It cannot prove
  a quote for a symbol.
- `browser install` not `installed: true`: the Allow button is verified-unreachable.
  Prerequisite: `browser install` exit 0, or `browse-sandboxed` escalated and retried.
  Do not invent a Chromium path.

## Gotchas

- A closed position whose Yahoo candidates all confirm not-found is not a price problem.
  Sync can finish `completed` with Price history `Up to date`, and later runs skip that
  symbol. A held position with the same not-found still reports a problem, and the Price
  history chip reads `Problem`. A held symbol that stays quiet after its last bar adds
  `no prices since <date>` to the price-sync `problems` list, which Overview shows under
  `Reading problems`. `delistedSince` is not a field in the API JSON.
- Without accepted consent the server makes no Yahoo request for prices or benchmark search.
  Positions stay unpriced. A 428 `fix` names `consent --accept` and `prices sync --wait`.
- `/api/market-data/fx` and `/api/market-data/identifier` answer `503` when every provider
  fails, and `400` on a malformed query. FX does not use the Yahoo consent gate.
- `prices purge` is destructive and per tenant. It refuses without `--yes`, and on
  `--target prod` it throws away the real cache.
- Missing `MARKET_DATA_API_KEY` degrades to a clear status rather than an error. Yahoo and
  Frankfurter need no key, so a missing key is not by itself a fault.
