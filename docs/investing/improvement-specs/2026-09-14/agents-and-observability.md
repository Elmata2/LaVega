# Portfolio agents and observability specifications

Reviewed against `master` at `7a566c4`. Read [README.md](README.md) first. Source paths below are repository-relative; line numbers identify this baseline. These specifications request implementation, not changes made by this review.

## AG-01 — Make portfolio-agent facts and model results trustworthy

**Priority:** P1. **Recommendation:** Strong. **Evidence:** confirmed mapping and validation defects; timeout behavior is a resilience gap.

### Evidence and reproduction

- `apps/investing-server/src/portfolioAgent.ts:344` writes `dashboard.allocation.entity.buckets` into `sectors`. An agent therefore receives entity names (private/business) presented as industry sectors.
- Actual sector classification already exists in `apps/investing-server/src/app.ts:237-252`, through sector-profile storage and `buildSectorExposure`. Do not create a second classification rule.
- `portfolioAgent.ts:353-384` normalizes arbitrary parsed JSON into an insight. A response such as `{}` becomes a completed result with empty summary/reasoning, neutral signal and zero confidence. Invalid signals silently become neutral, confidence is clamped, and object-valued insights become `[object Object]`. This masks invalid output as valid analysis.
- `portfolioAgent.ts:276-282` calls AI SDK `generateText` with no explicit abort deadline. Eight tool steps bound count, not elapsed time. `index.ts:785-793` already checks prompt/model string types, but malformed JSON becomes a default request and unknown persona falls back to Buffett.

### Intended change

Deepen the portfolio-agent module around one execution interface: validated request + immutable portfolio snapshot + selected persona -> validated insight or typed failure. Keep OpenRouter HTTP as an adapter. Snapshot construction owns domain meanings; model execution owns tool dispatch, turn/time budgets and output decoding. Avoid separate tiny wrappers around each JSON property.

1. Give entity allocation its own truthful name. Resolve sector exposure through the existing sector-profile module, or explicitly mark sector data unavailable. Unknown sector must never become a guessed industry. Share sector resolution with the risk-summary route rather than duplicating provider calls.
2. Preserve unavailable price, return and basis states. A null is not zero, and estimated data retains its status. Label snapshot coverage in the model input.
3. Retain existing string checks; reject malformed JSON and unknown explicitly supplied persona IDs before model work. Omitted fields may retain defaults. Add documented request-length limits; retain model override behavior and default `inclusionai/ling-3.0-flash-fin:free`.
4. Decode the existing result schema: nonempty summary/reasoning, string insights, finite confidence in 0–100, and allowed signal enum. Reject malformed results with a stable problem code; do not persist or render them as completed. A bounded repair attempt is optional, not required. Do not add a per-holding result schema as part of this fix.
5. Pass an absolute execution budget through AI SDK's supported abort mechanism and tool rounds. Abort on expiration and return a typed timeout. Retain existing eight-step ceiling when tools are supplied and read-only portfolio tools.

### Acceptance

- Fixture with entity `private` and sector `Technology` sends each under its correct field. Missing profile produces Unknown/unavailable, never `private` as a sector.
- `{}`, invalid signal, confidence outside declared range, object-valued summary, and non-string insights all produce controlled failure.
- Valid provider response still returns configured model, persona and unchanged portfolio values. Provider-fake tests inspect request body without calling OpenRouter.
- A never-resolving fake provider observes abort at the configured deadline; no subsequent tool round runs.
- Malformed JSON and unknown explicit persona are rejected before snapshot/model side effects. Existing `portfolioAgent.test.ts` scenarios continue passing.

**Ownership:** `portfolioAgent.ts`, its tests, relevant request validation in `index.ts`, and extracted shared sector-resolution module. Coordinate `R7` before editing run persistence. `UI-02` consumes resulting problems but can proceed with stable existing response shape. Financial fixes FIN-* determine input quality; this spec must preserve their metadata, not recompute finance in the agent module.

**Non-goals:** trade execution, autonomous portfolio changes, new persona/model selection, durable conversation history, streaming, new fundamental-data feed.

**Depth / deletion test:** moving JSON parsing alone only moves complexity. Owning the complete snapshot-to-insight contract concentrates validation and execution policy behind one seam. Locality improves for model changes; leverage reaches overview and conversation consumers. Existing sector adapter should be reused, not generalized for hypothetical providers.

## AG-02 — Restore investing runtime portability

**Priority:** P2; immediate verification unblock. **Recommendation:** Strong. **Evidence:** reproduced failing architecture test.

`apps/investing-server/src/portfolioAgent.ts:3` imports `createHash` from `node:crypto`; `portfolioSnapshotHash` uses it at line 409. `packages/adapters/src/architecture/import-boundaries.test.ts:212` rejects the transitive Node import from the investing runtime. Targeted run reproduces exactly this violation. Runtime tests passing under Node do not establish portable execution.

Replace direct Node hashing with Web Crypto SHA-256 available to both target runtimes. Make hashing asynchronous, update its callers and tests, and preserve serialized input plus existing first-24-hex-character format so snapshot identities do not change gratuitously. If an adapter is injected for tests, keep its interface minimal and do not introduce a generic cryptography framework. Do not exempt the import from the architecture test.

**Acceptance:** identical snapshot input produces the same SHA-256 digest as before; changed input changes digest; portfolio-agent tests pass; `pnpm --filter @lavega/adapters exec vitest run src/architecture/import-boundaries.test.ts` passes with the guard intact. Typecheck the affected runtime.

**Ownership/dependencies:** `portfolioAgent.ts` overlaps AG-01; land AG-02 first or assign both to one agent. No schema or user-facing change. This is a dependency repair, not justification for a new module: retain the existing snapshot interface and portable platform adapter. Deletion test rejects a shallow hash utility unless it removes platform policy from its callers; locality and leverage come from restoring the established runtime seam.

## SEC-01 — Redact complete credential values before reporting problems

**Priority:** P1. **Recommendation:** Strong. **Evidence:** synthetic reproduction; no claim that real credentials were exposed.

`apps/investing-server/src/observability.ts:13-19` applies generic sensitive-field replacement before bearer replacement. Running the exported function with synthetic input `Authorization: Bearer SYNTHETIC_EXAMPLE_TOKEN` returns `Authorization: [REDACTED] SYNTHETIC_EXAMPLE_TOKEN`. The prefix is removed but the credential survives. `createProblemReporter` uses this function for console/Sentry problem text.

The problem-reporting module must own complete sanitization at its output interface. Recognize full Authorization header values before generic assignments; cover whitespace/case variation and common quoted/JSON key formats. Prefer allowlisted structured problem fields and stable provider error codes where available. Preserve useful non-sensitive diagnostic text. Review direct provider-error response/log paths touched by this module and route them through the same safe formatting seam; do not expand this into a repository-wide logging rewrite.

**Acceptance:** synthetic bearer headers, basic authorization headers, API-key assignments, quoted JSON secret fields, and multiline messages never retain supplied secret substrings in console or captured Sentry payloads. Benign messages remain readable. Test the exported reporter with fake writer/Sentry adapters in addition to the string helper. Do not use actual keys in fixtures, logs, or reports.

**Ownership/dependencies:** `observability.ts`, new/adjacent reporter tests; check broker/provider error formatting consumers. Independent of financial work. No schema change. One sanitization interface owns the security invariant; deleting it would scatter policy. This existing module already has depth; strengthen its behavior. Locality makes future formats auditable, and leverage covers both real output adapters.
