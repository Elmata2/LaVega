# AI Explanation Layer and Stage-0 Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship LaVega's AI explanation pipeline (engine FactSheet in, validated placeholder prose out, exact numbers filled in the browser, template fallback) and the on-device stage-0 learning system (concept map, BKT mastery, spaced re-exposure, feedback, events log, "What LaVega knows" learning section), plus the golden set, review loop and approved-example training file that stage 0b needs.

**Architecture:** Pure logic (types, projection, fill, validators, concept map, BKT, scheduling, events) goes in `packages/core` as Effect 4 code and is shared by server and browser. The server adds one route, `POST /api/agent/explain`, built exactly like `/api/agent/categorize` (rate limit, budget reservation, field-by-field sanitiser, Mistral through the existing provider); it only ever sees the bucketed `ProfileProjection`. The browser owns the FactSheet, mastery, feedback and every exact number, and writes learning state and events into the vault sections `learning` and `events`.

**Tech Stack:** TypeScript, Effect 4 (`effect@4.0.1`), Hono server on Vercel, Mistral (`mistral-small-latest` via `apps/server/src/agent/models.ts`), React, vitest (`@effect/vitest`), pnpm/turbo, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-22-ai-explanation-and-learning-design.md` (binding; read it and `AGENTS.md` first). Bound by `2026-10-21-advisor-pivot-intake-design.md` 4.7 and 6. Depends on `docs/superpowers/plans/2026-10-22-advisor-intake.md` (being implemented) and `docs/superpowers/specs/2026-10-22-personal-plan-design.md`.

**Assumptions about code that does not exist yet (verify first, adapt only at the named seam):**
- A1. Intake Task 2 has landed: `AdvisorProfile` (with `experience`, `knowledge`), `VaultSection`, `getSection(name)` / `putSection(name, value)` / `appendEvents(events)` on `VaultStorage`, `mergeEvents`, and `packages/core/src/advice/language.ts` exporting `ADVICE_LANGUAGE` and `findAdviceLanguage(text, locale): string[]`.
- A2. The plan step (`docs/superpowers/plans/2026-10-23-personal-plan.md`, runs before this plan) owns the FactSheet. FIXED NAMES, do not rename or redefine: file `packages/core/src/plan/factsheet.ts` exporting `FactSheet { id, taskType: "plan" | "digest" | "note", locale, engineVersion, generatedAt, hash, facts: FactSheetFact[] }`, `FactSheetFact { factId, section: SectionId | null, exact, bucket, unit, polarity, trend?, range?, mustMention, derivedFrom? }`, `PLAN_ENGINE_VERSION`, `bucketOf`, `buildFactSheet(facts, { locale, asOf, taskType? })`; `Polarity`, `SectionId`, `PlanFact`, `FigureUnit` from `packages/core/src/plan/types.ts`; the whole-plan entry point `computePlan(input: PlanInput): PlanResult` with `PlanResult.facts` and `PlanResult.factSheet(locale, taskType = "plan")` (a digest or note sheet is the same facts with another `taskType`); `PlanSnapshot.markers` and `topChanges(...)` from `plan/compute.ts` and `plan/changes.ts`; `PlanEvent` (kinds `subscription-decision`, `usage-log`). This plan has no `buildPlanFactSheet` and no second FactSheet or Polarity type.
- A3. The plan step ships template prose per section as `copy/plan/<section>.ts` (`explain.simple` / `explain.detailed`, already-formatted strings) and a `SectionCard` with an `explanation` slot (plan Task 11). Task 7 reuses those for `taskType: "plan"` and adds its own templates, keyed by fact id, only for the digest and the note. Task 8 fills the slot; it edits no figure code.
- A4. Intake names used as is, never redefined: `AdvisorProfile`, `Goal`, `Debt`, `AdvisorProfileStore`, `getSection/putSection/appendEvents`, `mergeEvents`, vault sections `plan` / `learning` / `events`, `computeRoom`/`RoomResult`, `scoreCapacity`, `proposeFixedCosts`, `ADVICE_LANGUAGE`/`findAdviceLanguage`, `PublicFact`/`assertShowable`, `Subscription.txIds`. Events are intake envelopes `{ id, kind, at }`; this plan's kinds are `explanation` and `outcome`; the plan's are `subscription-decision` and `usage-log`; every reader filters by `kind` and ignores kinds it does not know.

## Global Constraints

- New TypeScript logic uses Effect 4 (Schema, TaggedError, Context.Service, Predicate); no hand-written predicates; no `Date.now()` in new core code (take `asOf: string`). Read `repos/effect/LLMS.md` before writing Effect code. (AGENTS.md, intake plan)
- All UI copy NL and EN, typed-complete `Record<Locale, T>` in `apps/web/src/copy/`; no Dutch outside copy modules; logic returns a KIND, copy renders it. New copy modules join `copy/parity.test.ts`. Prompt markdown under `apps/server/src/agent/prompts/` is the existing exception (it is Dutch today).
- G1: every explanation is built on engine output; the model never produces or changes a number. Digest, plan explanations and notes obey it. **Chat is outside it** (owner decision): chat keeps the conversations API with web search.
- The server never receives the profile or the FactSheet's exact values. Projection excluded by construction: mastery values, timestamps, dates of explained concepts, names, free text, counterparties, exact amounts, IBANs, the worries field. Built field by field like `facts.ts`, never by copying an object.
- `kind` is the closed enum `fact | explanation | option_tradeoff | next_step_generic`. No `recommendation` kind. Lengths: digest 80-120 words, plan explanation 150-250. First sentence is the one number that matters and what it means.
- Model ids live only in `apps/server/src/agent/models.ts` (`pricing.test.ts` scans for stray literals). Default `MISTRAL_SMALL`. No reasoning mode for prose.
- On any validation failure: one retry with the validator message appended; second failure: static localised template, always B1. Refusals are static localised templates, never generated.
- Unfilled placeholder in the browser is a hard error that falls back to the template; never shown.
- Judge: small model, temperature 0, binary, runs in parallel, can only block, never rewrites.
- Readability: do NOT use Flesch-Douma (coefficients UNVERIFIED); sentence length plus share of words outside a verifiable common-word list.
- Default `readingLevel` from intake `experience`: beginner -> `basic`, some -> `intermediate`, experienced -> `advanced`. NL labels basis, gemiddeld, gevorderd. "Two or more simpler taps in a row on a concept" lowers that concept's stored level, not globally.
- BKT defaults: prior 0.3 for concepts with no intake signal; four parameters (prior, learn, guess, slip) in ONE table; mastery never gates features. Due when P(known) < 0.8 or last shown more than its interval ago.
- Notes: only when an engine event makes the concept relevant; at most 1 per day and 3 per week; quiet period after a dismissal; "stop this topic" in one tap; global off switch; caps count app-open days; no push. Dismissed twice mutes the topic for 90 days.
- Memory is structured, never transcripts. Concept state is NOT a `LearnedFact`; the `LearnedFact` store is untouched.
- Events: append-only, unique ids, union merge, counters derived from the logs and never stored. Every selection records `propensity` (1.0 while a rule decides), `policy` (`rule`), `contentVersion`.
- Engagement (sessions, time in app, streaks, notification response) is never a reward term or a stored counter.
- Feedback is applied in the browser (changes `readingLevel` and the concept-id list before the call) and is never sent.
- Cost: under EUR 0.05 per user per month (G5). Use `prompt_cache_key` per task type with no user data in the key.
- AI use is disclosed in the UI beside every generated explanation. The UI does not say "nothing is stored".
- Out of scope, do not build: telemetry or TelemetryReport, consent flow, DP, bandits, archetypes, the fine-tune job, DSPy-style optimisation, push.
- Implementers never commit or push. Every task ends with `git add -N` on its new files (owner commits).
- Verify commands (repo root): `pnpm --filter @lavega/core test`, `pnpm --filter @lavega/server test`, `pnpm --filter @lavega/web test`, `pnpm --filter @lavega/adapters test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`. Package names: check each `package.json`.

## Review Focus

Inputs the spec implies that no happy path exercises (each pinned by a test in the owning task):

1. Negative room, zero data, empty `facts[]`: a negative `mustMention` fact never sits in a positive-polarity sentence; an empty FactSheet makes no model call and shows the template (Tasks 2, 4, 7).
2. Numbers that evade the regex: `EUR 1.234,50`, `1,234.50`, `12%`, `twaalfhonderd`, `tien procent`, `ten percent`, a year or date, a digit glued to a word (`3maanden`), `{{ room_month }}` with spaces, an upper-case or unknown placeholder, but NOT the articles "een" / "one" (Task 2).
3. Model output that is not JSON, has extra keys, an unknown `kind`, an empty `sentences`, or a placeholder for a fact it was not sent; refusal or provider 429/5xx: all end in the template, never a thrown 500 to the user (Tasks 4, 7).
4. A hostile projection: bucket strings with instructions or letters, unknown concept ids, 10,000 facts, a factId carrying free text. Sanitiser rejects or drops; none reaches the prompt (Task 4).
5. Learning state edge cases: vault with no `learning` section, a future `lastShownAt`, mute expiry on the exact boundary, 2 simpler taps with a different concept in between, global off switch, reset really deleting records, two devices writing the same concept (Tasks 5, 6, 9).
6. Chat false positives: the blocklist must not mangle ordinary words ("beste" inside a longer word, "kopen" in a question about a user's own purchase list) beyond the owner's accepted behaviour; a blocked chat reply returns a localised code, never raw text (Task 10).

---

## File Structure

Core, new folders `packages/core/src/explain/` and `packages/core/src/learning/` (exported from `packages/core/src/index.ts`):
- `explain/types.ts` ReadingLevel, TaskType, Sentence, ExplanationOutput. `explain/projection.ts` ProfileProjection and its builder. `explain/fill.ts` placeholder fill. `explain/validators.ts` all deterministic validators. `explain/thresholds.ts` the single table (lengths, readability, level rules).
- `learning/concepts.ts` concept map. `learning/bkt.ts`. `learning/state.ts` ConceptState, LearningRecord. `learning/schedule.ts` due/triggers/caps. `learning/feedback.ts` feedback reducer. `learning/events.ts` ExplanationEvent, OutcomeEvent.
Server (`apps/server/src/agent/`): `explain.ts` (sanitiser + pipeline), `explainJudge.ts`, prompts `_base.md` (rewrite), `_explain.md`, `explain-digest.md`, `explain-plan.md`, `explain-note.md`, `explain-judge.md`.
Web: `apps/web/src/explain/` (orchestrator, client glue), `apps/web/src/copy/explain.ts`, `apps/web/src/copy/concepts.ts`, `apps/web/src/components/blocks/ExplanationBlock.tsx`, `apps/web/src/components/blocks/ConceptNote.tsx`, `apps/web/src/views/LearningSection.tsx`.
Eval: `packages/core/src/explain/golden/` (fixtures), `scripts/explain-eval.ts`, `scripts/explain-review.ts`, `data/explain-training/approved.jsonl`.

---

### Task 1: Explain types, ProfileProjection, placeholder fill

**Files:**
- Create: `packages/core/src/explain/types.ts`, `projection.ts`, `fill.ts`, `thresholds.ts`, `explain.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces:**
- Consumes (A2): `FactSheet`, `FactSheetFact` from `packages/core/src/plan/factsheet.ts`; `Polarity` from `plan/types.ts` (NOT redefined here); `Locale` from core; intake `AdvisorProfile["experience"]`.
- Produces:
  - `type ReadingLevel = "basic" | "intermediate" | "advanced"`; `type TaskType = "digest" | "plan" | "note"`; `type SentenceKind = "fact" | "explanation" | "option_tradeoff" | "next_step_generic"`
  - `Sentence = { kind: SentenceKind; factIds: string[]; polarity: Polarity; text: string }` and Schema `ExplanationOutput = { sentences: Sentence[] }` (Schema decode rejects extra keys and unknown `kind`).
  - `type ProjectionFact = { factId: string; bucket: string; unit: string; polarity: Polarity; trend: "up" | "down" | "flat" | "none"; mustMention: boolean; hasRange: boolean }`
  - `type ProfileProjection = { locale: Locale; taskType: TaskType; facts: ProjectionFact[]; topChanges: string[] /*max 3 factIds*/; conceptIds: string[]; readingLevel: ReadingLevel }`
  - `buildProjection(sheet: FactSheet, opts: { conceptIds: readonly string[]; readingLevel: ReadingLevel; topChanges: readonly string[] }): ProfileProjection` (copies named fields only; never `exact`, `generatedAt`, `hash`, `derivedFrom`, `range` values)
  - `readingLevelFromExperience(e: "beginner" | "some" | "experienced"): ReadingLevel`
  - `allowedPlaceholders(p: Pick<ProfileProjection, "facts">): ReadonlySet<string>`: `{{factId}}`, plus `{{factId.low}}`, `{{factId.expected}}`, `{{factId.high}}` when `hasRange`.
  - `type Formatter = (fact: FactSheetFact, part: "exact" | "low" | "expected" | "high", locale: Locale) => string`
  - `fillPlaceholders(sentences: readonly Sentence[], sheet: FactSheet, format: Formatter): Effect<string[], UnfilledPlaceholderError>` (returns one string per sentence, same order; callers group by section with `sectionOfSentence(sentence, sheet): SectionId | null` = the `section` of its first `factId`, since the model returns sentences by fact id, not by section` (TaggedError; any placeholder left after fill, or any `{{` / `}}` remaining, fails).
  - `thresholds.ts`: ONE table `EXPLAIN_THRESHOLDS` (word-count bounds per task type: digest 80-120, plan 150-250, note 15-40 [note bounds are my decision, spec silent]; per-level max words per sentence and max share of uncommon words).

- [ ] **Step 1: Write failing tests**

```ts
test("buildProjection copies named fields only: no exact, hash, generatedAt, range values", ...) // JSON.stringify(projection) contains none of the sheet's exact values
test("readingLevelFromExperience: beginner->basic, some->intermediate, experienced->advanced", ...)
test("allowedPlaceholders adds .low/.expected/.high only for facts with a range", ...)
test("fillPlaceholders fills {{room_month}} via the Formatter and fails on {{unknown}} and on a stray '{{'", ...)
test("ExplanationOutput rejects kind 'recommendation' and extra keys", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- explain/explain` Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the signatures above. Projection builder takes `topChanges` already ordered by the caller and slices to 3.
- [ ] **Step 4: Run** the same command plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N packages/core/src/explain` (owner commits).

---

### Task 2: Deterministic validators (spec 4.3 items 1-7)

**Files:**
- Create: `packages/core/src/explain/validators.ts`, `validators.test.ts`
- Modify: `packages/core/src/advice/language.ts` (intake Task 2; add the spec 4.3 item 6 patterns not yet in the one list: `allocate N%`, a percentage next to `aandelen|equities|ETF`, "beleg in", "je zou ... moeten kopen/beleggen", "I recommend", "you should buy/invest/sell"; keep ONE list) and its test

**Interfaces:**
- Consumes: Task 1 types; `findAdviceLanguage(text, locale)` (A1).
- Produces:
  - `type FailureCode = "schema" | "placeholder_unknown" | "stray_number" | "must_mention_missing" | "polarity_mismatch" | "advice_language" | "readability" | "length"`
  - `type ValidationFailure = { code: FailureCode; sentenceIndex?: number; message: string /*English, fed to the retry prompt, contains no user data*/ }`
  - `validateExplanation(raw: unknown, ctx: ProfileProjection): { ok: true; output: ExplanationOutput } | { ok: false; failures: ValidationFailure[] }` (runs all checks, returns every failure)
  - `findStrayNumbers(text: string, locale: Locale): string[]` (digits, currency symbols and codes, `%`, "procent/percent/per cent", NL and EN number words from two upward; "een" and "one" are NOT number words; text inside `{{...}}` is removed first; small whitelist keyed by fact id is a parameter `allow: ReadonlySet<string>`)
  - `readabilityFailures(sentences: readonly Sentence[], level: ReadingLevel, locale: Locale, common?: ReadonlySet<string>): ValidationFailure[]` (sentence length always; uncommon-word share only when `common` is given; the common-word list source is an OWNER DECISION, see gaps: Task 11 loads it if present, tests here use a 50-word fixture)
- Rules: polarity check: each sentence's `factIds` must all exist in `ctx.facts`; if all those facts share a polarity the sentence polarity must equal it, if mixed it must be `neutral`; a `fact` sentence needs at least one `factId`. Must-mention: every `mustMention` fact id appears in some sentence. Placeholders must be in `allowedPlaceholders(ctx)`; a placeholder for a fact id not in that sentence's `factIds` is also a failure.

- [ ] **Step 1: Write failing tests** (properties, not strings)

```ts
test.each(["EUR 1.234,50", "1,234.50 euro", "12%", "twaalfhonderd euro", "tien procent", "ten percent", "in 2026", "3maanden"])("stray number caught: %s", ...)
test("'een buffer' and 'one month' are not number words; '{{room_month}}' is not a stray number", ...)
test("negative mustMention fact in a positive sentence -> polarity_mismatch", ...)
test("mixed-polarity facts in one sentence require neutral", ...)
test("missing mustMention fact -> must_mention_missing; empty sentences -> length", ...)
test("{{ room_month }} (spaces), {{ROOM_MONTH}}, {{goal_gap:xyz}} not in the projection -> placeholder_unknown", ...)
test("digest of 130 words -> length; plan of 100 words -> length", ...)
test("findAdviceLanguage hits: 'allocate 60% to equities', '30% aandelen', 'beleg in een ETF', 'you should buy', NL and EN; clean sentence has none", ...)
test("validateExplanation returns every failure at once for a multi-fault output", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- explain/validators advice/language` Expected: FAIL.
- [ ] **Step 3: Implement** `validateExplanation` composing small pure checks; decode with `ExplanationOutput` first and return a single `schema` failure on decode error. Word count treats a placeholder as one word.
- [ ] **Step 4: Run** same; Expected: PASS. Then `pnpm --filter @lavega/core test` (the intake copy scan imports the extended list; it must stay green or the new patterns need a false-positive fix).
- [ ] **Step 5: Stage:** `git add -N packages/core/src/explain/validators*.ts`.

---

### Task 3: Prompts: `_base.md` rewrite and explain prompt files

**Files:**
- Modify: `apps/server/src/agent/prompts/_base.md` (whole file; today it describes "een ondernemer met meerdere vennootschappen", Dutch-only, mentions BV's); `apps/server/src/agent/prompts.ts:58-68` (add loader); `apps/server/src/agent/prompts.test.ts`
- Create: `prompts/_explain.md` (advice-line constitution, style guide, output schema, placeholder rules, the three levels, natural frequencies and ranges, calm tone), `prompts/explain-digest.md`, `explain-plan.md`, `explain-note.md`, `explain-judge.md`
- Verify unchanged: `scripts/vercel-build.mjs:99-102` already copies the whole `prompts` dir and asserts files shipped (no change expected; confirm the new files ship)

**Interfaces:**
- Consumes: `composePrompt` (`prompts.ts:34`), `loadAgentPrompt` (`prompts.ts:66`; its regex `^[a-z-]+$` admits `explain-digest`).
- Produces: `loadExplainPrompt(taskType: "digest" | "plan" | "note"): string` = `composePrompt("_base.md", "_explain.md", "explain-<taskType>.md")`; `loadJudgePrompt(): string` = `composePrompt("explain-judge.md")` (judge does not need the charter); `explainPromptVersion(taskType): string` = stable short hash (core `hash()`) of the composed text, used as `contentVersion` and `prompt_cache_key` suffix.

Content rules for the rewrite: keep (a) never invent amounts, balances, rates, percentages or dates, (b) never put personal data into a web search, (c) the `WAT LAVEGA AL WEET` section verbatim in meaning, because `factsBlock` (`facts.ts:62`) emits that exact header and chat, categorize, facturen and travel all compose `_base.md`; drop the multi-BV business-owner framing; replace "Je antwoordt in het Nederlands" by "answer in the language the request names (`locale`), Dutch when none"; state the information-only line (no instrument, product, allocation or amount advice; no "best"). The rewrite changes behaviour of every composed agent, so Step 5 re-runs their suites.

- [ ] **Step 1: Write failing tests** in `prompts.test.ts`

```ts
test("_base.md has no business-owner framing: no 'vennootschap', no 'BV' words", ...)
test("_base.md keeps the 'WAT LAVEGA AL WEET' header that factsBlock emits (facts.ts:62) and the never-invent rule", ...)
test("loadExplainPrompt differs per task type, contains the four kinds and no 'recommendation' kind, and ends with the schema", ...)
test("explainPromptVersion is stable across calls and changes when the text changes (compose with a temp dir stub)", ...)
test("the explain prompts contain no digits except inside the schema example (no number can be copied from a prompt example)", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/server test -- prompts` Expected: FAIL.
- [ ] **Step 3: Write the markdown and `loadExplainPrompt` / `loadJudgePrompt` / `explainPromptVersion`.** The judge file asks the single binary question from spec 4.3 item 8 and answers `{"blocked": true|false}`. Exemplars: none yet (Task 11 adds an owner-curated `prompts/explain-exemplars.md`; loader includes it only if the file exists).
- [ ] **Step 4: Run** `pnpm --filter @lavega/server test` (all suites: chat, categorize, travel, invoiceExtract compose `_base.md`). Expected: PASS.
- [ ] **Step 5:** `node scripts/vercel-build.mjs` is heavy; instead assert in `prompts.test.ts` that every `explain-*.md` and `_explain.md` exists on disk (the 17 Sep failure mode). Stage: `git add -N apps/server/src/agent/prompts`.

---

### Task 4: Server explain pipeline and route

**Files:**
- Create: `apps/server/src/agent/explain.ts`, `explain.test.ts`, `explainJudge.ts`
- Modify: `apps/server/src/agent/provider.ts:2-7` (optional `temperature?: number`, `promptCacheKey?: string` on `complete`); `apps/server/src/agent/mistral.ts:125-141` (send `temperature` and `prompt_cache_key` when given; `mistral.test.ts` body assertion); `packages/database/src/index.ts:~1528` (the `AiUsage["route"]` union; add `"explain"` to the `AiUsage["route"]` union; no SQL change: `db/migrations/0005_ai_usage.sql:38` only checks non-blank, confirm `packages/database/src/migrations.test.ts` stays green); `apps/server/src/agent/budget.ts:110-117` (`WORST_CASE_CENTS.explain`, sized for generation + one retry + judge, start at 8 and justify in a comment); `apps/server/src/agent-routes.ts` (Deps `~:35-45`, import list `~:13-22`, handler after `/api/agent/categorize` ending `~:472`)

**Interfaces:**
- Consumes: Task 1-3 (`ProfileProjection`, `validateExplanation`, `loadExplainPrompt`, `loadJudgePrompt`, `explainPromptVersion`), `createMistralProvider(apiKey, model, obs)` (`mistral.ts:114`), `createAiObservationContext`, `MISTRAL_SMALL`.
- Produces:
  - `sanitizeExplainInput(raw: unknown): ProfileProjection` throws `ValidationError("explain-…", …)` (`validationError.ts`). Field by field from named keys only (pattern: `categorize.ts:26-47`, `facts.ts:26-49`). Allowlists: `locale` in nl|en; `taskType`; `readingLevel`; each fact: `factId` matches `^[a-z_]{1,40}(:[a-z0-9-]{1,36})?$`, `bucket` matches `^[a-z0-9_<>=.,:+\-– ]{1,32}$` and contains no sequence of 9 or more digits, `unit`, `polarity`, `trend` in closed sets, `mustMention`/`hasRange` booleans; max 60 facts, max 12 `conceptIds` that exist in the concept map (unknown ids dropped), `topChanges` filtered to sent fact ids, max 3. Rejects an empty `facts`.
  - `runExplain(input: ProfileProjection, apiKey: string, onUsage: (u: { inputTokens: number; outputTokens: number }) => void | Promise<void>, userId?: string): Promise<ExplainOutcome>`
  - `type ExplainOutcome = { status: "ok"; sentences: Sentence[]; promptVersion: string; retries: 0 | 1 } | { status: "fallback"; reason: "validation" | "judge" | "model_error"; promptVersion: string; retries: 0 | 1; failureCodes: FailureCode[] }`
  - Route `POST /api/agent/explain`, body `ProfileProjection`, response `ExplainOutcome` as JSON with status 200 for both `ok` and `fallback`. Ladder identical to categorize: 503 not configured -> 429 rate (`rateCheck(c, "explain")`) -> 429 budget (`requireBudget(c, "explain")`) -> 400 sanitiser -> call. Provider failure is NOT a 502: it returns `fallback` with reason `model_error` (the browser shows the template); budget reservation is released only on a thrown error before any usage.
  - Server log line per call (no user text): `explain.outcome promptVersion=… task=… status=… retries=… failures=… judge=…`. It logs a hash of the bucketed projection, not of the browser FactSheet hash, because a hash of exact values is a stable per-user fingerprint (decision flagged below).

Behaviour: build user message from projection JSON; system = `loadExplainPrompt(taskType)`; `json: true`, `temperature` default, `promptCacheKey: "explain-" + taskType` (the cache key carries no user data); `maxTokens` 600 digest/note, 900 plan. Validate; on failure one retry with the failure `message`s appended; judge runs in parallel with the first validation using the same text (`explainJudge.ts`: `judgeBlocks(text: string, provider): Promise<boolean>`, temperature 0, parse `{"blocked": boolean}`; an unparsable or failed judge call counts as blocked, because a miss costs more than a block; log it). Usage from generation, retry and judge is summed and passed to `onUsage` ONCE: `recordUsage` reconciles the single reservation, a second call is a no-op (`budget.ts:215`, `ReservationHandle` comment). On a thrown provider error charge the ceiling as `categorize.ts:84` does.

- [ ] **Step 1: Write failing tests** (`explain.test.ts`, provider mocked as in `chat.test.ts:1-15`; route tests with injected `deps.explain` as the categorize route tests do)

```ts
test("sanitizeExplainInput drops unknown concept ids, rejects empty facts, bucket with letters/instructions, factId with spaces, 10k facts", ...)
test("sanitizeExplainInput builds a fresh object: an extra key 'name'/'exact'/'masteryByConcept' never survives", ...)
test("valid first output -> ok, retries 0, one generation + one judge call, onUsage called once with the sum", ...)
test("invalid first output (stray number) -> second call contains the failure message -> valid -> ok, retries 1", ...)
test("two invalid outputs -> fallback reason validation with failureCodes", ...)
test("judge returns blocked, or throws, or returns junk -> fallback reason judge", ...)
test("provider throws -> fallback model_error and ceiling usage charged, not a 5xx", ...)
test("route: 503 unconfigured, 429 caller and global, 429 budget, 400 bad input, 200 fallback; reservation released on 400", ...)
test("mistral body carries prompt_cache_key and temperature 0 for the judge; categorize call body unchanged", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/server test -- explain mistral agent-routes` Expected: FAIL.
- [ ] **Step 3: Implement** per the signatures. The `prompt_cache_key` field name is VERIFIED only in the spec's reading of Mistral docs; check the API reference before merge and keep the field behind `promptCacheKey` so a rename is one line. Structured output: use `json_object` plus core decode (strict `json_schema` support is UNVERIFIED per spec 4.2).
- [ ] **Step 4: Run** `pnpm --filter @lavega/server test && pnpm --filter @lavega/database test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N apps/server/src/agent/explain.ts apps/server/src/agent/explain.test.ts apps/server/src/agent/explainJudge.ts`.

---

### Task 5: Concept map, ConceptState, BKT, intake seeding

**Files:**
- Create: `packages/core/src/learning/concepts.ts`, `state.ts`, `bkt.ts`, `learning.test.ts`, `apps/web/src/copy/concepts.ts` (NL+EN titles, one-line definitions, check-item text; joins `copy/parity.test.ts`)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: intake `AdvisorProfile` (`experience`, `knowledge`); Effect Schema.
- Produces:
  - `type ConceptId` (string union of the shipped ids). Target list (about 25): buffer, room, fixed_costs, compound_growth, costs_and_ter, diversification, risk_and_return, inflation, box3, gift_exemption, points_value, subscription_cost_per_use, goal_gap, debt_interest, interest_rate, and the rest the owner authors. **The implementer seeds exactly 8** (buffer, room, fixed_costs, subscription_cost_per_use, goal_gap, inflation, compound_growth, risk_and_return) with draft content; the other ids are listed in `PLANNED_CONCEPT_IDS` and not selectable.
  - `ConceptDef = { id: ConceptId; prerequisites: ConceptId[]; triggers: EngineEventKind[]; checks: CheckItem[] /*1-3*/; contentReviewed: boolean }`, `CheckItem = { id: string; options: [Option, Option, Option] }`, `Option = { id: string; correct: boolean; misconception?: string /*copy key*/ }`. Exactly one correct option per item (Schema refinement). Unreviewed concepts (`contentReviewed: false`) are excluded from check items shown to users (spec 6.1: reviewed for the advice line before shipping); all 8 seeds start `false` for the owner to flip.
  - `CONCEPTS: readonly ConceptDef[]`, `conceptById(id): ConceptDef | undefined`
  - `ConceptState` Schema exactly per spec 10: `{ conceptId, pKnown, bktVersion, lastShownAt, intervalDays, nextDueAt, levelOverride?, mutedUntil?, checksAnswered, checksCorrect, seededFrom: string[], updatedAt }`
  - `BKT_PARAMS: Record<ConceptId, { prior: number; learn: number; guess: number; slip: number }>` (the one table; defaults prior 0.3, learn 0.15, guess 0.33, slip 0.1, all expert guesses and labelled so) and `BKT_VERSION: number`
  - `type Observation = { kind: "check"; correct: boolean } | { kind: "self_known" } | { kind: "helped" } | { kind: "no_simpler" }`; weights: check 1.0, self_known 0.4, helped 0.2, no_simpler 0.1 (one table)
  - `updateMastery(state: ConceptState, obs: Observation, asOf: string): ConceptState` (standard BKT posterior then learn step; weighted observations blend toward the unweighted posterior; clamps to [0.01, 0.99])
  - `seedConceptStates(profile: AdvisorProfile, asOf: string): ConceptState[]` from `KNOWLEDGE_ITEM_TO_CONCEPT` (a map keyed by the intake knowledge question ids; read `knowledge.ts` from intake Task 5 to fill it) and `experience`; concepts with no intake signal start at 0.3; `seededFrom` records the intake item ids.
  - `masteryWord(pKnown: number): "new" | "getting_there" | "known"` (thresholds in the table: below 0.4, below 0.8, else)

- [ ] **Step 1: Write failing tests**

```ts
test("every ConceptDef has 1-3 checks, exactly one correct option each, prerequisites that exist, no cycles", ...)
test("concept copy exists NL and EN for every shipped id and passes findAdviceLanguage in both locales; no digits in definitions", ...)
test("updateMastery: a correct check raises pKnown, an incorrect check lowers it, stays within [0.01,0.99]; self_known moves less than a check", ...)
test("seedConceptStates: beginner with no knowledge answers -> all 0.3; a correct knowledge answer for 'inflation' seeds above 0.3 with seededFrom set", ...)
test("masteryWord boundaries 0.39 / 0.4 / 0.79 / 0.8", ...)
test("unreviewed concepts expose no check items to the UI selector", ...)
test("every conceptId in the plan step's copy/plan/*.education is in CONCEPTS or PLANNED_CONCEPT_IDS (plan copy and concept map agree)", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- learning` and `pnpm --filter @lavega/web test -- parity` Expected: FAIL.
- [ ] **Step 3: Implement** with Schema + pure functions; no clock, `asOf` passed in.
- [ ] **Step 4: Run** same + `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N packages/core/src/learning apps/web/src/copy/concepts.ts`.

---

### Task 6: Scheduling, feedback reducer, events, learning persistence

**Files:**
- Create: `packages/core/src/learning/schedule.ts`, `feedback.ts`, `events.ts`, `record.ts`, `rewardSpec.ts`, `schedule.test.ts`, `feedback.test.ts`, `events.test.ts`
- Modify: `packages/core/src/advisor/vaultSections.ts` (intake Task 2: replace the `learning` placeholder type with `LearningRecord` and its merge; if the generic merge there already handles per-id newest-wins, only register the type), `packages/adapters/src/storage/encryptedStorage.test.ts`

**Interfaces:**
- Consumes: Task 5 (`ConceptState`, `updateMastery`, `masteryWord`, `CONCEPTS`), Task 1 types, intake `getSection/putSection/appendEvents`, `mergeEvents`.
- Produces:
  - `REWARD_SPEC` in `packages/core/src/learning/rewardSpec.ts` (spec 7: versioned const, `version`, `rewardTerms` (buffer months trend, room realised vs shown, goal progress vs own schedule, subscriptions cancelled within 14 days of an insight, micro-check correctness), `guardrails` (overdraft/late-fee incidents, opt-outs and muted topics, stress feedback, comprehension), `BANNED_ACTIONS` (instrument names, amounts, exploration on debt or high-risk topics), `forbiddenRewardTerms` = sessions, time in app, streaks, notification response). A test asserts no forbidden term appears in `rewardTerms`. The owner and the lawyer review this file (spec 8). Stage 0 only logs; nothing enforces a guardrail breach yet (flagged in gaps).
  - `LearningRecord = { concepts: Record<ConceptId, ConceptState>; settings: { notesOff: boolean; updatedAt: string }; lastProjection?: { sentAt: string; projection: ProfileProjection }; engineSnapshot?: EngineSnapshot; explanationCache?: Partial<Record<TaskType, { key: string; lines: string[]; source: "ai" | "template"; eventId: string }>> }` (`engineSnapshot` is the previous snapshot `detectEngineEvents` diffs against; `explanationCache` implements spec 12 "regenerate only when the FactSheet hash changes": key = FactSheet hash + level + sorted concept ids + locale) stored in section `learning`; `mergeLearning(a: LearningRecord, b: LearningRecord): LearningRecord` newest `updatedAt` wins per concept id, settings newest wins. (Mastery and `lastProjection` stay on the device; `lastProjection` is stored locally only so the user can inspect it, spec 6.6.)
  - `type EngineEventKind = "salary_arrived" | "price_rise" | "goal_within_90d" | "new_recurring" | "buffer_month_change" | "life_event"`; `TRIGGER_CONCEPTS: Record<EngineEventKind, ConceptId[]>` (salary -> room, buffer; price_rise -> subscription_cost_per_use; goal_within_90d -> goal_gap; new_recurring -> fixed_costs; buffer_month_change -> buffer; life_event -> []).
  - `type EngineEvent = { kind: EngineEventKind; at: string; ref?: string }`; `type EngineSnapshot = { salaryStreamLastSeen: Record<string, string>; subscriptionAmountCents: Record<string, number>; goals: Array<{ id: string; targetDate: string }>; recurringIds: string[]; bufferMonths: number; lifeEventIds: string[] }`; `detectEngineEvents(prev: EngineSnapshot | null, next: EngineSnapshot, asOf: string): EngineEvent[]` (no events on first snapshot; buffer change means `floor` of months differs).
  - `isDue(s: ConceptState, asOf: string): boolean` (pKnown < 0.8 OR `asOf >= nextDueAt`; muted -> false); `nextInterval(days: number): number` (1, 3, 7, 16, 35 days, SM-2 style; specifics UNVERIFIED, one table)
  - `NoteDecision = { show: false; reason: "off" | "daily_cap" | "weekly_cap" | "quiet" | "nothing_due" } | { show: true; conceptId: ConceptId; decisionPoint: EngineEventKind }`
  - `planNote(args: { record: LearningRecord; events: readonly EngineEvent[]; log: readonly ExplanationEvent[]; asOf: string }): NoteDecision` caps count distinct APP-OPEN DAYS taken from the log (one event per shown note); quiet period after a `dismissed` = the next 3 app-open days (my default; spec silent).
  - `resolveConceptsToExplain(record: LearningRecord, relevant: readonly ConceptId[], asOf: string): { define: ConceptId[]; skip: ConceptId[] }`; the projection `conceptIds` is `define` only.
  - `resolveLevel(base: ReadingLevel, state: ConceptState | undefined, oneShot?: "simpler" | "more_detail"): ReadingLevel`
  - `type FeedbackResponse = "none" | "helped" | "notHelped" | "simpler" | "moreDetail" | "tooLong" | "dismissed" | "muted"`; `applyFeedback(state: ConceptState, response: FeedbackResponse, log: readonly ExplanationEvent[], asOf: string): ConceptState`: two or more consecutive `simpler` on this concept (consecutive in that concept's own log) lowers `levelOverride` one step; `dismissed` twice sets `mutedUntil = asOf + 90 days`; `muted` sets it immediately; `helped` applies the `helped` observation; a concept shown without a `simpler` tap applies `no_simpler` when feedback arrives as `none` after display.
  - `ExplanationEvent` / `OutcomeEvent` Schemas per spec 10 (`id`, `at`, `taskType`, `contentVersion`, `catalogueItemId?`, `decisionPoint`, `alternativesConsidered[]`, `propensity`, `policy: "rule" | "holdout" | "bandit"`, `level`, `usedFallback`, `retries`, `response`, `microCheck?`, `followUpAsked`; OutcomeEvent fields as spec 10). Event envelope is intake's `{ id, kind, at }` with `kind: "explanation" | "outcome"`.
  - `buildExplanationEvent(args: {...}): ExplanationEvent` always sets `propensity: 1.0`, `policy: "rule"`; `buildOutcomeEvent(args: { baselineWindow, buffer, roomRealisedVsShown, goalProgress, subscriptionsCancelled, linkedExplanationId?, guardrails, confounders }): OutcomeEvent` is a pure constructor only. Nothing schedules outcome measurement in stage 0 (needs plan snapshots from the plan step; flagged below).
  - `countersFromLog(log: readonly ExplanationEvent[], asOf: string): { shownToday: number; shownThisWeek: number; helpedRate: number; simplerRate: number }` (derived, never stored).

- [ ] **Step 1: Write failing tests**

```ts
test("planNote: nothing relevant -> nothing_due; relevant + due -> show; second note same app-open day -> daily_cap; 4th in a week -> weekly_cap; notesOff -> off; after 'dismissed' -> quiet for 3 app-open days", ...)
test("mute boundary: mutedUntil exactly equal to asOf is still muted; one day later is not", ...)
test("applyFeedback: simpler,simpler on concept A lowers A's levelOverride only; simpler, (helped on B), simpler on A still counts as consecutive for A; simpler, helped, simpler on A does not", ...)
test("dismissed twice -> mutedUntil = +90 days; 'muted' immediate", ...)
test("detectEngineEvents: null prev -> []; price up on one subscription -> price_rise with ref; goal date within 90 days fires once, not every snapshot; buffer 2.4 -> 2.6 no event, 2.9 -> 3.1 event", ...)
test("isDue with future lastShownAt (clock skew) is not due and does not throw", ...)
test("buildExplanationEvent sets propensity 1 and policy rule; ids unique; mergeEvents union is idempotent", ...)
test("mergeLearning newest per concept; vault with no learning section reads as an empty LearningRecord", ...)
test("REWARD_SPEC has no engagement term, has every banned-action category, and its version is a string constant", ...)
test("countersFromLog derives from the log; there is no stored counter field in LearningRecord (schema keys assertion)", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- learning` and `pnpm --filter @lavega/adapters test -- encryptedStorage` Expected: FAIL.
- [ ] **Step 3: Implement.** Dates are ISO strings compared via Effect `DateTime` or intake `months.ts` helpers; no `new Date` arithmetic.
- [ ] **Step 4: Run** same + `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N packages/core/src/learning`.

---

### Task 7: Browser orchestrator, templates, API client

**Files:**
- Create: `apps/web/src/explain/orchestrate.ts`, `orchestrate.test.ts`, `snapshot.ts`, `apps/web/src/copy/explain.ts` (template fallback prose per fact id and per task type in B1 NL and EN, refusal text, AI disclosure label, control labels, "AFM register" link text), `apps/web/src/copy/explain.test.ts`
- Modify: `apps/web/src/api.ts` (add `explainRequest` beside `categorizeTxs`, `api.ts:68-80`, same error handling via `apiErrorMessageIn`); `apps/web/src/copy/apiErrors.ts` (codes `explain-*`, `ai-budget-*` already exist; add new codes from Task 4 and Task 10); `apps/web/src/copy/parity.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (route), 5, 6; `AdvisorProfile.experience`; `getSection/putSection/appendEvents`; `copy/money.ts` for formatting and the euro-conversion setting; A2/A3 templates.
- Produces:
  - `explainRequest(p: ProfileProjection): Promise<ExplainOutcome>` in `api.ts` (POST `${API_BASE}/api/agent/explain`; non-OK throws like `categorizeTxs`).
  - `type ExplanationResult = { lines: string[]; source: "ai" | "template"; fallbackReason?: string; promptVersion: string; retries: number; eventId: string; level: ReadingLevel; conceptIds: ConceptId[] }`
  - `requestExplanation(args: { sheet: FactSheet; /* from `computePlan(...).factSheet(locale, taskType)` (A2) */ profile: AdvisorProfile; record: LearningRecord; events: readonly ExplanationEvent[]; engineEvents: readonly EngineEvent[]; locale: Locale; euroConversion: boolean; oneShot?: "simpler" | "more_detail"; asOf: string; call?: typeof explainRequest }): Promise<ExplanationResult>`: resolves concepts (`resolveConceptsToExplain`) and level (`resolveLevel`, default from `readingLevelFromExperience`), builds the projection, stores it as `lastProjection` in the `learning` section BEFORE the call, calls, fills with `fillPlaceholders`; any of `fallback`, network error, `UnfilledPlaceholderError`, empty facts or `notesOff`-independent failure yields template lines and `source: "template"`. Before the call it looks up `LearningRecord.explanationCache[taskType]`; a hit on the same key (FactSheet hash + level + concept ids + locale) returns the cached lines with no call and no new event. For `taskType: "plan"` the result also carries `bySection: Partial<Record<SectionId, string[]>>` (via `sectionOfSentence`) so each section card shows its own sentences; one call per plan, never per section. It appends one `ExplanationEvent` (`usedFallback`, `retries`, `contentVersion` = prompt version or `template:<id>`). Never throws.
  - `digestDue(lastDigestAt: string | null, asOf: string): boolean` (older than 7 days; generated on app open as a normal call, nothing unattended).
  - `snapshotEngine(plan: PlanResult, txs, asOf): EngineSnapshot` built from the plan step's `PlanResult` (subscription amounts and recurring ids from `sections.subscriptions.figures`, goals from `sections.goals.figures.rows`, buffer months from `sections.buffer.figures`, `markers.flaggedIncreaseKeys` for `price_rise`) plus the latest income-stream date for `salary_arrived`; no second detector run. A missing input is `unavailable` and emits no event. The previous snapshot is read from and written to `LearningRecord.engineSnapshot`.
  - `templateLines(sheet: FactSheet, taskType: TaskType, locale: Locale, level: ReadingLevel): string[]` using copy; always B1. For `plan` it returns the plan step's `copy/plan/<section>.explain.simple` (level basic) or `.detailed` (intermediate and advanced) lines, already formatted; for `digest` and `note` it uses this task's templates keyed by fact id through `fillPlaceholders`, so those are filled identically to AI output.

- [ ] **Step 1: Write failing tests**

```ts
test("fallback status from server -> template lines, source 'template', event usedFallback true, no placeholder left", ...)
test("network failure and 429 -> template, no throw", ...)
test("model text with an unfilled/unknown placeholder -> template (hard error path), never rendered", ...)
test("empty FactSheet -> no call (call mock not invoked), template", ...)
test("lastProjection is written before the call and equals exactly what is sent (deep equal of the request body)", ...)
test("request body contains no mastery value, no timestamp, no profile worries text, no exact amount from the sheet (serialize and search for each exact value)", ...)
test("oneShot 'simpler' sends readingLevel one step lower and does not persist the override; override persists only via applyFeedback", ...)
test("same sheet hash + level + concepts twice -> second call served from explanationCache, call mock invoked once, no second event; changed hash -> new call", ...)
test("plan result groups sentences by section via the first factId's section; a sentence whose fact has section null is shown in the header block", ...)
test("digestDue: 6 days no, 8 days yes, null yes", ...)
test("every copy key exists NL and EN; template lines for each golden FactSheet pass validateExplanation-equivalent checks (no stray number outside placeholders, no advice language)", ...)
test("refusal copy contains the AFM register link and passes the advice scan", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- explain` Expected: FAIL.
- [ ] **Step 3: Implement** with Effect services where intake does (read how `apps/web/src/intake/` state is structured; keep orchestrate pure with injected `call`). The AFM register URL goes through intake `PublicFact` with `verifiedOn`; do not hard-code an unverified URL.
- [ ] **Step 4: Run** `pnpm --filter @lavega/web test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N apps/web/src/explain apps/web/src/copy/explain*.ts`.

---

### Task 8: ExplanationBlock UI, feedback controls, contextual note, micro-check

**Files:**
- Create: `apps/web/src/components/blocks/ExplanationBlock.tsx`, `ExplanationBlock.test.tsx`, `ConceptNote.tsx`, `ConceptNote.test.tsx`
- Modify: `apps/web/src/views/Overzicht.tsx` (digest card; intake Task 8 also edits this file, merge by adding a sibling block only); `apps/web/src/plan/sections/*Section.tsx` from the plan step (pass `ExplanationBlock` as the `explanation` slot of `SectionCard`, plan Task 11; no other plan file changes, A3; the plan's template switch maps simpler -> basic and more detail -> one level up); `apps/web/src/copy/explain.ts`

**Interfaces:**
- Consumes: Task 7 `requestExplanation`, `ExplanationResult`; Task 6 `applyFeedback`, `planNote`, `buildExplanationEvent`, `FeedbackResponse`.
- Produces: `ExplanationBlock` props `{ sheet: FactSheet; taskType: TaskType; ... }` (record, profile, locale from context hooks the plan view already uses) rendering: lines, the AI disclosure label beside AI text only (template text says nothing about AI), buttons `helped`, `didn't`, `simpler`, `more detail`, `too long`, `stop this topic`. Each tap: appends a follow-up `ExplanationEvent` response (new event with `linkedTo` is NOT in the spec schema, so one event per shown item is updated by appending a second event of the same `contentVersion` with `response` set; derived views take the latest per `eventId` group; state this in a code comment and test it), calls `applyFeedback`, `putSection("learning", …)`. "simpler" and "more detail" regenerate once at one level down or up via `oneShot`. `ConceptNote` props `{ decision: Extract<NoteDecision, { show: true }>; ... }`: one-line note from `copy/concepts.ts` (static, no AI call in stage 0; the `note` task type exists in the pipeline but this task wires only the static note, flagged below), with `dismiss` and `stop this topic`, and one optional check item (3 options, correct answer + misconception message) from reviewed concepts only; answering applies the `check` observation and writes `microCheck`. Global off switch lives in `LearningSection` (Task 9), read here.
- No motion beyond a restrained fade; check `emil-design-eng` / `animate` before writing any CSS transition (AGENTS.md).

- [ ] **Step 1: Write failing tests**

```ts
test("AI text shows the disclosure label; template text does not", ...)
test("'simpler' regenerates once at one level lower and writes a feedback event; the second consecutive 'simpler' on the same concept persists levelOverride", ...)
test("'stop this topic' sets mutedUntil and the concept is not due afterwards", ...)
test("no note when notesOff; no note without an engine event; at most one per app-open day", ...)
test("answering a check updates pKnown and writes microCheck {conceptId, correct}; unreviewed concept shows no check", ...)
test("renders NL and EN; no raw '{{' ever in the DOM, even when the call mock returns it", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- ExplanationBlock ConceptNote` Expected: FAIL.
- [ ] **Step 3: Implement** components; state persisted through the same save path intake's `AboutYou` uses (`onSave`/`putSection`), not a new store.
- [ ] **Step 4: Run** `pnpm --filter @lavega/web test && pnpm typecheck && pnpm lint && pnpm format`. Expected: PASS.
- [ ] **Step 5:** Drive it once in a browser with the `run` skill (dev server, a real vault fixture, AI unconfigured -> template path; AI configured -> `/api/agent/status` true on prod only, so test the AI path against the dev server with a key). Record what was and was not exercised. Stage: `git add -N apps/web/src/components/blocks/ExplanationBlock* apps/web/src/components/blocks/ConceptNote*`.

---

### Task 9: "What LaVega knows" learning section

**Files:**
- Create: `apps/web/src/views/LearningSection.tsx`, `LearningSection.test.tsx`
- Modify: `apps/web/src/views/AboutYou.tsx` (intake Task 7: render `LearningSection` below the field table; AboutYou props gain `learning: LearningRecord | null; log: readonly ExplanationEvent[]; onSaveLearning(next: LearningRecord): Promise<void>; onResetLearning(scope: { conceptId?: ConceptId }): Promise<void>`), `apps/web/src/copy/intake.ts` (`aboutYou.learning` tree) or `copy/explain.ts`

**Interfaces:**
- Consumes: `LearningRecord`, `masteryWord`, `countersFromLog`, `CONCEPTS`, `LearningRecord.lastProjection`.
- Produces: per concept row: title, mastery in words (new to you / getting there / known), last shown, reading level for that concept, muted state with "unmute"; actions: edit level, reset one concept, mute; "reset all learning" one action; global notes switch; a field-by-field view of `lastProjection.projection` (the exact object last sent, plus its `sentAt`; none sent yet -> says so). Reset deletes records (`putSection` with the concept key absent, and removal of the events for that concept is NOT done: events are append-only; resetting learning writes a `learning_reset` marker event? Decision: do not delete events, because the spec says reset deletes "the records" of concept state and the events log is the append-only audit; owner to confirm, see gaps).

- [ ] **Step 1: Write failing tests**

```ts
test("lists every shipped concept with mastery word and last shown; unseen concept shows 'new to you' and no date", ...)
test("reset one concept removes that ConceptState from the stored record (read back from the mocked vault), others untouched", ...)
test("reset all learning leaves an empty concepts map and settings default; no hidden copy remains in lastProjection", ...)
test("projection viewer lists each field of lastProjection and nothing else; empty state when none sent", ...)
test("global notes switch writes settings.notesOff and planNote then returns 'off'", ...)
test("NL and EN", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- LearningSection AboutYou` Expected: FAIL.
- [ ] **Step 3: Implement.** Mastery numbers are shown in words only; the number itself is not displayed (spec 6.6).
- [ ] **Step 4: Run** `pnpm --filter @lavega/web test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N apps/web/src/views/LearningSection*`.

---

### Task 10: Chat guard (advice blocklist + web sources) without touching the web-search path

**Files:**
- Modify: `apps/server/src/agent/chat.ts:52-65` (today `res.sources` is discarded and `yield full` sends raw text); `apps/server/src/agent-routes.ts` chat route (`~:311-404`; the `for await (const chunk of chat(...))` loop and the `catch`); `apps/web/src/api.ts:131-196` (`dispatchSseRecord`, `streamChat`: new `sources` event handler, `ChatStreamHandlers.onSources?`); `apps/web/src/chat-sse.test.ts`; `apps/web/src/copy/apiErrors.ts` (code `chat-advice-blocked` -> localised refusal)
- Test: `apps/server/src/agent/chat.test.ts`, `apps/server/src/agent-routes` chat tests

**Interfaces:**
- Consumes: `findAdviceLanguage(text, locale)` (A1/Task 2), Task 7 refusal copy.
- Produces: `screenChatText(text: string): { ok: true } | { ok: false; hits: string[] }` in `apps/server/src/agent/chat.ts` (checks NL and EN, the chat has no locale); `runChat` yields the text and then a second yield of sources is NOT used (generator type stays `AsyncGenerator<string>`); instead `runChat` takes an optional `onSources?: (s: { url: string; title: string }[]) => void`, called with `res.sources`. Route: on `screenChatText` failure it writes the SSE error `chat-advice-blocked` (reuse `writeSseError`) instead of the text; otherwise writes `event: sources` with JSON when sources exist, then `done`. Web: `onSources` handler and a "Source" line under the reply from `copy` (rendered by the chat widget when it is re-mounted; App.tsx:377 notes it is not rendered today, so the visible part is verified in a handler test and in Task 8's manual run notes). Chat remains outside G1: no number rule, no placeholders, no FactSheet, no new task type.
- Blocked chat output is dropped, never logged with its text.

- [ ] **Step 1: Write failing tests**

```ts
test("screenChatText flags 'koop dit fonds', 'you should buy', 'beleg in een ETF'; passes 'je abonnementen kosten meer per gebruik' and a sourced rate sentence", ...)
test("route: blocked reply -> SSE error chat-advice-blocked, no data frame with the text; clean reply -> data + sources + done", ...)
test("runChat still calls chatWithSearch with the same system prompt shape and maxTokens 4096 (web-search path unchanged)", ...)
test("dispatchSseRecord routes 'sources' to onSources and ignores unknown events", ...)
test("apiErrors maps chat-advice-blocked in NL and EN", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/server test -- chat agent-routes` and `pnpm --filter @lavega/web test -- chat-sse apiErrors` Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** same + `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Stage:** `git add -N` any new test files (owner commits).

---

### Task 11: Golden set, eval harness, review loop, approved-example training file

**Files:**
- Create: `packages/core/src/explain/golden/` (fixtures JSON + `index.ts`), `packages/core/src/explain/golden/recorded/` (recorded model outputs), `packages/core/src/explain/golden.test.ts`, `scripts/explain-eval.ts`, `scripts/explain-review.ts`, `scripts/explain-training-status.ts`, `data/explain-training/approved.jsonl` (empty), `packages/core/src/explain/training.ts` + `training.test.ts`, `apps/server/src/agent/prompts/explain-exemplars.md` (empty, owner-curated; Task 3 loader includes it only when non-empty)
- Modify: root `package.json` scripts: `eval:explain`, `review:explain`, `training:status`; `Task 3 loader` (include exemplars); CI config only to add `pnpm --filter @lavega/core test` coverage if golden tests are not already picked up (confirm)

**Interfaces:**
- Consumes: A2 `computePlan(...).factSheet(locale, taskType)` (golden FactSheets are generated from the plan step's engine on invented `PlanInput` fixtures, every value invented), Tasks 1-4, 7.
- Produces:
  - `GoldenCase = { id: string /*"golden:<profile>:<locale>:<level>"*/; synthetic: true; sheet: FactSheet; projection: ProfileProjection; expectMustMention: string[]; expectPolarity: Record<string, Polarity>; forbidden: string[] /*regex sources*/ }` and `goldenCases(): GoldenCase[]`: 7 profiles (freelancer with irregular income, couple with a mortgage, negative room, zero data, high buffer, several currencies, student) x NL/EN x 3 levels = 42 cases (inside the spec's 30-60). `pnpm eval:explain --regen` rebuilds sheets and expectations from the engine; without it the committed JSON is used and a test fails if the committed expectations differ from a regen (the engine changed).
  - Layer 1 (`golden.test.ts`, CI-blocking): for each case with a recorded output, `validateExplanation(recorded, projection)` pass rate must be >= 0.98 and zero `forbidden` patterns pass; plus a `golden/adversarial/` set of known-bad outputs (stray number, advice sentence, polarity flip, missing mustMention, unknown placeholder, ISIN, "30% aandelen") that MUST fail with the expected code each (a validator that stops catching one fails CI). Tests assert properties, not strings.
  - `scripts/explain-eval.ts`: `--record` calls the real `runExplain` path for every case against Mistral (needs `MISTRAL_API_KEY`; writes `recorded/<id>.json` with prompt version; costs real money, so it prints the case count first and requires `--yes`); default run validates recorded outputs; prints rejections/retries/judge blocks/template fallbacks per prompt version. Optional `--cross-judge` runs an injected `(text) => Promise<RubricScores>` from a non-Mistral provider; Layer 2 is nightly and non-blocking; the provider and key are an owner decision (see gaps), so this flag is a stub that exits with a clear message when no judge is configured.
  - `scripts/explain-review.ts` (Layer 3, the owner is the reviewer): `pnpm review:explain` picks 30 cases (round-robin across concepts, levels, locales) for the current `explainPromptVersion`, shows sheet facts and recorded sentences filled, asks 5 yes/no items (correct, understandable, right length, tone, no advice) plus optional corrected text and "near-miss" flag; writes `docs/ai-review/<promptVersion>.json`. `pnpm review:explain --check` exits non-zero unless the file for the CURRENT prompt version has >= 30 reviewed outputs, zero `no advice` failures and zero number mismatches (the launch gate; run before deploying a prompt change, not in unit tests).
  - Training hook: `type ApprovedExample = { id: string; input: { sheet: FactSheet; projection: ProfileProjection }; output: Sentence[]; locale: Locale; level: ReadingLevel; conceptIds: ConceptId[]; nearMiss: boolean; originalOutput?: Sentence[]; promptVersion: string; approvedBy: "owner"; approvedAt: string }`; `appendApproved(ex: ApprovedExample): Effect<void, TrainingError>` writes one JSON line to `data/explain-training/approved.jsonl`. It REFUSES (TaggedError `NotSyntheticError`) any example whose id does not start with `golden:` or `synth:` or whose `sheet` lacks the `synthetic` marker, and any string value that matches the IBAN, email or real-looking amount-with-counterparty patterns from `packages/core/src/redact.ts`; the review script calls it for every output the owner approves, and for every corrected near-miss (`originalOutput` kept, corrected text as `output`).
  - `trainingStatus(lines: readonly ApprovedExample[]): { total: number; perConceptLevel: Record<string, number>; missingCells: string[]; nearMissShare: number; ready: boolean; dataHash: string }`: ready iff total >= 300 (target 500), every concept (reviewed ones) x all 3 levels has >= 1, near-miss share >= 0.2. `pnpm training:status` prints it. The fine-tune job itself is NOT built.
  - Exemplars: `explain-exemplars.md` holds the owner's hand-picked best outputs per concept and level; Task 3's loader appends it to the explain prompt when non-empty, which changes `explainPromptVersion` and so re-triggers the review gate.

- [ ] **Step 1: Write failing tests**

```ts
test("goldenCases has 42 cases, unique ids, all synthetic: true, every sheet value invented (no real IBAN/email pattern)", ...)
test("committed golden expectations equal a fresh regen from the engine", ...)
test("Layer 1: recorded outputs pass rate >= 0.98 and no forbidden pattern passes", ...)
test.each(adversarialCases)("adversarial %s fails with its expected code", ...)
test("appendApproved refuses a non-synthetic id, a sheet without the marker, a string containing an IBAN; accepts a golden case; writes valid JSONL", ...)
test("trainingStatus: 299 examples -> not ready; 300 but a concept missing a level -> not ready with that cell named; near-miss share 0.19 -> not ready; dataHash is stable and changes when an example changes", ...)
test("review --check fails for a prompt version with 29 reviewed outputs, with 1 advice failure, or with a stale prompt version", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- explain/golden explain/training` Expected: FAIL.
- [ ] **Step 3: Implement.** Fixture generation lives in the script, committed output is data. `--record` is run by the owner (costs money); the implementer commits no recorded outputs except a small hand-written seed set (3 cases) so Layer 1 has something to run, labelled `handwritten`.
- [ ] **Step 4: Run** `pnpm --filter @lavega/core test && pnpm typecheck && pnpm lint`, then `pnpm training:status` (Expected: total 0, ready false) and `pnpm review:explain --check` (Expected: non-zero exit with "no review for prompt version <hash>").
- [ ] **Step 5: Stage:** `git add -N packages/core/src/explain/golden packages/core/src/explain/training* scripts/explain-*.ts data/explain-training docs/ai-review` (owner commits).

---

## Self-Review (done against the spec)

- 4.1 FactSheet fill: Tasks 1, 7. 4.2 model/call: Task 4 (small model constant, JSON, closed kinds, lengths in Task 2). 4.3 items 1-7: Task 2; item 8 judge and retry/fallback: Task 4; refusals: Tasks 7, 10. 4.4 browser fill: Tasks 1, 7. 4.5 layout and caching: Tasks 3, 4 (`prompt_cache_key`, projection in the user message, digest every 7 days at app open in Task 7). 4.6 chat outside, blocklist, sources: Task 10.
- 5 styles: level default, simpler/more detail, ranges via `.low/.high`: Tasks 1, 2, 6, 8. Tone is prompt content (Task 3).
- 6.1 concept map: Task 5 (8 seeded of 25, rest owner). 6.2 BKT and seeding: Task 5. 6.3 spacing, triggers, caps, off switch: Task 6, 8, 9. 6.4 feedback: Tasks 6, 8. 6.5 no transcripts: nothing persists chat (Task 10 changes no storage). 6.6 learning section and projection viewer: Task 9.
- 7 event schema, propensity, reward vector schema, guardrails as schema fields: Task 6 (constructor only). Reward spec / banned-actions versioned file: NOT planned (it is for the lawyer review and stage 1); flagged.
- 9 evaluation Layers 1 and 3 and the live counters (as log lines): Tasks 4, 11. Layer 2: stub only.
- 10 data model: Tasks 1, 5, 6. TelemetryReport and server tables: intentionally absent.
- 11 stage 0b hooks: Task 11 (approved set, near-miss flag, synthetic guard, readiness report, data hash). Fine-tune job, model-id switch and kill switch: not built (the drop-in model id already lives in `models.ts`).
- 8 launch prerequisites (DPIA, DPA/ZDR, lawyer): documented as launch gates; nothing in the plan ships a "nothing is stored" claim.
- Cross-plan: `FactSheet`, `FactSheetFact`, `Polarity`, `PlanResult`, `PlanEvent` are consumed from the plan plan and never redefined here. Type names checked across tasks: `ProfileProjection`, `ProjectionFact`, `Sentence`, `ExplanationOutput`, `ValidationFailure`, `FailureCode`, `ExplainOutcome`, `ConceptState`, `LearningRecord`, `ExplanationEvent`, `EngineEvent`, `NoteDecision`, `FeedbackResponse`, `ExplanationResult` are each defined in one task and used with that spelling later.

## Spec gaps and decisions the owner should check

1. FactSheet names are now fixed by the plan plan (A2). If the plan lands different names, change Tasks 1, 7 and 11 imports only.
2. Placeholder grammar is not in the spec: this plan uses `{{factId}}` plus `.low/.expected/.high` for range facts.
3. Spec 4.5 lists "FactSheet hash and validator result" for safety counters. The browser's hash covers exact values and would be a per-user fingerprint on the server, so the plan logs a hash of the bucketed projection instead. Confirm.
4. Judge failure fails closed (template). Cost: roughly 3 small calls worst case per generation; `WORST_CASE_CENTS.explain` starts at 8 and G5 (EUR 0.05/user/month) needs a measured check after the first week.
5. Note length bounds (15-40 words), quiet period (3 app-open days) and the interval ladder (1, 3, 7, 16, 35 days) are my numbers; the spec says "specifics UNVERIFIED".
6. Common-word list for the readability gate has no chosen source, so the uncommon-word share gate is wired but off until the owner supplies a list (length rules always on).
7. Only 8 of about 25 concepts are seeded, all `contentReviewed: false`: no check item is shown until the owner reviews content for the advice line.
8. Stage 0 wires a static concept note, not an AI `note` call, though the pipeline supports `note`. Reset of learning removes concept state but not the append-only events (spec 6.6 says reset "deletes the records"); confirm that events are exempt.
9. Spec 7 guardrail breach (pause personalisation) and the holdout are not enforced in stage 0; `REWARD_SPEC` is data plus a test. OutcomeEvent is a schema and constructor only; nothing measures outcomes until the plan step's monthly snapshots exist.
10. Layer 2 cross-family judge is a stub: no provider/key chosen, and the 100+ human-labelled set for kappa does not exist. The reward spec / banned-actions file for the lawyer (spec 7) is not planned.
11. Unverified: Mistral `prompt_cache_key` field name and `temperature` behaviour on `/chat/completions`; strict structured outputs (not used).
12. Rewriting `_base.md` changes chat, categorize, facturen and travel behaviour at once; Task 3 re-runs their suites but no live-model regression check exists for them.
