# DeGiro file import (API only until D12)

DeGiro has no login. The user exports CSV files from DeGiro and the investing server
parses them. The upload route exists from D11 (#323); the DeGiro tab in Broker settings
arrives with D12 (#324), so there is no UI to drive yet.

## Reach

- `POST /api/investing/brokers/degiro/import?mode=preview|commit` on the investing app and,
  mounted, under `/api/...` on `www.lavega.dev`.
- Multipart field `files` repeated 1 to 3 times, optional field `asOf` (`YYYY-MM-DD`,
  required for a portfolio export). Total upload at most 4 MB.
- Tenant-bound: the session's user id selects the vault. Preview is read-only.

## Drive

There is no `control-investing.mjs` command yet (its `api` command sends JSON, not
multipart), and the SPA has no upload control. Drive the standalone server with the
sanitized fixtures, which is how D11 was verified:

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C up
F=packages/core/src/parsers/__fixtures__/degiro/nl
curl -s -X POST "http://127.0.0.1:8799/api/investing/brokers/degiro/import?mode=preview" \
  -F "files=@$F/account.csv;type=text/csv" \
  -F "files=@$F/portfolio.csv;type=text/csv" \
  -F "asOf=2026-11-12"
node $C cleanup
```

Replace `mode=preview` with `mode=commit` to write the tenant's DeGiro snapshot, then read
`node $C dashboard`.

## Prove

- Preview answers 200 with per file `profile`, `period`, the parsed `rows`, `problems` and
  `sha256`, and writes nothing.
- Commit answers 200 with `committed: true`; `dashboard` then shows the imported positions
  and the account statement's cash flows and balances. Unpriced holdings stay unpriced
  until a price run.
- Committing the same files twice leaves the stored snapshot deep-equal. An unknown CSV
  answers 200 with `committed: false` and writes nothing. A 5 MB upload answers 413.
- Never import fixtures into a real tenant. A live prod commit writes the signed-in
  tenant's snapshot and there is no route to remove it.

## Verified-unreachable

- The UI flow until D12.
- A prod or preview commit from the CLI until a multipart drive exists; use the standalone
  server.
