# Broker connect and sync

Where broker API credentials are entered, unlocked, and turned into positions, trades and
dividends. This is where most investing reports originate.

## Sub-features

- credential form (`Broker koppelen`) for Trading 212 (`API key`) and Interactive Brokers
  (`Flex-token`, `Numeriek Query ID`), plus the vault passphrase.
- vault (`Kluis`): `empty` / `locked` / `unlocked`. Credentials are AES-GCM encrypted; after
  a restart the vault is locked and only the passphrase reopens it.
- `Opslaan en synchroniseren` — save credentials, then force a sync.
- `Ontgrendelen en synchroniseren` — unlock an existing vault, then force a sync.
- sync progress: `Bezig`, `Gereed`, `API-pauze` / `API-capaciteit wordt afgewacht`,
  and the failure states `Broker synchronisatie mislukt.`, `Broker koppelen mislukt.`,
  `Kluis ontgrendelen mislukt.`

## How to get to it (user POV)

`Brokers` in the main navigation, or `/investing/brokers/connect`. Pick a broker, paste the
credentials, enter the vault passphrase, press `Opslaan en synchroniseren`. On a later visit
the vault is already populated and the button reads `Ontgrendelen en synchroniseren`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C sync-status --target prod                       # vault + broker + price progress
node $C unlock --target prod --passphrase <passphrase>
node $C sync --target prod --force --wait               # posts the same route the button does
node $C dashboard --target prod                         # did the data actually land?
node $C api POST /api/brokers/credentials --body '{"broker":"trading212","token":"...","passphrase":"..."}'
```

Proof that it works, in order: `credentials.status` moves `empty` → `unlocked`, the sync
settles at `status: "completed"`, `positionsRead`/`ordersRead` are non-zero, and the
dashboard afterwards reports positions. A `completed` sync with an unchanged dashboard is a
failure — the read model did not pick up the write.

## Gotchas

- Credential rows existing in the database does not mean a sync has landed. A `sync_state`
  of `0` means no completed sync has ever persisted for that tenant, whatever the credential
  table shows.
- `sync` without `--wait` returns as soon as the run is accepted. Progress lives at
  `/api/brokers/sync/status`, and the UI polls it only while a sync is in flight.
- Trading 212 rate-limits hard. `waitUntil` in the progress payload is a real pause, not a
  hang; `--timeout` on `sync --wait` may need raising rather than the sync being retried.
- `sync` and `unlock` are write commands. Run them against `--target prod` only when the user
  asked for that target; `sync --dry-run` prints what it would post.
- The vault holds the last successful positions, trades and dividends alongside the keys, so
  a failed sync cannot erase them — a dashboard that empties out after a sync is a bug.
