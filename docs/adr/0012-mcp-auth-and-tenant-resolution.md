# ADR 0012 — MCP mount, bearer-token authentication and tenant resolution

## Status

Accepted 2026-11-10 (owner approved the MCP fast track; Phase 0 deliverable).

## Context

The Sure adoption plan adds an external agent surface (WS5): a read-first `/mcp` endpoint that
lets the owner's own agents query the investing dashboard. Sure implements this as a
JSON-RPC controller authenticated by a Doorkeeper OAuth bearer token or an env token, with one
coarse `read_write` scope.

LaVega's investing server does not have that auth path. `apps/investing-server` can run as a
standalone service and, without a database, resolves the local tenant through
`LOCAL_TENANT_ID`; it never mounts user authentication. `apps/server` already guards
`/api/*`, resolves the tenant from a verified session through AsyncLocalStorage, and is the
process that serves the investing app in the hosted deployment. A bearer-token client has no
session, so a `/mcp` route added naively to the investing server would either return 401 or
serve local-tenant data to the wrong caller.

The personal side is out of scope: the personal ledger stays encrypted client-side
(`ADR 0009`), and no server code decrypts it.

## Decision

1. **Mount `/mcp` in `apps/server`**, the same process that already owns auth, tenant
   resolution, rate limits and the investing mount. Do not expose `/mcp` on the standalone
   investing server, and do not let that server fall back to `LOCAL_TENANT_ID` for an
   authenticated request.
2. **Authentication is a bearer token**, not a cookie or session:
   - tokens are stored hashed (SHA-256) in `investing.api_tokens`, with `user_id`, `scopes`,
     `created_at`, `last_used_at`, optional `expires_at` and `revoked_at`; the raw token is
     shown once at creation;
   - a self-hosted install with no database can use `MCP_API_TOKEN` plus `MCP_USER_EMAIL` from
     the environment, compared in constant time;
   - missing, unknown, expired or revoked token => `401`, never a local fallback.
3. **Tenant resolution is token-first.** The endpoint resolves `auth.uid` (the user id) from
   the token row or the env mapping. It never trusts a header, query parameter or tool
   argument for tenancy. Every tool handler runs with that resolved user context, the same
   RLS path as the dashboard.
4. **Scopes are per token and per tool.** Initial scope: `read`. Write tools require a
   separate token with `write` scope, and remain off until WS5.4's preview/dry-run contract
   exists. A hidden tool is refused by name at dispatch, not only omitted from `tools/list`.
5. **Read-only first.** The fast-track tools are the existing read models: positions,
   portfolio value, trades, prices, fundamentals (consent-gated), sector exposure, risk
   summary, agent memory. No transaction, rule, budget, broker-credential or transfer write.
6. **Limits and audit.** Per-token rate limit, per-response row/byte cap, and an audit row per
   call (token id, tool, duration, outcome). AI spend is charged through the existing budget
   gate; MCP does not bypass it.
7. **Protocol and transport.** JSON-RPC 2.0 over HTTP, methods `initialize`, `tools/list`,
   `tools/call`; protocol version negotiation per MCP; a notification without `id` returns
   `202` and no body; errors follow JSON-RPC with a safe message (no SQL, no stack, no
   internal path).
8. **No cookies, no browser session, no CORS opening.** The endpoint is for machine clients.
   Personal vault tools are not reachable through this endpoint.

## Consequences

- A new auth surface exists, so it gets its own tests: valid token, missing token, expired
  token, revoked token, wrong scope, token for another tenant, notification handling, response
  caps.
- The self-hosted no-DB mode keeps a single-user env path; it is explicit and documented, not
  a silent default.
- A leaked read token can read one tenant's investing data until revoked. It cannot write,
  cannot reach the personal vault, and is rate-limited and audited.
- Adding write tools is a separate decision with a separate token and a new review; this ADR
  does not authorize them.
- The personal MCP/assistant path remains client-side and needs its own ADR if it ever moves
  server-side.
