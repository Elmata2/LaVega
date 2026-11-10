# Intake Wizard Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a work-type question, spending bands for "weet ik niet", stated credit cards, and an optional bank-statement upload screen to the intake wizard.

**Architecture:** Two new stated profile fields in core (`work`, `statedCards`) plus one intake marker (`noCards`). New screen ids in `intake/wizard/screens.ts`; new screen views in `screenViews.tsx`; the upload screen calls the app's existing import through a new `onImport` prop. Plan and About you only display the new data.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (jsdom), Effect `Schema` in `@lavega/core`, `wizard.css`.

**Spec:** `docs/superpowers/specs/2026-10-26-intake-wizard-design.md` (section "Round 2 additions")

## Global Constraints

- Same visual rules as round 1 (white, Inter, one centred axis, compact tiles, small black "Verder", `wz-` classes inside `@layer components`), and every string in NL + EN copy modules, typed-complete, passing `findAdviceLanguage`.
- Work kinds, exactly: `employed` "Loondienst", `freelance` "Freelance / zzp", `business` "Eigen bedrijf", `student` "Student", `jobseeking` "Werkzoekend", `retired` "Met pensioen", `other` "Anders". Multi-select, at least one.
- Spend bands (cents low–high): 75000–150000 "Minder dan €1.500"; 150000–250000 "€1.500 – €2.500"; 250000–350000 "€2.500 – €3.500"; 350000–500000 "€3.500 – €5.000"; 500000–750000 "Meer dan €5.000".
- Card list = catalogue entries with `kind === "creditcard"` whose `product` does not contain "Business" or "Corporate", sorted by product; plus `other` "Een andere kaart". Multi-select, at least one when the user said Ja.
- New profile facts are `stated` Fields with `at`; every new Field is added to `profileUpdatedAt` in `packages/core/src/advisor/vaultSections.ts`.
- No commit or push by workers; the controller leaves work staged.

## Review Focus

1. A user who picks a spend band, goes Back and types an exact amount (or the reverse) must end with exactly one spend range. → Task 4 test `band then exact amount replaces the range`.
2. Old profiles (blocksDone 3, no lastScreen) must not be sent back to the wizard for the new screens. → Task 2 test `finished old profile stays done`.
3. A profile that finished round 1 (lastScreen "invested") resumes on the upload screen only — never re-asks work or cards. → Task 2 test `round-1 finisher resumes at upload`.
4. A failed import on the upload screen must not finish the wizard and must show the error. → Task 6 test `failed import stays on upload`.
5. Saving cards "Nee" after "Ja" + picks clears the picks. → Task 5 test `Nee after picks clears statedCards`.

---

### Task 1: Core fields

**Files:** Modify `packages/core/src/advisor/profile.ts` (AdvisorProfile class + intake struct), `packages/core/src/advisor/vaultSections.ts` (`profileUpdatedAt`); Test `profile.test.ts`, `vaultSections.test.ts`.

**Interfaces — Produces:**
```ts
export const WorkKind = Schema.Literals(["employed","freelance","business","student","jobseeking","retired","other"]);
// AdvisorProfile gains:
work: Schema.optionalKey(Field(Schema.Array(WorkKind))),
statedCards: Schema.optionalKey(Field(Schema.Array(Schema.String))), // catalogue ids or "other"
// intake gains:
noCards: Schema.optionalKey(Schema.Boolean),
```
- [ ] Tests: `decodes a profile without work/statedCards`; `round-trips work and statedCards`; `profileUpdatedAt sees work and statedCards` (a later `at` on either wins).
- [ ] Run `cd packages/core && npx vitest run src/advisor` — FAIL, implement, PASS; `npx tsc -p . --noEmit` clean. `git add -N` new files only.

### Task 2: Screen model

**Files:** Modify `apps/web/src/intake/wizard/screens.ts`; Test `screens.test.ts`.

**Interfaces — Produces:** `ScreenId` gains `"work" | "has-cards" | "cards" | "upload"`. Canonical order: household, **work**, children, child-years, income, spend, housing, savings, **has-cards**, **cards**, goal, debts, debt-details, buffer, risk…, invested, **upload**. `sectionOf("work"|"has-cards"|"cards") = "about"`, `sectionOf("upload") = "risk"`. `cards` is present unless `p.intake.noCards === true`. New `export function answerCards(p: AdvisorProfile, has: boolean): AdvisorProfile` — false sets `noCards: true` and removes `statedCards`; true removes `noCards`. `markDone` milestones unchanged (blocksDone 3 still at "invested"). `resumeScreen` unchanged in rule; with no `lastScreen` and blocksDone 3 it stays `"done"`.
- [ ] Tests: `screensFor default has 21 screens` (17 + work, has-cards, cards, upload; assert via RISK_SCALE length); `Nee on cards drops the cards screen`; `finished old profile stays done`; `round-1 finisher resumes at upload` (lastScreen "invested" → "upload"); `markDone upload then resume is done`.
- [ ] Run `cd apps/web && npx vitest run src/intake/wizard/screens.test.ts` — FAIL → implement → PASS.

### Task 3: Copy

**Files:** Modify `apps/web/src/copy/wizard.ts`, `wizard.test.ts`.

**Interfaces — Produces:** in `WizardCopy`: `questions.work`, `questions.hasCards`, `questions.cards`, `questions.upload`; `workKinds: Record<WorkKind, string>` (labels from Global Constraints); `spendUnknown` "Weet ik niet"; `spendExact` "Toch een bedrag invullen"; `spendBands: [string, string, string, string, string]` (labels from Global Constraints, same in both household variants); `cardSearch` "Zoek je kaart"; `otherCard` "Een andere kaart"; `upload: { button, later, toPlan, imported: (n: number) => string, failed }`. NL questions: work "Wat voor werk doe je?"; hasCards alone "Heb je een creditcard?" / together "Hebben jullie een creditcard?"; cards "Welke creditcards heb je?" / "Welke creditcards hebben jullie?"; upload "Wil je je bankafschrift toevoegen?"; upload.button "Bankafschrift uploaden", later "Later", toPlan "Naar je plan", imported `${n} transacties toegevoegd`, failed "Dit bestand konden we niet lezen.". EN = plain translation.
- [ ] Extend the parity and advice-language tests to the new keys; FAIL → implement → PASS (`npx vitest run src/copy`).

### Task 4: Work screen, multi-select tiles, spend bands

**Files:** Create `apps/web/src/intake/wizard/MultiTiles.tsx`; Modify `apps/web/src/intake/wizard/screenViews.tsx`, `apps/web/src/views/IntakeWizard.tsx`, `apps/web/src/styles/wizard.css`; Test `apps/web/src/views/IntakeWizard.test.tsx`, `apps/web/src/intake/wizard/controls.test.tsx`.

**Interfaces — Produces:** `MultiTiles<T extends string>({ label, options, selected: readonly T[], onToggle: (v: T) => void })` — a group of `role="checkbox"` buttons with `aria-checked`, selected styled like ChoiceTiles' selected tile. Work screen: MultiTiles + "Verder" (disabled until ≥1), saves `work` Field via a new applier `applyWork(p, kinds, asOf)` in `intake/state.ts`. Spend screen: "Weet ik niet" link toggles to five band tiles (ChoiceTiles, tap saves `applyStatedRange(p,"spend",band,asOf)` + markDone and advances) with a "Toch een bedrag invullen" link back; pre-selects the band whose low/high equal the stored range; when the stored range is zero-width it opens in exact mode.
- [ ] Tests: `work requires one pick and saves all picks`; `spend band saves its range and advances`; `band then exact amount replaces the range` (and the reverse); `MultiTiles toggles aria-checked`.
- [ ] FAIL → implement → PASS (`npx vitest run src/views/IntakeWizard.test.tsx src/intake/wizard`); oxlint clean.

### Task 5: Cards screens and display

**Files:** Create `apps/web/src/intake/wizard/cardOptions.ts`; Modify `screenViews.tsx`, `IntakeWizard.tsx`, `intake/state.ts` (`applyStatedCards(p, ids, asOf)`), `apps/web/src/plan/sections/CardsSection.tsx`, `apps/web/src/intake/aboutYouRows.ts` (+ About you copy for the `work` and `statedCards` rows); Test `IntakeWizard.test.tsx`, `cardOptions.test.ts`, `plan/sections/sections.test.tsx`, `views/AboutYou.test.tsx`.

**Interfaces — Produces:** `cardOptions(): { id: string; label: string }[]` from `docs/catalog/catalog.json` per Global Constraints (import the JSON like `catalogue-rates.ts` does). has-cards: Ja → `answerCards(p,true)`; Nee → `answerCards(p,false)`. cards screen: search input filters the list case-insensitively on label; MultiTiles; "Verder" disabled until ≥1; saves `applyStatedCards`. CardsSection: when the plan has no held card accounts and `statedCards` is non-empty, it lists the stated card names (catalogue label, "Een andere kaart" for `other`) above its existing missing-data note. About you: rows for work and cards, removable like other stated rows, with NL/EN labels.
- [ ] Tests: `cardOptions excludes business and corporate cards`; `search narrows the list`; `cards saves the picked ids`; `Nee after picks clears statedCards`; `CardsSection lists stated cards when no card account`; `About you shows work and cards rows`.
- [ ] FAIL → implement → PASS (`npx vitest run src/views src/intake src/plan/sections`).

### Task 6: Upload screen and app wiring

**Files:** Modify `IntakeWizard.tsx` (new prop), `screenViews.tsx`, `apps/web/src/App.tsx` (pass the import), `wizard.css`; Test `IntakeWizard.test.tsx`.

**Interfaces — Consumes:** App's `handleImport(file: File)` (App.tsx ~1268) — make it resolve with the number of imported transactions and reject (or resolve with a failure) when the file cannot be read, without changing its existing callers' behaviour. **Produces:** `IntakeWizardProps.onImport: (file: File) => Promise<{ ok: true; count: number } | { ok: false }>`. Upload screen: a visually styled button wrapping a hidden `<input type="file">` (accept the same types Import.tsx accepts); on ok shows `imported(count)` and a "Naar je plan" button that does `markDone("upload")` then `onFinish`; on failure shows `failed` in `role="alert"` and stays; "Later" does `markDone("upload")` then `onFinish`.
- [ ] Tests: `Later finishes and marks upload done`; `successful import shows the count then finishes`; `failed import stays on upload`.
- [ ] FAIL → implement → PASS; then the full gate from the worktree root: `npx pnpm test`, `npx pnpm typecheck --force`, `npx pnpm lint`.

### Task 7: Browser proof

- [ ] `npx pnpm --filter @lavega/web build`; dev server on http://localhost:8787 serves `apps/web/dist`. Headless Playwright from the scratch dir (locale `nl-NL`, fresh context, wait ≥300ms before screenshots): walk the full wizard choosing two work kinds, "Weet ik niet" → a band, Ja on cards → search "amex" → pick one, …, upload the fixture CSV `.superpowers/sdd/2026-10-22-advisor-intake/evidence/task-6/fixture-ing.csv` → count shown → plan. Check the plan's cards section names the picked card and About you shows work + cards. Screenshots to `.superpowers/sdd/2026-10-26-intake-wizard-round2/evidence/`, results in `browser.md`.
