# Wizard personalisation: every question earns its place

Date: 3 November 2026. Status: approved direction (owner, chat 3 Nov), awaiting design review.

## Why

The intake wizard (22 screens) mostly feeds budgeting. A code sweep on 3 Nov found
that several answers are stored and read by nothing (`housing.kind`,
`household.partnerIncomeInScope`, `intake.noCards`, `intake.noUserDebts`,
`knowledge.investedBefore`), that stated cards are listed but never ranked in the card comparison,
that nothing tells the user which banks to connect, and that no wizard answer
reaches the AI. The owner's rule: a question stays only if it changes one of
LaVega's five outcomes.

1. **Budget and the full picture**: a budget, plus which banks and cards to
   connect through Enable Banking to see everything.
2. **Cards**: which card is best for interest and cashback.
3. **Spending habits**: spending read from transactions, commented on daily or
   weekly by the future "instinct" agents.
4. **Investing**: a recommended investing strategy (see constraint below).
5. **Points**: which points to collect and how to use them.

## Goals

- Every wizard screen maps to at least one outcome, and the effect is visible in
  the app (Your plan, Overview, or the AI context), not just stored.
- Add the questions that the five outcomes need and the current wizard lacks.
- Remove or fix questions that change nothing.
- Keep round 1 short enough to finish in one sitting; move habit and points
  questions to a short round 2 after the first bank connection.

## Non-goals

- Building the instinct agents themselves (outcome 3). This work only collects
  and exposes the answers they will need.
- A per-transaction "use card X here" engine. Round 1 ranks cards by the user's
  stated spending mix; the transaction-level version is later work.
- Any change to `apps/investing-web`.

## Anti-goals

- Investment product advice. Recommending what to invest in requires an AFM
  licence; the owner's standing line is that investment products stay out. Until
  the owner decides otherwise (lawyer), outcome 4 is limited to: how much room
  there is, the risk profile, the time horizon, and general education about what
  that profile usually means. No instrument, fund, allocation percentage or
  "invest €X in Y". (Builder: treat this as a hard constraint.)
- Credit card recommendations are consumer credit under the Wft. Copy stays
  factual (fees, cashback, interest, points per euro) and never urges taking on
  credit; the pay-in-full answer exists precisely to warn people who revolve.
- Questions whose answer the app could already measure from bank data are asked
  only as a fallback before data exists (infer, then confirm).

## Interaction rules (already shipped on feat/wizard-continue-button)

One question per screen. Every screen moves on only with the Verder button,
including single-choice screens. Each new screen follows this.

## Round 1 (the wizard), in order

Existing screens are marked (kept), (changed) or (removed). New screens are (new).
Data shape is the AdvisorProfile field (packages/core/src/advisor/profile.ts);
every new field is `Field<…>` with `source: "stated"` and `at`, like the others.

| # | Screen | Field | Outcome | Effect in the app |
|---|---|---|---|---|
| 1 | Alone or together (kept) | household.kind | 1 | labels, scope |
| 2 | Shared or separate money, only if together (new) | household.moneySharing: "shared" \| "separate" \| "mixed" | 1, 3 | Replaces the unread `partnerIncomeInScope`. "separate" words income/spend as "your own"; "shared"/"mixed" as household. |
| 3 | Birth year (new) | birthYear: int | 1, 4 | Years to state pension age shown on the investing-room line; buffer note for early career. |
| 4 | Work (kept) | work | 1 | unchanged |
| 5 | VAT, self-employed only (kept) | chargesVat | 1 | unchanged |
| 6 | Fixed salary or varying income (new) | incomeRegularity: "fixed" \| "varies" | 1 | "varies" raises the default buffer suggestion and adds a cash-flow note. Pre-filled "varies" when work is freelance/business, editable. |
| 7 | Children, years (kept) | children | 1, 4 | unchanged |
| 8 | Income (kept) | statedRanges.income | 1 | unchanged |
| 9 | Spending (kept) | statedRanges.spend | 1 | unchanged |
| 10 | Housing (changed) | housing.monthlyCents | 1 | Drop the rent/mortgage/other tiles (no reader); amount only. Keep `housing.kind` in the schema for old data. |
| 11 | Savings (kept) | savings | 1 | unchanged |
| 12 | Which banks do you use (new) | statedBanks: string[] (bank ids from the Enable Banking NL list, plus "other") | 1 | Drives a "Connect for the full picture" checklist on Overview and in Your plan: each stated bank, plus each bank implied by stated cards, shown as connected / not connected, linking to Koppelingen. |
| 13 | Debit cards (kept) | statedDebitCards | 1 | Implies banks for the checklist. |
| 14 | Credit cards, one screen with a "none" tile (changed) | statedCards (+ noCards) | 1, 2, 5 | Merges has-cards + cards. Stated cards enter the card comparison (see Cards below) and imply banks for the checklist. |
| 15 | Pay credit card in full each month, only if cards (new) | cardRepayment: "full" \| "sometimes" \| "rarely" | 2 | "sometimes"/"rarely": the Cards section leads with interest cost and a warning, and ranks by interest rate before cashback. |
| 16 | Where most money goes, pick up to 3 (new) | spendMix: ("groceries" \| "travel" \| "online" \| "fuel" \| "eating-out" \| "other")[] | 2, 3 | AI context and round 2 cut targets; "travel" raises the foreign share in the card comparison (see Settled 4). |
| 17 | Pay abroad or in other currencies (new) | foreignSpend: "often" \| "sometimes" \| "never" | 2 | Adds foreign-transaction fees to the card comparison. |
| 18 | Goal (kept) | goals | 1, 4 | unchanged; horizon feeds the investing line. |
| 19 | Debts, details (kept) | debts | 1 | unchanged |
| 20 | Buffer (kept) | buffer.months | 1 | unchanged |
| 21-26 | Risk questions (kept) | risk | 4 | unchanged (score 1-5). |
| 27 | Invested before (changed) | knowledge.investedBefore | 4 | Wire it: `experience` reaches the investing education copy (beginner gets the explainer first). |
| 28 | What should LaVega help with, multi (new) | priorities: ("spend-less" \| "save-more" \| "pay-off-debt" \| "cards-points" \| "subscriptions" \| "children" \| "start-investing")[] | 1-5 | Orders the sections of Your plan; first item becomes the AI's first focus. |
| 29 | Summary (new) | none | all | "What LaVega now knows about you": one line per answer, each with Wijzig, before the upload screen. |
| 30 | Upload statement (kept) | | 1 | unchanged |

Net: 22 screens become about 30 for someone with cards and a partner, fewer for
others (conditional screens 2, 5, 15, 16, 17 skip).

## Round 2 (after the first bank connection or upload)

An invite card on Overview, "3 questions so LaVega can coach you", reusing the
wizard frame. Not shown before LaVega has something to show.

| Screen | Field | Outcome | Effect |
|---|---|---|---|
| Where would you like to spend less, multi | cutTargets: same categories as spendMix plus "subscriptions" | 3 | Instinct agents watch these first. |
| How often should LaVega check in | checkInCadence: "daily" \| "weekly" \| "when-it-matters" | 3 | Stored for the agents; settings page can change it. |
| How on top of your money do you feel, 4 steps | confidence: 1-4 | 3, 4 | Sets explanation depth and tone in AI copy. New field; the existing `worries` field is left alone. |
| Loyalty programmes you are in, multi | statedPrograms: REWARD_PROGRAMS ids (packages/core/src/rewards.ts) | 5 | Pre-fills Punten with those programmes (balance still entered by the user). |
| What do you want points for | pointsGoal: "flights" \| "upgrades" \| "shopping" \| "cashback" \| "no-preference" | 2, 5 | Card comparison values points by this goal (cashback-preferring users get cashback cards ranked first). |
| Flights per year | flightsPerYear: "0" \| "1-2" \| "3-5" \| "6+" | 5 | Weights airline programmes and travel cards. |

## Cross-cutting

- **AI context.** A small, explicit profile summary (priorities, cutTargets,
  checkInCadence, confidence, household, incomeRegularity, spendMix,
  cardRepayment, pointsGoal) is added to the chat/agent context behind the
  existing redaction boundary. No amounts beyond what the overview context
  already sends; no birth year; no bank names. (Builder: follow the existing
  redaction tests in apps/server and apps/web; this is a privacy path and gets
  an interrogate review.)
- **About you.** Every new field is editable on the About-you page, like the
  existing ones.
- **Plan engine.** New inputs enter through `planProfileOf`
  (packages/core/src/plan/profileView.ts) only; bump PLAN_ENGINE_VERSION.
- **Copy.** NL and EN, typed-complete, in the copy modules. No hyphens in
  sentences, plain words, "financieel adviseur" register.

## Removed

- `has-cards` screen (merged into the cards screen).
- Rent/mortgage tiles on housing.

## Decided by me (owner can overrule)

- Round 2 is an invite card after the first data, not part of the first run.
- Stated banks list comes from the Enable Banking NL list already used by
  Koppelingen, shown as logo tiles, with "Other".
- spendMix allows up to 3 picks.
- The summary screen sits before the upload screen.

## Settled after the builder check (my calls)

1. **Bank ids.** `statedBanks` stores the bundled brand ids already in
   `apps/web/src/intake/wizard/cardOptions.ts` (`CardBrand`/`DebitBrand`:
   ing, abn, rabo, sns-asn-regio, triodos, knab, bunq, revolut, n26, wise,
   amex, ics, …, plus "other"), not Enable Banking names, which can change.
   Cards imply banks through the existing id prefix → brand table. No live
   fetch on the wizard screen.
2. **"Connected".** A brand counts as connected when a connected bank account's
   institution name matches a small hand-written alias table (brand → name
   fragments, e.g. abn → "ABN AMRO"). No match shows the brand as "not yet
   connected" with a Koppelingen link; never a false "connected". If the client
   holds no institution name per account, the builder adds it to the account
   record at link time (no server change expected; verify first).
3. **Stated cards in the comparison.** Today stated cards are listed with
   catalogue facts (`apps/web/src/plan/statedCards.ts`) but `computeCards`
   (packages/core/src/plan/cards.ts) ranks only cards found in bank data. The
   gap is ranking: stated catalogue cards enter `computeCards` as candidates,
   valued on stated spend until 60 days of bank data exist. "other" (not in the
   catalogue) is listed, never ranked.
4. **Scoring.** The catalogue has flat `cashbackPct`, `pointsPerEuro`,
   `fxFeePct`, `interestPct` per card, no per-category rates. So: yearly value =
   spend × cashback, or points × a value per point that depends on `pointsGoal`,
   minus yearly fee, minus foreign share × spend × fxFeePct (foreign share:
   often 15%, sometimes 5%, never 0). If `cardRepayment` is not "full", the
   section leads with yearly interest at `interestPct` on one month's spend and
   ranks by interest first. `spendMix` does NOT rank cards per category (no
   data); it feeds the AI context and the round 2 cut targets, and "travel"
   raises the foreign share one step. Per-category catalogue data is a non-goal.
5. **Round 2 trigger.** Shown when round 1 is done (`blocksDone >= 3`) and the
   vault holds at least one transaction from a connection or upload. Done state
   is `intake.round2Done: boolean`. Someone who connects before finishing
   round 1 sees the round 1 invite first, as today.
6. **Existing users.** Missing new fields mean unanswered. Users who already
   finished the wizard are not sent through it again; they get an Overview
   invite, "A few new questions", that runs only the new round 1 screens they
   have not answered, then the summary. `resumeScreen` must not skip new
   screens that sit before `lastScreen`.
7. **Buffer.** `incomeRegularity` "varies" preselects 6 months on the buffer
   screen (instead of no preselection) and adds the cash-flow note; the plan's
   buffer logic (packages/core/src/plan/buffer.ts) is unchanged.
8. **Birth year.** Stored in the encrypted profile like the other fields; never
   sent to the AI. The investing line shows years until 67 with "check your
   exact AOW age at the SVB", no pension-age table.

## Left to the builder

Component structure, test layout, exact copy wording within the rules above,
the visual for the connect checklist (reuse existing Koppelingen/BankLink parts).

## Open with the owner

- Outcome 4 beyond education needs a legal answer (AFM). Built as education
  only until then.
