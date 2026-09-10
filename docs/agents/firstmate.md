# Firstmate (crew orchestration)

[firstmate](https://github.com/kunchenguid/firstmate) lives as a git submodule at `tools/firstmate` (pinned commit in the parent repo). It is an agent distro: launch a primary harness from that directory and talk to one first mate; it spawns crewmates in tmux (default) with isolated git worktrees.

LaVega is wired as project **`lavega`** via a local symlink (`tools/firstmate/projects/lavega` → repo root). That path is gitignored inside the submodule; run setup after clone.

## Requirements

- `git`, `gh auth login`
- Primary harness: Claude Code, Pi, Codex, omp, or Grok
- `tmux` (default backend) or another backend from [firstmate docs](../../tools/firstmate/docs/configuration.md)

## First-time / fresh clone

```bash
git submodule update --init tools/firstmate
./tools/setup-firstmate.sh
```

## Launch

```bash
./tools/firstmate-launch.sh claude
# or: pi | codex | omp | grok
```

Or manually:

```bash
cd tools/firstmate
claude   # or pi, codex, omp, grok --trust
```

On first Pi launch in this checkout, approve project trust so `.pi/extensions/` load.

Then talk to the first mate, e.g.:

> ahoy! on project lavega, fix issue #123

## Update firstmate

```bash
git submodule update --remote tools/firstmate   # move pin
# or inside a session: /updatefirstmate
```

## Notes

- Firstmate `AGENTS.md` replaces the harness system prompt in the **firstmate session only**. LaVega root `AGENTS.md` still applies in Cursor and direct repo sessions.
- Operational state (`state/`, `data/`, `config/`) stays under `tools/firstmate/` and is gitignored there.
- Ship mode for LaVega defaults to firstmate `no-mistakes` until you add a repo-root `.no-mistakes.yaml` or register another mode. See `tools/firstmate/docs/architecture.md`.
