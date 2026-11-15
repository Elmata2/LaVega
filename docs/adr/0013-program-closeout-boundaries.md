# ADR 0013 — Sure-program closeout boundaries and the export contract

## Status

Accepted 2026-11-11 (program closeout, issue #302). Records decisions already made in the
plan and its Phase 0 audit; it does not open new scope.

## Context

The Sure adoption program (plan §3) ends at phase 6. Four boundary questions were carried
from the start and must not disappear with the program:

1. whether personal ledger data ever becomes server-readable for MCP/API tools;
2. whether family/household sharing ships;
3. what shape the budget product keeps;
4. whether Sure is ever run (locally or otherwise) instead of only read as a port source.

The closeout also adds a portability artifact (WS6.1): a plain ZIP/NDJSON/CSV export the
owner builds in the browser. That artifact creates a new boundary question of its own —
what leaves the vault in plaintext, and who guarantees it can be read back.

## Decision

1. **The personal MCP/API boundary is unchanged and stays with ADR 0009 + ADR 0012.** No
   server code decrypts the personal vault; the `/mcp` surface remains the investing
   read-first surface with token → tenant resolution. Personal agent tooling stays
   client-side or deferred. A future server-readable personal ledger needs a new ADR, not a
   quiet exception in an export route.
2. **Family/household sharing does not ship.** It waits for a key-ownership ADR: the vault
   key belongs to one account today (ADR 0009), and sharing without a per-member key model
   would either expose the whole vault or fork it.
3. **The budget product keeps the envelope + signed carry shape** decided in plan §9 #4:
   period envelope, per-line allocation, surplus-only carry, bills reserved read-only. The
   core math is `packages/core/src/budget.ts`; no second budget product is added.
4. **Sure stays a port source, never a runtime.** No local Sure deployment is run for product
   features: no Rails server, database, Docker or sidecar. The pinned reference clone
   (`scripts/fetch-sure-reference.sh`, commit `562fe09`) lives outside the tracked tree and is
   never imported by build or test. `NOTICE` and Appendix A carry the attribution.
5. **The export is owner-initiated, plaintext and browser-built; the server never sees it.**
   `packages/core/src/interop/export.ts` produces a versioned (`lavega-export` v1) ZIP with a
   manifest and NDJSON/CSV companions. It excludes sealed document bytes, credentials, the
   encrypted vault, the adviser profile, plan preferences, learned facts/events and the n8n
   queue — the manifest states each absence. Readback (`readLavegaExport`) is the acceptance:
   the writer's bytes are parsed back, CRC-checked and count-checked; a download alone proves
   nothing. No importer and no cross-format dedupe promise ship with it. A re-import would be
   a new slice with its own identity rules.

## Consequences

- The owner can take their ledger out of LaVega as readable data without changing the privacy
  boundary: the plaintext exists only in their browser and in the file they ask for.
- The eight live-vault metrics (forecast error, transfer rate, uncategorized share, statement
  coverage, realised-gain reconciliation, MCP usage, AI spend, time-to-close) remain
  owner-pending (#303). The program records fixture aggregates and names the rest; it does not
  estimate them.
- A future importer must add an identity/dedupe ADR before it claims idempotent import; the
  export manifest deliberately promises nothing about it.
