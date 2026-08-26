# Deploy — Vercel + Neon + `lavega.dev`

Vercel serves the web application and Hono API. Neon project `lavega`
(`royal-surf-52181032`) stores future authenticated application data in separate
`personal` and `investing` schemas. Personal vault data must be encrypted before
storage. Better Auth integration remains pending.

## What's already wired
- `vercel.json` — Vercel build command, SPA rewrites, and API function entrypoint.
- `db/migrations/0001_lavega.sql` — applied to Neon. Creates six tables and six
  RLS policies. Database is empty.
- `docs/adr/0004-neon-data-boundaries.md` — personal/investing data boundary.
- Runtime Neon adapters and Better Auth are not wired yet.

## Deploy steps
1. Vercel project `lavega` uses repository `Elmata2/LaVega`.
2. Vercel reads `vercel.json` and runs the configured build command.
3. Add `lavega.dev` under Vercel **Settings → Domains**.
4. Configure DNS using the target Vercel provides:
   - Type: `CNAME`
   - Name: `@`
   - Target: the Vercel target shown in the Domains screen
   - Proxy status: **DNS only** (grey cloud) until Vercel has issued its TLS
   certificate; Cloudflare may be enabled afterwards if desired.
5. Add Neon connection variables only after runtime adapters and authentication
   are implemented. Never put connection strings in repository files.

   Optional: add `www.lavega.dev` as a second Vercel domain, then create
   the matching `CNAME` record in Cloudflare. Pick one canonical hostname and
   redirect the other at Cloudflare if you use both.

   Vercel's generated hostname can remain enabled for troubleshooting, but do
   not use it in public integrations.
6. Verify:
   - `https://lavega.dev/` → landing
   - `https://lavega.dev/app` → personal vault (Overzicht)
   - `https://lavega.dev/app/transactions` → Transacties (same for other modules)
   - `https://lavega.dev/health` → `{"ok":true}`
   - `https://lavega.dev/api/rates` → the live savings-rate JSON
   - Landing + app topnav **Investing** → `https://lavega.dev/investing/` (built in)

Personal app paths (SPA; server already serves `index.html` for unknown paths):

| Path | View |
| --- | --- |
| `/app` or `/app/overview` | Overzicht |
| `/app/transactions` | Transacties |
| `/app/accounts` | Rekeningen |
| `/app/forecast` | Forecast |
| `/app/optimalisatie` | Optimalisatie |
| `/app/valuta` | Valuta |
| `/app/punten` | Punten |
| `/app/belasting` | Belasting |
| `/app/facturen` | Facturen |
| `/app/profiel` | Profiel |
| `/app/koppelingen` | Koppelingen |
| `/app/backup` | Back-up |

Legacy `/#app` and `/?eb=…` still open the app (rewritten to `/app`).

## Investing dashboard (same deploy)

The production `Dockerfile` also builds `apps/investing-web` and mounts it on the
personal server:

- UI: `https://lavega.dev/investing/`
- API: `/api/investing/*`, `/api/brokers/*`, `/api/prices/*`, `/api/market-data/*`
- Health probe for the link: `/investing/health`

The personal SPA link is baked as `VITE_INVESTING_URL=/investing`. To point at a
separate investing host instead, set a Vercel build variable
`VITE_INVESTING_URL=https://investing.lavega.dev` and redeploy.

Do not use filesystem persistence on Vercel. Neon persistence requires the
authenticated runtime adapters described in the Neon ADR.

## Environment variables (Vercel → Settings → Environment Variables)
- `DATABASE_URL` — Neon connection string, server-only. Add after auth and
  runtime adapters are wired.
- `PORT` — local server only. Vercel assigns its own runtime port.
- (Enable Banking, next phase) `EB_APPLICATION_ID`, and the private key. Never
  commit the `.pem` — add it as a Vercel secret or a mounted local file.
  `config.json`, `*.pem`, `.env*` are git-ignored.

## Enable Banking (flow is built — needs credentials)
The `/api/eb/*` flow (aspsps → auth → callback → accounts) and the frontend
"Koppel bank" button are implemented. To switch it on, register the EB app and
set these Vercel **Environment Variables**:

- `EB_APPLICATION_ID` — your Enable Banking application id
- `EB_PRIVATE_KEY` — the PEM private key, inline (paste the whole key; literal
  `\n` is accepted). Alternatively `EB_PRIVATE_KEY_FILE` pointing at a mounted file.
- `EB_REDIRECT_URL` — `https://lavega.dev/api/eb/callback`
- `EB_PSU_TYPE` — `business` (or `personal`)

In the Enable Banking dashboard, register the app (start in **Sandbox**) with:
- Redirect URL: `https://lavega.dev/api/eb/callback`
- Privacy: `https://lavega.dev/privacy`
- Terms: `https://lavega.dev/terms`

Until configured, the EB endpoints return `503 "nog niet geconfigureerd"` and
the app still works with file imports. Never commit the `.pem` — use the env var.

## Local production test
```
pnpm build      # builds apps/web/dist
pnpm start      # Hono serves web + API on http://localhost:8787
```
(For day-to-day dev keep using `pnpm dev` + `pnpm dev:server`.)
