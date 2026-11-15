# API session guard

Every `/api/*` route is closed unless it is on the public list or the request carries a verified better-auth session. A stranger with `curl` gets `401 {"error":"unauthorized"}`; the login screen's own feeds still answer.

## Sub-features

- `guard-closed` every non-public route answers 401 without a session on a closed target.
- `guard-public` `/api/agent/status`, `/api/eb/status`, `/api/rates`, `/api/fx/rate`, `/api/auth/*`, `/api/eb/callback` answer without a session.
- `guard-open-dev` with `LAVEGA_ALLOW_UNAUTHENTICATED=1` (what `up` and `pnpm dev` set) nothing answers 401.
- `guard-signup-open` registration is open. A session is issued only after the address is confirmed. `/api/auth/sign-up/email` is limited to 5 requests per IP per 10 minutes.

## How to get to it (user POV)

- Any `/api/*` call from the app while signed out, or `curl https://www.lavega.dev/api/vault/backup`.
- Sign-up form at `/app` when auth is configured.

## Driving it with control-lavega + browser

Preconditions:

- Local instance up (guard open) and network access to `https://www.lavega.dev` (guard closed).

- **Closed posture on prod.** Run `node .claude/skills/verify-lavega/control-lavega.mjs guard --target prod --out /tmp/lavega-verify/evidence/guard-prod.json`. All eight guarded rows show `401`, all four public rows `200`, exit code `0`.
- **Open posture locally.** Run `node .claude/skills/verify-lavega/control-lavega.mjs guard --out /tmp/lavega-verify/evidence/guard-local.json`. No row is `401`; agent routes answer `503` (dark), `DELETE /api/account/data` answers `404` (no Neon), exit code `0`.
- **Preview deploy.** Run `... guard --base https://<preview>.vercel.app`. Same expectations as prod.
- **Sign-up open.** `POST /api/auth/sign-up/email` accepts a new address. The response has `token: null` until the person confirms the mail. A sixth signup from the same IP inside 10 minutes is refused.
- **Proof.** The two `--out` JSON files plus the exit codes. Both files carry `closed: true|false` and one row per route.

## Gotchas

- Locally without `DATABASE_URL` the vault and account routes are not registered, so `/api/vault/backup` falls through to the SPA and returns `200` HTML. That is why the local expectation is "not 401", not "200 JSON".
- `OPTIONS` preflights pass the guard by design; do not count an `OPTIONS 204` as a hole.
- `/api/card-terms/ingest` is public but carries its own shared secret; a `503` there means the token is unset, not that the guard failed.
