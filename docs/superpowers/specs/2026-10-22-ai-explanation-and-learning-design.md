# AI explanation layer and learning system

Date: 2026-10-22. Owner: Alexander. Status: draft for owner review.
Binds to: `2026-10-21-advisor-pivot-intake-design.md` (section 4.7, the AI
boundary, and section 6, the legal line). Where this spec and that one disagree,
that one wins.

Research behind it (four agents, 21 Oct 2026): learning systems, explanation
engineering, privacy-preserving learning, intake personalisation. Most sources
were read at abstract or search-summary level. Items marked UNVERIFIED must be
checked before they reach user-facing copy, a contract or a DPIA.

## 1. Intent and why

The owner's goal is mass personalised learning, "almost deep learning": LaVega
gets better for each user and for all users over time, on the information and
education side only, local-first.

Two things make that honest rather than a slogan.

1. The numbers stay deterministic. The engine computes every figure; a model
   only writes prose around placeholders. Models carry numbers badly: FinanceBench
   (Islam et al., arXiv 2311.11944) had GPT-4-Turbo with retrieval wrong or
   refusing on 81% of a 150-question sample (2023 models, document QA, so
   indicative only); the FAITH benchmark (arXiv 2508.05201) exists because
   numeric spans in financial tables get hallucinated (scores UNVERIFIED).
2. "Learning" is staged by the data that exists. The research is consistent:
   financial education works on average but decays, and works best at a
   teachable moment tied to a decision (Kaiser & Menkhoff 2017; Kaiser, Lusardi,
   Menkhoff & Urban 2022; Fernandes, Lynch & Netemeyer 2014, who find about
   0.1% of behaviour variance explained and no effect at 20+ months). LaVega sees
   the moment (a salary, a price rise, a goal date), so the right target is the
   right topic, at the right moment, at the right depth, repeated. At 10 users
   that is an inspectable per-user model plus humans improving the content.
   Learned ranking, bandits and anything resembling deep learning wait for
   user counts that justify them (section 11).

## 2. Goals, non-goals, anti-goals

Goals
- G1. Every explanation LaVega shows is built on the user's own engine output,
  with exact numbers filled in the browser.
- G2. Each user's explanations adapt: reading level, depth, which concepts are
  already known, when to remind.
- G3. LaVega as a whole improves from opted-in users, by humans first, by
  bandits later, with a privacy design that does not break local-first.
- G4. Quality and safety are measured continuously, not assumed.
- G5. Explanation features cost under EUR 0.05 per user per month.

Non-goals
- A recommendation, allocation or product pick of any kind (intake spec 6).
- A model that produces or alters a number the user sees.
- Federated learning, learned embeddings or fine-tuning on user data now
  (section 11). The one exception is the stage 0b style fine-tune on synthetic,
  owner-approved examples.
- Voice, push-notification campaigns, or a gamified learning course.

Anti-goals (a failure even if it works)
- Optimising time in app, sessions, streaks or notification response.
- Learning which emotional framing makes stressed users act (AI Act Art. 5(1)(a)
  and (b), in force since 2 Feb 2025; checked via commentary only, read the
  Official Journal text before relying).
- Any stable identifier linking learning telemetry to an account.
- Free-text user content, exact amounts or counterparties leaving the browser.
- Memory kept as transcripts.

## 3. Architecture overview

```
 BROWSER (vault)                                   SERVER (stateless)
 ---------------------------------------------     ---------------------------------
 transactions, profile, goals
        |
        v
 deterministic engine (packages/core)
        |  emits
        v
 FactSheet (typed, exact values, polarity)
        |
        v
 bucketed ProfileProjection + facts  ----------->  prompt = static prefix (constitution,
   (ranges, counts, no names/free text)              style guide, tab .md, schema)
        ^                                            + projection (concept ids, level)
        |                                                   |
        |                                                   v
        |                                          Mistral Small (JSON sentences,
        |                                          {{placeholders}} only, closed kinds)
        |                                                   |
        |                                                   v
        |                                          validators: schema, placeholder
        |                                          allowlist, no stray digits, must-
        |                                          mention, polarity, advice blocklist,
        |                                          readability, small judge (block only)
        |                                                   |
        |            pass  <--------------------- retry once with error ---- fail
        |             |                                                        |
        |             v                                                        v
        |   sentences with placeholders  <----------------------   static template
        v
 browser fills exact values from FactSheet --> shown, with "simpler / more detail",
                                               helped / didn't, optional micro-check
        |
        v
 LEARNING LOOP (all on-device, in the vault)
   ExplanationEvent --> ConceptState (BKT) --> next projection (level, concept ids)
   engine events (salary, price rise, goal date) --> teachable-moment triggers
   OutcomeEvent vs user baseline --> local record --> [opt-in only] TelemetryReport
                                                       --> local-DP --> server counts
                                                       --> humans tune rules/catalogue
```

The server never receives the profile or the FactSheet's exact values. It
receives the bucketed projection and returns text with placeholders. This
extends the existing redaction boundary (`apps/server/src/agent/redaction.ts`,
`facts.ts`, `packages/core/src/redact.ts`); it does not replace it.

## 4. Decision 1: the explanation pipeline

### 4.1 FactSheet (engine output)
Defined with Effect Schema in `packages/core`, produced by the engine, never by
a model. Each fact has a stable id (`room_month`, `buffer_months`,
`goal_gap:<goalId>`), its exact value, a bucketed value for the prompt, a
polarity (`positive | negative | neutral` as the engine judges it), an optional
range (low, expected, high, with horizon and the single driving assumption),
a trend against the previous period, and a `mustMention` flag. Derived figures
(per year, per week, difference to last month) are computed by the engine as
their own facts. The model may not do arithmetic. The FactSheet schema already exists: it is built in the plan step (ship order: intake, plan with templates, this AI layer), and this spec consumes it.

### 4.2 Model and call
- Mistral, default the small current model (Small 4 per the models page, v26.03,
  VERIFIED in research). Constants stay in `apps/server/src/agent/models.ts`,
  the one place a model id may live. Escalate only the plan explanation to the
  medium model (Medium 3.5) if the human rubric (section 9) shows a gap on the
  golden set. No reasoning mode for prose: it adds cost and does not fix
  numeric faithfulness, which the validators do.
- Structured output using Mistral's custom structured outputs (VERIFIED to
  exist; strict-mode details and supported models UNVERIFIED, check the
  function-calling page).
- The output is a list of sentence objects: `{kind, factIds, polarity, text}`
  where `text` contains only `{{placeholders}}` for numbers and dates.
- `kind` is a closed enum: `fact | explanation | option_tradeoff |
  next_step_generic`. There is no `recommendation` kind, so the model has
  nowhere to put one. `next_step_generic` means a generic step the engine
  allows ("review the subscriptions list"), never an instrument or an amount.
- Lengths: digest 80-120 words, plan explanation 150-250 (chat is outside
  this pipeline, see 4.6). First sentence is the one number that matters and what it means.

### 4.3 Validation (server, all deterministic except the judge)
1. Schema parses; `kind` in the enum.
2. Every placeholder is in the allowlist built from the request's fact ids.
3. No digit sequence, currency amount, percentage or number word outside a
   placeholder (NL and EN regex), with a small whitelist tied to fact ids.
4. Every `mustMention` fact appears in at least one sentence.
5. Polarity: each sentence's declared polarity and fact ids must match the
   engine's polarity (a negative room never sits in a "you have room" sentence).
6. Advice-language blocklist, NL and EN: imperatives and modals aimed at
   instruments ("koop", "verkoop", "beleg in", "je zou ... moeten
   kopen/beleggen", "I recommend", "you should buy/invest/sell",
   "allocate N%"), ticker and ISIN patterns, a percentage next to
   "aandelen/equities/ETF". False positives go to the retry, not the user.
7. Readability gate on the stated level (sentence length, share of words outside
   a verifiable common-word list). Flesch-Douma coefficients are UNVERIFIED, so
   do not use that formula.
8. Small-model judge, temperature 0, binary: "does this text recommend a
   specific financial action on an instrument, product or allocation for this
   person?" It runs in parallel and can only block; it never rewrites. Measure
   recall on a labelled set (section 9) because a miss costs more than a block.

On any failure: one retry with the validator message appended. On a second
failure: the static, localised template for that task, always B1. Refusals
(the user asks "what should I buy") are static localised templates, never
generated: what LaVega can do, what it cannot, and a link to the AFM register.

### 4.4 Browser fill
The browser substitutes exact values from the local FactSheet, formatted for the
locale and the euro-conversion setting, then renders. Unfilled placeholders are
a hard error that falls back to the template; they are never shown.

### 4.5 Prompt layout and caching
Order, stable prefix first: (1) system prompt with the advice-line constitution
and style guide; (2) the per-tab instruction markdown already in
`apps/server/src/agent/prompts/` (`_base.md` is business-owner copy; rewriting it
for the personal audience belongs to this spec, while the intake's archive task
only removes instructions for archived tabs); (3) the output schema; (4) the
projection (section 10): bucketed FactSheet values, the concept ids to explain
now, and `readingLevel`; (5) the ids of the top three engine-computed changes
since the last explanation (they are facts in the projection, with their
bucketed trend). The projection holds no mastery values, no timestamps, no dates
of explained concepts and no free text. Feedback (helped, simpler, dismissed) is
applied in the browser: it changes `readingLevel` and the concept-id list before
the call, and is never sent. Use `prompt_cache_key` per task type with no user
data in the key; cached tokens bill at 10% (VERIFIED in the Mistral docs; cache
lifetime not stated). The digest is generated when the user opens the app and the
last digest is older than 7 days, as a normal call. The server holds no profile,
so nothing runs unattended and the 50% batch discount is not used; at the
research's token assumptions the cost stays well under EUR 0.05 per user per month.

### 4.6 Chat stays outside this pipeline
Chat keeps its current path: the conversations API with web search (card fees,
rates and point values come from there). Rule G1 (the model never produces a
number) applies to the digest, plan explanations and notes, not to chat. The
browser keeps sending the existing tab context for chat; no per-turn FactSheet
or chat task type exists. Chat output gets the NL and EN advice-language
blocklist (the single list in `packages/core/src/advice/language.ts`), and any
number from the web is shown with its source. Rebuilding chat onto the
placeholder pipeline is a later decision, made only if chat output fails the
human review.

## 5. Decision 2: personal style

- One reading level, `readingLevel`: `basic | intermediate | advanced` (NL copy
  labels: basis, gemiddeld, gevorderd). `basic` is B1 Dutch, short sentences, no
  jargon; `advanced` allows terms. The default comes from the intake
  `experience`: beginner gives `basic`, some gives `intermediate`, experienced
  gives `advanced`. B1 is also the default register for Dutch copy; government
  text is written at B1 (secondary sources, with the caveat that CEFR measures
  language proficiency, not text difficulty, so test with real readers).
- Every explanation has "simpler" and "more detail" controls. They regenerate
  at one level down or up for that explanation and are stored as feedback
  (section 6.4). Two or more "simpler" taps in a row on a concept lower the
  stored level for that concept, not globally.
- Uncertainty uses natural frequencies and ranges, never a bare percentage:
  "in 10 of 100 similar months your buffer would run out" (Gigerenzer and
  Hoffrage 1995, 1999; Frontiers in Psychology 2015 summary, VERIFIED via
  search summaries). The engine passes low, expected and high with the horizon;
  the text says "most likely between {{low}} and {{high}}" plus the single
  assumption. Plain-language verbal labels for ranges are UNVERIFIED guidance
  and are tested in the comprehension micro-check.
- Tone: calm, no scolding about spending, no urgency, no streaks.

## 6. Decision 3: per-user learning (stage 0, build now)

All of this lives on-device in the encrypted vault, in sections beside the
profile (intake 4.7): concept state is a new record in the `learning` section
(newest write wins per concept id), and `ExplanationEvent` and `OutcomeEvent`
are append-only records in the `events` section (unique ids, union merge across
devices, counters derived from the logs and never stored). Concept state is a new
record type; it is not a `LearnedFact`, and the free-text `LearnedFact` store
stays as it is.

### 6.1 Concept map
A versioned, hand-authored catalogue in `packages/core`, 40-80 concepts at full
size, about 25 at first: buffer, compound growth, costs and TER, diversification,
risk and return, inflation, box 3, schenkvrijstelling, points value,
subscription cost-per-use, and so on. Each concept has an id, NL and EN title,
prerequisites, one to three check items (3-option, with the correct answer and
the misconception each wrong option represents), and the engine events that make
it relevant. Content is reviewed for the advice line before it ships.

### 6.2 Mastery by Bayesian knowledge tracing
Per user and concept: P(known), with the four BKT parameters (prior, learn,
guess, slip) set by experts and held in one table. BKT works with one learner
and is inspectable (Corbett and Anderson 1995, citation details UNVERIFIED);
pooled calibration needs about 100-500 learners per skill, so it waits for
stage 1. Seeding from intake: the knowledge questions and `experience` set the
prior for the related concepts; concepts with no intake signal start at a
default prior of 0.3. Updates come from check items answered, "I know this"
self-ratings (weighted lower than a check), explanation feedback, and the
absence of "simpler" taps. Mastery informs which concepts the explanation may
skip defining and which it must define; it never gates features. The browser resolves mastery locally into the list of concept ids to explain now (define versus skip); the server never sees mastery.

### 6.3 Spaced re-exposure at teachable moments
A concept whose P(known) is below 0.8, or which was last shown more than its
interval ago (growing intervals, SM-2 style, specifics UNVERIFIED), becomes
due. Due concepts surface only when an engine event makes them relevant, as a
one-line contextual note, never as a flashcard chore. Triggers (the decision
points of a just-in-time adaptive intervention, Nahum-Shani et al. 2018,
VERIFIED): a salary arrives (room, buffer), a subscription price rises
(cost-per-use), a goal date is within 90 days (goal gap), a new recurring charge
appears, an import changes buffer months by a full month, a life event is
recorded. Rules: at most one note per day and three per week, a quiet period
after a dismissal, "stop this topic" in one tap, a global off switch. Notes show only when the app is open: there is no push, and the caps and quiet periods count app-open days.

### 6.4 Explanation feedback
`helped / didn't`, `simpler`, `more detail`, `too long`, and topic dismissal are
stored per user and per concept as `ExplanationEvent` rows (section 10). Counters
and suppression, not a model, drive adaptation at this size: dismissed twice
mutes the topic for 90 days.

### 6.5 Memory is structured, never transcripts
Memory is concept states, level preferences, explained-concept dates, dismissed
topics and the intake profile. Chat turns are not persisted beyond the session;
what survives is the concept touched and whether it helped. A raw-transcript
memory would carry sensitive text back through the redaction boundary and make
evaluation harder.

### 6.6 "What LaVega knows about you"
The intake page (intake spec 4.6) gains a learning section: each concept with
the mastery shown in words (new to you, getting there, known), last shown, the
reading level per concept, muted topics; edit, reset one concept, and reset all
learning with one action. It also shows the exact projection last sent to the
server, field by field (the "what the AI knows" pattern from the personalisation
research). Reset deletes the records, not just hides them.

## 7. Decision 4: event schema and reward spec (build now)

Even with few users, every shown item is logged locally with enough context that
learning is possible later. Fields are in section 10. Three rules fix the
design.

1. Propensity from day one. Every selection among alternatives records the
   probability it had of being chosen (1.0 while a rule decides) and the content
   version. Without it, off-policy evaluation is impossible later (Li, Chu,
   Langford, Schapire 2010, arXiv 1003.0146, VERIFIED, replay evaluation from
   randomised logs).
2. Reward is an outcome vector measured against the user's own baseline, never a
   population target (paying down debt is a worse savings rate and a better
   outcome):
   - buffer months (liquid savings over mean monthly fixed outflow), trend
   - monthly room realised against the room shown at the time
   - progress on the user's own goals against their own schedule
   - subscriptions cancelled by the user within 14 days of an insight about them
   - comprehension micro-check correctness
3. Guardrails: no increase in overdraft or late-fee incidents, no rise in
   opt-outs or muted topics, no rise in "this was stressful" feedback, no drop in
   comprehension. A guardrail breach pauses personalisation for that variant.
   Engagement (sessions, time in app, streaks, notification response) is never a
   reward term. It may be monitored as a guardrail only.

Goodhart is a design input, not an afterthought: "subscriptions cancelled" alone
would push cancelling useful ones, and "savings rate" would push under-spending
on essentials. That is why the reward is a vector with guardrails and why
attribution needs a holdout (a 5-10% random baseline) or micro-randomisation
before any causal claim. The reward spec and the banned-actions list (no
instrument names, no amounts, no exploration on debt or high-risk topics) are
written into a versioned file in the repo and reviewed with the lawyer (section
8), because they are also the document to show the AFM or an AI Act reviewer.

## 8. Decision 7: privacy and legal prerequisites before launch

These gate launch of the AI explanation features and of any telemetry.

- A DPIA. The Dutch AP list covers systematic monitoring of financial situation
  and profiling (list wording and the 16-versus-17 category count UNVERIFIED;
  an AP consultation on exemptions was reported in mid-2026 and is not final as
  far as the research found). LaVega's existing server processing probably
  triggers it already. The learning layer is a distinct processing activity in
  it.
- A Mistral DPA, the subprocessor list, EU hosting and zero-data-retention
  confirmed in writing. Third-party pages report 30-day rolling retention unless
  ZDR is granted on written request, and conflict on eligibility; all UNVERIFIED
  until Mistral's own terms are read. Until then the redaction boundary is the
  only control and the UI does not say "nothing is stored".
- A lawyer's opinion (Dutch financial regulation) on the advice line and on the
  AI Act, including whether investment-information chat falls under Annex III
  (UNVERIFIED), Art. 50 disclosure (tell users they are talking to AI) and
  Art. 4 AI literacy. The Digital Omnibus (reported as Regulation 2026/1744)
  moved some Annex III dates; the two sources disagree on details, so read the OJ
  text.
- The server holds no linking token (the telemetry token is not designed until stage 1, section 11). Telemetry reports carry no user id, no
  stable token and no IP (strip at the edge; Vercel log retention UNVERIFIED).
  Under CJEU EDPS v SRB (C-413/23 P, 4 Sept 2025, commentary only, check paras
  76-77 and 86) data is personal relative to the holder who can re-identify; a
  server with no key is in the best available position. The device-side
  operation is still processing and needs a legal basis: consent.
- Art. 22 GDPR is likely not triggered while the user decides and nothing acts
  on an account or gates a product by archetype. That is a design constraint
  here, not only a legal view.
- AI use is disclosed in the UI beside every generated explanation.
- Consent for telemetry is separate from AI-chat consent, default off, withdraw
  in one click (section 11).

## 9. Decision 6: evaluation

- 30-60 golden synthetic profiles generated from the engine (freelancer with
  irregular income, couple with a mortgage, negative room, zero data, high
  buffer, several currencies, student), times NL/EN, times three levels. Each
  fixture holds a FactSheet, expected must-mention facts, expected polarity and
  forbidden patterns. Expectations regenerate when the engine changes.
- Layer 1, CI-blocking and zero tolerance: every deterministic validator in 4.3
  run over recorded and fixed-seed outputs. CI fails if the fixtures' validator
  pass rate drops below 98% or any forbidden pattern passes. Tests assert
  properties, not strings.
- Layer 2, nightly and non-blocking until calibrated: a cross-family LLM judge
  (never Mistral judging Mistral), binary rubric items, pairwise order swapped,
  because judges show position, verbosity and self-enhancement bias (Zheng et al.
  2023, arXiv 2306.05685, VERIFIED via search). It gates nothing until Cohen's
  kappa against 100+ human-labelled NL/EN examples is agreed; the advice-line
  classifier needs the same set.
- Layer 3, human: the owner (Alexander) is the Dutch and English reviewer and scores 30 outputs per prompt change
  on five items (correct, understandable, right length, tone, no advice). This is
  the only ground truth for B1. Launch gate: 30 outputs per prompt change read
  and passed, zero advice-line failures, zero number mismatches.
- Live safety counters per prompt version on an internal dashboard: validator
  rejections, retries, judge blocks, template fallbacks. Store prompt version,
  FactSheet hash and validator result, never user text.
- Live helpfulness: the comprehension micro-check compared by prompt version,
  "simpler" tap rate, helped rate, goal or subscription action within 7 days
  (read next to the micro-check, since action is not the same as helped).
- Until stage 1, "optimisation" means offline prompt work on curated exemplars:
  the best-rated explanations per concept and level, chosen by hand and added
  to the prompt. DSPy-style automatic prompt optimisation (UNVERIFIED details)
  is a stage 1 option on a few hundred rated cases. The exemplars and approved
  outputs collected here are also the training set for stage 0b (section 11).

## 10. Data model

Field lists, to be written as Effect Schema in `packages/core` unless marked
server. All on-device records live in the vault (sections `profile`, `plan`,
`learning`, `events`, intake 4.7); none is sent as is.

FactSheet
- `id`, `taskType` (digest | plan | note), `locale`, `engineVersion`,
  `generatedAt`, `hash`
- `facts[]`: `factId`, `exact` (number or date, never sent), `bucket`
  (string range sent to the server), `unit`, `polarity`, `trend`, `range?`
  (low, expected, high, horizon, assumption), `mustMention`, `derivedFrom?`

ProfileProjection (what the server may see; this spec owns it)
- `locale`, `taskType`
- `facts[]`: fact ids with bucketed values only (ranges, counts, categories),
  polarity and bucketed trend
- `conceptIds[]`: concept ids to explain now (the define-versus-skip decision is
  made in the browser)
- `readingLevel`: ONE field, `basic | intermediate | advanced`, defaulting from
  `experience`
- Excluded by construction: mastery values, timestamps, dates of explained
  concepts, names, free text, counterparties, exact amounts, IBANs, the worries
  free-text field. Built field by field like `facts.ts`, never by copying an
  object.

ConceptState (a new record type in the `learning` vault section; not a `LearnedFact`)
- `conceptId`, `pKnown`, `bktVersion`, `lastShownAt`, `intervalDays`, `nextDueAt`,
  `levelOverride?`, `mutedUntil?`, `checksAnswered`, `checksCorrect`,
  `seededFrom` (intake item ids), `updatedAt`

ExplanationEvent (`events` section: append-only, unique ids, union merge)
- `id`, `at`, `taskType`, `contentVersion` (prompt version or template id),
  `catalogueItemId?`, `decisionPoint` (trigger type), `alternativesConsidered[]`,
  `propensity`, `policy` (rule | holdout | bandit), `level`, `usedFallback`,
  `retries`, `response` (none | helped | notHelped | simpler | moreDetail |
  tooLong | dismissed | muted), `microCheck?` (conceptId, correct), `followUpAsked`

OutcomeEvent (`events` section: append-only, unique ids, union merge)
- `id`, `at`, `baselineWindow`, `buffer` (before, after, months), `roomRealisedVsShown`,
  `goalProgress[]` (goalId, vs own schedule), `subscriptionsCancelled`,
  `linkedExplanationId?`, `guardrails` (overdraftIncidents, lateFees,
  optOutsSince, stressFeedback), `confounders[]` (income change, life event)

TelemetryReport (the only thing that may leave the device, and only with consent)
- `codebookVersion`, `archetypeId`, `insightId` (catalogue item), `outcome`
  (none | helped | acted), `quarter`
- No user id, no timestamp finer than the quarter, no amounts, no free text.
  Sent through k-ary randomised response (section 11). The payload preview shows
  the exact object before and after noise.

Server-side (stage 1): `telemetry_reports` rows holding the noisy fields above
plus a coarse received-at day; an aggregate table written by a scheduled job
after debiasing and the k release floor.

## 11. Decision 5: cross-user learning, staged by user count

Counts below are opted-in actives unless stated.

### Stage 0b (any user count): style fine-tune on approved examples
Owner decision, 23 Oct 2026. A small Mistral model is fine-tuned so its default
wording is LaVega's: plain Dutch and English at the three reading levels, the
placeholder format, and sentences that stay on the information side of the
advice line. It learns tone and format, not facts and not users.
- Training data contains no user data at all. Inputs are synthetic FactSheets
  (generated from the engine's own fixtures, every value invented) plus the
  ProfileProjection buckets; outputs are explanations the owner approved in the
  section 9 review loop or wrote by hand. No real transaction text, no real
  profile, no telemetry. This keeps it outside the "new purpose" problem below.
- Starts when there are at least 300 approved examples spread over every concept
  and all three reading levels (target 500), with at least 20% marked as
  near-misses that were corrected, so the model also sees the line.
- Ships only if, on the held-out golden set, the tuned model beats the base model
  with the curated-exemplar prompt: zero advice-language and zero number-mismatch
  failures (same gate as section 9), equal or better owner rating on 30 blind
  pairs, and a lower retry/fallback rate. Otherwise the prompt route stays.
- Nothing downstream changes: the same FactSheet, the same placeholders, the same
  validators and template fallback. The tuned model is a drop-in model id behind
  the existing proxy, with the base model as automatic fallback and a kill
  switch. Retrain only when the approved set grows by 50% or the concept map
  changes; each version is re-run on the golden set and logged with its data
  hash.
- Prerequisites: Mistral's fine-tuning offer, price, EU hosting of tuned
  weights and whether training data is retained (all UNVERIFIED, section 13);
  the DPA covers it. If Mistral cannot host a tuned model in the EU under ZDR,
  this stage waits; an open-weight Mistral model on EU hosting is the fallback
  and needs its own cost check.

### Stage 1 (about 100-1,000)
- Opt-in "Help improve LaVega": a separate, default-off toggle in Settings plus
  one non-blocking prompt after the user has seen value, equal-weight accept and
  decline, consent version and time stored in the vault. A "show me what would
  be sent" preview shows the real payload. Withdrawal is one click and stops
  sending at once. The privacy text states that already-sent noisy reports
  cannot be individually deleted because they are not linkable.
- Local DP by k-ary randomised response, epsilon about 2 per report (Apple
  publishes 2-4 per donation, VERIFIED, but its daily-replenishing budget was
  criticised as unbounded), a per-insight quarterly cap and a lifetime budget of
  about 2 tracked in the vault; the device stops sending when it is spent. Reading
  a per-insight rate to 5 points needs about 1,000 opted-in users (estimate).
- Server endpoint: no user id, no stable token, no IP, and a stuffing limit
  (poisoning is local DP's weak point). The token is not designed until stage 1;
  it must not use the session, per-IP limiting is the floor and blind-signed
  tokens are the option to evaluate then. A
  scheduled job debiases and writes aggregates only where k is at least 50
  reporting users per archetype-by-insight cell. A result changes product
  behaviour for everyone only at k of 200 or more. k-anonymity is a release rule
  layered on DP, never the privacy claim.
- Archetypes: a hand-authored, versioned codebook of 20-50 definitions built from
  public Dutch data (CBS, Nibud reference budgets) and computed locally from
  hand-built features (income regularity, fixed-cost share, buffer months,
  subscription count, savings transfers). Only the archetype id leaves the
  device, never the feature vector or an embedding. Archetypes select content
  topics only; they never rank people or tune persuasion.
- Humans read the aggregates and revise rules, thresholds, ordering and the
  content catalogue. Also in stage 1: calibrate BKT and item difficulty (IRT)
  from pooled answers, prune bad check items, offline prompt optimisation,
  non-contextual Thompson sampling or plain A/B on content variants with the
  holdout, and a short outcome survey at 0, 30 and 90 days.

### Stage 2 (about 1,000-20,000)
- Contextual bandits (LinUCB or Thompson, few features) only over presentation
  choices of a closed, pre-reviewed content catalogue: ordering, framing, depth,
  timing, channel. Never over instruments, amounts or high-harm topics. A bandit
  that learns "people who see fund X act more" would be advice by outcome, so the
  catalogue contains no product names.
- Propensities logged since day one. No policy ships before off-policy
  evaluation (inverse propensity and doubly robust estimators, replay) shows it
  beats the static ordering; the Open Bandit Pipeline is a candidate library
  (UNVERIFIED). Micro-randomised trials on proximal outcomes give causal estimates.
- Microsoft Personalizer was retired on 1 Oct 2026 (VERIFIED on the Azure
  announcement), so there is no managed bandit dependency. About 200 lines of
  Thompson sampling in TypeScript or Vowpal Wabbit (current state UNVERIFIED)
  is enough. Policy tables are computed server-side from DP counts and applied by
  the client locally.
- Central-DP k-means to refresh the codebook at 2,000+ opted-in users
  (research suggests 5,000 for the bandit trigger). External fairness and
  vulnerability review for Art. 5(1)(b) before the first learned policy ships.

### Stage 3 (20,000+), named, not designed
Learned ranker, privacy-engineered embeddings or federated analytics and
learning (Flower with ONNX or TF.js prototypes exist; Google's Gboard FL plus
DP-FTRL is the production reference, VERIFIED), sequence knowledge tracing
(Piech et al. 2015, arXiv 1506.05908), preference tuning. Each needs its own
spec, DPIA update and an independent manipulation audit. Embedding upload,
transaction-text upload and fine-tuning on user data are rejected outright.

No preference tuning (DPO) or fine-tuning on anything user-derived below about
10,000 users; stage 0b is not affected because it uses no user data. Preference learning needs
thousands of pairs and a hosting path, and its benefit over good prompts plus a
curated knowledge base is usually small for explanation tasks. Fine-tuning on
anything user-derived is also a new purpose needing its own basis, so if it ever
happens it uses synthetic or hand-written Dutch finance Q&A. Preference learning
must never optimise for agreeableness on risk tolerance.

### Trigger table

| Stage | Opted-in actives | Starts when | Needs before it starts | Stops or rolls back when |
|---|---|---|---|---|
| 0 | any | now | sections 6 and 7 built; DPIA, DPA/ZDR, lawyer opinion done for launch | any validator regression in CI |
| 0b | any | 300 approved examples across all concepts and levels | golden set, review loop, Mistral fine-tuning terms verified | golden-set regression; kill switch back to the base model |
| 1 | about 100-1,000 | consent flow built and counted users reach 100 | DP client, endpoint with no linking token, k floor, payload preview | lifetime epsilon spent for a user; guardrail breach |
| 1 reads | about 1,000 | opted-in reports pass 1,000 | debiasing job tested on synthetic data | k below 50 per cell: cell not released |
| 2 | about 1,000-20,000 | reports per arm reach hundreds, 10-20 arms | logged propensities, OPE shows gain, vulnerability review | guardrail breach pauses that arm; kill switch |
| 3 | 20,000+ | gain ceiling of stages 1-2 measured | new spec, DPIA update, audit | not applicable yet |

## 12. Decision 8: cost

Target: under EUR 0.05 per user per month. The research estimates about USD 0.02
on Small and about USD 0.29 on Medium per user per month with no caching or
batch (weekly digest, 4 plan explanations, 20 chat turns, a judge pass). Prices
are from third-party aggregators and UNVERIFIED until checked on
mistral.ai/pricing; cache reads at 10% are VERIFIED. The batch discount is not used (no unattended jobs).
Consequences: Small by default, the digest generated on app open when the last one is older than 7 days, the plan explanation
regenerated only when the FactSheet hash changes, a static prefix above about
1,000 tokens for caching, and the existing per-user spend budget (`budget.ts`,
`rateLimit.ts`) kept as abuse protection. Escalating the plan explanation to
Medium adds about USD 0.07 a month and stays inside the target.

## 13. Open items to verify

1. Mistral: DPA, EU hosting, ZDR and retention, structured-output strict mode,
   current prices.
2. Lawyer: advice line, AI Act Annex III and Art. 50, the "people with your
   profile usually" case (kept out).
3. DPIA: AP list wording, EDPB pseudonymisation text, C-413/23 P paras 76-77 and
   86, Vercel log retention; AI Act Art. 5 from the Official Journal.
4. BKT and spaced-repetition defaults, a Dutch readability formula (do not use
   Flesch-Douma until checked), a validated short stress scale.
5. The 1,000-user and epsilon-2 accuracy figures are estimates; Open Bandit
   Pipeline and Vowpal Wabbit current state.
6. Mistral fine-tuning (stage 0b): which models can be tuned, training and
   hosting price, EU hosting of tuned weights, retention of training files.

## 14. Left to the builder

- Screens: explanation controls, micro-check, the learning section, consent flow.
- Concept catalogue, check items and archetype codebook (with an advice-line reviewer).
- Regex lists, placeholder syntax, readability thresholds within 4.3.
- File locations, following the agent layout and Effect 4 (AGENTS.md); BKT, interval
  and trigger values in one tunable table.
- The first build order is suggested: fill (the FactSheet schema already exists from the plan step), validators and golden
  set, template fallback, model call, concept state and feedback, event log, then
  the learning page. Telemetry and the consent flow come after the launch
  prerequisites in section 8 are met.

## Decision log: calls made after the builder check (Claude's, owner to check)

All are folded into the sections above; this log only records them.

1. Digest generated on app open, not as a batch job (4.5, 12).
2. Chat keeps its current path (4.6).
3. No per-turn FactSheet for chat (4.6, 10).
4. Notes show only when the app is open; no push (6.3).
5. Telemetry token not designed until stage 1 (8, 11).
6. The owner is the human reviewer; launch gate in section 9.
7. This spec owns the ProfileProjection (10); intake 10.5 points here.
8. The projection stays narrow: bucketed facts, concept ids, one `readingLevel` (10).
9. Concept state is a new `learning` record, not a `LearnedFact` (6, 10).
10. Event logs merge by union in the `events` section (6, 10).
11. The `prompts/_base.md` rewrite belongs to this spec (4.5).
12. Stage 0b style fine-tune added at the owner's request (23 Oct); synthetic and
    approved data only (11).
12. The FactSheet is built in the plan step, before this layer (4.1).
