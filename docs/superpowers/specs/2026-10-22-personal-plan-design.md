# Jouw plan / Your plan: the personal plan page

Date: 2026-10-22 (revised after builder check). Owner: Alexander. Status: draft for owner review.

Builds on `2026-10-21-advisor-pivot-intake-design.md` (profile 4.7, legal line 6, calls in 10) and the intake plan `docs/superpowers/plans/2026-10-22-advisor-intake.md`. AI text follows `2026-10-22-ai-explanation-and-learning-design.md` ("the AI spec"). This spec does not redesign that layer. Content research: `ai-layer-research/plan-content.md` in the session scratchpad ("research").

## 1. Intent

The intake gives LaVega a profile. The plan turns profile plus bank data into the seven answers every user should leave with: how to live financially, whether the buffer is enough, what debts cost, what is spent per category, which subscriptions to keep, which card to use and what points are worth, and how much room there is for goals and investing for children.

It is information and education. It computes on the user's own numbers and explains general facts. It never selects an instrument, provider or amount for this user (intake 6). Status chips say whether LaVega has enough data and whether something deserves a look; they are not verdicts.

## 2. Goals, non-goals, anti-goals

Goals
- P1. One page, seven sections in a fixed order, each on the user's numbers.
- P2. Every number from a pure function in `packages/core` with tests; every section shows "how we calculated this".
- P3. A status per section, computed in code from one threshold table.
- P4. Monthly recompute plus event triggers, and a change log.
- P5. Complete and useful with template text only. AI explanation plugs in later.
- P6. Works without bank data: sections say what is missing; nothing is extrapolated.

Non-goals: any change to the investing app; cancellation drafts, alerts, extension work; the AI layer itself; merging two partners' plans.

Anti-goals: any sentence saying what this user should buy, where or how much; an AI-produced number; moralising; a benchmark from a source LaVega has no right to use; a highlighted or pre-selected "best" row anywhere.

## 3. Build order

intake, then the plan with template text only, then the AI layer. The plan is shippable at step two. This step also builds the FactSheet schema (section 5); the AI layer consumes it as already existing. Template prose is therefore not a fallback detail but the first product: every section, status and empty state has full NL and EN templates from day one. When the AI layer arrives it replaces the explanation block only, never a figure.

## 4. Page structure

Navigation. "Jouw plan" / "Your plan" is the first nav item for users who finished the intake; Overzicht follows. Before the intake is finished the route shows the intake invitation and one sentence on what the plan will contain. A user who stopped after block 1 gets the sections their answers allow; the rest show not-enough-data.

Top to bottom:
1. Header: plan date, data freshness ("bank data to 20 Oct; profile confirmed 14 Oct"), links to "What LaVega knows about you" and to the assumptions.
2. Backbone strip: four steps (buffer, expensive debt, goals, investing). It is general education with its source (Nibud and AFM consumer pages), shown identically to everyone: "A common order, and why: a buffer first so a surprise bill does not become a loan; expensive debt because its interest is certain; goals by their dates; investing for money you will not need for a long time (AFM)." Under each step the user sees only facts from their own sections ("Buffer: 2.1 months of fixed costs", "Debt interest: 1,140 a year"). It never says which step is the user's next one, and never ranks the user's steps.
3. What changed since last month (section 13).
4. The seven sections, collapsible cards. Collapsed: title, status chip, headline figure. Expanded, always in this order: figures; the user's editable assumptions; explanation (template, later AI); "how we calculated this"; sources.
5. Footer: general information notice (not treated as a shield; the structural rules are), last computed time, "recompute now".

Section order: 1 Your month, 2 Buffer, 3 Debts, 4 Spending per category, 5 Subscriptions, 6 Cards and points, 7 Investing and goals. Sections 2, 3 and 7 map to the backbone; 4 to 6 are outside it.

Explanation controls. Each card's explanation carries the controls, disclosure and micro-check defined in the AI spec (simpler / more detail, helped / didn't, AI disclosure when AI wrote it, comprehension micro-check where a concept defines one). This spec references them and does not redefine them. With template text the disclosure is absent and the other controls select between the template levels.

## 5. Cross-cutting rules

Personal scope. Intake 10.1 applies to every section: accounts assigned to a business entity are excluded from income, room, fixed costs, buffer, debts, spending, subscriptions and cards. A user with no entities set has all accounts counted.

Engine. `packages/core/src/plan/` holds one pure function per section, `(profile, txs, accounts, rewards, catalogue, preferences, asOf) => SectionResult`. A result carries figures (integer cents, months, ratios), `status` and `statusReason`, `missing` (typed gaps), `calc` (ordered steps with inputs and outputs; this renders "how we calculated this" and is what tests assert), and its facts for the plan's FactSheet. No section function calls the AI, reads the clock or touches the network.

FactSheet and polarity. This step builds the FactSheet schema in `packages/core` (fields in AI spec 4.1 and 10) and one FactSheet for the whole plan; the AI layer, built later, consumes it as already existing. Each fact has an id, exact value, and a polarity (positive / negative / neutral) set by the engine per fact, plus a `mustMention` flag; the engine decides the mustMention set (for example a negative room, a goal behind schedule, a missed payment). Polarity belongs to the fact. The section status is a separate value: a section can be "attention" while individual facts in it are neutral or positive.

One AI call per plan. When the AI layer ships, the browser sends the AI spec's projection (bucketed FactSheet values, the concept ids to explain now, and one `readingLevel`); the model returns sentence objects tagged by section; the browser fills placeholders and shows each section its own sentences. The result is cached by FactSheet hash and regenerated only when the hash changes. There is no call per section. The projection is owned by the AI spec (its section 10); this spec only supplies facts.

Wording tables. The allowed and forbidden examples in sections 6 to 12 are data. They sit in one static slot of the plan prompt template (the AI spec's prompt layout in its 4.5 gains this slot, after the output schema and before the projection) and in the template tests. When the AI layer is built it adds the slot.

One advice-language list. `packages/core/src/advice/language.ts`, created in the intake plan (Task 2), is the single NL and EN list of banned advice language; this plan does not define a second one. The template tests and the AI validators (AI spec 4.3, rule 6) both import it, so they cannot drift. It bans at least: "best", "beste", "recommend", "we raden aan", "safe", "veilig" as a quality of an option, "good deal", "typical", "typisch", and "people / households like you / of your type" and their Dutch forms ("mensen zoals jij", "huishoudens zoals het jouwe"), plus the imperatives, ticker and ISIN patterns of the AI spec. No template in this plan uses a banned word.

Statuses. Three values, in one table `PLAN_THRESHOLDS` (versioned, placeholders to tune, not research-backed). A status is a prompt to look, never a verdict. Chips use a word and a symbol, not colour alone.

| Section | On track | Attention | Not enough data |
|---|---|---|---|
| Your month | median-month room >= 10% of income and no month negative | median-month room below 10% of income, or any of the three months negative | under 60 days of history and no stated ranges |
| Buffer | months of fixed costs >= the user's own buffer target | below that target | no fixed-cost figure or no savings balance |
| Debts | no visible or stated debt | any debt with payments, or a debt without a rate | a debt exists with no rate and no stated rate (cost cannot be computed) |
| Spending | every category within the user's own limit, or no limits set | a category above the user's own limit two months running | under 6 months of history |
| Subscriptions | no price increase flagged in the last 12 months and no overlap | at least one flagged increase or an overlap | no detected subscriptions and under 90 days of history |
| Cards and points | no held card with a net value more than 10% above the card in use | such a card exists | no card data or no cardable spend |
| Investing and goals | every goal's saved amount at or above its straight-line schedule | any goal behind schedule | no goals or no room figure |

Debts has no on-track/attention split by interest level: no unsourced percentage threshold is used (section 8).

Buffer, two separate things, not to be merged. (a) The plan's buffer status compares months of fixed costs with the user's own buffer target from the intake profile (the wish stored in `buffer`). (b) The capacity score in intake 10.3 uses fixed bands (under 1, 1 to 3, over 3 months) for risk capacity. They answer different questions, live in different functions and are never combined or substituted; the plan shows capacity only in section 12 beside tolerance.

Empty states. Each names the missing input, gives one action (connect a bank, import, answer an intake question, enter a figure), says nothing has been estimated, and shows any part of the calculation that can be done.

Copy. NL and EN typed-complete in the copy modules, one module per section; a missing status, wording key or empty-state reason in either language fails the build. No Dutch outside copy.

## 6. Section 1: Your month

Question 1, how to live financially. Inputs: profile incomeStreams, housing, fixedCosts, household; room from the intake (`computeRoom`, intake plan Task 4); `detectSubscriptions` and the recurring-stream detectors.

Computation.
- Room: the plan calls `computeRoom` and reuses its `RoomResult` unchanged (three full months, personal scope, transfers excluded). "Median month" in this spec is the median by monthly net of those three months; the headline and the status use it; low and high months are the range.
- Fixed versus variable: fixed = housing plus detected recurring outgoing streams and subscriptions (the one definition, intake 4.7; the buffer in section 7 and the capacity score use the same one); variable = all other outgoing. This is a split by detection, not a category taxonomy, and says so. Shown as amounts and shares of income. (Grouping by Nibud's three buckets is deferred: it needs a category-to-bucket table that does not exist.)
- Savings rate: money moved to the user's own savings accounts plus room left, over net income, averaged over the three months. Shown as the user's rate, with Nibud's guidance of about 10% of net income as a cited reference once verified (section 15) ("Nibud's budget advice mentions saving about 10% of net income"). No shortfall amount is computed or shown, and nothing says what the user "could invest".
- Habits panel: options with the source (pay yourself first, automatic transfer, annual review). The pension overview link is UNVERIFIED (section 15).

Allowed: "Over the last three months you had between 420 and 810 left each month; the middle month was 640." "Fixed costs are 58% of your income; the rest is 31%." "Your savings rate was 7%." and, once verified, "Nibud's guidance mentions about 10%."
Forbidden: "Your fixed costs are too high." "You should save 10%." "You could invest 150 more."

Empty state. No bank data: stated ranges from the intake give a room range; fixed/variable and savings rate show "needs transactions" with the connect/import action.

## 7. Section 2: Buffer

Question 2. Inputs: profile `buffer` (target months), savings, fixedCosts; fixed costs from section 6; balances by account type.

Computation. Two lines, never merged (research 1.2):
- Income buffer: months of fixed costs = liquid savings (savings and current accounts of the personal scope, minus accounts linked to goals, section 12) divided by monthly fixed costs (section 6 definition). Gap to the user's own target in cents and months. The target is the intake value; if the intake has none, the card asks for it and computes nothing against a default.
- Object buffer: Nibud's buffer is for large unexpected costs (replacing inventory, repairs, a car), not for falling income. LaVega does not clone the BufferBerekenaar (algorithm unpublished). The card links to the tool and accepts a typed result; with a value it shows what share of savings that is.
- Time to close a gap: gap divided by the room range, or "not reachable at current room" when room is zero or negative. No date is promised.

Status: the buffer rule in section 5. Irregular or self-employed income adds a general sentence that an income buffer matters differently there; it does not change the status.

Allowed: "You have 2.4 months of fixed costs saved; your target is 4, so 1.6 months (4,100) remain." "Nibud's buffer is meant for unexpected large costs, not a drop in income."
Forbidden: "You need six months." "Your buffer is dangerously low." "Build your buffer first."

Empty state: no savings balance, so ask for it; the target control still shows what months mean in euros once fixed costs are known.

## 8. Section 3: Debts

Question 3. Inputs: profile debts (balance, payment, rate where known); recurring outgoing to known lenders, DUO recognition; `interest.ts` (`keptRate`, `detectInterestRate`, `bestRate`).

Computation per debt: interest cost per year = balance times APR, shown as a fact; payoff date at the current payment; interest saved by an extra amount the user types (default none). A debt without a rate is listed without cost and asks for the rate; it is never assigned one. Beside it, as a fact, the savings rate the user earns now and the best free-access rate in the catalogue, dated and sourced.

LaVega does not label a debt "expensive" by an unsourced threshold. The education block explains APR, why revolving credit and overdrafts cost more, and what Dutch consumer credit looks like, from sourced general facts. A DUO loan is flagged as a different kind with different terms; current DUO rules are UNVERIFIED and no rule is stated until checked.

Allowed: "Your loan costs 9.5% a year, about 1,140 in interest. Your savings account pays 2.1%." "50 more per month would end the loan 14 months earlier and save 380 in interest."
Forbidden: "Pay off your loan before saving." "This is a bad loan." "Move your savings to repay it."

Empty state: no debts found: "Debts at other banks or private loans are not visible to LaVega" with the intake debts question as the action. Absence is never shown as "debt-free".

## 9. Section 4: Spending per category

Question 4. Inputs: categorised transactions (`categories.ts`), `categorySpendPercentiles` (needs six months; `MIN_HISTORY_PERIODS`), the user's own limits.

Computation. New code: a spend-history function returning, per category, the last full month, the three-month average and the 12-month median; the percentile of the last month within the user's own months comes from the existing `categorySpendPercentiles`. Trend over six months as numbers. The user may set a limit per category; none is imposed. The comparison is only ever with the user's own history.

External benchmark: none at launch. Nibud reference budgets are paid products with unstated licence terms and no API (research 1.4); nothing is scraped. CBS is not a candidate (`docs/research/2026-08-20-categorie-gemiddelden.md` rejected it). The typed slot `ExternalBenchmark { source, year, householdType, licenceId, valuesByCategory }` stays empty until a Nibud data agreement exists; until then the section links to Nibud's free Persoonlijk Budgetadvies. When filled, wording is "Nibud's reference budget for this household size and income lists X for groceries; you spent Y", with source and year, above/below the reference, no judgement words.

Status: section 5 table.

Allowed: "In groceries you spent 410 last month; your usual month is 380 (your last 12 months ranged 340 to 450)." "Restaurants went up three months running."
Forbidden: "You spend too much on takeaway." "Reduce this." "Households like yours spend less."

Empty state: under six months, show plain monthly totals, say a comparison with your own history needs six months, give no percentile.

## 10. Section 5: Subscriptions

Question 5. Inputs: `detectSubscriptions` (monthly cents, `changePct`, cadence, `skippedCycles`), `subscriptionOverlaps`, `subscriptionPriceIncreases`, the user's decisions and usage events.

Computation. An evidence list, one row per stream:
- Cost per month and per year; months active.
- Price changes use `subscriptionPriceIncreases` and its existing thresholds (3% and 0.50 euro). The change date (the first charge at the new price) and the price before and after are new code in the plan; the detector today gives only first and last amount.
- Overlap with other streams in the same function group, with the combined monthly cost.
- Last use only if the user logs it ("used this month"); otherwise "usage unknown". Cost per use only with at least one logged month.
- Total monthly and annual cost, and a what-if of the saving if the user marks streams as cancel (nothing is cancelled or drafted).
- Labels Keep / Review / Cancel are set only by the user. No label is pre-selected or highlighted by LaVega; flagged facts (price up, overlap, no use logged, missed payment) appear as facts on the row. Decisions and usage logs are append-only events, merged by union across devices (section 14).

Allowed: "Price up 18% since March, from 9.99 to 11.79." "Two video streaming services: together 24.98 a month." "No use logged in 3 months; 141 a year."
Forbidden: "Cancel this one." "You don't need this." "A waste of money."

Empty state: under 90 days, say a stream needs three occurrences to be recognised and offer a manual add.

## 11. Section 6: Cards and points

Question 6. Inputs: the user's cards, spend per category (section 9 data), `rewards.ts` balances (`isStale`), `assumedCashback.ts` tiers, `netBenefit.ts`, the catalogue.

Computation.
- Card comparison: a new core function, ported from `apps/extension/src/rank.ts`. The extension ranks one checkout (`rankCheckout`) and reads checkout-specific terms; the plan needs net value over the user's annual spend per category. This is a rewrite on top of `netBenefit` and `rankByNetBenefit`, not a re-export; whether the extension then imports it from core is the builder's call, but plan and extension must agree on shared cases, tested with common fixtures.
- Per spend category, per card: earned at the user's own spend minus the fee share, as net value over a stated horizon. Cashback tiers are respected: assumed is shown as assumed, unknown as unknown, never as zero.
- Criteria columns: annual fee, earn rate by category, foreign exchange markup, points expiry, transfer ratio, insurance, each with date and source. Default sort is neutral, by name; the user may sort by any column. No row is highlighted, ordered by a profile score, or labelled.
- Value per point: value = cash price saved divided by points spent. The user enters redemption examples; the section shows the lowest, median and highest of their own examples as a range and states that no market value is assumed. Without examples, balances and expiry only, no euro value. A published "cents per point" is never shown as fact. Transfer ratios appear only with a dated NL source; the research found only Canadian ones (UNVERIFIED, section 15).
- Break-even: annual spend at which a card's fee is earned back across the user's value range. Expiring balances with their date.

Status: section 5 table.

Allowed: "At your own spend, card A earns 310 points a year and card B 240; after fees 48 and 12 at your lowest redemption (0.4 cent)." "These points expire on 31 March."
Forbidden: "Use card A." "Card A is the best for you." "Your points are worth 1 cent each."

Empty state: no card data, link to the Punten and Optimalisatie flows; show the criteria table without the user's spend, same neutral sort.

## 12. Section 7: Investing and goals

Question 7. Inputs: profile goals, children, household, risk, capacity, buffer, debts; room (section 6); buffer and debt results.

Goal money. Each goal in the intake profile (the Goal schema of intake 4.7; this spec adds no goal fields) carries `accountRefs`. The user links accounts to a goal in the intake goals block or on the plan page. Linked balances count as saved towards that goal and are excluded from the income buffer in section 7 so money is not counted twice. A goal with no linked account is funded from a typed "saved so far" amount (`startingBalanceCents`), flagged `stated`.

(a) Room for goals. Room (section 6 range) minus the buffer top-up implied by the user's own target (spread over a number of months the user sets) minus the monthly saving that the user's own goals need (below) equals an "unallocated" line. Every deduction is shown, the range is kept, and the sentence is "remains unallocated" or "is not allocated", never "you can invest". If a deduction cannot be computed, the line says which and stops. Capacity (computed) and tolerance (risk block) are shown side by side with the intake's disagreement flag. A loss illustration uses the user's own numbers ("a 30% fall in 10,000 is 3,000, which is 4.7 months of your room").

(b) Goals and horizon math, per goal and per child: years left, target, saved so far, required monthly saving at 0% and at the three stated rates of (d) (all from `packages/core/src/plan/scenarios.ts`, the one scenario module, owned by the plan; contributions at month end, rates 0, 2, 4 and 6% with the assumptions printed; required monthly saving is defined there and nowhere else), funded percentage, and the gap as a number. Status compares saved to a straight-line schedule. The goal card contains no sentence about where money needed soon should be kept; that statement appears only in a general Learn card (AFM: invest only money you can miss for a long time), the same for every user. Child goals use birth year for years to 18. A study-goal template (monthly cost times months plus tuition, inflated at a user-set rate, every figure editable, link to Nibud's WatKostStuderen) is preloaded with no figures; DUO and tuition values are UNVERIFIED.

(c) Rule facts, dated and sourced, as `PublicFact`s. Gift tax 2026 (Belastingdienst, research 2.1): annual exemption parent to child 6,908, parents count as one donor, also after divorce; one-time increased exemption for a child aged 18 to 40: 33,129 free purpose, 69,009 for an expensive study, it replaces the annual exemption that year and requires an aangifte. The age bound wording is checked before display. A minor's assets count towards the parents' box 3, per secondary sources only. There is no box 3 engine in the codebase and none is added: no box 3 estimate, no free allowance or deemed-return figures are computed or shown. Only the dated, verified fact with a link to the Belastingdienst page appears, once verified.

(d) The fixed public scenario table. General education shown identically to everyone and never beside the user's own contribution input. Fixed example: 100 a month for 18 years (21,600 paid in), gross returns of 2%, 4% and 6% in columns, costs of 0.2% and 1.5% a year in rows; monthly compounding, contributions at month end, constant return, no tax, no inflation, assumptions printed; every cell comes from `scenarios.ts`. The engine computes every cell and a test checks it against the closed formula with one hand-checked cell; the research's 5% example is not copied. Labelled "an illustration with stated assumptions, not a forecast and not a choice for you". Historical falls (2008, 2020) are dated events with depth and recovery time, not forecasts. There is no editable version of this table. The user's own contribution appears only in (a) and (b).

(e) General education: index funds, costs over time, diversification, and objective differences between savings, deposits, bonds, funds and shares (cost, risk characteristics, liquidity, tax treatment). Written from the AI spec's concept catalogue (template text first). Backbone: AFM pages on spreading, costs, long term, buffer and investing only what one can miss; "most active funds trail their index after costs over long periods" with the SPIVA source and date. A provider comparison for children's accounts (research 2.3) is a criteria table with dated sources, neutral name sort, user-sortable, no highlight; it does not ship until each value is verified. No instrument is named as right for the user.

Status: section 5 table.

Allowed: "After fixed costs, your buffer top-up and your goals' monthly saving, 410 to 740 a month is not allocated." "Parents together can give each child 6,908 tax-free in 2026." (once verified as a `PublicFact`) "AFM notes that costs weigh more the longer the horizon." "For this goal, 180 a month at 0% reaches the target by 2036."
Forbidden: "Invest 400 a month." "Put 60% in a world index fund." "Meesman is the cheapest for you." "A safe way to invest for your child." "Money you need soon belongs in savings" (on a goal card). "People like you choose index funds."

Empty state: no goals, show the goals prompt and the public table (it needs nothing from the user). No room figure, show goal maths without an unallocated line.

## 13. Refresh and change log

Recompute in the browser: on opening when the last result is over 30 days old; on the first open after the 1st of a month; on any trigger; and on demand.

Triggers (the reason is logged): income level (median-month income differs from the previous snapshot by 20% or more, or a new stream is confirmed); a subscription price increase newly flagged by `subscriptionPriceIncreases`; a goal date within 12 months; buffer months falling below the user's wish; a new debt, child, card or points balance; an edited profile field.

Change log. Each recompute stores a snapshot (figures and statuses, not prose). The page compares to the previous snapshot and lists, in section order: figure, before, after, and the engine's reason ("income stream Salary: 3,100 to 3,400"). A status change shows the old and new chip. Changes below the noise bound in `PLAN_THRESHOLDS` are omitted; if nothing material changed it says so. When the AI layer exists, the top three changes feed the prompt (AI spec 4.5, item 6).

## 14. Data model

Plan state lives in the vault sections named in intake 4.7 (`plan` and `events`), separate from the `profile` section. Merge strategies are built in intake plan Task 2. All schemas in `packages/core`, Effect Schema.

- `plan` section: `PlanPreferences` (user-entered, dated values; the buffer target is owned by the intake profile and not mirrored here): `categoryLimits`, `shortHorizon` display setting if any, `redemptionExamples`, `nibudBufferResult`, `studyCostAssumptions`, `extraDebtPayment`, `bufferTopUpMonths`; newest write wins. Plus `PlanSnapshot`: `asOf`, `thresholdsVersion`, `profileVersion`, per-section status and figures, trigger; monthly, the last 13 kept.
- `events` section: `PlanEvent` records, append-only with unique ids, merged by union across devices: `SubscriptionDecision { streamKey, decision, at }` and `UsageLog { streamKey, month, at }`. Current state is derived from the log, never stored.
- Goals use the intake Goal schema (`accountRefs` links accounts); this spec adds no goal fields.
- `PLAN_THRESHOLDS`: the table in section 5, versioned.
- `PublicFact { id, textKey, value, source, sourceUrl, verifiedOn, verifiedBy }`: defined in intake plan Task 2 (it exists before this step). A fact with no `verifiedOn` fails a build check and cannot be shown. This enforces section 15.
- `ExternalBenchmark` slot, empty at launch.

No new server storage. The AI boundary is the AI spec's.

## 15. Verification before copy ships

Each item is a `PublicFact` or catalogue value that needs `verifiedOn` and a primary page.
1. Gift tax 2026 figures, the 18-to-40 versus 18-to-39 bound, any grandparent amount (belastingdienst.nl).
2. Box 3 treatment of minors (fact only; no figures computed).
3. Nibud: copyright page and data-agreement route; whether quoting the 10% guidance is allowed and its exact wording.
4. Netherlands card terms (Amex Membership Rewards ratios and fees; ING, Rabo, ABN). Research found only Canadian sources.
5. Child-account provider values (Brand New Day, Meesman, Bux, Peaks, DEGIRO, IBKR) and parental authority rules.
6. DUO rules and tuition for children born 2020 or later.
7. AFM pages cited actually say what the research summarised (it read summaries); the status of AFM rules on automated advice.
8. SPIVA Europe figures with year, from the S&P source.
9. The pension overview URL.
10. EU AI Act Annex III coverage and the DPIA (intake 6).
11. A Dutch financial-regulatory lawyer reads the final NL copy of section 12 and all wording tables. This is not legal advice.
(Removed with the rulings: CBS licence check, the 10% debt rule of thumb, the 3 to 6 months and 5-year conventions, which are not used.)

## 16. Verification of the build

- Unit and property tests per section function: room reuse, buffer months, debt interest and payoff, scenario table values, required monthly saving, card net value, every status edge.
- Mutation check on the money functions (`lavega_verification_lessons`).
- Copy test: every status, wording key and empty-state reason exists in NL and EN; the shared advice-language list finds nothing in template output.
- When the AI layer exists: AI-spec validators run on one fixture FactSheet per status combination.
- A browser run with a seeded profile through the project's verify skill: all seven sections, template text, and the change log after editing an input.

## 17. Left to the builder

- Visual design of cards, backbone strip and scenario table; charts; restrained motion (Emil skills).
- Threshold values within section 5's structure; whether the noise bound is absolute or relative.
- Where the shared card-value function lives, and the module layout under `packages/core/src/plan/`.
- Exact template sentences, within the wording tables.
- Whether cards in attention open by default.
