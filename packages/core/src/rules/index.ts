/**
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * Rules evaluator v2 — public surface.
 *
 * Deliberately NOT exporting `categorize`: `views.ts` owns it, and a duplicate
 * star export from `packages/core/src/index.ts` would be ambiguous.
 */
export * from "./model.js";
export * from "./parse.js";
export * from "./compile.js";
export * from "./evaluate.js";
export * from "./dryrun.js";
