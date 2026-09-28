# Investing feature map

What a user can do on the investing side, how they reach it, and how to drive it from
`control-investing.mjs`. This map is the maintained source for verification: when a run
finds it wrong, fix the map in the same change. Each feature file states the English
labels a user sees, the CLI drive, what proves success, and when the check is
verified-unreachable (no credentials, no positions, or no Yahoo consent).

The SPA lives at `/investing/` in production (`/` on the standalone server). The public
routes are `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`, `/forgot-password` and
`/reset-password`. Every other route (`/`, `/positions`, `/positions/:symbol`,
`/agents/:agentId`, `/brokers/connect`) sits behind `RequireAuth`. The interface is in
English.

| Feature                                    | Route                                                                                             | File                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Account and session                        | `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`, `/forgot-password`, `/reset-password` | [auth-session.md](auth-session.md)                     |
| Dashboard overview                         | `/`                                                                                               | [dashboard-overview.md](dashboard-overview.md)         |
| Portfolio agents                           | `/` (agent card), `/agents/:agentId`                                                              | [portfolio-agents.md](portfolio-agents.md)             |
| Broker connect and sync                    | `/brokers/connect`                                                                                | [broker-connect-sync.md](broker-connect-sync.md)       |
| Positions and position detail              | `/positions`, `/positions/:symbol`                                                                | [positions.md](positions.md)                           |
| Prices, benchmarks and market-data consent | `/` (Vault / Cache panels)                                                                        | [prices-and-market-data.md](prices-and-market-data.md) |

Backing docs: `docs/investing/DASHBOARD.md` (layout, return definitions, chart modes),
`docs/investing/CONNECTORS.md` (broker adapters, credentials, disclosure gates),
`docs/investing/DOCKER.md` (self-host runtime and the vault).
