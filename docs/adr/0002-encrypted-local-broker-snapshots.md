# Encrypt local broker snapshots in the credential vault

Broker positions, trades, and dividends must survive local container rebuilds. This data is sensitive financial data. A plaintext file or Docker image layer is not acceptable.

Local/self-hosted runtime stores one last-successful snapshot per broker inside the existing AES-GCM vault. Runtime restores snapshots only after vault unlock. Failed, partial, and skipped sync outcomes cannot replace last successful data.

## Considered options

- **Encrypted snapshot in existing local vault** — chosen. It reuses atomic encrypted writes, persisted volume, and unlock lifecycle without exposing financial data on disk.
- **Plain JSON volume** — rejected. Positions and transaction history would be readable outside LaVega.
- **Separate encrypted local store** — deferred. Current single-user runtime does not need a second passphrase, key lifecycle, or file transaction mechanism.

## Consequences

- `CredentialStore` remains credential-only at domain boundary. Node runtime file-vault implementation also owns encrypted runtime snapshots as local deployment infrastructure.
- In-memory broker cache remains separate read layer for dashboard access.
- Snapshot persistence happens only after fully successful broker sync.
- Hosted tier must use separate tenant-scoped storage and encryption seam. It must not reuse local file-vault implementation.
