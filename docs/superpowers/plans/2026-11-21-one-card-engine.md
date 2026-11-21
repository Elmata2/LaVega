# One Card Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One calculation (`computeCardAdvice`) decides which credit card is better and by how much; Optimalisatie, "Kaarten en punten" and the Instinct card offer all show that one answer.

**Architecture:** `computeCards` already runs `computeCardAdvice` and returns it at `plan.sections.cards.figures.advice`. Tasks 1 to 4 fix the engine and its inputs. Tasks 5 to 7 make the other two surfaces read that advice. Task 8 proves the three surfaces agree.

**Tech Stack:** TypeScript, pnpm + turborepo, vitest, React (apps/web). Pure functions in `packages/core`; no I/O in the engine.

**Spec:** `docs/superpowers/specs/2026-11-21-one-card-engine-design.md`

## Global Constraints

- Unknown is never counted as zero without a label. A new zero must be measured (with source) or the typed assumed zero of `packages/core/src/assumedCashback.ts`.
- No verdict `switch` for a user whose own card the engine could not identify.
- Debit, prepaid and crypto rows in Optimalisatie keep their cashback ranking. Only the credit-card block changes.
- The "geen financieel advies" line stays. No eligibility or acceptance check per user.
- Copy goes in the existing copy files (`apps/web/src/copy/cardAdvice.ts` and the Optimalisatie copy), in `nl` and `en`.
- Pure engine code keeps its house style (plain functions, integer cents). Do not port existing code to Effect in this work.
- Format with `pnpm exec oxfmt <files>`, lint with `pnpm exec oxlint <dirs>`. Tests: `pnpm exec vitest run <file>` inside the package.
- `repos/` is vendored: never edit it.
- Owner rule: no commit and no push without the owner. Where a step says "Commit", the worker instead reports the commit message it proposes; the orchestrator stages the reviewed work (`git add -A`) so the next task's diff is the unstaged diff.

## Review Focus

1. A user with one identified card and one unidentified connected card: verdict must be `unknown-baseline`, not a switch against the identified card (Task 4).
2. Short history (1 to 2 months) with large stated spend and a stated foreign share of 0: no FX cost, no division by zero, result marked `stated` (Task 3).
3. A catalogue row with `cashbackPct` covered and value 0: counted as measured 0, card stays ranked (Task 1).
4. Card debt carried and verdict `switch`: no Instinct card offer; both screens show interest advice first (Tasks 5 and 6).
5. A stored `cardOffer` in an old browser mirror (name + yearlyGainCents + computedAt) must still parse on the server after Task 5; the shape does not change.

---

### Task 1: Three-state cashback in the engine (D4)

**Files:**

- Modify: `packages/core/src/plan/cardAdvice.ts` (`NotComparableReason`, `CardOption`, `optionFor`)
- Test: `packages/core/src/plan/cardAdvice.test.ts`

**Interfaces:**

- Produces: `NotComparableReason` gains `"cashback-unknown"`. `CardOption` gains `cashbackTier: "measured" | "assumed" | "unknown"`. `cashbackPct`/`cashbackCents` are `0` for `assumed`, the covered value for `measured`, `null` for `unknown`.

- [ ] **Step 1: Write failing tests** in `cardAdvice.test.ts`:
  - `cashback: a covered 0 is measured and the card stays ranked` (catalogue row with covered `cashbackPct` 0 → `cashbackTier === "measured"`, `comparable === true`).
  - `cashback: an ordinary Dutch issuer with no figure gets the assumed zero` (row for an issuer on `ORDINARY_NL_ISSUERS`, no `cashbackPct` → `cashbackTier === "assumed"`, `cashbackCents === 0`, `comparable === true`).
  - `cashback: any other card with no figure is not ranked` (issuer not on the list → `reasons` contains `"cashback-unknown"`, `netCents === null`, the card is in `notComparable`).
- [ ] **Step 2: Run** `pnpm exec vitest run src/plan/cardAdvice.test.ts` in `packages/core`. Expected: the three new tests fail.
- [ ] **Step 3: Implement.** In `optionFor`, when `coveredNumber(e, "cashbackPct")` is null, ask `mayAssumeNoCashback` (`assumedCashback.ts:208`) with the row's issuer and kind; allowed → tier `assumed` with 0; not allowed → push `"cashback-unknown"`. Remove the `?? 0` on `cashbackCents` in the net.
- [ ] **Step 4: Run** the whole file. Expected: pass. Existing tests that relied on a silent 0 are updated to state the tier they mean; list each such change in the commit message.
- [ ] **Step 5: Report, do not decide:** run the engine over `docs/catalog/catalog.json` (a scratch script outside the repo) with annual spend 2 400 000 cents and print which consumer credit cards are now `cashback-unknown`. Put the list in the commit message body. If American Express consumer rows are on it, stop after the commit and report to the orchestrator.
- [ ] **Step 6: Commit** `feat(core): cashback has three states in the card advice`.

### Task 2: The verdict says what the gain is made of (D2)

**Files:**

- Modify: `packages/core/src/plan/cardAdvice.ts` (`Verdict`, `computeCardAdvice`)
- Modify: `apps/web/src/plan/sections/CardAdvice.tsx`, `apps/web/src/copy/cardAdvice.ts`
- Test: `packages/core/src/plan/cardAdvice.test.ts`, `apps/web/src/plan/sections/CardAdvice.test.tsx`

**Interfaces:**

- Produces:
  ```ts
  export type GainParts = {
    pointsCents: number; // best.pointsValueCents - baseline's, 0 for no-card baseline
    cashbackCents: number;
    feeCents: number; // positive = the best card's fee is lower
    fxCents: number; // positive = the best card's FX cost is lower
    pointsBasis: "own-examples" | "reference" | null; // null when pointsCents === 0
    centsPerPoint: number | null;
  };
  // Verdict "switch" becomes { kind: "switch"; best: CardOption; gainCents: number; parts: GainParts }
  ```
  Invariant: `parts.pointsCents + parts.cashbackCents + parts.feeCents + parts.fxCents === gainCents`.
- [ ] **Step 1: Failing tests.** Core: `switch: the parts add up to the gain` and `switch from a no-card baseline: parts equal the best card's own figures`; `switch on Amex points alone: pointsBasis is "reference" and centsPerPoint is 0.3`. Web: the section renders one line with the points part and the value per point when `pointsCents > 0`, and the acceptance sentence when `best.cardId` starts with `american-express-` or `flying-blue-american-express-`.
- [ ] **Step 2: Run** both files. Expected: fail.
- [ ] **Step 3: Implement** `parts` in `computeCardAdvice` (the baseline option is `heldOptions[0]`), and the two lines in `CardAdvice.tsx`. Copy keys in `cards.ts`: `gainOfWhichPoints` ("waarvan {amount} aan punten, gerekend tegen {cents} cent per punt" / "of which {amount} in points, at {cents} cent per point"), `amexAcceptance` (reuse the existing acceptance wording from the non-goal sentence in the section if present; else "American Express wordt niet overal geaccepteerd." / "American Express is not accepted everywhere.").
- [ ] **Step 4: Run** both files. Expected: pass.
- [ ] **Step 5: Commit** `feat: the card verdict states what the gain is made of`.

### Task 3: Stated spend when history is short (D7)

**Files:**

- Modify: `packages/core/src/plan/cardAdvice.ts` (`CardAdviceInput`, `CardAdvice`, `computeCardAdvice`)
- Modify: `packages/core/src/plan/cards.ts` (`computeCards`: pass the stated spend)
- Modify: `apps/web/src/plan/sections/CardAdvice.tsx`, `apps/web/src/copy/cardAdvice.ts`
- Test: `packages/core/src/plan/cardAdvice.test.ts`, `packages/core/src/plan/cards.test.ts`

**Interfaces:**

- Produces: `CardAdviceInput.statedSpend?: { annualCents: number; foreignShare: number } | null` (share 0 to 1). `CardAdvice.basis: "history" | "stated"`.
- Rule: `spend.months < CARD_ADVICE_MIN_MONTHS` and `statedSpend` with `annualCents > 0` → `annualCents = statedSpend.annualCents`, `annualForeignCents = round(annualCents * foreignShare)`, `state = "ok"`, `basis = "stated"`. Otherwise today's behaviour, `basis = "history"`.
- `computeCards` passes `statedMonthlyCents * 12` and `foreignShareOf(profile.foreignSpend, profile.spendMix)` (both exist in `cards.ts`), or null when `statedMonthlyCents` is null.
- [ ] **Step 1: Failing tests.** Core: `short history with stated spend gives a verdict marked stated`; `short history with no stated spend stays short-history`; `three full months ignore the stated spend`; `stated spend with foreign share 0 has fxCostCents 0 on every option` (Review Focus 2). In `cards.test.ts`: `computeCards passes the wizard spend to the advice` (profile with `spendStatedRange`, one month of data → `figures.advice.basis === "stated"`).
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.** Section shows copy key `basisStated` ("Op basis van je antwoorden, niet van je transacties." / "Based on your answers, not on your transactions.") when `basis === "stated"`.
- [ ] **Step 4: Run** both core files and `CardAdvice.test.tsx`. Expected: pass.
- [ ] **Step 5: Commit** `feat: card advice uses the wizard spend when history is short`.

### Task 4: A connected card is identified, or the user is asked (D1)

**Files:**

- Modify: `apps/web/src/plan/heldCards.ts` (`buildHeldCards`, shared with `heldCatalogueIds`)
- Modify: `packages/core/src/plan/cards.ts` (`computeCards`: `hasOtherCard`)
- Modify: `apps/web/src/plan/sections/CardAdvice.tsx` (prompt), `apps/web/src/copy/cardAdvice.ts`
- Modify: the place that stores an account edit (find the writer used by `CardFileDialog.tsx` for `statedCardId`; reuse it)
- Test: `apps/web/src/plan/heldCards.test.ts`, `packages/core/src/plan/cards.test.ts`, `apps/web/src/plan/sections/CardAdvice.test.tsx`

**Interfaces:**

- Produces: one resolver in `heldCards.ts`, used by both `buildHeldCards` and `heldCatalogueIds`:
  `catalogueIdOf(account: Account, entries: readonly CatalogueEntryLike[], feeProductId: string | null): string | null` — `account.statedCardId` first (when it names a catalogue row), else `entryFor(...)?.id`, else null.
- `computeCards`: `hasOtherCard` is true when `statedCardIds` includes `"other"` OR any held credit-card account has `catalogueId === null`.
- UI: when `advice.baseline.kind === "unknown"` and a blocker has reason `not-in-catalogue` for a connected account, the section shows "Welke kaart is dit?" with the existing catalogue card picker; the choice is saved as `statedCardId` on that account.
- [ ] **Step 1: Failing tests.** `heldCards.test.ts`: `a file-fed account with statedCardId gets that catalogue id`; `statedCardId wins over a name match`; `a card account with no match has catalogueId null`. `cards.test.ts`: `an unidentified connected card makes the baseline unknown, not no-card`; `one identified and one unidentified card: verdict is unknown-baseline` (Review Focus 1). Web: the prompt renders and saving calls the account writer with `statedCardId`.
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files plus `apps/web/src/plan/optimalisatieStated.test.ts`. Expected: pass.
- [ ] **Step 5: Commit** `fix: a connected card the app cannot identify is asked for, not ignored`.

### Task 5: The Instinct card offer comes from the verdict (goal 3, D6)

**Files:**

- Modify: `packages/core/src/instinct/cardOffer.ts`
- Test: `packages/core/src/instinct/cardOffer.test.ts`, `packages/core/src/chat/tools.test.ts` (the `plan_summary` case)

**Interfaces:**

- Consumes: `plan.sections.cards.figures.advice` (`CardAdvice`), `Verdict` with `parts` (Task 2).
- Produces: `cardOfferOf(plan: PlanResult | null, today: string): AgentMirror["cardOffer"]` — same signature and same return shape (`{ name, yearlyGainCents, computedAt } | null`). Returns an offer only when `advice.verdict.kind === "switch"` and `advice.ignoresInterest === false`; `name = verdict.best.name` (clipped to 200), `yearlyGainCents = min(verdict.gainCents, MAX_YEARLY_GAIN_CENTS)`.
- [ ] **Step 1: Failing tests.** `offer is the verdict's best card and gain`; `no offer when the verdict is keep, unknown-baseline, no-card-worth-it or no-options`; `no offer while card debt is carried` (Review Focus 4); `the offer shape is unchanged` (keys exactly `name`, `yearlyGainCents`, `computedAt`; Review Focus 5). Replace the legacy-nets tests.
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.** The legacy `nets` are no longer read here.
- [ ] **Step 4: Run** `src/instinct` and `src/chat`. Expected: pass.
- [ ] **Step 5: Commit** `feat(core): the Instinct card offer is the plan's card verdict`.

### Task 6: Optimalisatie shows the plan's verdict (goal 2, D5, D6)

**Files:**

- Modify: `apps/web/src/views/Optimalisatie.tsx` (credit-card block near lines 1000 to 1140), `apps/web/src/plan/optimalisatieStated.ts`
- Modify: Optimalisatie copy file (find via the keys used in that block)
- Test: `apps/web/src/optimalisatie-cashback.test.tsx`, `apps/web/src/plan/optimalisatieStated.test.ts`, a new `apps/web/src/optimalisatie-card-verdict.test.tsx`

**Interfaces:**

- Consumes: the `usePlan` hook (`apps/web/src/plan/usePlan.ts:150`), `plan.sections.cards.figures.advice`, `carriesCardDebt` (`cardAdvice.ts`), the verdict lines rendered by `CardAdvice.tsx` (export the small verdict component from Task 2 so both screens use it).
- Rule for the credit-card block: render from `advice` only. `switch` → card name, `gainCents`, the Task 2 lines. `keep` / `no-card-worth-it` → the existing "nothing better" state. `unknown-baseline` → the reasons and, for `not-in-catalogue`, the Task 4 prompt. Card debt (`advice.ignoresInterest`) → the interest advice first, then the verdict with the existing "interest is not in the figures" note. The direct `noCardAdvice` call, `fxHistory: {}`, and the credit-card use of `cashbackSwitchGain` / `marketCashbackOptions` / `cardDebtStated` are removed. Debit, prepaid and crypto rows are untouched.
- [ ] **Step 1: Failing tests** in the new file: `credit-card block shows the same card and euro figure as the plan advice` (render both from one fixture, compare text); `first card: foreign spend is counted` (fixture with non-EUR card spend → the figure equals the plan's); `card debt: the pay-off advice is above the verdict and offers are not hidden`; `debit and crypto cashback rows still render` (guard for the constraint).
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all `apps/web/src/optimalisatie-*.test.tsx` and `apps/web/src/plan/`. Expected: pass; tests that asserted the old credit-card cashback offer are rewritten to the verdict, each named in the commit message.
- [ ] **Step 5: Commit** `feat(web): Optimalisatie shows the plan's card verdict`.

### Task 7: ING credit cards carry "no points per euro" (D3)

**Files:**

- Modify: `docs/catalog/catalog.json` (rows `ing-creditcard`, `ing-creditcard-more`, `ing-creditcard-extra`, `ing-creditcard-max`, `ing-platinumcard`)
- Test: `packages/core/src/catalogArtifact.test.ts`, `packages/core/src/plan/cardAdvice.test.ts`

- [ ] **Step 1: Failing test** `an ING creditcard holder gets a verdict from the committed catalogue` (load the real `catalog.json`, `heldIds: ["ing-creditcard"]`, annual 2 400 000 → `verdict.kind` is not `unknown-baseline`).
- [ ] **Step 2: Run.** Expected: fail with `unknown-baseline`.
- [ ] **Step 3: Edit the five rows:** add `fields.pointsPerEuro = { value: 0, route: "provider-pdf", sourceUrl: <the ING Punten source in docs/catalog/staging-points.json>, checkedAt: <that file's date for ING Punten>, conditions: "ING Punten kent geen koers per bestede euro: een vast aantal punten per maand boven een drempel, plus eenmalige bedragen. Daarom 0 punten per euro.", conditionsKnown: true }`. Confirm the fifth id by reading the file; if `ing-platinumcard` is not the id, use the id found.
- [ ] **Step 4: Run** both files. Expected: pass. `ing-creditcard-more` and `-extra` stay unranked (`fee-condition-unknown`); add a test that pins that so nobody "fixes" it by accident.
- [ ] **Step 5: Commit** `data(catalog): ING credit cards earn no points per euro`.

### Task 8: The three surfaces agree, docs, full verification (goal 5)

**Files:**

- Create: `packages/core/src/plan/__fixtures__/cardVerdictCases.json`, `packages/core/src/plan/cardVerdictAgreement.test.ts`, `apps/web/src/cardVerdictAgreement.test.tsx`
- Modify: `docs/superpowers/specs/2026-10-27-card-advice-design.md` (one line at the top: superseded in part by the 21 Nov design), `CONTEXT.md` if it names the three calculations

**Interfaces:**

- Fixture shape: `{ name, plan input (accounts, transactions, profile, catalogue rows), expect: { verdictKind, bestCardId | null, gainCents | null, heldIds, offer: { name, yearlyGainCents } | null } }`. Cases: ICS holder; ING holder; Amex holder; unidentified connected card; file-fed card with `statedCardId`; card debt; short history with wizard answers; no card with foreign spend.
- [ ] **Step 1: Write** the fixtures and the core test: for each case, `computePlan` once; assert the advice against `expect`; assert `cardOfferOf` against `expect.offer`.
- [ ] **Step 2: Write** the web test: for each case render "Kaarten en punten" and Optimalisatie from the same plan and assert both show `expect`'s card name and euro figure (or both show no offer).
- [ ] **Step 3: Run** the two new files. Expected: pass. A failure here is a real disagreement: fix the surface, not the fixture.
- [ ] **Step 4: Full run** from the repo root: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`. Expected: all pass. Save the last lines of each output for the report.
- [ ] **Step 5: Commit** `test: Optimalisatie, the plan and the Instinct offer give one card verdict`.

## Order and dependencies

1 → 2 → 3 → 4 in order (same engine file). 5 needs 2. 6 needs 2 and 4. 7 is independent. 8 last.
