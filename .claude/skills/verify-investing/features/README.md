# Investing feature map

What a user can do on the investing side, how they reach it, and how to drive it from
`control-investing.mjs`. This map is the maintained source for verification: when a run
finds it wrong, fix the map in the same change. Each feature file states the English
labels a user sees, the CLI drive, what proves success, and when the check is
verified-unreachable (no credentials, no positions, or no Yahoo consent).

Screenshots: `browser screenshot --png /tmp/lavega-verify-investing/evidence/<name>.png`.
The CLI creates that directory. A repo path or `$TMPDIR` is `path-rejected`. Do not retry
a different folder.

The SPA lives at `/investing/` in production (`/` on the standalone server). The public
routes are `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`, `/forgot-password` and
`/reset-password`. The interface is in English.

Every other route (`/`, `/positions`, `/positions/:symbol`, `/net-worth`, `/agents`,
`/agents/:agentId`, `/profile`) sits behind `RequireAuth`. `/brokers/connect` redirects to
`/profile#brokers`. The top bar's tabs are exactly the modules the tenant's stored layout
enables, plus the always-on Overview tab. A `Personal` link beside that nav leaves this
app for LaVega Personal. It is not an investing route.

| Feature                                      | Route                                                                                             | File                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Account and session                          | `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`, `/forgot-password`, `/reset-password` | [auth-session.md](auth-session.md)                     |
| Dashboard overview                           | `/`                                                                                               | [dashboard-overview.md](dashboard-overview.md)         |
| Portfolio agents                             | `/`, `/agents`, `/agents/:agentId`                                                                | [portfolio-agents.md](portfolio-agents.md)             |
| Stock research                               | `/agents/research`                                                                                | [stock-research.md](stock-research.md)                 |
| Profile (brokers, modules, widgets, account) | `/profile`, `/brokers/connect` (redirect)                                                         | [broker-connect-sync.md](broker-connect-sync.md)       |
| Positions and position detail                | `/positions`, `/positions/:symbol`                                                                | [positions.md](positions.md)                           |
| Net worth                                    | `/net-worth`                                                                                      | [dashboard-overview.md](dashboard-overview.md)         |
| Prices, benchmarks and market-data consent   | `/` (Yahoo consent); chips on `/profile#status`                                                   | [prices-and-market-data.md](prices-and-market-data.md) |

Backing docs: `docs/investing/DASHBOARD.md` (layout, return definitions, chart modes),
`docs/investing/CONNECTORS.md` (broker adapters, credentials, disclosure gates),
`docs/investing/DOCKER.md` (self-host runtime and the vault).
