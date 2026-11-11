# Sure research notes

Raw research notes for the Sure adoption program. They are inputs, not decisions:

- [`00-core-domain.md`](./00-core-domain.md) — accounts, entries, transfers, rules, bills,
  budgets, reports, imports, FX, goals, sync. Personal-CFO focus.
- [`01-investing.md`](./01-investing.md) — investment model, holdings, trades, cost basis,
  materializers, portfolio math, market data, connectors.
- [`02-platform-ai.md`](./02-platform-ai.md) — assistant, tool-calling loop, MCP tool
  inventory, API v1, import/export interop, statement vault, platform ops.
- [`03-lavega-state.md`](./03-lavega-state.md) — what LaVega has today, capability matrix vs
  Sure, integration seams, top gaps, unverified list.

Consolidated result: [`../2026-11-10-sure-teardown.md`](../2026-11-10-sure-teardown.md).
Plan: [`../../superpowers/specs/2026-11-10-sure-adoption-plan.md`](../../superpowers/specs/2026-11-10-sure-adoption-plan.md).

## Scope correction (2026-11-10)

Owner confirmed there is **no live Maybe/Sure instance and no historical export**. The
old-history migration track is removed from the plan and the issues. The export/import
material in `02-platform-ai.md` §4 stays as a format reference only; do not build a
migration importer without a new, explicit request. Generic CSV/Excel import for new files
is still in scope (plan WS3.6).

## Source and method

- Repository: [`we-promise/sure`](https://github.com/we-promise/sure), community fork of
  Maybe Finance. AGPL-3.0.
- Pinned commit: `562fe096d149cb4d1fb1e6d3446527572c1ec7f6` (2026-11-10).
- Clone: local, shallow, outside the tracked tree (`/tmp/sure` for this research). Never
  imported by build or test. Fetch with `scripts/fetch-sure-reference.sh` when that script
  lands in Phase 0.
- Method: static reading only. No Rails server, bundle, Docker, database, or test suite was
  run. Every claim is code/schema/doc evidence with `path:line` citations; inferences are
  marked as such. "Unverified" is called out per note.

## Ground rules for anyone editing these notes

1. Cite the pinned commit, not `main`. Sure is a moving development tree.
2. Do not paste Ruby code into LaVega app code. These notes are the bridge; the plan defines
   the reimplementation shape and attribution.
3. Keep the sign convention visible: Sure stores outflow positive; LaVega stores outflow
   negative. A ported formula without a direction comment is wrong.
4. When a note contradicts newer code reading, update the note. This directory is a live
   research record, not a snapshot.
5. Never paste real financial data (IBANs, names, counterparties, exact amounts) into this
   repo, a fixture or a commit. Scrub exports before use; keep local real-data artifacts
   gitignored. The binding rules, the keep/replace table and the gitignored paths are in
   `docs/superpowers/specs/2026-11-10-sure-adoption-plan.md` §2.6.
6. Say "independent reimplementation", not "clean-room". The reuse method reads Sure's Ruby
   and tests.
