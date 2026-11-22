# Weekly self-refreshing product data — design

Date: 2026-11-21. Issue: #371. Follows the one card engine (#370, design in
`2026-11-21-one-card-engine-design.md`).

## Intent

Owner, 2026-11-21: "an engine that improves itself (weekly?) with the latest and
best rates, costs info per card, this will really become our proprietary data,
which as we saw wasn't easy to obtain".

Card and savings recommendations are the core value of LaVega. The figures behind
them were hard to get, so the catalogue is the asset. It must keep itself current
without weekly work from the owner, and one bad read must not move advice.

## What exists today (verified 2026-11-21 on `origin/master`)

- `docs/catalog/catalog.json`: 192 products, each with `fields` of
  `CatalogValue` (`value`, `route`, `sourceUrl`, `checkedAt`, `conditions`,
  `conditionsKnown`). Types in `packages/core/src/catalog.ts`.
- `docs/catalog/state.json`: the sweep's working notes per product (URLs, last
  value, last reason).
- `.github/workflows/catalog-sweep.yml`: Mondays, runs `pnpm catalog:sweep`
  (`scripts/catalog-sweep.ts`, 1383 lines) and commits both files straight to
  `master`. Last five runs green, about 90 seconds each.
- The sweep asks two questions only: `fxFeePct` and `interestPct`.
  `pointsPerEuro`, `cashbackPct` and `accountFee` were found by hand and are
  never re-checked.
- The workflow has no `ANTHROPIC_API_KEY`, so the model rungs (`wayback`,
  `agent`, search) never run in the weekly job. The code for them exists, with a
  spend ceiling (`CATALOG_MAX_USD`).
- Protections that exist: `mergeCatalogEntries` (`packages/core/src/catalogMerge.ts`)
  keeps a covered figure when a run returns an uncovered one, and keeps fields a
  run did not measure. The sweep refuses to write on a network blackout, on a
  model rung that never answered, and when all figures vanish at once.
- Not protected: the size of a change, the range of a value, whose page the
  figure came from. There is no change report.
- `checkedAt` is the date the _source_ states, else the sweep date. A 2023 tariff
  PDF that the sweep re-read last Monday still carries its 2023-era date. Nothing
  records "we confirmed this figure on date X".
- Measured on the catalogue of 2026-11-16: of 115 FX and interest figures, 103
  have `route: "agent"` (read by the model in hand-started runs). The free weekly
  run cannot re-read those; only 6 of the 115 match what the last weekly run
  read. So the weekly job today confirms almost nothing. By `checkedAt`, 22 FX
  and interest figures and 28 `accountFee` figures are older than 12 months.
- Consumers of the file: the server reads it at boot (`apps/server/src/catalogFile.ts`),
  the web app imports it at build (`apps/web/src/catalogue-rates.ts`), the
  extension bundles a subset at release (`apps/extension/scripts/bundle-catalog.ts`).
  The card engine is `packages/core/src/plan/cardAdvice.ts`.
- Measured 2026-11-21: a real free run (`--no-agent`) read zero covered figures
  out of 192 products (8 uncovered reads, 184 products with no figure). The
  catalogue was identical before and after (300 figures). So the Monday job
  changes nothing in the catalogue until the model rungs run, and the guard has
  nothing to judge until slice 2.
- A second job, `business-savings:watch`, compares Revolut Business pages with a
  hand-kept offer (`packages/core/src/businessSavings.ts`) and opens a GitHub
  issue. It never writes the repo.

## Decisions by the owner

1. **A changed figure goes live at once.** No approval step. (2026-11-21)
2. **Old figures:** a figure not confirmed for under 12 months stays in the
   ranking with its date shown; after 12 months the product drops out of the
   ranking until confirmed. (2026-11-21)
3. American Express consumer cards store cashback 0% as measured; the reward is
   points or Miles. (earlier, 2026-11-21)
4. Interest on spread payment is low priority: one optional field per card.
5. **Model for the sweep: Mistral or an open model, if possible.** (2026-11-21,
   his words: "use mitral or an open model if posisble".) He gave no reason;
   cost and independence from one supplier are the builder's reading.
6. This document approved by the owner on 2026-11-21.

The owner asked why the data would ever be wrong. The answer is in this repo:
a run once replaced ABN AMRO betaalpas 1,2% with the 2% of the credit-card row;
promo rates get read as standing rates (the Revolut Business 5,25% promo closed
and was removed in `e48cdc31`); pages change shape; a model read is good, not
perfect. So decision 1 is built as "live at once, when automatic checks pass".
He agreed to that form.

## Goals

- Every figure the product ranks on is re-checked weekly, for every field kind:
  FX fee, interest (savings and cash held at a broker), fee, points, cashback.
- A change that passes the automatic checks is live with the next deploy, no
  human in the loop.
- A change that fails a check is not published; the old figure stays.
- One weekly report says what changed, what was held back and what could not be
  reached, each with old value, new value and source.
- Promotional and conditional rates are data, not prose: rate, conditions, end
  date, who can get it.
- Business products are in the catalogue.

## Non-goals

- No approval flow, no admin screen.
- No markets other than the Netherlands.
- No move of the catalogue into Postgres (see Approaches).
- No investment recommendation. Interest on cash at a broker is a rate fact.

## Anti-goals

- A single bad parse changes what a user is advised.
- An unknown shown as zero, or an old figure shown as current.
- Work the owner must do every week for the data to stay fresh.
- A run that quietly spends more than its ceiling.

## Constraints

- Rules that stay: "unknown is never zero"; "a field a run did not measure is not
  refuted"; a run that could not do its work must not make the catalogue worse.
- The sweep stays outside the running app. The server reads the committed file
  at boot; the extension bundles it.
- New TypeScript logic follows ADR 0008 (Effect 4, `Schema` for untrusted input,
  `DateTime` for time). Existing sweep code is ported when touched, not in bulk.
- The model runs only in the sweep, under a hard dollar ceiling.
- Figures the owner quoted from memory (Trading 212 4,25%, Revolut Business
  5,25%) are leads, not data. Each needs a provider source, its conditions and a
  date before it enters the catalogue.

## Approaches

**1. Extend the existing sweep and the committed file (chosen).** The ladder,
the merge rules, the spend ceiling and the weekly job exist and work. Git gives
history, diff and one-command revert for free. What is missing is breadth
(fields, product kinds), guards and a report. Cost: the 1383-line script grows;
new logic must go into small pure modules next to `catalogMerge.ts`, not into
the script.

**2. Move the catalogue into Postgres with a history table.** Real queries and
per-figure history. But the server, the web app and the extension all read the
file today, a database write path needs its own review and rollback story, and
it adds nothing the owner asked for. Rejected for now; nothing here blocks it
later.

**3. Take figures from comparison sites.** Fast breadth. But it is not
proprietary, it carries terms-of-use risk, and it breaks the rule that a figure
comes from the provider's own document. Rejected.

The owner speaks in outcomes and left the how to the builder; approach 1 is the
builder's pick, not something he chose between.

## Design

### Order of work

Five slices, each one issue, each shipped and checked before the next
([one issue at a time]). The order is forced: guards before the model is switched
on, the model before breadth, breadth before new product shapes.

| #   | Slice                  | Result                                                                                                           |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Safety net             | Guards, `confirmedAt`, weekly report, age rule. Free sweep only. Built 2026-11-21 (not yet committed or merged). |
| 2   | Model on               | Key and ceiling in the weekly job; first measured paid run.                                                      |
| 3   | All fields             | Sweep asks fee, points and cashback too; JavaScript-only pages readable.                                         |
| 4   | Promos and broker cash | Promo shape in the data; Trading 212 interest on cash.                                                           |
| 5   | Business products      | Audience on each product; the Revolut watch folded in.                                                           |

### Slice 1 — safety net

**Publish guard.** A pure function in `packages/core`, applied per field after
the ladder and before the merge. Input: the current value, the found value, the
product, today's date. Output: publish, hold (with reason), or confirm. A found
value is published only when all hold:

- it is covered (`isCovered`), as today;
- its `sourceUrl` is on a host already known for that issuer, or is an archive
  snapshot of such a page. Known hosts are derived, not hand-kept: every host in
  `termsUrl`, `pdfUrl` and `foundUrl` of the issuer's products in `state.json`,
  plus every host of a `sourceUrl` the catalogue already holds for that issuer
  (32 of 115 current figures sit on a host outside their own product's URLs, so
  existing sources are accepted as they stand). A figure from a host never seen
  for that issuer is held and named in the report. `route: "comparison"` never
  publishes a change;
- it is inside the sane range for the field (builder's call, below);
- it is not a large jump. A large jump is held as _pending_ in `state.json` and
  published only if the next weekly run reads the same value again. So a real
  change of that size goes live one week late, and a one-off misread never goes
  live.

Sane ranges and jump limits (builder's call, tune from the first reports):

| Field                       | Range              | Large jump                                  |
| --------------------------- | ------------------ | ------------------------------------------- |
| `fxFeePct`, `convertFeePct` | 0 to 5             | more than 1 point, or to 0 from non-zero    |
| `interestPct`               | 0 to 10            | more than 1,5 points, or to 0 from non-zero |
| `cashbackPct`               | 0 to 10            | more than 1 point                           |
| `pointsPerEuro`             | 0 to 10            | more than double or less than half          |
| `accountFee`                | 0 to 1000 per year | more than double or less than half          |

A held change leaves the old figure in place. Nobody has to act on it.

The guard judges _changes_ only. Figures already in the catalogue are not
re-judged, so nothing is unpublished on the day slice 1 ships. A held field is
left out of the rows given to `mergeCatalogEntries` (which then keeps the old
value by its "not measured" rule); the guard's verdicts travel separately to
the report, so "held" and "not measured" stay distinct there.

**`confirmedAt`.** New optional field on `CatalogValue`: the last date a run read
this same value from the source. Set on publish and on every run that measures
the field and finds it unchanged. `checkedAt` keeps its meaning (the date the
source states). Values without `confirmedAt` fall back to `checkedAt`. No
backfill: a date nobody measured is not written. All schema changes in this
project are additive optional fields; the three consumers must keep reading a
file without them.

**Age rule.** One function in core, `today` as input: age is today minus
`confirmedAt`. Under 12 months: ranked, date shown to the user. 12 months or
more: the product is left out of the ranking for that field and shown as "not
confirmed", never as zero. Used by the option builders in `catalogRates.ts` and
by `computeCardAdvice`.

The removal part applies to a field only once the weekly sweep can measure that
field. Today it can measure almost none (see "What exists today"), so removal
on day one would drop 22 FX and interest figures and every American Express
card for a reason the product cannot fix yet. Staging:

- Slice 1: the function exists and the date is shown; removal is off for all
  fields.
- After the first full paid run of slice 2: removal on for `fxFeePct` and
  `interestPct`.
- Slice 3: removal on for points, cashback and fee.

(Builder's call. The owner approved the 12-month rule, not this staging.)

The age function runs where the figure is read (core, called by web, server and
extension), so a figure ages out without a new sweep or a new release. "Live at
once" means: committed to `master`, then live in the web app and server with
the deploy that commit triggers, and in the extension with its next release.
The builder checks that a commit pushed by the workflow does trigger the web
and server deploys; if it does not, slice 1 adds that trigger.

**Weekly report.** After the write, the job opens one GitHub issue (label
`catalog-report`) when there is something to say: published changes (old → new,
route, source link), held changes with reason, pending changes waiting for a
second read, fields that crossed the 12-month line, sources that failed, and
spend. Built by a pure function from the before and after catalogue plus the
guard results. A week with nothing to report opens no issue; the job log holds
the summary. The existing blackout guards still turn the run red. The sweep
job gains `issues: write`. The report step runs with `if: always()`: when the
run went red or the push failed, the issue says so and lists nothing as
published.

Commits stay direct to `master`, as today.

#### Built — what differs from this design

- `railway.json` now watches `docs/catalog/**`. Before, a sweep commit did not
  redeploy the server.
- Whether a workflow push triggers the Vercel web deploy is not verified. It can
  only be checked after the first Monday sweep commit following the merge.
- The "bad read is held" proof ran through `guardRun` on the real catalogue (ING
  betaalpas FX fee 1,4 read as 4,4 gives pending, old figure kept), not through a
  live sweep, because the free sweep reads no covered figure. The live path
  (guard, merge, `pending` saved in `state.json`) is first exercised in slice 2.
- The report issue is cleaned of markdown and mentions, because its text comes
  from scraped pages.
- Archive reads keep the snapshot date: `confirmedAt` is `checkedAt` for a web.archive.org read, never today; a confirm never moves it backwards.
- Known hosts include `docUrl`, are taken from the state at run start (not from sources found during the run), and `r.jina.ai/<url>` resolves to the host of `<url>`.
- A change in conditions is a change: same value with conditions null to text or text to null (or `conditionsKnown` flipped) is published, not confirmed.
- A second read counts only 6 or more days after the first (`MIN_DAYS_BETWEEN_READS`).
- The report states how much was checked ("Checked this run: N of M figures. K figures are older than 12 months."); "Not reachable" is now "No figure this run".
- Dates on screen: `catalogRates` shows the last-confirmed date; `apps/web/src/plan/heldCards.ts`, `statedCards.ts`, `CardsSection.tsx` and `apps/extension/src/lines.ts` still show `checkedAt`. Accepted for slice 1.

### Slice 2 — model on

Carried from slice 1:

- Gate before the key goes into the workflow: locally change one figure in
  `catalog.json` (ing-betaalpas `fxFeePct` to 2.4), run
  `pnpm catalog:sweep -- --only ing-betaalpas --summary-out <file>` with the key;
  expect verdict `pending`, `state.json` `pending["ing-betaalpas.fxFeePct"]`
  written, catalogue figure unchanged, report shows "Waiting". Fake `seenAt` to
  7 days earlier and run again; expect publish, `confirmedAt` set, pending
  cleared. Restore the files. A `--dry` run does not prove this: it never
  reaches the merge or the pending write.
- The `onFatal` partial save is never committed in CI, because the commit step
  is skipped when the sweep exits 1.
- Month-only dates such as `2026-01` (17 figures) count as always old in
  `catalogAge.ts`; handle them before the 12-month removal is switched on for
  any field.
- The billing-failure and budget-ceiling exits of the sweep write no run summary
  today, so the report would call a controlled stop a crash. Make them write a
  "refused" summary with the reason. The budget ceiling is the expected stop
  once the model is on.
- `scripts/` is not covered by the root `typecheck`. Add it, so type errors in
  the sweep fail CI instead of the Monday run.
- Consider letting an uncovered free read that equals the stored value count as
  a confirmation. It would let the free rungs keep `confirmedAt` fresh for the
  few figures they can read. Not decided.

- **Which model (owner decision 5).** The sweep calls Anthropic directly today
  (`@anthropic-ai/sdk`, tool-call replies parsed by `parseExtractReply` and
  `parseInterestReply`). Slice 2 puts the extraction call behind one small
  interface with the provider chosen by environment, then runs a bake-off
  before any weekly use: the figures the catalogue already holds as covered are
  the answer key; each candidate (a Mistral model first, then an open-weight
  model on a hosted API) reads the same stored documents and is scored on
  value, product-row choice and conditions. The cheapest candidate that makes
  no wrong-row error and matches the key at least as well as the current model
  is used. "If possible" is honoured literally: if no Mistral or open model
  passes, the sweep stays on Claude and the report of the bake-off says why.
  The model that reads a figure is recorded with the figure.
- The provider's API key as a repository secret (`MISTRAL_API_KEY` or the
  chosen host's key; `ANTHROPIC_API_KEY` only if the bake-off falls back),
  passed only to the sweep step. The owner adds it; the builder cannot. Slice 1 does not need it. Work stops
  after slice 1 until the key and the ceiling exist; slices 3 to 5 depend on
  the model rungs and are not started on the free sweep.
- `CATALOG_MAX_USD` set in the workflow. Cost of a full run is unknown: an
  earlier 81-product run came in 2,8 times over its estimate. So: one manual
  run with a ceiling of $15, read the spend lines, then set the weekly ceiling
  at about 1,5 times the measured cost. The owner confirms the weekly figure.
- Model ids and prices in the script's price table are checked against the
  chosen provider's current documentation before the first paid run; the spend
  ceiling must count that provider's usage numbers.
- The model re-reads only what the free rungs could not settle, as the ladder
  already does. Discovery search (`--search`) stays off in the weekly job; it
  is run by hand when a source is lost.
- The workflow timeout (45 minutes) is re-checked against the model rungs.

### Slice 3 — all fields

- The sweep asks every field a product kind carries: credit cards get fee,
  points, cashback and FX; savings get interest; accounts and packages get
  `accountFee`. One extraction call per document returns all fields for the
  product, not one call per field.
- The annual card fee: the catalogue holds `accountFee`; whether a card's yearly
  fee uses that field or a new one is the builder's call after reading how
  `computeCardAdvice` reads fees today.
- Pages that are JavaScript shells (American Express): a rendered fetch in the
  job (headless browser) as a new rung between `provider-pdf` and `wayback`.
  Builder's call on the tool.
- Known holes to close: ING Creditcard More and Extra package price, ING
  Platinumcard points, bunq credit card fee, American Express fee and points.
- Optional field for spread-payment interest per card. Low priority; last.
- The 12-month removal switches on for points, cashback and fee.

### Slice 4 — promos and broker cash

- A promotional rate is a structured part of the value: the promo rate, the
  standing rate after it, end date or duration, balance cap, plan tier. The
  shape of `BusinessSavingsOffer` in `businessSavings.ts` is the starting point.
- The engine ranks on what the user would really get: the promo while it runs,
  the standing rate after its end date. A promo past its end date is dropped by
  the age function without a sweep having to notice.
- `trading-212-interest-on-cash` and `trading-212-beleggingsrekening` get
  sourced figures. Cash at a broker is shown as a rate option with its
  conditions (not a bank deposit; protection differs); wording follows the
  existing savings-benchmark notes in `catalogRates.ts`.

### Slice 5 — business products

- Each product carries an audience: personal or business. The engine shows
  business products only to a user who has a business account connected or says
  they have a company. (Builder's call; the owner has not been asked how business
  users are recognised.)
- `business-savings:watch` and its hand-kept offer move into the catalogue and
  the sweep; the separate job is deleted when the sweep covers the same pages.

## Left to the builder

- Module layout of the guard, age and report functions; test layout.
- Exact ranges and jump limits (table above is a start).
- Headless-browser tool for rendered pages.
- Report wording and whether pending items repeat weekly.
- How far to port touched sweep code to Effect in each slice.

## Docs to update as slices land

`docs/catalog/watchlist.md`, issue #371 (one summary per slice), and this file
when a decision changes.
