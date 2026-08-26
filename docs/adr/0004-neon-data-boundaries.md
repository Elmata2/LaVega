# Neon data boundaries

## Status

Accepted. Schema scaffold only. Authentication and runtime persistence remain deferred.

## Decision

Use one Neon Postgres database with two application schemas:

- `personal` stores one encrypted vault blob per future Better Auth `user_id`.
- `investing` stores broker vaults, normalized price bars, benchmark preferences, sync state, and the latest agent run per user.

Every table requires non-blank `user_id`. Ownership uses `user_id` as the primary key where one row exists per user, or as part of the primary key where multiple broker or price records exist. Row-level security uses `current_setting('app.user_id', true)` and is forced for table owners. Missing user context returns no rows and permits no writes.

Personal vault data is encrypted before storage. Its encryption key is not stored in Neon. Personal vaults stay separate from investing data, even though both schemas use the same Neon database. Investing credentials and broker snapshots also use encrypted blobs; normalized prices and operational state use dedicated investing tables.

No Better Auth tables, foreign keys to an auth table, or runtime database adapter are included. This keeps authentication deferred and makes the migration safe to apply before runtime changes.

## Data flow

1. Future Better Auth middleware verifies session.
2. Trusted server code sets `app.user_id` transaction-locally from verified session `user_id`.
3. Server reads or writes only rows allowed by RLS.
4. Personal requests use `personal.vaults`; investing requests use `investing` tables.

Client-supplied user IDs must not set database context. Encryption must happen before sensitive blobs reach Neon.

## Table ownership

| Table | Cardinality | Purpose |
| --- | --- | --- |
| `personal.vaults` | One per user | Encrypted personal finance vault. |
| `investing.broker_vaults` | One per user and broker | Encrypted broker credentials and latest encrypted snapshot. |
| `investing.price_bars` | One per user, symbol, date | Queryable daily market data. |
| `investing.preferences` | One per user | Up to three benchmark symbols and market-data consent JSON. |
| `investing.sync_state` | One per user and broker | Broker sync status and resumable state JSON. |
| `investing.agent_runs` | One latest row per user | Latest agent run status and result JSON. |

## Consequences

- Browser changes no longer need to delete personal data once a future authenticated adapter writes the encrypted vault to Neon.
- Personal and investing access paths remain explicit and independently migratable.
- RLS protects tenant boundaries only after trusted authentication middleware supplies verified context; this scaffold alone does not make unauthenticated routes safe.
- The migration is rerunnable where PostgreSQL supports `IF NOT EXISTS`. It creates no destructive drops. Existing tables are not altered automatically; later shape changes need new migrations.
