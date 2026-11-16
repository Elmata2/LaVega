# DeGiro file import

DeGiro has no login. The user exports CSV files from DeGiro and imports them from
Broker settings. The server parses them; only the parsed rows and a SHA-256 per file
are stored.

## Reach

- `/profile#brokers` → rail tab `DeGiro import`. The rail labels are `Broker APIs`
  (subtitle `Interactive Brokers and Trading 212`) and `DeGiro import` (subtitle
  `CSV export files, no API`).
- The DeGiro panel lists three exports: `Inbox → Rekeningoverzicht (Account statement)`,
  `Inbox → Transacties (Transactions)` and `Portefeuille → Exporteren → CSV
(Portfolio → Export → CSV)`. Up to 3 CSV files, 4 MB total.
- A portfolio export makes the panel ask for `Portfolio export date`; the input defaults
  to today.
- `GET /api/investing/brokers/degiro/import` (stored status) and
  `POST /api/investing/brokers/degiro/import?mode=preview|commit` on the investing app
  and, mounted, under `/api/...` on `www.lavega.dev`.
- Multipart field `files` repeated 1 to 3 times, optional field `asOf` (`YYYY-MM-DD`,
  required for a portfolio export). Tenant-bound: the session's user id selects the
  vault. Preview and status are read-only.

## Drive

UI path (preferred): the SPA sits at `/profile#brokers` in production (`/` on the
standalone server).

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C up
node $C browser open --target local
node $C browser snapshot --interactive
node $C browser click @eN                # the DeGiro import tab
cp packages/core/src/parsers/__fixtures__/degiro/nl/account.csv /tmp/lavega-verify-investing/uploads/
cp packages/core/src/parsers/__fixtures__/degiro/nl/portfolio.csv /tmp/lavega-verify-investing/uploads/
node $C browser raw -- upload "input[type=file]" \
  /tmp/lavega-verify-investing/uploads/account.csv \
  /tmp/lavega-verify-investing/uploads/portfolio.csv
```

Browse only uploads files under `/tmp`. The test fixtures live in
`packages/core/src/parsers/__fixtures__/degiro/nl/`.

API path (when the UI cannot be driven):

```bash
F=packages/core/src/parsers/__fixtures__/degiro/nl
curl -s "http://127.0.0.1:8799/api/investing/brokers/degiro/import"
curl -s -X POST "http://127.0.0.1:8799/api/investing/brokers/degiro/import?mode=preview" \
  -F "files=@$F/account.csv;type=text/csv" \
  -F "files=@$F/portfolio.csv;type=text/csv" \
  -F "asOf=2026-11-12"
curl -s -X POST "http://127.0.0.1:8799/api/investing/brokers/degiro/import?mode=commit" \
  -F "files=@$F/account.csv;type=text/csv" \
  -F "files=@$F/portfolio.csv;type=text/csv" \
  -F "asOf=2026-11-12"
node $C dashboard
node $C cleanup
```

## Prove

- The panel shows `Last imported <date>, covers <from>–<to>` after a commit. There is no
  fresh, stale or never wording.
- Every file shows its detected type (`Account statement`, `Transactions export`,
  `Portfolio export`, or `Unknown file`) and its problems. A known profile also shows
  its date range and row counts; an unknown header shows only the problem.
- A portfolio preview shows `Portfolio export date` with today's date filled in.
- `Confirm import` commits; the success card names the stored totals and the
  `View overview` link reaches `/`. The dashboard shows the imported positions.
- The flow works at 375px and by keyboard: the tablist answers ArrowLeft, ArrowRight,
  Home and End; the drop zone shows its focus ring; every remove button has a name.
- Status route: `GET /api/investing/brokers/degiro/import` answers 200 with
  `{ mode: "status", importedAt, files, coverage, positionsAsOf }` and writes nothing.
  An empty vault gives `null`/`[]`; a locked vault gives 409.
- Committing the same files twice leaves the stored snapshot deep-equal. An unknown
  CSV answers 200 with `committed: false` and writes nothing. A 5 MB upload answers 413.
- Never import fixtures into a real tenant. A live prod commit writes the signed-in
  tenant's snapshot and there is no route to remove it.

## Verified-unreachable

- A prod or preview commit from the CLI when no multipart drive exists; use the
  standalone server.
