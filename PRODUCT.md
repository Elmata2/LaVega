# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: self-directed retail investor who holds positions across several brokers (Trading 212, Interactive Brokers, DeGiro) and wants one read-only overview plus a second opinion on their own holdings. Works at a desk, in sessions of review and research, not day-trading.

Secondary: multi-BV owner consolidating bank accounts across entities into one overview (personal side, `apps/web`).

Extension audience: Dutch shoppers at checkout (extension copy is Dutch).

## Product Purpose

LaVega is a local-first, privacy-first personal finance agent, a "financial company brain". The investing side syncs broker data read-only, shows positions, activity and returns, and runs AI portfolio agents that give typed judgments. Success: user trusts the numbers and acts on a clear view of what they own and why.

## Positioning

Local-first (data stays on the machine or in an encrypted vault, read-only broker and bank access, no payment initiation, self-hostable, AGPL-3.0) combined with typed AI judgment: agents return structured judgments tied to the user's own thesis for each holding, not free-form advice. A neighbor hosting your data in the cloud cannot truthfully claim the first; a generic chat wrapper cannot claim the second.

## Operating Context

- Broker sync (Trading 212, IBKR, DeGiro) is slow (minutes) and can be partial; unknown figures must show as unknown, with the reason, never as zero.
- Prices default to Yahoo Finance locally; Trading 212 history can be incomplete.
- Investing dashboard is live at lavega.dev/investing, authenticated.
- Shipped surfaces today: investing-web dashboard, site (marketing), extension (checkout points). `apps/web` (personal vault) is not confirmed as shipping.

## Capabilities and Constraints

- Hard: no FinnTell reuse; privacy by default; read-only access, no payment initiation; secrets never in repo.
- Glossary (see `docs/CONTEXT.md`): Position detail, Activity, Quantity history, Closed position, Thread, Thesis, Dormant thesis, Goal, Observation. Use these terms in UI copy.
- A user confirms and edits a thesis but cannot delete it on its own.
- Agents: six investor personas (Analyse card, one typed judgment each) and per-persona chat threads; single-company research at `/investing/agents/research`.
- Undecided: public commercial/hosted path; whether the personal vault app ships.

## Brand Commitments

Name LaVega; wordmark asset `LaVega_wordmark_hires_white.png` at repo root. No other brand rules confirmed.

## Evidence on Hand

Product docs in `docs/` (CONTEXT, `docs/investing/*`). Extension rate data in `docs/catalog/staging-points.json`, with source and date per line. No customer testimonials, user counts or benchmarks on hand; do not fabricate.

## Product Principles

1. Honest numbers: unknown shows as unknown with a reason; never a silent zero or a stale cache.
2. Privacy is the default, not a setting: read-only, local-first, nothing tracked.
3. Judgment is typed and traceable to the user's own thesis, not free-form advice.
4. Built for the user's own data first; commercialize only when it works on it.
5. One shared vocabulary (thesis, activity, closed position) across UI, docs and agents.

## Accessibility & Inclusion

No product-specific requirement established. Extension copy is Dutch; other surfaces language not confirmed.
