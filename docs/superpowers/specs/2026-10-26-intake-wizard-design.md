# Intake wizard: one question per screen (WHOOP-style)

Date: 2026-10-26 · Branch: `feat/advisor-intake` (on top of the staged intake + Jouw plan work)

## Intent

The intake that exists today (Step 0 + Blocks 1-3 in `apps/web/src/intake/`, opened by `views/Intake.tsx`) is a long page of cards with explanations, inferred-data proposals and forms. The owner wants the first thing a new user meets to be **very simple**: a WHOOP-style onboarding wizard that shows nothing but the question being asked, one per screen. "Simple is better; we can always add things later."

Success: a new user taps through about 15 short screens in a couple of minutes and lands on Jouw plan with a profile the plan can compute from.

## Goals

- One question per screen, nothing else on it: no explanations, no inferred data, no running totals.
- The look chosen in the mockups (direction C, see Visual below).
- Every answer is saved as soon as it is given, like today, so leaving mid-way and coming back resumes at the next unanswered screen.
- Answers land in the existing `AdvisorProfile` through the existing pure appliers in `intake/state.ts`; the plan engine is not changed (the small profile bookkeeping addition is described under "Settled after the builder check").

## Non-goals

- No bank connection, statement upload, or "what we found in your data" confirmation inside the wizard. Bank linking stays available in the app afterwards.
- No AI, no explanation text, no "room" payoff screen in the wizard.
- The rest of the app (Overzicht, Jouw plan, About you, investing) keeps its current light look. Only the wizard gets the new style.
- No new questions beyond the list below.

## Anti-goals (would count as failure even if it works)

- A screen that shows more than the question, its answer control, progress, back, and one button.
- Anything that reads as advice (the info-not-advice line from the pivot still holds).
- Breaking the plan: after the wizard, Jouw plan must render with the answers given, with no new error states.

## The questions (owner-approved list)

One screen each, in this order. Section label above the question in small caps.

**Over jou**
1. Woon je alleen of samen? (Alleen / Samen) → `applyHousehold`
2. Heb je kinderen? (Ja / Nee). If Ja: one screen with a birth-year field per child and an "add child" control → `applyChildren`
3. Hoeveel houd je netto over per maand? (one amount) → `applyStatedRange` income
4. Hoeveel geef je ongeveer uit per maand? (one amount) → `applyStatedRange` spend
5. Huur of koop je, en wat kost het per maand? (Huur / Hypotheek / Anders + one amount) → `applyStatedHousing`
6. Hoeveel spaargeld heb je ongeveer? (one amount) → `applyStatedSavings`

**Doelen**

7. Waar spaar je voor? One goal: purpose, target amount, target date. More goals are added later in the app → `applyGoals`
8. Heb je schulden die we niet zien? (Ja / Nee). If Ja: monthly repayment (and lender name) → `addUserDebt`
9. Hoeveel maanden buffer wil je achter de hand? (choice) → `applyBuffer`

**Risico**

10-14. The five existing risk items (`loss-20`, `gain-vs-loss`, `sleep`, the "friend sells" item, the horizon item), copy unchanged. A tap on an option saves it and advances; no "Verder" button on these screens → `applyRiskAnswers`
15. Heb je al eens belegd? (existing experience item) → `applyKnowledge` for that item only

The question wording above is the owner's intent; the existing NL/EN copy in `copy/intake.ts` may be reused or shortened, and every string goes through the copy modules (NL + EN, typed-complete, per the i18n boundary).

## Decisions made in the conversation

- **Single amount, not a range.** Today the stated path asks "between X and Y". The wizard asks one amount with the hint "Een schatting is goed" and stores it as a range with low = high, so core sees the same shape.
- **Dropped from the wizard:** Step 0 (bank/upload choice), language and country (taken from the device locale and the existing defaults), first/last name, the knowledge quiz items other than "have you invested", the worries question, the payoff/room screen. They stay reachable where they already are in the app (settings, About you) or are simply unanswered.
- **End:** after the last screen the user lands on Jouw plan.

## Visual (direction C, chosen 2026-10-26)

- White background (`#ffffff`), not cream. Everything on one centred vertical axis; a narrow column (about 360-420px) centred on desktop, full width on a phone. No app nav bar while the wizard is open.
- Top: a thin (3px) segmented progress bar, filled segments in a blue → violet gradient (`#4263eb` → `#7048e8`), empty `#eceef2`. Under it, left a back arrow, right a "2 / 15" counter in muted grey (`#9aa0aa`).
- Middle, vertically centred: section label (small caps, violet `#7048e8`, letter-spaced), the question (about 22-26px on desktop, semibold, near-black `#14161a`), then the answer control.
- Answer tiles: compact, 1px border `#e4e7ec`, 10px radius, small text. The selected tile gets the violet border and a light violet fill (`#f3f0ff`, text `#5f3dc4`). Amount fields: one large number with an underline that turns violet on focus.
- Bottom: a small black pill button "Verder" (`#14161a`, white text), not full width.
- Sans-serif (Inter or the app's existing sans). Motion is restrained (fintech register): at most a short fade/slide between screens, respecting reduced motion.

Mockups: `.superpowers/brainstorm/50774-1793042623/content/whoop-light-v2.html`, card C (local, git-ignored).

## Constraints

- Saving goes through the existing `useProfileCommit` / `onSave` path; a failed save must not advance the screen and must say so (as the current blocks do).
- `intake.blocksDone` and `resumeStage` drive the Overzicht invite card, the "Redo these questions" action in About you, the plan's nav gate (`intakeBlocksDone >= 1` in `App.tsx`) and the risk-due surfacing. The wizard must keep those working: the builder decides whether to keep `blocksDone` as section milestones (Over jou = 1, Doelen = 2, Risico = 3) or replace it, and updates every caller.
- A fresh vault currently opens the intake on Step 0 (`App.tsx` ~line 461); it should open the wizard on question 1 instead. The bank-return path (`App.tsx` ~line 872) loses its purpose inside the intake.
- Accessible: real buttons and inputs, labelled, keyboard operable (Enter advances), visible focus, `aria-pressed`/radio semantics on choices.
- No commit or push; leave the work staged (owner rule).

## Settled after the builder check (designer's calls, owner to check)

- **Data model change allowed, kept small.** Core may gain wizard bookkeeping on `AdvisorProfile.intake`: the last completed screen id and explicit "answered No" markers for children and debts (an empty `children` array is written on "Nee"). Resume opens at the screen after the last completed one. The plan engine itself stays unchanged. `step0` is written as `"none"` on the first answer so every existing `step0 === null` reader keeps meaning "not started"; the bank-return branch in `App.tsx` is removed. `blocksDone` becomes section milestones (Over jou = 1, Doelen = 2, Risico = 3), so the plan nav gate, invite card and "Redo these questions" keep working; "Redo" reopens the wizard at screen 10.
- **Old-intake profiles** resume from `blocksDone` as today: 0 → screen 1, 1 → 7, 2 → 10, 3 → done.
- **Goal (screen 7):** free-text purpose, target amount, target date (must be in the future). Defaults written: `kind: "general"`, `priority: "important"`, `accountRefs: []`, nothing optional. A "Nog geen doel" link skips the screen; it is the only skip in the wizard.
- **Debt (screen 8, Ja):** lender name + monthly repayment; balance and rate are left for About you.
- **Single-choice screens auto-advance on tap** (1, 2, 8, 9, 10-15). Screens with an amount or more than one field (3-7, the Ja branches) use "Verder", disabled until valid; Enter submits.
- **Amounts:** whole euros, zero allowed for spend, housing and savings, not for income; blank is not valid. Spend above income is allowed (it is what the plan exists to show). Stored as a zero-width range (low = high).
- **Housing "Anders"** means owned outright or living for free; zero is allowed.
- **Back** reopens the earlier screen prefilled from the profile. Changing Kinderen from Ja to Nee removes the children; a goal is never auto-deleted.
- **Counter** is dynamic: the Ja branches (birth years, debt details) add a screen and the total in "n / N" follows.
- **Experience:** only `investedBefore` is asked; `experience` stays null (no plan consumer reads it today). The risk section has no skip, so the risk score is always available.
- **After the wizard the plan runs on stated figures only** (no transactions yet); its existing missing-data states are acceptable, and the builder only fixes a state that errors or reads wrong with stated-only input.
- **Question 3 copy** asks net income, not "left over": "Wat verdien je netto per maand?".

## Owner decision after the builder check

- **"Samen" means household figures.** When the user answers Samen, screens 3-6 ask for the whole household ("Wat verdienen jullie samen netto per maand?", "Hoeveel geven jullie uit…", etc.) and the wizard writes `partnerIncomeInScope: true`; with Alleen they ask for the user alone and write `false`. Changing the household answer via Back re-words those screens; already-entered amounts are kept and shown for the user to re-check.

## Left to the builder

- Whether the old Block/Step components are deleted or kept for About you editing (prefer deleting what nothing uses).
- How the wizard reuses or replaces `views/Intake.tsx`.
- Exact spacing, type scale and transition, inside the visual above.
- How an existing profile (answers already given through the old intake) maps to a resume position.

## Round 2 additions (2026-10-26, owner request; owner skipped the questions, so the calls below are the designer's)

Owner asked for: bands / "weet ik niet" when a user does not know their spending; bank-data upload back in the flow; a place to say which cards they hold; a question about what kind of work they do.

- **Werk (new screen 2, after household, section Over jou):** "Wat voor werk doe je?" Multi-select (people combine, e.g. loondienst + freelance): Loondienst, Freelance / zzp, Eigen bedrijf, Student, Werkzoekend, Met pensioen, Anders. Asked for the user only, also when Samen. Stored as `work` (stated Field with an array of those kinds). Shown and editable in About you. The plan does not use it yet.
- **Uitgaven onbekend:** the spend screen gets a small "Weet ik niet" link. It swaps the amount field for five band tiles (single tap saves and advances): Minder dan €1.500 (€750–€1.500), €1.500 – €2.500, €2.500 – €3.500, €3.500 – €5.000, Meer dan €5.000 (€5.000–€7.500). Stored as the spend range low/high (no longer zero-width). Household wording follows Samen/Alleen. Other amount screens stay single-amount.
- **Kaarten (two screens after savings, section Over jou):** "Heb je een creditcard?" Ja/Nee. Ja → "Welke creditcards heb je?": a search field over the catalogue's personal credit cards (docs/catalog/catalog.json kind "creditcard", minus Business/Corporate products) shown as multi-select tiles, plus "Een andere kaart". Stored as `statedCards` (stated Field with catalogue ids or "other"); Nee stores an empty list. Jouw plan's cards section lists the stated cards by name when no card account comes from bank data, with its existing missing-data note; About you shows and edits them.
- **Bankgegevens (last screen, after "Heb je al eens belegd?"):** "Wil je je bankafschrift toevoegen?" One upload button (the existing CSV/statement import) and a "Later" link. After a successful import it shows the import result and "Naar je plan"; a failed import shows the error and lets the user try again or go on. Bank linking (redirect) stays in Profiel. Old profiles that finished the intake are not sent back for this screen.

## Round 3 (2026-10-26, owner feedback after round 2 went live)

- The wizard must scroll when a screen is taller than the viewport (the cards list was cut off and "Verder" unreachable). The app sets `overflow: hidden` on body, so the wizard root owns its scrolling; content that overflows starts at the top instead of being centred off-screen; "Verder" stays visible at the bottom.
- The card picker is brand-first: known brands as tiles; tapping a brand expands that brand's cards (multi-select). Typing in the search field shows a flat filtered list as before. Business and Corporate cards are included again (they were excluded in round 2).

## Round 4 (2026-10-26, owner: "en dan ook debetkaarten")

- New screen "Welke betaalpassen heb je?" / together "Welke betaalpassen hebben jullie?" in Over jou, right after savings and before "Heb je een creditcard?". No Ja/Nee gate (nearly everyone has one); multi-select, at least one, with "Een andere pas" always available. Same brand-first picker as the credit cards, over the catalogue's `kind: "betaalpas"` entries (business variants included). Stored as `statedDebitCards` (stated Field, catalogue ids or "other"); shown and editable in About you. Jouw plan does not use it yet. Users who already finished the wizard are not sent back for it; they can add it in About you.
