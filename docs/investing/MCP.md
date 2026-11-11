# Investing MCP endpoint (read-only)

`POST /mcp` lets an external agent query the owner's investing data. It is
read-only by construction, scoped to the account its bearer token names, and
mounted in `apps/server` — the process that already owns auth and tenant
resolution. ADR
[0012](../adr/0012-mcp-auth-and-tenant-resolution.md) records why it is not on
the standalone investing server: that server has no auth and resolves
`LOCAL_TENANT_ID`.

Plan: `docs/superpowers/specs/2026-11-10-sure-adoption-plan.md` §3 WS5.1/WS5.2.
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
2. **Environment fallback (no database).** `MCP_API_TOKEN` plus `MCP_TENANT_ID`,
   compared in constant time. `MCP_USER_EMAIL` is accepted as a tenant alias for
   installs that already set it; a single-tenant file-backed install should set
   `MCP_TENANT_ID=local`, the tenant its stores use. The fallback is disabled
   whenever `DATABASE_URL` is set, so a stray env token cannot bypass
   revocation.
3. A missing, unknown, expired, revoked or scope-less token is **401**, never
   local-tenant data. `/mcp` also ignores the `pnpm dev` escape hatch
   (`LAVEGA_ALLOW_UNAUTHENTICATED`): its guard branch runs before it.

Create a token with the operator script (prints the raw token once):

```bash
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts create --user <better-auth-user-id> --label "cursor"
# list / revoke
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts list --user <better-auth-user-id>
DATABASE_URL=... pnpm tsx scripts/mcp-token.ts revoke --id <token-row-id>
```

The `--user` value is `auth.uid` — the same id the dashboard session uses, so
the token sees exactly that account's rows through the same tenant path.

## Protocol

| Item | Behaviour |
| --- | --- |
| Methods | `initialize`, `tools/list`, `tools/call` |
| Protocol versions | `2025-06-18` (preferred), `2025-03-26`; an unknown request version negotiates to `2025-06-18` |
| Session | server-issued `Mcp-Session-Id` UUID (one-day TTL, checked against the token identity); unknown/expired session on a later call is `404` |
| Notifications | request without `id` → `202`, empty body |
| Other methods | JSON-RPC `-32601` |
| Errors | JSON-RPC codes; parse `-32700`, invalid request `-32600`, invalid params `-32602`, internal `-32603` |

A tool failure is **result data**, not a transport failure:

```json
{ "result": { "isError": true, "structuredContent": { "error": "tool_failed", "hint": "…" } } }
```

No exception text, SQL, path or stack crosses the boundary.

## Tools

Read-only seed, all `scope: "read"`. `tools/list` is the truth; this block is
checked against the registry by
`apps/investing-server/src/tools/docs.test.ts`, so it cannot drift silently.

<!-- tool-registry:start -->

| Tool | Scope | Reads |
| --- | --- | --- |
| `get_positions` | read | Open holdings with weight, market value, cost basis and returns |
| `get_portfolio_value` | read | Latest total value point with its date |
| `get_trades` | read | Executed trades, newest first, at most 60 rows per call |
| `get_price` | read | One closing price, latest or on/before a date |
| `get_fundamentals` | read | Consent-gated company brief for one symbol |
| `get_sector_exposure` | read | Portfolio weight by sector, funds looked through |
| `get_risk` | read | Historical risk against the default benchmark (6M/1Y/All) |
| `get_agent_memory` | read | Risk tolerance, theses and goals stored for the owner |

<!-- tool-registry:end -->

Data semantics, inherited from the read models: money is a decimal amount in the
presentation currency (`1234.56`, not integer cents); weights and percentages are
fractions (`0.12` = 12%); an unknown magnitude is `null`, never `0` (ADR 0011);
trades are newest first; `truncated: true` in a read payload means the route's
own row cap cut it.

Why a read token cannot reach a write path — two independent gates:

1. The registry is filtered by the token's scopes, and `tools/call` looks the
   name up in the **same filtered array** `tools/list` returned. A write tool is
   not callable by name.
2. Every handler reads through a read-path allowlist
   (`apps/server/src/mcp/investingRead.ts`). Only GETs on the investing app's own
   read routes can leave the endpoint; a write path is refused before any
   request is made.

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
  action, per ADR 0012. There is no write tool and no write scope yet (WS5.4).
