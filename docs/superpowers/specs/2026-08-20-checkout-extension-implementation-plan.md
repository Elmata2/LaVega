# The checkout extension — implementation plan

Review-3 item **13**: *"make already an implementation plan on how you would make that extension, also
based on all the learns we've had."*

This builds on **`docs/BACKLOG.md` § "Idea 2026-08-19 — a browser extension that spends the points you
already have"**, which already settled the posture. I do not restate those four rules; I take them as
given and say what has changed since, what I measured today, and what it costs to build each way.

Nothing here is implemented. No production file was touched.

---

## The recommendation, first

**Build Option A — public data only, no login, and re-scope it.** Ship it as *"Aan de kassa"*: at a
checkout page, rank **his own cards** by what this purchase actually costs on each, out of the
bundled catalogue. Merchant offers are a labelled second line, not the headline.

Two things drive that, and the second is new today.

1. **Two of the three premises the 19-August note was waiting on have already been met.** The note
   said *"the honest state today is 20 of 124 covered"* and concluded the extension *"waits on
   coverage"*. Coverage is now **73 of 82 card products** for FX, 51 points, 31 savings, 8 cashback —
   and after the merge in `2026-08-20-catalog-fx-gaps-and-ing-punten-data.md`, **79 of 82** for FX.
   The wait is over. The catalogue is the extension's whole answer and it is now dense enough that
   "onbekend" is the exception, not the rule.

2. **I re-measured Klarna today and the premise does not survive.** The brief says public data carries
   it *"alleen voor Klarna (percentage per winkel, plain curl)"*. The percentages are real and I
   reproduced them. But Klarna's own footnote says the cashback is earned **only on purchases made in
   the Klarna app**, requires an active Klarna-saldo, and is not guaranteed even then. An extension
   that fires in his browser cannot deliver it. Detail and quotes in §3.2. This is the measurement
   that decides the plan: the one public offer dataset we have describes a benefit that **does not
   exist on the page the extension is standing on.**

So the thing worth building is not a coupon finder. It is the travel agent's *"pay with Revolut, that
saves you € 14 on a thousand"* logic, moved to the moment of a real purchase — which is the thing he
actually asked for, and the only version whose numbers we can prove.

---

## 1. What already exists, so this is a surface and not a rewrite

Measured, not assumed — every path below was read this session.

| Piece | Where | What it already does |
|---|---|---|
| The catalogue, bundled | `docs/catalog/catalog.json`, imported as a static module by `apps/web/src/catalogue-rates.ts`, `views/Valuta.tsx`, `components/blocks/TravelBlock.tsx` | 122 products, each figure carrying `value` + `sourceUrl` + `checkedAt` + `conditions` |
| Ranking by FX cost | `packages/core/src/catalogRates.ts` → `marketFxOptions`, `fxSwitchGain` | cheapest-first list; `fxSwitchGain` returns **null** when his own rate is unknown, on purpose |
| Ranking by cashback | same file → `marketCashbackOptions`, `cashbackSwitchGain` | best-first; a proven 0% is kept as a *fact* but excluded from *offers* |
| Ambiguity without a question | same file → `issuerConsensus` | "American Express / activity" → 2,5% because all 13 Amex products agree; returns null the moment they don't |
| Pricing one purchase | `packages/core/src/travel.ts` → `bestPayAdvice`, `rankSpendOptions`, `payHeadline`, `costOnReferenceSpend` | already prices a payment across FX surcharge and cashback and produces the sentence |
| What a card returns on a spend | `packages/core/src/returns.ts` → `annualSpendCents`, `accountReturns`, `optimiseReturns` | with `SpendKind` already modelled as `exact` / `upper-bound` / `unknown` |
| Sweep-time bundling, shipped | `scripts/bundle-bank-logos.ts` → `apps/web/src/assets/bank-logos.generated.ts` (44 kB of data-URIs) + `TRADEMARKS.md` | the pattern review-3 item 12 endorses, already running: fetched during the sweep, embedded, **nothing fetched in the browser** |

**The extension writes no ranking logic.** It writes a content script, a message channel, and a
popup. Everything numeric is a call into `@lavega/core`. That is the single biggest reason to prefer
the small version: the expensive, tested, honest part is done.

`bank-logos.generated.ts` deserves a specific mention, because it is the answer to the objection he
overruled in review-3 item 12, and it is already in the tree. Its header states the rule in the
repo's own words: *"Elk logo is tijdens een SWEEP bij de aanbieder zelf opgehaald en hier als
data-URI neergelegd. In de browser wordt er dus niets opgehaald."* Whatever the extension needs to
show — a card face, a merchant mark, a flag — goes through that door or it does not ship.

---

## 2. What the posture adds for an extension specifically

The BACKLOG rules stand. Three extra constraints fall out of the fact that this is an *extension*
rather than a tab, and they are not in the 19-August note:

**2a. A Manifest V3 host permission is a standing capability, not a one-time read.** `activeTab` is
granted per user gesture and dies with the tab; a `host_permissions` match pattern is permanent and
silent. The extension therefore uses **`activeTab` + `optional_host_permissions`**, and never a
static match list. He clicks the toolbar icon on a checkout page; that click is the consent. This
also makes "opt-in per site, off by default" a *browser-enforced* property rather than a promise our
code keeps.

**2b. The extension must not be able to read the vault even if it wanted to.** The channel is
`window.postMessage` to an open LaVega tab (or `externally_connectable` to the app origin), and the
request/response shape is fixed and tiny:

```
extension → LaVega tab : { kind: "quote", merchant: string, currency: string, amountCents: number }
LaVega tab → extension : { rows: [ { product, costCents, netPct, sourceUrl, asOf, note } ],
                            unknowns: [ { product, why } ] }
```

The tab computes; the extension renders. No balances, no IBANs, no transaction text, no account keys
cross that boundary — the same redaction discipline as the LLM proxy, applied to our own surface.
The extension stores nothing between page loads.

**2c. `packages/core` stays pure, so the amount and the date both come from the caller.** The
extension reads a date off nothing; the tab passes `asOf`. No `Date.now()`, no `new Date()`, no fetch
anywhere in the new core code — same as the rest of the package.

---

## 3. What I measured today

### 3.1 Amex Offers — clean negative, reconfirmed

Four NL paths, browser UA, following redirects:

```
https://www.americanexpress.com/nl-nl/aanbiedingen/           → 404
https://www.americanexpress.com/nl-nl/benefits/amex-offers/    → 404
https://www.americanexpress.com/nl-nl/offers/                  → 404
https://www.americanexpress.com/nl-nl/kaarten/aanbiedingen/    → 404
```

Amex Offers is not a public NL surface. It is behind the cardholder login or it is not in this
market. This is settled; it is the strongest argument that Option B is the only route to
merchant-level offers, and also the reason Option B is expensive (§5).

### 3.2 Klarna — the percentages are real, and they are **not spendable in the browser**

`https://www.klarna.com/nl/cashback/` → **200, plain curl, browser UA, 802 909 bytes, no render**.
Per-store percentages sit in the served HTML in `data-slot` spans. Extracted with a plain regex,
today:

| store | tag, verbatim |
|---|---|
| Zalando | `8,5% cashback in de app` |
| About You | `10,5% cashback in de app` |
| H&M | `7% cashback in de app` |
| Temu | `7% cashback in de app` |
| ICI PARIS XL | `7% cashback in de app` |
| Startselect | `7% cashback in de app` |
| JD Sports | `5% cashback in de app` |
| Adidas | `5% cashback in de app` |
| Nike | `3,5% cashback in de app` |
| MediaMarkt | `3% cashback in de app` |
| Aliexpress | `3% cashback in de app` |
| Samsung | `2% cashback in de app` |

12 stores, 12 `store-name` slots, 12 `store-tag` slots — exact, not sampled. **The brief says 29
direct and 218 with a render; on this URL today I get 12.** I am reporting what I measured rather than
repeating the brief. The 29 may be a different Klarna surface; if so, someone should say which,
because it is not this one.

**Now the part that decides the plan.** Every single tag ends in *"in de app"*, and Klarna's own
footnote spells out why, verbatim:

> Verdien cashback op aankopen via de Klarna App. Een Klarna-saldo account is vereist om cashback te
> ontvangen. De uitgifte van cashback is afhankelijk van goedkeuring door de winkel en kan worden
> beïnvloed door cookie-instellingen, het combineren van aanbiedingen, productuitsluitingen of andere
> factoren waar wij geen invloed op hebben.

and, from the same page:

> Cashback verdien je als punten wanneer je shopt met Klarna. Je kunt cashback verdienen op
> geselecteerde aankopen in de Klarna-app, en met een lidmaatschap kun je ook cashback verdienen op
> alle betaalpasaankopen met de Klarna Card of wanneer je Betaal nu gebruikt met je Klarna-saldo.

So: earned in the Klarna app, not in the browser. Requires an active Klarna-saldo. Amount subject to
merchant approval, cookie state and offer stacking. Some tiers only with a paid membership. And it
lands as **points**, convertible to Klarna-saldo — not as money in his bank.

Three house rules bite at once. *"Beweer geen conclusie die een afwezigheid niet kan dragen"* — a
headline "8,5% terug bij Zalando" on a Zalando checkout page would be a claim the page cannot
deliver. *"Een melding moet nooit advies geven dat niet kan werken in de staat waarin het
verschijnt"* — telling him to abandon a filled basket and start over in a phone app is advice that
does not work where it appears. And *"onbekend is nooit een vergelijking"* — an offer that depends on
merchant approval is not a number you can put next to a proven 2,5% surcharge and subtract.

**What Klarna is still good for:** a labelled, honest second line. *"Klarna geeft hier 8,5% — maar
alleen als je in de Klarna-app afrekent, met een Klarna-saldo, en de winkel moet het goedkeuren."*
That is true, it is sourced, it is dated, and it does not pretend to be part of the sum.

### 3.3 Trading 212 merchant offers — unusable, as recorded

Carried from the brief without re-measurement: T212 has merchant offers that are unusable for him.
Flagged as **not verified by me**; it does not affect the recommendation either way, because both
options treat merchant offers as a second line.

---

## 4. The two options

### Option A — public data only

**What it is.** Manifest V3 extension. Content script extracts **merchant host + total + currency**
from the checkout page and nothing else. Messages the open LaVega tab. Popup shows his cards ranked
by what this purchase costs on each, from the bundled catalogue, each row carrying its source date.
Bundled Klarna per-store percentages appear as a labelled aside where the host matches.

**What he gets.** At a €300 checkout in USD, a ranked list: *"Revolut Metal — € 300,00, 0%
(revolut.com, 9 juli 2026). ING betaalpas — € 304,20, 1,40% koersopslag (assets.ing.com, 15 juni
2023). Verschil: € 4,20."* Domestic EUR purchases rank on cashback instead, from
`marketCashbackOptions`. Where a card's figure is unproven, the row says **onbekend** and is not
ranked — never a zero, never a default.

**Cost.** Small. Six slices, §6. No new ranking logic — `bestPayAdvice`, `marketFxOptions`,
`fxSwitchGain`, `issuerConsensus`, `marketCashbackOptions` all already exist and are tested. New
code is a merchant-and-amount reader, a message channel, a popup, and one build script that bundles
the Klarna table the way `bundle-bank-logos.ts` bundles logos.

**Risks, honestly.**
- *Reading the total off arbitrary checkouts is the hard part, not the maths.* There is no standard.
  Realistic first pass: `<meta itemprop="price">` / JSON-LD `Offer.price` / `Order.total`, plus a
  currency from the same block. On a page that exposes none of those, the extension must say *"ik kan
  het bedrag hier niet lezen"* and offer a manual amount box — it must not guess a number off the
  largest euro string on the page. A wrong amount silently produces a wrong recommendation, which is
  worse than no recommendation.
- *Merchant coverage is thin.* 12 Klarna stores, all consumer retail. For most checkouts the aside
  is simply absent, which is fine — the card ranking is the product.
- *Catalogue staleness shows up at a worse moment.* A 2023 ING date is tolerable in a tab and
  awkward at a till. Mitigation: every row already prints its date, and `card-terms-freshness-design`
  already exists for this.

### Option B — behind his own login

**What it is.** The extension, or a companion, authenticates as him at Amex / Klarna / issuer portals
and reads his personal offer list — the only place NL merchant offers demonstrably live (§3.1).

**What he gets.** Real, targeted, personal offers. Materially better content than Option A can ever
show.

**Cost.** Large, and most of it is not code.
- Broad `host_permissions` on his bank and card domains, permanently. That is the opposite of §2a.
- The extension is now inside an authenticated banking session. Every bug in it is a bug with his
  logged-in Amex account. Scraping a portal is also, on most issuer terms, a breach — and the
  read-only/no-PIS posture in `docs/CONTEXT.md` exists precisely to stay out of that class of
  question.
- Selectors against a logged-in portal break silently and often, and each break is invisible until a
  recommendation is quietly wrong.
- It defeats the property he has been sold: nothing is fetched at runtime. Reading an offer list at
  checkout **is** a runtime fetch, and it tells that server what he is looking at.

**Risks.** Session compromise, terms breach, silent breakage, and the loss of the one claim that
makes LaVega different. Also: Amex's four 404s mean there is no stable public contract to build
against, so this is scraping a moving target forever.

### The comparison in one line each

| | Option A | Option B |
|---|---|---|
| Data | bundled catalogue (79/82 FX) + 12 Klarna stores | his personal offer lists |
| Runtime network | **none** | required, per checkout |
| Permissions | `activeTab` + optional hosts | standing host permissions on bank domains |
| Touches his sessions | no | yes |
| Breaks when a site redesigns | the amount reader | everything |
| Answer quality | proven, dated, narrow | rich, unverifiable, fragile |
| Build size | small | large, and never finished |

**Recommended: A.** B is not a later phase of A — it is a different product with a different risk
posture, and it should not be started by accident.

---

## 5. What would change the recommendation

Written down so the decision is reversible on evidence rather than on mood.

- **A public, dated, per-merchant offer feed for a card he actually holds.** Not Klarna's
  in-app-only table — something spendable in a browser. That would make the aside a headline.
- **The Klarna "29 direct / 218 rendered" figure being reproduced on a named URL** where the offer is
  *not* app-only. Then Option A's merchant half becomes real and worth its own slice.
- **His own call that a Klarna-app detour is worth surfacing at the till.** *Een feit van de gebruiker
  gaat boven elke agent* — if he says he will genuinely switch to the Klarna app for 8,5% on a €400
  Zalando order, then the aside becomes a headline and I am wrong. He should be asked this exact
  question, because it is the one input I cannot measure.

---

## 6. Option A, sliced — TDD, smallest first

Each slice is a failing test before implementation, and each ends green on
`pnpm turbo run typecheck --force` **and** `pnpm turbo run test --force`.

**Slice 1 — `packages/core/src/checkout.ts`, pure.**
`quoteCheckout({ entries, held, merchantHost, currency, amountCents, asOf })` → ranked rows +
`unknowns`. Reuses `marketFxOptions` / `issuerConsensus` / `marketCashbackOptions`; adds no new
arithmetic. Tests that must fail first:
- a held card with an unproven `fxFeePct` lands in `unknowns` with a reason and **never** at 0;
- a EUR purchase ranks on cashback, a USD purchase on FX surcharge, and the two are not mixed;
- `issuerConsensus` resolves "American Express / activity" to 2,5% and is refused the moment the
  candidates disagree;
- every returned row carries `sourceUrl` and `asOf`; a row without both is a test failure;
- an empty catalogue returns `rows: []` and **no** headline — the *"je saldi staan al op de beste
  plek"* failure, ported to this surface and tested against.

**Slice 2 — the amount reader, pure.**
`readCheckout(html) → { currency, amountCents } | { reason }`. Fixture-driven: JSON-LD `Offer`,
microdata `itemprop="price"`, `<meta property="product:price:amount">`, and — importantly — three
fixtures that must return `reason` rather than a number. No DOM, no network; the content script hands
it a string.

**Slice 3 — the message channel.**
Fixed request/response shape from §2b, with a schema test proving the request carries **only**
merchant/currency/amount, and the response carries no balance, IBAN, account key or transaction text.
This test is the redaction boundary; it should read like the LLM-proxy one.

**Slice 4 — the extension shell.**
`apps/extension/`: manifest (MV3, `activeTab`, `optional_host_permissions`, no static match list),
content script, popup. Dutch UI. When the amount cannot be read, the popup says so plainly and gives
a manual amount field — it never guesses.

**Slice 5 — the Klarna aside, bundled.**
`scripts/bundle-merchant-offers.ts` → `apps/extension/src/merchant-offers.generated.ts`, in the exact
shape of `bundle-bank-logos.ts`: fetched during the sweep, embedded, `sourceUrl` + `fetchedAt` per
row, nothing fetched in the browser. Every row carries the app-only condition as text, and the UI
renders it as a caveat next to the percentage — not as a term in the sum.

**Slice 6 — the empty and unknown states.**
A checkout where nothing is proven must produce a useful, honest screen: what it could not read, why,
and no ranking. Tested as a first-class outcome, not an edge case.

**Explicitly out of scope for v1**, and each for a stated reason:
- **no euro valuation of points** — the Punten tab dropped "indicatief" on principle, and for ING
  there is now an issuer statement backing it: *"Nee, ING Punten hebben geen monetaire waarde en
  kunnen niet worden ingewisseld voor geld."*
- no autofill, no checkout interception, no card selection on his behalf;
- no login anywhere;
- no runtime fetch of any kind — not a logo, not a tile, not a font.

---

## 7. Open questions for him

1. **The Klarna question in §5** — would he actually restart a basket in the Klarna app for 8,5%? His
   answer decides whether merchant offers are a headline or a footnote, and it outranks my reading.
2. **Which browser.** MV3 is Chrome/Edge; Firefox differs on `externally_connectable` and would need
   a second channel. One browser for v1, and it should be the one he shops in.
3. **Does the popup need to work with the LaVega tab closed?** Today's design says no, and that is
   what keeps the vault out of the extension. Saying yes means the extension holds data, which is a
   different plan.
