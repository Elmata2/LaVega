# LaVega as the middle-class financial adviser: pivot triage and profile intake

Date: 2026-10-21. Owner: Alexander. Status: draft for owner review.

Research behind this document (four agents, 21 Oct 2026): academic literature,
robo-advisers and finance apps, human advisers plus Dutch rules, and AI
personalisation. Most sources were read as abstracts or search summaries; items
marked UNVERIFIED below must be checked before they reach user-facing copy.

## 1. Intent

LaVega pivots from a cash-flow tool for multi-BV business owners to **the
financial adviser for the middle class**, on the **information and education
side only** (no AFM licence, no personal product advice).

The person: a middle-class earner with several income streams (salary plus
side income, rent, benefits) who wants to invest for their children, does not
know where to start, and suspects their money could work harder.

What they should walk away with is a personal picture that answers seven
questions: which card to use, how much they can invest, what investing options
exist for them, which subscriptions to keep, how much to spend per category,
how to use their points, and how to live financially.

The end goal is **mass personalisation through AI**: every user gets output
built on their own numbers and their own goals, written for them, at a cost
that works for a mass-market price.

This document covers the first two steps: (A) archive what no longer fits,
(B) the profile intake that everything after it reads from.

## 2. Goals, non-goals, anti-goals

Goals
- A1. Business-only features disappear from the product for every user, with
  code and user data kept so they can return.
- B1. An intake a beginner finishes in about 10 minutes, that ends with one
  concrete number about their own money.
- B2. A stored profile that later features (plan, AI narration) can read, where every field says where it came from.
- B3. The user can see and edit everything LaVega believes about them.

Non-goals (separate specs, later)
- The personal plan itself (the seven answers as one report).
- Any change to the investing app: it stays as is, and there is no beginner view.
- Subscription cancellation drafts, savings-rate alerts, points extension work.
- An LLM-led conversational intake.

Anti-goals (would make this a failure even if it works)
- Any sentence that recommends a specific financial instrument, or a
  percentage split, to this user. See section 6.
- An AI model producing or changing a number the user sees.
- A bank link required before the user gets any value.
- Raw financial data or exact amounts leaving the browser for the AI.
- A profile that silently guesses: an inferred fact the user has not confirmed
  is shown as a guess, never treated as fact.

## 3. Part A: archive the business side

Archived (hidden for all users, code stays on master, vault data untouched):
- Facturen (view, widget, invoice import, AI invoice extraction UI)
- Invoice forwarding: the Koppelingen invoice-address card and the forwarding
  guide
- Belasting and the BTW-stand widget
- Grens (private versus business)
- Entities / business scope switching, and the Positie widget (split across
  businesses). A user with entities set keeps their data; the UI shows the
  personal scope only.
- Valuta (owner's call accepted: it mainly served business payments abroad)

Behaviour:
- A stored module or widget choice that names an archived id is ignored, not
  an error. A deep link to an archived route lands on Overzicht.
- One switch in code (not per-user settings) archives the set, so bringing a
  feature back is a one-line change plus tests.
- Server routes for archived features (n8n feed, extract-invoice) stay
  deployed but unreachable from the UI. Owner's call for later: switch off the
  n8n workflow to save cost.
- Copy elsewhere that points at an archived feature (landing page, onboarding,
  chat tab instructions, AI prompts per tab) is updated in the same change.

Kept as-is: bank connection and import, Rekeningen, Transacties,
categorisation (rules and AI), Forecast and buffer, Optimalisatie, Punten and
the checkout extension, the chat assistant, vault, lock, backup and delete.
The investing app stays unchanged; there is no beginner view.

## 4. Part B: the profile intake

### 4.1 Where it sits

- Shown to a new user after the vault is set up, in place of the current
  onboarding; existing users see a card on Overzicht inviting them to do it.
- It can be stopped after any block and resumed; answers save as they are
  given.
- It is re-openable from Profiel as "What LaVega knows about you" (4.6).

### 4.2 Step 0: data first, offered not required

The first screen offers: connect a bank (the existing connection flow), upload
a bank export (the existing import), or continue without. Copy explains the
trade: connected means confirming instead of typing.

Without data, every block-1 card becomes a question with a range answer
("between €2,500 and €3,000 net a month"). The profile records these as
`stated`.

### 4.3 Block 1: confirm what we found

Each card says "We think …", shows the evidence (the transactions it is based
on, expandable), and has Confirm / Correct / Not mine.

| Card | Derived from (existing core where it exists) |
|---|---|
| Income streams: each source, monthly amount, regular or irregular | incoming recurring streams (`detectScheduleStreams`, sign +), plus irregular incoming totals per counterparty |
| Housing cost: rent or mortgage | `housing.ts` proposals |
| Fixed costs and subscriptions (housing line, recurring outgoing streams, subscriptions; definition in 4.7) | `detectSubscriptions`, outgoing schedule streams, the housing proposal |
| Visible debts: DUO, loans, credit card balances | recurring outgoing to known lenders; DUO is already recognised |
| Savings and buffer | account balances by account type |
| Cards and points | existing card and Punten data |

Inference rules:
- A stream needs at least three occurrences before it is proposed (the same
  bar the detectors use now).
- Children are never inferred from the absence of a signal. A child benefit
  (SVB kinderbijslag) or childcare payment may prompt "Do you have children?"
  with the evidence shown; the answer is always asked.
- Nothing is proposed from fewer than 60 days of history; the card says so
  and falls back to the question.

**Payoff at the end of block 1:** "Your room each month", computed in code: the
median monthly net (incoming minus outgoing) of the last three full covered
months, shown as a range (the lowest and highest of those months) with the
calculation expandable. The rules are in 10.2. Without data it is computed from
the stated ranges.

### 4.4 Block 2: what the data cannot show

- Household: living alone or together; a partner's income in or out of scope.
- Children: number, birth year of each. No names needed.
- Goals, each as its own bucket (goals-based planning, Das et al. 2010):
  what it is for, target amount, target date, and what happens if it is missed
  (flexible / important / must). A child goal is offered per child.
- Debts outside the linked accounts (student loan not visible, mortgage at
  another bank, private loans).
- Emergency buffer the user wants (months of fixed costs).

### 4.5 Block 3: risk and knowledge

- 4 to 6 questions on how the user would act after a loss (scenario form:
  "your €10,000 is worth €8,000 after a year; what do you do?"). Literature:
  loss-aversion and self-assessment items predict allocation; gamble-style
  questions add little (Guillemette, Finke & Gilliam 2012). Items are adapted
  from a published scale and the source is recorded in code; the builder
  checks the licence of whichever scale is used.
- Risk capacity is NOT asked: it is computed from data (buffer, room, debts,
  horizon) and stored separately from tolerance (Mazzoli & Marinelli 2014).
  Where capacity and tolerance disagree strongly, the profile flags it; the
  flag is shown to the user, not resolved for them.
- 2 to 3 basic knowledge questions (interest, inflation, diversification;
  Lusardi & Mitchell). Together with "have you invested before?" they set
  `experience: beginner | some | experienced`, which only sets the AI
  `readingLevel` (basic, intermediate, advanced) and the depth of Learn cards in
  the main app.
- Optional last question, free text: "What worries you most about money right
  now?" Stored as the user wrote it, in the vault.

Risk answers are dated. The profile asks again after 12 months, or sooner
when a life event is recorded (child born, income change of more than 20%,
new debt).

### 4.6 "What LaVega knows about you"

A page under Profiel listing every profile field with its value, its source,
its date, and edit / remove. Removing a derived fact stops it being
re-proposed until the data changes.

### 4.7 The profile record and the vault sections

Stored in the encrypted vault, versioned (old versions kept so a change is
visible over time). Shape, in Effect Schema in packages/core:

- every field: `value`, `source: derived | confirmed | stated`, `at` (date),
  and for `derived` the evidence ids.
- sections of the profile record: household, children, incomeStreams, housing,
  fixedCosts, debts, savings, goals, buffer, risk (tolerance score, answers,
  scale id, date), capacity (computed, never stored as an answer), knowledge,
  experience, worries (free text).

**Fixed costs** means one thing everywhere (profile, capacity, buffer, the plan):
the housing line plus recurring outgoing streams plus subscriptions. Debt
repayments are not fixed costs; they are counted as debts.

**Goal** (one schema; the plan references it and adds no fields). Each goal is a field with the usual `source` and `at` metadata, and its
value holds:

- `id`
- `purpose` (what it is for)
- `kind`: `general | child`
- `childId?` (set when `kind` is `child`)
- `targetCents`
- `targetDate`
- `priority`: `flexible | important | must`
- `plannedMonthlyCents?`
- `startingBalanceCents?`
- `accountRefs`: `Array<{ kind: "bank" | "broker"; id }>` (the accounts that
  hold the goal's money; a bank account id, or a broker account by its
  ownership key)

**Debt** (one shape): `{ id, lender, monthlyCents, balanceCents?, ratePct?,
source, at }`.

**Vault sections.** Four sections, each with its own merge strategy (built in
the intake plan, Task 2):

| Section | Holds | Merge across devices |
|---|---|---|
| `profile` | the profile record above, plus the intake state | newest write wins; the last 10 versions are kept inside the section |
| `plan` | `PlanPreferences` plus 13 monthly plan snapshots | `PlanPreferences` newest write wins; snapshots keyed by month |
| `learning` | concept state (the AI spec) | newest write wins per concept id |
| `events` | append-only events with unique ids: `ExplanationEvent`, `OutcomeEvent`, `PlanEvent` | union by id; counters are derived from the log, never stored |

This spec builds the `profile` section and the section scaffolding; the other
three are filled by the plan and the AI layer.

AI boundary: the server never receives the profile. When a later feature asks
the AI to explain something, the browser sends the **bucketed projection**
defined by the AI spec (section 10 there): ranges, counts and categories, a
list of concept ids, and one reading level; no names, no free text unless the
user sends it in chat. The browser fills exact numbers into the reply locally
from placeholders. This extends the existing redaction boundary; it does not
replace it.

## 5. What the intake changes immediately

- `experience` is stored only to set the AI `readingLevel` and Learn-card depth.
  The risk value stays in the vault.
- Overzicht shows "Your room each month" once the intake has run.

## 6. Legal line (information, not advice)

Source: AFM innovative services guidance and ESMA 2023 briefing, via the
research agent; a lawyer confirms before launch.

Allowed:
- Calculations on the user's own numbers ("after fixed costs and your buffer
  you have €640 a month left").
- General explanation (what an index fund is, what costs do over 18 years).
- A fixed, public table of scenarios with stated assumptions, where LaVega
  does not pick the row for the user.
- Factual comparisons on objective criteria (card points rate, fees).
- Facts about rules (gift-tax figures, box 3, Nibud numbers): every public fact
  goes through `PublicFact` with a `verifiedOn` date (defined in the intake plan,
  Task 2). A fact without `verifiedOn` cannot be shown. Candidates, all
  UNVERIFIED until checked on belastingdienst.nl or the source page: the annual
  gift exemption from parent to child (6,908 in 2026 per the research) and
  whether a minor's savings count in the parents' box 3 until 18.

Not allowed: naming a fund, product or provider as right for this user;
"invest €X a month"; "put X% in equities". A disclaimer does not make personal
advice into information (AFM fined Rodeler despite one).

Grey, kept out until a lawyer rules: "people with your profile usually …".

Also required before launch:
- A DPIA (the Dutch AP lists profiling and financial situation).
- No special-category data in the intake (health, religion, etc.).
- UNVERIFIED and to check: EU AI Act Annex III coverage of investment
  information; Nibud buffer figures if quoted.

## 7. Constraints

- New TypeScript logic uses Effect 4 (Schema, TaggedError, Context.Service,
  DateTime, Predicate), per AGENTS.md.
- All copy NL and EN, typed-complete, in the copy modules; no Dutch outside
  copy.
- Local-first: profile and answers live in the vault; nothing new on the
  server except what section 4.7 allows.
- Every number shown is computed in code and covered by tests; the AI never
  produces one.
- Motion, if any, follows the Emil skills; the register is restrained.

## 8. Success

- Median completion time about 10 minutes; most testers finish block 1.
- With linked data, block 1 is mostly confirm-clicks, not typing.
- Every field on "What LaVega knows about you" has a source and a date.
- No archived feature is reachable from the UI.
- How completion is measured with no analytics is left open (tester
  interviews for now).

## 9. Left to the builder

- Screen layout and visual design of the intake.
- Exact question wording within section 6's rules, and the scale chosen for
  the risk block (with its source and licence recorded).
- Where the archive switch lives and how routes redirect.
- How irregular income is summarised on a card.

## 10. Calls made after the builder check (Claude's, owner to check)

1. **Room uses the personal scope only.** Accounts assigned to a business
   entity are left out of "Your room each month", the income cards and the
   capacity score. A user with no entities set has all accounts counted.
2. **Room formula.** Per calendar month, for the last three full months:
   net = incoming − outgoing, where
   - internal transfers (category "Eigen overboeking", and transfers between
     the user's own accounts) are excluded both ways, so moving money to a
     savings account is not spending;
   - debt repayments (DUO, loans, credit card settlement from another account)
     count as spending;
   - one-off amounts are included; the range shows their effect;
   - irregular income is included as it fell in each month;
   - foreign-currency amounts follow the existing euro-conversion setting.
   Shown: the middle value as the headline, the lowest and highest of the
   three months as the range. Fewer than three full months: the card says so
   and uses what exists, never extrapolates.
3. **Capacity is a 1–5 score in code**, from four inputs each scored 0–2 and
   summed then mapped: buffer in months of fixed costs (<1, 1–3, >3), room
   (negative, 0–10% of income, >10%), debt payments as share of income (>30%,
   10–30%, <10%), and the nearest goal's horizon (<3 years, 3–10, >10).
   Tolerance from the risk block is also mapped to 1–5. **Disagreement is
   flagged when they differ by 2 or more.** Thresholds live in one table so
   they can be tuned; they are a starting point, not research-backed values.
4. **No investing-app call.** The investing app is unchanged and receives nothing
   from the intake. The risk value stays in the vault.
5. **The AI projection is NOT built in this spec.** The AI spec (section 10
   there) owns the projection. This spec only promises that the profile stays
   in the vault.
6. **Storage.** The vault sections and their merge strategies are in 4.7. The
   profile is the `profile` section of the existing encrypted vault (which
   syncs as an encrypted backup): the last 10 versions are kept inside it and
   the newest write wins. "Removed" derived facts are stored as a list of
   evidence fingerprints that are not proposed again until new evidence
   appears.
7. **Archive hides UI only.** Calculations that still serve a kept feature
   (forecast, Optimalisatie, chat context) keep running on the data they use
   today; tab instructions for archived tabs are removed from the chat.
8. **Onboarding is replaced.** Its language, country and region questions
   move into intake step 0 (country drives country-specific rules). Its scope
   choice (personal / business) is dropped. Existing users who saw onboarding
   are not shown step 0's settings again; they get the Overzicht invitation.
