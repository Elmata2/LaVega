# Card advice - plan (27 Oct 2026)

Test-first throughout; each task: failing test, minimal code, green.

1. core `profile.ts`: `CardBalance` + `cardBalances` field; `vaultSections.profileUpdatedAt` sees it. Tests in profile.test.ts / vaultSections.test.ts.
2. core `spendHistory`: add `foreignCents` (converted non-EUR rows kept in the byCategory total). Test in spending.test.ts.
3. core `profileView.ts`: PlanProfile `statedCardIds`, `cardBalances`; `types.ts` HeldCardInput `catalogueId`.
4. core `plan/cardAdvice.ts` (pure): `programForCard`, `pointValue`, `cardOptions`, `interestAdvice`, `pointsAdvice`, `computeCardAdvice`. Tests: net maths, not-comparable reasons, recommendation thresholds, interest ladder, points.
5. core `cards.ts`: `computeCards(i, buffer)` fills `figures.advice`; calc ids; `compute.ts` passes buffer. Tests.
6. web state: `applyCardBalances`, rewards upsert helper; wizard screen id + `screensFor`; tests in screens.test.ts, state tests.
7. web `CardDetailsForm` (shared by wizard + plan), wizard wiring (`IntakeWizard` props `rewards`/`onSaveRewards`, `App.tsx`), copy NL+EN (`copy/wizard.ts`).
8. web `CardAdvice.tsx` plan block + copy `copy/cardAdvice.ts` + editor in `CardsSection`; `buildHeldCards` sets `catalogueId`.
9. Gate (test, typecheck --force, lint), build, browser walk on :8802, evidence, report.
