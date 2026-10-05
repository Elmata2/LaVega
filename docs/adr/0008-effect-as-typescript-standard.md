# 0008 — Effect as the TypeScript standard library

**Status:** Accepted.
**Date:** 5 October 2026.

## Why

LaVega's TypeScript is plain functions, Hono handlers and bare `Promise`s. As the
domain grows — investing math, broker adapters, agent loops, background work —
the same machinery is hand-rolled in each module: an error union here, a module
singleton for configuration there, an ad-hoc retry/timeout, a `try/finally` for
cleanup, no structured concurrency, no spans tying one request's work together.

Effect is the library that already solves those problems as one model:

- typed errors in the error channel (`Effect<A, E, R>`), composed and matched;
- dependency injection with `Context.Service` + `Layer`, so I/O seams stay
  testable without module singletons;
- resource safety via `Scope` and finalizers;
- structured concurrency, retries, schedules, streams;
- observability (logs, spans, metrics) that is on by default, not bolted on.

Effect **4.0** shipped 30 September 2026 (npm `effect@4.0.1`). It matters that it
is 4.x, not 3.x:

- **Zero runtime dependencies.** The core package pulls in no third-party code,
  so adopting it does not widen the supply-chain surface it exists to shrink.
- **Small and tree-shakeable.** A minimal program is ~7.1 kB min+gzip (5× smaller
  than 3.x), so a boundary that only needs `Effect.gen` + `Schema` pays for that.
- **One ecosystem, subpath exports.** `Schema`, `Layer`, `Stream`, `sql`, `ai`,
  `http`, `cluster`, `workflow` now live in `effect` itself under subpaths
  (`effect/schema`, `effect/ai`, …). One version, one lockfile entry.
- **Long-term support.** Bug and security fixes for 4.x until at least September
  2029 — a commitment we can plan against.

## Decision

**All new TypeScript code that carries logic uses Effect.** JSX/presentational
React is out of scope. "New code" means code written from now on; existing code
is **not** migrated in this change. When an existing file is edited for another
reason, port that file then.

Concretely, in every TypeScript workspace package:

- Import from `effect`: `import { Effect, Schema } from "effect"`.
- **Domain models and untrusted input go through `Schema`.** No hand-written
  predicates, no manual parsing. `Schema.Class` for models, `Schema.TaggedError`
  for typed failures.
- **Services are `Context.Service` with a static `layer`.** Implementations are
  `Layer` values; tests swap the layer, not the module.
- **Errors are values.** `Schema.TaggedError` classes, recovered with
  `Effect.catchTag` / `Effect.catchTags`; never `throw` across a boundary that
  a caller has to guess about.
- **Reusable effectful functions are `Effect.fn("name")(...)`** (or
  `Effect.fnUntraced` in hot paths / libraries). Do not write a function that
  only wraps and returns `Effect.gen`.
- **Runtime type guards come from `Predicate`.** Never re-implement `isRecord`,
  `isString`, `isObject`.
- **Dates and time use Effect's `DateTime`**, not raw `Date` / `Date.now`.
- **Entry points run through an Effect runtime.** Existing frameworks stay: a
  Hono handler obtains the app's `ManagedRuntime` and runs its program, so
  domain logic lives in Effect services and only the thin handler is imperative.

Effect is now a dependency of every TypeScript package: `@lavega/core`,
`@lavega/database`, `@lavega/adapters`, `@lavega/server`,
`@lavega/investing-server`, `@lavega/email-worker`, `@lavega/extension`,
`@lavega/web`, `@lavega/investing-web`.

### The vendored source is the reference

The Effect repository is vendored into this project as a git subtree under
`repos/effect` (squashed). Agents read it; application code never imports from
it. This is the Effect team's own advice for making agents write idiomatic
Effect: give them the real source, not prose.

- Read `repos/effect/LLMS.md` **before writing any Effect code**. It is the
  working guide for this project's style.
- Read `repos/effect/packages/effect/SCHEMA.md` before writing `Schema` code
  (large — read it in chunks).
- Executable examples live in `repos/effect/ai-docs/src/`, grouped by topic
  (`01_effect`, `03_stream`, `04_integration`, `40_sql`, `51_http-server`,
  `71_ai`, `80_cluster`, …). Prefer these over web search.
- `repos/effect` is **read-only**. Do not edit it, do not import from it, do
  not let oxlint/oxfmt/tsc walk it. Update it with
  `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash`.

The rules for agents are in `AGENTS.md` ("TypeScript: Effect").

## Consequences

- **Two styles coexist.** Untouched files stay plain TypeScript until they are
  ported. This is deliberate: a repo-wide migration would touch every screen and
  handler at once, and nothing here is caught by the current tests.
- **The vendored tree is 48 MB and a maintenance duty.** It is squashed into a
  single commit, excluded from lint, format, search and editor tooling, and
  refreshed with one `git subtree pull`.
- **`pnpm-workspace.yaml` gains `effect@4.0.1` in `minimumReleaseAgeExclude`.**
  pnpm's supply-chain policy quarantines brand-new releases; the entry is what
  lets the pin install at all.

## What it costs

- **Effect is a paradigm, not a helper.** `Effect.gen` generator style, the
  error channel, and `Layer` composition are a real learning curve. The vendored
  source and `LLMS.md` exist to flatten it for both humans and agents.
- **Coexistence is confusing.** Until a module is ported, a reader switches
  between two idioms. Keep the Effect boundary at the service/entry-point layer.
- **Bundle cost is real but bounded.** Frontend packages carry the dependency;
  only code that actually uses Effect is bundled, and 4.x tree-shakes. Do not
  pull `effect` into a component that does not need it.
- **`exactOptionalPropertyTypes` is recommended by Effect but not enabled.**
  Turning it on repo-wide would break existing code, so it is deferred to a
  dedicated change. Effect works without it.
- **This sits next to "build the simplest thing".** `docs/CONTEXT.md` warns
  against abstractions for cases that cannot happen. Effect is adopted where it
  _replaces_ recurring hand-rolled machinery (typed errors, DI, retries,
  resources, tracing) — not for one-off scripts that a single function serves.
