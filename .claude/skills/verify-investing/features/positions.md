# Positions and position detail

The holdings table and the per-instrument page behind it.

## Sub-features

- positions table (`Positions`) — instrument, value, portfolio weight, total return.
  Sort is in the query (`sort`, `direction`).
- open and closed positions. Detail eyebrow `Open position` or `Closed position`, pill
  `Open` or `Closed`.
- position detail at `/positions/:symbol`. Page eyebrow `Position detail`, title
  `Position`. Price chart uses the symbol as its title. Activity heading is `Activity`
  (aria-label `Position activity`) with types `Buy`, `Sell` and `Dividend`.
- quantity history toggle: `Show quantity history` / `Hide history`.
- empty and missing states: `No positions loaded`, `Position not found`,
  `No position selected`. A missing symbol also says `This position is not in the local
  dashboard model.`
- unpriced copy on the row and the detail: `FX rate missing` or `Value unknown`.

## How to get to it (user POV)

`Positions` in the main navigation, then a row to open its detail page. Deep links work:
`/investing/positions/AAPL` (`/positions/AAPL` on the standalone server). `← Back to positions`
returns to the list and keeps the list's query string.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --target local --raw                    # positions[] is the table's source
node $C dashboard --target local --symbol AAPL            # detail page's request
node $C assets --target local --path /positions/AAPL
```

The detail page adds `?symbol=` to the same dashboard endpoint, so a broken detail page and a
broken overview usually share one cause. The summarized `dashboard` command does not print
the `position` object; `--raw` does. With no holding, `--raw` has `position: null` and the
page shows `Position not found`.

## Gotchas

- A position with `marketValue: null` is unpriced, not missing. It is excluded from totals,
  weights and the risk block, which is why a filled positions table can still show an empty
  allocation — check the price store before the positions code.
- `FX rate missing` means the position is priced in a currency with no FX rate, not that
  the position failed to sync. The detail sentence is
  `FX rate missing. Return cannot be calculated.`
- Symbols in the URL are matched case-insensitively; a symbol containing a dot is a real deep
  link and must not be treated as a file request by the static fallback.
- Without a synced broker the list is `No positions loaded`. That is the local proof. A
  filled table needs the user's broker credentials.
