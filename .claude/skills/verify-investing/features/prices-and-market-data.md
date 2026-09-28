# Prices, benchmarks and market-data consent

Everything that turns synced holdings into valued ones: the price backfill, the benchmark
overlay, and the consent gate in front of Yahoo Finance.

## Sub-features

- market-data consent (`Allow Yahoo Finance`) — asked before the server makes any Yahoo
  request; the disclosure has a version (`yahoo-finance-v1`) and a re-ask when it changes.
- price sync and backfill, with its own progress (`In progress`, `API pause`).
- price cache purge (`Cache`, confirmed with `Yes, delete everything`, then
  `Price data deleted`; `Failed to clear` on error).
- benchmark selection and search for the chart overlay.
- selected benchmarks are first in the price-sync queue. New selections enter a paused run on its next slice. A page that joins an active server run waits for it, then starts a fresh discovery.
- FX rates and ISIN → ticker mapping used while pricing.

## How to get to it (user POV)

On the overview, before the first market-data call, the page shows `Yahoo Finance consent`
and the button `Allow Yahoo Finance` (`Saving…` while the PUT is in flight). The disclosure
says LaVega sends tickers and search terms to Yahoo Finance. Without consent, cached data
remains visible. The `Cache` and `Operational status` panels hold the purge and the progress
readouts. Benchmarks are chosen from the portfolio chart. Search calls
`/api/investing/benchmarks/search?q=`.

## After Allow Yahoo Finance

Accepting consent does not fetch a price. The button then runs broker sync and continues
price sync. `consent --accept` only stores the decision (evidence JSON includes `next` with
the same commands). Run this path. Do not stop on the PUT.

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C consent                          # accepted false, or disclosureVersion yahoo-finance-v1
node $C consent --accept --dry-run       # PUT /api/market-data/consent, no write
node $C consent --accept                 # stores {accepted:true}; Yahoo is not called
node $C sync --wait                      # POST /api/brokers/sync (not --force), same as the button
node $C prices sync --wait               # POST /api/prices/sync until completed or problem
node $C wait-settle --timeout 300000     # broker and price status leave running/waiting
node $C dashboard                        # priced rows, or doctor positionsPriced
```

`prices sync` without `--wait` is one slice. HTTP 202 or body status `paused`, `running`, or
`waiting` means symbols remain. The printed `next` says to run `prices sync --wait`. That
command posts again, up to 40 rounds, which is the SPA cap. A `paused` run resumes on the
next POST. `sync` without `--force` matches the button. `--force` is a separate refetch.

Opening the SPA with `?verify=1` skips the automatic sync when consent is already accepted.
Clicking `Allow Yahoo Finance` still runs the sync path above. `browser open` adds
`verify=1`, so a visual session does not replace these commands.

## Driving it with control-investing

```bash
node $C consent
node $C consent --accept --dry-run
node $C consent --accept
node $C sync --wait
node $C prices sync --wait
node $C prices status
node $C prices purge --yes                        # deletes every cached bar
node $C api GET /api/investing/benchmarks
node $C api GET '/api/investing/benchmarks/search?q=S%26P'
node $C api GET '/api/market-data/fx?from=USD&to=EUR'
node $C api GET '/api/market-data/identifier?isin=US0378331005'
```

## What proves it works

- Consent stored: `consent` body has `accepted: true` and `disclosureVersion` is
  `yahoo-finance-v1`. The PUT response is that decision. It is not proof that prices moved.
- Prices followed: after `prices sync --wait`, the last body `status` is `completed`
  (`settled: true`). `prices status` shows the same terminal status. Where positions exist,
  `doctor` check `positionsPriced` is ok and a dashboard row is `priced` or `forward-filled`
  with `marketValue` not null. The value cell is not `Value unknown`.
- Gate holds: before accept, `prices sync` and `benchmarks/search?q=` exit non-zero with
  HTTP 428, `consentRequired: true`, and `Yahoo Finance consent required`. FX
  (`/api/market-data/fx`) does not use that gate.
- Purge: `prices purge --yes` returns `deleted: true`. The Cache control then reads
  `Price data deleted` (`Failed to clear` on error).

## Verified-unreachable

- Preview or prod without a session: 401 on `/api/*`. Prerequisite is the credentials file
  or `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD`. See
  [auth-session.md](auth-session.md). Do not invent an account.
- No holdings to price: `prices sync --wait` can complete with nothing to value. Bars for a
  position stay verified-unreachable until [positions.md](positions.md) has rows
  (`positionsRead` > 0). Consent plus an empty book is not a priced portfolio.
- `browser install` did not reach `installed: true`: the consent screen in the SPA is
  verified-unreachable. Use the API path above. The visual prerequisite is in the skill
  Helpers section (`bun-missing`, `chromium-missing`, or `browse-sandboxed`).

## Gotchas

- Without accepted consent the server makes no Yahoo request for prices or benchmark search.
  Positions stay unpriced and the dashboard looks broken while behaving exactly as designed.
  `consent` first. A 428 `fix` names `consent --accept` and `prices sync --wait`.
- `/api/market-data/fx` and `/api/market-data/identifier` answer `503` when every provider
  fails, and `400` on a malformed query. The two are easy to confuse in a log.
- `prices purge` is destructive and per tenant. It refuses without `--yes`, and on
  `--target prod` it throws away the real cache — the next dashboard load is slow and
  entirely dependent on Yahoo being up.
- Missing `MARKET_DATA_API_KEY` degrades to a clear status rather than an error. Yahoo and
  Frankfurter need no key, so a missing key is not by itself a fault.
