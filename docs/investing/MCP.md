# Investing MCP endpoint (read + preview/apply write)

`POST /mcp` lets an external agent query the owner's investing data, and — only
with a separate write token — apply a validated account tax-treatment rule.
Reads are the default and the whole surface for a read token. Writes are a
two-step preview/apply pair behind a distinct credential, scoped to the account
its bearer token names, and mounted in `apps/server` — the process that already
owns auth and tenant resolution. ADR
[0012](../adr/0012-mcp-auth-and-tenant-resolution.md) records why it is not on
the standalone investing server: that server has no auth and resolves
`LOCAL_TENANT_ID`.

Plan: `docs/superpowers/specs/2026-11-10-sure-adoption-plan.md` §3
WS5.1/WS5.2/WS5.3/WS5.4/WS5.6/WS5.7.
Sure source followed for protocol and registry shape:
`app/controllers/mcp_controller.rb`, `app/models/assistant/function/*`,
`function_tool_caller.rb` at pinned commit `562fe09`. Sure's write-capable,
single-scope MCP was deliberately **not** copied.

## Endpoint

- `POST /mcp`, JSON-RPC 2.0 over HTTP (MCP Streamable HTTP conventions).
- No cookies, no browser session, no CORS. Machine clients only.
- `GET /mcp` answers `405` (authenticated) — there is no SSE stream.
- `Authorization: Bearer <token>` is required on every request.
- Personal-vault tools are not reachable here; this endpoint reads investing
  data only.

## Authentication: token → tenant

The token names the tenant. No header, query parameter or tool argument can
choose one.

1. **Hashed table (hosted).** `investing.api_tokens` (migration
   `0027_mcp_tokens.sql`) stores `SHA-256(token)` hex, `user_id`, `scopes`,
   `created_at`, `last_used_at`, optional `expires_at` and `revoked_at`. The raw
   token is shown once at creation and never stored.
2. **Environment fallback (no database).** `MCP_API_TOKEN` (read) and
   `MCP_WRITE_API_TOKEN` (write) plus `MCP_TENANT_ID`, each compared in constant
   time. The two values must differ: the read token is checked first, so setting
   one value for both yields the read-only identity. `MCP_USER_EMAIL` is
   accepted as a tenant alias for installs that already set it; a single-tenant
   file-backed install should set `MCP_TENANT_ID=local`, the tenant its stores
   use. The fallback is disabled whenever `DATABASE_URL` is set, so a stray env
   token cannot bypass revocation.
3. A missing, unknown, expired, revoked or scope-less token is **401**, never
   local-tenant data. `/mcp` also ignores the `pnpm dev` escape hatch
   (`LAVEGA_ALLOW_UNAUTHENTICATED`): its guard branch runs before it.

Create a token with the operator script (prints the raw token once):

```bash
# read-only token (default)
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts create --user <better-auth-user-id> --label "cursor"
# separate WRITE token: lists preview_rule/apply_rule and the read tools
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts create --user <better-auth-user-id> --label "cursor-write" --scopes write
# list / revoke
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts list --user <better-auth-user-id>
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts revoke --id <token-row-id>
```

A write token also carries the read tools: its previews must be described from
the same reads. A read token never lists or dispatches a write tool.

The `--user` value is `auth.uid` — the same id the dashboard session uses, so
the token sees exactly that account's rows through the same tenant path.

## Protocol

| Item              | Behaviour                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Methods           | `initialize`, `tools/list`, `tools/call`                                                                                                |
| Protocol versions | `2025-06-18` (preferred), `2025-03-26`; an unknown request version negotiates to `2025-06-18`                                           |
| Session           | server-issued `Mcp-Session-Id` UUID (one-day TTL, checked against the token identity); unknown/expired session on a later call is `404` |
| Notifications     | request without `id` → `202`, empty body                                                                                                |
| Other methods     | JSON-RPC `-32601`                                                                                                                       |
| Errors            | JSON-RPC codes; parse `-32700`, invalid request `-32600`, invalid params `-32602`, internal `-32603`                                    |

A tool failure is **result data**, not a transport failure:

```json
{ "result": { "isError": true, "structuredContent": { "error": "tool_failed", "hint": "…" } } }
```

No exception text, SQL, path or stack crosses the boundary.

## Tools

`tools/list` is the truth; this block is checked against the registry (names AND
scopes) by `apps/investing-server/src/tools/docs.test.ts`, so it cannot drift
silently. The in-app chat uses the SAME definitions through an in-process data
source — there is no second inline tool definition (WS5.3).

<!-- tool-registry:start -->

| Tool                  | Scope | Reads                                                                                         |
| --------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `get_positions`       | read  | Open holdings with weight, market value, cost basis and returns                               |
| `get_portfolio_value` | read  | Latest total value point with its date                                                        |
| `get_trades`          | read  | Executed trades, newest first, at most 60 rows per call                                       |
| `get_price`           | read  | One closing price, latest or on/before a date                                                 |
| `get_fundamentals`    | read  | Consent-gated company brief for one symbol                                                    |
| `get_sector_exposure` | read  | Portfolio weight by sector, funds looked through                                              |
| `get_risk`            | read  | Historical risk against the default benchmark (6M/1Y/All)                                     |
| `get_agent_memory`    | read  | Risk tolerance, theses and goals stored for the owner                                         |
| `preview_rule`        | write | Validate an account tax-treatment rule and return a single-use preview token; changes nothing |
| `apply_rule`          | write | Apply a preview token from `preview_rule` (single-use, 30-minute TTL)                         |

<!-- tool-registry:end -->

Data semantics, inherited from the read models: money is a decimal amount in the
presentation currency (`1234.56`, not integer cents); weights and percentages are
fractions (`0.12` = 12%); an unknown magnitude is `null`, never `0` (ADR 0011);
trades are newest first; `truncated: true` in a read payload means the route's
own row cap cut it.

Why a read token cannot reach a write path — two independent gates:

1. The registry is filtered by the token's scopes, and `tools/call` looks the
   name up in the **same filtered array** `tools/list` returned. A write tool is
   not callable by name, and the answer names the refusal as unknown-tool with a
   hint to call `tools/list`.
2. Every read handler goes through a read-path allowlist
   (`apps/server/src/mcp/investingRead.ts`), which forwards only GETs on the
   investing app's read routes. A write tool goes through a SEPARATE allowlist
   (`apps/server/src/mcp/investingWrite.ts`) with exactly one path, and the
   bridge re-serialises the validated entries rather than forwarding the caller's
   body.

## Write tools: preview, then apply

A write token lists two extra tools. Neither is listed for a read token.

1. `preview_rule` takes `{entries: [{broker, account, wrapper}]}` (the account
   tax-treatment rule map from WS4.4). It validates the entries with the same
   validator the API route uses, reads the currently stored labels, and returns
   `{previewToken, expiresAt, entries, changes}`. **It changes nothing.**
2. `apply_rule` takes only `{previewToken}`. The token is bound to the token
   identity and tenant, is single-use, and expires after **30 minutes**
   (`RULE_PREVIEW_TTL_MS`). An unknown, used or expired token is refused and
   nothing changes; the owner previews again.

The applied write is the owner's own account-label metadata (the same PUT
`/api/investing/account-wrappers` the dashboard uses), never a trade, a transfer
or a credential.

## Spend gate

Every `tools/call` passes the account's AI spend gate before dispatch (WS5.7).
An over-cap call returns safe tool-error data and executes nothing:

```json
{ "isError": true, "structuredContent": { "error": "budget_exhausted", "hint": "…" } }
```

`budget_unavailable` means the gate could not be read; the call is refused rather
than admitted blind. The gate is a peek — MCP tool calls do not buy model tokens —
but it is the same per-account cap the in-app agent routes use.

## Response caps

- Defaults: **200 rows** and **256 KiB** per tool response
  (`DEFAULT_AGENT_TOOL_CAPS` in `packages/core/src/agentTools.ts`). All arrays in
  a payload share one row budget.
- Over a cap the response is truncated, not dropped or streamed whole: the text
  content ends with `[truncated: …]` and `_meta` carries
  `{ truncated, totalRows, keptRows, bytes }`.
- An object too large to fit becomes
  `{ "truncated": true, "reason": "response exceeds byte cap" }`.
- Per-token rate limit: 60 calls per minute by default, override with
  `MCP_RATE_LIMIT_PER_MINUTE`. Over the limit is `429` with `Retry-After: 60`.

## Audit

One row per call in `investing.mcp_audit` (token id or `'env'`, method, tool,
duration, outcome `ok|refused|error`). With no database the same fields go to one
stdout JSON line. No bearer token and no argument value is stored.

## Examples

```bash
TOKEN=...   # raw token, created once
BASE=http://127.0.0.1:8795

curl -sS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'

curl -sS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -sS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_positions","arguments":{}}}'

curl -sS -i -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/list"}'   # 401, no token
```

Point an MCP client at `$BASE/mcp` with the same bearer header.

## Limits (carried)

- The rate limiter is per process; on a multi-instance deployment the real
  ceiling is the per-instance limit times the instance count. A shared Neon
  limiter is the follow-up if this endpoint ever leaves single-owner use.
- Sessions live in memory, so a cold start costs one re-initialize.
- No OAuth discovery/registration endpoint: token creation is an operator
  action, per ADR 0012.
- Preview tokens live in memory, like sessions: a cold start invalidates an
  outstanding preview and the owner previews again. A shared store is the
  follow-up if the endpoint runs multi-instance.
- The write surface is deliberately one path (account tax-treatment labels). A
  second structural write needs its own allowlist entry and review.
- The chat tool loop caps at 8 rounds, forces text on the last round, trims
  history in whole call/result pairs and persists a partial turn as failed
  (`apps/investing-server/src/toolLoop.ts`).
