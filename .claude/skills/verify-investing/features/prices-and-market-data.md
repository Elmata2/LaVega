# Prices, benchmarks and market-data consent

Everything that turns synced holdings into valued ones: the price backfill, the benchmark
overlay, and the consent gate in front of Yahoo Finance.

## Sub-features

- market-data consent — asked on the overview before the server makes any Yahoo request.
  Panel title `Yahoo Finance consent`, button `Allow Yahoo Finance`. The disclosure version
  is `yahoo-finance-v1`. A changed version asks again.
- price sync and backfill. The overview chip is `Price history`, with values such as
  `Ready`, `Up to date`, `Waiting`, `<completed> of <total> loaded` and `Incomplete`.
- price cache purge. The `Cache` chip shows `Version <dataVersion>` and `Clear price data`.
  Confirm with `Yes, delete everything` (or `Cancel`). Success status: `Price data deleted`.
- benchmark selection and search for the chart overlay (`+ Compare` on the portfolio chart).
- selected benchmarks are first in the price-sync queue. New selections enter a paused run
  on its next slice. A page that joins an active server run waits for it, then starts a
  fresh discovery.
- FX rates and ISIN → ticker mapping used while pricing.
- server key status from `GET /api/config/status`. The SPA does not render it. Each key is
  `{ configured, envVar, missingMessage }`. A missing key says
  `Required key <ENV> is missing.` The two env vars are `ANTHROPIC_API_KEY` (`llm`) and
  `MARKET_DATA_API_KEY` (`marketData`). Portfolio-agent keys are different; see
  [portfolio-agents.md](portfolio-agents.md).

## How to get to it (user POV)

Consent is requested on the overview before the first market-data call. The `Cache` chip
and the `Status` panel on the overview hold the purge and the progress readout. Benchmarks
are chosen from the portfolio chart.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C consent                                   # current decision + disclosure version
node $C consent --accept                          # write; --dry-run prints instead
node $C prices status
node $C prices sync --force --dry-run
node $C prices purge --yes                        # deletes every cached bar; local only unless asked
node $C api GET /api/investing/benchmarks
node $C api GET '/api/investing/benchmarks/search?q=SPY'
node $C api GET /api/config/status
node $C api GET '/api/market-data/fx?from=USD&to=EUR'
node $C api GET '/api/market-data/identifier?isin=US0378331005'
```

Search takes `q`, not `query`. Without consent both spellings answer `428` with
`Yahoo Finance consent required`. After consent, `q=SPY` returns SPY rows and
`fallback: false`. `query=SPY` is ignored, so the server treats the search as empty and
returns the fallback index list (`^STOXX50E`, `^AEX`, `^GDAXI`, `^FCHI`, `fallback: true`).

## Gotchas

- Without accepted consent the server makes no Yahoo request at all. Positions stay unpriced
  and the dashboard looks broken while behaving exactly as designed — check `consent` first.
  `?verify=1` does not skip this panel.
- `/api/market-data/fx` and `/api/market-data/identifier` answer `503` when every provider
  fails, and `400` on a malformed query (`from and to currencies are required`,
  `isin is required`). The two are easy to confuse in a log. FX can succeed with no Yahoo
  consent; Frankfurter does not use that gate. Identifier resolution can succeed through
  OpenFIGI with no Yahoo consent.
- `prices purge` is destructive and per tenant. It refuses without `--yes`, and on
  `--target prod` it throws away the real cache — the next dashboard load is slow and
  entirely dependent on Yahoo being up.
- Missing `MARKET_DATA_API_KEY` is `configured: false` on `/api/config/status`, not an
  error and not a label in the SPA. Yahoo and Frankfurter need no key, so a missing market
  key is not by itself a fault.
- `prices status` is the same report as `sync-status`: broker progress, price progress and
  vault status together.
