# Documentation

Start here. This index lists the documents that describe the current system.

## Core

| Document                  | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `CONTEXT.md`              | Product, privacy constraints, architecture, glossary and conventions |
| `BACKLOG.md`              | Open work and product decisions that are not yet GitHub issues       |
| `../PRODUCT.md`           | Product promise, users and copy rules                                |
| `../DESIGN.md`            | Investing design system                                              |
| `../DEPLOY.md`            | Vercel, Neon, migrations, secrets and release operations             |
| `agents/issue-tracker.md` | GitHub issue workflow                                                |

## Testing

| Document                      | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `testing/mutation-testing.md` | Mutation pilot for money and tax logic: scope, run, survivors |

## Decisions

`adr/` holds accepted architecture decisions. Read the relevant ADR before
changing storage, authentication, money handling, hosting or agent access.

## Domains

| Document               | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `investing/`           | Investing stack, dashboard, brokers, MCP and agents     |
| `n8n/`                 | Invoice ingestion workflows and operational setup       |
| `catalog/watchlist.md` | Dutch consumer money-product coverage                   |
| `metrics/`             | Measured program metrics                                |
| `provenance/sure.md`   | Third-party port ledger enforced by `check:attribution` |

## Current research

- `research/sure/` — pinned Sure source notes and attribution evidence.
- `research/2026-11-10-sure-teardown.md` — consolidated Sure assessment.
- `research/2026-11-18-assistant-chat-eval.md` — model choice for the assistant.
- `research/2026-11-22-catalog-model-bakeoff.md` — model choice for catalog sweeps.

## Historical material

Completed plans, dated review reports and one-off research snapshots were
removed to keep this tree current. Recover any file from Git history:

```bash
git log --all -- path/to/deleted-file.md
git show <commit>:path/to/deleted-file.md
```
