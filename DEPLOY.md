# Deploy — Railway + `lavega.dev` (all-in-one)

One Hono service serves both the API (`/health`, `/api/rates`, later `/api/eb/*`)
and the built web app (`apps/web/dist`). Your financial data stays in the
browser's encrypted vault — the server is a thin proxy (public rates + the
Enable Banking OAuth exchange), it never stores your accounts/transactions.

## What's already wired
- `railway.json` — Nixpacks build (`pnpm install --frozen-lockfile && pnpm build`),
  start (`pnpm start`), health check on `/health`.
- Root `build` = build the web SPA; root `start` = run the Hono server (tsx),
  which serves `apps/web/dist` + the API. `PORT` is read from the environment
  (Railway sets it automatically).

## Deploy steps
1. Make sure the repo is pushed to GitHub (`Elmata2/LaVega`).
2. Railway → **New Project → Deploy from GitHub repo** → pick `LaVega`.
   Railway reads `railway.json` automatically — no manual build/start config needed.
3. In Railway, open the deployed service and choose **Settings → Networking →
   Custom Domain**. Add `lavega.dev`.
4. Railway will show the DNS target for the domain. In Cloudflare →
   **lavega.dev → DNS → Records**, create the record Railway requests:
   - Type: `CNAME`
   - Name: `@`
   - Target: the Railway target shown in the Custom Domain screen
   - Proxy status: **DNS only** (grey cloud) until Railway has issued its TLS
     certificate; Cloudflare may be enabled afterwards if desired.
5. Return to Railway and wait for the custom domain to become **Active**. Railway
   manages the origin certificate. In Cloudflare, set **SSL/TLS encryption mode**
   to **Full (strict)** before enabling the proxy.

   Optional: add `www.lavega.dev` as a second Railway custom domain, then create
   the matching `CNAME` record in Cloudflare. Pick one canonical hostname and
   redirect the other at Cloudflare if you use both.

   Railway's generated `*.up.railway.app` hostname can remain enabled for
   troubleshooting, but do not use it in public integrations.
6. Verify:
   - `https://lavega.dev/` → landing
   - `https://lavega.dev/app` → personal vault (Overzicht)
   - `https://lavega.dev/app/transactions` → Transacties (same for other modules)
   - `https://lavega.dev/health` → `{"ok":true}`
   - `https://lavega.dev/api/rates` → the live savings-rate JSON
   - Landing + app topnav show **Investing** → `VITE_INVESTING_URL` or `/investing`

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

Investing link: set Railway/build env `VITE_INVESTING_URL` to the investing host
(e.g. `https://investing.lavega.dev`) if it is not served at `/investing` on the
same origin.

## Environment variables (Railway → Variables)
- `PORT` — set by Railway automatically; don't hardcode.
- (Enable Banking, next phase) `EB_APPLICATION_ID`, and the private key. Never
  commit the `.pem` — add it as a Railway variable/secret or a mounted volume.
  `config.json`, `*.pem`, `.env*` are git-ignored.

## Enable Banking (flow is built — needs credentials)
The `/api/eb/*` flow (aspsps → auth → callback → accounts) and the frontend
"Koppel bank" button are implemented. To switch it on, register the EB app and
set these Railway **Variables**:

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
