# The last card products without an FX figure, and ING Punten — data, not a commit

Review-3 items **14** and **15**. This file is **data for the parent to merge**. I did not touch
`docs/catalog/catalog.json` or `state.json`, and I wrote no app code.

Every quote below is **verbatim from the document**, including table columns and the issuer's own
punctuation, so the merger can check that the words are in order and that the number is inside the
quote. Nine of yesterday's twenty-six finds died on a paraphrased quote; nothing here is paraphrased.

---

## 0. What "the last 15" actually is: **9**

Review-3 says fifteen. Measured against the catalogue rather than the review, it is nine.

```
card kinds  = betaalpas (31) + creditcard (40) + prepaid (6) + crypto cards (5)   = 82
             (the 6th `crypto` entry, bunq-crypto, is a trading product, not a card)
proven fxFeePct = 73          → 82 − 73 = 9 card products open
```

73 matches the coverage number in the brief exactly, so the 82/73/9 split is the real one. The nine:

| id | product | outcome |
|---|---|---|
| `revolut-premium-betaalpas` | Revolut Premium betaalpas | **PIN 0** |
| `revolut-metal-betaalpas` | Revolut Metal betaalpas | **PIN 0** |
| `american-express-corporate-card` | American Express Corporate Card | **PIN 2,5** |
| `gnosis-pay-card-direct-consumer` | Gnosis Pay Card (direct consumer) | **PIN 0** |
| `paysafecard-prepaid-code-paysafewallet` | paysafecard | **PIN 3** |
| `tria-card` | Tria Card | **PIN 0** |
| `wise-betaalpas` | Wise betaalpas | **clean negative** — no single percentage exists |
| `wirex-card-wirex-one` | Wirex Card (Wirex One) | **clean negative** — issuer refuses to publish one |
| `bleap-card` | Bleap Card | **clean negative** — fee schedule never addresses conversion |

Six pins would take card FX coverage from **73/82 to 79/82**. The remaining three are negatives with
a reason, not gaps waiting for another agent.

---

## 1. Two faults I found on the way, which are the *reason* three of these were open

These are not new research. They are the same failure mode as yesterday's ING points zero: **the
right document was already in the repo, filed against the wrong product.**

### 1a. Gnosis Pay's own card has no FX figure — but a card that only *rides its rails* does

`zeal-card-gnosis-pay-rails` carries `fxFeePct = 0`, sourced from
`help.gnosispay.com/hc/en-us/articles/39533569163284`. Its own `conditions` field says, correctly:

> "SCOPE — READ BEFORE SERVING. This document is GNOSIS PAY'S, and it talks about 'your Gnosis Pay
> Card' throughout. It never mentions Zeal."

That document is *about* `gnosis-pay-card-direct-consumer`, and that product has no `fxFeePct` at
all. The derived product got the number; the product the document is literally about did not. Fixed
below, from the same article, re-fetched and re-read today.

### 1b. Two entries carry the day we looked, not the date the document names

House rule: *"Elk cijfer draagt de URL en de datum die DAT DOCUMENT noemt, niet de dag dat wij
keken."* Two existing entries break it, and both are adjacent to work in this file:

| entry | field | `checkedAt` now | what the document itself says |
|---|---|---|---|
| `american-express-corporate-gold-card` | `fxFeePct` | `2026-08-19` | URL path `…/2022-12-15/…`; PDF `CreationDate: Wed Dec 7 05:00:55 2022 CET` |
| `zeal-card-gnosis-pay-rails` | `fxFeePct` | `2026-04-27` | Zendesk API: `updated_at: 2026-08-12T16:56:31Z`, `created_at: 2025-07-21` |

Not my lane to edit. Recorded so it gets fixed in the same pass as the merge, because the new
entries below use the document dates and would otherwise sit next to two that don't.

---

## 2. The six pins

### 2.1 `revolut-premium-betaalpas` — `fxFeePct: 0`

```
sourceUrl : https://www.revolut.com/nl-NL/legal/premium-fees/
route     : agent (r.jina.ai; revolut.com answers plain curl and node fetch with 403)
checkedAt : 2026-07-09        ← the date the document names, not today
```

**The routing note that matters:** state.json has `premium-fees` and `metal-fees` as
`httpStatus: 403 / readable: bot-blocked / lastReason: "wayback: no figure · agent: 403"`. That is
true of curl. It is **not** true of `r.jina.ai`, which returns both pages in full:

```
https://r.jina.ai/https://www.revolut.com/nl-NL/legal/premium-fees/  → 200, 16 444 bytes
https://r.jina.ai/https://www.revolut.com/nl-NL/legal/metal-fees/    → 200, 16 552 bytes
```

So each plan now has **its own** per-product URL, not a shared `plus-fees` page. Update
`readable`/`route` for both while merging.

The document's own effective date, first line of body:

> Deze versie van de voorwaarden is van toepassing vanaf 9 juli 2026, tenzij anders aangegeven is.

The figure, verbatim, as the bulleted list writes it — all three plan rows quoted so the merger can
see which row is being read:

> *   **Standard:** wissellimiet van EUR 1.000 per maand. Bij alle extra valutawissels zijn er kosten voor fair usage van 1% per geldwissel van toepassing.
> *   **Plus:**wissellimiet van EUR 3.000 per maand. Bij alle extra valutawissels zijn kosten voor fair usage van 0,5% van toepassing.
> *   **Premium, Metal en Ultra:** Geen wissellimiet. Geen fair usage-kosten.

This is an **explicitly spoken zero**, which is exactly the class of figure the house rule says must
not be read as unknown. Standard is pinned at 1 and Plus at 0,5 off the identical list shape, so the
row attribution is already established for this page.

`conditions` (proposed, and the weekend clause is not optional — it is the only way the 0 is honest):

> Geen wissellimiet en geen fair usage-kosten op het Premium-plan: "**Premium, Metal en Ultra:** Geen
> wissellimiet. Geen fair usage-kosten." De 0 geldt op weekdagen. De weekendtoeslag geldt óók voor
> dit plan, want die is aan de klok gebonden en niet aan de limiet: "Er gelden geen kosten als je
> geld wisselt op weekdagen (tussen 18:00 uur op zondag en 17:00 uur op vrijdag, New York tijd) en
> binnen de limieten van je plan. Als je in het weekend geld wisselt (tussen 17:00 uur op vrijdag en
> 18:00 uur op zondag, New York tijd) geldt er een kost van 1%." Kaartbetalingen in vreemde valuta
> waarvoor in realtime moet worden gewisseld, vallen hieronder; Revolut waarschuwt zelf dat juist
> daar de totale kosten niet vooraf te tonen zijn. Abonnementsgeld voor het plan is een aparte post.

### 2.2 `revolut-metal-betaalpas` — `fxFeePct: 0`

Identical figure, identical conditions, **its own** source:

```
sourceUrl : https://www.revolut.com/nl-NL/legal/metal-fees/
route     : agent (r.jina.ai)
checkedAt : 2026-07-09
```

Same verbatim line ("**Premium, Metal en Ultra:** Geen wissellimiet. Geen fair usage-kosten.") and
the same weekend clause, both present on the `metal-fees` page — I fetched it separately rather than
inferring it from the Premium page.

### 2.3 `american-express-corporate-card` — `fxFeePct: 2,5`

```
sourceUrl : https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-12-15/NL_Proprietary_Corporate_Cardmember_TCs_Dec2022.pdf
route     : agent (plain curl, 200, application/pdf, 626 705 bytes, 9 pages, %PDF- magic)
checkedAt : 2022-12-15   ← the date in the document's own URL path; PDF CreationDate 2022-12-07
```

**This is the wettelijk-verplichte-document route working exactly as intended, and the product was
open only because the sibling got it.** `american-express-corporate-gold-card` is already pinned at
2,5 from *this same PDF*. The PDF's own running head is:

> AMERICAN EXPRESS® CORPORATE CARD
>
> Kaarthouder Algemene Voorwaarden

So it is the Corporate Card's agreement, first and foremost. Two independent clauses in it carry the
figure. From the fee article (left column, item g):

> g. Een wisselkoersopslag van 2,5% is verschuldigd wanneer een bij ons ingediende Transactie in een
> andere valuta dan de euro plaatsvindt of als we een creditering ontvangen in een andere valuta dan
> de euro. Zie ook het artikel "Transacties in vreemde valuta" van deze Overeenkomst.

And from article 11, *Transacties in vreemde valuta*, item b:

> Deze koers wordt de "American Express-wisselkoers" genoemd en wordt vermeerderd met een
> wisselkoersopslag van 2,5%.

`conditions` (proposed):

> Wisselkoersopslag van 2,5% bovenop de American Express-wisselkoers, verschuldigd zodra een
> Transactie of creditering niet in euro's is: "Een wisselkoersopslag van 2,5% is verschuldigd
> wanneer een bij ons ingediende Transactie in een andere valuta dan de euro plaatsvindt of als we
> een creditering ontvangen in een andere valuta dan de euro." De opslag valt weg bij DCC: "Aangezien
> een Transactie die via de derde wordt omgerekend, bij ons wordt ingediend in de Euro's, zullen we
> geen wisselkoersopslag in rekening brengen" — dat is Amex' eigen tekst en géén advies om DCC te
> kiezen, want de derde partij rekent dan zijn eigen koers en commissie. Niet-USD transacties gaan
> via Amerikaanse dollars, en de opslag wordt dan slechts eenmaal gerekend. Contante opnames zijn een
> aparte post: 3,8% van het opgenomen bedrag met een minimum van € 4,50. Geldt volgens de Kaarthouder
> Algemene Voorwaarden van de American Express Corporate Card (december 2022).
>
> AVAILABILITY: state.json has `availableToNL: false` for this product — it is employer-issued. That
> is a reason to rank it out for him, not a reason to leave the figure unknown.

### 2.4 `gnosis-pay-card-direct-consumer` — `fxFeePct: 0`

```
sourceUrl : https://help.gnosispay.com/hc/en-us/articles/39533569163284-Understanding-Your-Card-s-Fees-and-Limits
route     : agent (Zendesk help-centre JSON API — the site's own JSON:
            https://help.gnosispay.com/api/v2/help_center/en-us/articles.json?per_page=100 → 200)
checkedAt : 2026-08-12   ← the article's own `updated_at`; `created_at` 2025-07-21; `draft: false`
```

Verbatim, as the article's own section writes it (heading, emoji and bullets included):

> 🌍 Foreign Exchange (FX) Fees
>
> **No added fees** from Gnosis Pay for currency conversions
>
> **Visa's exchange rate** is applied automatically at the time of purchase
>
> 💡 **Pro Tip:** When travelling, always select the **local currency** at payment terminals for
> better rates.

`conditions` (proposed):

> Geen eigen toeslag van Gnosis Pay op valutaconversie; de koers is Visa's, niet die van de
> uitgever: "No added fees from Gnosis Pay for currency conversions / Visa's exchange rate is
> applied automatically at the time of purchase." Dezelfde bron waarschuwt zelf voor DCC: "When
> travelling, always select the local currency at payment terminals for better rates." Kaartbetalen
> zelf is ook zonder kosten en 1:1 in stablecoin ("No transaction fees when spending with your
> card"; "1:1 stablecoin usage — a €10 purchase = 10 EURe"). Geldopnames zijn een aparte post: tot 5
> gratis opnames per maand óf tot 200 EURe/GBPe/USDCe, wat het eerst komt, daarna 2% per extra
> opname; vervangingskaart 4,99. Zelfde document dat `zeal-card-gnosis-pay-rails` gebruikt — maar
> dít is het product waar het document over gaat.
>
> AVAILABILITY: state.json has `availableToNL: false` and `gnosispay.com/card|/pricing|/personal`
> all 404. The rate is proven; the openness to NL is not, and stays as it is.

### 2.5 `paysafecard-prepaid-code-paysafewallet` — `fxFeePct: 3`

```
sourceUrl : https://www.paysafecard.com/nl-nl/alg-vw/   (document nl_paysafecard_26-05-2026.htm)
route     : provider-page — the terms body renders server-side on the `detail` endpoint;
            the marketing page and r.jina.ai both give only navigation
checkedAt : 2026-05-26   ← from the document's own filename, nl_paysafecard_26-05-2026.htm
```

Verbatim, article 7 *Munteenheid*, clause 7.2, hyphenation exactly as the page breaks it:

> 7.2.
> Voor elke betaling gedaan in een andere valuta dan de valuta van uw PaysafeCard (zoge- naamde
> kruisvaluta transacties) rekenen we omrekeningskosten. Deze kosten bedragen 3% van het trans-
> actievolume. Voor kruisvaluta transacties, waarbij de euro niet is betrokken in de
> betalingstransactie, zal een wisselkoers van 6,09% van de betalingstransactie worden toegepast.

And 7.1, which establishes that the card is a euro product (so 3% is the row that applies to him):

> 7.1.
> De PaysafeCard wordt uitgegeven in Euro (€). Elke betaling voor goederen/diensten in een andere
> munteen- heid zal worden omgezet in Euro, gebruik makend van de wisselkoers die van toepassing is
> op de datum van de transactie.

`conditions` (proposed):

> Omrekeningskosten van 3% van het transactievolume bij elke betaling in een andere valuta dan die
> van de PaysafeCard, die in euro's wordt uitgegeven. Een tweede, hoger tarief geldt als de euro
> helemaal niet in de transactie voorkomt: "Voor kruisvaluta transacties, waarbij de euro niet is
> betrokken in de betalingstransactie, zal een wisselkoers van 6,09% van de betalingstransactie
> worden toegepast" — de 3 is dus niet het maximum. Los van de omrekening: terugbetalingsvergoeding
> € 7,50 en maandelijkse beschikbaarheidskosten na de eerste 30 dagen.
>
> CONFLICT TO CARRY, NOT TO SILENCE: the marketing fee page
> (paysafecard.com/nl-nl/kosten-limieten) says "Vanaf de 2e maand worden maandelijkse
> activeringskosten van 3 EUR … afgetrokken", while these terms say "de eerste 30 (dertig) dagen na
> aankoop van uw PaysafeCard GRATIS. Daar- na € 4 per maand." Different field, same product, two
> issuer sources disagreeing. Not an FX matter; recorded because whoever touches this product's
> `annualFee` will hit it.

**One measurement worth writing down so nobody repeats it:** the `detail` endpoint returns the *same
100 518-byte document* for all three `tx_pscterms_pi3[filename]` values (`nl_paysafecard_26-05-2026`,
`nl_mypaysafecard_28-08-2025`, `nl_mastercard_06-06-2025`). Byte-identical. So the endpoint ignores
the filename parameter, and the `mastercard` / `mypaysafecard` variants are **not** reachable this
way. The figure above is safe because our catalogue product is the prepaid code, which is what the
served document covers — but do not use this route to claim anything about a paysafecard Mastercard.

### 2.6 `tria-card` — `fxFeePct: 0`

```
sourceUrl : https://help.tria.so/en/articles/13513481-what-are-tria-cards
route     : provider-page (plain curl, 200)
checkedAt : 2026-06-14   ← the article's own JSON-LD `dateModified: 2026-06-14T08:09:55Z`
```

Verbatim, from the *Choosing Your Membership* section:

> Tria offers three tiers to match how you use your crypto. Every tier enjoys **zero deposit fees and
> zero foreign exchange fees**.

This is a spoken zero that names foreign exchange in so many words, and it says **every tier**, so it
is not a tier-attribution problem.

`conditions` (proposed):

> Geldt voor alle drie de tiers: "Tria offers three tiers to match how you use your crypto. Every
> tier enjoys zero deposit fees and zero foreign exchange fees." De 0 dekt de valutakosten van Tria,
> niet de conversie zelf: de kaart zet crypto op het moment van betalen om ("Real-time conversion:
> Your crypto is converted at payment time"), en welke spread daarbij wordt gerekend staat in geen
> enkel leesbaar document — dus de 0 is een tarief, geen totale prijs.
>
> AVAILABILITY: state.json has `availableToNL: "unverified"`, and the issuing EMI is not named on
> any page. Both stay as they are; a proven rate does not prove he can hold the card.

---

## 3. The three clean negatives

### 3.1 `wise-betaalpas` — no single percentage exists, and that is the finding

Not "unreadable". Wise's pages read fine. The finding is that **Wise does not have a card FX
surcharge at all**, and what it charges instead is a per-corridor conversion fee that no dated
document states as one number.

What Wise publishes, verbatim, `wise.com/nl/pricing/card-fees` (read via r.jina.ai, 200):

> *   Forget foreign transaction fees
>
> No charges just for using your card abroad, with low conversion fees

And the fee-at-a-glance rows on `wise.com/nl/pricing/` (r.jina.ai, 200, `Published Time: Thu, 13 Aug
2026`):

> *   Pay with the Wise card
>
> Spend funds in your account in the same currency online, in-store and abroad safely
> Free

> *   Converting money
>
> Fee varies by currency
> From 0.2%

And the help centre, `wise.com/help/articles/2934551/what-are-the-wise-card-fees`:

> *   If you have the currency you're spending in your account — it's free to spend
>
> *   If you don't have the currency you're spending in your account, there's a conversion fee —
>     check the latest pricing for your region

**Why I am not pinning 0, and this is the important part.** A 0 here would be a *valse nul* of the
worst kind: it would make Wise win the travel-agent ranking against every card that honestly declares
a percentage, while a real cost is charged one layer down. Wise's own words are "low conversion fees",
not "no conversion fees".

**Why I am not pinning 0,2 either.** "From 0.2%" is a floor across all corridors, not a rate, and the
catalogue field is a single number that the ranking will treat as *the* rate.

Routes tried and their exact outcomes, so nobody spends the hour again:

| route | result |
|---|---|
| `wise.com/nl/pricing/` plain curl, browser UA | 200, 578 865 bytes — the fee list is there, no per-corridor percentage |
| `wise.com/nl/pricing/card-fees` r.jina.ai | 200 — "Fixed fee 0 EUR / Variable fee 4.58 EUR", computed live by a calculator, not a published figure |
| the regulator's standardised fee document, linked from the pricing page as `wise.com/pricing/fees-documents` | **403** to curl with browser UA and Accept-Language; via r.jina.ai it returns a 160-byte ad-tracker pixel (`match.adsrvr.org`), twice, on two URL forms. This is the one route that would settle it and it is closed. |
| `wise.com/gateway/v3/price?...` (guessed site JSON) | `{"status":"404","error":"Not Found"}` |
| `api.wise.com/v4/comparisons/?sourceCurrency=EUR&targetCurrency=USD&sendAmount=1000` | **200, public, no auth.** Wise's own quote: `"fee": 6.21, "markup": 0.0, "isConsideredMidMarketRate": true, "dateCollected": "2026-08-20T16:37:20Z"` — 0,621% on EUR→USD 1000. Live, per-corridor, undated in the document sense. |

**Recommendation:** leave `fxFeePct` unknown, and record `lastReason` as *"no single percentage
exists: card surcharge is 0, conversion fee is per-corridor variable, published only as 'From 0.2%'
and as a live calculator"*. If the travel agent ever needs to rank Wise, the honest way in is
`api.wise.com/v4/comparisons` as a **live** source alongside ECB — the same shape as the Valuta tab
already uses — not a frozen number in the catalogue. That is a design decision for another lane; I am
only saying which door it is behind.

### 3.2 `wirex-card-wirex-one` — the issuer refuses to publish a number

```
document  : https://help.wirexapp.com/article/wirex-fees-1379   "Wirex Fees"
route     : plain curl, 200, 617 496 bytes
docDate   : 2023-12-14   ← the page's own `"updatedAt":"2023-12-14T14:09:15+00:00"`
```

Verbatim, the whole *Exchange fees* section, bold in the original:

> ### Exchange fees
>
> **Wirex taps into multiple liquidity sources to offer market-leading exchange rates. The rates vary
> depending on the currency pair and available liquidity. Associated fees can be viewed in the app.**

And the page's own standing caveat, one paragraph above it:

> Please note that these fees are subject to change, and it's always recommended to check the Wirex
> website or app for the most up-to-date fee information.

This is the fee document, it has an Exchange-fees heading, and under that heading the issuer says the
number is in the app. That is a **refusal on the record**, and it upholds the earlier call in
state.json. `lastReason`: *"issuer states the FX rate only in the app: 'The rates vary depending on
the currency pair and available liquidity. Associated fees can be viewed in the app.' (Wirex Fees,
updatedAt 2023-12-14)"*.

### 3.3 `bleap-card` — the fee schedule never addresses conversion

```
document  : https://help.bleap.finance/en/articles/12097920-fee-schedule   "Fee Schedule"
route     : plain curl, 200
docDate   : 2026-05-25   ← the page's own JSON-LD `"dateModified":"2026-05-25T11:39:36Z"`
```

This is Bleap's own, complete, dated fee schedule — the right document for the question. It opens:

> Fees
>
> When you transact with Bleap, the following fees may apply:

and the card row, verbatim, as the table writes it:

> Payment Method | Buy Processing Fee | Sell Processing Fee
> SEPA/SEPA Instant | 0% | 0%
> Card Spend | No fees are charged by Bleap when paying with card.

**Why that is not a 0 for FX, even though it is tempting.** Three reasons, and the third is decisive:

1. The row sits in a table whose columns are *Buy Processing Fee* and *Sell Processing Fee*. It is a
   processing-fee statement, not a conversion statement.
2. The document has a separate *Spreads* section which says a spread **is** added and is invisible:
   "A small spread may be added to the asset price shown to you… are always built into the price you
   see during checkout."
3. Bleap's own card article, `help.bleap.finance/en/articles/15820587`, says the card holds only two
   currencies: "The card supports payments in specific fiat currencies: USD and EUR. These are the
   only currencies that can be used for transactions with the Bleap debit card." So a purchase in a
   third currency **is** converted by Mastercard, and no Bleap document says by whom or at what
   markup.

I searched `foreign` / `conversion` / `exchange` / `currenc` across the fee schedule, the card-balance
article and the card-limits article: **no hit that states an FX rate.** So: unknown, not zero.

`lastReason`: *"Bleap's dated Fee Schedule (2026-05-25) covers card spend as 'No fees are charged by
Bleap when paying with card' but never addresses currency conversion; the card holds only USD and EUR,
so a third currency is converted by Mastercard at an unstated markup, and the same document admits an
unquantified spread is built into displayed prices."*

If the parent disagrees and wants the 0 pinned, the quote is above and the caveat is above — that is a
judgement call, and I am making mine explicit rather than deciding it quietly.

---

## 4. ING Punten (item 15) — **found, and it is a better answer than a clean negative**

The brief expected a clean negative. It is not one. **The archive route works, and it works because
the page ships a `FAQPage` JSON-LD block that the shadow DOM does not hide.**

```
document  : https://web.archive.org/web/20260218053411id_/https://www.ing.nl/particulier/ing-punten
            (title: "ING Punten: Jouw loyaliteitsprogramma voor exclusieve voordelen")
            corroborated by 20251018161821 of the same URL
route     : wayback, raw (`id_`) — plain curl, 200, 14 329 bytes
docDate   : 2026-02-18 (snapshot date; the page itself carries no version date)
```

### 4.1 What the document proves

**The programme exists**, which the earlier `0` denied. Verbatim:

> Deelname aan het ING Punten programma is gratis en vrijblijvend. Wekelijks verzamelen wij nieuwe
> deals om ING klanten te helpen met besparen op mooie producten en leuke uitjes.

**Points are NOT earned per euro spent.** They accrue monthly for being a customer, plus one-off for
actions. Verbatim, Q *"Wanneer worden mijn ING Punten bijgeschreven?"*:

> Elke maand worden ING Punten bijgeschreven in de 2e week van de volgende maand. Daarnaast spaar je
> Punten voor activiteiten waar je direct Punten voor krijgt, zoals het afsluiten van een verzekering
> of het aanvragen van een Creditcard

and, Q *"Wat gebeurt er met mijn ING Punten bij overlijden?"*:

> ING Punten zijn persoonlijk en niet overdraagbaar. Ze hebben geen geldwaarde, maar je spaart ze
> gewoon door je bankzaken te doen.

**ING states, itself, that the points have no monetary value.** Verbatim, Q *"Kan ik mijn ING Punten
inwisselen voor geld?"*:

> Nee, ING Punten hebben geen monetaire waarde en kunnen niet worden ingewisseld voor geld.

**They are spent as a co-payment in the ING Winkel, not redeemed at a rate.** Verbatim:

> Bevestig je betaling met een Scanner-code of via de Mobiel Bankieren App. Het bedrag en aantal
> Punten worden direct afgeschreven, zonder extra administratie- of verzendkosten.

Supporting facts from the same block: points do not expire ("Geen zorgen, je ING Punten verlopen
niet."); they cannot be moved between accounts ("ING Punten kun je niet overhevelen naar een andere
rekening."); unsubscribing zeroes the balance ("Al je opgebouwde Punten, je Punten gaan bij
uitschrijven terug naar 0."); donating to charity is currently not possible.

### 4.2 What to write into the catalogue

For `ing-betaalpas` (and any ING product the parent wants to carry it):

```
pointsPerEuro : STAYS UNKNOWN — and now for a documented reason, not a missing document
```

`pointsReason` (proposed, replacing the current text, which is right about the cause and can now say
what the answer *is*):

> ING HEEFT EEN PUNTENPROGRAMMA, en `pointsPerEuro` is niet onbekend-bij-gebrek-aan-document maar
> onbekend-omdat-het-niet-bestaat: ING Punten worden niet per bestede euro verdiend. De uitgifte is
> maandelijks en relatiegebonden — "Elke maand worden ING Punten bijgeschreven in de 2e week van de
> volgende maand. Daarnaast spaar je Punten voor activiteiten waar je direct Punten voor krijgt,
> zoals het afsluiten van een verzekering of het aanvragen van een Creditcard" — en ING schrijft zelf
> "je spaart ze gewoon door je bankzaken te doen". Er is dus geen punten-per-euro om te vinden, en
> een 0 zou dubbel fout zijn: het programma bestaat wél, en de eenheid is niet euro's.
> Bron: web.archive.org/web/20260218053411id_/https://www.ing.nl/particulier/ing-punten (FAQPage
> JSON-LD in de gearchiveerde pagina), bevestigd in de snapshot van 2025-10-18.

And a hard rule the app should carry, because ING states it in so many words:

> GEEN EUROWAARDERING TOEGESTAAN. ING: "Nee, ING Punten hebben geen monetaire waarde en kunnen niet
> worden ingewisseld voor geld." Punten worden in de ING Winkel als bijbetaling afgeschreven náást
> een geldbedrag, niet tegen een koers ingewisseld. Elke euro-waarde die LaVega naast een ING-saldo
> zet, is verzonnen precisie — precies wat de Punten-tab bewust heeft weggehaald.

That last paragraph is the real prize from this hunt. The Punten tab dropped the word "indicatief" on
principle; for ING there is now an **issuer statement** backing it up.

### 4.3 The route, written down so it is reusable and so nobody retries the dead ends

**What works:** `web.archive.org/web/<ts>id_/<ing url>` → plain curl → parse
`<script type="application/ld+json">` → `FAQPage.mainEntity[].acceptedAnswer.text`. The answers are
real prose, several hundred words each. ing.nl renders its body in shadow DOM, but its **structured
data is in the served HTML**, and the archive has it. This is very likely the general key to the rest
of ing.nl, which has been the worst host in the catalogue.

Snapshots that exist and are worth reading (CDX, `url=www.ing.nl/particulier/ing-punten`): 20260218,
20251018, 20250515, 20250429, 20250405, 20250115, 20241230 … back to 20220823. Sub-pages also
archived: `/populaire-deals`, `/punten-high-income`, `/punten-voor-expats`, `/punten-voor-jongeren`,
`/punten-voor-starters`, `/punten-voor-nieuwe-studenten`, `/punten-voor-een-goed-doel`.

**Dead ends, measured today — do not retry:**

| route | result |
|---|---|
| live `www.ing.nl/particulier/ing-punten`, curl `--http1.1`, browser UA, full Accept/Accept-Language/gzip | **exit 56, connection killed, 0 bytes.** ing.nl terminates curl regardless of headers. |
| `punten.ing.nl` | connection fails (000) |
| `winkel.ing.nl` | connection fails (000) |
| `www.ing.nl/particulier/ing-punten/hoe-spaar-ik-punten` (guessed) | connection fails (000) |
| `r.jina.ai` on the punten page | title only (as previously recorded) |
| CDX for `assets.ing.com*` filtered on `punt` | archive.org went "Temporarily Offline" mid-run — **untried, not disproven.** The one honest gap. |
| CDX prefix `ing.nl/particulier/ing-punten*` for a terms/voorwaarden document | no such URL in the archive |

The archived page's earn rate is genuinely absent, not missed: the snapshot has four `ld+json` blocks
and one loader script, its meta description is *"Ontdek ING Punten: spaar eenvoudig bij ING en wissel
je Punten in voor cadeaus, kortingen en unieke ervaringen"*, and nothing anywhere states a rate. The
rate lives in the ING App — which is exactly the *"once he grants access once, derive the points from
the transactions"* item already in BACKLOG.md, and this hunt is evidence that that is the only route,
not a shortcut.

---

## 5. Merge checklist for the parent

1. Six `fxFeePct` pins: §2.1–2.6. Every one has value + sourceUrl + document-own date + conditions,
   and the number is inside the quoted text.
2. Three `lastReason` updates for the clean negatives: §3.1–3.3. No values.
3. `readable`/`route` correction for `revolut-premium-betaalpas` and `revolut-metal-betaalpas`:
   `bot-blocked` → readable via r.jina.ai, each with its own per-plan URL. (§2.1)
4. `pointsReason` rewrite for `ing-betaalpas`, plus the no-euro-valuation rule: §4.2.
5. Two date corrections that are *not* mine to make: §1b.
6. Coverage after merge: card FX **79/82**. The other three are answered, not open.
