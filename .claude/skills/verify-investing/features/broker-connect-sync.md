# Broker connect and sync

Where broker API credentials are entered, unlocked, and turned into positions, trades and
dividends. This is where most investing reports originate.

## Sub-features

- credential form (heading `Save credentials`, broker `<select aria-label="Broker">`) for Trading 212
  (`API key` and `API secret`, both required) and Interactive Brokers (`Flex-token`,
  field label `Query ID`; the setup card also says `Numeric Query ID`). Local file vault
  also asks for `Vault password`.
- vault (`Vault` chip): `Not set up` / `Locked` / `Open`, from the API states `empty` /
  `locked` / `unlocked`. The local file vault is AES-GCM with that password; after a
  restart it is locked and only the password reopens it. A hosted Neon vault encrypts
  with the server key (`passphrase: unused` on credential status) and stays unlocked.
  Do not expect `Unlock vault` on preview or prod.
- `Save and sync` (`Saving and syncing…` while pending) — save credentials, then force a sync.
- `Unlock and sync` (`Unlocking…` while pending) under `Unlock vault` — unlock an existing
  vault, then force a sync. Success reads `Vault unlocked. Sync completed.`
- `Start sync` (`Syncing…` while pending) — force a sync with the vault already open.
- sync progress: `In progress`, `Ready`, `Completed`, `API pause`. The progress line reads
  `Waiting for new API capacity`. The Profile `Brokers` chip detail falls back to
  `Waiting for API capacity`. Failure states: `Broker sync failed.`, `Sync not completed`, `Sync problems`,
  `Failed to unlock vault.`, `Broker credential storage is unavailable. Try again later.`

## How to get to it (user POV)

Reach: `/profile#brokers` (mounted: `https://www.lavega.dev/investing/profile#brokers`), or the
profile button in the top bar. `/brokers/connect` redirects to `/profile#brokers`.

Pick a broker, paste the credentials, and press `Save and sync`. Trading 212 needs both
`API key` and `API secret`. On the local file vault, also enter `Vault password`. On a later
local visit the form is `Unlock vault` with `Unlock and sync`. Hosted preview and prod keep
the Neon vault unlocked (`passphrase: unused`), so that unlock form is not the later-visit
path there.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C sync-status --target prod                       # broker + prices + credentials
node $C unlock --target prod --passphrase <passphrase>
node $C sync --target prod --force --wait               # posts the same route the button does
node $C dashboard --target prod                         # did the data actually land?
node $C api POST /api/brokers/credentials --body '{"broker":"trading212","token":"...","secret":"...","passphrase":"..."}'
```

Proof that it works, in order: `credentials.status` moves `empty` → `unlocked`, the sync
settles at `status: "completed"`, `positionsRead`/`ordersRead` are non-zero, and the
dashboard afterwards reports positions. A `completed` sync with an unchanged dashboard is a
failure — the read model did not pick up the write.

## Gotchas

- Credential rows existing in the database does not mean a sync has landed. Never-synced
  is `history.<broker>.lastSyncedAt: null` on `/api/brokers/sync/status`.
  `investing.sync_state.state` is jsonb, not a numeric `0`.
- `sync` without `--wait` returns as soon as the run is accepted. Progress lives at
  `/api/brokers/sync/status`, and the UI polls it only while a sync is in flight.
- Trading 212 rate-limits hard. `waitUntil` in the progress payload is a real pause, not a
  hang; `--timeout` on `sync --wait` may need raising rather than the sync being retried.
- `sync` and `unlock` are write commands. Run them against `--target prod` only when the user
  asked for that target; `sync --dry-run` prints what it would post.
- The vault holds the last successful positions, trades and dividends alongside the keys, so
  a failed sync cannot erase them — a dashboard that empties out after a sync is a bug.
