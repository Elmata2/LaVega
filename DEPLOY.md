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

## Enable Banking (after the domain exists)
The public HTTPS domain is what EB needs for the redirect. Once deployed:
1. Register the app in the Enable Banking dashboard.
2. Set the redirect URL to `https://<name>.up.railway.app/api/eb/callback`.
3. Put `EB_APPLICATION_ID` + the `.pem` into Railway.
4. Then we finish the flow (bank picker → authorise → callback → fetch
   accounts+txs → into your vault). Sandbox first.

## Local production test
```
pnpm build      # builds apps/web/dist
pnpm start      # Hono serves web + API on http://localhost:8787
```
(For day-to-day dev keep using `pnpm dev` + `pnpm dev:server`.)
