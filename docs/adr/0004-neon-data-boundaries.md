# Neon data boundaries

## Status

Accepted. Schema scaffold only. Authentication and runtime persistence remain deferred.

Amended by [0009](0009-account-held-vault-key.md): the personal vault's key is no longer kept
off Neon. `personal.vault_keys` stores it sealed with `LAVEGA_ENCRYPTION_KEY`, the same way
`investing.broker_vaults` is sealed. "Its encryption key is not stored in Neon" below no longer
holds.

Amended by [0010](0010-server-reads-transactions-at-night.md): further cross-tenant functions for
the instinct agent (see "Further cross-tenant functions" below).

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

## First cross-tenant read

The nightly investing cron must find every user with a connected broker, and `broker_vaults` is `FORCE ROW LEVEL SECURITY`. `investing.list_broker_sync_tenants()` (0022) is the first exception: `SECURITY DEFINER`, `search_path` pinned, `EXECUTE` granted to `lavega_runtime` only, returning user ids and nothing else, ordered least recently synced first. It runs as the migration owner, who must bypass RLS; 0022 refuses to apply as a role that cannot. No policy was changed.

## Further cross-tenant functions

The instinct agent needs four functions that cross tenants, and its tables are `FORCE ROW LEVEL SECURITY` keyed on `app.user_id`. Each follows the 0022 pattern: `SECURITY DEFINER`, `search_path` pinned to `pg_catalog, pg_temp`, `REVOKE ALL ... FROM PUBLIC`, `EXECUTE` granted to `lavega_runtime` only. They run as the migration owner, so 0028 and 0029 refuse to apply as a role without `BYPASSRLS` (or superuser). No policy was changed.

| Function (migration)                                                                         | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Who may execute  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `personal.list_agent_due_users(local_hour INT, retry_hours INT, local_date DATE)` (0028)     | Rows of `(tenant_id, message_day)` for opted-in users whose local hour is within `retry_hours` after their send hour, counted round the clock (`(local_hour - send_hour + 24) % 24 <= retry_hours`), and whose day claim is NULL or earlier than `message_day`. `message_day` is `local_date` while `local_hour >= send_hour`, else the day before. Nothing else.                                                                                                                                                                                   | `lavega_runtime` |
| `personal.agent_user_for_phone(phone_hash TEXT)` (0029)                                      | The one user id linked to that phone HMAC, or no row. Used by the WhatsApp webhook, which has no session.                                                                                                                                                                                                                                                                                                                                                                                                                                           | `lavega_runtime` |
| `personal.agent_consume_link_code(code_hash TEXT, phone_hash TEXT, phone_blob BYTEA)` (0029) | The user id that was linked, or NULL. Purges attempts older than 15 minutes, applies the throttle (5 failed attempts per phone HMAC within 15 minutes; there is no global cap), deletes the unexpired code and writes `agent_whatsapp` in one statement, and records a failed attempt in `agent_link_attempts`. It refuses (NULL, no attempt recorded, the code deleted) when the code's user has no enabled settings row, and the consuming delete also requires one (`FOR SHARE`). A caller cannot tell a throttled attempt from an invalid code. | `lavega_runtime` |

`personal.agent_purge_link_attempts()` (0029) is `SECURITY DEFINER` with a pinned `search_path`, no `PUBLIC` execute, and `EXECUTE` for `lavega_runtime`. It deletes `agent_link_attempts` rows older than 15 minutes and returns the count. The cron calls it once per run.

After the cron lists a user, it reads that user's `eb_sessions` and agent tables inside `withTenant(userId)`, so every row it touches passes that user's own policy.

`personal.agent_link_attempts` has no user id, forced RLS, no policy and no grant for `lavega_runtime`. Only `agent_consume_link_code`, which runs as its owner, reads or writes it.

The design spec asks for a "dedicated server role" for the listing. These functions replace it. The blast radius is the same (a role that bypasses RLS can read every tenant; these functions return user ids or one lookup result, and per-user data still needs `withTenant`), the pattern is already audited in 0022, and it needs no second database credential to store, rotate and leak.

## Table ownership

| Table                               | Cardinality                      | Purpose                                                                                                                         |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `personal.vaults`                   | One per user                     | Encrypted personal finance vault.                                                                                               |
| `personal.agent_settings`           | One per user                     | Instinct agent on/off, sealed channel list, send hour, locale, consent version and time, sealed email address (0027).           |
| `personal.agent_state`              | One per user                     | Last sent day (the day claim), sealed list of sent keys, last tip day, expiry reminder state, per-day bank fetch count (0027).  |
| `personal.agent_mirror`             | One per user                     | Sealed copy of the user's category rules, due dates and card offer (name, yearly gain). Refreshed by the browser (0027).        |
| `personal.agent_push_subscriptions` | One per user and endpoint hash   | Sealed web push subscription (0027).                                                                                            |
| `personal.agent_events`             | Many per user                    | Sealed message and conversation events, 90-day retention, HMAC dedupe key (0027).                                               |
| `personal.agent_whatsapp`           | One per user                     | Sealed WhatsApp number and its HMAC lookup key, link time, last inbound time (0029).                                            |
| `personal.agent_link_codes`         | One per user                     | HMAC of a one-time link code and its 15-minute expiry (0029).                                                                   |
| `personal.agent_link_attempts`      | Many, no user id                 | Failed link-code attempts: phone HMAC and time. No runtime grant; purged after 15 minutes (0029).                               |
| `investing.broker_vaults`           | One per user and broker          | Encrypted broker credentials and latest encrypted snapshot.                                                                     |
| `investing.price_bars`              | One per user, symbol, date       | Queryable daily market data.                                                                                                    |
| `investing.price_coverage`          | One per user and symbol          | Date window the provider answered, its listing/currency (0015), and a closed position's confirmed-delisted date, if any (0021). |
| `investing.preferences`             | One per user                     | Up to three benchmark symbols and market-data consent JSON.                                                                     |
| `investing.sync_state`              | One per user and broker/sync key | Broker sync status, resumable state JSON, and price-sync progress/lease state under `broker = 'prices'`.                        |
| `investing.agent_runs`              | One latest row per user          | Latest agent run status and result JSON.                                                                                        |

## Consequences

- Browser changes no longer need to delete personal data once a future authenticated adapter writes the encrypted vault to Neon.
- Personal and investing access paths remain explicit and independently migratable.
- RLS protects tenant boundaries only after trusted authentication middleware supplies verified context; this scaffold alone does not make unauthenticated routes safe.
- The migration is rerunnable where PostgreSQL supports `IF NOT EXISTS`. It creates no destructive drops. Existing tables are not altered automatically; later shape changes need new migrations.
