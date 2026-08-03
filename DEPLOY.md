# Deploy — Railway (all-in-one)

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
3. After the first deploy, **Settings → Networking → Generate Domain** →
   you get `https://<name>.up.railway.app`.
4. Verify:
   - `https://<name>.up.railway.app/` → the app loads
   - `.../health` → `{"ok":true}`
   - `.../api/rates` → the live savings-rate JSON

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
- `EB_REDIRECT_URL` — `https://lavegaweb-production.up.railway.app/api/eb/callback`
- `EB_PSU_TYPE` — `business` (or `personal`)

In the Enable Banking dashboard, register the app (start in **Sandbox**) with:
- Redirect URL: `https://lavegaweb-production.up.railway.app/api/eb/callback`
- Privacy: `https://lavegaweb-production.up.railway.app/privacy`
- Terms: `https://lavegaweb-production.up.railway.app/terms`

Until configured, the EB endpoints return `503 "nog niet geconfigureerd"` and
the app still works with file imports. Never commit the `.pem` — use the env var.

## Local production test
```
pnpm build      # builds apps/web/dist
pnpm start      # Hono serves web + API on http://localhost:8787
```
(For day-to-day dev keep using `pnpm dev` + `pnpm dev:server`.)
