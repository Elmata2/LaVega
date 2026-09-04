# THE ENDGOAL

**A live catalogue of every money product a Dutch person can use, with — for each one — a value, the
source it came from, the date it was true, and the conditions attached to it. Refreshed on a
schedule. Feeding every agent in the app.**

That is the whole thing. When it exists, the answers Alexander wants become arithmetic:

> "Je gaat naar de VS. Zet je geld op Trading 212 (3,5% in plaats van 1,5% bij ING), wissel bij Wise,
> en betaal met Revolut — 0% tot € 1.000 deze maand, daarna is ING goedkoper."

Every one of those clauses is a lookup against the catalogue plus his own balances. None of it needs
a new agent, a new screen, or a new idea. It needs the table.

**Done means all four parts, for all 124 products, not three parts for most of them:**

| Part           | Why it is not optional                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **value**      | Obviously                                                                                                 |
| **source**     | A number without a source is a rumour and cannot be checked                                               |
| **date**       | We shipped a figure from January under today's date. Twice                                                |
| **conditions** | 104 of 124 rates are conditional. Revolut's 0% ranked first on a rate that expires € 1.000 into the month |

A product with a rate and no conditions is **not covered**. That is the definition that keeps 99%
from being a lie, and it is the one most likely to be dropped when the deadline gets close.

**What it unlocks, in order:** the travel agent stops being limited to products he owns · the cashback
agent gets its "switch" half back · the savings comparison extends past geld.nl's gaps · referral and
signup bonuses become a fourth column nobody has today.

---

# Getting the catalogue to 99% — design

**The ask:** 99% coverage of every card and account a Dutch person can use. The sweep found **124
products**; 99% means at most one or two left unanswered.

It is reachable. But it is only an honest number if "covered" is defined before we chase it, because
two of these products will never have a primary source.

## What "covered" has to mean

A figure is **covered** when we hold a value, the source it came from, and the date it was true.
Three parts, not one. A number without a source is a rumour, and a number without a date was our bug
twice this week.

Two metrics, both reported, because one alone misleads:

- **Coverage** — how many products have a figure at all. This is the 99% target.
- **Coverage by tier** — how many of those come from the provider's own page versus a comparison
  table versus a model that searched. 99% coverage that is half model-derived is a different product
  from 99% primary, and a single number would hide that.

And a third, which his own objection this week demands: **currency**. A figure from January is
covered and stale. Each field gets an age budget by how fast it actually moves — FX markups shift
about yearly, savings rates monthly, promotions weekly. Past its budget a figure stays visible and
is marked overdue; it is never silently dropped or silently trusted.

## The route ladder

Per product, tried in order, first success wins, the tier recorded with the value.

| #   | Route                                                                         | Cost            | Measured today                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Provider's own page, plain fetch + browser UA                                 | ~free           | **101 of 124 products** across 82 URLs                                                                                                                                                                         |
| 1b  | **The provider's own PDF** — tariff sheet, cardmember agreement, fee document | ~free           | **The route nobody looked for, and it dissolves both ceilings.** See "Corrections" below                                                                                                                       |
| 2   | Provider's own page via the **Wayback Machine**                               | ~free           | **Proved on Rabobank**: the page that 403s us served 437 kB with a real table — `betaalpas 1,4% koersopslag`, `creditcard 2%`, and the withdrawal rows bank.nl folds away. Snapshots are dated by construction |
| 3   | **Headless browser in CI**                                                    | free CI minutes | For pages whose numbers arrive by JavaScript. Unproven for our cases — see the open question                                                                                                                   |
| 4   | Neutral comparison table (bank.nl)                                            | ~free           | 12 rows, 7 banks, debit and credit apart, self-dated                                                                                                                                                           |
| 5   | **Agent + web search**                                                        | tokens          | Measured accurate: Revolut 0%, ING 1,4%, ING creditcard 2%, ABN 1,2% and 2%, Trading 212 0%, and it corrected bank.nl on Knab                                                                                  |
| 6   | Unknown, with the reason named                                                | —               | The honest floor                                                                                                                                                                                               |

Route 3 belongs in **GitHub Actions on a schedule**, not in n8n or a Worker: the runner already has a
browser, the minutes are free, and the output is a commit — so every changed figure arrives as a
reviewable diff. That is the same discipline as the competitor tracker's `state.json`, which is where
this whole approach comes from.

## The two ceilings — REMOVED 2026-08-18, see Corrections

The section below is kept as written because the reasoning was sound and the conclusion was wrong,
which is worth being able to re-read. Both ceilings were dissolved by a route neither of us had
tried: the provider's own PDF.

## The two ceilings, measured rather than assumed (SUPERSEDED)

**ING has no primary route at any tier.** `ing.nl` refuses at the network layer on HTTP/2 _and_
HTTP/1.1; a browser User-Agent does not help; there is no ICS backdoor (`icscards.nl/ing` is a
measured 404); and the Wayback CDX index holds snapshots from **2010** with nothing for the current
URLs. ING is route 5 or 6, permanently, unless they change their edge rules. Its figures today rest
entirely on bank.nl, stamped seven months ago.

**American Express publishes no FX markup in HTML anywhere.** Zero hits for _koersopslag_,
_wisselkoers_, _valuta_ or _buitenland_ across all eight consumer pages; the two FX pages are
byte-identical with a JS-loaded table that returned a literal placeholder. A headless browser may
render it. That is the single most valuable thing route 3 could prove, and it is not yet proved.

So 99% is reachable **only if routes 5 and 6 are respectable outcomes**, shown on screen as what they
are. Chasing 99% primary would mean scraping affiliate sites, and that trade was already refused for
good reason.

## The harder half nobody counts: conditions

**104 of 124 products have a conditional headline rate** — staking, a paid tier, a package, a promo
window, a monthly cap. Trading 212's 1,5% needs Cashback Reinvest _and_ an active subscription.
Crypto cards want a token locked for months.

Coverage of the _number_ is much easier than coverage of the _condition_, and a catalogue at 99% on
numbers and 60% on conditions would be **more** misleading than one at 80% on both — because the
missing condition is invisible while the missing number is not.

So the 99% target applies to `{value, source, date, conditions}` as a unit. A product whose rate we
know but whose conditions we do not is **not covered**. This is the requirement most likely to be
quietly dropped under time pressure, which is why it is stated here.

## Change detection, not re-derivation

Copied from the competitor tracker because it already works: the sweep compares against
`docs/catalog/state.json` and reports **what changed**. A new value replaces an old one only with a
source; otherwise it is a delta for review. Nothing is silently overwritten, and the owner's own
correction still wins over every tier — that rule is already enforced in `upsertFacts`.

## Cadence

Weekly full sweep, daily on the volatile subset. Routes 1, 2 and 4 cost effectively nothing and can
run daily in full. Route 5 is the only one that costs real money, and it covers about five products.

## Open questions

1. **Does a headless browser actually rescue the JS-rendered pages?** Amex is the test case. Worth
   one spike before building route 3, since it decides whether Amex is covered or permanently
   agent-derived.
2. **Do the EU-mandated Fee Information Documents help?** The Payment Accounts Directive requires a
   standardised fee document per payment account. Two guessed URLs failed today (ING timed out,
   Rabobank 403) — but a standardised, legally required document would be a better source than any
   marketing page, and it has not been searched for properly.
3. **Raisin's 19 partner banks** were verified on one and assumed for the other 18. Either verify or
   drop the assumption from the watchlist.

---

# Corrections — 2026-08-18, after the spikes

Three probes ran: a headless browser, the EU fee documents, and whether conditions are extractable.
Each finding below was re-verified by hand before being written here.

## Both ceilings were an error of mine, and the same error twice

**ING is not agent-only.** Its tariff sheet is a PDF on `assets.ing.com` — a different host with no
edge protection. Verified with **no User-Agent at all**: HTTP 200, 174.665 bytes, carrying
`koersopslag niet-euro 1,40%`, `Vreemde valuta opnemen € 3,50 + 1,40% koersopslag`, and the
credit-card tiering **with its conditions**: `ING Studenten Creditcard More — in vreemde valuta tot
€ 500 per creditcardperiode 0,00%, boven € 500 2,00%`. The Wayback index shows that asset URL
serving 200 since February 2024, so discovery is one-off and refresh is a plain curl.

**American Express is not agent-only either.** The markup is in the Cardmember Agreement PDF, plain
curl, HTTP 200: `2.6. Transactie in vreemde valuta — Wisselkoersopslag op het omgewisselde bedrag in
euro. 2,5%`. The earlier sweep grepped marketing HTML for "koersopslag" instead of following the
legal-documents index into a PDF.

The mistake in both cases was the same: **I tested the HTML host and concluded about the bank.** A
network-level block on `ing.nl` says nothing about `assets.ing.com`. Generalising from one URL to a
whole provider is now the third recurring error of this project, after counting CSS percent-signs as
tariffs and dating a figure by when we received it.

**So the routing rule changes:** before declaring a provider unreachable, look for its PDF. Tariff
sheets, cardmember agreements and fee documents are legally required, live on unprotected asset
hosts, are stable across editions, and carry the conditions as well as the rates — which is the half
that is otherwise hardest to get.

## A live wrong number in the product: Revolut is not 0%

The per-plan pages state that 0% applies only inside a monthly limit:

> Standard: wissellimiet €1.000 per maand, daarna **1%** fair-usage · Plus: €3.000, daarna **0,5%** ·
> Premium, Metal, Ultra: geen limiet

LaVega currently holds `Revolut betaalpas — fxFeePct 0` and the travel agent ranks it top on that.
For a traveller spending more than €1.000 in a month, **that recommendation is wrong**, and it is
wrong in the most damaging direction: a conditional rate presented as unconditional. This is exactly
what the `conditions` field exists to prevent, and it is now a concrete reason to land it rather than
a theoretical one.

## Headless is not the same as a browser

Measured on the same machine, same URLs:

|                                  | Cloudflare (Revolut)                             | ING html host            |
| -------------------------------- | ------------------------------------------------ | ------------------------ |
| curl + browser UA                | 403                                              | connection killed        |
| **headless** Chrome / Playwright | **403 — parks on the challenge, never resolves** | ERR_HTTP2_PROTOCOL_ERROR |
| **headed** real Chrome           | **200, real page**                               | 200, renders             |

So "use a browser" is not one option, it is two, and only the visible one gets through — which is
awkward to schedule and should not be assumed away. Since ING is now solved by its PDF, the only
thing still wanting a headed browser is Revolut, and its per-plan pages may yet have a PDF too.

**A trap for any future browser scraper:** ING's pages are 95 shadow roots deep.
`document.body.innerText` returns 0 characters while a shadow-DOM-traversing walk returns 28–34k. A
scraper reading `innerText` or raw HTML will call the page empty and be wrong.

## Smaller corrections

- ABN AMRO's tariff **index** is a link hub, not a JS-hidden table — the browser proved there is
  nothing there to render. Its sibling pages carry the real tables.
- ABN AMRO Direct Sparen was listed unreadable; it reads by plain curl at
  `/nl/prive/rente/actuele-rente.html` (58 percentage figures). The watchlist URL had gone stale and
  now 302s to a marketing page — the same stale-URL class as the Amex 404.
