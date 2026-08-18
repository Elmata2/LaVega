# Lavega



## Agent skills

When you are using a research agents, you can downscale to the cheapest model for the fetching etcetera, otherwise it cost a lot of tokens that we can better use elsewhere.

Only report to me in ASD-STE100 Simplified Technical English

If possible always try to write or use the cli/bash commands instead of a (bloated) MCP

When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision.

When you are over 50% of the context window, create a new chat to continue the project to stay in the smart window of the ai agent.

Do not be lazy! if you need to use/check it with the database, do check it and do not go of standard/old caches

When you are using or interacting anything with ui, check the skills of Emil Kowalski:
emil-design-eng — The main skill that consists of mostly animation, but also some design advice.
animate — Builds an animation from scratch while choosing the correct curve, duration, properties, and so on.
review-animations — Review your animations in a strict way, based on my rules.
improve-animations — Audit all the animations in your codebase and get prioritized, self-contained plans that any agent can execute.
find-animation-opportunities — Search your UI for places that would genuinely benefit from motion, while also telling you what not to animate.
animation-vocabulary — Get better animations from an AI by telling it exactly what you want by using the right words.
apple-design — Apple’s principles for interface design and fluid motion, distilled from their WWDC design talks and translated for the web.
pick-ui-library — Have your agent pick the right library for the task based on libraries I use and trust, instead of letting AI hand-roll a toast component or install an abandoned package.
prototype — Build multiple different versions of a UI piece you describe and go through them using a switcher.
ask-sonner — Your guide to working with Sonner, my toast library. Contains setup, styling, recipes, and fixes for the most common issues.

### Issue tracker

Issues live as GitHub issues in `Elmata2/lavega`, driven through the `gh` CLI.

When you finish a Github Issue, commit and push it to main, with a summary of the changes.
You can use the /caveman-commit skill for that, to create a dense but thoughtful summary 

When issues are solved in github, we will provide a short summary of what our changes are doing inside the repo
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


Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.