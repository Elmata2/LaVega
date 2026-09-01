# Prices, benchmarks and market-data consent

Everything that turns synced holdings into valued ones: the price backfill, the benchmark
overlay, and the consent gate in front of Yahoo Finance.

## Sub-features

- market-data consent — asked before the server makes any Yahoo request; the disclosure has
  a version (`yahoo-finance-v1`) and a re-ask when it changes.
- price sync and backfill, with its own progress (`Bezig`, `API-pauze`).
- price cache purge (`Cache`, confirmed with `Ja, alles verwijderen`, then
  `Prijsgegevens verwijderd`).
- benchmark selection and search for the chart overlay.
- FX rates and ISIN → ticker mapping used while pricing.
- key status (`Niet ingesteld`) for `ANTHROPIC_API_KEY` and `MARKET_DATA_API_KEY`.

## How to get to it (user POV)

Consent is requested on the overview before the first market-data call. The `Cache` and
`Operationele status` panels on the overview hold the purge and the progress readouts;
benchmarks are chosen from the portfolio chart.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C consent                                   # current decision + disclosure version
node $C consent --accept                          # write; --dry-run prints instead
node $C prices status
node $C prices sync --force
node $C prices purge --yes                        # deletes every cached bar
node $C api GET /api/investing/benchmarks
node $C api GET '/api/investing/benchmarks/search?query=S%26P'
node $C api GET '/api/market-data/fx?from=USD&to=EUR'
node $C api GET '/api/market-data/identifier?isin=US0378331005'
```

## Gotchas

- Without accepted consent the server makes no Yahoo request at all. Positions stay unpriced
  and the dashboard looks broken while behaving exactly as designed — check `consent` first.
- `/api/market-data/fx` and `/api/market-data/identifier` answer `503` when every provider
  fails, and `400` on a malformed query. The two are easy to confuse in a log.
- `prices purge` is destructive and per tenant. It refuses without `--yes`, and on
  `--target prod` it throws away the real cache — the next dashboard load is slow and
  entirely dependent on Yahoo being up.
- Missing `MARKET_DATA_API_KEY` degrades to a clear status rather than an error. Yahoo and
  Frankfurter need no key, so `Niet ingesteld` is not by itself a fault.
