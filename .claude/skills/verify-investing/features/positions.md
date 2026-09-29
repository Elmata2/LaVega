# Positions and position detail

The holdings table and the per-instrument page behind it.

## Reach

Standalone server: `http://127.0.0.1:8799/positions` (eyebrow `Positions`, heading `Positions`).
Mounted app: `https://www.lavega.dev/investing/positions` after sign-in. Main navigation link
text is `Positions`. A row links to `/positions/<symbol>` (mounted: `/investing/positions/<symbol>`).
Deep link `AAPL` is `/investing/positions/AAPL`. Detail back link: `← Back to positions`.

Column headers, verbatim: `Instrument`, `Value`, `% portfolio`, `Total return`. The instrument
cell ends with `<quantity> shares`. Detail eyebrow is `Position detail`, heading `Position`.
Activity table accessible name: `Position activity`. Kinds: `Buy`, `Sell`, `Dividend`.
Quantity toggle: `Show quantity history` / `Hide history`. Open/closed: `Open position`,
`Closed position`, `Open`, `Closed`.

Empty and missing copy, verbatim:

- no rows: `No positions loaded`
- description under that title: `Connect a broker or import a statement to see your investments.`
- unknown symbol: `Position not found`
- URL without a symbol: `No position selected`
- list, unpriced value cell: `Value unknown`
- list, missing FX: `FX rate missing`
- list, missing return: `Return unavailable`
- detail current value uses the same `FX rate missing` or `Value unknown`
- detail total return, when it cannot be calculated, is `Unavailable`
- detail missing-FX banner: `FX rate missing. Return cannot be calculated.`

## Drive

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
E="/tmp/lavega-verify-investing/evidence"
node $C dashboard --out "$E/positions-dashboard.json"
node $C dashboard --raw --out "$E/positions-dashboard-raw.json"
node $C dashboard --symbol AAPL --raw --out "$E/positions-aapl.json"
node $C browser open
node $C browser wait-settle
node $C browser snapshot --interactive --out "$E/positions-snapshot.json"
node $C browser goto /positions
node $C browser text --out "$E/positions-text.json"
```

Mounted paths need `--target preview` or `--target prod` and a session. Detail uses the same
dashboard endpoint with `?symbol=`. Symbol match is case-insensitive.

## Observable success

Exit 0, and one of these is true. Assert the field. Do not treat a loaded page as success.

1. **Rows.** `positions-dashboard.json` field `positions` is a number ≥ 1, and `problems` is
   `[]`. `--raw` field `positions` is an array of that length. Each element has `symbol` and
   `quantity`. A priced row has `marketValue` not null and `priceStatus` `priced` or
   `forward-filled`. `doctor` check `positionsPriced` is `ok: true`.
2. **Empty state.** `positions` is `0`, `problems` is `[]`, and browser text contains the
   verbatim string `No positions loaded`. That is success for an empty book. It is not success
   for a filled table.
3. **Missing detail.** `dashboard --symbol <missing> --raw` has no `position.symbol` equal to
   that symbol, and the page title is `Position not found`.

## Verified-unreachable

- Preview or prod with no session: every `/api/*` is 401. On preview, `login` loads
  `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD` with `vercel env pull`. Prerequisite
  when that pull fails: those two env vars in the process, or `vercel link` plus
  `vercel login`. Then `login` exit 0, `whoami` `state` `authenticated`, and report `page`.
  Do not write `auth.preview.json`. Do not invent an account.
- Row count ≥ 1 with no broker holdings: prerequisite is `sync-status` `positionsRead` > 0
  after `sync --wait`, or a vault that already holds holdings. Until then only observable
  success 2 (the verbatim empty copy) can pass.
- `Value unknown` on a row that exists: the table rendered. Pricing did not. Prerequisite:
  consent `accepted: true`, then `sync --wait` and `prices sync --wait`, until
  `positionsPriced` is ok. See [prices-and-market-data.md](prices-and-market-data.md).

## Gotchas

- A position with `marketValue: null` is unpriced, not missing. It is excluded from totals,
  weights and the KPI block, which is why a filled positions table can still show an empty
  donut — check the price store before the positions code.
- `FX rate missing` means the position is priced in a currency with no FX rate, not that
  the position failed to sync.
- Symbols in the URL are matched case-insensitively; a symbol containing a dot is a real deep
  link and must not be treated as a file request by the static fallback.
