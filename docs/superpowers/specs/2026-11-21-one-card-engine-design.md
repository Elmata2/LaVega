# One card engine - design (21 Nov 2026)

Issue #356. Owner words, 21 Nov 2026: "you can work on fixing the engines, the goal is to have an engine
that improves itself (weekly?) with the latest and best rates, costs info per card, this will really become
our proprietary data". This document covers project 1 (the engine). Project 2 (the weekly data refresh) gets
its own design after this one ships.

## Intent

A user gets one answer to "is another credit card better for me, and by how much", and the same answer on
every screen and in the daily message. Today three calculations answer it and they can disagree.

## Current state (code study on `master` e49e386a)

| Surface                                | Calculation                                                                                                             | Counts                                      | Does not count                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- |
| Jouw plan, "Kaarten en punten"         | `computeCardAdvice` (`packages/core/src/plan/cardAdvice.ts`)                                                            | points value, fee, FX fee, covered cashback | card interest, cash-withdrawal fee |
| Optimalisatie                          | `marketCashbackOptions` + `cashbackSwitchGain` (`packages/core/src/catalogRates.ts`), `noCardAdvice` for the first card | cashback only                               | points, FX fee                     |
| Daily Instinct message, assistant chat | `cardOfferOf` (`packages/core/src/instinct/cardOffer.ts`) over the legacy per-held-card `nets` of `computeCards`        | cashback minus fee, held cards only         | points, catalogue cards            |

`computeCards` (`packages/core/src/plan/cards.ts:583`) already calls `computeCardAdvice` and returns its
result inside the plan. So the plan result already carries the answer the other two surfaces need.

Facts about the data: 0 of 43 catalogue credit cards have a covered `cashbackPct`. Ordinary Dutch cards get
an assumed zero (`assumedCashback.ts`). So for credit cards, the Optimalisatie cashback ranking can never
make an offer, and the legacy `nets` are null for every card whose cashback is unknown (Amex).

## Goals

1. `computeCardAdvice` is the only place that decides which credit card is better and by how much.
2. Optimalisatie's credit-card block shows that verdict and figure (switch, keep, first card, or "cannot
   compare, because ..."). It no longer computes its own.
3. The Instinct card offer (`cardOfferOf`, used by the browser mirror and the chat tool `plan_summary`)
   is derived from the same verdict: an offer exists only when the verdict is `switch`; name and yearly gain
   are the verdict's.
4. The defects below are fixed in the engine or its inputs.
5. One shared fixture set proves the three surfaces give the same held cards, the same verdict and the same
   euro figure.

## Non-goals

- The weekly data refresh, new catalogue fields (card interest rate, cash-withdrawal fee) and the Amex
  data refresh: project 2.
- Debit cards, prepaid and crypto cards in Optimalisatie keep their cashback ranking. Only the credit-card
  block changes.
- No eligibility or acceptance check per user. No UI redesign. The "geen financieel advies" line stays.
- The per-held-card lines in "Kaarten en punten" stay as a display of the user's own cards.

## Anti-goals

- A euro figure with a missing half. Unknown stays unknown and is named; it is never counted as zero
  without a label.
- A "switch" verdict for a user whose own card the engine could not identify.

## Defects and their fixes

D1. A connected card that the app cannot match to a catalogue row is treated as "no card".
`buildHeldCards` (`apps/web/src/plan/heldCards.ts:174`) leaves `catalogueId` null; it also ignores
`account.statedCardId`, which `heldCatalogueIds` (`:71`) does use. Fix: `buildHeldCards` takes
`statedCardId` first, then the name match. A card account with no catalogue id sets `hasOtherCard`, so the
baseline is `unknown` with reason `not-in-catalogue` and the screen asks "which card is this?" (the existing
card picker; the choice is stored as `statedCardId` on the account).

D2. A switch verdict can rest only on Amex points at the reference value (0,3 cent per point).
Fix: the verdict carries `basis`: which part of the gain is points, fee, FX, cashback, and whether the point
value is the user's own or the reference. The screen and the Instinct text state it ("waarvan € X aan punten,
gerekend tegen 0,3 cent per punt"). When the best card is an American Express card, the existing
non-goal sentence about acceptance is shown next to the verdict. The figure itself does not change.

D3. A holder of an ING credit card gets no verdict, because `pointsPerEuro` is not covered.
ING Punten has no per-euro rate (`docs/catalog/staging-points.json`: fixed points per month). Fix in the
data, with the source: the four ING credit-card rows (Platinumcard is left unknown, see "Calls made after the builder check") get `pointsPerEuro` value 0 with `conditions` that say
so and `conditionsKnown: true`. The engine does not change for this.

D4. Missing cashback is added as 0 with no label (`optionFor` in `cardAdvice.ts`: a null `cashbackPct`
adds no reason and the net uses `cashbackCents ?? 0`). Fix: a new reason `cashback-unknown` in
`NotComparableReason`, and the option uses the
three-state cashback of `assumedCashback.ts`: measured (counted, with source), assumed zero (counted as 0,
labelled "aangenomen"), unknown (reason `cashback-unknown`, card not ranked). American Express consumer
rows get a measured 0 in the data if a source says so; otherwise they stay unknown and unranked, and that
is reported to the owner before merge.

D5. The first-card figure in Optimalisatie drops foreign spend (`Optimalisatie.tsx:1130` passes an empty
`fxHistory`). Fixed by goal 2: the block reads the plan's advice, which uses the real `fxHistory`.

D6. Card debt: Optimalisatie hides every offer; the plan shows them with a note. One rule: when the user
carries card debt, the interest advice comes first ("eerst aflossen"), and the comparison is shown below it
with the existing note that card interest is not in the figures. Same on both screens. The Instinct card
offer is not sent while debt is carried.

D7. Less than 3 months of history gives no advice, although the wizard asked for monthly spend, foreign
share and points goal. Fix: when `months < CARD_ADVICE_MIN_MONTHS` and the wizard answers exist, the engine
uses the stated yearly spend and stated foreign share (the "stated basis" that `cards.ts:428` already
builds) and the result is marked `basis: "stated"`; the screen says "op basis van je antwoorden".

Not a defect, kept as is: a card whose points have no value per point is counted with 0 points when the user
does not hold it (a lower bound, so it cannot wrongly win) and blocks the verdict when the user holds it
(a lower bound for the baseline would make a switch a guess).

## Calls made after the builder check (mine, not the owner's)

- Plan source for Optimalisatie: the `usePlan` hook that Jouw plan uses (`apps/web/src/plan/usePlan.ts`).
  One plan result for both screens; Optimalisatie's direct `noCardAdvice` call is removed.
- D1: a `statedCardId` on the account wins over a name match (it is the user's own choice). `computeCards`
  sets `hasOtherCard` when a held card account has no catalogue id. If the card picker does not yet write
  `statedCardId` for a bank-connected account, the builder adds that.
- D6: one predicate, `carriesCardDebt` (`cardAdvice.ts`), on both screens; Optimalisatie's
  `cardDebtStated` use for this purpose is removed.
- D7: the stated spend is a new optional input of `computeCardAdvice`. It is used whenever history is under
  3 months, also when that short history is not empty.
- D3: ING Creditcard More and Extra stay unranked after the points fix, because their package price is
  unknown (`FEE_CONDITIONS`: `package-price-unknown`). They are named as "niet te vergelijken" with that
  reason. Filling the package price is data work (project 2). The catalogue edit is made directly in
  `docs/catalog/catalog.json` with source and date; the weekly sweep keeps fields it does not measure.
- Fixtures: `cardCases.json` has per-net cases and is shared with `apps/extension/src/rankAgreement.test.ts`.
  It is left alone. The whole-verdict cases go in a new fixture file next to it.
- Instinct offer (build, 21 Nov): `cardOfferOf` also needs `advice.basis === "history"`. A verdict built from
  wizard answers alone never starts an unprompted daily message.
- ING Platinumcard (build): points stay unknown. The ING earn table does not name that card, so no
  points-per-euro figure is written for it and it stays unranked.
- American Express consumer cards (build): the 8 consumer rows carry a measured 0% cashback, by owner decision
  of 21 Nov 2026, so they are ranked. Business and corporate rows are untouched.
- Optimalisatie (build): it reads the plan with `usePlan({ readOnly: true })`. A visit never writes a snapshot,
  a preference or an event; only "Jouw plan" stores.
- Optimalisatie cashback ranking (build): it covers debit, prepaid and crypto only, held credit-card accounts
  included. Credit cards are judged by the plan's verdict alone.
- Instinct offer, first card (f): no unprompted Instinct card offer for a first card. `cardOfferOf` needs a
  `best-held` baseline, because the message compares with the user's current card. A user with no credit card
  still sees the first-card verdict on both screens.
- Card identification and bank sync (g): a connected card's `statedCardId` survives a bank sync
  (`mergeImportedAccounts` carries it through unless the import has its own).
- Wrongly matched card (h): a credit-card account matched to a non-credit catalogue row (betaalpas, prepaid)
  is asked for ("Welke kaart is dit?"), not treated as no card. A debit-card account matched to such a row
  stays out of the credit-card comparison.
- Verification fixtures (build): whole-verdict cases live in
  `packages/core/src/plan/__fixtures__/cardVerdictCases.ts` (TypeScript, not JSON, because the inputs need
  date and transaction builders), run by `cardVerdictAgreement.test.ts`; the screens are checked by
  `apps/web/src/cardVerdictAgreement.test.tsx`, which mounts the real routes.

## Approaches

A. One engine, the others read it (chosen). `computeCardAdvice` decides; Optimalisatie and `cardOfferOf`
read `plan.sections.cards.figures.advice`. Smallest change, because the plan result already carries the advice;
contradictions become impossible by construction.

B. Keep three calculations, fix each, add a test that they agree. Rejected: three formulas to keep equal by
hand; the cashback ranking cannot rank credit cards at all with today's data.

C. A new engine from scratch. Rejected: `computeCardAdvice` already has the traceable figures, the reasons
and the tests; a rewrite adds risk and no capability.

## What is left to the builder

- The exact shape of `basis` on the verdict and of `basis: "stated"` on the advice.
- How Optimalisatie renders the verdict inside its existing card block (reuse the plan's `CardAdvice`
  section components where they fit).
- Removal of `cashbackSwitchGain` / `marketCashbackOptions` call sites for credit cards only; they stay for
  debit, prepaid and crypto rows.
- Copy in `nl` and `en` for the new labels, in the existing copy files.

## Verification

- Core: fixture cases (`packages/core/src/plan/__fixtures__/cardCases.json`) extended with: ICS holder,
  ING holder, Amex holder, unmatched connected card, file-fed card with `statedCardId`, card debt, short
  history with wizard answers, no card with foreign spend. Each case asserts the verdict once, and a test per
  surface asserts that the surface shows that same verdict and figure.
- `verify-lavega` on a local build for Optimalisatie and Jouw plan.
- Owner walk on production with real data closes #356 for the engine part.
