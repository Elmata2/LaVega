# De kassa-extensie — implementatieplan

Review-3 item **13** vroeg om dit plan. **Review-4 item 34 heeft het product omgedraaid**, en dit
bestand is op **21 augustus 2026** om die omkering heen herschreven.

Zijn woorden, letterlijk:

> *"The idea is that if in my case I have Amex points which I never use, and I go to a webshop and it
> says I have 35% that I can use with my points — that would be very, very useful."*

Dat is een ander product dan wat hier stond. De vorige versie rangschikte **kaarten op cashback**;
dit gaat over **punten die hij al heeft, zichtbaar op het moment dat hij afrekent**.

Dit bouwt nog steeds voort op **`docs/BACKLOG.md` § 7.1 — "De houding van de extensie"**. Die vier
houdingsregels blijven staan en worden hier niet herhaald.

Niets hiervan is gebouwd. Er is geen productiebestand aangeraakt.

---

## 0. Waarom de omkering een verbetering is, en niet alleen een andere smaak

Niet omdat het idee leuker klinkt, maar omdat de **data ergens vandaan komt**.

**De oude kop hing aan cijfers die niemand publiceert.** Vandaag opnieuw geteld in
`docs/catalog/catalog.json` (185 regels, `generatedAt: 2026-08-21`):

| | aantal |
|---|---|
| kaartachtige regels (betaalpas, creditcard, prepaid, crypto) | 86 |
| daarvan met een **cashbackcijfer** | **8** |
| daarvan met **cashbackcijfer én een prijs** | **0** |
| daarvan met een **puntenkoers > 0** | 14 |
| daarvan met een **FX-opslag** | 73 |

*(De opdracht noemde 77 kaarten; ik tel er 86 omdat ik `betaalpas`, `creditcard`, `prepaid` en
`crypto` allemaal meetel. Welke telling je ook neemt, de twee cijfers die het besluit dragen — 8
cashbackregels, 0 daarvan met een prijs — veranderen er niet van.)*

De acht cashbackregels zijn **alle acht** crypto- of crypto-prepaidkaarten: vier Crypto.com-passen,
Bleap, twee Gnosis Pay-varianten en Wirex. Geen van de acht draagt een jaarprijs, dus een
rangschikking op cashback is niet eens **netto** te maken: je zou een opbrengst vergelijken zonder
de kosten die eronder horen. Dat is precies het soort som dat `netBenefit.ts` bestaat om te
weigeren.

**De nieuwe kop hangt aan een cijfer dat per definitie bestaat: zijn eigen saldo.** Hij voert dat
zelf in op de Punten-tab, en review-4 item 31 bevestigt dat dat de bedoeling is — *"zodra de
gebruiker zijn punten invoert kunnen we ze later met de extensie gebruiken, en hem van tijd tot tijd
om een verversing vragen."* Er is geen bron te scrapen, geen login, geen dekkingsprobleem. Het staat
er of het staat er niet, en als het er niet staat zegt de extensie dat.

**En het lost een echt probleem op.** Ongebruikte punten zijn onzichtbaar op het enige moment dat ze
ertoe doen. Zijn eigen zin is "*Amex points which I never use*" — dat is geen rekenprobleem maar een
herinneringsprobleem, en een herinnering hoort te vallen waar de beslissing valt.

### De vraag die dit plan nu maakt of breekt

De oude §0 vroeg of hij een gevulde winkelwagen zou verlaten voor 8,5% Klarna-cashback. Die vraag is
niet meer de beslisser. De nieuwe staat hieronder, en hij staat **onbeantwoord**:

> **Is een percentage dat hij pas ACHTERAF kan verzilveren nog steeds "very, very useful"?**

Want dat is wat Amex publiceert. *"Gebruik uw punten om uw aankopen te betalen via de Amex App of uw
online account"* — de inwisseling gebeurt tegen een afschrijving die er al staat, niet als
betaalmethode in de kassa van de winkel. De extensie kan dus eerlijk zeggen *"je punten dekken € 126
van deze € 360"*, maar de handeling is: betaal met de Amex-kaart, boek de punten daarna af in de
Amex App.

- **Is dat genoeg**, dan is dit plan compleet zoals het hier staat.
- **Verwachtte hij "klik hier en betaal met punten"**, dan bestaat dat product niet zonder dat een
  winkel het zelf aanbiedt, en dan is de eerlijke levering een *herinnering met een bedrag* in
  plaats van een knop.

Ik kan dit niet meten en ik ga het niet raden. *Een feit van de gebruiker gaat boven elke agent.*

### En één ongemakkelijke consequentie, meteen maar

Punten inwisselen bij Amex levert **overal dezelfde koers** op: € 0,003 per punt, tegen welke
afschrijving dan ook. Daaruit volgt iets dat de verkoopkant van dit idee tegenspreekt en dat er toch
in hoort: **er is aan deze kassa geen voordeel te halen dat er morgen niet ook is.** De punten gaan
niet verloren door hier met een andere kaart te betalen; ze blijven staan.

Sterker: aan een kassa in vreemde valuta is "gebruik je punten" een **verliesgevend** advies. Van de
14 Amex-regels in de catalogus dragen er **13** een koersopslag van **2,5%** (de veertiende, de
Corporate Card, heeft geen FX-cijfer en blijft dus onbekend). Met de Amex-kaart betalen om hier punten te
kunnen inwisselen kost dan 2,5% van het hele bedrag, terwijl die punten volgende week op een
euro-aankoop precies evenveel waard zijn. De extensie mag dat dus niet als arbitrage verkopen.

**Wat overblijft is de herinnering, en die is het waard.** "Je hebt hier € 126 aan punten liggen" op
het moment van kopen is iets dat vandaag niemand hem vertelt, en het is de reden dat hij ze nooit
gebruikt. Dat is de kop. De som eronder is de onderbouwing, geen belofte van winst.

---

## 1. De aanbeveling

**Bouw "Aan de kassa" als één Manifest V3-extensie voor Chrome én Edge, met PUNTEN als kop en de
kaartrangschikking als tweede regel.**

Op een afrekenpagina leest hij het bedrag en de valuta, vraagt de open LaVega-tab om een berekening,
en toont:

1. **per puntenprogramma met een saldo**: wat dat saldo hier dekt — in euro's en als percentage —
   maar **alleen als er een gepubliceerde koers is**. Is die er niet, dan alleen dat het saldo er is;
2. **bij een aankoop in vreemde valuta**: welke van zijn kaarten deze aankoop het goedkoopst maakt,
   uit dezelfde catalogus en met dezelfde bron-en-datumregel als de Travel Agent;
3. **wat er niet gelezen kon worden**, met de reden — als eersteklas uitkomst, niet als randgeval.

Optie B (achter zijn eigen login inloggen bij Amex of een kaartportaal) blijft **afgewezen**, en de
omkering geeft er een reden bij die er eerst niet was: **voor dit product is een login overbodig.**
Het saldo komt van hem. De enige reden om in te loggen was het ophalen van persoonlijke
aanbiedingen, en dat is niet meer waar dit over gaat. Zie §7.

---

## 2. Het gat, eerlijk opgeschreven — want dit bepaalt of het kan

**Wij weten zijn saldo. Wij weten niet wat een specifieke webwinkel accepteert.**

"35% van deze aankoop met je punten" veronderstelt een inwisselkoers **bij die winkel**. Zo'n koers
is er voor geen enkel Nederlands programma publiek te lezen. Wat er wél is, is per programma
verschillend, en dat verschil bepaalt letterlijk welke zin op het scherm mag komen.

Alles hieronder is op **21 augustus 2026** zelf opgehaald, met plain curl en een browser-UA, geen
sleutels, en zonder één botcontrole te omzeilen.

| Programma | Saldo | Koers naar euro's | Zonder sleutel te lezen? | Wat de extensie mag zeggen |
|---|---|---|---|---|
| **Amex Membership Rewards** | hij voert in | **1.000 punten = € 3** (€ 0,003/punt) | **ja** — `americanexpress.com/nl-nl/rewards/membership-rewards/`, HTTP 200 op plain curl, 604.291 bytes | bedrag én percentage van deze aankoop, met bron, datum en Amex' eigen voorbehoud |
| **ING Punten** | hij voert in | **geen** — en voor geld een *uitgesproken nul* | spaartabel ja (pagemodel-API, 200); de ING Winkel **nee**, die zit achter login | alleen dát hij ze heeft, plus wat ING zelf zegt |
| **Revolut RevPoints** | hij voert in | verdienkoers ja, **inwisselwaarde niet vast** (Revolut zegt dat zelf) | via `r.jina.ai`; directe curl gaf eerder 403 | alleen het saldo |
| **Flying Blue Miles** | hij voert in | award-prijzen zijn per vlucht, geen koers | **nee** — zie hieronder | alleen het saldo |
| **Air Miles NL** | hij voert in | niet vastgesteld | **nee** — `airmiles.nl` levert 3.131 bytes shell, geen inhoud zonder browser | alleen het saldo |

### Wat Amex letterlijk zegt

> Betalen met punten via de Amex App in drie stappen. **1.000 Membership Rewards punten zijn gelijk
> aan € 3.** Deze verhouding kan naar goeddunken van American Express en zonder voorafgaande
> kennisgeving gewijzigd worden.

en, over de route:

> Gebruik uw punten om uw aankopen te betalen via de Amex App of uw online account.

Twee dingen volgen daaruit, en ze zijn allebei goed nieuws voor de bouw:

- **De koers is niet winkelafhankelijk.** Wat zijn punten hier dekken is rekenwerk op zijn eigen
  saldo maal een gepubliceerd getal. De webwinkel hoeft nergens aan mee te werken. Dat is precies de
  reden dat dit product kán en het oude niet kon.
- **Amex zegt er zelf bij dat de verhouding zonder aankondiging kan wijzigen.** Dat cijfer heeft dus
  een korte houdbaarheid en hoort **nooit zonder datum** in beeld — dezelfde regel als bij de
  kaartvoorwaarden (`2026-08-17-card-terms-freshness-design.md`).

**Wat er níet uit volgt**: dat een Nederlandse webwinkel "Betalen met Punten" in zijn eigen kassa
aanbiedt. Amex publiceert daar geen lijst van, en wij kunnen aan een afrekenpagina niet zien of een
winkel Amex überhaupt accepteert. De extensie beweert dat dus niet — hij noemt de route en laat de
voorwaarde staan.

Ook gemeten: de **Amex Rewards Shop** (`rewardsshop.touchincentive.com/nl/catalogue/`) is publiek
leesbaar, HTTP 200, 88.814 bytes — maar alle prijzen staan er in **euro's** en het woord "punten"
komt er geen enkele keer in voor. De puntenprijs zit achter de login. Er valt daar dus geen tweede
koers vandaan te halen.

### Wat ING letterlijk zegt

> Nee, ING Punten hebben geen monetaire waarde en kunnen niet worden ingewisseld voor geld.

Dat is een **bekende nul**, en precies de keerzijde die de huisregel toestaat: een uitgesproken
"nul" is een feit, geen ontbrekend cijfer. Maar hij geldt alleen voor **geld**. Wat een punt aan
korting oplevert in de ING Winkel is een ander getal, en dat is niet openbaar — ING's eigen zin is
opzettelijk vaag ("250 Punten, in te wisselen voor een paar euro korting op je bioscoopkaartjes"),
en de winkel zelf begint met *"Log in in de ING Winkel"*. Meer dan 1.000 deals, allemaal achter de
login.

**Dus voor ING is het antwoord: alleen dat hij punten HEEFT.** En dat is nog steeds nuttig. "Je hebt
hier 8.400 ING Punten liggen" op een afrekenpagina is een herinnering die vandaag niemand geeft. Er
mag alleen geen percentage bij, want dat percentage kennen we niet — en een verzonnen percentage is
erger dan geen.

### Wat er dicht bleef, en dat is ook een antwoord

`www.klm.nl`, `www.flyingblue.com` en `www.airfrance.nl` weigeren een gewone curl: **curl-fout 92,
`HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`**, binnen een tiende seconde, terwijl DNS
gewoon naar Akamai wijst. Via `r.jina.ai` komt er wel een 200 binnen, maar met een lege body — de
site rendert zijn inhoud in de browser. `airmiles.nl` geeft 200 met 3.131 bytes: een shell zonder
inhoud, op elke URL dezelfde.

**Dat is niet omzeild en dat wordt het ook niet.** Een 403 of een gesloten stream is een antwoord.
Het praktische gevolg is klein: Flying Blue-award-prijzen verschillen per vlucht, dus er zou ook met
een browser geen koers uit komen. Voor deze twee programma's blijft het bij het saldo.

---

## 3. Wat er van het oude plan BLIJFT en wat VERVALT

Expliciet, zodat niemand hoeft te raden welk stuk werk nog geldt.

### Blijft, ongewijzigd

| Onderdeel | Waar het stond | Waarom het blijft |
|---|---|---|
| **Het lezen van de afrekenpagina** (bedrag + valuta + host) | oude §8 plakje 2 | Zonder bedrag geen percentage. Dit onderdeel wordt door de omkering **belangrijker**, niet minder belangrijk. Ongewijzigd overgenomen, inclusief de regel dat een onleesbaar bedrag een `reason` geeft en nooit een gok. |
| **De posture-regels van MV3** (`activeTab` + `optional_host_permissions`, nooit een statische matchlijst) | oude §3a | Onaangeraakt. De klik op het icoon ís de toestemming, en dat wordt door de browser afgedwongen in plaats van door onze code beloofd. |
| **Het kanaal en de redactiegrens** | oude §3b | Blijft, met **één benoemde wijziging** — zie §5. |
| **`packages/core` blijft puur; `asOf` komt van de aanroeper** | oude §3c | Onaangeraakt. |
| **Chrome + Edge, één MV3-bundel; geen Firefox, geen Safari** | oude §4 | Beslist, blijft beslist. |
| **Niets ophalen tijdens runtime; bundelen tijdens de sweep** | oude §2 / plakje 5 | Onaangeraakt, en het patroon van `bundle-bank-logos.ts` wordt nu gebruikt voor de puntenkoersen in plaats van voor de Klarna-tabel. |
| **De lege en de onbekende toestand als eersteklas uitkomst** | oude §8 plakje 6 | Onaangeraakt. |
| **De rangschikking op FX-kosten** (`marketFxOptions`, `fxSwitchGain`, `issuerConsensus`, `bestPayAdvice`) | oude §2 | 73 van de 86 kaartregels dragen een FX-cijfer. Dat is echte dekking. Het zakt van kop naar tweede regel en verschijnt alleen bij een aankoop in vreemde valuta. |
| **`RewardsBalance` + `isStale`** (`packages/core/src/rewards.ts`) | bestond al, stond niet in het plan | Een saldo draagt al `updatedAt`, en `isStale(b, asOf, 90)` bestaat al. De verversingsvraag uit review-4 item 31 hoeft dus niet gebouwd te worden — alleen aangeroepen. |

### Vervalt

| Wat | Waarom |
|---|---|
| **Cashback als kop van de extensie** | 8 cijfers op 185 regels, alle acht crypto/prepaid-crypto, en **nul** ervan draagt een prijs. Een netto rangschikking is er niet uit te maken. Gemeten vandaag, niet aangenomen. |
| **De oude §0** (zou hij een winkelwagen verlaten voor 8,5%?) | Was de beslisser omdat winkelaanbiedingen de kop hadden kunnen worden. Met punten als kop beslist die vraag niets meer. Vervangen door de nieuwe §0. |
| **Klarna als kop, en `bundle-merchant-offers.ts` als plakje 5** | Klarna's cashback wordt verdiend *in de Klarna-app*, met een Klarna-saldo, na goedkeuring van de winkel. Die meting staat en verandert niet. Wat ervan overblijft mag hooguit een gelabelde bijregel zijn, en het is **geen v1**. |
| **De puntenkolom "zodra er een tweede uitgever met een koers is"** als bouwtrigger | Vervalt als *trigger* omdat punten nu de kop zijn. Blijft staan als reden om §2 uit te breiden (zie §8). |

### Bestond al en verandert van rol

De vraag *"voor welke kaarten mag hij rangschikken — alleen die hij heeft, of alles?"* (oude §9.3)
wordt bij punten **eenvoudiger**: een puntensaldo dat hij niet heeft, bestaat niet. De extensie toont
alleen programma's met een ingevoerd saldo. Voor de FX-tweede-regel blijft de vraag open en staat
hij in §9.

---

## 4. Wat er op het scherm komt — drie zinsvormen, en niet meer dan drie

De regel erachter is huisregel 2: *beweer nooit een conclusie die een afwezigheid niet kan dragen.*
Welke vorm er verschijnt, hangt alleen af van wat er bewezen is.

**Vorm 1 — saldo én gepubliceerde koers.** De enige vorm waarin een percentage mag vallen.

> **American Express — je punten dekken € 126 van deze € 360 (35%).**
> 42.000 punten, door jou ingevoerd op 12 augustus.
> Bij 1.000 punten = € 3. Je betaalt met de Amex-kaart en boekt de punten daarna af in de Amex App.
> Bron: americanexpress.com/nl-nl, gelezen 21-08-2026. Amex kan die verhouding zonder aankondiging
> wijzigen.

**Vorm 2 — saldo, geen koers.** Een herinnering zonder getal, en dat is het punt.

> **ING Punten — je hebt er 8.400 liggen.**
> Ingevoerd op 3 augustus. ING publiceert geen koers voor wat een punt in de ING Winkel waard is, en
> zegt zelf dat Punten niet in geld inwisselbaar zijn. Er staat hier dus geen percentage.

**Vorm 3 — niets bewezen.** Zeggen wat er niet gelezen kon worden, en waarom.

> **Het bedrag op deze pagina is niet te lezen.**
> Er staat geen prijs in de pagina-opmaak die LaVega kan vertrouwen. Vul het bedrag hieronder in, dan
> rekent hij het uit. Er wordt niets geraden.

En de tweede regel bij een aankoop in vreemde valuta, alleen dan:

> Deze winkel rekent in dollars. Met je Amex-kaart betaal je 2,5% koersopslag — € 9 op dit bedrag.
> Je punten zijn volgende week op een euro-aankoop precies evenveel waard.

**Vier dingen die er nooit mogen staan**, elk met de fout die eronder ligt:

1. **een percentage bij een programma zonder gepubliceerde koers** — dat is een verzonnen getal;
2. **"deze winkel accepteert je punten"** — dat kunnen we niet zien;
3. **een saldo zonder de datum waarop hij het invoerde** — een saldo van vier maanden oud
   gepresenteerd als nu is een stille onwaarheid, en `isStale` bestaat al om dat te vangen;
4. **"gebruik je punten hier en bespaar X"** bij een aankoop in vreemde valuta — dat is advies dat in
   de toestand waarin het verschijnt geld kost (huisregel 3).

---

## 5. De houding, en de ene grens die verschuift

§3a (`activeTab` + `optional_host_permissions`) en §3c (`packages/core` puur, `asOf` van de
aanroeper) staan onaangeroerd. Wat verandert is §3b, en het verdient een eigen alinea omdat het een
**redactiegrens** is.

**Wat er stond:** *"Geen saldi, geen IBAN's, geen transactietekst, geen rekeningsleutels over die
grens."*

**Wat er moet komen:** een **puntensaldo passeert die grens wel, en niets anders is eraan
toegevoegd.** De reden dat "geen saldi" er stond, was dat een bankbalans niets met een afrekenpagina
te maken heeft. Een puntensaldo is het product. Die twee moeten dus uit elkaar gehouden worden op
**naam**, niet op gevoel:

```
extensie → LaVega-tab : { kind: "quote", merchant, currency, amountCents }
LaVega-tab → extensie : { points: [ { program, points, updatedAt, stale,
                                      coverageCents | null, pct | null,
                                      why, sourceUrl, rateAsOf } ],
                          rows:   [ { product, costCents, netPct, sourceUrl, asOf, note } ],
                          unknowns: [ { what, why } ] }
```

- `points` mag alleen programma's bevatten waarvoor hij zelf een saldo heeft ingevoerd;
- `coverageCents` en `pct` zijn **null** zodra er geen gepubliceerde koers is — nooit 0, en de UI
  toont dan vorm 2;
- **geen** `accountBalance`, geen IBAN, geen transactietekst, geen rekeningsleutel, geen
  entiteitsnaam. De schematest uit plakje 3 is de plek waar dat wordt afgedwongen, en die test hoort
  te lezen als die van de LLM-proxy.

En één regel erbij die eerst niet nodig was: **de extensie bewaart het saldo niet.** Geen
`storage.sync`, geen `localStorage`, niets tussen twee pagina's. Zodra de tab dicht is, is er niets.
Dat is ook het antwoord op de vraag "moet de popup werken met de LaVega-tab dicht?" — nee, en dat is
geen beperking maar de grens zelf (§9).

---

## 6. Chrome en Edge — onveranderd besloten

Zijn keuze uit review 3: **één Manifest V3-extensie voor Chrome en Edge.** Eén codebase, één
manifest, geen `browser.*`-wrapper, geen polyfill. Firefox valt af omdat
`externally_connectable` daar een tweede kanaal zou vragen — en een tweede kanaal is een tweede plek
waar de redactiegrens van §5 bewaakt moet worden. Dat is de echte kost, niet het manifest.

Twee winkels, twee inzendingen (Chrome Web Store, Microsoft Partner Center), twee keer dezelfde vraag
over machtigingen — waarop `activeTab` het beste antwoord is dat er is.

Safari komt niet mee. Dat staat hier alleen zodat niemand denkt dat "Chrome en Edge" per ongeluk
"alles behalve Firefox" betekende.

---

## 7. Optie B blijft afgewezen, en nu met een reden erbij

**Optie B** was: inloggen als hem bij Amex of een kaartportaal en zijn persoonlijke
aanbiedingenlijst lezen. De bezwaren van 20 augustus staan nog steeds — brede staande
`host_permissions` op bankdomeinen, code binnen een ingelogde banksessie, scrapen tegen de
voorwaarden in, stil brekende selectors, en het verlies van de enige claim die LaVega anders maakt:
tijdens runtime wordt er niets opgehaald.

Wat de omkering toevoegt: **voor dit product is die login overbodig.** Het saldo komt van hem, de
koers staat op een publieke pagina die met plain curl 200 geeft. Optie B kocht toegang tot
*aanbiedingen*, en aanbiedingen zijn niet meer waar dit over gaat.

Blijft staan: B is geen latere fase van A. Het is een ander product met een andere risicohouding, en
er mag niet per ongeluk aan begonnen worden.

---

## 8. In plakjes — TDD, kleinste eerst

Elk plakje begint met een falende test en eindigt groen op `pnpm turbo run typecheck --force` **en**
`pnpm turbo run test --force`.

**Plakje 1 — `packages/core/src/checkout.ts`, puur.**
`pointsCoverage({ balances, rates, amountCents, currency, asOf })` → één rij per programma waarvoor
hij een saldo heeft. Tests die eerst moeten falen:

- een programma **zonder gepubliceerde koers** geeft `coverageCents: null` en `pct: null` met een
  reden — en **nooit** 0. Dit is de test die het hele product eerlijk houdt;
- **ING is een andere soort onbekend dan Flying Blue**, en dat moet in de uitkomst te zien zijn: bij
  ING is "geen geldwaarde" een *uitgesproken* uitspraak van de uitgever, bij Flying Blue hebben we
  simpelweg niets kunnen lezen. Twee verschillende `why`-waarden, want de zin op het scherm verschilt;
- een saldo ouder dan 90 dagen komt terug met `stale: true` (via `isStale`), het percentage blijft
  staan, en de datum staat erbij;
- `coverageCents` wordt **afgetopt op het aankoopbedrag**: 200.000 punten op een aankoop van € 30 is
  100%, niet 2000%;
- een leeg saldo levert **geen rij** op, en geen kop — dezelfde fout als *"je saldi staan al op de
  beste plek"*, overgezet naar dit oppervlak;
- de koers komt uit een gebundeld bestand mét `sourceUrl` en `checkedAt`; een rij zonder allebei is
  een gefaalde test.

**Plakje 2 — de bedraglezer, puur.** Ongewijzigd overgenomen uit het oude plan.
`readCheckout(html) → { currency, amountCents } | { reason }`. Fixtures: JSON-LD `Offer`, microdata
`itemprop="price"`, `<meta property="product:price:amount">`, en drie fixtures die een `reason`
moeten geven in plaats van een getal. Geen DOM, geen netwerk.

**Plakje 3 — het kanaal.** De vorm uit §5, met een schematest die bewijst dat de vraag alleen
merchant/valuta/bedrag draagt, dat het antwoord **wel** een puntensaldo mag dragen, en **geen**
bankbalans, IBAN, rekeningsleutel, transactietekst of entiteitsnaam. Deze test is de redactiegrens.

**Plakje 4 — `scripts/bundle-points-rates.ts` → `apps/extension/src/points-rates.generated.ts`.**
In exact de vorm van `bundle-bank-logos.ts`: opgehaald tijdens de sweep, ingebed, per regel
`sourceUrl` + `checkedAt` + de letterlijke voorwaarde. **Vandaag is dat één regel** — Amex,
1.000 = € 3 — en dat is genoeg om het patroon te bouwen. Het bestand groeit als er een tweede komt;
tot die tijd zegt het aantal regels de waarheid over de dekking.

**Plakje 5 — de schil.** `apps/extension/`: manifest (MV3, `activeTab`,
`optional_host_permissions`, geen statische matchlijst), content script, popup. Nederlandse UI, de
drie zinsvormen uit §4. Eén bundel voor Chrome en Edge. Kan het bedrag niet gelezen worden, dan zegt
de popup dat en biedt een handmatig veld.

**Plakje 6 — de FX-tweede-regel.** Alleen bij een niet-euro valuta. Hergebruikt
`marketFxOptions` / `issuerConsensus` / `bestPayAdvice`; voegt geen rekenwerk toe. Eén test die
vastlegt dat bij een euro-aankoop deze regel **helemaal niet verschijnt** — anders staat er op elke
Nederlandse afrekenpagina een zin over koersopslag die nergens over gaat.

**Plakje 7 — de lege en de onbekende toestand.** Een afrekening waar niets bewezen is, moet een
bruikbaar en eerlijk scherm opleveren: wat hij niet kon lezen, waarom, en geen ranglijst. Getest als
eersteklas uitkomst.

**Expliciet buiten v1**, elk met een reden:

- **geen euro-waardering van punten waar geen koers is** — drie uitgevers zeggen het zelf: ING
  (*"geen monetaire waarde"*), Revolut (*"RevPoints hebben geen vaste geldwaarde"*), en Amex, dat
  zijn eigen verhouding "zonder voorafgaande kennisgeving" kan wijzigen;
- **geen bewering dat een winkel punten accepteert** — niet te lezen, dus niet te zeggen;
- geen Klarna-bijregel (§3, vervalt uit v1);
- geen autofill, geen onderschepping van de afrekening, geen kaartkeuze namens hem;
- nergens inloggen;
- geen enkele fetch tijdens runtime — geen logo, geen tile, geen font;
- geen Firefox en geen Safari.

---

## 9. Wat de aanbeveling zou veranderen

Opgeschreven zodat het besluit omkeerbaar is op bewijs en niet op stemming.

- **Zijn antwoord op §0.** Verwacht hij een knop in de kassa in plaats van een herinnering met een
  bedrag, dan levert dit plan niet wat hij vroeg en moet het gesprek daarover gaan, niet over de
  bouw.
- **Een tweede programma met een gepubliceerde, zonder login leesbare inwisselkoers.** Vandaag is dat
  er precies één (Amex). Komt er een tweede, dan groeit `points-rates.generated.ts` met één regel en
  verandert er verder niets — dat is met opzet zo ontworpen.
- **ING die publiceert wat een punt in de ING Winkel waard is.** Dan gaat ING van vorm 2 naar vorm 1.
- **Een winkel die publiek en dateerbaar zegt dat hij een puntenprogramma accepteert.** Dan mag er
  voor het eerst iets winkelspecifieks op het scherm.
- **Een saldo dat we niet van hem hoeven te krijgen.** Dat zou Optie B zijn, en dan gelden alle
  bezwaren van §7 opnieuw. Niet stilletjes binnenlaten via een "handige koppeling".

---

## 10. Openstaande vragen

1. **De vraag in §0** — is een percentage dat hij achteraf in de Amex App verzilvert nog steeds wat
   hij bedoelde? Dit beslist de kop en dus de hele copy.
2. **Moet de popup werken met de LaVega-tab dicht?** Het ontwerp zegt nee, en met §5 erbij is dat nu
   een sterkere nee: ja zeggen betekent dat het puntensaldo in de extensie gaat wonen.
3. **Wil hij de FX-tweede-regel aan de kassa überhaupt?** De meeste Nederlandse afrekenpagina's staan
   in euro's, dus die regel zwijgt daar per definitie. Plakje 6 kan zonder gevolgen wachten.
4. **Hoe vaak vraagt de extensie om een verse saldo-invoer?** `isStale` staat nu op 90 dagen. Review-4
   item 31 zegt "van tijd tot tijd", en dat is geen getal. Zijn keuze, niet die van ons.

**Beslist en niet meer open:** de browser (§6 — Chrome en Edge, één MV3-bundel), en dat punten de kop
zijn en cashback niet (§0, §3).
