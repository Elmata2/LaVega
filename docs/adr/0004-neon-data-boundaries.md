# Neon data boundaries

## Status

Accepted. Schema scaffold only. Authentication and runtime persistence remain deferred.

Amended by [0009](0009-account-held-vault-key.md): the personal vault's key is no longer kept
off Neon. `personal.vault_keys` stores it sealed with `LAVEGA_ENCRYPTION_KEY`, the same way
`investing.broker_vaults` is sealed. "Its encryption key is not stored in Neon" below no longer
holds.

## Decision

Use one Neon Postgres database with two application schemas:

- `personal` stores one encrypted vault blob per future Better Auth `user_id`.
- `investing` stores broker vaults, normalized price bars, benchmark preferences, sync state, and the latest agent run per user.

Every table requires non-blank `user_id`, except the shared tables listed under [Tables without a user](#tables-without-a-user). Ownership uses `user_id` as the primary key where one row exists per user, or as part of the primary key where multiple broker or price records exist. Row-level security uses `current_setting('app.user_id', true)` and is forced for table owners. Missing user context returns no rows and permits no writes.

Personal vault data is encrypted before storage. Its encryption key is not stored in Neon. Personal vaults stay separate from investing data, even though both schemas use the same Neon database. Investing credentials and broker snapshots also use encrypted blobs; normalized prices and operational state use dedicated investing tables.

No Better Auth tables, foreign keys to an auth table, or runtime database adapter are included. This keeps authentication deferred and makes the migration safe to apply before runtime changes.

## Data flow

1. Future Better Auth middleware verifies session.
2. Trusted server code sets `app.user_id` transaction-locally from verified session `user_id`.
3. Server reads or writes only rows allowed by RLS.
4. Personal requests use `personal.vaults`; investing requests use `investing` tables.

Client-supplied user IDs must not set database context. Encryption must happen before sensitive blobs reach Neon.

## One cross-tenant read

The nightly investing cron must find every user with a connected broker, and `broker_vaults` is `FORCE ROW LEVEL SECURITY`. `investing.list_broker_sync_tenants()` (0022) is the single exception: `SECURITY DEFINER`, `search_path` pinned, `EXECUTE` granted to `lavega_runtime` only, returning user ids and nothing else, ordered least recently synced first. It runs as the migration owner, who must bypass RLS; 0022 refuses to apply as a role that cannot. No policy was changed.

## Tables without a user

Some rows belong to no user, and a row-level policy would hide what every tenant must see. These tables have no `user_id` and no row-level security, and hold no personal data:

- `investing.fx_rates` (0011): published daily exchange rates.
- `investing.sector_profiles`: a symbol's sector, which is not tenant data.
- `personal.rate_limit_buckets` (0026): inbound counters. The limiter has to count a caller before a session exists.
- `investing.partner_budgets` (0033, [#305](https://github.com/Elmata2/LaVega/issues/305)): when the next request to a partner may be sent. One row per partner, endpoint and scope. The scope is the literal `shared`, or the first 16 hex characters of a SHA-256 of a broker credential, so no column can hold a credential. The rows hold timing only. They must be visible to every tenant, because Yahoo and OpenFIGI count requests per source IP across all users. `lavega_runtime` has select, insert, update and delete.
- `investing.instrument_price_bars`, `investing.instrument_price_coverage` and `investing.instrument_price_claims` (0034, [#307](https://github.com/Elmata2/LaVega/issues/307)): daily price bars keyed by instrument (`isin:<ISIN>:<CUR>` or `sym:<ticker>:<CUR>`), the date window a provider answered, and the short-lived per-key fetch claim. Public reference data belongs to no user, so one fetch per instrument per day serves every tenant. `lavega_runtime` has select, insert, update and delete on all three.

### Amendment 2026-11-11 — shared market data (issue #307)

The per-user `investing.price_bars` and `investing.price_coverage` tables stayed in place, unread and unwritten, for one release.

### Amendment 2026-11-11 — the per-user price tables are dropped (issue #310)

The shared store then served one release, so `0037` dropped both tables and, with them, the `price_bars_raise_dashboard_version` trigger. All reads and writes go to the shared tables above through `SharedPriceStore`; no query in `packages/database` names the old price tables, including the erase list.

**`dashboard_snapshots.price_keys` records the instrument keys a build read.** The per-user version trigger cannot see a shared write, so a stored dashboard counts only while its version and UTC day still hold _and_ no key in `price_keys` has a coverage `updated_at` later than the row's `updated_at`. That column names, in clear, which instruments a user's dashboard read. It is the same exposure the old per-user `price_bars` rows had (which symbols a user holds), moved to the snapshot row; it does not get worse, and the bars themselves no longer reveal it one row per date.

## Table ownership

| Table                       | Cardinality                         | Purpose                                                                                                  |
| --------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `personal.vaults`           | One per user                        | Encrypted personal finance vault.                                                                        |
| `investing.broker_vaults`   | One per user and broker             | Encrypted broker credentials and latest encrypted snapshot.                                              |
| `investing.preferences`     | One per user                        | Up to three benchmark symbols and market-data consent JSON.                                              |
| `investing.sync_state`      | One per user and broker/sync key    | Broker sync status, resumable state JSON, and price-sync progress/lease state under `broker = 'prices'`. |
| `investing.agent_runs`      | One latest row per user             | Latest agent run status and result JSON.                                                                 |
| `investing.partner_budgets` | One per partner, endpoint and scope | Next allowed request time per partner key (0033). No user; see above.                                    |

## Consequences

- Browser changes no longer need to delete personal data once a future authenticated adapter writes the encrypted vault to Neon.
- Personal and investing access paths remain explicit and independently migratable.
- RLS protects tenant boundaries only after trusted authentication middleware supplies verified context; this scaffold alone does not make unauthenticated routes safe.
- The migration is rerunnable where PostgreSQL supports `IF NOT EXISTS`. It creates no destructive drops. Existing tables are not altered automatically; later shape changes need new migrations.
