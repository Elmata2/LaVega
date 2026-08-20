# LaVega Product Watchlist — Dutch consumer money products

> ## ⚠ Corrected 18 August 2026 — read this before using the routing below
>
> Three spikes ran after this sweep and **two products marked unreachable are not**. The routing
> decisions in this file are stale where they touch ING and American Express.
>
> **Look for the provider's PDF before declaring it unreachable.** Tariff sheets, cardmember
> agreements and fee documents are legally required, sit on unprotected asset hosts, are stable
> across editions, and carry the *conditions* as well as the rates.
>
> | Product | This file says | Verified by hand |
> |---|---|---|
> | ING (all cards) | bot-blocked, agent-only | **Plain curl, no User-Agent needed.** `assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf` — 200, 174.665 B, `koersopslag niet-euro 1,40%` plus the credit-card tiering with its conditions |
> | American Express | no FX markup published anywhere | **Plain curl.** The Cardmember Agreement PDF, §2.6: `Wisselkoersopslag ... 2,5%` |
> | Revolut | 403, agent-only | Headed Chrome only — **headless parks on the Cloudflare challenge and never resolves** |
> | ABN AMRO Direct Sparen | unreadable | Reads by plain curl at `/nl/prive/rente/actuele-rente.html`; the URL in this file has gone stale |
>
> **And one live data error this sweep did not catch:** Revolut is *not* 0%. Its own per-plan pages
> say 0% applies only inside a monthly limit — Standard €1.000 then **1%**, Plus €3.000 then **0,5%**.
> LaVega currently ranks Revolut top on an unconditional 0%. See
> `docs/superpowers/specs/2026-08-18-catalog-coverage-design.md` for the full corrections.

Sweep of **18 August 2026**. This is a watchlist, **not a price list**: it records *what products exist*,
*where their terms live*, and *whether we can actually read them*. No rates are collected here as product
data. Every figure quoted below is evidence that a page is readable and that the number sits **next to the
thing it describes** — the collection stage does the collecting properly, and this file tells it where to go.

## What the sweep establishes

- **124 products exist** and were verified on a page someone actually fetched: 32 betaalpas, 40 creditcard, 34 spaarrekening, 5 beleggingsrekening, 6 prepaid, 7 crypto.
- **101 of 124 are readable by a plain fetch** — curl with a browser User-Agent, across 82 unique URLs. That is the cheap, exact tier.
- **23 need the agent** — bot-blocked, JS-rendered or deliberately numberless pages, across 22 URLs on 13 hosts. This is a routing decision, not a failure list: a rendering agent does get these — that is how Revolut's 0%, ING's 1,4%, ABN's 1,2% and 2% and Trading 212's 0% base cashback were read earlier today. Two honest caveats: **this sweep did not re-read those figures**, it measured only that curl cannot reach the pages; and **ABN turned out to be fetchable after all** for card tariffs (the wrong URL was being tested), though not for savings. The routing below supersedes that earlier list.
- **104 of 124 products have a conditional headline rate** — the advertised number needs a stake, a paid tier, a promo window, a balance threshold or a manual opt-in. Only **10** are genuinely flat, and **10** publish no readable headline at all, so their conditionality is unknown.
- **7 rows are NOT openable by a Dutch resident** and are kept only so nobody re-adds them: American Express Corporate Card, American Express Corporate Gold Card, KLM American Express Corporate Card, Gnosis Pay Card (direct consumer), Binance Card, Tria Card, RegioBank Spaar-op-Maat Vrij.

### What that means for cost and cadence

The split is lopsided in our favour. 101/124 products sit behind 82 URLs that a scheduled
curl-and-parse job reads deterministically: no model tokens, bandwidth only, effectively **€0 per sweep**, so
it can run daily. The expensive tier is small — 22 URLs on 13 hosts need a rendering
agent at roughly €0.10–0.25 per page, i.e. **≈€2–5 per full agent sweep**. Recommended cadence: **fetch tier
daily or weekly (≈€0), agent tier monthly (≈€2–5)** — call it **€3–6/month** all-in, plus a re-discovery sweep
like this one (five parallel agents, ~€10–20) about twice a year to catch brands dying and URLs moving, which
is what actually happened to five brands in the last twelve months.

### How to read an entry

`Measured` is what a fetch actually returned today, never what a search result claimed. `readable` is one of:
**yes** (real text with the figure next to its label), **marketing-only** (200 and readable prose, but the
number is deliberately absent), **js-shell** (200 with an empty client-rendered body), **bot-blocked**
(403 or a killed connection), **unfetchable** (a novel failure mode — see Binance).
Product names follow `productOf()` in `packages/core/src/travel.ts`: bank + `betaalpas` or `creditcard`.
Where a brand has several distinct cards, **each is its own product** — collapsing tiers is what made Amex
unanswerable for two days.

---

## The list

### Betaalpassen (debit) (32)

#### ING betaalpas
- **Issuer** — ING Bank N.V.
- **Terms** — <https://www.ing.nl/particulier/betalen/passen/buitenland>
- **Measured** — `connection killed (curl 92 on HTTP/2, curl 28/56 on HTTP/1.1)` · readable: **bot-blocked** · fields on page: none
- **Conditions** — none readable on any page reached.
- **Trap** — ing.nl is blocked at HOST level, not per page — every path tried died, including a static .pdf tariff sheet. A browser UA does NOT help here, unlike everywhere else. WebFetch (different egress) reached it but returned only the <title>, so behind the block it is also a JS shell. Only figure available is bank.nl's third-party 1,4% koersopslag, checked 15-1-2026.

#### ABN AMRO betaalpas
- **Issuer** — ABN AMRO Bank N.V.
- **Terms** — <https://www.abnamro.nl/nl/prive/betalen/tarieven/buitenlands-geld.html>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, conditions
- **Conditions** — Fee varies by pakket and by tariefklasse (balance band): the Studentenpakket pays only the valutakoersopslag with no fixed €0,15. Cash-withdrawal tariff steps at balance thresholds (< / > €17.500 standard, €6.000 student, €2.000 jongerengroei).
- **Trap** — CORRECTS the standing assumption that ABN's tariff page is an empty JS shell. That is true only of the INDEX: /betalen/tarieven/index.html is 1.078.742 bytes stripping to 9.124 chars of pure navigation with ZERO percent signs. Its sibling /betalen/tarieven/buitenlands-geld.html strips to 11.228 chars and carries real tariff tables ('Met Betaalpas — € 0,15 en 1,2% valutakoersopslag per keer'). ABN's betaalpas is 1,2%, NOT the 1,4% herd figure. The page also warns its own ECB-reference percentage differs from the 1,2% because that comparison uses the Mastercard rate.

#### Rabobank betaalpas
- **Issuer** — Coöperatieve Rabobank U.A.
- **Terms** — <https://www.rabobank.nl/particulieren/betalen/betaalproducten/kosten-voorwaarden>
- **Measured** — `403 (18.728-byte interstitial)` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Package-dependent: Rabo Comfort reportedly pays only the koersopslag with no fixed per-withdrawal amount, unlike Rabo Standaard. Unverified on a Rabobank page.
- **Trap** — CORRECTS the standing note that Rabobank kills the connection like ING. It returns a clean 403, identical on HTTP/2 and HTTP/1.1 across 4 paths, and WebFetch also got 403 — a uniform edge block. Operationally this matters: a 403 may yield to a cookie/session, a killed connection will not. Fallback figure is bank.nl's 1,4%, checked 15-1-2026.

#### SNS betaalpas
- **Issuer** — ASN Bank N.V. (formerly SNS Bank N.V. / de Volksbank)
- **Terms** — <https://www.snsbank.nl/particulier/betalen/service/betalen-in-het-buitenland.html>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, conditions
- **Conditions** — Daily limits vary by tier (€1.000/€2.500 pay, €500/€750 withdraw; SNS Jeugd Betalen €50/week and €75/week).
- **Trap** — BRAND BEING RETIRED — the biggest trap in this bucket. SNS Bank legally became ASN Bank on 1 July 2025 (de Volksbank N.V. → ASN Bank N.V.); the page's own nav reads 'SNS wordt ASN Bank'. It still returns 200 and is fully readable, measured in context: 'Betalen in vreemde valuta kost 1,4% over het betaalde bedrag… + € 3,50 per keer.' LaVega will keep generating 'SNS betaalpas' from legacy account labels, so keep the name but point terms at ASN. bank.nl has no SNS row.

#### ASN betaalpas
- **Issuer** — ASN Bank N.V.
- **Terms** — <https://www.asnbank.nl/service/asn-betaalpas/betalen-buitenland.html>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee
- **Conditions** — none readable on any page reached.
- **Trap** — Cleanest source in the bucket. Measured in context: '…1,4% van het opgenomen bedrag + € 3,50 vaste vergoeding per opname' and '…1,4% van het betaalde bedrag per betaling.' URL trap: the /particulier/betalen/… paths that work on snsbank.nl are 404 on asnbank.nl (three guessed variants measured 404). ASN uses /service/asn-betaalpas/ and /betalen/asn-creditcard/.

#### RegioBank betaalpas
- **Issuer** — ASN Bank N.V. (formerly RegioBank N.V.)
- **Terms** — <https://www.regiobank.nl/service/betalen/buitenland.html>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee
- **Conditions** — none readable on any page reached.
- **Trap** — BRAND BEING RETIRED: RegioBank officially became ASN Bank on 1 December 2025, adviser conversion running through 2026. Page still 200 and readable, wording IDENTICAL to SNS ('1,4%… + € 3,50 per keer') as expected for one bank behind three brands. bank.nl has no RegioBank row.

#### Knab betaalpas
- **Issuer** — Knab (Aegon Bank N.V.)
- **Terms** — <https://www.knab.nl/tarieven>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, interest, conditions
- **Conditions** — Account is €6/month (Privérekening, one holder) or €7/month (Gezamenlijke rekening) and is currently under a PROMO — 'Kortingsactie: Tijdelijk 12 maanden gratis'. A promo window must not be baked in as the standing price.
- **Trap** — THE KNAB TRAP REPRODUCED. One page carries betaalpas, creditcard, roodstand, sparen and deposito. The betaalpas figure is 'Betalen en opname van contant geld buiten eurolanden — Mastercard wisselkoers + 1,4% koersopslag', inside the 'Betalen en overboeken' block. The 2% about 19 lines further down belongs to the 'Knab Creditcard' block. Anchor on the section heading, never on the first percentage found. Genuine negative finding: 'Rente op je betaalrekening 0%' — the current account pays NO interest. Cross-track: non-EEA transfers €15 + 0,1% koersopslag.

#### Triodos betaalpas
- **Issuer** — Triodos Bank N.V.
- **Terms** — <https://www.triodos.nl/service/particulieren/betalen/betaalpas>
- **Measured** — `200` · readable: **marketing-only** · fields on page: conditions only
- **Conditions** — The card must be ACTIVATED for use outside Europe before it works; inside Europe it works immediately at Visa ATMs/terminals. Daily limits €1.500 pay / €500 withdraw abroad, halved to €250 under 18.
- **Trap** — A clean example of readable-but-useless: 200, real prose, and ZERO percent signs (counted — 0 matches). It deliberately declines to publish a number: 'Visa bepaalt de wisselkoersen en opslagen.' The rate is behind a JS 'rekenhulp' at /betaalpas/rekenhulp, which is 200 but strips to 2.402 chars with no figures. Triodos's own site has NO scrapeable fx rate anywhere. The only figure is bank.nl's third-party 1,0% — the cheapest betaalpas in the bucket and the only one that is neither 1,2% nor 1,4%, which is exactly why it needs real verification rather than a herd assumption.

#### bunq Free betaalpas
- **Issuer** — bunq B.V. (NL banking licence); Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/personal/plans/bunq-free>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, interest, annualFee, conditions
- **Conditions** — Free tier: ZeroFX (0,5% opslag) applies only up to €1.000 of foreign-currency card spend per calendar year; above that THIS page states 3% per transaction. A physical Credit Card requires a paid plan (Free gets a digital card only). The interest headline is 'tot wel' and is plan/threshold dependent.
- **Trap** — NO cashback anywhere — grep returns zero. Contradiction to record: this page says 3% after the €1.000 cap, the bunq Core FAQ says only 'standaard conversiekosten' with no number, and a search snippet claimed 1,5%. Trust this page, not search.

#### bunq Core betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/personal/plans/bunq-core>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, interest, annualFee, conditions
- **Conditions** — €3,99/month. ZeroFX unlimited (0,5% surcharge) only because it is a paid plan. Savings interest is 'tot wel 3,01%', plan- and threshold-dependent per bunq's own FAQ ('Je rente hangt af van je plan').
- **Trap** — Renders server-side, ~25KB of text. No cashback. The 0,5% sits inside the ZeroFX FAQ answer next to the words it describes — verified in context, not counted as a stray %.

#### bunq Pro betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/personal/plans/bunq-pro>
- **Measured** — `200` · readable: **yes** · fields on page: interest, annualFee, conditions
- **Conditions** — €9,99/month. Includes 3 physical cards. 20% discount on Ginmon trading fees after 3 free months — a tier perk, not a card rate.
- **Trap** — TRAP: unlike Free/Core/Elite this page mentions ZeroFX by name but does NOT print the 0,5% number (measured: zero matches for '0,5%'). Do not carry a sibling page's number over without saying so.

#### bunq Elite betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/personal/plans/bunq-elite>
- **Measured** — `200 (after refetch)` · readable: **yes** · fields on page: fxFee, interest, annualFee, conditions
- **Conditions** — €18,99/month. The 0,5% surcharge applies 'wanneer de markten open zijn' — weekend/closed-market conversions are not covered by the headline. 50% Ginmon trading discount after 3 free months.
- **Trap** — TRAP (flaky SSR): the first fetch returned HTTP 200 with a 30-byte empty JS shell; an immediate refetch of the SAME URL returned the full 28KB page. bunq's CDN serves a shell on cache miss. Always refetch a bunq 200 that yields near-zero text before calling it a js-shell.

#### bunq Free Business betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/business/plans>
- **Measured** — `200 (after refetch)` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — Free tier aimed at zzp'ers. No FX, cashback or interest figure is printed on the business plans page at all.
- **Trap** — Same flaky-SSR trap as bunq Elite: first fetch 200 with 30 bytes of text, refetch 200 with 9,3KB. The business comparison table is also TRUNCATED in server HTML — only the first rows render, the rest sits behind 'Volledige tabel weergeven'.

#### bunq Core Business betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/business/plans>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — €7,99/month. The tier is itself the condition for whatever ZeroFX allowance applies, and the allowance is not printed on this page.
- **Trap** — Business monthly prices measured on-page: Free €0, Core €7,99, Pro €13,99, Elite €23,99. No fxFee/cashback/interest anywhere in the rendered business plans HTML.

#### bunq Pro Business betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/business/plans>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — €13,99/month.
- **Trap** — See bunq Core Business — the business tier pages carry price only; /nl-nl/business/cards is pure marketing (measured: 16,8KB of text, zero fee figures).

#### bunq Elite Business betaalpas
- **Issuer** — bunq B.V.; Mastercard
- **Terms** — <https://www.bunq.com/nl-nl/business/plans>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — €23,99/month.
- **Trap** — Includes a Metal Card per /nl-nl/business/cards, but that page names the card without any fee, FX or cashback figure.

#### Revolut Standard betaalpas
- **Issuer** — Revolut Bank UAB (Lithuania), in NL via passport/branch
- **Terms** — <https://www.revolut.com/nl-NL/legal/standard-fees/>
- **Measured** — `403 (Cloudflare)` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Unknown from any provider-owned source. Search snippets claim a monthly FX allowance with a fair-usage percentage above it — NOT verified, do not carry forward.
- **Trap** — Hard Cloudflare block. Measured headers: 'server: cloudflare', 'cf-mitigated: challenge', HTTP/2 403, an 873KB interstitial containing 67 bytes of text ('Just a quick security check'). Blocked on www.revolut.com AND help.revolut.com, and WebFetch from different infrastructure also got 403. A guessed PDF at assets.revolut.com 404'd. availableToNL is inferred from the /nl-NL/ path 403ing rather than 404ing plus market knowledge — NOT from a page anyone read.

#### Revolut Plus betaalpas
- **Issuer** — Revolut Bank UAB
- **Terms** — <https://www.revolut.com/nl-NL/legal/plus-fees/>
- **Measured** — `403` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Paid tier — the subscription price is itself the condition on every headline benefit. Amount unverified.
- **Trap** — Same Cloudflare challenge. The tier URL came from the search index only; its content was never read.

#### Revolut Premium betaalpas
- **Issuer** — Revolut Bank UAB
- **Terms** — <https://www.revolut.com/nl-NL/legal/premium-fees/>
- **Measured** — `403` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Paid tier; unverified.
- **Trap** — Same Cloudflare challenge.

#### Revolut Metal betaalpas
- **Issuer** — Revolut Bank UAB
- **Terms** — <https://www.revolut.com/nl-NL/legal/metal-fees/>
- **Measured** — `403` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Paid tier. Metal is historically the Revolut tier that carries cashback, so treating any Revolut cashback as unconditional would be wrong. Unverified.
- **Trap** — This is the exact URL whose response headers were captured (cf-mitigated: challenge).

#### N26 Standard betaalpas
- **Issuer** — N26 Bank AG (Germany) — German IBAN even for Dutch residents; Mastercard Debit
- **Terms** — <https://n26.com/en-eu/plans>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, cashback, interest, annualFee, conditions
- **Conditions** — Free plan. NO travel cashback — the cashback row is BLANK for Standard and Smart, which is a real finding rather than a gap. ATM outside the eurozone carries 1,7%; free only on Go/Metal. Physical card €10; 2 free eurozone ATM withdrawals/month.
- **Trap** — There is NO Dutch locale: n26.com/nl-nl, /nl-nl/ and /en-nl all MEASURED 404. The canonical readable source is the English /en-eu/plans comparison table, fully server-rendered. Dutch residents get a DE IBAN, i.e. iDEAL/Tikkie friction.

#### N26 Smart betaalpas
- **Issuer** — N26 Bank AG; Mastercard Debit
- **Terms** — <https://n26.com/en-eu/plans>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, cashback, interest, annualFee, conditions
- **Conditions** — €4,90/month. Still no travel cashback and still the 1,7% non-eurozone ATM fee — the paid tier does NOT buy those.
- **Trap** — Same page as Standard. Naming trap: search results and older reviews call the €9,90 tier 'You'; N26's live page calls it 'Go'. Use Go.

#### N26 Go betaalpas
- **Issuer** — N26 Bank AG; Mastercard Debit
- **Terms** — <https://n26.com/en-eu/plans>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, cashback, interest, annualFee, conditions
- **Conditions** — €9,90/month. 1% travel cashback exists ONLY from this tier up, and the page footnotes it (superscript 1) — conditional on both the paid tier and the footnote's terms. Free non-eurozone ATM withdrawals.
- **Trap** — Formerly marketed as 'N26 You'. Card payments worldwide are stated free of FX markup on all tiers; the cashback is the tier-gated part.

#### N26 Metal betaalpas
- **Issuer** — N26 Bank AG; metal Mastercard Debit
- **Terms** — <https://n26.com/en-eu/metal>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, cashback, interest, annualFee, conditions
- **Conditions** — €16,90/month. 1% travel cashback, top savings rate, 8 fee-free eurozone ATM withdrawals then €2 each, 10 free trades/month, lounge pass — all gated on the subscription.
- **Trap** — Both /en-eu/metal and /en-eu/plans are readable. /en-eu/foreign-transaction-fee is an SEO explainer, marketing-only — it discusses generic 1–3% industry FX fees and is very easy to misread as N26's own tariff.

#### Wise betaalpas
- **Issuer** — Wise Europe SA (Belgium) for EEA customers; Visa/Mastercard debit
- **Terms** — <https://wise.com/nl/pricing/>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, conditions
- **Conditions** — No subscription and no plan tiers at all — Wise's own page says 'geen abonnementen of plannen'. Card delivery €7 one-off, virtual card free. ATM free up to €250/month per account, then 2,69% on the amount above €250. Conversion fee 'vanaf 0,2%', varying by currency pair with volume discounts.
- **Trap** — ENTITY TRAP: the Dutch-language pricing page renders an FCA/UK footer ('Wise Payments Limited', Electronic Money Regulations 2011). The EEA entity strings ('Wise Europe SA', 'Wise Assets Europe AS') are present in the page's JS translation bundle but NOT in the rendered footer. Confirm which entity's price list applies to an NL resident before quoting a number. Also: wise.com/nl/card/ is marketing-only — it says ATM is free 'tot € 250, daarna een surcharge' with NO percentage. No cashback, no points on any Wise page.

#### Trade Republic betaalpas
- **Issuer** — Trade Republic Bank GmbH (Germany), Nederlandse vestiging Amsterdam; Visa debit
- **Terms** — <https://traderepublic.com/nl-nl/kaart/_payload.json>
- **Measured** — `200 (payload) / 200 shell (HTML)` · readable: **yes via SSR payload** · fields on page: cashback, fxFee, annualFee, conditions
- **Conditions** — 1% Saveback is heavily conditional: capped at €1.500 of eligible monthly card spend, NOT paid as cash — it is auto-invested into a periodic investment plan, so you must have one running — and an excluded-transaction list applies. No monthly card subscription, but Classic and Mirror cards are charged one-off at order and possibly again on renewal/replacement. ATM free above €100 per withdrawal, €1 below €100. No FX markup claimed ('geen valutawisselvergoedingen', Visa rate).
- **Trap** — THE KEY TRAP: the HTML at /nl-nl/kaart is a Nuxt shell — 76KB of HTML stripping to 483 bytes of text (just the footer). Every figure came from the SSR payload at /nl-nl/kaart/_payload.json (measured 200, 317KB), which curl fetches fine. The footer 'Tarieven' link is not an href at all but a JS modal (slug 'pricing-scheme'), so there is no separate tariff URL to fetch.

#### 212 Card
- **Issuer** — Paynetics (card issuer); NL customers under Trading 212 Markets Ltd (Cyprus) or Trading 212 EU GmbH (Germany)
- **Terms** — <https://helpcentre.trading212.com/hc/en-us/articles/19288398028317-What-are-the-fees-for-using-the-212-card>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, cashback, annualFee, conditions
- **Conditions** — Cashback BASE RATE IS 0%. 1,5% is earned only if BOTH are true at once: (a) 'Invest cashback' is manually activated and a Pie selected, and (b) at least one qualifying recurring subscription (billed monthly or shorter — annual does NOT count) is detected on the card. Cashback can never be taken as cash; it is auto-invested, capital at risk. Cap €15/month on EUR accounts. ATM free to €400/month then 1%. One-off physical card charge. Excluded merchant categories apply (financial institutions, quasi-cash, crypto, gift cards).
- **Trap** — TWO-HOST TRAP, the single most useful routing fact here: www.trading212.com is a hard Cloudflare 403 on every path (/card, /interest-on-cash, root) with an 'Access Denied' body, but helpcentre.trading212.com (Zendesk) is fully readable at 200 — and its JSON API at /api/v2/help_center/articles/search.json?query=… returns full article bodies. NL availability VERIFIED from the eligibility article: the Netherlands appears in both the Markets Ltd and the EU GmbH country lists.

#### Openbank betaalpas (R42 Betaalpas)
- **Issuer** — Open Bank S.A. (Spain, Santander group) — Spanish IBAN used in NL; Mastercard
- **Terms** — <https://www.openbank.nl/betaalrekening>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — Account and card are free, but THE TRAVEL/FX BENEFITS ARE A PAID ADD-ON: commission-free foreign-currency payments, the daily Mastercard rate including weekends, and 5 worldwide free ATM withdrawals per month all require 'Travel+' at €4,99/month (toggleable). Without Travel+: 5 free eurozone ATM withdrawals/month plus unlimited at Santander Group's 40.000 ATMs. Eligibility: adult, resident in NL, valid passport or Dutch ID.
- **Trap** — THE INVERSE OF A TIER TRAP: the page's free-account framing sits directly above a €4,99/month gate on the only FX benefit, so recording Openbank as 'no FX fee' would be wrong. Crucially the page never states what FX COSTS without Travel+ — that number is on no Openbank HTML page, only in the 'informatie over vergoedingen en commissies' document. Deposit guarantee is SPANISH (€100.000), not Dutch.

#### Krak Card (Kraken)
- **Issuer** — Monavate UAB, Lithuania (EEA); Monavate Ltd in the UK — Mastercard debit
- **Terms** — <https://www.kraken.com/krak/card>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, fxFee, annualFee, conditions
- **Conditions** — 'Up to 2% cashback' with footnote 1 measured on the page: 'Rate depends on average assets held with Krak, Kraken and Kraken Pro', and a separate line: 'Access to Metal Card and maximum cashback requires an average £/€50.000 in combined assets…'. So 2% is an asset-balance gate, not a base rate, and the per-tier ladder is NOT published. 'Up to 4% boosted cashback on travel' only via Krak Concierge.
- **Trap** — Kraken's consumer money app is branded Krak. krak.com times out (connection killed at 25s); the live pages are kraken.com/krak and kraken.com/krak/card, and kraken.com/features/krak is 404. FX: 'zero FX fees' but footnote 2 measured 'A variable spread applies when spending across assets' — so it is not genuinely free when you spend from crypto. Own-page eligibility: 'available to residents of the UK and the EU'.

#### Plutus Card
- **Issuer** — Plutus (Visa debit, NL IBAN per their marketing; issuing EMI not named on the plans page)
- **Terms** — <https://plutus.it/plans>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, annualFee, conditions
- **Conditions** — DOUBLE CONDITION — a PAID subscription AND a PLU token stake. No free tier. Subscriptions: Starter £/€6,99/mo (rewards on £/€250 monthly spend), Everyday £/€9,99/mo (£/€500), Premium £/€19,99/mo (£/€1.000). The rate then comes from the PLU ladder measured on the page: 1–1.000 PLU = 3%, 2.000 = 4%, 3.000 = 5%, 10.000 = 6%, 20.000 = 7%, 30.000 = 8%, 40.000 PLU = 9%. Achievable base is 3% on a CAPPED £/€250–1.000 of monthly spend; 9% needs 40.000 PLU staked. Rewards pay in PLU/'PLUS' points, not euros.
- **Trap** — Two traps. (1) The tier table is rendered TWICE — a full desktop table then a partial mobile card list starting at 'Chad' — so a careless read drops the bottom five tiers. (2) Review sites are WRONG on the numbers: a widely-cited source says 'Everyday requires 250 PLU for 4%' and 'Legend 8.000 PLU for 8%'; measured on plutus.it/plans, 4% is Hero at 2.000 PLU and Legend is 10.000 PLU at 6%. Provider page wins. The homepage also mentions a 'free virtual Plutus Card… No fees' alongside the paid plans — the two claims conflict on their own site and need resolving at collection time.

#### Bybit Card
- **Issuer** — Bybit EU (EUR card for EEA residents); issuing EMI not obtainable
- **Terms** — <https://www.bybit.eu/en/cards>
- **Measured** — `200` · readable: **js-shell** · fields on page: none
- **Conditions** — Not obtainable from any Bybit page that could be read. Review sites claim tiered 2%–10% cashback; NONE of that is verifiable on Bybit's own domain, so treat every Bybit percentage as unsourced until an agent renders the page.
- **Trap** — Both www.bybit.com/en/cards/ and www.bybit.eu/en/cards return 200 with ~90KB of HTML that strips to a single line — the exchange's generic <title>. The help-centre article strips to 'This article is currently not supported on this site.' and the wiki cashback article returns 'Article not found'. ONE Bybit page IS readable and it is the useful one: /en/wiki/article/bybit-card-countries-availability-2026/ (200, server-rendered) lists 'Netherlands | Europe (EEA) | Yes | Yes | Full availability'. NL availability verified on their own domain; the rates are not.

### Creditcards (40)

#### ING creditcard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.ing.nl/particulier/betalen/tarieven>
- **Measured** — `connection killed` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Sold against an ING betaalpakket (Oranje Pakket discount reported), so the monthly fee is package-dependent. Unverified on any ING page.
- **Trap** — Same host-level block. There is NO ICS backdoor: icscards.nl/ing measured 404, so the trick that rescues ABN (ICS is an ABN subsidiary) does not exist for ING. bank.nl lumps the base card and the platinum tier under one heading 'Met creditcard of platinumcard' — do not let that lump erase the two-tier split.

#### ING Platinumcard
- **Issuer** — International Card Services (ICS)
- **Terms** — _no terms URL found_
- **Measured** — `connection killed` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Reported minimum income on the ING current account and a higher monthly fee than the base card. NOT verified on any readable page.
- **Trap** — Existence of a distinct platinum tier is confirmed only by bank.nl's column header 'Met creditcard of platinumcard' — a third-party comparison site, fetched directly. The marketing names 'Creditcard More' / 'Creditcard Extra' come only from affiliate blogs and are NOT confirmed. Listed separately because collapsing tiers is what made Amex unanswerable for two days.

#### ABN AMRO creditcard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.icscards.nl/abnamro/klantenservice/betalen/contant-geld-opnemen>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, conditions, (merchant offers)
- **Conditions** — Cash withdrawal 4%, dropping to 1% capped at €1,50 only if drawn entirely from a POSITIVE balance on the card; the portion above the positive balance reverts to 4%. Daily cap €2.000, and only €1.250/month for the first 3 months of cardholding.
- **Trap** — icscards.nl is the readable backdoor when abnamro.nl misbehaves. Measured in context: 'Voor alle ABN AMRO creditcards is de koersopslag 2%…'. The merchant-discount list (8% Expedia, tot 25% Samsung, tot 20% Center Parcs) is NOT cashback — those are partner offers with marketing 'tot' ranges. /abnamro/klantenservice/tarieven is a 404; do not guess that path.

#### ABN AMRO Gold Card
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.icscards.nl/abnamro>
- **Measured** — `200` · readable: **yes** · fields on page: conditions
- **Conditions** — Higher daily cash limit (€3.000 vs €2.000 on the standard ABN AMRO creditcard). Annual fee not shown on any page read.
- **Trap** — Genuinely DISTINCT from 'ABN AMRO creditcard' — named as its own item in the ICS portal nav with its own withdrawal limit. The 2% koersopslag is worded 'voor alle ABN AMRO creditcards' so it should cover Gold, but the Gold-specific annualFee needs its own fetch. Do not collapse into the standard card.

#### Rabobank creditcard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.rabobank.nl/particulieren/betalen/creditcard/rabocard>
- **Measured** — `403` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Monthly fee depends on betaalpakket — reported €2/month on Rabo Standaard and included in Rabo Comfort / RiantPakket. Unverified.
- **Trap** — This is the name productOf() will generate. Underneath it the real card is the RaboCard or the Rabo GoldCard. Search results claim the RaboCard is being auto-converted to GoldCard and closed to new applications — every rabobank.nl URL 403s, so that is NOT verified.

#### Rabo GoldCard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.rabobank.nl/particulieren/betalen/creditcard/rabo-goldcard>
- **Measured** — `403` · readable: **bot-blocked** · fields on page: none
- **Conditions** — none readable on any page reached.
- **Trap** — The 403 interstitial is served regardless of whether the path exists, so existence is search-derived, not measured — a 403 is only weak evidence a URL is real. Higher spending limit than RaboCard per search results. Listed separately rather than folded into 'Rabobank creditcard'.

#### SNS creditcard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.snsbank.nl/particulier/betalen/sns-visa-credit-card/kosten-van-je-creditcard.html>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, conditions
- **Conditions** — Annual fee €37,50 (extra card also €37,50) but €27,50 with an SNS Studentenrekening. Cash withdrawal 4%, dropping to 1% capped €1,50 when drawn from a positive card balance, excess back at 4%.
- **Trap** — RENAMED: ICS confirms on its own page that from 5 January 2026 the SNS and RegioBank credit cards became 'ASN Creditcard'. So today this product effectively IS the ASN Creditcard — the €37,50 and 2% figures match across both pages, a clean cross-check. Multi-product page: it also links betaalpas content, but the 2% wisselkoersopslag sits unambiguously under 'Kosten betalen met je creditcard'.

#### ASN Creditcard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.asnbank.nl/betalen/asn-creditcard/kosten-asn-creditcard.html>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, conditions
- **Conditions** — €37,50/year (extra card €37,50; student €27,50). Cash withdrawal 4%, or 1% capped at €1,50 if taken entirely from a positive card balance; the amount above the positive balance is 4%. A non-euro withdrawal is 4% PLUS 2% koersopslag — the two stack.
- **Trap** — The surviving brand that SNS creditcard and RegioBank creditcard both folded into on 5 Jan 2026. Rates sit in a clean labelled table (2% directly under 'Betalen met buitenlands geld'), so the figure is genuinely next to the thing it describes. Treat as canonical for all three legacy brands.

#### RegioBank creditcard
- **Issuer** — International Card Services (ICS)
- **Terms** — <https://www.regiobank.nl/downloads/tarievenwijzer-betalen-1.html>
- **Measured** — `200 (serves PDF bytes)` · readable: **yes (PDF extractor required)** · fields on page: fxFee, conditions
- **Conditions** — Cash withdrawal 1% instead of 4% when the card carries a positive balance. Betaalpas cash in foreign currency 1,4% + €3,50 per withdrawal.
- **Trap** — FORMAT TRAP: the URL ends in .html but the bytes are a 4-page PDF 1.4 document (verified with file(1)). An HTML tag-stripper returns PDF object garbage ('3 0 obj', '/TrimBox') and finds ZERO tariffs — a false 'unreadable'. Sniff content type, never the extension. Once extracted it is the richest RegioBank source and says 'De RegioBank Creditcard is een product van International Card Services (ICS). ASN Bank heeft de dienstverlening… ondergebracht' — already naming ASN. Renamed ASN Creditcard on 5 Jan 2026.

#### Knab creditcard
- **Issuer** — Knab (Aegon Bank N.V.)
- **Terms** — <https://www.knab.nl/tarieven>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, interest, conditions
- **Conditions** — Debetrente is 0% if you repay in full monthly (standard), but 14% effective per year variable if you opt into gespreid betalen. That optional-tier split must not be flattened to '0%'.
- **Trap** — Same URL as the Knab betaalpas — these two MUST be read from their own sections. Measured under the 'Knab Creditcard' heading: 'Betalingen in vreemde valuta — 2% koersopslag' and 'Contant geld opnemen — 4%'. Unlike ABN/ASN/SNS there is NO positive-balance 1% discount on this page, though a search summary claimed one — do not import it. Knab's page never names ICS, unlike SNS/RegioBank; issuer left as Knab/Aegon rather than assumed.

#### bunq creditcard
- **Issuer** — bunq B.V. (self-issued, Mastercard) — notably NOT ICS
- **Terms** — <https://www.bunq.com/nl-nl/personal/features/credit-card>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — Deferred-debit, not real credit: it spends money already on your bunq balance. No interest, no annual fee within your plan's included card allowance. €99 one-off for the Metal Credit Card, €9,99 per extra physical card above the free tier, €3,49/month per extra active physical card. A physical credit card requires a PAID plan.
- **Trap** — The page contradicts itself: 'Elke bunq gebruiker krijgt een creditcard, zonder rente of jaarlijkse kosten' versus the FAQ 'fysieke Credit Cards vereisen een betaald plan'. No cashback, no points — verified absent. No FX figure here; the 0,5% ZeroFX lives on the plan pages.

#### American Express Blue Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/blue-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, interest, conditions
- **Conditions** — Headline price is €0 per maand ONLY if you spend at least €3.000 per membership year; the page states the card is otherwise worth €35 per jaar. Charge card: full balance due monthly.
- **Trap** — Server-rendered, plain curl with a browser UA is enough (~775KB HTML, real text). Points are Membership Rewards at 1 punt per 2 euro — HALF the Green/Gold/Platinum rate and easy to conflate. NO cashback (grep, 0 hits). NO fxFee/koersopslag anywhere — Amex NL does not publish an FX markup in HTML at all.

#### American Express Green Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/green-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, interest, conditions
- **Conditions** — Promo window: 'Nu 1e jaar gratis', then €6,50 per maand. Charge card — 'Geen rente', full balance due every month, no BKR registration at signup.
- **Trap** — Price is PER MONTH, not per year — do not read €6,50 as an annual fee. 1 MR punt per euro. The page also advertises the Business Gold Card at €270 per jaar in a cross-sell block: that number belongs to a DIFFERENT product and is the Knab-style trap on this page.

#### American Express Gold Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/gold-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, interest, conditions
- **Conditions** — €20 per maand, no first-year promo shown at fetch time. Charge card — 'Geen rente', full balance due monthly.
- **Trap** — Per-month pricing. 1 MR punt per euro. Dense with euro-denominated BENEFIT valuations (€900 aan voordelen per jaar, €100 dining value, €1.400 purchase-insurance cap) that are NOT fees — a naive euro-regex will pick them up. Cross-sells Business Gold at €270 per jaar.

#### American Express Platinum Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/platinum-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, interest, conditions
- **Conditions** — €75 per maand. A supplementary Platinum Card is a separate €10 per maand. Charge card — 'Geen rente'.
- **Trap** — Per-month pricing. 1 MR punt per euro. Worst page on the site for euro-figure noise: €2.400 benefits, €500 lounge value, €370/€210 Privium values, €3.000.000 medical cover, plus the €10 extra-card fee — five different euro amounts near the headline price.

#### Flying Blue - American Express Entry Card
- **Issuer** — American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/flying-blue-entry-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, interest, conditions
- **Conditions** — Promo: 1e jaar gratis + 1.000 Miles welcome bonus, then €3 per maand. Extra cardholders must hold a current private account at a Dutch bank. The Miles-validity extension is a ONE-OFF 2-year extension on this card only (Silver/Gold/Platinum extend on every spend).
- **Trap** — Earn rate 1 Mile per 2 euro — the LOWEST of the four Flying Blue cards and the one most often mis-quoted as '1 Mile per euro'. Miles are POINTS, not cashback. The footer carousel shows '€ 55.00 per maand' — that is the Flying Blue Platinum's price bleeding into the same DOM; do not attribute it here.

#### Flying Blue - American Express Silver Card
- **Issuer** — American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/flying-blue-silver-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Conditions** — Promo: 1e jaar gratis, then €6,25 per maand. Split earn rate: 0,8 Mile per euro base, 1 Mile per euro direct at KLM/Air France/Hertz — so a single number is wrong.
- **Trap** — THIS CARD IS EASY TO MISS. It is not returned by generic searches for the Flying Blue range and only surfaced from the Amex NL nav; the family is FOUR cards, not three. That is likely part of what made Amex unanswerable before. Footer carousel again shows the Platinum's €55.00.

#### Flying Blue - American Express Gold Card
- **Issuer** — American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/flying-blue-gold-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, interest, conditions
- **Conditions** — €16,50 per maand + 5.000 Miles welcome bonus (promo). Charge card — 'Geen rente'. Split earn rate: 1 Mile per euro base, 1,5 Miles per euro direct at KLM/Air France/Hertz.
- **Trap** — THREE live URLs, ONE product: /nl-nl/creditcard/flying-blue-gold-card/, /nl-nl/kaarten/flying-blue-gold-card/ and /en-nl/cards/flying-blue-gold-card/. Deduplicate on product, not URL; treat the /nl-nl/creditcard/ path as canonical.

#### Flying Blue - American Express Platinum Card
- **Issuer** — American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)
- **Terms** — <https://www.americanexpress.com/nl-nl/creditcard/flying-blue-platinum-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Conditions** — €55 per maand + 10.000 Miles welcome bonus (promo). One extra Flying Blue Platinum Card and up to four extra Flying Blue Gold Cards included at no extra cost. Split earn rate: 1,5 Miles per euro base, 2 Miles per euro at KLM/Air France/Hertz.
- **Trap** — The page renders the price inconsistently as both '€ 55 per maand' and '€ 55.00 per maand' (dot, not comma) — a decimal-comma-only parser will miss one form.

#### American Express Business Entry Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-entry-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Conditions** — €50 per jaar. Minimum gross income €23.000 per jaar. A DGA can hold this alongside a personal Amex.
- **Trap** — Priced PER YEAR, unlike the consumer cards which are per month — never apply one convention across the Amex set. 1 MR punt per uitgegeven euro. The €23.000 income figure sits two lines from the price and reads like a fee to a regex.

#### American Express Business Green Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-green-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Conditions** — €85 per jaar. Minimum gross income €23.000 per jaar. Extra Business Green Card free in year 1, then €50 per jaar each.
- **Trap** — Three different euro-per-jaar figures on the page (€23.000 income, €50 extra card, €85 main fee) — the main fee is the LAST one, in the pricing block near the foot.

#### American Express Business Gold Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-gold-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Conditions** — €270 per jaar, BUT free for the first year for as long as you also keep an American Express consumer card. Minimum gross income €36.000 per jaar. Up to 4 extra Business Gold Cards at no extra fee.
- **Trap** — THE €270 ECHO — the single most cross-referenced price on the whole Amex NL site: '€ 270 per jaar' appears in a cross-sell block on ALL EIGHT consumer card pages, so an unqualified price search attributes it to the wrong product. Also sold from a second live URL, /nl-nl/zakelijk/kaarten/business-companion-card/gold/ (measured 200, readable) — that is the companion framing of THIS product, not a separate card.

#### American Express Corporate Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/zakelijk/kaarten/corporate-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Openable by a Dutch resident** — **no**
- **Conditions** — Standard €60 per jaar, but the actual per-card fee depends on how many cards the COMPANY takes. Membership Rewards is optional at €25 per jaar and only 'als het bedrijf het toestaat'.
- **Trap** — availableToNL is FALSE deliberately: a Dutch resident cannot open this individually — it needs an employer-side Corporate Card programme. Listed so the next stage does not rediscover it and mistake it for a retail card. The fee is footnoted ('* De standaard jaarbijdrage…') well below the fold, not in the pricing block.

#### American Express Corporate Gold Card
- **Issuer** — American Express (self-issued in NL; NOT ICS)
- **Terms** — <https://www.americanexpress.com/nl-nl/zakelijk/kaarten/corporate-gold-card/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, points, conditions
- **Openable by a Dutch resident** — **no**
- **Conditions** — Standard €125 per jaar; the actual per-card fee scales with company card volume. Membership Rewards optional at €25 per jaar, company permission required.
- **Trap** — Corporate programme only, not individually openable. Fee is in a footnote, same pattern as the plain Corporate Card.

#### KLM American Express Corporate Card
- **Issuer** — American Express (self-issued in NL; co-brand with KLM / Flying Blue / bluebiz)
- **Terms** — <https://www.americanexpress.com/nl-nl/zakelijk/kaarten/corporate-klm-card/>
- **Measured** — `200` · readable: **yes** · fields on page: points, conditions
- **Openable by a Dutch resident** — **no**
- **Conditions** — Corporate programme only. Flying Blue participation (€35 per kaart per jaar) is included in the annual fee. bluebiz bonus of 10 blue credits per €1000 of eligible flight spend, capped at 2.000 blue credits per year, and the page says the terms may change.
- **Trap** — NO annual fee is published anywhere on this page — measured; the only euro figure is the €35 Flying Blue participation cost that is already bundled. Do NOT infer the annual fee from the €35. The card runs TWO loyalty currencies at once (personal Miles at 1,5/euro on KLM-AF-Transavia-Hertz, 1/euro elsewhere, plus corporate bluebiz credits) — both points, neither cashback.

#### ICS Visa World Card
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/visa-world-card>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €42,95 per jaar. Minimum net income €1.500 per maand, 18+, resident in NL, BKR check with no negative registration. Spaarrente applies only from a savings balance of €500. Purchase insurance extendable 180→365 days for €8 per jaar.
- **Trap** — Koersopslag 2% IS on this page, stated as '2% voor EU landen zonder euro en voor landen buiten EU'. Two URLs serve a BYTE-IDENTICAL page (md5-verified): /creditcard-aanvragen/visa-world-card and /ics-producten/cards/visa-world-card. The 'interest' here is SAVINGS interest on a positive card balance (1,25%), not borrowing interest — the borrowing rate is on a separate page. Zero occurrences of 'cashback'.

#### ICS Visa World Card Gold
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/visa-world-card-gold>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, interest, conditions
- **Conditions** — €57,95 per jaar rising to €59,50 from 15 September 2026 — a dated price change already baked into the live page. Minimum income €1.500. Spaarrente 1,75% only from a €500 balance, hedged with 'nu' + 'Check de voorwaarden'.
- **Trap** — THE IMPORTANT TRAP IN THIS BUCKET: unlike its three Visa siblings this page carries NO koersopslag line at all — grep for 'opslag', 'vreemde valuta' and 'munteenheid' returned zero hits. The 2% has to come from a TIPS page, https://www.icscards.nl/tips/wat-kost-een-creditcard, which states 2% for 'de Visa Card, Visa World Card Gold en Platinum'. Whatever collects rates must capture the 15 Sep 2026 effective date, not just the number.

#### ICS Visa World Card Platinum
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/visa-world-card-platinum>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €175 per jaar. Minimum income €1.500, BKR check. Spaarrente 1,75% from a €500 balance. Extra Card €25 per jaar.
- **Trap** — Koersopslag 2% present on page. The only ICS consumer card with the Uitgebreide Doorlopende Reisverzekering, and the one card Consumentenbond flags as not requiring the whole trip to be paid on the card for cover. Zero 'cashback' hits.

#### ICS Visa World Card Panda
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary) — co-brand with Wereld Natuur Fonds (WWF)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/visa-world-card-panda>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €42,95 per jaar. ICS donates an annual amount to WWF per card — the donation is paid BY ICS and is not a rebate, discount or cashback to the cardholder. Spaarrente 1,25% from €500.
- **Trap** — The one surviving Dutch charity co-brand. Economically identical to the plain Visa World Card (same €42,95, same 2%, same 180-day purchase insurance, same 1,25%) — the only difference is the WWF donation. Do not model the donation as a user-facing benefit.

#### ICS Mastercard Classic
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/mastercard-classic>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €38,95 per jaar. Extra Card €21,95 per jaar. Spaarrente 1,25% from a €500 balance. Purchase insurance extendable 180→365 days for €8 per jaar.
- **Trap** — Koersopslag 2% present. PATH TRAP: the ICS Mastercard pages live ONLY under /creditcard-aanvragen/ — every /ics-producten/cards/mastercard-* path measured 404, so a crawler that assumes the Visa path shape silently loses all three Mastercards.

#### ICS Mastercard Gold
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/mastercard-gold>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €45 per jaar rising to €46,50 from 15 September 2026. Extra Card €15 per jaar. Spaarrente 1,75% from a €500 balance.
- **Trap** — Koersopslag 2% present. This is the card every former de Bijenkorf Card holder was migrated onto in March 2022. It has its own cardholder sub-site at icscards.nl/gold/… — a DIFFERENT page tree — and the historic Bijenkorf notice there, /gold/info/jaarbijdrage-bijenkorf, now measures 404.

#### ICS Mastercard Black
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/creditcard-aanvragen/mastercard-black>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €225 per jaar. Extra Card €135 per jaar — by far the most expensive supplementary card in the ICS range. Spaarrente 1,75% from a €500 balance. Includes access to 1.800+ lounges, 4x per year.
- **Trap** — Koersopslag 2% present. Top of the ICS consumer range. Zero 'cashback' hits.

#### ICS Visa World Card Business
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/zakelijk/zakelijke-creditcards-vergelijken>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €45 per Card per jaar for 1–5 cards, €40 for 6–25, €35 from 26 — the fee is VOLUME-TIERED, so a single number is wrong without stating the tier. No interest if the full balance is repaid within 21 days; 10% p.a. plus €5 per maand admin on late payment.
- **Trap** — Realistic card for a DGA. The per-product page /zakelijk/zakelijke-creditcard-aanvragen/visa-world-card-business (200, readable) shows the €45 but NOT the FX markup; this comparison page is the only ICS page that puts the business Wisselkoersopslag of 2,5% next to the product. The business rate is 2,5%, HIGHER than the 2% on consumer cards — do not carry the consumer number across. The per-product page also lists all four business prices in a footer strip (€45 / €154 / €43 / €48), which is exactly how the wrong one gets picked up.

#### ICS Visa World Card Business Gold
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/zakelijk/zakelijke-creditcards-vergelijken>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €154 per Card per jaar for 1–25 cards; 'Op aanvraag' from 26 cards — the price is genuinely not published at the top tier. Wisselkoersopslag 2,5%. Includes Priority Pass and a doorlopende reisverzekering.
- **Trap** — Own page at /zakelijk/zakelijke-creditcard-aanvragen/visa-world-card-business-gold (200, readable) but again without the FX markup. The only card in the ICS business range whose top volume tier has no number at all — record that as 'op aanvraag', never as equal to the €154 tier.

#### ICS Mastercard Business
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/zakelijk/zakelijke-creditcards-vergelijken>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €43 per Card per jaar (1–5), €38 (6–25), €33 (26+). Wisselkoersopslag 2,5%. Optional Verzekering Ongeoorloofd Gebruik at €2,50 per Card per jaar. No interest if repaid in full within 21 days.
- **Trap** — Cheapest ICS business card. Own page at /zakelijk/zakelijke-creditcard-aanvragen/mastercard-business (200, readable) carries the €43 and the €2,50 insurance add-on but not the FX markup. The €2,50 line sits close to the fee and is a plausible mis-pick.

#### ICS Mastercard Corporate
- **Issuer** — International Card Services B.V. (ICS, an ABN AMRO subsidiary)
- **Terms** — <https://www.icscards.nl/zakelijk/zakelijke-creditcards-vergelijken>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, interest, conditions
- **Conditions** — €48 per Card per jaar (1–5), €42 (6–25), €36 (26+). Wisselkoersopslag 2,5%. Positioned for 'groot MKB en Corporates' — realistically above a single-person BV.
- **Trap** — Own page at /zakelijk/zakelijke-creditcard-aanvragen/mastercard-corporate (200, readable). Despite the name this IS applied for directly on icscards.nl, unlike the Amex Corporate cards which need an employer programme — the word 'corporate' means different things at the two issuers.

#### ANWB Visa Classic Card
- **Issuer** — International Card Services B.V. (ICS) on behalf of ANWB
- **Terms** — <https://www.anwb.nl/creditcard/informatie/kosten>
- **Measured** — `200` · readable: **yes** · fields on page: fxFee, annualFee, conditions
- **Conditions** — €29,95 per jaar AND a compulsory ANWB membership at €17,75 per jaar on top — total €47,70. The page explicitly says card prices are 'exclusief de kosten van een ANWB lidmaatschap'. Extra Card €29,95 per jaar.
- **Trap** — The tariff page is MULTI-PRODUCT: all three ANWB tiers (€29,95 / €39,95 / €51,95) appear as three bare prices in a row with the card names in a separate preceding block — the classic mis-attribution setup. Koersopslag 2% is stated there and applies to the whole range. The per-card page /creditcard/visa-card (200, readable) has the fee and a clean 'Rekenvoorbeeld' but NO koersopslag.

#### ANWB Visa Silver Card
- **Issuer** — International Card Services B.V. (ICS) on behalf of ANWB
- **Terms** — <https://www.anwb.nl/creditcard/silver-card>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — €39,95 per jaar plus the compulsory €17,75 membership — total €57,70 per the page's own Rekenvoorbeeld. Extra Card €19,95 per jaar. Adds car-hire excess insurance and a 24/7 travel assistance line over the Classic.
- **Trap** — MEASURED TRAP: this page also contains '29,95 per jaar' in prose ('Je hebt al een ANWB Creditcard vanaf € 29,95 per jaar'), which is the CLASSIC card's price. A first-match regex returns €29,95 for the Silver Card. Only the 'Rekenvoorbeeld' block is reliable. No koersopslag here — take the 2% from /creditcard/informatie/kosten.

#### ANWB Visa Gold Card
- **Issuer** — International Card Services B.V. (ICS) on behalf of ANWB
- **Terms** — <https://www.anwb.nl/creditcard/gold-card>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — €51,95 per jaar steady-state, but a live promo prices year 1 at €25,98 (50% korting). Compulsory €17,75 membership on top: total €43,70 in year 1, €69,70 thereafter. Extra Card €19,95 per jaar.
- **Trap** — WORST PAGE IN THE BUCKET for wrong numbers — FOUR distinct euro-per-jaar figures (€29,95 cross-reference to the Classic, €25,98 promo year 1, €51,95 steady state, €17,75 membership), and a first-match regex returns €29,95, the wrong product entirely. Only the second 'Totaalprijs' block gives the steady-state truth. Quoting the card fee alone understates real cost by ~34% across the ANWB range.

#### Nexo Card
- **Issuer** — Nexo (dual Credit/Debit mode card; the issuing e-money institution is NOT named anywhere on the page)
- **Terms** — <https://nexo.com/crypto-card>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, fxFee, interest, conditions
- **Conditions** — Cashback up to 2% is CREDIT MODE ONLY and requires joining the Loyalty Program: an account balance above $5.000 in digital assets AND at least Gold Loyalty Tier. Loyalty tier is set by your NEXO-token holding as a share of portfolio, so the top rate is effectively a token-holding requirement. Below that: no cashback.
- **Trap** — TRAP — two Nexo URLs, only one works. https://nexo.com/nexo-card returns 200 but is an empty Next.js shell (body text 0 chars; the only rate is in <meta> and JSON-LD). https://nexo.com/crypto-card returns 200 and IS server-rendered with the real FAQ. FX was readable in context: EEA/UK/CH 0,2% weekdays, 0,7% weekends; rest of world 2% weekdays, 2,5% weekends. Availability measured from their own FAQ ('selected European countries, including the EEA and the UK'). All support.nexo.com article URLs 404.

### Spaarrekeningen (34)

#### bunq Termijndeposito
- **Issuer** — bunq B.V.
- **Terms** — <https://www.bunq.com/nl-nl/personal/features/savings-accounts>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — Fixed-term deposit, 'tot 2,11%'; the page states the rate is fixed for the chosen term and 'kan veranderen voordat je een Termijndeposito opent'.
- **Trap** — Only found as a section on the savings-accounts page. A guessed dedicated URL (/nl-nl/personal/features/term-deposit) MEASURED 404 — no standalone terms page exists at that path. The page points to a 'Termijndeposito-pagina' whose real URL was not located.

#### N26 Instant Savings
- **Issuer** — N26 Bank AG; German Deposit Guarantee Scheme
- **Terms** — <https://n26.com/en-eu/savings-account>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — Covered by the German Deposit Guarantee Scheme up to €100.000. The rate is tied to your main N26 PLAN, not to the balance — the tier literally IS the rate. The page lists eligible countries and the Netherlands is among them.
- **Trap** — MEASURED CONTRADICTION between two N26 pages fetched the same day: /en-eu/savings-account and the /en-eu/metal footnote both say 0,30% Standard & Smart / 0,50% Go / 1,50% Metal, while the /en-eu/plans comparison table says 0,25% / 0,25% / 0,55% / 1,50%. Whoever collects the number must pick a source and say which.

#### Trade Republic spaarrekening (rente op kassaldo)
- **Issuer** — Trade Republic Bank GmbH; funds held at partner banks — 'je krijgt rente van onze partnerbanken'
- **Terms** — <https://traderepublic.com/nl-nl/kaart/_payload.json>
- **Measured** — `200 (payload) / 200 shell (HTML)` · readable: **yes via SSR payload** · fields on page: interest, conditions
- **Conditions** — MAJOR CONDITION and the exact failure mode to avoid: the headline 3% is labelled 'op je kassaldo tot €50.000, voor nieuwe klanten' — a NEW-CUSTOMER offer with a €50.000 cap. A second block on the SAME page says 'geen saldolimiet', so the page contradicts itself. It must also be activated manually in the app, and 'Rentes kunnen veranderen'.
- **Trap** — Same _payload.json route as the card; the plain HTML at /nl-nl is a 488-char shell and /nl-nl/pricing, /nl-nl/tarieven, /nl-nl/savings all 404. A search-result summary reported a flat 3% with no cap — never quote this rate without the new-customer clause. Note it is a broker cash-balance rate, not a Dutch spaarrekening.

#### Trading 212 interest on cash
- **Issuer** — Trading 212 Markets Ltd / Trading 212 EU GmbH; cash at third-party banks or in Qualifying Money Market Funds
- **Terms** — <https://helpcentre.trading212.com/hc/en-us/articles/15475153380637-What-is-interest-on-cash>
- **Measured** — `200` · readable: **yes (conditions only)** · fields on page: conditions
- **Conditions** — Must be enabled manually in the app. Rates published on the website apply to NEW clients only — existing accounts see their own rate in the app. No minimum or maximum balance. Interest is calculated at 22:00 GMT on free funds at that moment, so intraday balances do not count. Not a deposit account.
- **Trap** — THE RATE ITSELF IS UNREACHABLE BY FETCH. The help article explicitly points at the 'Terms & Fees' page on www.trading212.com, and that host is the Cloudflare 403. Conditions readable on helpcentre, rate readable nowhere. A jurisdiction carve-out also exists (German residents under T212 EU GmbH lost interest on non-EUR balances from 5 Jan 2026), so NL treatment should be confirmed, not assumed.

#### Bigbank Flexibel Sparen
- **Issuer** — Bigbank AS (Estonia) — Estonian DGS per geld.nl
- **Terms** — <https://www.bigbank.nl/sparen/flexibel-sparen/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — Bonusrente for new customers 2,75% guaranteed for 6 months, then the standard flexible rate (currently 2,00%). Interest only on amounts up to €250.000. A separate transitional rule applies to anyone who registered before 10-08-2026.
- **Trap** — Cleanest source in the bucket: action rate, standard rate and the 6-month window all sit next to each other in plain HTML. IMPORTANT: rates.ts's STATIC fallback still carries 3,10/2,10 for Bigbank, while both the live provider page and live geld.nl say 2,75/2,00 — the bundled snapshot is stale by 0,35pp.

#### bunq spaarrekening (MassInterest)
- **Issuer** — bunq B.V. (NL) — Dutch DGS
- **Terms** — <https://help.bunq.com/articles/what-massinterest-rate-applies-to-me>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — NOT a time-limited promo. The base rate applies up to your 'threshold'; the bonus rate applies only to savings ABOVE the threshold. Threshold = your highest balance in the previous 6 months, recalculated every 1 Jan and 1 Jul. New savers get the bonus rate on everything until their first threshold calculation. bunq's own FAQ adds that the rate depends on plan, currency and balance, and that MassInterest rates are variable with 'criteria, drempels'. Foreign-currency savings (8 currencies incl. TRY/PLN/ZAR) advertise far higher rates but the page states they are NOT DGS-covered and carry FX value risk.
- **Trap** — TRAP — geld.nl encodes this as 'actierente 3,01% t/m 01-01-2027, daarna 1,50%', which is the WRONG MECHANISM: it is a balance-threshold split, not a promo window, and an existing saver holding a flat balance ends up on the base rate for the whole balance. rates.ts would emit 'Actierente, daarna 1,50%' — misleading. Second trap: the identical '3,01%' headline appears on all four bunq plan pages, which cannot be right if the rate is plan-dependent as bunq's own FAQ says; the per-plan/per-threshold table is on no HTML page (it sits behind 'Bekijk de spaarrentetarieven en voorwaarden' and the in-app savings tab). bunq's marketing site is useless here: www.bunq.com/nl/pricing is a 200 JS shell (2.978 chars, zero percentages) and /nl/rates, /rates, /nl/interest-rates all 404. Only the help-centre article is machine-readable.

#### Santander Consumer Bank Spaarrekening
- **Issuer** — Santander Consumer Bank — the page footer shows 'RPR Gent, BTW BE0763.791.559' (Belgian entity) while geld.nl labels the DGS Spanish; the two disagree
- **Terms** — <https://www.santanderconsumerbank.nl/sparen>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — Provider page: 2,50% promotional rate for new customers for 6 months, then the base rate, currently 2,00%. A Spaardeposito is offered separately up to 2,40%, from €1.000 to €200.000.
- **Trap** — CONFLICT, UNRESOLVED — the bank's own page says 2,50%/2,00%; geld.nl says 3,01% actierente / 2,10% standaard over 6 months. Neither page carries a readable 'geldig per' date, so which is current cannot be established. Do not merge either number without a tiebreak. Domain trap: santander.nl is the wrong host and santanderconsumer.nl does not resolve at all (curl rc=6); only santanderconsumerbank.nl serves this.

#### Garanti BBVA International Gouden Internet Rekening
- **Issuer** — Garanti BBVA International N.V. (NL) — Dutch DGS per geld.nl
- **Terms** — <https://garantibank.nl/products/gouden-internet-rekening>
- **Measured** — `403 (Akamai)` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Per geld.nl: 3,00% action rate for 6 months for new savers, then 1,55%. NOT verified on the provider page — that page is blocked.
- **Trap** — Two traps. (1) The obvious domain garantibbvainternational.nl does not resolve (curl rc=6, DNS failure); the live host is garantibank.nl. (2) garantibank.nl returns a 407-byte Akamai 'Access Denied' page (reference URL errors.edgesuite.net) — the same bot-block family as ING and Rabobank. Needs the agent, not a fetch.

#### DHB Bank S@veOnlinerekening
- **Issuer** — Demir-Halk Bank (Nederland) N.V. — Dutch DGS
- **Terms** — <https://www.dhbbank.nl/dhb-saveonlinerekening>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — Standard 1,85% per annum. Welkomstactie for new customers 3,00% guaranteed for 6 months, but ONLY on amounts up to €50.000. No costs, no withdrawal penalties.
- **Trap** — geld.nl gets the 3,00/1,85/6-month triple right but has NO FIELD for the €50.000 cap, so a switching suggestion built on geld.nl alone overstates the gain for anyone holding more than 50k. The cap exists only on the provider page. Correct URLs are flat (/dhb-saveonlinerekening, /welkomstactie) — /nl/sparen and /nl/particulier/sparen both 404.

#### Anadolubank Alfa Slimmer Sparen
- **Issuer** — Anadolubank Nederland N.V. — Dutch DGS
- **Terms** — <https://www.anadolubank.nl/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — 3,00% for new savers for the first 6 months, described as an 'exclusief app-aanbod voor nieuwe spaarders'. Standard rate 1,90% per geld.nl — NOT stated on the homepage.
- **Trap** — Rates live on the ROOT page only — /sparen/ and /particulier/sparen/ both 404. Multi-product headline: the Alfa Depositorekening 2.80% (1 jaar) sits directly beside the 3,00% savings promo and is written with a DOT decimal ('2.80%') while the savings rate uses a comma ('3,00%') — a naive numeric parse mixes the two up.

#### Scalable Capital Scalable Overnight
- **Issuer** — Scalable Capital Bank GmbH (Germany) — German DGS per geld.nl
- **Terms** — <https://nl.scalable.capital/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — 2,50% p.j. on unlimited cash in the Overnight account. Footnote: with PRIME+ the cash is spread over max 5 banks for up to 5 × €100.000 of guarantee; WITHOUT PRIME+ it sits either at banks with €100.000 each OR in geldmarktfondsen (UCITS money-market funds). The rate is variable and explicitly depends on 'marktrente, capaciteiten en voorwaarden'.
- **Trap** — Not a deposit product in the normal sense — the footnote admits the money may sit in money-market funds rather than a guaranteed deposit, a materially different risk from every other row in this bucket. The RATE is not gated behind the paid PRIME+ tier (€4,99/mnd); PRIME+ only changes the deposit-guarantee spreading. Do not use de.scalable.capital/en/prime-broker — that is the German site with different products and prices.

#### Raisin spaarrekening (platform, 19 partner banks)
- **Issuer** — Raisin GmbH is the platform; the deposit is held by the partner bank (Banca Progetto, Banca CF+, FCM Bank, Inbank, Morrow Bank, Nordax Bank, Renault Bank, Avarda Bank, Lea Bank, BW-Bank, Resurs Bank, Collector, Carrefour Banque S.A, Imprebanca, Izola Bank, EuroExtra, Klarna, Bank B, Alisa Bank)
- **Terms** — <https://www.raisin.nl/spaarrekening/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — Per-partner, not per-platform. geld.nl labels several rows 'Spaarrekening met voorwaarden' (Banca Progetto, Banca CF+, Imprebanca, Izola) and Lea Bank as 'Spaarrekening met opzegtermijn' — i.e. a NOTICE PERIOD, so not freely withdrawable. The deposit guarantee is the partner bank's home-country scheme, spread across IT/MT/EE/SE/FR/DE/BE/FI.
- **Trap** — The landing-page headline ('Tot 3,05%', and elsewhere 'tot wel 3,60%') is a marketing rollup across all partners and all terms — not a rate. The USABLE source is the per-partner page at raisin.com/nl-nl/banken/<slug>/, verified for Klarna (200, readable, clean table). The other 18 partner pages were NOT fetched — the pattern is verified on one and assumed for the rest. BUG this exposes in rates.ts: it sets freeWithdrawal:true for every geld.nl 'Spaarrekening' row, which is FALSE for Lea Bank's opzegtermijn product and unverified for the four 'met voorwaarden' products. The condition is right there in geld.nl's own productnaam field, unread.

#### Klarna Flex rekening
- **Issuer** — Klarna Bank AB (Sweden) — Swedish DGS
- **Terms** — <https://www.klarna.com/nl/flex-rekening/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, annualFee
- **Conditions** — 1,95% with a footnote marker; 'geen beheerkosten, geen minimumbedrag'. No promo window visible.
- **Trap** — TRAP — Klarna appears TWICE on geld.nl at two different rates through two different channels: direct 'Klarna Flex spaarrekening' 1,95% and 'Klarna (via Raisin)' 1,80%. Same bank, same guarantee scheme, 0,15pp apart. rates.ts's dedupe-by-bank keeps both only because the strings differ; normalising the bank name would silently drop one. Correct URL is /nl/flex-rekening/ — /nl/sparen/, /nl/spaarrekening/ and /nl/spaargeld/ all 404.

#### Ayvens Bank Flexibel Sparen
- **Issuer** — Ayvens Bank N.V. (formerly LeasePlan Bank, renamed Oct 2024) — Dutch DGS
- **Terms** — <https://www.ayvensbank.nl/actuele-rentestanden>
- **Measured** — `200` · readable: **yes** · fields on page: interest
- **Conditions** — None visible for the flexible account — 1,85% flat, no promo, no tier, no minimum on this page. A deposito ladder sits alongside it: 3m 1,30% / 6m 1,60% / 9m 1,60% / 1y 2,45% / 2y 2,55% / 3y 2,65% / 4y 2,80% / 5y 3,00%.
- **Trap** — 'LeasePlan Bank' NO LONGER EXISTS as a brand — do not search for it. The page is partly React ('Loading component…' placeholders survive stripping) but the 1,85% and the whole deposito ladder ARE in the static HTML. Careful: the deposito ladder renders inside a CALCULATOR dropdown, so the highest number on the page (3,00%) is a 5-year lock-up, not the savings rate. /sparen/flexibel-sparen 404s; use /actuele-rentestanden.

#### Argenta Internetspaarrekening
- **Issuer** — Argenta Spaarbank N.V., Dutch branch — Belgian DGS per geld.nl
- **Terms** — <https://www.argenta.nl/sparen/>
- **Measured** — `200` · readable: **marketing-only** · fields on page: interest (wrong product only)
- **Conditions** — Not stated for the internetspaarrekening on this page. geld.nl: 1,80%, no action rate.
- **Trap** — TRAP — the ONLY rate rendered on argenta.nl/sparen/ is '2,50% 1 jaar vast Termijndeposito'. The internetspaarrekening's own 1,80% is NOT on the page (it sits behind a 'Bekijk alle spaarrentes' link) and /sparen/internetspaarrekening 404s. Anyone scraping the visible figure records the deposito rate as the savings rate — a 0,70pp error in the wrong direction.

#### Openbank Welkom Spaarrekening
- **Issuer** — Open Bank S.A. (Santander Group, Madrid) — Spanish DGS
- **Terms** — <https://www.openbank.nl/spaarrekening>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — 2,80% only for the FIRST SIX MONTHS, only for NEW customers, only with promo code WELKOM, and only on balances up to €1.000.000 (0,00% above that). Opening it forces you to also open an Open Betaalrekening plus the R42 betaalpas. After month six it auto-converts into the ordinary Open Spaarrekening at that account's lower rate and its €300.000 cap.
- **Trap** — BIGGEST COVERAGE GAP IN THE SWEEP — geld.nl lists Openbank at 1,80%/1,80% with an EMPTY actierente field, so LaVega currently cannot see the 2,80% welcome rate at all. That is a 1,00pp understatement: geld.nl will FAIL to recommend a switch that is genuinely one of the best flexible offers on the list. The mirror image of the overstatement risk, and it needs its own source. Openbank also publishes a precontractual PDF at /assets/static/nl/pdf/Products/Precontractuele_informatie_Welkom_Spaarrekening.pdf (surfaced in search, not fetched). Fully static HTML, easily parsed.

#### Openbank Open Spaarrekening
- **Issuer** — Open Bank S.A. (Santander Group, Madrid) — Spanish DGS
- **Terms** — <https://www.openbank.nl/gratis-spaarrekening>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — 1,80% on balances up to €300.000; ABOVE €300.000 THE RATE IS 0,00%, stated explicitly on the page. Open to both new and existing customers. Free to open, hold and close; money withdrawable at any time; interest paid monthly. Requires an Open Betaalrekening alongside it.
- **Trap** — The clearest, most honest page in the whole sweep — rate, cap, the 0,00% above the cap and a worked example all sit in context. This is the STANDARD rate an existing customer actually gets, and it matches geld.nl exactly. Note /open-spaarrekening 404s; the terms are also described inside the Welkom Spaarrekening page's FAQ at /spaarrekening. Deposit protection is SPANISH, not Dutch, which matters for a 'switch to X' recommendation.

#### Yapi Kredi Bank Euro-Plus Spaarrekening
- **Issuer** — Yapi Kredi Bank Nederland N.V. — Dutch DGS
- **Terms** — <https://www.yapikredi.nl/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — 3,30% 'jubileumsrente' for NEW customers for three months, tied to the bank's 30-year anniversary. The page is explicitly dated: 'Rentetarieven (per 17 augustus)'. Actievoorwaarden sit behind a link that was not opened.
- **Trap** — geld.nl IS STALE HERE — it lists Yapi Kredi at 1,80% with standaardrente 1,79% and NO actierente flag, while the bank's own dated page advertises 3,30% for new customers. A 1,50pp miss, dated one day before it was measured. Rates live on the ROOT page (/sparen/ 404s). Multi-product: three Euro-Plus Deposito rows (3,10% 1y / 3,20% 2y / 3,35% 5y) sit in the SAME table as the spaarrekening.

#### NIBC Spaarrekening
- **Issuer** — NIBC Bank N.V. — Dutch DGS
- **Terms** — <https://www.nibc.nl/sparen/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — 1,55%, monthly interest payment, no minimum deposit, no costs, freely withdrawable. No promo.
- **Trap** — geld.nl lists NIBC TWICE (Spaarrekening 1,54% and Kwartaalspaarrekening 1,60%) and rates.ts's dedupe-by-bank throws THIS one away, keeping only the Kwartaalspaarrekening. Small discrepancy too: geld.nl says 1,54%, NIBC's own page says 1,55%.

#### NIBC Kwartaalspaarrekening
- **Issuer** — NIBC Bank N.V. — Dutch DGS
- **Terms** — <https://www.nibc.nl/sparen/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — Written as 'tot 1,60%': the base is a monthly interest payment PLUS a bonusrente per kwartaal, so 1,60% is the CEILING, not the guaranteed rate. Freely withdrawable, no minimum deposit.
- **Trap** — TRAP — the page's own <title> is 'Alles over sparen | Tot 3,01% rente' and 3,01% is the TERMIJNDEPOSITO, not either savings account. A title-scrape or a max()-over-percentages yields 3,01%, nearly double the real flexible rate. Three products on one URL. geld.nl flattens the 'tot' qualifier into a flat 1,60%.

#### Lloyds Bank Spaarrekening
- **Issuer** — Lloyds Bank GmbH — German DGS per geld.nl
- **Terms** — <https://www.lloydsbank.nl/sparen/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — 1,50% variable. No minimum deposit and no costs; you use your own betaalrekening as tegenrekening. No promo visible.
- **Trap** — Matches geld.nl exactly. Watch the URL: the lloydsbank.nl root is almost entirely mortgages and /sparen/spaarrente/ 404s. Only /sparen/ works.

#### Nationale-Nederlanden Internetsparen
- **Issuer** — Nationale-Nederlanden Bank N.V. — Dutch DGS
- **Terms** — <https://www.nn.nl/Particulier/Sparen/Internetsparen.htm>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — The 1,30% variable rate is explicitly 'voor saldo tot en met EUR 25.000,-'. Rates above that band sit behind a 'Bekijk alle rentes' link that was not opened — so the headline is a TIER CEILING, not a flat rate.
- **Trap** — Use the Internetsparen deep link, not the hub: nn.nl/Particulier/Sparen.htm returns 200 but strips to 2.202 chars of nav with zero rate content (one stray 2,30% in raw HTML that does not survive stripping — exactly the CSS/percent-sign artefact trap). geld.nl reports a flat 1,30% and therefore OVERSTATES the return for anyone holding more than €25.000.

#### Centraal Beheer RentePlús Rekening
- **Issuer** — Achmea Bank N.V. (Centraal Beheer) — Dutch DGS
- **Terms** — <https://www.centraalbeheer.nl/sparen>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — The page reads 'Actuele rente per 10-07-2025: maximaal 1,50%' — note both the word MAXIMAAL (tiered/capped, not flat) and the date, which is over a year old at time of measurement.
- **Trap** — The only page in the sweep that timestamps its own rate, and the timestamp is STALE (10-07-2025). geld.nl currently agrees (1,50% / 1,49% standaard) so the figure is probably still live, but the provider page cannot be used to confirm freshness. Multi-product: the RenteVast Rekening 3,00% (10-year lock-up) sits directly below and is the largest number on the page.

#### Knab Flexibel Sparen
- **Issuer** — Knab (Aegon Bank N.V. / BAWAG Group) — Austrian DGS per geld.nl
- **Terms** — <https://www.knab.nl/sparen>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions, annualFee
- **Conditions** — 1,25% variable, free deposits and withdrawals, no minimum. The knab.nl/tarieven page shows the same 1,25% across all THREE published bands (to €25.000, €25.000–€100.000, above €100.000) — the tiering exists in the table but the rate does not actually vary, which is easy to mis-transcribe as a ladder; the balance limit applies to the total across all Flexibele Spaarrekeningen in the package. Separately /sparen runs an action described as 'Bonusrente 0,75% + Variabele rente 1,25%' for a defined group. Deposito Sparen is a separate fixed-term product (1,80% 1y, 1,90% 2y, 2,00% 3y, 2,05% 4y per /tarieven; 2,10% at 5y per /sparen).
- **Trap** — SAME MULTI-PRODUCT TRAP AS THE KNAB CARD PAGE, and it appears on BOTH Knab URLs. /sparen carries four rates at once (Flexibel 1,25%, Deposito 2,10%* at 5 years, Pensioensparen 2,50%* at 5–20 years, and the 0,75%+1,25% bonus action), so a model asked for 'the Knab savings rate' can plausibly return 2,50%, 2,10% or 2,00% — all wrong. /tarieven carries the same account next to the betaalpas and creditcard blocks. geld.nl carries the plain 1,25% and does NOT carry the 0,75% bonusrente action.

#### ABN AMRO Direct Sparen
- **Issuer** — ABN AMRO Bank N.V. — Dutch DGS
- **Terms** — <https://www.abnamro.nl/nl/prive/sparen/rente.html>
- **Measured** — `200` · readable: **marketing-only** · fields on page: none
- **Conditions** — Unknown — nothing readable. geld.nl: 1,25% with standaardrente 1,24%.
- **Trap** — CONFIRMS THE ABN SHELL FINDING, now for savings. Three URLs measured, all 200 and all ~1,1MB: /nl/prive/sparen/rente.html, /nl/prive/sparen/rente/index.html and /nl/prive/sparen/direct-sparen.html. All three strip to ~10.000 chars of pure navigation with ZERO percentage figures of any kind. The rate table is client-rendered. Note this is the OPPOSITE of ABN's card tariffs, where the buitenlands-geld sibling page IS readable — ABN is readable for cards and not for savings.

#### ING Oranje Spaarrekening
- **Issuer** — ING Bank N.V. — Dutch DGS
- **Terms** — <https://www.ing.nl/particulier/sparen/spaarrente>
- **Measured** — `connection killed` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Unknown — unreachable. geld.nl: 1,25%, no action rate.
- **Trap** — Re-measured twice: HTTP/2 dies with curl error 92 'stream 1 was not closed cleanly: INTERNAL_ERROR', and forcing --http1.1 dies with curl error 56 'Recv failure: Operation timed out'. Akamai kills the connection rather than answering. No fetch strategy will work. geld.nl is the only source.

#### Rabobank Rabo SpaarRekening
- **Issuer** — Coöperatieve Rabobank U.A. — Dutch DGS
- **Terms** — <https://www.rabobank.nl/particulieren/sparen/rente>
- **Measured** — `403` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Unknown — blocked. geld.nl: 1,50%, no action rate.
- **Trap** — 403 with an 18KB Dutch SOFT-ERROR page ('Sorry, er gaat iets niet goed…') rather than a hard block page — easy to mistake for a real page if you only check that bytes>0. Always check the status code, not the body size.

#### ASN Bank ASN Ideaalsparen
- **Issuer** — ASN Bank (de Volksbank N.V.) — Dutch DGS
- **Terms** — <https://www.asnbank.nl/sparen/rente.html>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — TIERED, not flat: €0–25.000 → 1,30%; €25.000–50.000 → 1,20%; €50.000–100.000 → 1,20%; above €100.000 → 1,00%. Rentepercentages gelden vanaf 18 november 2025.
- **Trap** — A NASTY TRAP. The page is DOMINATED by ASN Pensioendeposito and Pensioen Uitkeringsrekening ladders running '10 jaar vast 2,70% … 20 jaar vast 3,10% … 30 jaar vast 3,20%'. The savings table is a small block among them. Taking the largest percentage gives 3,20% against a real flexible rate of 1,30% — a 1,90pp error. Name mismatch too: geld.nl calls it 'ASN Ideaalsparen', ASN's own page calls it 'ASN Sparen'.

#### SNS Internet Sparen
- **Issuer** — SNS Bank (de Volksbank N.V.) — Dutch DGS
- **Terms** — <https://www.snsbank.nl/particulier/sparen/rente-spaarrekeningen.html>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — TIERED: €0–25.000 → 1,30%; €25.000–100.000 → 1,20%; above €100.000 → 1,00%. Variable rate per annum, vanaf 23 oktober 2025.
- **Trap** — MISSING FROM GELD.NL ENTIRELY — SNS does not appear in any of the 46 rows on geld.nl's spaarrente overview, so LaVega currently cannot see one of the largest retail savings accounts in the Netherlands. Needs its own source. Also: the /particulier/sparen.html hub is 200 but strips to 6.516 chars with zero percentages; only the rente-spaarrekeningen.html deep link carries the table — which holds FIVE tiered tables at once (Zilvervloot Sparen 1,50%, SNS Jeugdsparen 1,70%, SNS Jongeren Sparen 1,50/1,20/1,00 and beleggingsrekening cash rates).

#### RegioBank Spaar-op-Maat Vrij
- **Issuer** — RegioBank (de Volksbank N.V.) — Dutch DGS
- **Terms** — <https://www.regiobank.nl/sparen/actuele-rentes.html>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Openable by a Dutch resident** — **no**
- **Conditions** — CLOSED TO NEW CUSTOMERS. The page states in two places: 'Nog geen klant bij RegioBank? … Ga dan naar ASN Bank' and 'Goed om te weten: RegioBank is nu ASN Bank.' Existing customers keep tiered rates: €0–25.000 → 1,30%; €25.000–100.000 → 1,20%; €100.000+ → 1,00% (vanaf 18 november 2025).
- **Trap** — availableToNL is FALSE on purpose — a Dutch resident who is not already a RegioBank customer cannot open this, so it must NEVER appear in a 'switch to X' suggestion even though the rate table is live and readable. Correctly absent from geld.nl. URL trap: every /particulier/… path 404s; the working paths are /sparen/actuele-rentes.html and /sparen/spaar-op-maat-vrij.html.

#### Triodos Bank Internet Sparen
- **Issuer** — Triodos Bank N.V. — Dutch DGS
- **Terms** — <https://www.triodos.nl/sparen>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — TIERED: up to €10.000 → 1,15%; €10.000–25.000 → 0,90%; €25.000–100.000 → 0,90%; above that → 0,80%. Sinds 01-02-2026, wijzigingen voorbehouden. No minimum deposit, unlimited deposits and withdrawals.
- **Trap** — geld.nl reports a flat 1,15%, which is only true on the FIRST €10.000 — at €50.000 the blended rate is materially lower, so a switching suggestion built on the geld.nl figure OVERSTATES the gain. Multi-product page: Triodos Spaar Deposito 2,00% (1 jaar), a kinderrekening 'tot 1,75%', Zakelijke Spaarrekening 1,15% and Zakelijk Spaar Deposito 2,00% all share the URL.

#### Brand New Day De Spaarrekening
- **Issuer** — Brand New Day Bank N.V. — Dutch DGS
- **Terms** — <https://new.brandnewday.nl/spaarrekening/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — Per the new site: variable rate, 'op dit moment 1,30%'. No interest on savings above €1 million. Deposito ladder alongside: 1y 1,30% / 2y 1,30% / 3y 1,50% / 4y 1,75% / 5y 1,90%.
- **Trap** — WORST TRAP IN THE SWEEP — Brand New Day runs TWO live official sites that CONTRADICT each other on the same product. new.brandnewday.nl/spaarrekening/ returns 200 and says 1,30%; www.brandnewday.nl/sparen.html ALSO returns 200 and says 'Brand New Day Spaarrekening 0,25% per jaar'. A 1,05pp gap between two pages the bank itself serves, and the STALE one sits on the primary www domain and outranks the new one. geld.nl backs 1,30%, which is the tiebreak used — but neither page is dated, so this is an inference, not a proof. Additional noise: www.brandnewday.nl/, /sparen, /spaarrekening, /particulier/sparen and /producten/spaarrekening all 404 or are JS shells.

#### Nexent Bank Spaarrekening
- **Issuer** — Nexent Bank N.V. — Dutch DGS per geld.nl
- **Terms** — <https://www.nexentbank.nl/>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — 2,75% welkomstrente for THREE months, and only on 'je eerste Nexent Bank Spaarrekening' — new-account-only, and a 3-month window rather than the 6 months most competitors run. Standard rate 1,25% per geld.nl, not stated on the homepage.
- **Trap** — geld.nl MISSES THIS ACTION RATE — it lists Nexent at 1,25%/1,25% with an empty actierente field, a 1,50pp understatement. The second of three geld.nl action-rate blind spots alongside Openbank and Yapi Kredi. Rates on the root only (/sparen/ 404s). Multi-product headline: a Termijndeposito 3,65% (10 jaar) is the biggest number on the page.

#### Revolut Dagelijkse Spaarrekening
- **Issuer** — Revolut Bank UAB (Lithuania) — Lithuanian DGS per geld.nl
- **Terms** — <https://www.revolut.com/nl-NL/savings/>
- **Measured** — `403 (Cloudflare)` · readable: **bot-blocked** · fields on page: none
- **Conditions** — Could NOT verify. Revolut savings rates are plan-tiered in other markets, but no page was reached that shows it, so nothing is asserted. geld.nl: 1,00%, no action rate.
- **Trap** — 403, and note the body is 873KB — a full Cloudflare interstitial, not a small error page. SIZE IS NO EVIDENCE OF CONTENT. Both /nl-NL/savings/ and /nl-NL/current-accounts/ behave identically.

### Beleggings- en rentefondsen (5)

#### bunq beleggingsrekening
- **Issuer** — Ginmon (execution/custody) inside the bunq app
- **Terms** — <https://www.bunq.com/nl-nl/personal/plans/bunq-pro>
- **Measured** — `200` · readable: **yes** · fields on page: conditions
- **Conditions** — From €10; 3 months zero trading fee, then a plan-dependent discount (Pro 20%, Elite 50%). The BASE fee that the discount applies to is NOT stated on any page read.
- **Trap** — No standalone terms page found; the only figures live inside the plan pages. bunq's own disclaimer says 'Investment features have separate terms'. A discount off an unpublished base is not a price.

#### N26 flexible cash fund
- **Issuer** — Fidelity International (fund manager), distributed by N26
- **Terms** — <https://n26.com/en-eu/metal>
- **Measured** — `200` · readable: **yes** · fields on page: interest, conditions
- **Conditions** — NOT a deposit — a money-market fund, capital at risk, no DGS. The advertised return is 'net of fees', variable, as of a stated date, with a suggested 6-month minimum holding period and up to 2 business days to withdraw.
- **Trap** — Sits next to N26 Instant Savings in the same marketing block, so a fund yield is easy to mistake for a savings rate. It is not a savings rate.

#### Wise Rente
- **Issuer** — Wise Assets Europe AS
- **Terms** — <https://wise.com/nl/pricing/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — 'Risicodragend kapitaal. Groei niet gegarandeerd.' It is a fund, not a deposit account. Annual cost from 0,26%. The YIELD is not on the pricing page — only the cost.
- **Trap** — Do not file this as a spaarrekening; Wise deliberately publishes the cost, not a rate. Regulated by a different Wise entity from the payments business.

#### Wise Aandelen
- **Issuer** — Wise Assets Europe AS
- **Terms** — <https://wise.com/nl/pricing/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — Capital at risk; annual cost from 0,59%.
- **Trap** — Listed as a separate line on Wise's own price list, next to Wise Rente.

#### Trading 212 beleggingsrekening
- **Issuer** — Trading 212 Markets Ltd / Trading 212 EU GmbH
- **Terms** — <https://helpcentre.trading212.com/hc/en-us/articles/30752021087005-What-fees-does-Trading-212-charge-for-crypto-trading>
- **Measured** — `200` · readable: **yes (conditions only)** · fields on page: conditions
- **Conditions** — Crypto sub-account: zero commission and zero custody fee, but a variable SPREAD is built into the price — that is the real cost and it is not quoted as a number. No crypto deposits or withdrawals, fiat only. Min deposit €1, min order €2.
- **Trap** — 'Trading commission: Free' next to 'Spread cost: variable' is exactly the shape of a headline that reads as free and is not. The equities/ETF fee schedule lives on the blocked www host, not on helpcentre.

### Prepaid (6)

#### Crypto.com Prepaid Card — Basic (Midnight Blue)
- **Issuer** — Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)
- **Terms** — <https://crypto.com/nl/cards>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, annualFee, conditions
- **Conditions** — Free tier, but CRO Rewards on everyday spending measure 0% — THIS CARD EARNS NO CASHBACK. Free ATM withdrawals €200/mo, ATM cap €10.000/mo, top-up cap €25.000/mo.
- **Trap** — Multi-product page: ONE table holds all five EUR tiers side by side and the table is rendered TWICE — desktop order Midnight→Obsidian, then a mobile block in REVERSE order Obsidian→Midnight. A model skimming it will pair the wrong percentage with the wrong tier. The page headline 'Earn Up to 5% back' is the €450.000-lockup Obsidian tier, not an achievable base. Ignore the '8%' review sites quote — that is the US Prime/Visa Signature credit card, a different product.

#### Crypto.com Prepaid Card — Plus (Ruby Steel)
- **Issuer** — Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)
- **Terms** — <https://crypto.com/nl/cards>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, annualFee, conditions
- **Conditions** — 2% CRO rewards, CAPPED at $25/month of rewards. Requires EITHER a €3,99/month (or €39,90/year) subscription OR a €450 12-month CRO lockup. Rebates (3 months Spotify/Truth+) only for annual subscribers or an active CRO lockup.
- **Trap** — The 2% is payable only while enrolled in Level Up. Crypto.com's own help page states it plainly: 'Cardholders who do not participate in the Level Up program will not be eligible for the listed benefits.'

#### Crypto.com Prepaid Card — Pro (Jade Green / Royal Indigo)
- **Issuer** — Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)
- **Terms** — <https://crypto.com/nl/cards>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, annualFee, conditions
- **Conditions** — 3% CRO rewards, CAPPED at $75/month. Requires EITHER a €24,99/month (or €249,90/year) subscription OR a €4.500 12-month CRO lockup. Lounge access only for annual subscribers, capped 4x/year.
- **Trap** — Jade Green and Royal Indigo are the SAME tier in different colours — one product, two skins. Do not split them.

#### Crypto.com Prepaid Card — Private (Icy White / Rose Gold)
- **Issuer** — Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)
- **Terms** — <https://crypto.com/nl/cards>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, annualFee, conditions
- **Conditions** — 4% CRO rewards, no monthly cap. Requires a €45.000 12-month CRO lockup. NO subscription route exists at this tier — lockup only.
- **Trap** — Icy White and Rose Gold are the same tier. The page marks both with footnote 1 (invitation/eligibility caveat).

#### Crypto.com Prepaid Card — Private (Obsidian)
- **Issuer** — Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)
- **Terms** — <https://crypto.com/nl/cards>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, annualFee, conditions
- **Conditions** — 5% CRO rewards, no monthly cap. Requires a €450.000 12-month CRO lockup.
- **Trap** — This is the source of the headline 'up to 5%'. Any catalogue that prints '5%' next to Crypto.com without the €450.000 lockup is misleading.

#### paysafecard (prepaid code / PaysafeWallet)
- **Issuer** — Paysafe
- **Terms** — <https://www.paysafecard.com/nl-nl/kosten-limieten/>
- **Measured** — `200` · readable: **yes** · fields on page: annualFee, conditions
- **Conditions** — No cashback and no interest — recorded as a FINDING, not a gap. Costs measured in context: an activation fee of €3/month deducted from the remaining balance from the 2nd month onward; 'inruilkosten' of €7,50 per redemption; an account fee from the 13th month if there has been no transaction in 12 months. Limit: maximum €50 per payment.
- **Trap** — Include with care — this is a prepaid VOUCHER CODE for online payments, not a general-purpose Visa/Mastercard, so it does not compete on a LaVega travel/spend journey. URL trap: /nl-nl/kosten/, /nl-nl/kosten-en-limieten/ and /nl-nl/support/kosten-en-limieten/ are all 404; the working path is /nl-nl/kosten-limieten/ (no 'en'). The fee page's first ~1.500 stripped characters are the region/language picker listing every country — real content starts at 'Alle kosten en limieten in een oogopslag'. Do not conclude 'marketing-only' from the top of the page.

### Crypto-rail cards (7)

#### bunq crypto
- **Issuer** — Payward Europe Solutions Ltd t/a Kraken (Central Bank of Ireland); staking by Payward Commercial Ltd
- **Terms** — <https://www.bunq.com/nl-nl/personal/plans>
- **Measured** — `200` · readable: **yes** · fields on page: conditions
- **Conditions** — Buy/sell from €1. Staking is explicitly flagged unregulated with slashing risk, and Kraken retains 25% of staking rewards as commission — the disclaimer states displayed APRs EXCLUDE that commission.
- **Trap** — That 25% carve-out is exactly what a headline staking APR hides, and it is only in the small print at the bottom of the plans page, not on any crypto feature page.

#### Bleap Card
- **Issuer** — Bleap SIA (Latvia), Mastercard debit, self-custodial
- **Terms** — <https://www.bleap.finance/en-us/card/cashback>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, conditions
- **Conditions** — Genuinely UNCONDITIONAL as stated on their own page: 'There are no opt-ins, no promo windows, and no hoops to jump through' and 'Unlimited cashback'. No token to stake, no subscription. Per-category rates measured in context: everything else 1%, restaurants 2%, supermarkets 2%, rides 3%, food delivery 3%, streaming 20%, AI 20%, gaming 20%.
- **Trap** — THE ONLY CARD IN THIS BUCKET whose headline is not gated behind a token stake — but the 20% applies only to Streaming/AI/Gaming, so 'up to 20% cashback' in the page title is category-specific, not a general rate. URL trap: the bare host bleap.finance 404s on /en-us/cashback, /en-us/pricing and /en-us/legal; the working paths are on www.bleap.finance. The Pricing Disclosure (200, readable, updated 12 Mar 2026) covers buy/sell/network/processing fees and spreads and says NOTHING about card cashback — do not mine it for rates. 'No FX markup' is claimed on the marketing card page only, with no figure.

#### Zeal Card (Gnosis Pay rails)
- **Issuer** — Monavate Limited (UK, FCA EMI, FRN 901097) with Gnosis Pay Co Ltd — Visa debit
- **Terms** — <https://www.zeal.app/>
- **Measured** — `200` · readable: **yes** · fields on page: cashback, fxFee, interest, conditions
- **Conditions** — Footnote 3 measured verbatim: 'The cashback program is managed by Gnosis Pay… To be eligible for cashback, you must hold GNO in your Gnosis Pay card Safe. The amount of cashback you earn is determined by the amount of GNO you hold.' So 'up to 4%' is a GNO token-holding ladder, and the ladder itself is NOT on Zeal's page — it lives in Gnosis Pay documentation. Separately, 'earn 5%' refers to DeFi yield (Sky/Aave sDAI/EURe), not the card, and their own disclaimer says principal is at risk with no deposit insurance.
- **Trap** — This is the consumer front-end you actually sign up to for a Gnosis Pay card. FX measured: Visa wholesale rate, Zeal charges no additional FX fee, but Gnosis Pay ATM fees may apply. Two different footnote systems on one page — read the 'FOR CARD:' block, not 'FOR BANK TRANSFERS:'. Also note 'Zeal is a self-custodial software and as such is NOT regulated in any jurisdiction.'

#### Gnosis Pay Card (direct consumer)
- **Issuer** — Gnosis Pay Co Ltd / Monavate Limited
- **Terms** — <https://gnosispay.com/>
- **Measured** — `200 homepage; 404 on /card, /pricing and /personal` · readable: **marketing-only** · fields on page: none
- **Openable by a Dutch resident** — **no**
- **Conditions** — none readable on any page reached.
- **Trap** — MEASURED PIVOT — gnosispay.com is now a B2B page: 'White-label infrastructure for instant card issuance, fiat rails, and multi-currency accounts. Book a demo / View API docs.' No consumer offer, no pricing, no cashback figure. app.gnosispay.com returns 200 but is a 3KB shell. A Dutch person cannot sign up with Gnosis Pay directly; they reach the same card through a front-end such as Zeal. Affiliate reviews still describe a consumer 'Gnosis Pay Card with up to 5% GNO cashback' — that is stale.

#### Wirex Card (Wirex One)
- **Issuer** — Wirex; card issuer previously UAB PayrNet, current EEA issuer not stated on any readable page
- **Terms** — <https://www.wirexapp.com/>
- **Measured** — `200` · readable: **marketing-only** · fields on page: none
- **Conditions** — No rate, cap or staking figure appears on any readable Wirex page. The old Cryptoback 'up to 8%' required WXT staking plus a plan of up to €29,99/month — and that programme is GONE in the EEA. Wirex One's rates are not published anywhere fetchable.
- **Trap** — Two traps. (1) DOMAIN: wirex.com does not connect at all; the live host is www.wirexapp.com. (2) PRODUCT SPLIT: Wirex's own blog (200, readable) confirms EEA Classic users are being pushed to 'Wirex One', with posts dated 9 and 30 June 2026, and that the Classic app's crypto features and Cryptoback rewards ENDED in the EEA on 30 June 2026, leaving a fiat card. So a Dutch person today signs up to Wirex One, NOT the 8%-Cryptoback product every review still describes. The homepage (4,9MB) strips to pure navigation; help.wirexapp.com is 200 but strips to 1.043 chars (JS shell); /eu/fees and /en/fees are 404.

#### Tria Card
- **Issuer** — Tria (self-custodial Visa; issuing EMI not stated)
- **Terms** — <https://www.tria.so/>
- **Measured** — `200` · readable: **marketing-only** · fields on page: none
- **Openable by a Dutch resident** — **unverified**
- **Conditions** — Not obtainable. Affiliate sites quote three paid tiers (Virtual $25/yr, Signature $109/yr, Premium $250/yr) and 'up to 6% on a capped monthly spend' — none of that is on tria.so, so it is unsourced.
- **Trap** — Real, live product (homepage 200, server-rendered, advertises 'spend with your Visa card' and 'up to 15% APY'), but there is NO card page: www.tria.so/cards is 404, and the homepage carries no rate, no fee and no country list. availableToNL is flagged UNVERIFIED rather than guessed — an unconfirmed product is not a product. The row exists so the next stage knows to look, not so anyone prices it.

---

## Readable by fetch (101 products, 82 URLs)

A scheduled job can simply read these. Cheap and exact. Grouped by the URL it should fetch, because
**one page often carries several products** — the Knab, Crypto.com, ANWB and ICS-business pages are all
multi-product, and anchoring on the first percentage found is exactly how the wrong number gets in.

| URL | Products it carries |
|---|---|
| `https://www.abnamro.nl/nl/prive/betalen/tarieven/buitenlands-geld.html` | ABN AMRO betaalpas |
| `https://www.icscards.nl/abnamro/klantenservice/betalen/contant-geld-opnemen` | ABN AMRO creditcard |
| `https://www.icscards.nl/abnamro` | ABN AMRO Gold Card |
| `https://www.snsbank.nl/particulier/betalen/service/betalen-in-het-buitenland.html` | SNS betaalpas |
| `https://www.snsbank.nl/particulier/betalen/sns-visa-credit-card/kosten-van-je-creditcard.html` | SNS creditcard |
| `https://www.asnbank.nl/service/asn-betaalpas/betalen-buitenland.html` | ASN betaalpas |
| `https://www.asnbank.nl/betalen/asn-creditcard/kosten-asn-creditcard.html` | ASN Creditcard |
| `https://www.regiobank.nl/service/betalen/buitenland.html` | RegioBank betaalpas |
| `https://www.regiobank.nl/downloads/tarievenwijzer-betalen-1.html` | RegioBank creditcard |
| `https://www.knab.nl/tarieven` | Knab betaalpas; Knab creditcard |
| `https://www.bunq.com/nl-nl/personal/plans/bunq-free` | bunq Free betaalpas |
| `https://www.bunq.com/nl-nl/personal/plans/bunq-core` | bunq Core betaalpas |
| `https://www.bunq.com/nl-nl/personal/plans/bunq-pro` | bunq Pro betaalpas; bunq beleggingsrekening |
| `https://www.bunq.com/nl-nl/personal/plans/bunq-elite` | bunq Elite betaalpas |
| `https://www.bunq.com/nl-nl/personal/features/credit-card` | bunq creditcard |
| `https://www.bunq.com/nl-nl/personal/features/savings-accounts` | bunq Termijndeposito |
| `https://www.bunq.com/nl-nl/personal/plans` | bunq crypto |
| `https://www.bunq.com/nl-nl/business/plans` | bunq Free Business betaalpas; bunq Core Business betaalpas; bunq Pro Business betaalpas; bunq Elite Business betaalpas |
| `https://n26.com/en-eu/plans` | N26 Standard betaalpas; N26 Smart betaalpas; N26 Go betaalpas |
| `https://n26.com/en-eu/metal` | N26 Metal betaalpas; N26 flexible cash fund |
| `https://n26.com/en-eu/savings-account` | N26 Instant Savings |
| `https://wise.com/nl/pricing/` | Wise betaalpas; Wise Rente; Wise Aandelen |
| `https://traderepublic.com/nl-nl/kaart/_payload.json` | Trade Republic betaalpas; Trade Republic spaarrekening (rente op kassaldo) |
| `https://helpcentre.trading212.com/hc/en-us/articles/19288398028317-What-are-the-fees-for-using-the-212-card` | 212 Card |
| `https://helpcentre.trading212.com/hc/en-us/articles/15475153380637-What-is-interest-on-cash` | Trading 212 interest on cash |
| `https://helpcentre.trading212.com/hc/en-us/articles/30752021087005-What-fees-does-Trading-212-charge-for-crypto-trading` | Trading 212 beleggingsrekening |
| `https://www.openbank.nl/betaalrekening` | Openbank betaalpas (R42 Betaalpas) |
| `https://www.americanexpress.com/nl-nl/creditcard/blue-card/` | American Express Blue Card |
| `https://www.americanexpress.com/nl-nl/creditcard/green-card/` | American Express Green Card |
| `https://www.americanexpress.com/nl-nl/creditcard/gold-card/` | American Express Gold Card |
| `https://www.americanexpress.com/nl-nl/creditcard/platinum-card/` | American Express Platinum Card |
| `https://www.americanexpress.com/nl-nl/creditcard/flying-blue-entry-card/` | Flying Blue - American Express Entry Card |
| `https://www.americanexpress.com/nl-nl/creditcard/flying-blue-silver-card/` | Flying Blue - American Express Silver Card |
| `https://www.americanexpress.com/nl-nl/creditcard/flying-blue-gold-card/` | Flying Blue - American Express Gold Card |
| `https://www.americanexpress.com/nl-nl/creditcard/flying-blue-platinum-card/` | Flying Blue - American Express Platinum Card |
| `https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-entry-card/` | American Express Business Entry Card |
| `https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-green-card/` | American Express Business Green Card |
| `https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-gold-card/` | American Express Business Gold Card |
| `https://www.americanexpress.com/nl-nl/zakelijk/kaarten/corporate-card/` | American Express Corporate Card |
| `https://www.americanexpress.com/nl-nl/zakelijk/kaarten/corporate-gold-card/` | American Express Corporate Gold Card |
| `https://www.americanexpress.com/nl-nl/zakelijk/kaarten/corporate-klm-card/` | KLM American Express Corporate Card |
| `https://www.icscards.nl/creditcard-aanvragen/visa-world-card` | ICS Visa World Card |
| `https://www.icscards.nl/creditcard-aanvragen/visa-world-card-gold` | ICS Visa World Card Gold |
| `https://www.icscards.nl/creditcard-aanvragen/visa-world-card-platinum` | ICS Visa World Card Platinum |
| `https://www.icscards.nl/creditcard-aanvragen/visa-world-card-panda` | ICS Visa World Card Panda |
| `https://www.icscards.nl/creditcard-aanvragen/mastercard-classic` | ICS Mastercard Classic |
| `https://www.icscards.nl/creditcard-aanvragen/mastercard-gold` | ICS Mastercard Gold |
| `https://www.icscards.nl/creditcard-aanvragen/mastercard-black` | ICS Mastercard Black |
| `https://www.icscards.nl/zakelijk/zakelijke-creditcards-vergelijken` | ICS Visa World Card Business; ICS Visa World Card Business Gold; ICS Mastercard Business; ICS Mastercard Corporate |
| `https://www.anwb.nl/creditcard/informatie/kosten` | ANWB Visa Classic Card |
| `https://www.anwb.nl/creditcard/silver-card` | ANWB Visa Silver Card |
| `https://www.anwb.nl/creditcard/gold-card` | ANWB Visa Gold Card |
| `https://crypto.com/nl/cards` | Crypto.com Prepaid Card — Basic (Midnight Blue); Crypto.com Prepaid Card — Plus (Ruby Steel); Crypto.com Prepaid Card — Pro (Jade Green / Royal Indigo); Crypto.com Prepaid Card — Private (Icy White / Rose Gold); Crypto.com Prepaid Card — Private (Obsidian) |
| `https://nexo.com/crypto-card` | Nexo Card |
| `https://www.kraken.com/krak/card` | Krak Card (Kraken) |
| `https://plutus.it/plans` | Plutus Card |
| `https://www.bleap.finance/en-us/card/cashback` | Bleap Card |
| `https://www.zeal.app/` | Zeal Card (Gnosis Pay rails) |
| `https://www.paysafecard.com/nl-nl/kosten-limieten/` | paysafecard (prepaid code / PaysafeWallet) |
| `https://www.bigbank.nl/sparen/flexibel-sparen/` | Bigbank Flexibel Sparen |
| `https://help.bunq.com/articles/what-massinterest-rate-applies-to-me` | bunq spaarrekening (MassInterest) |
| `https://www.santanderconsumerbank.nl/sparen` | Santander Consumer Bank Spaarrekening |
| `https://www.dhbbank.nl/dhb-saveonlinerekening` | DHB Bank S@veOnlinerekening |
| `https://www.anadolubank.nl/` | Anadolubank Alfa Slimmer Sparen |
| `https://nl.scalable.capital/` | Scalable Capital Scalable Overnight |
| `https://www.raisin.nl/spaarrekening/` | Raisin spaarrekening (platform, 19 partner banks) |
| `https://www.klarna.com/nl/flex-rekening/` | Klarna Flex rekening |
| `https://www.ayvensbank.nl/actuele-rentestanden` | Ayvens Bank Flexibel Sparen |
| `https://www.openbank.nl/spaarrekening` | Openbank Welkom Spaarrekening |
| `https://www.openbank.nl/gratis-spaarrekening` | Openbank Open Spaarrekening |
| `https://www.yapikredi.nl/` | Yapi Kredi Bank Euro-Plus Spaarrekening |
| `https://www.nibc.nl/sparen/` | NIBC Spaarrekening; NIBC Kwartaalspaarrekening |
| `https://www.lloydsbank.nl/sparen/` | Lloyds Bank Spaarrekening |
| `https://www.nn.nl/Particulier/Sparen/Internetsparen.htm` | Nationale-Nederlanden Internetsparen |
| `https://www.centraalbeheer.nl/sparen` | Centraal Beheer RentePlús Rekening |
| `https://www.knab.nl/sparen` | Knab Flexibel Sparen |
| `https://www.asnbank.nl/sparen/rente.html` | ASN Bank ASN Ideaalsparen |
| `https://www.snsbank.nl/particulier/sparen/rente-spaarrekeningen.html` | SNS Internet Sparen |
| `https://www.regiobank.nl/sparen/actuele-rentes.html` | RegioBank Spaar-op-Maat Vrij |
| `https://www.triodos.nl/sparen` | Triodos Bank Internet Sparen |
| `https://new.brandnewday.nl/spaarrekening/` | Brand New Day De Spaarrekening |
| `https://www.nexentbank.nl/` | Nexent Bank Spaarrekening |

**Fetch-tier gotchas, all measured — a job that ignores these will report false negatives:**

- **bunq's CDN serves an empty 30-byte shell on a cache miss, with HTTP 200.** Three bunq URLs did it on the
  first fetch and returned the full 9–28KB page on an immediate refetch of the identical URL. A bunq 200 with
  near-zero text is a cache miss, not a JS page — **refetch before concluding anything**.
- **Two URLs ending in `.html` serve PDF bytes** (`regiobank.nl/downloads/tarievenwijzer-betalen-1.html`,
  `asnbank.nl/downloads/tarievenwijzer-1.html`, both confirmed with `file(1)`). An HTML stripper returns PDF
  object garbage and silently finds no tariffs. **Sniff the content type, never the extension.**
- **Trade Republic's HTML is a Nuxt shell** (76KB → 483 bytes of text) but `…/kaart/_payload.json` is a
  317KB SSR payload that curl fetches fine. That single route is what moves Trade Republic out of the agent tier.
- **A tag-stripper's silence is not proof a page is empty.** On `icscards.nl/tips/prepaid-creditcard-kopen` an
  unbalanced `<script>` reduced the page to a stray `5128`; the content was in the raw bytes all along.
  Grep the raw HTML before calling a page dead.
- **A percentage-proximity check must be line-agnostic.** Requiring 80 characters either side *on the same line*
  falsely reported 'no rates' for NIBC, whose page renders one item per line.
- **Body size proves nothing.** Rabobank's 403 is an 18KB Dutch soft-error page; Revolut's is 873KB; Bitget
  serves a 186KB soft-404; Binance answers **HTTP 202 with a zero-byte body**, which passes a naive
  status-code check. Check the status code *and* look for the figure.

**Readable, but with a named field that exists on no fetchable page** — record these as gaps, never as zero:

- **All 14 American Express NL cards: no FX markup is published in HTML anywhere.** Zero occurrences of
  'koersopslag', 'wisselkoers', 'valuta' or 'buitenland' across all eight consumer pages. The two FX pages
  (`/nl/legal/fx-ecb-vergelijking/` and `/nl/service/veilig-betalen/valuta-omrekenen/`) are byte-identical and
  their rate table is JS-loaded — the fetch got the literal placeholder 'Percentage Difference rates data is
  loading, please wait.' Amex FX must come from the cardholder agreement PDF or the agent, never a search result.
- **ICS Visa World Card Gold** is the one ICS card with no koersopslag line on its own page; the 2% is only on
  `icscards.nl/tips/wat-kost-een-creditcard`. **ICS business FX (2,5%)** is only on the comparison page.
- **Openbank betaalpas**: the FX cost *without* Travel+ is in the 'informatie over vergoedingen en commissies'
  document, not on any HTML page.
- **Trading 212**: conditions are readable on `helpcentre.trading212.com`, but the interest rate and the
  equities/ETF schedule exist only on `www.trading212.com`, which is a hard Cloudflare 403.
- **bunq**: the per-plan/per-threshold MassInterest table is on no HTML page (in-app + a T&C document), and the
  investment base fee that the Pro/Elite discount applies to is never published.
- **Krak** publishes the €50.000 top gate but not the intermediate cashback ladder; **Zeal** points at a GNO
  ladder that lives in Gnosis Pay's docs; **Crypto.com** explicitly refuses to state its FX fee, deferring to
  the Card Holder Agreement 'when you apply'.
- **ABN AMRO Gold Card** annual fee and **Nationale-Nederlanden**'s bands above €25.000 are both behind a link.

## Needs the agent (23 products, 22 URLs, 13 hosts)

Not a failure list — a routing decision. The agent read these correctly today, which is why they are here
rather than marked unknown. What matters is *why* each one resists a fetch, because the failure modes differ
and only some of them might yield to a cookie or a session.

| Host | Products | Failure mode measured |
|---|---|---|
| `www.revolut.com` | Revolut Standard betaalpas; Revolut Plus betaalpas; Revolut Premium betaalpas; Revolut Metal betaalpas; Revolut Dagelijkse Spaarrekening | **Cloudflare challenge.** HTTP/2 403, headers `server: cloudflare` + `cf-mitigated: challenge`, an 873KB interstitial containing 67 bytes of text. Blocked on `help.revolut.com` too, and a WebFetch from different infrastructure also 403'd. |
| `www.rabobank.nl` | Rabobank betaalpas; Rabobank creditcard; Rabo GoldCard; Rabobank Rabo SpaarRekening | **Clean 403**, identical on HTTP/2 and HTTP/1.1 across several paths; WebFetch also 403. An 18KB Dutch soft-error body, so it looks like a page if you only check bytes>0. Distinct from ING: **a 403 may yield to a cookie/session, a killed connection will not.** |
| `www.ing.nl` | ING betaalpas; ING creditcard; ING Oranje Spaarrekening | **Connection killed at HOST level.** curl 92 (INTERNAL_ERROR) on HTTP/2 and curl 28/56 on HTTP/1.1, on every path tried including a static `.pdf`. **A browser UA does not help here** — the one site where it doesn't. WebFetch's different egress got through but returned only the `<title>`, so it is a JS shell behind the block. There is no ICS backdoor: `icscards.nl/ing` is 404. Hardest target in the sweep. |
| `(no URL)` | ING Platinumcard | **No terms URL exists to fetch.** ING publishes no readable page for its platinum tier and the ICS backdoor that rescues ABN is a 404 for ING, so there is nothing to point an agent at yet — the agent's first job here is to *find* the page, not read it. |
| `www.triodos.nl` | Triodos betaalpas | **200, real prose, zero percent signs (counted).** Deliberately numberless: 'Visa bepaalt de wisselkoersen en opslagen.' The rekenhulp at `/betaalpas/rekenhulp` is a 2.402-char JS shell. Triodos's own site has no scrapeable FX rate anywhere. |
| `gnosispay.com` | Gnosis Pay Card (direct consumer) | **200 homepage, pivoted to B2B white-label.** `/card`, `/pricing` and `/personal` all 404; `app.gnosispay.com` is a 3KB shell. There is no consumer offer left to read. |
| `www.bybit.eu` | Bybit Card | **JS shell on both `.eu` and `.com`** — ~90KB of HTML stripping to one line. The help-centre article says 'This article is currently not supported on this site'; the wiki cashback article returns 'Article not found'. Only the country-availability wiki page renders, and it does confirm NL. |
| `www.coinbase.com` | Coinbase Card | **Cloudflare 'Just a moment…'** 403 on `/nl/card`, `/en-nl/card` and `help.coinbase.com`. A browser UA does not get past it — same family as Revolut and Trading 212. |
| `www.wirexapp.com` | Wirex Card (Wirex One) | **200 marketing-only** (a 4,9MB homepage stripping to navigation and slogans). `help.wirexapp.com` is a 1.043-char JS shell, `/eu/fees` and `/en/fees` are 404, and `wirex.com` does not connect at all. |
| `www.binance.com` | Binance Card | **HTTP 202 with a zero-byte body** — a bot-mitigation pattern that looks like success to any code checking only the status code. The product is dead anyway; the row exists to stop it being re-added. |
| `www.tria.so` | Tria Card | **200, server-rendered marketing with no rates, no fees and no country list.** `/cards` is 404. Availability to NL is flagged unverified rather than guessed. |
| `garantibank.nl` | Garanti BBVA International Gouden Internet Rekening | **Akamai 'Access Denied'**, a 407-byte body citing `errors.edgesuite.net` — same family as ING and Rabobank. Also note the intuitive domain `garantibbvainternational.nl` does not resolve at all. |
| `www.argenta.nl` | Argenta Internetspaarrekening | **200, marketing-only for the product asked about.** The only rate rendered is the 1-year Termijndeposito; the internetspaarrekening's rate sits behind 'Bekijk alle spaarrentes' and `/sparen/internetspaarrekening` is 404. Scraping the visible figure records the wrong product. |
| `www.abnamro.nl` | ABN AMRO Direct Sparen | **200 but client-rendered.** Three savings URLs, each ~1,1MB, all stripping to ~10.000 chars of pure navigation with **zero** percentage figures. Note ABN is readable for CARD tariffs on `/betalen/tarieven/buitenlands-geld.html` and unreadable for SAVINGS — the host is not uniformly one or the other. |

**Two corrections to standing assumptions, both measured this sweep:**

1. **'ABN's tariff page is an empty JS shell' is only half true.** `/betalen/tarieven/index.html` really is a
   shell (1.078.742 bytes → 9.124 chars of navigation, zero percent signs), but its sibling
   `/betalen/tarieven/buitenlands-geld.html` strips to 11.228 chars and carries real tariff tables. **ABN's cards
   are readable; the wrong URL was being tested.** Its savings pages remain unreadable.
2. **Rabobank does not kill the connection like ING** — it returns a clean 403. That difference decides whether
   a cookie/session workaround is even worth trying.

Three hosts are only reachable through a side door, which is worth more than any single rate:
`icscards.nl` is the readable backdoor for **ABN AMRO** (ICS is an ABN subsidiary — and there is no equivalent
for ING or Rabobank, both measured 404); `helpcentre.trading212.com` is readable while `www.trading212.com` is
a 403; and `help.bunq.com` carries the savings mechanism that `bunq.com/nl/pricing` (a JS shell) does not.

## Conditional headline rates (104 of 124 products)

This section is what stops the catalogue lying by omission. **In this market the advertised number is almost
never the achievable one**, and the gate is different for every product. Exactly one REWARDS rate in the whole
sweep is unconditional: **Bleap's cashback**, whose own page says 'There are no opt-ins, no promo windows, and
no hoops to jump through' — and even there the 20% is category-specific (streaming/AI/gaming), not a general
rate. The 10 genuinely flat products are flat because they publish a plain FEE (ASN, SNS and RegioBank
betaalpas at 1,4%; Lloyds, NIBC, Ayvens and Klarna savings), not because anyone is giving anything away.

### Token stake or asset balance (11)

- **Crypto.com Prepaid Card — Basic (Midnight Blue)** — free tier earns 0% — the '5% back' headline belongs to a different tier
- **Crypto.com Prepaid Card — Plus (Ruby Steel)** — 2% needs €3,99/mo OR a €450 12-month CRO lockup, and rewards cap at $25/mo
- **Crypto.com Prepaid Card — Pro (Jade Green / Royal Indigo)** — 3% needs €24,99/mo OR a €4.500 CRO lockup, cap $75/mo
- **Crypto.com Prepaid Card — Private (Icy White / Rose Gold)** — 4% needs a €45.000 12-month CRO lockup — no subscription route exists
- **Crypto.com Prepaid Card — Private (Obsidian)** — 5% needs €450.000 of CRO locked for 12 months
- **Nexo Card** — 2% is Credit Mode only, needs a $5.000+ portfolio AND Gold Loyalty Tier, which is set by your NEXO-token share
- **Krak Card (Kraken)** — 2% needs an average £/€50.000 across Krak + Kraken + Kraken Pro; the intermediate ladder is unpublished
- **Plutus Card** — needs BOTH a £/€6,99–19,99 monthly subscription AND a PLU stake; 3% base on a capped £/€250–1.000 of spend, 9% needs 40.000 PLU
- **Zeal Card (Gnosis Pay rails)** — 'up to 4%' requires holding GNO in your Gnosis Pay card Safe; the ladder lives in Gnosis docs, not on Zeal's page
- **Bybit Card** — reviews claim tiered 2–10%; nothing is verifiable on Bybit's own domain
- **Wirex Card (Wirex One)** — the 8% Cryptoback that needed WXT staking ENDED in the EEA on 30 June 2026; Wirex One's rates are unpublished

### Paid tier or subscription (22)

- **bunq Core betaalpas** — €3,99/mo buys unlimited ZeroFX; savings headline is 'tot wel'
- **bunq Pro betaalpas** — €9,99/mo; page names ZeroFX but prints no percentage
- **bunq Elite betaalpas** — €18,99/mo, and the 0,5% applies only 'wanneer de markten open zijn'
- **bunq creditcard** — a physical credit card requires a paid plan; €99 one-off for Metal, €3,49/mo per extra card
- **bunq beleggingsrekening** — 3 free months then a plan-dependent discount off a base fee that is never published
- **bunq Free Business betaalpas** — free tier prints no FX, cashback or interest figure at all
- **bunq Core Business betaalpas** — €7,99/mo; the ZeroFX allowance is not printed on the business page
- **bunq Pro Business betaalpas** — €13,99/mo
- **bunq Elite Business betaalpas** — €23,99/mo
- **Revolut Standard betaalpas** — free tier; a monthly FX allowance with a fair-usage rate above it is claimed by search only
- **Revolut Plus betaalpas** — paid subscription gates every headline benefit; amount unverified
- **Revolut Premium betaalpas** — paid subscription; unverified
- **Revolut Metal betaalpas** — Metal is historically the tier that carries cashback — never treat Revolut cashback as unconditional
- **N26 Standard betaalpas** — no cashback at all, and 1,7% on non-eurozone ATM withdrawals
- **N26 Smart betaalpas** — €4,90/mo buys neither cashback nor free non-eurozone ATM
- **N26 Go betaalpas** — 1% travel cashback starts only at €9,90/mo, and is footnoted
- **N26 Metal betaalpas** — €16,90/mo gates the cashback, the top savings rate and the free ATM allowance
- **N26 Instant Savings** — the savings rate IS your plan tier — and two N26 pages disagree on the ladder
- **Openbank betaalpas (R42 Betaalpas)** — every FX benefit sits behind Travel+ at €4,99/mo, and the cost WITHOUT Travel+ is on no HTML page
- **Coinbase Card** — reviews claim 'up to 4%' with Coinbase One boosts (~$29,99/mo); unverifiable behind the 403
- **Tria Card** — affiliate-only claims of $25/$109/$250 annual tiers and 'up to 6%' on capped spend — nothing on tria.so
- **Revolut Dagelijkse Spaarrekening** — plan-tiered in other markets; unverifiable behind the 403

### Promo window / new-customer only (17)

- **Knab betaalpas** — account fee under a 'tijdelijk 12 maanden gratis' promo — not the standing €6/€7 per month
- **Trade Republic spaarrekening (rente op kassaldo)** — 3% is 'voor nieuwe klanten' up to €50.000 and needs manual in-app activation — and the same page also claims 'geen saldolimiet'
- **Trading 212 interest on cash** — published rates apply to NEW clients only; must be enabled manually; interest counted on the 22:00 GMT balance
- **American Express Green Card** — '1e jaar gratis', then €6,50 per MONTH
- **Flying Blue - American Express Entry Card** — 1st year free + 1.000 Miles, then €3/mo; Miles extension is a one-off 2 years
- **American Express Business Green Card** — €85/yr; extra card free in year 1 then €50/yr; €23.000 income minimum
- **American Express Business Gold Card** — €270/yr, free in year 1 only for as long as you also keep a consumer Amex; €36.000 income minimum
- **ANWB Visa Gold Card** — year 1 €25,98 (50% off) then €51,95, plus €17,75 membership — €43,70 then €69,70
- **Bigbank Flexibel Sparen** — 2,75% for 6 months, new customers, and only on balances to €250.000
- **Santander Consumer Bank Spaarrekening** — 2,50% for 6 months for new customers per their own page — and geld.nl says 3,01%/2,10%, unresolved
- **Garanti BBVA International Gouden Internet Rekening** — 3,00% for 6 months for new savers per geld.nl; unverified at source
- **DHB Bank S@veOnlinerekening** — 3,00% for 6 months AND only on amounts to €50.000 — geld.nl has no field for that cap
- **Anadolubank Alfa Slimmer Sparen** — 3,00% for 6 months, new savers, app-only offer
- **Openbank Welkom Spaarrekening** — 2,80% for 6 months, new customers, promo code WELKOM, cap €1.000.000, then auto-converts
- **Yapi Kredi Bank Euro-Plus Spaarrekening** — 3,30% jubileumsrente, new customers, THREE months
- **Knab Flexibel Sparen** — a 'Bonusrente 0,75% + Variabele rente 1,25%' action for a defined group, which geld.nl does not carry
- **Nexent Bank Spaarrekening** — 2,75% welkomstrente for THREE months, first account only

### Balance, spend or volume threshold (33)

- **ING Platinumcard** — reported minimum income on the ING current account
- **ABN AMRO betaalpas** — fee varies by pakket and by balance band (€17.500 / €6.000 / €2.000 steps)
- **ABN AMRO creditcard** — cash 4%, only 1% (cap €1,50) if drawn entirely from a positive card balance
- **SNS creditcard** — positive-balance 1% vs 4% cash; €27,50 instead of €37,50 with a Studentenrekening
- **ASN Creditcard** — positive-balance 1% vs 4%; non-euro cash stacks 4% + 2% koersopslag
- **RegioBank creditcard** — 1% instead of 4% cash only with a positive card balance
- **bunq Free betaalpas** — ZeroFX 0,5% only to €1.000 foreign spend per year, then 3% per this page
- **bunq Termijndeposito** — 'tot 2,11%' fixed for the chosen term, and can change before you open it
- **Wise betaalpas** — ATM free to €250/month then 2,69%; conversion 'vanaf 0,2%' varies by pair
- **American Express Blue Card** — €0/mo only if you spend €3.000 per membership year; otherwise stated worth €35/yr
- **American Express Business Entry Card** — €50 per JAAR, and a €23.000 minimum gross income
- **KLM American Express Corporate Card** — bluebiz capped at 2.000 blue credits/yr; NO annual fee published on the page at all
- **ICS Visa World Card** — spaarrente only from a €500 card balance; €1.500 net monthly income to qualify
- **ICS Visa World Card Gold** — €57,95 → €59,50 from 15 Sep 2026; spaarrente only from €500, hedged 'nu'
- **ICS Visa World Card Platinum** — spaarrente only from a €500 balance; extra card €25/yr
- **ICS Visa World Card Panda** — spaarrente only from €500; the WWF donation is paid by ICS, not to you
- **ICS Mastercard Classic** — spaarrente only from €500; 180→365-day purchase insurance costs €8/yr
- **ICS Mastercard Gold** — €45 → €46,50 from 15 Sep 2026; spaarrente only from €500
- **ICS Mastercard Black** — spaarrente only from €500; extra card €135/yr; lounge access 4x/yr
- **ICS Visa World Card Business** — fee is volume-tiered €45 / €40 / €35 by card count; FX is 2,5%, not the consumer 2%
- **ICS Visa World Card Business Gold** — €154/card to 25 cards, then 'Op aanvraag' — no number at the top tier
- **ICS Mastercard Business** — €43 / €38 / €33 by card count; FX 2,5%
- **ICS Mastercard Corporate** — €48 / €42 / €36 by card count; FX 2,5%
- **paysafecard (prepaid code / PaysafeWallet)** — €3/month from month 2, €7,50 per redemption, dormancy fee from month 13, €50 max per payment
- **bunq spaarrekening (MassInterest)** — the bonus rate applies ONLY above your 6-month-high threshold; the base rate applies below it — not a promo window
- **Raisin spaarrekening (platform, 19 partner banks)** — 'tot 3,05%' is a rollup across 19 banks and all terms; Lea Bank has a notice period and four partners are 'met voorwaarden'
- **Openbank Open Spaarrekening** — 1,80% to €300.000 and 0,00% above it
- **Nationale-Nederlanden Internetsparen** — 1,30% applies only to balances up to €25.000; higher bands are behind a link
- **Centraal Beheer RentePlús Rekening** — 'maximaal 1,50%', and the page's own effective date is 10-07-2025
- **ASN Bank ASN Ideaalsparen** — tiered 1,30 / 1,20 / 1,20 / 1,00 by balance band — geld.nl publishes only the top band
- **SNS Internet Sparen** — tiered 1,30 / 1,20 / 1,00 by balance band
- **RegioBank Spaar-op-Maat Vrij** — tiered 1,30 / 1,20 / 1,00 — and closed to new customers entirely
- **Triodos Bank Internet Sparen** — 1,15% only on the first €10.000, then 0,90 / 0,90 / 0,80 — geld.nl publishes the top band as if flat

### Manual activation or opt-in (2)

- **Trade Republic betaalpas** — 1% Saveback capped at €1.500 eligible monthly spend and paid ONLY into a running investment plan
- **212 Card** — BASE RATE 0%: 1,5% needs Invest-cashback on + a Pie selected + a qualifying monthly subscription detected, cap €15/mo, never payable as cash

### Bundled with a package or membership (7)

- **ING creditcard** — monthly fee depends on which ING betaalpakket you hold
- **Rabobank betaalpas** — Rabo Comfort reportedly drops the fixed per-withdrawal amount; Standaard does not
- **Rabobank creditcard** — monthly fee included in Comfort/Riant, ~€2 on Standaard (unverified)
- **American Express Corporate Card** — €60/yr is the standard only — the real per-card fee depends on the company's card count
- **American Express Corporate Gold Card** — €125/yr standard; per-card fee scales with company volume
- **ANWB Visa Classic Card** — €29,95/yr EXCLUDES the compulsory €17,75 ANWB membership — real cost €47,70
- **ANWB Visa Silver Card** — €39,95/yr + compulsory €17,75 membership = €57,70

### Split / optional rate — one number is wrong (12)

- **Knab creditcard** — 0% debetrente if repaid in full, 14% effective p.a. if you opt into gespreid betalen
- **bunq crypto** — displayed staking APRs EXCLUDE Kraken's 25% commission on rewards
- **N26 flexible cash fund** — a money-market fund yield, net of fees, capital at risk — not a savings rate
- **Wise Rente** — cost from 0,26% is published, the yield is not; capital at risk
- **Wise Aandelen** — cost from 0,59% is published, the return is not; capital at risk
- **Trading 212 beleggingsrekening** — 'commission free' with a variable SPREAD built into the price — the spread is the real cost and is unquoted
- **Flying Blue - American Express Silver Card** — 1st year free then €6,25/mo; earn splits 0,8 Mile/€ base vs 1 Mile/€ at KLM-AF-Hertz
- **Flying Blue - American Express Gold Card** — €16,50/mo; earn splits 1 Mile/€ base vs 1,5 at KLM-AF-Hertz
- **Flying Blue - American Express Platinum Card** — €55/mo; earn splits 1,5 Miles/€ base vs 2 at KLM-AF-Hertz
- **Scalable Capital Scalable Overnight** — variable and dependent on 'marktrente, capaciteiten en voorwaarden'; without PRIME+ the cash may sit in money-market funds, not a guaranteed deposit
- **NIBC Kwartaalspaarrekening** — 'tot 1,60%' = monthly base plus a quarterly bonus — a ceiling, not a guaranteed rate
- **Brand New Day De Spaarrekening** — 1,30% on new.brandnewday.nl vs 0,25% on www.brandnewday.nl — the bank serves both, neither is dated

**The worst offenders, ranked by how far the headline is from the truth:**

1. **Trading 212's 212 Card has a base cashback rate of 0%.** The 1,5% needs 'Invest cashback' switched on, a
   Pie selected, *and* a qualifying recurring subscription billed monthly-or-shorter detected on the card — all
   three at once — capped at €15/month and never payable as cash.
2. **Crypto.com's '5% back' needs €450.000 of CRO locked for 12 months.** Its free tier earns literally 0%.
3. **Plutus needs both a paid subscription and a token stake**, and its 9% needs 40.000 PLU; even the 3% base is
   capped at £/€250–1.000 of monthly spend. Affiliate summaries get this wrong in the user's favour.
4. **Trade Republic's 3% is 'voor nieuwe klanten' up to €50.000** and needs manual activation — while a second
   block on the same page claims 'geen saldolimiet'. Never quote it without the new-customer clause.
5. **geld.nl flattens tiering to one number**, so ASN, SNS, RegioBank, Triodos, NN and Centraal Beheer are all
   systematically overstated for anyone above the first band — Triodos's 1,15% applies only to the first €10.000.
6. **ANWB card fees exclude a compulsory €17,75 membership**, understating real cost by ~34%.

**Genuine absences, recorded as findings rather than gaps.** These are answers, not missing data:

- **No Dutch grootbank card offers a cashback percentage or a points-per-euro scheme.** Zero 'cashback' hits
  across ~35 pages on americanexpress.com/nl-nl, icscards.nl and anwb.nl. Dutch bank cards compete on fees;
  rewards are points-only (Membership Rewards, Flying Blue Miles) and those transfer at unpublished ratios, so
  **LaVega should surface points and never rank on them.** ABN's ICS portal has merchant discounts ('8% bij
  Expedia', 'tot 25% bij Samsung') — partner offers with marketing 'tot' ranges, not a card-wide earn rate.
- **bunq has no cashback and no points on any product** (verified by grep across five bunq pages).
- **Wise has no cashback, no points and no subscription tiers at all** — its own price list says 'geen
  abonnementen of plannen'.
- **N26 Standard and Smart have no cashback** — the row is blank, not missing.
- **Knab's current account pays 0% interest**, stated outright: 'Rente op je betaalrekening 0%'.
- **Amex NL consumer cards are charge cards** — 'Geen rente', full balance due monthly, no BKR registration at
  signup. That is a finding, not an empty interest field.
- **Triodos offers no credit card at all**, confirmed twice from primary sources: Triodos's own FAQ ('Triodos
  Bank biedt geen creditcard aan') and bank.nl ('De bank heeft geen eigen creditcard'). Do not create one.
- **There is effectively no reloadable bank-issued prepaid Visa/Mastercard for sale in the Netherlands in 2026.**
  ICS's own prepaid article routes you to the Mastercard Classic, a regular credit card; `icscards.nl/go-card`
  is 404 and the GO Card closed to new applications in May 2024. Vocabulary trap: Dutch comparison sites file
  bunq, Revolut and N26 under 'prepaid creditcard'; those are debit on your own IBAN.

---

## Honest limits

### Brands that changed or died under us — the sweep's most consequential finding

Five brands moved in the last twelve months, and every one of them is still described in its old form by
comparison sites and review blogs:

- **SNS Bank, RegioBank and de Volksbank are all now ASN Bank.** de Volksbank N.V. → ASN Bank N.V. and SNS on
  **1 July 2025**; RegioBank on **1 December 2025**; and ICS renamed the SNS and RegioBank credit cards to
  **'ASN Creditcard' on 5 January 2026** (confirmed on ICS's own page). The snsbank.nl and regiobank.nl pages
  still return 200 with correct, *identical* tariffs, so nothing is broken yet — but they are legacy hosts on a
  retirement path. `productOf()` will keep generating 'SNS betaalpas' and 'RegioBank creditcard' from legacy
  account labels, so **keep the names for matching and point the terms at ASN**. Treat the three as one
  rate-set with three names: the figures were verified to match, which is a consistency check, not three
  independent data points.
- **LeasePlan Bank no longer exists** — renamed **Ayvens Bank** in October 2024. Searching the old name returns
  only affiliate pages.
- **Moneyou is dead**, not merely unreachable: ABN wound down everything but mortgages, savings gone by 2021.
- **Wirex's Cryptoback ended in the EEA on 30 June 2026**; a Dutch person today signs up to 'Wirex One', not
  the 8% product every review still describes.
- **Gnosis Pay pivoted to B2B white-label** and no longer sells a consumer card; **Binance's EEA card programme
  is closed** and Binance halted EEA services around 1 July 2026.

### What nobody could confirm

- **ING's credit-card tier names.** 'Creditcard More' / 'Creditcard Extra' appear only in affiliate blogs. The *existence* of a second platinum tier is confirmed neutrally by bank.nl's column header 'Met creditcard of platinumcard'; the names, the €2,00/€4,35 monthly fees and the €650/month minimum income are not confirmed on anything readable.
- **Rabobank's RaboCard → Rabo GoldCard migration**, its €33/year fee, and the 'Rabo Comfort pays no fixed withdrawal amount' claim. Every rabobank.nl URL 403s. A 403 interstitial is served regardless of whether a path exists, so even the GoldCard's *existence* is search-derived rather than measured.
- **All four Revolut tiers** — fees, cashback, savings (Savings Vaults, Flexible Cash Funds), RevPoints, and whether a fifth 'Ultra' tier exists for NL. Not one provider-owned page was reachable.
- **Bybit's and Coinbase's card fees and cashback.** NL availability *is* verified for Bybit from its own wiki; the rates are not. Coinbase's NL sign-up status could not be confirmed at all — the availability flag rests on a Coinbase blog post, not the product page.
- **Wirex One's rates, caps and tiers**, and the **Gnosis Pay GNO cashback ladder** that Zeal's footnote points at.
- **Trading 212's actual interest rates and equities fee schedule** — conditions verified, rates behind the 403.
- **Whether Santander Consumer Bank's current rate is 2,50%/2,00% (their own page) or 3,01%/2,10% (geld.nl).** Neither page is dated. Both figures exist; which is current is unknown.
- **Whether Brand New Day's rate is 1,30% or 0,25%** — two live official domains contradict each other by 1,05pp and neither is dated. geld.nl backs 1,30%, which is corroboration, not proof, and the stale page sits on the primary www domain and outranks the new one.
- **ABN AMRO Gold Card's annual fee**; **Knab's card issuer** (its page never names ICS, unlike SNS and RegioBank which state it outright — so it was left as Knab/Aegon rather than assumed); the **issuing EMI behind the Nexo and Plutus cards**; and **Tria's availability to Dutch residents** (`tria.so/cards` is 404 and there is no country list).
- **paysafecard's Mastercard product** (the old 'Account & Card', now 'PaysafeWallet') — the NL fee page covers the voucher code only.
- **18 of Raisin's 19 partner banks.** The per-partner page pattern was verified on Klarna only and assumed for the rest.
- **Wise Business** and **N26 Business** price lists; **Moneyou, Aegon Bank, Van Lanschot and N26 savings** were not investigated at all — no claim is made either way.
- **Whether geld.nl covers children's savings.** `geld.nl/sparen/spaarrente/kinderrekening` is 404, so SNS Jeugdsparen, Zilvervloot and Triodos's kinderrekening are outside anything LaVega can currently see.

### Products actively disproven — do not let these back in

- **'ICS Visa World Card Select' with '0,5% cashback' does not exist.** The URL 404s and ICS's own comparison page lists exactly four Visa cards. An affiliate result asserted both a fabricated product *and* a fabricated rate.
- **'Euroclix Mastercard'** — euroclix.nl is live and readable and contains zero occurrences of 'mastercard' or 'creditcard'. An affiliate page called it 'the only real cashback credit card in the Netherlands'; that is stale.
- **'N26 You'** — the €9,90 tier is called **Go** on N26's live page. Several review sites still say 'You'.
- **American Express Business Platinum (NL)** — 404, byte-identical to Amex NL's generic 404 page. Amex NL lists exactly three business cards.
- **de Bijenkorf Card** — withdrawn 1 April 2022, holders migrated to ICS Mastercard Gold; ICS's own notice page now 404s.
- **Shell consumer credit card, Advanzia Gebührenfrei Mastercard Gold, and HEMA/NS/Wehkamp/Otto/Esso/Q8/V&D co-brands** — searched, none exist for NL consumers. After the Bijenkorf's withdrawal the only surviving non-bank co-brands are ANWB (3 tiers), the WWF Panda card, and the Flying Blue Amex range.
- **Bitget Card** — both `/card` paths 404 with a 186KB soft-404 body. Named by comparison sites; not confirmed to exist at those URLs.

### Where a rate is only available from a third party

**Three banks currently rest on a single third-party source, and this is the weakest link in the sweep.**
ING, Rabobank and Triodos are all unreadable-or-numberless at source, so their card FX figures come only from
**bank.nl** — ING betaalpas 1,4% / creditcard 2,0%, Rabobank 1,4% / 2,0%, Triodos betaalpas 1,0% — each stamped
'Laatst gecontroleerd op 15-1-2026', which is seven months stale. bank.nl is a comparison site, not an
affiliate one: it states 'Wij zijn geen financiële instelling of bank', it is bylined, and its figures agreed
with every provider page independently verified (ABN 1,2%/2,0%, ASN 1,4%/2,0%, Knab 1,4%/2,0%). **Label it as
third-party anyway.** It covers exactly seven banks (ABN AMRO, ING, Rabobank, ASN, Triodos, Knab, bunq) — it
has no SNS or RegioBank row, consistent with both being absorbed into ASN.

For savings, **geld.nl** is the incumbent source and `rates.ts` already parses it. Five verified gaps:

1. **SNS Bank is absent entirely** from all 46 rows — one of the largest retail savings accounts in the
   Netherlands is invisible to LaVega. (RegioBank is absent too, but correctly, being closed to new customers.)
2. **Three action rates are missing**, all *understatements*, so LaVega fails to suggest switches worth making:
   Openbank (2,80% vs the 1,80% shown, −1,00pp), Yapi Kredi (3,30% vs 1,80%, −1,50pp, and their page was dated
   the day before it was measured), Nexent (2,75% vs 1,25%, −1,50pp).
3. **Santander is an overstatement risk** in the other direction — geld.nl's 3,01%/2,10% against the bank's own
   2,50%/2,00%.
4. **Tiering is flattened to the top band** for ASN, SNS, RegioBank, Triodos, NN and Centraal Beheer.
5. **Promo caps have no field at all** — DHB's 3,00% is capped at €50.000 and Openbank's at €1.000.000.

Two `rates.ts` bugs surfaced while measuring, both worth fixing before the catalogue is wired in:

- **`freeWithdrawal` is hardcoded `true` for every row.** That is false for 'Lea Bank (via Raisin) Spaarrekening
  met opzegtermijn' and unverified for the four 'Spaarrekening met voorwaarden' rows. The condition is sitting
  in geld.nl's own `productnaam` field, unread.
- **The row selector `/class=tableresults__result/` matches unquoted attributes only.** Measured the same minute:
  the spaarrente page served 47 unquoted matches and 0 quoted; the deposito page served 0 unquoted and 356
  quoted. geld.nl's minifier is inconsistent, so the regex works by luck. If the spaarrente page flips to the
  quoted form, rows drop to 0, the `rates.length < 5` guard fires, `scrapeGeldNl` returns null, and the service
  silently serves the bundled STATIC snapshot — **which is already stale** (it carries Bigbank 3,10/2,10 while
  both the provider page and live geld.nl say 2,75/2,00). A parser failure degrades invisibly into *wrong*
  numbers rather than into *no* numbers. Also note `rates.ts` never fetches `geld.nl/sparen/deposito` at all
  (65 providers, a different URL), and geld.nl's dedupe-by-bank silently drops NIBC Spaarrekening in favour of
  the Kwartaalspaarrekening.

### Discovered, readable, and deliberately not swept

Two products were found in passing, measured readable, and left out rather than half-entered — a half-measured
row is how a wrong number gets in:

- **Klarna Card (klarna.com/nl/klarna-card/, 200, readable).** Klarna's own copy calls it a 'betaalpas' on a Visa
  rail, with five subscription tiers (Standard €0, Core €1,99/mnd, Plus, Premium, Max), advertised cashback and
  '€0 koersopslagen van Klarna'. The cashback and FX claims carry footnote markers (¹ ⁴ ⁵ ⁶ ⁷) that were never
  opened. Needs its own pass before it becomes rows.
- **N26 Business (n26.com/en-eu/plans-business, 200, 14KB of text).** A full comparison table with tier-gated
  card cashback (0,1% Standard/Smart/Go, 0,5% Metal) and the same savings ladder. Belongs in a business bucket.

Also out of scope by instruction or by shape: **bunq's own savings sweep** was card-focused (bank.nl does carry
bunq's card tiers — Core 1,5%+0,5%, Pro/Elite 0,5% network cost only); **term deposits** were recorded only
where they shared a URL with a flexible product, never swept systematically; and **no savings sweep was done**
for seven of the eight high-street banks in the card bucket.

---

## Method, and one structural finding worth keeping

WebSearch for discovery only. Every URL was then fetched with `curl -sSL`, a browser User-Agent, an
`Accept-Language: nl-NL` header and a 25s timeout, tags stripped, and **the figure checked in context next to
the thing it describes**. `httpStatus` and `readable` are measured, never taken from a snippet. Percent-signs
were never counted as evidence — that mistake produced CSS artefacts once and is not repeated here.

**The structural finding: ICS is one issuer wearing six banks' logos.** International Card Services B.V., an
ABN AMRO subsidiary, issues the credit cards for ABN AMRO, ING, Rabobank, SNS, RegioBank and ASN — and also the
whole ANWB range. Two of those pages say so in their own words (SNS: 'Onze creditcards worden uitgegeven door
International Cards Services (ICS)…'; the RegioBank PDF: 'De RegioBank Creditcard is een product van
International Card Services (ICS)'). That explains the striking uniformity — 2% koersopslag, 4% cash withdrawal,
and the 1%-capped-at-€1,50 positive-balance discount recur verbatim across ABN, SNS, ASN and RegioBank.
Practical consequence: **one authoritative ICS source can legitimately cover several bank-branded cards, but
only where the bank has an ICS portal** — which exists for ABN and not for ING or Rabobank (both measured 404).
Amex, bunq and Knab are off the ICS rail entirely, and Knab's page never names an issuer, so it was not assumed.

**The counter-pattern that will bite hardest: betaalpas rates are NOT uniform.** Five banks sit at 1,4%, but
**ABN AMRO is 1,2% (plus €0,15)** and **Triodos is 1,0%**. Anyone pattern-matching 'Dutch betaalpas = 1,4%'
silently corrupts two of eight banks. The credit cards genuinely are uniform at 2% — that is the ICS effect,
and it is exactly why the exceptions are easy to miss.

**Two dated price changes are already live in current copy** and must be captured with their effective date,
not just their value: ICS Visa World Card Gold €57,95 → €59,50 and ICS Mastercard Gold €45 → €46,50, both from
**15 September 2026**.

### Companion file

`docs/catalog/state.json` — the diff anchor. One entry per product with identifying fields and routing only,
**no rates**, `lastChecked: null` on every product and a top-level `lastRun: null`. It exists so the first real
sweep reports *changes* rather than re-dumping the world, and so a figure that moves later shows up as a
reviewable git diff instead of a silent overwrite.

