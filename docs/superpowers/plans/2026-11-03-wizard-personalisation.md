# Wizard Personalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every intake question changes one of LaVega's five outcomes: new round 1 questions, a round 2 after first data, and the effects wired into Your plan, Overview and the AI context.

**Architecture:** New optional `Field<…>` entries on `AdvisorProfile` (packages/core), written by `apply*` functions in apps/web/src/intake/state.ts, asked by new wizard screens (Verder everywhere), read by the plan engine only through `planProfileOf`, and summarised for the AI through the existing tab-context allowlist.

**Tech Stack:** TypeScript, React, Effect Schema, Vitest, pnpm/turbo.

**Spec:** docs/superpowers/specs/2026-11-03-wizard-personalisation-design.md

## Global Constraints

- Every new profile field is optional and `Field<T>` with `source: "stated"` and `at`; old stored profiles must decode unchanged.
- Every screen moves on only with Verder (`ChoiceScreen` / `Form` + `Next` in apps/web/src/intake/wizard/screenViews.tsx).
- Copy NL and EN in the typed copy modules (`wizardCopy: Record<Locale, WizardCopy>`, `AboutYouCopy`); no hyphens inside sentences; `findAdviceLanguage` test must stay green.
- No investment product advice: no instrument, fund, allocation percentage or "invest €X in Y" anywhere in new copy.
- Credit card copy is factual (fee, cashback, interest, points); never urges taking credit.
- Plan engine reads profile only via `planProfileOf`; bump `PLAN_ENGINE_VERSION` to `"plan-3"` once (Task 10).
- AI context never carries birth year, bank names or amounts beyond today's overview context.
- Do not commit. Stage after each task (`git add -A apps packages docs`); the owner commits. Per-task diffs via tree snapshots (temp `GIT_INDEX_FILE` + `write-tree`).
- Verify per task: the named test files, then `pnpm --filter @lavega/web exec tsc --noEmit -p .` and `pnpm lint`.

## Execution order

1, 2, 3, 4, 5, 6, 8, 9, 10, 7, 11, 12, 13, 14, 15, 16, 17. Round 1 is done after Task 13; round 2 and the AI context follow.

## Review Focus

1. A user who finished the old wizard (lastScreen "upload", blocksDone 3) must not be thrown back into the full wizard, and must see only the unanswered new questions (Task 13).
2. Answering "Alone" after "Together" must drop `moneySharing` so the money-sharing screen and its effects disappear (Task 2).
3. Picking "None" on the merged cards screen after having picked cards must clear `statedCards`, skip card-repayment, and remove stated cards from the comparison (Tasks 3, 10).
4. A stated card that is also found in bank data must not be counted twice in the comparison (Task 10).
5. The bank checklist must never mark a brand "connected" without an alias match, including accounts from CSV upload (no `linkedAt`) (Task 9).

---

### Task 1: Profile schema

**Files:**
- Modify: `packages/core/src/advisor/profile.ts`
- Test: `packages/core/src/advisor/profile.test.ts` (create if absent)

**Interfaces:**
- Produces (all exported, `Schema.Literals` + `type X = Schema.Schema.Type<…>`):
  `MoneySharing = "shared"|"separate"|"mixed"`; `IncomeRegularity = "fixed"|"varies"`; `CardRepayment = "full"|"sometimes"|"rarely"`;
  `SpendArea = "groceries"|"travel"|"online"|"fuel"|"eating-out"|"other"`; `ForeignSpend = "often"|"sometimes"|"never"`;
  `Priority = "spend-less"|"save-more"|"pay-off-debt"|"cards-points"|"subscriptions"|"children"|"start-investing"`;
  `CutTarget = SpendArea | "subscriptions"`; `CheckInCadence = "daily"|"weekly"|"when-it-matters"`;
  `PointsGoal = "flights"|"upgrades"|"shopping"|"cashback"|"no-preference"`; `FlightsPerYear = "0"|"1-2"|"3-5"|"6+"`.
- New `AdvisorProfile` keys, all `Schema.optionalKey(Field(…))`: `birthYear: Int`, `incomeRegularity`, `statedBanks: Array(String)`, `cardRepayment`, `spendMix: Array(SpendArea)`, `foreignSpend`, `priorities: Array(Priority)`, `cutTargets: Array(CutTarget)`, `checkInCadence`, `confidence: Int 1..4`, `statedPrograms: Array(String)`, `pointsGoal`, `flightsPerYear`.
- `Household` gains `moneySharing: Schema.optionalKey(MoneySharing)`.
- `intake` gains `round2Done: Schema.optionalKey(Schema.Boolean)`.

- [ ] **Step 1: Write failing tests** `"an old stored profile without the new fields still decodes"` (decode a literal object shaped like today's profile, expect success) and `"new fields round-trip"` (encode/decode a profile with every new field set; `confidence: 5` and `birthYear: 1890.5` are rejected).
- [ ] **Step 2: Run** `pnpm --filter @lavega/core exec vitest run src/advisor/profile.test.ts`. Expected: FAIL (fields unknown).
- [ ] **Step 3: Implement** the schema additions; re-export the new types from the package index like `WorkKind`.
- [ ] **Step 4: Run** the test and `pnpm --filter @lavega/core exec vitest run`. Expected: PASS, no other core test changes.
- [ ] **Step 5: Stage.**

### Task 2: apply* writers

**Files:**
- Modify: `apps/web/src/intake/state.ts`
- Test: `apps/web/src/intake/state.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces, each `(p: AdvisorProfile, value, asOf: string) => AdvisorProfile` in the `applyChargesVat` pattern:
  `applyMoneySharing(p, v: MoneySharing, asOf)` (writes `household.value.moneySharing`, keeps `kind`); `applyBirthYear(p, year: number, asOf)`; `applyIncomeRegularity`; `applyStatedBanks(p, ids: readonly string[], asOf)`; `applyCardRepayment`; `applySpendMix(p, areas: readonly SpendArea[], asOf)` (keeps at most 3, input order); `applyForeignSpend`; `applyPriorities`; `applyCutTargets`; `applyCheckInCadence`; `applyConfidence(p, n: 1|2|3|4, asOf)`; `applyStatedPrograms`; `applyPointsGoal`; `applyFlightsPerYear`.
- `applyHousehold` change: when `kind` becomes `"alone"`, drop `moneySharing`.
- `answerCards(p, false, asOf)` (screens.ts) also drops `cardRepayment`.

- [ ] **Step 1: Failing tests:** one per writer asserting `{ value, source: "stated", at: AS_OF }`; `"applySpendMix keeps the first three"`; `"switching to alone drops moneySharing"`; `"Nee on cards drops cardRepayment"`.
- [ ] **Step 2: Run** `pnpm --filter @lavega/web exec vitest run src/intake/state.test.ts src/intake/wizard/screens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Stage.**

### Task 3: Screen list, order and conditions

**Files:**
- Modify: `apps/web/src/intake/wizard/screens.ts`
- Test: `apps/web/src/intake/wizard/screens.test.ts`

**Interfaces:**
- `ScreenId` adds `"money-sharing"|"birth-year"|"income-regularity"|"banks"|"card-repayment"|"spend-mix"|"foreign-spend"|"priorities"|"summary"`; removes `"has-cards"`.
- `ABOUT` order: household, money-sharing, birth-year, work, vat, income-regularity, children, child-years, income, spend, housing, savings, banks, debit-cards, cards, card-repayment, spend-mix, foreign-spend.
- `canonical()`: `[...ABOUT, ...GOALS, ...riskScreens(), "invested", "priorities", "summary", "upload"]`.
- `screensFor` adds: skip money-sharing unless `household.value.kind === "together"`; skip card-repayment unless `statedCards` has at least one id and `noCards !== true`; foreign-spend and spend-mix always shown.
- `SECTION_END`: `foreign-spend: 1` replaces `savings: 1`; `invested: 3` stays.
- Export `ROUND1_NEW: readonly ScreenId[] = ["money-sharing","birth-year","income-regularity","banks","card-repayment","spend-mix","foreign-spend","priorities"]` for Task 13.
- Export `isAnswered(p: AdvisorProfile, id: ScreenId): boolean` (true when the screen's field is set; summary/upload always false).

- [ ] **Step 1: Failing tests:** replace the hard-coded count test with `"default screens"` asserting the exact `screensFor(emptyProfile())` array; `"together adds money-sharing"`; `"card-repayment only after a stated card"`; `"has-cards no longer exists"`; `"summary sits after priorities and before upload"`.
- [ ] **Step 2: Run** `pnpm --filter @lavega/web exec vitest run src/intake/wizard/screens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. IntakeWizard tests will fail until Task 5; that is expected.
- [ ] **Step 5: Stage.**

### Task 4: Copy

**Files:**
- Modify: `apps/web/src/copy/wizard.ts`, `apps/web/src/copy/intake.ts`
- Test: existing `apps/web/src/copy/wizard.test.ts`, `parity.test.ts`

**Interfaces:**
- `WizardCopy.questions` adds `moneySharing, birthYear, incomeRegularity, banks, cardRepayment, spendMix, foreignSpend, priorities, summary: string` and round 2 `cutTargets, checkInCadence, confidence, programs, pointsGoal, flights: string`.
- Option label records: `moneySharing: Record<MoneySharing,string>`, `incomeRegularity`, `cardRepayment`, `spendAreas: Record<SpendArea,string>`, `foreignSpend`, `priorities: Record<Priority,string>`, `cutTargets: Record<CutTarget,string>`, `checkInCadence`, `confidence: Record<1|2|3|4,string>`, `pointsGoal`, `flights: Record<FlightsPerYear,string>`, `bankNames: Record<string,string>` (brand id to display name, plus `other`), `noneCard: string`, `summaryEdit: string` ("Wijzig"/"Change"), `spendMixHint: string` ("Kies er maximaal 3"/"Pick up to 3").
- NL question copy (exact): moneySharing "Delen jullie je geld?"; birthYear "In welk jaar ben je geboren?"; incomeRegularity "Is je inkomen elke maand gelijk?"; banks "Bij welke banken zit je?"; cardRepayment "Betaal je je creditcard elke maand helemaal af?"; spendMix "Waar gaat het meeste geld naartoe?"; foreignSpend "Betaal je weleens in het buitenland of in een andere valuta?"; priorities "Waar wil je dat LaVega je mee helpt?"; summary "Dit weet LaVega nu over je". EN equivalents in the same plain register.
- `AboutYouCopy`: labels for every new field row.

- [ ] **Step 1:** Add the types; `tsc` fails until both locales are filled. Run `pnpm --filter @lavega/web exec tsc --noEmit -p .`. Expected: FAIL.
- [ ] **Step 2:** Fill NL and EN.
- [ ] **Step 3: Run** tsc and `vitest run src/copy`. Expected: PASS.
- [ ] **Step 4: Stage.**

### Task 5: New round 1 screens in the wizard

**Files:**
- Modify: `apps/web/src/intake/wizard/screenViews.tsx`, `apps/web/src/views/IntakeWizard.tsx`
- Test: `apps/web/src/views/IntakeWizard.test.tsx`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces in screenViews.tsx: `MultiScreen<T extends string>(p: Busy & { copy; label; options: {value:T;label:string}[]; initial: readonly T[]; max?: number; allowEmpty?: boolean; hint?: string; onSubmit: (v: T[]) => void })` (WorkScreen becomes a thin use of it; when `max` is reached unpicked tiles are disabled); `BirthYearScreen(p: Busy & { copy; label; initial: number|null; currentYear: number; onSubmit: (y: number) => void })` (valid range `currentYear-100 .. currentYear-16`).
- Cards screen: the credit `CardsScreen` gets a `noneLabel` tile; picking it calls `answerCards(p, false, asOf)`, picking cards calls `answerCards(p, true, asOf)` then `applyStatedCards`.
- Housing: `HousingScreen` drops the kind tiles; submit calls `applyStatedHousing(p, existingKind ?? "other", cents, asOf)`.
- Banks screen options: debit brands + credit-only brands from cardOptions.ts brand ids, deduped, plus `"other"`, labels from `copy.bankNames`; `allowEmpty: false`.
- spend-mix: `MultiScreen` with `max: 3`.

- [ ] **Step 1: Failing tests** (IntakeWizard.test.tsx, using `tap`/`nextBtn`): `"together then shared stores moneySharing"`; `"birth year 1890 keeps Verder disabled; 1990 saves"`; `"spend mix disables a fourth pick"`; `"None on cards skips card-repayment"`; `"housing asks only an amount"`; `"banks saves picked brand ids"`. Update counter expectations to the new totals.
- [ ] **Step 2: Run** `pnpm --filter @lavega/web exec vitest run src/views/IntakeWizard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `src/intake`. Expected: PASS.
- [ ] **Step 5: Stage.**

### Task 6: Summary screen

**Files:**
- Create: `apps/web/src/intake/wizard/SummaryScreen.tsx`
- Modify: `apps/web/src/views/IntakeWizard.tsx`
- Test: `apps/web/src/intake/wizard/SummaryScreen.test.tsx`

**Interfaces:**
- Consumes: `aboutYouRows` builders (apps/web/src/intake/aboutYouRows.ts) for line text; `isAnswered` (Task 3).
- `SummaryScreen(p: Busy & { copy; rows: { screen: ScreenId; label: string; value: string }[]; onEdit: (s: ScreenId) => void; onSubmit: () => void })`. One line per answered screen, each with a `copy.summaryEdit` button calling `onEdit`. Verder calls `onSubmit`.
- IntakeWizard: `onEdit` sets the screen; after Verder on that screen the wizard returns to `"summary"` (track `returnTo: ScreenId | null` in wizard state).

- [ ] **Step 1: Failing tests:** `"lists only answered screens"`; `"Wijzig on income opens income and Verder returns to the summary"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Stage.**

### Task 7: Income regularity defaults and buffer preselect

**Files:**
- Modify: `apps/web/src/views/IntakeWizard.tsx`; plan copy for the cash-flow note (`apps/web/src/plan/sections/MonthSection.tsx` or the `workNoteFor` helper in `apps/web/src/plan/FromAnswers.tsx`)
- Test: `apps/web/src/views/IntakeWizard.test.tsx`, the section's test

**Interfaces:**
- income-regularity screen `initial`: stored value, else `"varies"` when `isSelfEmployed(p)`, else null.
- buffer screen `initial`: stored months, else `"6"` when `incomeRegularity.value === "varies"`, else null.
- Month section shows a note when `PlanProfile.incomeRegularity` is "varies" (same mechanism as the freelance work note). Runs after Task 10, which adds the field.
- `FromAnswers.tsx`: when `moneySharing` is "separate", stated income and spend rows are labelled as the user's own ("jouw eigen"), not the household's; "shared"/"mixed" keep the household wording.

- [ ] **Step 1: Failing tests:** `"freelance preselects varies"`; `"varies preselects 6 months on buffer"`; `"month section shows the varying income note"`; `"separate money labels income as your own"`.
- [ ] **Step 2-4:** run, implement, run.
- [ ] **Step 5: Stage.**

### Task 8: About you rows

**Files:**
- Modify: `apps/web/src/intake/aboutYouRows.ts`
- Test: its test file (`aboutYouRows.test.ts`)

**Interfaces:** one builder per new round 1 and round 2 field using `single(...)` with `choice` or `multi` editors; `birthYear` uses the `years` editor; money-sharing row only when `household.kind === "together"`.

- [ ] **Step 1: Failing tests:** `"every new field renders a row with its label"`; `"editing spend mix applies applySpendMix"`.
- [ ] **Step 2-4:** run, implement, run.
- [ ] **Step 5: Stage.**

### Task 9: Connect-for-the-full-picture checklist

**Files:**
- Create: `packages/core/src/plan/connectChecklist.ts`, `apps/web/src/components/blocks/ConnectChecklist.tsx`
- Modify: brand prefix tables become importable (export `brandOfCardId(id: string, kind: CardKind): CardBrand | null` from `apps/web/src/intake/wizard/cardOptions.ts`); mount the block in `apps/web/src/views/Overzicht.tsx` and in the Your plan view
- Test: `packages/core/src/plan/connectChecklist.test.ts`, `ConnectChecklist.test.tsx`

**Interfaces:**
- `BANK_ALIASES: Record<string, readonly string[]>` (brand id to lower-case name fragments, e.g. `abn: ["abn amro"]`, `ing: ["ing"]` matched as a whole word, `amex: ["american express","amex"]`, `ics: ["international card services","ics"]`, `sns-asn-regio: ["sns","asn","regiobank"]`).
- `connectChecklist(i: { statedBanks: readonly string[]; impliedBanks: readonly string[]; accounts: readonly { bank: string; linkedAt?: string }[] }): { brand: string; connected: boolean }[]`: union of stated and implied brands, "other" excluded, stable order; `connected` only when some account with `linkedAt` has a `bank` matching an alias.
- Block shows nothing when every brand is connected or the list is empty; each unconnected brand links to the Koppelingen view.

- [ ] **Step 1: Failing tests:** `"ING card implies ING"`; `"CSV account without linkedAt is not connected"`; `"ING does not match 'Leasing'"`; `"other is never listed"`; `"block hides when all connected"`.
- [ ] **Step 2-4:** run, implement, run.
- [ ] **Step 5: Stage.**

### Task 10: Plan profile fields and card comparison

**Files:**
- Modify: `packages/core/src/plan/profileView.ts`, `packages/core/src/plan/factsheet.ts` (`PLAN_ENGINE_VERSION = "plan-3"`), `packages/core/src/plan/cards.ts`, `apps/web/src/plan/heldCards.ts`, `apps/web/src/plan/usePlan.ts`, `apps/web/src/plan/sections/CardsSection.tsx`
- Test: `profileView.test.ts`, `cards.test.ts`, `heldCards.test.ts`

**Interfaces:**
- `PlanProfile` adds `moneySharing: MoneySharing|null; birthYear: number|null; incomeRegularity: IncomeRegularity|null; cardRepayment: CardRepayment|null; spendMix: SpendArea[]; foreignSpend: ForeignSpend|null; priorities: Priority[]; pointsGoal: PointsGoal|null`; all included in `profileHash`.
- `buildHeldCards` gains `statedCreditIds: readonly string[]`: each catalogue id not already held via bank data becomes a `HeldCardInput` with `accountKey: "stated:<id>"`, facts from the catalogue entry; `"other"` is skipped.
- `computeCards`: candidates include stated cards, valued on stated spend (`spendStatedRange` midpoint) when there is no cardable spend history; foreign share = 0.15 / 0.05 / 0 for often / sometimes / never, one step up when `spendMix` contains "travel"; points valued per `pointsGoal` (cashback-preferring users: points value 0); when `cardRepayment` is "sometimes" or "rarely", a new `interest` figure (yearly interest at the catalogue `interestPct` on one month of stated spend) leads the section and ranking is by lowest `interestPct` first.

- [ ] **Step 1: Failing tests:** `"stated card with no bank data is ranked"`; `"stated card also in bank data counts once"`; `"often foreign spend adds fx fees"`; `"revolver ranks by interest and shows the interest figure"`; `"cashback goal values points at zero"`; `"planProfileOf exposes the new fields and they change profileHash"`.
- [ ] **Step 2-4:** run (`@lavega/core` and `@lavega/web` files), implement, run.
- [ ] **Step 5: Stage.**

### Task 11: Investing line and experience

**Files:**
- Modify: `apps/web/src/plan/sections/GoalsSection.tsx` and its copy
- Test: `GoalsSection.test.tsx`

**Interfaces:** when `birthYear` is set, the capacity/tolerance block shows "Nog {n} jaar tot je 67e. Je precieze AOW leeftijd staat bij de SVB." with an SVB link; when `experience` is "beginner" (from `investedBefore === false`), the general explainer is shown before the score line. No other investing output.

- [ ] **Step 1: Failing tests:** `"born 1990 in 2026 shows 31 years"`; `"beginner sees the explainer first"`; `"copy passes findAdviceLanguage"`.
- [ ] **Step 2-4:** run, implement, run.
- [ ] **Step 5: Stage.**

### Task 12: Priorities order Your plan

**Files:** Modify the Your plan view that orders sections (`apps/web/src/views/Plan.tsx` or its section list). Test: its test.

**Interfaces:** `orderSections(sections: SectionId[], priorities: Priority[]): SectionId[]`: mapping spend-less → month/spending, save-more and children → goals, pay-off-debt → debts, cards-points → cards, subscriptions → subscriptions, start-investing → goals; matched sections move to the front in priority order, the rest keep their order.

- [ ] **Step 1: Failing test** `"cards-points first puts cards first, others keep order"`.
- [ ] **Step 2-4, Step 5: Stage.**

### Task 13: New questions for existing users

**Files:** Modify `apps/web/src/intake/wizard/screens.ts` (`resumeScreen`), `apps/web/src/components/blocks/IntakeInviteCard.tsx` (`inviteState`), copy. Test: `screens.test.ts`, `IntakeInviteCard.test.tsx`.

**Interfaces:**
- `pendingNewQuestions(p: AdvisorProfile): ScreenId[]` = `ROUND1_NEW` filtered by `screensFor(p)` and `!isAnswered`.
- `resumeScreen`: when `blocksDone >= 3` and `pendingNewQuestions(p)` is non-empty, return its first item; after the last pending one the wizard goes to "summary" then exits (no upload, no risk).
- `inviteState` returns a new `kind: "new-questions"` with the count; card copy "Een paar nieuwe vragen" / "A few new questions".

- [ ] **Step 1: Failing tests:** `"finished user resumes at the first new question"`; `"after the new questions comes the summary, not the risk block"`; `"invite shows the new-questions variant with a count"`.
- [ ] **Step 2-4, Step 5: Stage.**

### Task 14: Round 2 questions and invite

**Files:** Modify screens.ts (round 2 ids `"cut-targets"|"check-in"|"confidence"|"programs"|"points-goal"|"flights"` in a separate `ROUND2` list, not in `canonical()`), IntakeWizard.tsx (a `round: 1 | 2` prop), IntakeInviteCard.tsx, Overzicht.tsx. Test: screens, IntakeWizard, invite tests.

**Interfaces:**
- `round2Due(p: AdvisorProfile, hasTransactions: boolean): boolean` = `blocksDone >= 3 && hasTransactions && p.intake.round2Done !== true`.
- Round 2 runs `ROUND2` then sets `intake.round2Done = true`; programs options come from `REWARD_PROGRAMS` (packages/core/src/rewards.ts), multi, `allowEmpty: true`.
- Invite copy "3 vragen zodat LaVega je kan coachen" / "3 questions so LaVega can coach you".

- [ ] **Step 1: Failing tests:** `"round 2 not due before any transaction"`; `"round 2 due after first transaction"`; `"finishing round 2 sets round2Done"`; `"programs allows none"`.
- [ ] **Step 2-4, Step 5: Stage.**

### Task 15: Punten prefill

**Files:** Modify `apps/web/src/views/Punten.tsx`. Test: its test.

**Interfaces:** programmes in `statedPrograms` without a stored balance appear as rows with an empty balance field and "Vul je saldo in"; nothing is invented.

- [ ] **Step 1: Failing test** `"stated Flying Blue shows an empty row"`.
- [ ] **Step 2-4, Step 5: Stage.**

### Task 16: Profile summary in the AI context (privacy path)

**Files:** Modify `apps/web/src/agent/tabContext.ts` (`TabState` gains `profileSummary`), `apps/server/src/agent/chatContext.ts` (`ALLOW` for every tab gains `"profile"`), the caller that builds `TabState`. Test: `apps/web/src/agent/tabContext.test.ts`, `apps/server/src/agent/chatContext.test.ts`, `redaction.test.ts`.

**Interfaces:**
- `profileSummaryOf(p: AdvisorProfile): { priorities: Priority[]; cutTargets: CutTarget[]; checkInCadence: CheckInCadence|null; confidence: 1|2|3|4|null; household: "alone"|"together"|null; moneySharing: MoneySharing|null; incomeRegularity: IncomeRegularity|null; spendMix: SpendArea[]; cardRepayment: CardRepayment|null; pointsGoal: PointsGoal|null }`. Only enum values. No birthYear, banks, cards, amounts, names.
- Server allowlist accepts `profile` only with exactly these keys and enum values (anything else dropped).

- [ ] **Step 1: Failing tests:** `"summary carries only enums"`; `"birthYear and statedBanks never appear"`; `"server drops unknown profile keys and non-enum values"`.
- [ ] **Step 2-4:** run, implement, run.
- [ ] **Step 5:** pstack `interrogate` review on this task's diff before staging.
- [ ] **Step 6: Stage.**

### Task 17: Final check

- [ ] Full suite: `pnpm --filter @lavega/web exec vitest run`, `pnpm --filter @lavega/core exec vitest run`, server tests, tsc, `pnpm lint`, `pnpm --filter @lavega/web build`.
- [ ] Rebuild local app and walk the wizard end to end on http://localhost:8787 with the test account (fresh user and finished user), round 2 after an upload of the synthetic ING CSV.
- [ ] Whole-branch review by a fresh reviewer.
