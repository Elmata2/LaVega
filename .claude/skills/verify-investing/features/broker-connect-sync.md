# Broker connect and sync

Where broker API credentials are entered, unlocked, and turned into positions, trades and
dividends. This is where most investing reports originate.

## Sub-features

- setup cards for Interactive Brokers (`Flex-token`, `Numeric Query ID`) and Trading 212
  (`API key`, `API secret`). Trading 212 needs both values. A secret-less save is rejected
  with `secret is required for trading212`.
- credential form (`Connect broker` / `Save credentials`). The IBKR fields are `Flex-token`
  and `Query ID`. The Trading 212 fields are `API key` and `API secret`. Local and
  self-hosted also ask for `Vault password`. Hosted per-tenant storage omits the passphrase
  (`passphrase: "unused"` on the status payload).
- `Save and sync` posts the credentials, then force-syncs. Loading label:
  `Saving and syncing…`. Success: `Credentials saved. Sync completed.` Failure:
  `Failed to connect broker.` or the server's first problem.
- `Data saved?` / `Start sync` force-syncs without typing credentials again. Success:
  `Sync completed.` Failure heading: `Sync not completed`.
- vault. API status is `empty` / `locked` / `unlocked`. The overview chip says
  `Not set up` / `Locked` / `Open`. After a restart a passphrase vault is locked and only
  the passphrase reopens it.
- `Unlock vault` / `Unlock and sync` — unlock an existing vault, then force a sync.
  Failure: `Failed to unlock vault.`
- in-flight card on this page: eyebrow `Broker sync`, pill `In progress`, `API pause` or
  `Completed`. While waiting it says `Waiting for new API capacity`. The heading is
  hardcoded `Trading 212 syncing` or `Trading 212 synced` even though the underlying
  progress is the shared broker sync.
- overview status chip for the same progress: `In progress`, `Waiting`, `Up to date`,
  `Problem`, `Ready`. A wait detail falls back to `Waiting for API capacity`. A problem
  detail falls back to `Cached data remains visible`.

## How to get to it (user POV)

`Connect broker` on the overview, or `/investing/brokers/connect` (`/brokers/connect` on
the standalone server). Pick a broker, paste the credentials, enter the vault password when
the form shows it, press `Save and sync`. On a later visit a locked vault shows
`Unlock and sync` instead of asking for the keys again.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C sync-status --target local                      # vault + broker + price progress
node $C unlock --target local --dry-run --passphrase <passphrase>
node $C sync --target local --force --dry-run           # same POST the buttons send
node $C dashboard --target local                        # did the data actually land?
node $C api POST /api/brokers/credentials --dry-run \
  --body '{"broker":"trading212","token":"...","secret":"...","passphrase":"..."}'
```

`Save and sync` and `Start sync` both end at `POST /api/brokers/sync?force=true`.

Proof that a real sync worked, in order: `credentials.status` moves `empty` → `unlocked`,
the sync settles at `status: "completed"`, `positionsRead`/`ordersRead` are non-zero, and
the dashboard afterwards reports positions. A `completed` sync with an unchanged dashboard
is a failure — the read model did not pick up the write.

A fresh local server stops earlier, and that is the reachable check without broker keys:
`credentials.status` is `empty`, `passphrase` is `required`, broker sync is `idle` with
`positionsRead: 0`, and the page shows `Save and sync` plus `Start sync`. Do not invent a
broker token to go further.

## Gotchas

- Credential rows existing in the database does not mean a sync has landed. A `sync_state`
  of `0` means no completed sync has ever persisted for that tenant, whatever the credential
  table shows.
- `sync` without `--wait` returns as soon as the run is accepted. Progress lives at
  `/api/brokers/sync/status`, and the UI polls it only while a sync is in flight.
- Trading 212 rate-limits hard. `waitUntil` in the progress payload is a real pause, not a
  hang; `--timeout` on `sync --wait` may need raising rather than the sync being retried.
- `sync` and `unlock` are write commands. Run them against `--target prod` only when the
  user asked for that target; `sync --dry-run` prints what it would post.
- The vault holds the last successful positions, trades and dividends alongside the keys, so
  a failed sync cannot erase them — a dashboard that empties out after a sync is a bug.
- The connect-page progress heading always names Trading 212
  (`BrokerSyncProgressCard` in `apps/investing-web/src/app.tsx`). That is what the app
  shows. It is not a generic broker label.
