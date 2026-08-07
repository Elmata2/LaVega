# Lavega



## Agent skills

When you are using a research agents, you can downscale to the cheapest model for the fetching etcetera, otherwise it cost a lot of tokens that we can better use elsewhere.

Only report to me in ASD-STE100 Simplified Technical English

If possible always try to write or use the cli/bash commands instead of a (bloated) MCP

### Issue tracker

Issues live as GitHub issues in `Elmata2/lavega`, driven through the `gh` CLI.


### Triage labels

Five canonical triage roles, used with their default label strings.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: `CONTEXT.md` at the root plus `docs/adr/`, both created lazily.
See `docs/agents/domain.md`.

### Monorepo

[Turborepo](https://turbo.build) + Bun workspaces. `apps/*` for deployables (MCP server,
web UI, macOS daemon); `packages/*` for shared libraries and config. Root scripts:
`bun run build`, `bun run dev`, `
bun run lint`, `bun run test`, `bun run typecheck`.
