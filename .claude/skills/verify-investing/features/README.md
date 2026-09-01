# Investing feature map

What a user can do on the investing side, how they reach it, and how to drive it from
`control-investing.mjs`. This map is the maintained source for verification: when a run
finds it wrong, fix the map in the same change.

The SPA lives at `/investing/` in production (`/` on the standalone server) and its routes
are `/`, `/positions`, `/positions/:symbol`, `/brokers/connect` and `/sign-in`. Every route
except `/sign-in` sits behind `RequireAuth`, and the interface is in Dutch.

| Feature | Route | File |
| --- | --- | --- |
| Account and session | `/sign-in` | [auth-session.md](auth-session.md) |
| Dashboard overview | `/` | [dashboard-overview.md](dashboard-overview.md) |
| Broker connect and sync | `/brokers/connect` | [broker-connect-sync.md](broker-connect-sync.md) |
| Positions and position detail | `/positions`, `/positions/:symbol` | [positions.md](positions.md) |
| Prices, benchmarks and market-data consent | `/` (Kluis / Cache panels) | [prices-and-market-data.md](prices-and-market-data.md) |

Backing docs: `docs/investing/DASHBOARD.md` (layout, return definitions, chart modes),
`docs/investing/CONNECTORS.md` (broker adapters, credentials, disclosure gates),
`docs/investing/DOCKER.md` (self-host runtime and the vault).
