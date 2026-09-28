# Investing feature map

What a user can do on the investing side, how they reach it, and how to drive it from
`control-investing.mjs`. This map is the maintained source for verification: when a run
finds it wrong, fix the map in the same change.

Prove the dev portfolio on `--target preview` after `login`, not on the empty local
server. The login is `LAVEGA_VERIFY_EMAIL` / `LAVEGA_VERIFY_PASSWORD` in the agent
environment, or `auth.preview.json`. A Vercel env var is not that login.

The SPA lives at `/investing/` in production (`/` on the standalone server). The interface
is English. Public routes: `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`,
`/forgot-password`, `/reset-password`. Every other route sits behind `RequireAuth`: `/`,
`/positions`, `/positions/:symbol`, `/agents/:agentId` and `/brokers/connect`.

| Feature                                    | Route                                          | File                                                   |
| ------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| Account and session                        | `/sign-in`                                     | [auth-session.md](auth-session.md)                     |
| Dashboard overview                         | `/`                                            | [dashboard-overview.md](dashboard-overview.md)         |
| Broker connect and sync                    | `/brokers/connect`                             | [broker-connect-sync.md](broker-connect-sync.md)       |
| Positions and position detail              | `/positions`, `/positions/:symbol`             | [positions.md](positions.md)                           |
| Prices, benchmarks and market-data consent | `/` (Yahoo Finance consent, Cache chip)        | [prices-and-market-data.md](prices-and-market-data.md) |
| Portfolio agents                           | `/` (Investor lens), `/agents/:agentId`        | [portfolio-agents.md](portfolio-agents.md)             |

Backing docs: `docs/investing/DASHBOARD.md` (layout, return definitions, chart modes),
`docs/investing/CONNECTORS.md` (broker adapters, credentials, disclosure gates),
`docs/investing/DOCKER.md` (self-host runtime and the vault). `DASHBOARD.md` still says
the UI text is Dutch; the SPA in `apps/investing-web` is English.
