# Positions and position detail

The holdings table and the per-instrument page behind it.

## Sub-features

- positions table (`Posities`) — instrument, quantity, market value, return.
- open and closed positions (`Open positie`, `Gesloten positie`, `Gesloten`).
- position detail (`Positiedetail`) at `/positions/:symbol` — price chart, position activity
  (`Positieactiviteit`), buys and dividends (`Koop`, `Dividend`).
- quantity history toggle (`Aantalhistorie tonen` / `Historie verbergen`).
- empty and missing states: `Geen posities geladen`, `Positie niet gevonden`,
  `Geen positie gekozen`.

## How to get to it (user POV)

`Posities` in the main navigation, then a row to open its detail page. Deep links work:
`/investing/positions/AAPL`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --target prod --raw                    # positions[] is the table's source
node $C dashboard --target prod --symbol AAPL            # detail page's request
node $C assets --target prod --path /investing/positions/AAPL
```

The detail page adds `?symbol=` to the same dashboard endpoint, so a broken detail page and a
broken overview usually share one cause.

## Gotchas

- A position with `marketValue: null` is unpriced, not missing. It is excluded from totals,
  weights and the KPI block, which is why a filled positions table can still show an empty
  donut — check the price store before the positions code.
- `FX-koers ontbreekt` means the position is priced in a currency with no FX rate, not that
  the position failed to sync.
- Symbols in the URL are matched case-insensitively; a symbol containing a dot is a real deep
  link and must not be treated as a file request by the static fallback.
