# Positions and position detail

The holdings table and the per-instrument page behind it.

## Sub-features

- positions table (`Positions`) — column headers `Instrument`, `Value`, `% portfolio`,
  `Total return`. The instrument cell shows the symbol, the broker entity, and
  `<quantity> shares`.
- open and closed positions (`Open position`, `Closed position`, `Open`, `Closed`).
- position detail (`Position detail` / heading `Position`) at `/positions/:symbol` — price
  chart, position activity (`Position activity`), buys, sells and dividends (`Buy`, `Sell`,
  `Dividend`).
- quantity history toggle (`Show quantity history` / `Hide history`).
- empty and missing states: `No positions loaded`, `Position not found`,
  `No position selected`.
- unpriced value cell: `Value unknown`. Missing FX: `FX rate missing`. Missing return:
  `Return unavailable`. Forward-filled price: visible `est.` and screen-reader
  `Estimated price`.

## How to get to it (user POV)

Main navigation link `Positions` (eyebrow `Positions`, heading `Positions`). A row links to
`/positions/<symbol>` on the standalone server and `/investing/positions/<symbol>` when
mounted. Deep link: `/investing/positions/AAPL`. Back link on the detail page:
`← Back to positions`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --raw                         # positions[] is the table source
node $C dashboard --symbol AAPL --raw           # same endpoint the detail page uses
node $C assets --path /positions/AAPL           # local shell; mounted path is below
node $C assets --target preview --path /investing/positions/AAPL
node $C doctor                                  # positionsPriced / positionsCosted when rows exist
```

The detail page adds `?symbol=` to `/api/investing/dashboard`, so a broken detail page and a
broken overview usually share one cause. Symbol match is case-insensitive.

## What proves it works

- Table has rows: `dashboard` exits 0, `positions` > 0, and `problems` is empty. `--raw`
  shows each row's `symbol` and `quantity`. A priced row has `marketValue` not null and
  `priceStatus` `priced` or `forward-filled`. `doctor` check `positionsPriced` is ok.
- Detail exists: `dashboard --symbol AAPL --raw` returns `position.symbol` equal to `AAPL`
  ignoring case. In the browser the eyebrow is `Position detail` and the activity table's
  accessible name is `Position activity`.
- Empty book, stated honestly: `positions` is 0, `problems` is empty, and the page title is
  `No positions loaded` with `Connect a broker or import a statement to see your investments.`
  That proves the empty state. It does not prove the table.
- Unknown symbol: page title `Position not found`. No symbol segment: `No position selected`.

## Verified-unreachable

- Preview or prod with no session: every `/api/*` is 401. `doctor` fails `credentialsFile`
  when `auth.preview.json` (preview) or `auth.json` (prod) is missing and
  `LAVEGA_VERIFY_EMAIL` plus `LAVEGA_VERIFY_PASSWORD` are unset. Stop. Prerequisite is that
  file or those env vars. Do not invent an account. The positions table is
  verified-unreachable until `login` then `whoami` reports `authenticated`.
- Zero positions after a truthful sync: the holdings table cannot be proven. Prerequisite:
  `sync --wait` with `positionsRead` > 0, or a vault that already holds holdings. The title
  `No positions loaded` is the empty state, not a failed render.
- Rows with `marketValue: null` (`Value unknown`): the table rendered and pricing did not.
  Prerequisite: accepted Yahoo consent, then `sync --wait` and `prices sync --wait`, until
  `positionsPriced` passes. See [prices-and-market-data.md](prices-and-market-data.md).

## Gotchas

- A position with `marketValue: null` is unpriced, not missing. It is excluded from totals,
  weights and the KPI block, which is why a filled positions table can still show an empty
  donut — check the price store before the positions code.
- `FX rate missing` means the position is priced in a currency with no FX rate, not that
  the position failed to sync.
- Symbols in the URL are matched case-insensitively; a symbol containing a dot is a real deep
  link and must not be treated as a file request by the static fallback.
