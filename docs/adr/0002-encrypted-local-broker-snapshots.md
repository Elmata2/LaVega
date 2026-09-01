# Encrypt local broker snapshots in the credential vault

Broker positions, trades, and dividends must survive local container rebuilds. This data is sensitive financial data. A plaintext file or Docker image layer is not acceptable.

Local/self-hosted runtime stores one last-successful snapshot per broker inside the existing AES-GCM vault. Runtime restores snapshots only after vault unlock. Failed, partial, and skipped sync outcomes cannot replace a complete trade history with a shorter set; they may merge newly read pages and they persist a resume cursor when pagination did not finish. A holdings or cash-summary failure must not replace last-good positions or cash with empty arrays.

## Considered options

- **Encrypted snapshot in existing local vault** — chosen. It reuses atomic encrypted writes, persisted volume, and unlock lifecycle without exposing financial data on disk.
- **Plain JSON volume** — rejected. Positions and transaction history would be readable outside LaVega.
- **Separate encrypted local store** — deferred. Current single-user runtime does not need a second passphrase, key lifecycle, or file transaction mechanism.

## Consequences

- `CredentialStore` remains credential-only at domain boundary. Node runtime file-vault implementation also owns encrypted runtime snapshots as local deployment infrastructure.
- In-memory broker cache remains separate read layer for dashboard access.
- Snapshot persistence happens after a broker sync that returned data, including a paused history that still has a resume cursor. A truncated trade list is merged into the last snapshot and does not replace it. `lastSyncedAt` is only set when history is complete, so the next run continues the cursor.
- Hosted tier must use separate tenant-scoped storage and encryption seam. It must not reuse local file-vault implementation.
- On Vercel, Trading 212 history cannot finish in one function invocation (6 req/min vs `maxDuration`). The adapter stops before the host deadline, persists `resume` + collected pages, and continues on the next run.
