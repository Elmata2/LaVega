# Intake Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card-based intake (Step 0 + Blocks 1-3) with a full-screen, one-question-per-screen wizard in the look chosen on 2026-10-26 (direction C).

**Architecture:** A pure screen model (`intake/wizard/screens.ts`) decides which screens exist for a profile, where to resume and what bookkeeping a finished screen writes. Each screen saves through the existing `intake/state.ts` appliers via `useProfileCommit`. A new view `views/IntakeWizard.tsx` renders one screen at a time inside `WizardFrame`, and `App.tsx` renders it without the app chrome.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (jsdom for views), Effect `Schema` in `@lavega/core`, plain CSS in `apps/web/src/styles/`.

**Spec:** `docs/superpowers/specs/2026-10-26-intake-wizard-design.md`

## Global Constraints

- One screen shows only: progress bar, back arrow, "n / N" counter, section label, the question, its answer control, and (where the spec says) one "Verder" button. No explanations, no inferred data.
- Colours: background `#ffffff`; text `#14161a`; muted `#9aa0aa`; tile border `#e4e7ec`; empty progress `#eceef2`; progress fill gradient `#4263eb` → `#7048e8`; section label and selected accent `#7048e8`; selected tile fill `#f3f0ff`, text `#5f3dc4`; "Verder" pill `#14161a` with white text, not full width.
- Centred column, max width about 420px on desktop, full width on a phone, no NavBar/TopBar while the wizard is open.
- Motion: at most a short fade/slide between screens, none under `prefers-reduced-motion`.
- Every user-facing string lives in a copy module with NL and EN, typed-complete (no `locale="nl"` defaults, per the i18n boundary).
- Amounts are whole euros; stored in cents. Income must be > 0; spend, housing and savings may be 0; blank is invalid.
- "Samen" ⇒ screens 3-6 ask for the household and the wizard writes `partnerIncomeInScope: true`; "Alleen" ⇒ personal wording and `false`.
- Goal defaults: `kind: "general"`, `priority: "important"`, `accountRefs: []`; target date must be after today. "Nog geen doel" is the only skip.
- Info, not advice: no sentence may tell the user what to do with money (the existing `findAdviceLanguage` scan applies to the new copy).
- No commit or push by workers; the controller leaves work staged for the owner.

## Review Focus

1. Reloading the tab mid-wizard (including right after a "Ja" on children or debts, before the detail screen is filled) must resume on the right screen, not loop or skip. → Task 2 tests `resume after Ja on children opens child-years` and `resume after Ja on debts opens debt-details`.
2. A failed vault write on an auto-advancing tap must not advance and must show the save error; tapping again retries. → Task 5 test `failed save on a choice stays on the screen`.
3. Going Back and switching Ja → Nee on children removes the children but never deletes a goal. → Task 2 test `answering Nee after Ja clears children, keeps goals`.
4. An existing profile from the old intake (blocksDone 1, 2 or 3, no `lastScreen`) opens at the matching section start or not at all. → Task 2 test `old-intake profiles resume by section`.
5. Typing "3.250", "3250,50" or "€ 3 250" in an amount field: the Dutch thousands dot must not turn €3.250 into €3,25. → Task 4 test `parseEuros accepts Dutch formats`.

---

### Task 1: Wizard bookkeeping on the profile (core)

**Files:**
- Modify: `packages/core/src/advisor/profile.ts:154-157` (the `intake` struct)
- Test: `packages/core/src/advisor/profile.test.ts`

**Interfaces:**
- Produces: `AdvisorProfile.intake` gains `lastScreen?: string` and `noUserDebts?: boolean` (both `Schema.optionalKey`). `emptyProfile()` is unchanged.

- [ ] **Step 1: Write the failing tests** in `profile.test.ts`:
  - `decodes a stored profile without the wizard keys` — decode `{ removed: [], intake: { blocksDone: 2, step0: "none" } }`; expect `intake.lastScreen` undefined and no error.
  - `round-trips lastScreen and noUserDebts` — encode then decode `intake: { blocksDone: 1, step0: "none", lastScreen: "savings", noUserDebts: true }`; expect equal.
- [ ] **Step 2: Run** `cd packages/core && npx vitest run src/advisor/profile.test.ts` — expect the round-trip test to FAIL.
- [ ] **Step 3: Add the two optional keys** to the `intake` struct.
- [ ] **Step 4: Run** the same command plus `npx tsc -p . --noEmit` — expect PASS and no type errors.
- [ ] **Step 5: Stage** `git add packages/core/src/advisor/profile.ts packages/core/src/advisor/profile.test.ts`.

### Task 2: Screen model (pure)

**Files:**
- Create: `apps/web/src/intake/wizard/screens.ts`
- Test: `apps/web/src/intake/wizard/screens.test.ts`

**Interfaces:**
- Consumes: Task 1 keys; appliers `applyChildren` from `intake/state.ts`.
- Produces:
  ```ts
  export type ScreenId =
    | "household" | "children" | "child-years" | "income" | "spend" | "housing" | "savings"
    | "goal" | "debts" | "debt-details" | "buffer"
    | "risk:loss-20" | "risk:gain-vs-loss" | "risk:sleep" | `risk:${string}` /* one per RISK_SCALE item, in RISK_SCALE order */
    | "invested";
  export type Section = "about" | "goals" | "risk";
  export function screensFor(p: AdvisorProfile): ScreenId[];
  export function sectionOf(id: ScreenId): Section;
  export function resumeScreen(p: AdvisorProfile): ScreenId | "done";
  export function markDone(p: AdvisorProfile, id: ScreenId): AdvisorProfile;
  export function answerNoChildren(p: AdvisorProfile, asOf: string): AdvisorProfile;
  export function answerDebts(p: AdvisorProfile, has: boolean): AdvisorProfile;
  export function reopenRisk(p: AdvisorProfile): AdvisorProfile;
  ```
  Rules:
  - `screensFor` = the order in the spec. `child-years` is present unless `p.children?.value` is an empty array. `debt-details` is present unless `p.intake.noUserDebts === true`. Risk screens come from `RISK_SCALE.items` (do not hard-code the five ids beyond the type).
  - `resumeScreen`: if `lastScreen` is set, the screen after it in `screensFor(p)`, or `"done"` after the last. If unset, by `blocksDone`: 0 → `"household"`, 1 → `"goal"`, 2 → first risk screen, 3 → `"done"`.
  - `markDone(p, id)` sets `intake.lastScreen = id`, sets `step0` to `"none"` if it is null, and raises `blocksDone` (never lowers it) to 1 when `id === "savings"`, 2 when `id === "buffer"`, 3 when `id === "invested"`.
  - `answerNoChildren` = `applyChildren(p, [], asOf)`. `answerDebts(p, false)` sets `noUserDebts: true`; `answerDebts(p, true)` removes it.
  - `reopenRisk` sets `blocksDone` to `min(blocksDone, 2)` and `lastScreen` to `"buffer"`.

- [ ] **Step 1: Write failing tests** (node environment; build profiles with `emptyProfile()` + appliers):
  - `fresh profile resumes at household`.
  - `screensFor has 17 screens by default and 16 after Nee on children` (5 risk items; adjust only if `RISK_SCALE.items.length` differs, asserting via that length).
  - `resume after Ja on children opens child-years` — `markDone(p, "children")` with no children field → `resumeScreen` is `"child-years"`.
  - `resume after Ja on debts opens debt-details` — `markDone(answerDebts(p, true), "debts")` → `"debt-details"`; with `answerDebts(p, false)` → `"buffer"`.
  - `answering Nee after Ja clears children, keeps goals` — profile with two children and one goal; `answerNoChildren` → `children.value` is `[]`, `goals` length 1.
  - `markDone raises blocksDone at section ends and never lowers it` — `"savings"` → 1, `"buffer"` → 2, `"invested"` → 3; `markDone` of `"household"` on a blocksDone-3 profile keeps 3.
  - `markDone writes step0 none once` — null → `"none"`; `"bank"` stays `"bank"`.
  - `old-intake profiles resume by section` — blocksDone 1/2/3 without `lastScreen` → `"goal"` / first risk screen / `"done"`.
  - `reopenRisk resumes at the first risk screen`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/intake/wizard/screens.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `screens.ts` per the signatures and rules above.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Stage** both files.

### Task 3: Wizard copy (NL + EN)

**Files:**
- Create: `apps/web/src/copy/wizard.ts`
- Test: `apps/web/src/copy/wizard.test.ts`

**Interfaces:**
- Consumes: `Locale` from `../locale.js`; `RISK_SCALE` item ids.
- Produces: `export const wizardCopy: Record<Locale, WizardCopy>` where `WizardCopy` has: `sections: Record<Section, string>`; `next`, `back` (aria), `counter: (n: number, of: number) => string`, `saveFailed`, `estimateHint`, `noGoal`, `addChild`, `childYear: (n: number) => string`; `questions: { household, children, childYears, income(together: boolean), spend(together), housing(together), savings(together), goal, debts, debtDetails, buffer, invested }` each a string (or function of `together`); option labels `alone`, `together`, `yes`, `no`, `housingKinds: { rent, mortgage, other }`, `bufferOption: (months: number) => string`; goal field labels `purpose`, `target`, `date`; debt field labels `lender`, `monthly`; errors `amountRequired`, `incomePositive`, `dateFuture`.
- Risk prompts and options are NOT copied: the wizard reuses `intakeCopy[locale].block3.risk.items` and `.knowledge.invested` (`prompt`, `yes`, `no`: "Heb je al eens belegd…") as they are.

Exact NL question copy (EN is the plain translation):
- household: "Woon je alleen of samen?" · children: "Heb je kinderen?" · childYears: "In welk jaar zijn ze geboren?"
- income: alone "Wat verdien je netto per maand?" / together "Wat verdienen jullie samen netto per maand?"
- spend: "Hoeveel geef je ongeveer uit per maand?" / "Hoeveel geven jullie samen ongeveer uit per maand?"
- housing: "Huur of koop je, en wat kost het per maand?" / "Huren of kopen jullie, en wat kost het per maand?" · kinds "Huur" / "Hypotheek" / "Anders"
- savings: "Hoeveel spaargeld heb je ongeveer?" / "Hoeveel spaargeld hebben jullie samen ongeveer?"
- goal: "Waar spaar je voor?" · noGoal "Nog geen doel" · debts: "Heb je schulden die we niet zien?" · debtDetails: "Bij wie, en hoeveel los je per maand af?" · buffer: "Hoeveel maanden buffer wil je achter de hand?"
- sections: "Over jou" / "Doelen" / "Risico"; next "Verder"; estimateHint "Een schatting is goed"; counter `${n} / ${of}`.

- [ ] **Step 1: Write failing tests:** `every NL key has an EN key` (structural walk, same as the existing parity tests), `no wizard string contains advice language` (run `findAdviceLanguage` over every string and every function called with `true`/`false`), `household variants differ` (income(true) !== income(false) in both locales).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/copy/wizard.test.ts` — FAIL.
- [ ] **Step 3: Write the module** with the exact NL copy above.
- [ ] **Step 4: Run** — PASS. Also run `npx vitest run src/copy` to keep existing copy tests green.
- [ ] **Step 5: Stage.**

### Task 4: Frame, controls and styles

**Files:**
- Create: `apps/web/src/intake/wizard/WizardFrame.tsx`, `apps/web/src/intake/wizard/ChoiceTiles.tsx`, `apps/web/src/intake/wizard/AmountField.tsx`, `apps/web/src/intake/wizard/parseEuros.ts`, `apps/web/src/styles/wizard.css`
- Test: `apps/web/src/intake/wizard/parseEuros.test.ts`, `apps/web/src/intake/wizard/controls.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // WizardFrame: progress + back + counter + section label + question (h1) + children + optional footer
  type WizardFrameProps = { step: number; total: number; section: string; question: string;
    onBack: (() => void) | null; backLabel: string; children: ReactNode; footer?: ReactNode };
  // ChoiceTiles: radiogroup; calls onPick once per tap; selected = current stored value
  type ChoiceTilesProps<T extends string> = { label: string; options: { value: T; label: string }[];
    selected: T | null; onPick: (value: T) => void; disabled?: boolean };
  // AmountField: one large euro input; reports cents or null
  type AmountFieldProps = { label: string; valueCents: number | null; onChange: (cents: number | null) => void; hint?: string };
  export function parseEuros(text: string): number | null; // whole euros -> cents
  ```
  - `ChoiceTiles` renders a `role="radiogroup"` of `role="radio"` buttons with `aria-checked`; arrow keys move, Enter/Space picks.
  - `WizardFrame` puts the question in an `h1` and moves focus to it when `step` changes; progress bar has `role="progressbar"` with `aria-valuenow={step}` `aria-valuemax={total}`.
  - All styling in `wizard.css` using the Global Constraints values, class prefix `wz-`.

- [ ] **Step 1: Write failing tests:**
  - `parseEuros accepts Dutch formats` — `"3.250"` → 325000, `"3250"` → 325000, `"€ 3 250"` → 325000, `"3250,50"` → 325100 (rounded to whole euros), `"0"` → 0, `""` → null, `"abc"` → null, `"-5"` → null.
  - `ChoiceTiles marks the stored value checked and calls onPick once` (jsdom).
  - `WizardFrame shows n / N and hides back on the first screen` (`onBack: null`).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/intake/wizard` — FAIL.
- [ ] **Step 3: Implement** the four modules and the stylesheet.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Stage.**

### Task 5: The wizard view

**Files:**
- Create: `apps/web/src/views/IntakeWizard.tsx`, `apps/web/src/intake/wizard/screenViews.tsx` (one small component per screen kind: choice, amount, housing, child years, goal, debt details)
- Test: `apps/web/src/views/IntakeWizard.test.tsx`

**Interfaces:**
- Consumes: Tasks 2-4; `useProfileCommit`; appliers `applyHousehold`, `applyChildren`, `applyStatedRange`, `applyStatedHousing`, `applyStatedSavings`, `applyGoals`, `addUserDebt`, `applyBuffer`, `applyRiskAnswers`, `applyKnowledge` (call with `answers = existing knowledge answers ?? {}` and the boolean).
- Produces:
  ```ts
  export type IntakeWizardProps = { store: AdvisorProfileStore | null; corrupt?: boolean; asOf: string;
    onSave: (next: AdvisorProfileStore) => Promise<void>; onFinish: () => void; onExit: () => void; now?: () => string };
  export default function IntakeWizard(props: IntakeWizardProps): JSX.Element;
  ```
  Behaviour:
  - Current screen = local state initialised from `resumeScreen(store.current)`; `"done"` calls `onFinish` immediately.
  - A screen saves with one `update(p => markDone(apply(p), id))`; only when it resolves `true` does the view advance. On `false` the screen stays and shows `wizardCopy.saveFailed` in a `role="alert"`.
  - Choice screens (household, children, debts, buffer, every risk screen, invested) save and advance on tap. Others save on "Verder", which is disabled until the input is valid.
  - Income/spend save `{ lowCents: x, highCents: x }`. Household saves `partnerIncomeInScope: kind === "together"`.
  - Children "Nee" → `answerNoChildren`; "Ja" → only `markDone`. Child years: rows of birth-year inputs (1900..current year), ids `crypto.randomUUID()`-based like Block2, "add child" adds a row; at least one row required.
  - Goal: purpose (non-empty), target (> 0), date (> `asOf`); writes `applyGoals(p, [...existingGoals, newGoal])` only when no goal with the same id exists (editing via Back replaces that goal by id). "Nog geen doel" = `markDone` only.
  - Debts: "Nee" → `answerDebts(p,false)`; "Ja" → `answerDebts(p,true)`. Debt details → `addUserDebt` with lender + monthly; Back + resave replaces that debt by id (use `removeUserDebt` first).
  - Back goes to the previous screen in `screensFor(profile)`; on the first screen the back arrow is hidden. A small "×" (aria-label from copy) calls `onExit`.
  - After `invested` is saved, call `onFinish`.
  - Every screen pre-fills from the stored profile.

- [ ] **Step 1: Write failing tests** (jsdom, store in memory, `onSave` a `vi.fn` resolving):
  - `fresh store opens on household and shows 1 / 17`.
  - `tapping Samen saves household together with partnerIncomeInScope and words income for the household`.
  - `income Verder is disabled when empty and saves a zero-width range`.
  - `Nee on children skips child-years and the counter shows 16`.
  - `failed save on a choice stays on the screen` — `onSave` rejects once: still on household, alert visible; tap again → advances.
  - `goal with a past date cannot be saved; Nog geen doel advances without a goal`.
  - `the last risk tap then invested calls onFinish with blocksDone 3`.
  - `reopening a half-done store resumes at the saved screen` — store with `lastScreen: "spend"` opens on housing.
  - `no rendered screen contains advice language` — walk all screens with a filled profile and run `findAdviceLanguage` on `document.body.textContent`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/views/IntakeWizard.test.tsx` — FAIL.
- [ ] **Step 3: Implement** `screenViews.tsx` and `IntakeWizard.tsx`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Stage.**

### Task 6: Wire it into the app, remove the old intake

**Files:**
- Modify: `apps/web/src/App.tsx` (fresh-vault effect ~461-472; bank-return branch ~872-886; `view === "intake"` block ~1926-1958; shell ~1657-1674)
- Modify: `apps/web/src/components/blocks/IntakeInviteCard.tsx` (`inviteState` uses `resumeScreen`)
- Modify: `apps/web/src/intake/aboutYouRows.ts:75-79` (`reopened` → `reopenRisk`)
- Delete (if nothing else imports them after the change; check with `grep -rn`): `apps/web/src/views/Intake.tsx`, `views/Intake.test.tsx`, `intake/Step0.tsx`, `intake/Block1.tsx`, `intake/Block2.tsx`, `intake/Block3.tsx`, `intake/ProposalCard.tsx`, `intake/StatedCards.tsx`, `intake/RoomPayoff.tsx`, `intake/inference.ts(+test)`, and `Stage`/`resumeStage`/`markStep0`/`completeBlock` in `intake/state.ts` plus their tests. Copy keys in `copy/intake.ts` used only by deleted files are removed too.
- Test: `apps/web/src/components/blocks/IntakeInviteCard.test.tsx` (create or extend), `apps/web/src/App.intake.test.tsx` only if an App-level harness already exists; otherwise covered by Task 7's browser run.

**Interfaces:**
- Consumes: `IntakeWizard` (Task 5), `resumeScreen`/`reopenRisk` (Task 2).
- Produces: when `view === "intake"` the app renders only `<IntakeWizard … onFinish={() => setView("plan")} onExit={() => setView("overview")} />` full-screen (no `NavBar`, no `TopBar`, no chat/widget chrome), wrapped in the existing loading/error handling. `inviteState` returns `{ resumeAt: ScreenId | null, riskDue }`.

- [ ] **Step 1: Write failing tests:**
  - `invite shows start for a fresh store and continue for a half-done one` (resumeAt `null` vs `"housing"`).
  - `invite after reopenRisk resumes at the first risk screen`.
  - `riskDue still surfaces after blocksDone 3`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/blocks` — FAIL.
- [ ] **Step 3: Make the changes:** fresh vault → `setView("intake")` as today (now the wizard); delete the bank-return-to-intake branch (keep the rest of that effect); render the wizard without chrome; `onFinish` → `"plan"`; update invite + about-you; delete the old intake files and dead exports.
- [ ] **Step 4: Run the full gate** from the worktree root: `npx pnpm test`, `npx pnpm typecheck --force`, `npx pnpm lint` — all green (web, core, server, extension included).
- [ ] **Step 5: Stage.**

### Task 7: Browser proof

**Files:**
- Evidence: `.superpowers/sdd/2026-10-26-intake-wizard/evidence/` (screenshots + `browser.md`)

- [ ] **Step 1: Build and serve** — `npx pnpm --filter @lavega/web build`, then the API server serves `apps/web/dist` on `http://localhost:8787` (start with `cd apps/server && LAVEGA_ALLOW_UNAUTHENTICATED=1 npx tsx src/index.ts` if not running). Use a fresh browser profile/origin so the vault is empty. Do not use `verify-lavega up` (PostHog key) and do not let any skill install gstack.
- [ ] **Step 2: Walk** `http://localhost:8787/app`: fresh vault opens the wizard on screen 1 with no nav; choose Samen (check household wording on 3-6), Ja on children (one child), amounts 4000 / 3000 / Huur 1200 / 8000, a goal, Ja on debts (DUO 100), buffer 3, all risk taps, invested Nee → lands on Jouw plan with the numbers present.
- [ ] **Step 3: Reload mid-way** (after the children "Ja") → resumes on child years. Check desktop width and 390px width. Screenshot each screen kind.
- [ ] **Step 4: Console** has no errors from first load on. Record results in `browser.md`.
- [ ] **Step 5: Stage** nothing under `.superpowers/` (git-ignored); leave the code staged for the owner.
