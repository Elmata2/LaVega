# Jouw plan / Your plan (template-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Jouw plan / Your plan" page: seven sections computed by pure core functions on the user's own numbers, a status per section, a monthly snapshot plus change log, the FactSheet schema, and complete NL+EN template text. No AI call.

**Architecture:** A new pure folder `packages/core/src/plan/` holds one function per section, a scenario module, a `computePlan` orchestrator, the FactSheet builder and snapshot diffing. Plan state (preferences, snapshots, subscription decisions, usage logs) lives in the intake's vault sections `plan` and `events`. `apps/web` gets one route/module `plan`, one view, one copy folder (`copy/plan/`, one module per section), and a state hook. The later AI layer consumes `FactSheet` and replaces only the explanation block.

**Tech Stack:** TypeScript, Effect 4 (`effect@4.0.1`, `Schema`, `Predicate`, `DateTime`), React, vitest (`@effect/vitest` for Effect code), pnpm/turbo, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-22-personal-plan-design.md` (binding). Also read `docs/superpowers/specs/2026-10-22-ai-explanation-and-learning-design.md` sections 4.1 and 10 (FactSheet fields), `docs/superpowers/specs/2026-10-21-advisor-pivot-intake-design.md` (profile 4.7, scope 10.1) and `AGENTS.md`.

**Depends on (intake plan `docs/superpowers/plans/2026-10-22-advisor-intake.md`, being implemented now; some files may not exist yet):** `AdvisorProfile`, `Goal`, `Debt`, `AdvisorProfileStore`, `Field`, `commitProfile`, `isSuppressed` (Task 2); vault sections `plan` and `events` with `getSection(name)` / `putSection(name, value)` / `appendEvents` and `mergeEvents` (Task 2); `ADVICE_LANGUAGE`, `findAdviceLanguage(text, locale): string[]` in `packages/core/src/advice/language.ts` and `PublicFact` / `assertShowable` in `packages/core/src/advisor/publicFact.ts` (Task 2); `packages/core/src/advisor/months.ts` with `isoMonth`, `previousMonths`, `monthsBetween` (created in intake Task 3 per owner decision, even though the intake plan text lists it under Task 4; every `months.ts` below means this path). Other intake paths: `advisor/profile.ts` (`AdvisorProfile`, `Goal`, `Debt`, `Field`, `AdvisorProfileStore`), `advisor/room.ts` (`computeRoom`, `roomFromStated`, `RoomResult`), `advisor/capacity.ts` (`scoreCapacity`, `capacityInputs`), `advisor/publicFact.ts`, `advisor/vaultSections.ts`; `personalView`, `proposeFixedCosts`, `proposeDebts`, `proposeSavings`, `historyCoverage` (Task 3); `computeRoom` / `RoomResult` (Task 4); `scoreCapacity`, `bufferMonths`, `capacityInputs` (Task 5); `View` values `intake`, `about-you` and widget ids `room-card`, `intake-invite` (Tasks 6-8). Do not redefine any of these. If a name differs after the intake lands, change the ONE adapter file `plan/profileView.ts` (Task 1), not the sections.

## Global Constraints

- New TypeScript logic uses Effect 4 (Schema, TaggedError, DateTime, Predicate); no hand-written predicates; no `Date.now()` / `new Date()` in core (take `asOf: string`, ISO date). Month arithmetic only through intake `months.ts`. Read `repos/effect/LLMS.md` first. Existing non-Effect code is ported only when touched.
- Every number shown is computed in code, integer cents (`Number.isInteger`), and covered by tests. No section function calls the AI, reads the clock or touches the network. Money functions get a mutation check (Review step in Task 13).
- Information and education only. Nothing in code or copy says what the user should buy, where, or how much. Anti-goals: an AI-produced number; moralising; an unlicensed benchmark; a highlighted or pre-selected "best" row anywhere (default sort by name, user-sortable).
- Personal scope (intake 10.1): accounts assigned to a business entity are excluded from income, room, fixed costs, buffer, debts, spending, subscriptions and cards; no entities set means all accounts count. Use intake `personalView`. The plan is passed UNSCOPED `accounts`/`txs` (not `scopedAccounts`).
- Works without bank data (P6): sections say what is missing and compute nothing they cannot; nothing is extrapolated.
- Statuses: three values (`on-track`, `attention`, `not-enough-data`) from one versioned table `PLAN_THRESHOLDS`; chips use a word AND a symbol, never colour alone. A status is a prompt to look, never a verdict. Buffer plan status uses the user's own target; the capacity bands (intake 10.3) are never merged with it; capacity shows only in section 7 beside tolerance.
- One advice-language list: import `findAdviceLanguage` from `packages/core/src/advice/language.ts`; this plan defines no second list. No template uses a banned word ("best", "beste", "recommend", "we raden aan", "safe", "veilig", "good deal", "typical", "typisch", "people / households like you", "mensen zoals jij", "huishoudens zoals het jouwe", imperatives, ticker/ISIN patterns).
- Public facts (gift tax, box 3, Nibud, AFM, SPIVA, DUO, card terms) go through `PublicFact` with `verifiedOn`; a fact without it cannot render. This plan ships NO verified fact (spec section 15 is open); the mechanism and pending ids ship, the text stays hidden.
- Copy: NL and EN typed-complete (`Record<Locale, T>`) in `apps/web/src/copy/plan/`, one module per section; a missing status, reason key, wording key or empty-state reason fails the build (use exhaustive `Record<Union, string>`). No Dutch outside copy modules; logic returns a KIND, copy renders it (`lavega_i18n_boundary`). New modules join `copy/parity.test.ts`.
- Investing app (`apps/investing-*`) unchanged. `packages/core/src/plan/scenarios.ts` is the only home of required-monthly-saving and compound maths.
- Local-first: nothing new on the server; plan state only in the encrypted vault.
- Motion, if any: restrained; load `emil-design-eng` / `animate` before writing CSS transitions (LaVega is a trust-sensitive context).
- Implementers never commit or push. Each task ends with `git add -N <new files>` (owner commits).
- Verify commands (repo root): `pnpm --filter @lavega/core test -- <pattern>`, `pnpm --filter @lavega/web test -- <pattern>`, `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- Line numbers below are from the worktree BEFORE the intake lands (`App.tsx` 1823 lines, `appRoutes.ts` View union at 7-20). The intake edits the same files, so find each point by the quoted anchor, not the number.

## Review Focus

1. Zero transactions, under 60 days, or no bank at all (profile-only user): every section returns `not-enough-data` with typed `missing`, no NaN/Infinity, no extrapolated figure, FactSheet still builds (Tasks 3-8).
2. Zero or negative income / room, goal with target date today or in the past, `years left <= 0`: shares are null, required monthly saving is null (not Infinity), "unallocated" stops and names the missing deduction; negative room renders as a negative number with neutral words (Tasks 2, 3, 7).
3. Mixed personal/business accounts and non-EUR accounts or savings pockets: business excluded, foreign rows excluded and counted, a goal-linked foreign account is not summed at face value (Tasks 3, 4, 7).
4. Stale or foreign state: vault with no `plan` section, snapshots from an older `thresholdsVersion`, two devices appending the same event id, a subscription decision for a stream that no longer exists, a goal deleted while a linked account still exists (Tasks 1, 5, 8, 10).
5. Wording leaks: a template that names a product, says "you can invest", ranks or highlights a row, or reads a banned word only in one locale; a `PublicFact` without `verifiedOn` rendering (Tasks 6, 7, 9, 11, 12).

---

## File Structure

Core, new folder `packages/core/src/plan/` (exported via `export * from "./plan/index.js"` added to `packages/core/src/index.ts`, after the line `export * from "./spendPercentile.js";` (find by text; currently line 47)):
- `types.ts` shared section types; `thresholds.ts` `PLAN_THRESHOLDS`; `profileView.ts` the one adapter over the intake profile; `preferences.ts` `PlanPreferences`, `PlanSnapshot`, `PlanEvent` schemas and event-derived state; `factsheet.ts` FactSheet schema, bucketing, hash.
- `scenarios.ts` compound maths and the public table.
- `month.ts`, `buffer.ts`, `debts.ts`, `spending.ts`, `subs.ts`, `cards.ts`, `goals.ts` one per section; `publicFacts.ts` pending fact ids and the study template; `compute.ts` `computePlan`; `changes.ts` snapshot diff, triggers, refresh policy; `index.ts`.
Web:
- `apps/web/src/views/Plan.tsx` (+ `plan/` folder `PlanHeader.tsx`, `BackboneStrip.tsx`, `ChangeLog.tsx`, `SectionCard.tsx`, one `*Section.tsx` per section, `ScenarioTable.tsx`); `apps/web/src/plan/usePlan.ts` (state, persistence, refresh); `apps/web/src/plan/heldCards.ts` (builds `HeldCardInput[]` from accounts, facts, catalogue).
- `apps/web/src/copy/plan/{shell,month,buffer,debts,spending,subscriptions,cards,goals,wording}.ts`.

---

### Task 1: Plan types, thresholds, profile adapter, preferences, events, FactSheet schema

**Files:**
- Create: `packages/core/src/plan/types.ts`, `thresholds.ts`, `profileView.ts`, `preferences.ts`, `factsheet.ts`, `index.ts` and a `.test.ts` for `thresholds`, `preferences`, `factsheet`, `profileView`
- Modify: `packages/core/src/index.ts` (add the export line after `export * from "./spendPercentile.js";`, currently line 47)
- Reuse: `hash()` from `packages/core/src/hash.ts:3`; intake `mergeEvents`, `PublicFact`

**Interfaces:**
- Consumes: intake `AdvisorProfile`, `Goal`, `Debt`, `Field`, `mergeEvents` (event envelope `{ id, kind, at }`).
- Produces (`types.ts`):
  - `SECTION_IDS = ["month","buffer","debts","spending","subscriptions","cards","goals"] as const`; `type SectionId`
  - `type PlanStatus = "on-track" | "attention" | "not-enough-data"`
  - `type FigureUnit = "cents" | "months" | "ratio" | "pct" | "count" | "date" | "years"`; `type FigureValue = { unit: FigureUnit; value: number | string | null }`; `type FigureMap = Record<string, FigureValue>`
  - `STATUS_REASON_KEYS` const tuple and `type StatusReasonKey`: month `room-ok | room-low | month-negative | history-short`; buffer `at-target | below-target | no-fixed-costs | no-savings`; debts `no-debt | debt-payments | debt-rate-missing`; spending `within-limits | no-limits | over-limit-two-months | history-short-6m`; subscriptions `clean | price-increase | overlap | none-short-history`; cards `no-better-card | better-card-exists | no-card-data | no-cardable-spend`; goals `on-schedule | behind-schedule | no-goals | no-room`
  - `type StatusReason = { key: StatusReasonKey; params?: Record<string, string | number> }`
  - `MISSING_KINDS` tuple / `type MissingKind`: `bank-data | history-60d | history-90d | history-6m | savings-balance | fixed-costs | buffer-target | debt-rate | cards | cardable-spend | goals | room | stated-range`; `type MissingAction = "connect-bank" | "import" | "intake-question" | "enter-figure"`; `type Missing = { kind: MissingKind; action: MissingAction; ref?: string }`
  - `type CalcStep = { id: string; inputs: FigureMap; output: FigureValue }` (rendered as "how we calculated this"; tests assert it)
  - `type Polarity = "positive" | "negative" | "neutral"`
  - `type PlanFact = { factId: string; section: SectionId; exact: number | string; unit: FigureUnit; polarity: Polarity; mustMention: boolean; trend?: { direction: "up" | "down" | "flat"; vs: string }; range?: { low: number; expected: number; high: number; horizon?: string; assumption?: string }; derivedFrom?: string[] }`
  - `type SectionResult<F> = { section: SectionId; figures: F; flat: FigureMap; headline: FigureValue | null; status: PlanStatus; statusReason: StatusReason; missing: Missing[]; calc: CalcStep[]; facts: PlanFact[] }`
  - `type PlanInput = { profile: PlanProfile; txs: Tx[]; accounts: Account[]; entityProfiles: EntityProfile[]; rules: Rule[]; own: OwnAccounts; rewards: RewardsBalance[]; catalogue: readonly CatalogueEntryLike[]; rates: readonly RateBenchmark[]; heldCards: HeldCardInput[]; preferences: PlanPreferences; events: PlanEvent[]; mode: ConversionMode; fxHistory: Record<string, Record<string, number>>; movedCategories: ReadonlySet<string>; asOf: string }` (an object, not the spec's positional tuple; `HeldCardInput` is declared in Task 6 `cards.ts` and re-exported; declare it as a type-only import cycle-free by defining it in `types.ts` as `{ accountKey: string; label: string; cashback: HeldCashback; fee: ProductFee | null; fxFeePct: number | null; pointsPerEuro: number | null; programId: string | null }`)
- Produces (`thresholds.ts`): `PLAN_THRESHOLDS` with `version: "plan-thresholds-1"` and: `month: { roomShareOnTrack: 0.10; history: { minDays: 60 } }`, `spending: { minMonths: 6; overLimitMonths: 2 }`, `subscriptions: { minDays: 90; increasePctMin: 0.03; increaseCentsMin: 50 }` (the last two mirror `subscriptionPriceIncreases`, `subscriptions.ts:1678`; a test asserts they agree), `cards: { betterCardMargin: 0.10; horizonMonths: 12 }`, `goals: { within12Months: 12 }`, `noise: { cents: 1000; months: 0.1; ratio: 0.01; pct: 0.1 }` (absolute noise bounds for the change log, builder-tunable per spec 17), `scenarioRates: [0, 0.02, 0.04, 0.06]`. File comment: placeholders, not research-backed.
- Produces (`profileView.ts`): `type PlanProfile = { incomeStreams: …; housingMonthlyCents: number | null; fixedCostsMonthlyCents: number | null; debts: Debt[]; bufferTargetMonths: number | null; goals: PlanGoal[]; children: { id: string; birthYear: number }[]; tolerance: 1|2|3|4|5 | null; experience: "beginner"|"some"|"experienced" | null; savingsStatedCents: number | null; incomeStatedRange: { lowCents: number; highCents: number } | null; spendStatedRange: …| null; intakeBlocksDone: number; profileHash: string; removed: string[] }`, `type PlanGoal = { goal: Goal; since: string /* the Field.at of the goal, start of its straight-line schedule */ }`, and `planProfileOf(store: AdvisorProfileStore | null): PlanProfile` (null store gives the empty profile with `intakeBlocksDone: 0`). `profileHash` = `hash(JSON.stringify(current))` of the current profile. This file is the only plan code that reads intake profile internals. Read `packages/core/src/advisor/profile.ts` first; the intake plan leaves `goals` as either `Field<Goal[]>` or `Field<Goal>[]` (UNVERIFIED), adapt here.
- Produces (`preferences.ts`, Effect Schema, all with `Schema.decodeUnknownSync` at the vault boundary and a `PlanDecodeError` `Schema.TaggedError`):
  - `PlanPreferences = { categoryLimits: Record<string, { cents: number; at: string }>; redemptionExamples: { id: string; programId: string; pointsSpent: number; cashPriceSavedCents: number; at: string }[]; pointsExpiry: Record<string, string /* ISO date, user typed */>; nibudBufferResult: { cents: number; at: string } | null; studyCostAssumptions: StudyAssumptions | null; extraDebtPayment: Record<string /* debtId */, { cents: number; at: string }>; bufferTopUpMonths: { months: number; at: string } | null; goalMonthsOverride?: never }` plus `emptyPlanPreferences()`; newest write wins (the intake merge for `plan`).
  - `StudyAssumptions = { monthlyCostCents: number; months: number; tuitionCents: number; inflationPct: number; at: string }` (no defaults; the template is preloaded with none)
  - `PlanSnapshot = { asOf: string; thresholdsVersion: string; engineVersion: string; profileHash: string; trigger: RefreshTrigger; sections: Record<SectionId, { status: PlanStatus; statusReason: StatusReason; flat: FigureMap }>; markers: PlanMarkers }`; `PlanMarkers = { incomeMedianCents: number | null; incomeStreamIds: string[]; flaggedIncreaseKeys: string[]; goalsWithin12m: string[]; debtIds: string[]; childCount: number; cardKeys: string[]; pointsProgramIds: string[]; bufferBelowWish: boolean }`
  - `RefreshTrigger = "open-stale" | "new-month" | "manual" | "income-level" | "income-stream" | "price-increase" | "goal-soon" | "buffer-below-wish" | "new-debt" | "new-child" | "new-card" | "new-points" | "profile-edit"`
  - `PlanEvent = SubscriptionDecision | UsageLog` where `SubscriptionDecision = { id: string; kind: "subscription-decision"; at: string; streamKey: string; decision: "keep" | "review" | "cancel" | "clear" }` and `UsageLog = { id: string; kind: "usage-log"; at: string; streamKey: string; month: string /* YYYY-MM */ }`
  - `subscriptionStateOf(events: readonly PlanEvent[]): Map<string /*streamKey*/, { decision: "keep"|"review"|"cancel" | null; usedMonths: string[] }>` derives current state from the log (latest decision by `at` then `id`; `clear` resets to null; usage months unique, sorted). Never stored.
  - `PlanSection = { preferences: PlanPreferences; snapshots: PlanSnapshot[] }`: the value stored in the intake vault section `plan` (intake merge: preferences newest write wins, snapshots keyed by month, 13 kept). `decodePlanSection(raw: unknown): PlanSection` returns `{ preferences: emptyPlanPreferences(), snapshots: [] }` for an absent section. Events live in the intake `events` section as `{ id, kind, at }` envelopes; `PlanEvent` kinds are `subscription-decision` and `usage-log`; the AI layer adds `explanation` and `outcome`. Every reader filters by `kind` and ignores kinds it does not know (test).
  - `addSnapshot(snapshots: PlanSnapshot[], next: PlanSnapshot): PlanSnapshot[]` keeps the last 13, one per month (a second snapshot in the same `isoMonth` replaces the first).
- Produces (`factsheet.ts`): `FactSheet = { id: string; taskType: "plan" | "digest" | "note"; locale: "nl" | "en"; engineVersion: string; generatedAt: string; hash: string; facts: FactSheetFact[] }` with `FactSheetFact = { factId, section: SectionId | null, exact: number | string, bucket: string, unit, polarity: Polarity, trend?, range?, mustMention, derivedFrom? }` (AI spec 10; `section` is browser-only and lets the AI layer group returned sentences by section). CONTRACT WITH THE AI-LAYER PLAN (it must not rename or redefine any of this): file `packages/core/src/plan/factsheet.ts`, names `FactSheet`, `FactSheetFact`, `PLAN_ENGINE_VERSION`, `bucketOf`, `buildFactSheet`; `Polarity` lives in `plan/types.ts`; the whole-plan entry point is `PlanResult.factSheet(locale, taskType = "plan")` (Task 8); `PLAN_ENGINE_VERSION = "plan-1"`; `bucketOf(unit: FigureUnit, exact: number | string): string` (cents: sign-aware ranges "<0", "0-250", "250-500", "500-1k", "1k-2.5k", "2.5k-5k", "5k-10k", "10k+" in euros; months: "<1","1-3","3-6","6+"; ratio/pct: tenth bands "0.0-0.1"…; count: exact when <=5 else "6+"; date: year-quarter "2027-Q2"; years: "<1","1-3","3-10","10+"); `buildFactSheet(facts: PlanFact[], ctx: { locale: "nl" | "en"; asOf: string; taskType?: "plan" | "digest" | "note" }): FactSheet` where `hash` = `hash(JSON.stringify(facts.map(f => [f.factId, f.exact, f.polarity, f.mustMention, bucketOf(...)])) + engineVersion + locale + taskType)` (excludes `generatedAt` and `id`, so an unchanged plan keeps its hash), `id` = `fs-` + hash.

- [ ] **Step 1: Write failing tests**

```ts
// thresholds.test.ts
test("subscription thresholds equal subscriptionPriceIncreases' constants", () => {
  const sub = { changePct: 0.03, firstAmountCents: 1000, lastAmountCents: 1050 } as Subscription;
  expect(subscriptionPriceIncreases([sub])).toHaveLength(1);                        // 3% and 50 cents pass
  expect(subscriptionPriceIncreases([{ ...sub, lastAmountCents: 1049 }])).toHaveLength(0);
  expect(PLAN_THRESHOLDS.subscriptions).toMatchObject({ increasePctMin: 0.03, increaseCentsMin: 50 });
});
// preferences.test.ts
test("subscriptionStateOf: latest decision wins, clear resets, usage months unique and sorted", ...)
test("mergeEvents of two devices holding the same event id yields one event; state identical both orders", ...)
test("decision for a streamKey that no longer exists is kept in state but never throws", ...)
test("decodePlanSection(undefined) is empty; an events array holding explanation/outcome events next to plan events: subscriptionStateOf ignores the unknown kinds", ...)
test("addSnapshot keeps 13, one per month, second same-month snapshot replaces first", ...)
test("PlanPreferences decode rejects non-integer cents and round-trips JSON; empty vault section decodes to emptyPlanPreferences()", ...)
// factsheet.test.ts
test("bucketOf boundaries: cents 0, 24999/25000, negative; months 0.99/1/3/6", ...)
test("hash is stable when generatedAt changes, changes when any exact/polarity/mustMention changes", ...)
test("buildFactSheet never contains a counterparty, IBAN or free text (facts carry only ids, numbers, dates)", ...)
// profileView.test.ts
test("planProfileOf(null) is the empty profile with intakeBlocksDone 0 and no NaN", ...)
test("goal 'since' is the Field.at of the goal", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/` Expected: FAIL (files missing).
- [ ] **Step 3: Implement** the files above. Schemas via `Schema.Struct`/`Schema.Class`; `Number.isInteger` refinement on every `*Cents`. `bucketOf` is a table, not formulas, so each boundary is a data row.
- [ ] **Step 4: Run** the same command plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** the stale-state tests above (4).
- [ ] **Step 6:** `git add -N packages/core/src/plan` (owner commits).

---

### Task 2: Scenario module (`scenarios.ts`)

**Files:**
- Create: `packages/core/src/plan/scenarios.ts`, `scenarios.test.ts`
- Modify: `packages/core/src/plan/index.ts`

**Interfaces:**
- Consumes: `PLAN_THRESHOLDS.scenarioRates`.
- Produces:
  - `SCENARIO_ASSUMPTIONS = { compounding: "monthly", contributions: "month-end", return: "constant", tax: "none", inflation: "none" } as const` (printed beside every table)
  - `futureValueCents(i: { monthlyCents: number; months: number; annualRate: number }): number` annuity FV, monthly rate = `annualRate / 12`, contributions at month end, rounded once half-up to integer cents at the end; rate 0 gives `monthlyCents * months`
  - `requiredMonthlyCents(i: { targetCents: number; savedCents: number; months: number; annualRate: number }): number | null` the ONE definition of "required monthly saving": `(target - saved * (1+r)^n) / annuityFactor`, clamped to 0 when already funded, null when `months <= 0`; saved grows at the same rate; rounded up to whole cents (`Math.ceil`) so the target is reached
  - `publicScenarioTable(): { monthlyCents: 10000; years: 18; paidInCents: 2160000; grossRates: [0.02,0.04,0.06]; costs: [0.002,0.015]; cells: { grossRate: number; costRate: number; endCents: number }[] }` (6 cells; net rate = gross - cost; every cell from `futureValueCents`; no input parameters, no editable variant)
  - `goalScenarioRows(i: { targetCents; savedCents; months }): { annualRate: number; requiredMonthlyCents: number | null }[]` rows for rates 0, 0.02, 0.04, 0.06
  - `lossIllustration(i: { amountCents: number; fallPct: 30; roomMiddleCents: number | null }): { lossCents: number; monthsOfRoom: number | null }` (null when room <= 0)
  - `HISTORICAL_FALLS: { id: "2008" | "2020"; … }[]` is NOT numeric here; the depth/recovery figures are `PublicFact`s (Task 7), so this module holds no market numbers.

- [ ] **Step 1: Write failing tests**

```ts
test("closed formula: 100/month, 216 months, 0%: 2_160_000", () => {
  expect(futureValueCents({ monthlyCents: 10000, months: 216, annualRate: 0 })).toBe(2160000);
});
test("table cells equal the closed formula P*((1+i)^n-1)/i with i=(g-c)/12, rounded half-up", () => {
  // literals computed independently with a one-off `node -e` annuity formula, in cents:
  const want = { "0.02/0.002": 2548745, "0.02/0.015": 2259691, "0.04/0.002": 3093627,
                 "0.04/0.015": 2724376, "0.06/0.002": 3793286, "0.06/0.015": 3318680 };
  for (const c of publicScenarioTable().cells) expect(c.endCents).toBe(want[`${c.grossRate}/${c.costRate}`]);
});
test("hand-checked cell: 4% gross, 0.2% cost = 3.8% net -> 30_936.27 euro", () => {
  expect(publicScenarioTable().cells.find(c => c.grossRate === 0.04 && c.costRate === 0.002)!.endCents).toBe(3093627);
});
test("the research's 5% example is not a column", () => { expect(publicScenarioTable().grossRates).not.toContain(0.05); });
test("required monthly: target 1_000_000, 0 saved, 120 months: 0% -> 8334 (ceil of 8333.33), 4% -> 6792 (ceil of 6791.18)", ...)
test("round trip: futureValueCents(requiredMonthlyCents) >= target and one cent less is < target", ...)
test("saved already above target -> 0; months 0 or negative -> null, never Infinity", ...)
test("saved grows at the stated rate in the required-saving formula", ...)
test("lossIllustration: 30% of 1_000_000 = 300_000 = 4.7 months of 64_000 room (rounded to 0.1); room <= 0 -> monthsOfRoom null", ...)
test("module contains no tax or inflation parameter (no export named *tax* / *inflation*)", ...)
```
The literals above were computed with `node -e` during planning; the implementer re-derives them independently before trusting them and records the check in a test comment. The 0% `8334` is `ceil(8333.33)`.

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/scenarios` Expected: FAIL.
- [ ] **Step 3: Implement** with plain numbers (no Effect needed beyond Schema-free pure functions; per AGENTS.md "Effect for new logic" covers Schema/typed errors; keep these as pure functions returning values). Month counts come in as integers; the caller uses `monthsBetween`.
- [ ] **Step 4: Run** the command plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** target date today/past (months <= 0), rate 0, saved above target (Focus 2).
- [ ] **Step 6:** `git add -N packages/core/src/plan/scenarios*` (owner commits).

---

### Task 3: Sections 1 and 2: Your month and Buffer

**Files:**
- Create: `packages/core/src/plan/month.ts`, `month.test.ts`, `buffer.ts`, `buffer.test.ts`
- Modify: `packages/core/src/plan/index.ts`
- Reuse (read before use): `computeRoom`/`roomFromStated` (intake Task 4), `proposeFixedCosts`, `personalView`, `historyCoverage` (intake Task 3), `bufferMonths` (intake Task 5), `categorize`, `ownAccountNamed` (`views.ts:149`, returns the matched identifier string, not an account; resolve it to an account through `own.byKey` / `Account.iban`), `accountTypeKind` (`balance.ts:78`), `isEurCurrency` (`model.ts:115`), `withCurrentBalances` (`balance.ts:100`)

**Interfaces:**
- Consumes: Task 1 types; `PlanInput`.
- Produces:
  - `export type MonthFigures = { room: RoomResult; incomeMiddleCents: number | null; fixedCents: number | null; fixedShare: number | null; variableCents: number | null; variableShare: number | null; savingsRate: number | null; savingsMovedCents: number | null; habits: ("pay-yourself-first" | "automatic-transfer" | "annual-review")[]; nibudGuidanceFactId: "nibud-save-10pct" }`
  - `computeMonth(i: PlanInput): SectionResult<MonthFigures>`
  - `export type BufferFigures = { liquidSavingsCents: number | null; fixedCostsMonthlyCents: number | null; incomeBufferMonths: number | null; targetMonths: number | null; gapCents: number | null; gapMonths: number | null; closeMonths: { low: number; high: number } | "not-reachable" | null; objectBufferCents: number | null; objectShareOfSavings: number | null; excludedForeignCount: number; goalLinkedExcludedCents: number }`
  - `computeBuffer(i: PlanInput, month: SectionResult<MonthFigures>): SectionResult<BufferFigures>`
  - `fixedCostsMonthlyCentsOf(i: PlanInput): { cents: number | null; lines: { id: string; cents: number }[] }` exported from `month.ts` (the one definition: housing plus recurring outgoing plus subscriptions via `proposeFixedCosts`, minus fingerprints in `profile.removed`; a confirmed/stated `profile.fixedCostsMonthlyCents` wins when present)

Rules to implement (spec 6, 7, 5):
- Room: call `computeRoom` unchanged; `roomFromStated` when no transactions but `profile.incomeStatedRange` and `spendStatedRange` exist. Median month = `middleCents`; low/high from the result. Status: `on-track` when `middleCents >= 0.10 * incomeMiddle` and no month negative; `attention` when below, or any of the three months negative; `not-enough-data` when `historyCoverage(...).days < 60` and no stated ranges. Reasons per `STATUS_REASON_KEYS`.
- Fixed vs variable: fixed = `fixedCostsMonthlyCentsOf`; variable = median-month outgoing minus fixed, floored at 0 with a `calc` step noting the floor; shares over `incomeMiddleCents`, null when income <= 0. State in `calc` that this is a split by detection, not a category taxonomy.
- Savings rate: (money moved to the user's own savings accounts plus room) over net income, averaged over the same three months; "moved" = outgoing txs categorised `"Eigen overboeking"` whose matched own identifier resolves to an account with `accountTypeKind === "savings"` in personal scope. No shortfall amount is ever computed; no "could invest" figure exists. The Nibud 10% line is the `PublicFact` id `nibud-save-10pct` (hidden until verified, Task 7).
- Buffer: liquid savings = EUR savings and current accounts of the personal scope (balance rolled forward with `withCurrentBalances`) minus balances of accounts linked to goals by `accountRefs` (bank refs; `goalLinkedExcludedCents` reports the subtraction); non-EUR accounts excluded and counted. Months = `bufferMonths(liquid, fixed)`. Target = `profile.bufferTargetMonths` only; no target means `missing: buffer-target` and no gap computed against a default. Gap in cents (`target*fixed - liquid`, floored at 0) and months. `closeMonths` = gap / room high and gap / room low, rounded up, or `"not-reachable"` when room low or middle <= 0; no date. Object buffer = typed `preferences.nibudBufferResult`, share of liquid savings; null without it. Status per spec table: `on-track` months >= target; `attention` below; `not-enough-data` when fixed costs or savings balance missing. Irregular/self-employed income adds a flag fact only (`calc` unchanged, status unchanged).
- Facts (ids): `room_month` (middle, range low/high, polarity negative when middle < 0 else neutral, mustMention when middle < 0), `room_low`, `room_high`, `fixed_share`, `savings_rate`, `buffer_months`, `buffer_gap` (negative when gap > 0), `buffer_gap_months`; derived per-year facts as their own ids (`room_year` = middle * 12).

- [ ] **Step 1: Write failing tests** (fixtures with a `tx()` helper as in `subscriptions.test.ts`; `asOf` fixed):

```ts
test("room is the intake RoomResult unchanged (same object fields), median-by-net month is the headline", ...)
test("status edges: share 0.10 exactly -> on-track; 0.0999 -> attention; one negative month with positive median -> attention", ...)
test("under 60 days and no stated ranges -> not-enough-data with missing bank-data; with stated ranges -> room from roomFromStated, status not-enough-data NOT used", ...)
test("fixed 1500 + variable 1000 over income 3200: shares 0.469 and 0.3125 as ratios; calc lists the detection note", ...)
test("income 0: shares null, no NaN/Infinity anywhere in flat", ...)
test("savings rate: 200 moved to own savings account + room 400 over income 3000 = 0.2; moved to a business account's savings is excluded", ...)
test("no shortfall or 'could invest' figure exists in figures or facts (key scan)", ...)
test("buffer: liquid 4100 / fixed 1700 = 2.41 months (2 dp), target 4 -> gap months 1.59, gap cents 2700", ...)
test("goal-linked account balance is excluded from liquid savings and reported; non-EUR savings excluded and counted", ...)
test("no buffer target -> missing buffer-target, gap null, status not-enough-data, no default of 3 or 6 used", ...)
test("room low <= 0 -> closeMonths 'not-reachable'; room 300..600 and gap 2700 -> {low: 5, high: 9}", ...)
test("objectBuffer share: typed 5000 against savings 10000 = 0.5; absent -> null", ...)
test("business-entity account txs and balances excluded; no entities -> all counted", ...)
test("negative middle room: fact room_month polarity negative and mustMention true", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/month plan/buffer` Expected: FAIL.
- [ ] **Step 3: Implement** both functions as compositions of the intake functions; every `calc` step lists inputs as `FigureMap`; `flat` holds the snapshot figures (`room_middle`, `room_low`, `room_high`, `income_middle`, `fixed_share`, `savings_rate`, `buffer_months`, `buffer_gap_cents`).
- [ ] **Step 4: Run** the same command plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** tests for income 0, foreign savings, business-only accounts (Focus 1, 2, 3).
- [ ] **Step 6:** `git add -N packages/core/src/plan/month* packages/core/src/plan/buffer*` (owner commits).

---

### Task 4: Sections 3 and 4: Debts and Spending per category

**Files:**
- Create: `packages/core/src/plan/debts.ts`, `debts.test.ts`, `spending.ts`, `spending.test.ts`
- Modify: `packages/core/src/plan/index.ts`
- Reuse: `proposeDebts` (intake Task 3), `keptRate`/`bestRate`/`resolveAccountRate` (`interest.ts:245, 256, 478`), `RATES_AS_OF` (`interest.ts:154`), `categorySpendPercentiles`, `MIN_HISTORY_PERIODS`, `SpendRow` (`spendPercentile.ts:52, 70, 240`), `categorize`, `toEur` (`fx.ts:119`)

**Interfaces:**
- Produces:
  - `DebtRow = { id: string; lender: string; balanceCents: number | null; ratePct: number | null; rateSource: "stated" | "detected" | null; monthlyCents: number; interestPerYearCents: number | null; payoffMonths: number | null; payoffDate: string | null; withExtra: { extraCents: number; payoffMonths: number | null; monthsEarlier: number | null; interestSavedCents: number | null } | null; kind: "consumer" | "duo" | "other" }`
  - `DebtFigures = { rows: DebtRow[]; totalInterestPerYearCents: number | null; savingsRatePct: number | null; bestFreeRate: { ratePct: number; bank: string; product: string; asOf: string; sourceKey: "catalogue" | "comparison" | "bundled" } | null; invisibleDebtNotice: true }`
  - `computeDebts(i: PlanInput): SectionResult<DebtFigures>`
  - `amortise(i: { balanceCents: number; ratePct: number; paymentCents: number; extraCents?: number }): { months: number | null; interestCents: number }` monthly compounding `ratePct/12`, month-end payments, `months: null` when the payment does not cover interest (never loops forever; cap 1200 iterations)
  - `SpendHistoryRow = { category: string; lastMonthCents: number; avg3Cents: number; median12Cents: number | null; trend6: number[] /* oldest first, cents, null-free */; percentile: number | null; percentileReason: PercentileReason | null; limitCents: number | null; overLimitMonths: number }`
  - `SpendingFigures = { months: number; rows: SpendHistoryRow[]; externalBenchmark: ExternalBenchmark | null; budgetAdviceLink: "nibud-persoonlijk-budgetadvies" }`
  - `ExternalBenchmark = { source: string; year: number; householdType: string; licenceId: string; valuesByCategory: Record<string, number> }` (typed slot; `computeSpending` always sets `null` at launch)
  - `spendHistory(i: { txs: Tx[]; accounts: Account[]; entityProfiles: EntityProfile[]; rules: Rule[]; own: OwnAccounts; asOf: string; mode: ConversionMode; fxHistory: …; movedCategories: ReadonlySet<string> }): { months: string[]; byCategory: Map<string, Map<string, number>>; excludedForeignCount: number }` the new spend-history function (per category per full calendar month, personal scope, outgoing only, moved categories excluded)
  - `computeSpending(i: PlanInput): SectionResult<SpendingFigures>`

Rules (spec 8, 9):
- Debts per row: interest per year = `round(balance * ratePct / 100)`; payoff at the current payment via `amortise`; `withExtra` from `preferences.extraDebtPayment[id]` (default none: `null`). A debt without a rate is listed with no cost, `missing: debt-rate` (action `enter-figure`), and is NEVER assigned one. Savings rate beside it = the user's own kept rate (`resolveAccountRate` → `keptRate` basis) shown only if known; best free-access rate from `bestRate(rates, true)` with its date and provenance. No "expensive" label from any threshold. DUO rows get `kind: "duo"` and carry no rule text (DUO rules are UNVERIFIED, spec 15.6). Status (precedence: not-enough-data first): any debt without a rate -> `not-enough-data` (`debt-rate-missing`) only when no stated rate exists for it; otherwise any debt with payments -> `attention` (`debt-payments`); no visible or stated debt -> `on-track` (`no-debt`). `invisibleDebtNotice: true` always (absence is never "debt-free"). Decision to flag: spec table rows overlap for "a debt without a rate"; this precedence resolves it.
- Spending: `months` = number of full calendar months of history (via `months.ts`). `percentile` comes from `categorySpendPercentiles` fed with `SpendRow[]` built from `spendHistory`, only when `months >= 6` else `percentile: null` with reason `te-weinig-geschiedenis` (kind passthrough; copy renders). Last month / 3-month average / 12-month median per category; trend6 numbers. Limits from `preferences.categoryLimits`. `overLimitMonths` = consecutive most-recent months above limit. Status: `not-enough-data` under 6 months (plain monthly totals still computed); `attention` when any category has `overLimitMonths >= 2`; else `on-track` (`within-limits` if limits exist, `no-limits` otherwise). Comparison is only ever against the user's own history.
- Facts: `debt_interest_year:<debtId>` (negative polarity? NO: neutral; interest is a fact, not a judgement), `debt_payoff_months:<debtId>`, `debt_extra_saving:<debtId>`, `savings_rate_pct`, `spend_last_month:<category>`, `spend_median12:<category>`, `spend_trend:<category>` (trend direction), `spend_over_limit:<category>` (negative, mustMention false).

- [ ] **Step 1: Write failing tests**

```ts
test("amortise: 10000 at 9.5%, payment 300 -> months matches the closed form ceil(-ln(1-iB/P)/ln(1+i)); payment below interest -> months null", ...)
test("interest per year = round(balance*rate/100): 12000 at 9.5% -> 1140 euro in cents 114000", ...)
test("extra 50/month on the loan: monthsEarlier and interestSaved are positive integers and extra 0 equals base", ...)
test("debt without rate: row has interestPerYearCents null, missing debt-rate, no rate invented; status not-enough-data", ...)
test("no debts -> on-track and invisibleDebtNotice true; missing nothing; fact list has no 'debt-free' fact", ...)
test("DUO recognised as kind duo; no rule text field exists on the row", ...)
test("savings rate and best free rate carry their asOf and provenance; no rate -> null, not 0", ...)
test("no figure labels a debt 'expensive': figures contain no such key at any rate (0.1%, 9.5%, 29%)", ...)
test("spendHistory: personal scope only, moved categories dropped, foreign rows without rate excluded and counted", ...)
test("5 months of history -> not-enough-data, totals present, percentile null; 6 months -> percentile from categorySpendPercentiles", ...)
test("limit 400, last two months 420 and 410 -> overLimitMonths 2 -> attention; 420 then 390 -> 0 -> on-track", ...)
test("no limits set and 6+ months -> on-track no-limits; externalBenchmark is null", ...)
test("12-month median with only 7 months present uses the 7 and says so (calc), never pads", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/debts plan/spending` Expected: FAIL.
- [ ] **Step 3: Implement.** `spendHistory` reuses `categorize` + `toEur` the way `categoryShare` does (`apps/web/src/components/blocks/statistics.ts:~825-860`), but the moved-category set is passed in (`movedCategories`, built in the web layer from `MOVED_CATEGORIES`, `statistics.ts:88`) so core does not import web code.
- [ ] **Step 4: Run** the command plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** zero-rate debt, payment below interest, 59 vs 61 days (months boundary), foreign rows (Focus 1, 2, 3).
- [ ] **Step 6:** `git add -N packages/core/src/plan/debts* packages/core/src/plan/spending*` (owner commits).

---

### Task 5: Section 5: Subscriptions

**Files:**
- Create: `packages/core/src/plan/subs.ts`, `subs.test.ts`
- Modify: `packages/core/src/plan/index.ts`
- Reuse: `detectSubscriptions` (`subscriptions.ts:1529`), `subscriptionPriceIncreases` (`:1678`), `subscriptionOverlaps` (`:1706`), `subscriptionCoverage` (`:1328`), `Subscription` (`:10`, fields `key`, `merchant`, `function`, `monthlyCents`, `firstAmountCents`, `lastAmountCents`, `changePct`, `occurrences`, `lastDate`, `skippedCycles`); `subscriptionStateOf` (Task 1). Intake Task 3 adds `txIds: string[]` to `Subscription` (member transaction ids); this task needs it. If it is not there yet, stop and report; do not re-derive membership by key.

**Interfaces:**
- Produces:
  - `priceChange(sub: Subscription, txs: readonly Tx[]): { changeDate: string; fromCents: number; toCents: number } | null` new code: the first charge at the new price, from `sub.txIds` sorted by date; null when the stream never changed price at the existing thresholds
  - `SubRow = { key: string; name: string; function: string; monthlyCents: number; yearlyCents: number; monthsActive: number; priceChange: { changeDate: string; fromCents: number; toCents: number; changePct: number } | null; overlapGroup: string | null; overlapCombinedMonthlyCents: number | null; skippedCycles: number; usage: "unknown" | { loggedMonths: number; lastLoggedMonth: string; costPerUseCents: number }; decision: "keep" | "review" | "cancel" | null; facts: ("price-up" | "overlap" | "no-use-logged" | "missed-payment")[] }`
  - `SubsFigures = { rows: SubRow[]; totalMonthlyCents: number; totalYearlyCents: number; whatIfCancelMonthlyCents: number; whatIfCancelYearlyCents: number; coverageDays: number }`
  - `computeSubscriptions(i: PlanInput): SectionResult<SubsFigures>`

Rules (spec 10): rows sorted by name (neutral), never by a score; no row highlighted or pre-labelled; `decision` only from the `events` log via `subscriptionStateOf`; `what-if` sums rows the user marked `cancel` (nothing is cancelled or drafted); cost per use only with >= 1 logged month (`yearly / (loggedMonths over the last 12 months)` rounded, null otherwise); `no-use-logged` fact only when the user logs usage at all for some stream, or the user has logged nothing anywhere -> `usage: "unknown"` and the fact is not raised; overlap uses `subscriptionOverlaps` (one stream per merchant). Status: `not-enough-data` when no detected subscriptions and `coverageDays < 90` (reason `none-short-history`); `attention` when any price increase flagged in the last 12 months (by `changeDate` via `months.ts`) or any overlap; else `on-track`. Facts: `sub_total_year`, `sub_price_up:<key>` (negative, mustMention false), `sub_overlap:<function>`, `sub_missed_payment:<key>` (negative, mustMention true when `skippedCycles > 0`), `sub_no_use:<key>`.

- [ ] **Step 1: Write failing tests**

```ts
test("priceChange: 9.99 x4 then 11.79 x3 -> changeDate is the first 11.79 charge, from 999 to 1179", ...)
test("below 3% or 50 cents -> priceChange null (same thresholds as subscriptionPriceIncreases)", ...)
test("rows sort by name; no row has a flag or order derived from facts", ...)
test("decision comes only from events: no events -> all null; keep then cancel -> cancel; clear -> null", ...)
test("whatIfCancel sums only rows marked cancel; none marked -> 0", ...)
test("usage unknown by default; one logged month -> costPerUse = yearly / logged months; two devices logging the same month once -> one month", ...)
test("overlap: two video streams 12.99 + 11.99 -> combined 24.98; same merchant two streams -> not an overlap", ...)
test("skippedCycles 1 -> missed-payment fact, mustMention true", ...)
test("under 90 days with nothing detected -> not-enough-data and missing history-90d; 90+ days nothing detected -> on-track with empty rows", ...)
test("price increase older than 12 months is not flagged; 11 months old is", ...)
test("event for a stream key that is gone is ignored in rows and never throws", ...)
test("no row text key exists for 'best'/'recommended' (rows carry only facts[] kinds)", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/subs` Expected: FAIL.
- [ ] **Step 3: Implement** `computeSubscriptions` over `personalView` txs; `detectSubscriptions(txs, { asOf })` with the default options (read `DetectSubscriptionOptions` at `:1347` for the `asOf` field name).
- [ ] **Step 4: Run** the command plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** duplicate event ids, orphan decisions, business-entity subscription excluded (Focus 3, 4).
- [ ] **Step 6:** `git add -N packages/core/src/plan/subs*` (owner commits).

---

### Task 6: Section 6: Cards and points

**Files:**
- Create: `packages/core/src/plan/cards.ts`, `cards.test.ts`, `packages/core/src/plan/__fixtures__/cardCases.json`
- Create (read-only consumer of the shared fixture): `apps/extension/src/rankAgreement.test.ts`
- Modify: `packages/core/src/plan/index.ts`
- Reuse: `netBenefit`, `holdingCostOfProduct`, `rankByNetBenefit`, `Benefit`, `NetBenefit` (`netBenefit.ts:236, 131, 353`), `HeldCashback`, `cashbackPctOf` (`assumedCashback.ts:306, 344`), `ProductFee`, `productFeesById` (`accountCosts.ts:146, 390`), `RewardsBalance`, `isStale` (`rewards.ts:8, 32`), `CatalogField` (`catalog.ts` ~11-17: `fxFeePct`, `convertFeePct`, `cashbackPct`, `pointsPerEuro`, `interestPct`, `accountFee`). Source to port: `apps/extension/src/rank.ts` `rankCheckout` (`:1272`) and its row semantics (`Row`, `Basis` at `:1008-1054`); `rank.ts` stays untouched.

**Interfaces:**
- Consumes: `HeldCardInput` (Task 1 `types.ts`), `spendHistory`-style categorised spend (Task 4), `preferences.redemptionExamples`, `preferences.pointsExpiry`.
- Produces:
  - `CardCriteriaRow = { cardKey: string; name: string; held: boolean; annualFee: { cents: number | null; known: boolean; asOf: string | null; sourceUrl: string | null }; cashbackPct: { value: number | null; tier: "measured" | "assumed" | "unknown"; asOf: string | null; sourceUrl: string | null }; fxFeePct: …same shape; pointsPerEuro: …same shape; earnByCategory: "unknown"; pointsExpiry: string | null; transferRatio: "unknown"; insurance: "unknown" }` ("unknown" columns are typed placeholders: `CatalogField` in `catalog.ts` has no such fields, UNVERIFIED sources per spec 15.4)
  - `CardNet = { cardKey: string; spendCents: number; earnedCents: number | null; feeShareCents: number | null; net: NetBenefit; pointsEarned: number | null; pointsValueRange: { lowCents: number; medianCents: number; highCents: number } | null }`
  - `PointsValueRange = { lowCentsPerPoint: number; medianCentsPerPoint: number; highCentsPerPoint: number; examples: number } | null` from the user's own redemption examples (lowest, median, highest of cash price saved / points spent); `null` without examples (balances and expiry only, no euro value; a published cents-per-point is never produced)
  - `CardsFigures = { criteria: CardCriteriaRow[] /* sorted by name */; nets: CardNet[]; cardInUseKey: string | null; cardableSpendCents: number; breakEven: { cardKey: string; annualSpendCents: number | null }[]; balances: { programId: string; points: number; stale: boolean; expiresOn: string | null; valueRange: PointsValueRange }[]; sharedCases: true }`
  - `computeCards(i: PlanInput): SectionResult<CardsFigures>`
  - `netForCard(card: HeldCardInput, annualSpendCents: number, horizonMonths: number): CardNet` the new core function; exported so the extension agreement test can compare.

Rules (spec 11): cardable spend = outgoing personal-scope spend on `heldCards` accounts over the last 12 full months (moved categories excluded); each held card is compared as if the whole cardable spend ran on it (counterfactual stated in `calc`); earned = spend * cashbackPct only for tier `measured`/`assumed` (assumed shown as assumed; `unknown` gives `net.kind === "gross-cost-unknown"`-style unknown, never 0); fee via `holdingCostOfProduct(card.fee)` as a `recurring` annual `Benefit` through `netBenefit` (a card already held: cost continues either way, so the comparison reports both `earned` and `feeShare` and uses `netBenefit` with `horizonMonths` from `PLAN_THRESHOLDS.cards.horizonMonths`); card in use = the card with the largest actual spend; break-even annual spend = fee / cashback rate across the user's value range, null when rate unknown or 0. Criteria sort is by name; there is NO field in any figure that ranks, scores, highlights or marks a row. Status: `not-enough-data` when no card data or no cardable spend; `attention` when another held card's net exceeds the card in use's net by more than 10% (`other.net > inUse.net + 0.10 * abs(inUse.net)`, and strictly greater; when `inUse.net == 0` any positive net counts) ; else `on-track`. Points value: lowest/median/highest of the user's own examples only; points expiry from `preferences.pointsExpiry` (RewardsBalance has no expiry field; this plan adds the typed preference). Foreign-currency spend excluded and counted. Facts: `card_net:<cardKey>`, `card_points_year:<programId>`, `points_expiry:<programId>` (negative polarity and mustMention true when the date is within 90 days), `card_break_even:<cardKey>`.

- [ ] **Step 1: Write failing tests** (fixture `cardCases.json`: 3 cases `{ amountCents, cashbackPct, feeCentsPerYear, held }` used by both packages)

```ts
test("net = spend*pct - fee over 12 months: 600_000 at 1% with fee 0 -> 6000; fee 5000/yr -> 1000", ...)
test("cashback unknown -> net unknown (no netCents), never 0; assumed 0% -> shown as assumed with net equal to minus the fee", ...)
test("no card data -> not-enough-data cards; no cardable spend -> not-enough-data cardable-spend", ...)
test("attention edge: other net 1100 vs in-use 1000 -> not > 10% -> on-track; 1101 -> attention; in-use 0 and other 1 -> attention", ...)
test("criteria sort by name; reversing input order gives identical output; no figure key named rank|score|best|recommended|highlight", ...)
test("redemption examples 0.4, 1.0, 0.7 cent/point -> low 0.4, median 0.7, high 1.0; none -> valueRange null and no euro value for points", ...)
test("pointsValueRange never equals a published constant: with no examples figures contain no centsPerPoint", ...)
test("break-even: fee 12000, 1.5% cashback -> 800_000; cashback 0 or unknown -> null", ...)
test("expiry within 90 days -> fact mustMention true; stale balance flagged via isStale", ...)
test("foreign-currency card spend excluded and counted; business-entity card excluded", ...)
test("shared fixture: netForCard agrees with the fixture's expected value for each case", ...)
// apps/extension/src/rankAgreement.test.ts
test("rankCheckout resultCents equals the plan's expected net for each shared fixture case (held card: opbrengst basis; not-held: netto basis; horizon 12 months)", ...)
```
Extension note: `apps/extension/package.json` does not depend on `@lavega/core` (UNVERIFIED beyond the `grep`), so the extension test reads `packages/core/src/plan/__fixtures__/cardCases.json` by relative path with `node:fs` and does NOT import core. Its expected values are in the JSON (computed by the core test), so the two sides agree through data. Where the two intentionally differ (a held card's fee is excluded from the extension's one-purchase sum but counted in the plan's annual view) the fixture marks that case `agree: false` with the reason; the test asserts only agreeing cases. Do not edit `rank.ts`.

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/cards` and `pnpm --filter @lavega/extension test -- rankAgreement` Expected: FAIL.
- [ ] **Step 3: Implement** `netForCard` on `netBenefit`; read `rank.ts:128-300` (held vs not-held rules) before writing the agreement fixture.
- [ ] **Step 4: Run** both commands plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** the no-ranking key scan, unknown-is-not-zero, empty states (Focus 1, 5).
- [ ] **Step 6:** `git add -N packages/core/src/plan/cards* packages/core/src/plan/__fixtures__ apps/extension/src/rankAgreement.test.ts` (owner commits).

---

### Task 7: Section 7: Investing and goals, public facts, study template

**Files:**
- Create: `packages/core/src/plan/goals.ts`, `goals.test.ts`, `publicFacts.ts`, `publicFacts.test.ts`
- Modify: `packages/core/src/plan/index.ts`
- Reuse: `requiredMonthlyCents`, `goalScenarioRows`, `lossIllustration` (Task 2); `scoreCapacity`, `capacityInputs`, `capacityToleranceFlag`, `toleranceBucket` (intake Task 5); `computeBuffer`/`computeMonth` results; `monthsBetween` (intake `months.ts`); `PublicFact`, `assertShowable` (intake Task 2); `withCurrentBalances` (`balance.ts:100`)

**Interfaces:**
- Produces:
  - `GoalRow = { goalId: string; purpose: string; kind: "general" | "child"; childId: string | null; yearsLeft: number | null; targetCents: number; savedCents: number; savedSource: "linked" | "stated"; linkedAccountCount: number; brokerRefsNotCounted: number; fundedPct: number | null; requiredMonthly: { rate: number; cents: number | null }[]; plannedMonthlyCents: number | null; gapCents: number; scheduleCents: number | null; behind: boolean | null; toTargetByDate: string | null }`
  - `UnallocatedLine = { kind: "computed"; lowCents: number; highCents: number; deductions: { bufferTopUpMonthlyCents: number; goalsMonthlyCents: number }; roomLowCents: number; roomHighCents: number } | { kind: "stopped"; missing: ("room" | "buffer-top-up" | "goal-monthly")[] }`
  - `GoalsFigures = { rows: GoalRow[]; unallocated: UnallocatedLine; capacity: ReturnType<typeof scoreCapacity>; toleranceScore: 1|2|3|4|5 | null; disagreement: "disagree" | "agree" | "unknown"; loss: { lossCents: number; monthsOfRoom: number | null } | null; scenarioTable: ReturnType<typeof publicScenarioTable>; study: StudyPlan | null; pendingFacts: string[] }`
  - `StudyPlan = { totalCents: number; monthlyCostCents: number; months: number; tuitionCents: number; inflationPct: number } | null` (null until the user enters every figure; no defaults)
  - `computeGoals(i: PlanInput, month: SectionResult<MonthFigures>, buffer: SectionResult<BufferFigures>, debts: SectionResult<DebtFigures>): SectionResult<GoalsFigures>`
  - `studyCost(a: StudyAssumptions, yearsAhead: number): number` (cost inflated by `inflationPct` per year; integer cents)
  - `PENDING_PUBLIC_FACT_IDS` = `["gift-tax-annual-2026","gift-tax-one-time-18-40","box3-minors","afm-backbone","afm-long-term","afm-costs","spiva-europe","nibud-save-10pct","nibud-buffer-purpose","hist-fall-2008","hist-fall-2020","duo-rules","pension-overview-url","child-provider-values","card-nl-terms"]` and `PUBLIC_FACTS: PublicFact[] = []` (nothing verified at ship; the owner adds entries with `verifiedOn`/`sourceUrl` later) and `showableFacts(facts = PUBLIC_FACTS): PublicFact[]` = those passing `assertShowable`
  - `factById(id: string): PublicFact | null` returns only a showable fact

Rules (spec 12): saved = sum of balances of linked bank accounts (EUR only, rolled forward) else `startingBalanceCents` flagged `stated`; broker refs are NOT counted (investing data is not in the plan's inputs; `brokerRefsNotCounted` reports them, UNVERIFIED that no broker balance reaches the vault); linked balances are the same ones Task 3 excluded from the buffer. `yearsLeft` = `monthsBetween(asOf, targetDate)/12`, null when <= 0 (goal date passed: `behind` computed against target, `requiredMonthly` null). Child goals: years to 18 from `children[].birthYear` when the goal has no date. Straight-line schedule from `since` (the goal Field's `at`) with `startingBalanceCents` to `targetDate`; `behind = saved < schedule`; funded % and gap are numbers. Unallocated = room low/high minus the buffer top-up monthly (gap / `preferences.bufferTopUpMonths.months`, or `stopped` with `buffer-top-up` if the gap exists but no months were set) minus the sum of each goal's monthly need (the user's `plannedMonthlyCents`, else `requiredMonthly` at 0%); if room is not computed -> `stopped` with `room`; the words are "unallocated", never "you can invest"; the range is kept (low uses room low and the larger deductions). Capacity shown beside tolerance with `capacityToleranceFlag`. Loss illustration uses the user's own invested-goal amount: `lossIllustration({ amountCents: sum of goal saved, fallPct: 30, roomMiddleCents })`, null without goals. Public scenario table identical for everyone (`publicScenarioTable()`), never next to the user's input. No gift-tax or box 3 figures are computed or stored here; they exist only as `PublicFact`s. No sentence about where soon-needed money belongs is generated on a goal card. Status: `not-enough-data` when no goals or no room figure (`no-goals`, `no-room`); `attention` if any goal `behind`; else `on-track`. Facts: `goal_gap:<goalId>` (negative when behind, mustMention true when behind), `goal_funded_pct:<goalId>`, `goal_required_monthly:<goalId>`, `unallocated_low`, `unallocated_high`, `capacity_score`, `tolerance_score`.

- [ ] **Step 1: Write failing tests**

```ts
test("goal 10_000 by +10 years, saved 0: required monthly at 0% is ceil(10000/120) and at 4% is lower; rows for rates 0,2,4,6", ...)
test("goal date today or past: yearsLeft null, requiredMonthly null, behind computed against target, no Infinity", ...)
test("behind: saved below the straight-line schedule from since -> behind true; equal -> false", ...)
test("linked EUR account counts as saved and is the same balance Task 3 excluded from the buffer (no double count across computeBuffer + computeGoals)", ...)
test("goal with no linked account uses startingBalanceCents with savedSource 'stated'; foreign-currency linked account excluded, not summed at face value", ...)
test("broker accountRef is not counted and is reported in brokerRefsNotCounted", ...)
test("unallocated: room 40_000..74_000, buffer top-up 5_000, goals 12_000 -> low 40_000-5_000-12_000 = 23_000, high 74_000-5_000-12_000 = 57_000 (range uses the same deductions; kind computed)", ...)
test("room not computed -> unallocated stopped with ['room']; buffer gap but no top-up months -> stopped ['buffer-top-up']", ...)
test("negative room low gives a negative unallocated low, rendered as a number, never clamped to 0", ...)
test("capacity 5 vs tolerance 3 -> 'disagree'; null capacity -> 'unknown'", ...)
test("child goal without a date: years to 18 from birthYear; childId required for kind child", ...)
test("study template is null until every field is entered; studyCost inflates integer cents", ...)
test("PUBLIC_FACTS is empty at ship, showableFacts([]) is []; a fact without verifiedOn is never returned by factById", ...)
test("no GoalsFigures key contains 'box3', 'gift' or 'allowance' computed values (key scan)", ...)
test("loss illustration uses the user's goal total, null without goals", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/goals plan/publicFacts` Expected: FAIL.
- [ ] **Step 3: Implement.** `PENDING_PUBLIC_FACT_IDS` is data only; add a comment pointing at spec section 15 items 1-11 per id.
- [ ] **Step 4: Run** the command plus `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** past-dated goal, negative room, foreign linked account, orphan goal accountRefs (Focus 2, 3, 4).
- [ ] **Step 6:** `git add -N packages/core/src/plan/goals* packages/core/src/plan/publicFacts*` (owner commits).

---

### Task 8: Orchestrator, FactSheet assembly, snapshots, triggers, change log

**Files:**
- Create: `packages/core/src/plan/compute.ts`, `compute.test.ts`, `changes.ts`, `changes.test.ts`
- Modify: `packages/core/src/plan/index.ts`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces:
  - `PlanResult = { asOf: string; thresholdsVersion: string; sections: { month: SectionResult<MonthFigures>; buffer: …; debts: …; spending: …; subscriptions: …; cards: …; goals: … }; facts: PlanFact[]; factSheet: (locale: "nl"|"en", taskType?: "plan" | "digest" | "note") => FactSheet; markers: PlanMarkers; backbone: { buffer: FigureValue | null; debtInterestPerYear: FigureValue | null; goalsGap: FigureValue | null; investingUnallocated: { low: FigureValue; high: FigureValue } | null }; freshness: { bankDataTo: string | null; profileConfirmedAt: string | null } }` (the backbone carries only facts from the user's own sections; no field says which step is next or ranks steps)
  - `computePlan(i: PlanInput): PlanResult` calls the seven section functions in dependency order (month, buffer, debts, spending, subscriptions, cards, goals), collects `facts`, builds `markers` (`incomeMedianCents`, ids, flagged increase keys from `subscriptionPriceIncreases`, goals whose `monthsBetween(asOf, targetDate) <= 12`, debt ids, child count, held card keys, points program ids, `bufferBelowWish`)
  - `snapshotOf(r: PlanResult, trigger: RefreshTrigger, profileHash: string): PlanSnapshot`
  - `type PlanChange = { section: SectionId; figureId: string; unit: FigureUnit; before: number | string | null; after: number | string | null; reason: { key: "income-stream-changed" | "price-increase-flagged" | "goal-date-near" | "buffer-below-wish" | "debt-added" | "child-added" | "card-added" | "points-added" | "profile-edited" | "figure-changed"; params?: Record<string, string | number> } }`; `type StatusChange = { section: SectionId; before: PlanStatus; after: PlanStatus }`
  - `diffSnapshots(prev: PlanSnapshot | null, next: PlanSnapshot): { changes: PlanChange[]; statusChanges: StatusChange[]; material: boolean }` (section order; omits a change under `PLAN_THRESHOLDS.noise` for its unit; `prev === null` or different `thresholdsVersion`/`engineVersion` gives no figure changes, only `material: false` plus a `baseline: true` flag in the return type, so an upgrade is not reported as a spike)
  - `detectTriggers(prev: PlanSnapshot | null, next: PlanMarkers & { profileHash: string }): RefreshTrigger[]` per spec 13: income median differs 20% or more, new confirmed income stream id, newly flagged increase key, a goal newly within 12 months, buffer newly below wish, new debt/child/card/points id, profile hash changed
  - `refreshDecision(prev: PlanSnapshot | null, asOf: string, triggers: RefreshTrigger[]): RefreshTrigger | null` returns the reason to store a new snapshot: `open-stale` (last `asOf` more than 30 days ago), `new-month` (first open after the 1st: `isoMonth(asOf) !== isoMonth(prev.asOf)`), the first trigger, or null (manual is requested by the caller)
  - `topChanges(d: ReturnType<typeof diffSnapshots>, n: 3): PlanChange[]` (largest relative move first; ties by section order) for the AI layer later

- [ ] **Step 1: Write failing tests**

```ts
test("empty input (no profile, no txs, no accounts): all seven sections not-enough-data with typed missing, factSheet builds, no NaN in any flat value", ...)
test("personal scope: the same fixture with half the accounts assigned to a business entity gives identical results for sections as if those accounts did not exist", ...)
test("computePlan is pure: same input twice gives deep-equal output; changing only asOf's day inside a month changes no figure that is not date-dependent", ...)
test("backbone has exactly the keys buffer, debtInterestPerYear, goalsGap, investingUnallocated and no ordering or 'next' field", ...)
test("factSheet hash differs by locale and is identical for the same locale after a recompute; facts contain no counterparty or IBAN strings", ...)
test("mustMention set: negative room, goal behind, missed payment present; a positive buffer gap is not mustMention", ...)
test("diffSnapshots: income 3100 -> 3400 with reason income-stream-changed; change below noise omitted; nothing material -> material false", ...)
test("diffSnapshots across a thresholdsVersion bump -> baseline true, no figure changes", ...)
test("status change lists old and new status in section order", ...)
test("detectTriggers: median 20% (19.9% no, 20.0% yes); new stream id; newly flagged increase; goal enters 12-month window; profile hash change", ...)
test("refreshDecision: 30 days -> null, 31 -> open-stale; Jan 31 -> Feb 1 -> new-month; December -> January rollover; leap year Feb 29", ...)
test("topChanges returns at most 3, largest relative move first", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/core test -- plan/compute plan/changes` Expected: FAIL.
- [ ] **Step 3: Implement.** `factSheet(locale)` is a function so the locale-dependent hash is computed lazily; `PlanResult` itself carries no strings in either language.
- [ ] **Step 4: Run** `pnpm --filter @lavega/core test` (whole package) and `pnpm typecheck` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** the empty-input test, the personal-scope equivalence test, month rollover tests (Focus 1, 3, 4).
- [ ] **Step 6:** `git add -N packages/core/src/plan/compute* packages/core/src/plan/changes*` (owner commits).

---

### Task 9: Copy: NL and EN template text, wording tables, empty states

**Files:**
- Create: `apps/web/src/copy/plan/shell.ts`, `month.ts`, `buffer.ts`, `debts.ts`, `spending.ts`, `subscriptions.ts`, `cards.ts`, `goals.ts`, `wording.ts`, `apps/web/src/copy/plan/plan.test.ts`
- Modify: `apps/web/src/copy/parity.test.ts` (import list at lines 1-6 and the module list it iterates; add each plan copy export), `apps/web/src/copy/shell.ts` (`topBar.viewTitles` at NL ~276 and EN ~632 plus the `Record<View,string>` type at ~47; `nav.moduleLabels` at NL ~298 and EN ~654 plus the type at ~55: add `plan`, "Jouw plan" / "Your plan")
- Reuse: `findAdviceLanguage` (`packages/core/src/advice/language.ts`); formatting helpers `formatEuroIn`, `localeTag` (`apps/web/src/format.ts`); pattern of `apps/web/src/copy/optimise.ts` (function-valued entries take ALREADY-FORMATTED strings, `Record<Locale, T>` export)

**Interfaces:**
- Consumes: `StatusReasonKey`, `MissingKind`, `MissingAction`, `PlanStatus`, `SectionId`, `PlanChange['reason']['key']` (core).
- Produces:
  - `PlanFmt = { eur(cents: number): string; eurRange(low: number, high: number): string; months(n: number): string; pct(ratio: number): string; date(iso: string): string; monthLabel(iso: string): string }` (built in web from `formatEuroIn`/`localeTag`)
  - `planShellCopy: Record<Locale, { title; navLabel; header: { planDate(d); freshness(bankTo: string | null, profileAt: string | null); knowsLink; assumptionsLink }; backbone: { heading; sentence: string; sourceFactId: "afm-backbone"; steps: Record<"buffer"|"debt"|"goals"|"investing", { label: string; fact(figure: string): string; empty: string }> }; changes: { heading; none; statusChange(old: string, next: string): string; reasons: Record<PlanChange["reason"]["key"], (p: Record<string, string | number>) => string> }; footer: { notice; computedAt(t: string); recompute }; status: Record<PlanStatus, { word: string; symbol: string }>; missing: Record<MissingKind, string>; actions: Record<MissingAction, string>; invitation: { sentence: string; start: string }; sectionTitles: Record<SectionId, string>; cardParts: { figures; assumptions; explanation; howCalculated; sources }; explainControls: { simpler; moreDetail; helped; notHelped } }>` (the backbone sentence is the spec's quoted text; its source line renders only when `factById("afm-backbone")` is showable)
  - one `*Copy: Record<Locale, SectionCopy>` per section module, each with: `reasons: Record<…StatusReasonKey subset>` (exhaustive per section via `Extract`), `headline(figures, fmt): string`, `explain: { simple(figures, fmt): string[]; detailed(figures, fmt): string[] }` (template levels the controls select between), `empty: Record<MissingKind subset, string>`, `howCalculated: Record<calc step id, string>` (every `calc.id` the section emits; a test asserts coverage), `education: { conceptId: string; title: string; body: string }[]` (general education written from the AI spec concept catalogue ids; the catalogue itself is not built yet: ids are plain strings and are UNVERIFIED against it) and, in `goals.ts`, `learnShortHorizon` (the single general card; text gated by `afm-long-term` showable)
  - `wording.ts`: `WORDING_TABLES: Record<SectionId, { allowed: Record<Locale, string[]>; forbidden: Record<Locale, string[]> }>` copied from spec sections 6-12 (data for tests now, for the AI prompt slot later)
  - `planCopyByLocale` convenience export

- [ ] **Step 1: Write failing tests** (`plan.test.ts`)

```ts
test("every status reason key, missing kind, action, section title, calc id exists in nl and en (exhaustive Records + runtime paths() parity)", ...)
test("rendering every template function with a spread of probe figures (zero, negative, 1, 1_000_000, null-ish) in both locales yields no string for which findAdviceLanguage(text, locale) is non-empty", ...)
test("allowed examples in WORDING_TABLES contain no advice language; forbidden examples are present as data and each section has at least 3", ...)
test("no template mentions a product, provider, fund, ticker or ISIN: rendered output matches none of /ISIN|[A-Z]{2}[A-Z0-9]{10}|index fund (as a recommendation)/ and goal/card/debt templates contain no imperative verbs from the shared list", ...)
test("room templates never use 'invest'/'invester'/'beleggen' as an instruction: only 'unallocated'/'niet toegewezen' wording appears next to the unallocated line", ...)
test("status chip word and symbol are both non-empty for every status in both locales, and symbols are distinct", ...)
test("backbone sentence matches the spec text in EN; the source line is absent when afm-backbone is not showable", ...)
test("empty-state text for every missing kind names the input, gives one action, and says nothing has been estimated", ...)
test("no Dutch word list hit (en, de, het, niet, voor, rekening) inside string literals of apps/web/src/plan/** and views/Plan.tsx (grep guard)", ...)
test("nl and en trees have identical key paths (copy/parity.test.ts includes the plan modules)", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- copy/plan parity` Expected: FAIL.
- [ ] **Step 3: Implement.** Allowed sentences from the spec's "Allowed" lines become the pattern for templates (numbers are parameters). Exact template sentences are the builder's call within `WORDING_TABLES` (spec 17). Every sentence states a fact on the user's number or a sourced general fact; no sentence tells the user what to do. Public-fact-dependent sentences (Nibud 10%, gift tax, SPIVA, historical falls, AFM backbone source) are written as keyed slots filled only from `factById`; with `PUBLIC_FACTS` empty they render nothing.
- [ ] **Step 4: Run** the command plus `pnpm typecheck` Expected: PASS. Then run `pnpm --filter @lavega/web test -- shell` to confirm the `viewTitles`/`moduleLabels` type changes compile.
- [ ] **Step 5: Review Focus pin:** the cross-locale banned-word test and the unverified-fact gating test (Focus 5).
- [ ] **Step 6:** `git add -N apps/web/src/copy/plan` (owner commits).

---

### Task 10: Web state and route: `usePlan`, held cards, route, nav, App wiring

Reviewable alone: no section UI. Ends with a route that renders the invitation or a bare list of `PlanResult` statuses behind the Task 11 component (a stub `Plan` returning `null` is replaced in Task 11).

**Files:**
- Create: `apps/web/src/plan/usePlan.ts`, `usePlan.test.ts`, `apps/web/src/plan/heldCards.ts`, `heldCards.test.ts`, `apps/web/src/views/Plan.tsx` (stub exporting the final props type; Task 11 fills it)
- Modify (anchors; line numbers are pre-intake):
  - `apps/web/src/appRoutes.ts`: `type View` union (lines 7-20) add `"plan"`; `VIEW_BY_SEGMENT` (lines ~25-39) add `plan: "plan"`. Tests in `appRoutes.test.ts` (pattern at its lines 14-27).
  - `apps/web/src/components/moduleRegistry.tsx`: `ModuleId = Extract<View, ...>` (lines 23-34) add `"plan"`; `MODULES` array (the first entry is `id: "overview"`, ~line 117) insert the `plan` entry BEFORE `overview` so it is the first nav item (nav order is registry order, `navModules` ~426); `HOME_MODULE` stays `"overview"` (line 62); `DEFAULT_MODULES` (~394) and `KNOWN` (~398) pick it up automatically; `Thumb`/`Tile`/`Line` helpers (lines 83-112) build its thumbnail. `ModulePicker.test.tsx` (~line 262, "geen enkele widget-id is ook een module-id") must still pass: no widget id may be `plan`. The registry's own `label`/`what` strings are Dutch literals today; for the new entry follow the existing `nav.moduleLabels` indirection (check how `NavBar.tsx` reads it) so no Dutch lands outside copy.
  - `apps/web/src/App.tsx`: import `Plan`; `planStore` is held by `usePlan`, not duplicated in App; in the vault-load block that fetches rewards (anchor `storage.getRewards()`, ~lines 583 and 999; both loads) also load the `plan` and `events` sections via the intake `getSection("plan")` / `getSection("events")`; render branch next to `{view === "punten" && (` (~line 1781): `{view === "plan" && <Plan .../>}`; pass UNSCOPED `accounts`, `txs`, `rules`, `own`, `rewards`, `facts`, `fxHistory`, `fxConversionMode`, `asOf`; nav gating at `modules={navModules(modules)}` (~line 1538): drop `plan` from the list until `planProfileOf(store).intakeBlocksDone >= 1`; the route itself, when reached early, renders the intake invitation (spec 4), reusing the intake `IntakeInviteCard` `onStart`.
  - `apps/web/src/views/Overzicht.tsx` / intake `RoomCard`: optional prop `onOpenPlan?: () => void` (no behaviour change when absent).
- Reuse: `useAppLocale` (`appLocale.ts`), `MOVED_CATEGORIES` (`components/blocks/statistics.ts:88`) for `movedCategories`, `heldCashbackOf`/`factEntry`/`productOf`/`getCashbackAssumptionEnabled` exactly as `Optimalisatie.tsx:~885-925`, `productFeesById(CATALOGUE_ENTRIES)` (`catalogue-rates.ts`), `getFxConversionMode` (App.tsx import at ~line 84).

**Interfaces:**
- Consumes: `computePlan`, `snapshotOf`, `diffSnapshots`, `detectTriggers`, `refreshDecision`, `addSnapshot`, `decodePlanSection`, `subscriptionStateOf`, `planProfileOf`, `PlanPreferences`, `PlanEvent` (core); intake `AdvisorProfileStore`, `getSection/putSection/appendEvents`.
- Produces:
  - `buildHeldCards(i: { accounts: Account[]; facts: readonly LearnedFact[]; entries: readonly CatalogueEntryLike[]; rewards: RewardsBalance[]; assumptionOn: boolean }): HeldCardInput[]` (web-only; mirrors the Optimalisatie derivation; the only place the web layer touches `heldCashbackOf`)
  - `usePlan(i: { store: AdvisorProfileStore | null; storage: VaultStorage; accounts; txs; entityProfiles; rules; own; rewards; facts; catalogue; rates; mode; fxHistory; asOf: string }): { result: PlanResult; preferences: PlanPreferences; events: PlanEvent[]; changes: ReturnType<typeof diffSnapshots>; lastSnapshotAt: string | null; recompute(): Promise<void>; setPreference(patch: Partial<PlanPreferences>): Promise<void>; appendPlanEvent(e: PlanEvent): Promise<void> }`; `computePlan` in `useMemo`; snapshot storage decided by `refreshDecision` (on open, first open after the 1st, any trigger), stored via `putSection("plan", ...)` with `addSnapshot`; events appended via the intake `appendEvents` (union merge); `recompute()` passes trigger `manual` with a fresh current date taken through an Effect `DateTime` clock accessor at this web boundary (App's `asOf` is fixed at mount, App.tsx ~line 455; no `new Date()` in core; read `repos/effect/LLMS.md` for the accessor).
  - `Plan` props `{ plan: ReturnType<typeof usePlan>; store: AdvisorProfileStore | null; onNavigate(view: View): void }` (type only in this task)

- [ ] **Step 1: Write failing tests**

```ts
// appRoutes.test.ts
test("/app/plan resolves to plan and pathForView('plan') is /app/plan", ...)
// module-grid.test.tsx / ModulePicker.test.tsx
test("plan is first in navModules order, overview second; both enabled by default; no widget id equals 'plan'", ...)
// usePlan.test.ts (renderHook, mocked storage)
test("no plan section in the vault (legacy) -> emptyPlanPreferences, no snapshot, no crash; first open stores a snapshot with trigger open-stale or new-month", ...)
test("opening twice in one month with no trigger stores one snapshot; a new subscription price increase stores another with trigger price-increase", ...)
test("recompute() stores a snapshot with trigger manual and updates 'last computed'", ...)
test("appendPlanEvent twice with the same id results in one event (union merge)", ...)
test("editing a profile field (profileHash changes) triggers profile-edit and the change log lists it", ...)
test("an events array that also holds explanation/outcome events does not break subscription state", ...)
// heldCards.test.ts
test("buildHeldCards equals the Optimalisatie derivation for the same fixture; no held card when assumption off and no measured cashback keeps cashback tier 'unknown'", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- appRoutes module-grid ModulePicker usePlan heldCards` Expected: FAIL.
- [ ] **Step 3: Implement** the route, registry entry, `usePlan`, `buildHeldCards`, App wiring.
- [ ] **Step 4: Run** `pnpm --filter @lavega/web test && pnpm typecheck && pnpm lint && pnpm format` Expected: green; list every existing test you changed (`NavBar.test.tsx`, `shell.english.test.tsx`, `App.test.tsx`, `module-grid.test.tsx`, `Profiel.test.tsx`) and why.
- [ ] **Step 5: Review Focus pin:** legacy vault, duplicate event ids, profile-edit trigger (Focus 4).
- [ ] **Step 6:** `git add -N apps/web/src/plan apps/web/src/views/Plan.tsx` (owner commits).

---

### Task 11: Web view shell: header, backbone, change log, card frame, invitation, scenario table

**Files:**
- Create: `apps/web/src/views/Plan.test.tsx`, `apps/web/src/plan/{PlanHeader,BackboneStrip,ChangeLog,SectionCard,ScenarioTable}.tsx`
- Modify: `apps/web/src/views/Plan.tsx` (replace the Task 10 stub)
- Reuse: `Card`, `Badge`, `Button`, `CardLink` (`apps/web/src/components/ui/`), `formatEuroIn`/`localeTag` (`format.ts`)

**Interfaces:**
- Consumes: Task 10 `usePlan`, Task 9 `planShellCopy`.
- Produces:
  - `SectionCard` props `{ section: SectionId; result: SectionResult<unknown>; children: { figures: ReactNode; assumptions: ReactNode; explanation?: ReactNode; howCalculated: ReactNode; sources: ReactNode } }`. The expanded order is fixed by the component: figures, assumptions, explanation, how-we-calculated, sources. SEAM FOR THE AI LAYER: `explanation` is a slot. When the caller passes none, `SectionCard` renders `TemplateExplanation` (simple/detailed switch from `copy/plan/<section>.explain`, helped/didn't buttons, no AI disclosure). The AI layer passes its `ExplanationBlock` in this slot from the section components and changes nothing else.
  - `Plan`: header (plan date, freshness, links to `about-you` and the assumptions anchor), backbone strip, change log, seven `SectionCard`s in the fixed order (collapsed: title, status chip with word+symbol, headline figure), footer (notice, last computed, recompute). Cards default CLOSED regardless of status (spec 17, builder choice; documented in the component). Store null or `intakeBlocksDone` 0: invitation card only. Section bodies are Task 12; until then each card body renders the section's `missing` list and `calc` only.
  - `ScenarioTable` renders `publicScenarioTable()`, labelled "an illustration with stated assumptions, not a forecast and not a choice for you" (copy), no input control.

- [ ] **Step 1: Write failing tests** (jsdom)

```ts
test("store null or blocksDone 0 -> invitation card with Start and one sentence on what the plan contains; no section rendered", ...)
test("blocksDone 1 with no bank data -> seven cards in the fixed order, each not-enough-data with its missing-input action, nothing estimated", ...)
test("chips show word AND symbol for every status; cards start closed", ...)
test("backbone strip shows the identical general sentence for two different profiles; under each step only own-section facts; no 'next' marker", ...)
test("change log lists figure, before, after and the reason text; status change shows old and new chip; nothing material -> says so", ...)
test("scenario table has no input and identical cells for two different users", ...)
test("SectionCard renders a passed explanation slot instead of the template one, and the template one carries no AI disclosure", ...)
test("renders in NL and EN; findAdviceLanguage(text, locale) empty on the rendered text in both", ...)
test("unverified public facts (empty PUBLIC_FACTS): no gift-tax, Nibud 10% or SPIVA text in the DOM", ...)
test("<script> in a debt lender name or subscription name renders as literal text", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- Plan` Expected: FAIL.
- [ ] **Step 3: Implement.** If you add motion (card expand), load `emil-design-eng` first: short height/opacity transition, `prefers-reduced-motion` honoured.
- [ ] **Step 4: Run** `pnpm --filter @lavega/web test && pnpm typecheck && pnpm lint && pnpm format` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** empty/legacy states, wording leaks (Focus 1, 5).
- [ ] **Step 6:** `git add -N apps/web/src/views/Plan.test.tsx apps/web/src/plan` (owner commits).

---

### Task 12: Web section bodies: seven section components with editable assumptions

**Files:**
- Create: `apps/web/src/plan/sections/{Month,Buffer,Debts,Spending,Subscriptions,Cards,Goals}Section.tsx`, `apps/web/src/plan/sections/sections.test.tsx`
- Modify: `apps/web/src/views/Plan.tsx` (mount each section body in its `SectionCard`)

**Interfaces:**
- Consumes: Task 11 `SectionCard`, Task 10 `usePlan` (`setPreference`, `appendPlanEvent`), section figures from `PlanResult`, section copy (Task 9).
- Produces: per section, the figures, the user's editable assumptions (category limit, extra debt payment, buffer top-up months, redemption examples, points expiry, `nibudBufferResult`, study-template figures, goal "saved so far" and "planned monthly") and the "how we calculated this" list from `calc`. Specifics: Subscriptions rows show Keep/Review/Cancel as UNSELECTED buttons (state only from the log) and a "used this month" button appending a `UsageLog`; Cards criteria table sorts by name by default, header click sorts by that column, no highlight class; Goals section lets the user link bank accounts to a goal (`accountRefs`, saved through the intake profile save path as a confirmed `Goal` edit), shows the scenario table via `ScenarioTable` and the single general Learn card; the typed provider comparison for children's accounts is NOT rendered (pending fact `child-provider-values`).

- [ ] **Step 1: Write failing tests**

```ts
test("seeded fixture: all seven sections render headline and figures; expanded order is figures, assumptions, explanation, how-we-calculated, sources", ...)
test("cards table: default sorted by name, clicking a column sorts, no element has a highlight/selected/best class; Keep/Review/Cancel start unselected", ...)
test("editing a category limit and an extra debt payment persists via setPreference and changes the figures", ...)
test("'used this month' appends one UsageLog; clicking twice in the same month leaves one logged month", ...)
test("linking a bank account to a goal moves its balance from buffer savings to goal saved (no double count) after recompute", ...)
test("simpler / more detail switches between template levels; no AI-disclosure element is rendered", ...)
test("business-entity accounts present: displayed figures equal those without them", ...)
test("copy scan on the rendered seeded fixture in NL and EN: findAdviceLanguage empty", ...)
```

- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- sections` Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @lavega/web test && pnpm typecheck && pnpm lint && pnpm format` Expected: PASS.
- [ ] **Step 5: Review Focus pin:** orphan goal links, foreign linked account, ranking/highlight scan (Focus 3, 4, 5).
- [ ] **Step 6:** `git add -N apps/web/src/plan/sections` (owner commits).

---

### Task 13: Verification and review (no new features)

**Files:** none new except evidence files outside the repo (screenshots in the scratchpad).

- [ ] **Step 1: Full run.** `pnpm test && pnpm typecheck && pnpm lint && pnpm format` Expected: all green.
- [ ] **Step 2: Mutation check on the money functions.** For each of `futureValueCents`, `requiredMonthlyCents`, `amortise`, `computeBuffer` (months and gap), `computeGoals` (unallocated), `netForCard`, `diffSnapshots` noise bound: apply one mutation by hand (flip a sign, off-by-one month, `>=` to `>`, drop a `Math.ceil`), run `pnpm --filter @lavega/core test -- plan/`, confirm at least one test fails, revert. Record the table (function, mutation, failing test). A surviving mutation means a missing test: add it (that test lands in the owning task's file).
- [ ] **Step 3: Run it for real.** Use the project's `verify-lavega` skill if present in this worktree, else the `run` skill: seeded profile through the intake, then `/app/plan`: all seven sections with template text in NL and EN, edit a category limit and an extra debt payment, change an input and confirm the change log lists it with its reason, open `/app/plan` with no bank data. Save screenshots and report the evidence path. Do not claim the UI works from unit tests alone. Probe the browser only when no browser worker is running (`lavega_shared_chrome`).
- [ ] **Step 4: Review.** One independent reviewer on the whole plan diff (built-in `/code-review`, or a sonnet reviewer with the interrogate rubric). This touches personal financial data and the wording line, so run pstack `interrogate` on Tasks 7 and 9. Fix everything under "Act on"; list "Consider" for the owner.
- [ ] **Step 5:** `git add -N` any new test files, then print the "read this before committing" block (what changed, evidence path, reviewer findings and resolutions, what is left) (owner commits).

---

## Self-Review (done against the spec)

Spec coverage:
- Section 1 intent / P1: Tasks 3-7 (seven sections), Tasks 10-12 (one page, fixed order). P2 every number pure + "how we calculated this": `calc` in Tasks 3-7, rendered in Task 10. P3 status table: Task 1 `PLAN_THRESHOLDS`, Tasks 3-7. P4 monthly recompute, triggers, change log: Task 8 core, Task 10 hook. P5 complete with template text: Task 9. P6 no bank data: Review Focus 1, `missing` in every section.
- Section 4 page structure: header, backbone, changes, cards, footer, explanation controls: Tasks 11-12 (`explainControls` copy in Task 9). Nav first item for finished intake: Task 10; pre-intake invitation: Task 11.
- Section 5 personal scope (Global Constraints, Task 3-7 via `personalView`), engine signature (Task 1 `PlanInput`, an object, not positional: flagged), FactSheet + polarity + mustMention (Tasks 1, 3-8), one-AI-call (not built; `factSheet(locale)` and `topChanges` are the hooks), wording tables (Task 9 `wording.ts`), one advice list (Global Constraints, Task 9 tests), statuses and the buffer/capacity separation (Tasks 1, 3, 7), empty states (every task + Task 9), copy rules (Task 9).
- Sections 6-12: Tasks 3 (6, 7), 4 (8, 9), 5 (10), 6 (11), 7 (12). Explicit non-computations are pinned by key-scan tests (no shortfall amount, no box 3, no "could invest").
- Section 13: Task 8 + Task 10. Section 14 data model: Task 1 (`PlanPreferences`, `PlanSnapshot`, `PlanEvent`, thresholds, `ExternalBenchmark` in Task 4, `PublicFact` reused). Section 15: Task 7 `PENDING_PUBLIC_FACT_IDS`, gating test in Tasks 7, 9, 10; nothing verified, by design. Section 16: unit/property tests per task, mutation check Task 13 step 2, copy test Task 9, browser run Task 13 step 3; "AI-spec validators on one fixture FactSheet per status combination" is for the AI layer (not built here).
- Section 17 builder choices recorded: noise bound absolute (Task 1), cards default closed (Task 11), card function in core (Task 6), module layout (File Structure).

Gaps and decisions for the owner to check:
1. Debts status table overlaps (a debt without a rate is both "attention" and "not-enough-data"); plan picks `not-enough-data` when no stated rate exists. Buffer and goals need a target/goal; same precedence rule (not-enough-data first).
2. Cards "card in use" and the 10% margin are underspecified; plan uses largest actual spend as "in use" and compares counterfactual annual nets (`other > inUse + 10% of |inUse|`).
3. Scenario maths: monthly rate = (gross - cost)/12 nominal, end of month. Spec says "monthly compounding"; effective vs nominal not stated.
4. Straight-line goal schedule needs a start date; the Goal schema has none. Plan uses the goal Field's `at` and `startingBalanceCents`. Broker-linked balances are not counted (investing data not in plan inputs).
5. Points expiry has no home in `RewardsBalance`; plan adds `pointsExpiry` to `PlanPreferences` (user typed).
6. Catalogue `CatalogField` (`catalog.ts` ~11-17) has `fxFeePct`, `convertFeePct`, `cashbackPct`, `pointsPerEuro`, `interestPct`, `accountFee`; there is no earn-by-category, transfer ratio and insurance columns ship as typed "unknown".
7. `PUBLIC_FACTS` ships empty: backbone source line, Nibud 10%, gift tax, SPIVA and historical falls stay hidden until the owner supplies verified entries (spec 15). The page is fully usable without them.
8. Nav item appears at `intakeBlocksDone >= 1` (spec says "finished the intake" but also lets block-1 users see partial sections).
9. Concept ids in `education` are plain strings; the AI spec's concept catalogue (6.1) is not built.
10. Extension agreement test reads a shared JSON fixture by path because `@lavega/extension` does not list `@lavega/core` (UNVERIFIED beyond a grep of its `package.json`).
11. UNVERIFIED until the intake lands: exact `AdvisorProfile` shape (goals as `Field<Goal[]>` or `Field<Goal>[]`), `Subscription.txIds`, `getSection/putSection` signatures, `appendEvents`, `proposeFixedCosts` options. Absorb differences in `profileView.ts`, not in sections.
12. Plan length: 13 tasks. Former Task 10 is split into state/route (10), view shell (11), section bodies (12) and verification (13).
