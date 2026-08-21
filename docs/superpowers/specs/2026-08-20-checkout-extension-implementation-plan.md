# De kassa-extensie — implementatieplan

Review-3 item **13**: *"make already an implementation plan on how you would make that extension, also
based on all the learns we've had."*

Dit bouwt voort op **`docs/BACKLOG.md` § 7.1 — "De houding van de extensie"** (tot 21-08 het kopje
*"Idea 2026-08-19 — a browser extension that spends the points you already have"*), waar de vier
houdingsregels al vastliggen. Ik herhaal ze hier niet; ik neem ze als gegeven en schrijf op wat er
sindsdien is veranderd, wat ik heb gemeten, en wat elke route kost.

Niets hiervan is gebouwd. Er is geen productiebestand aangeraakt.

Bijgewerkt **21 augustus 2026**: zijn browserkeuze is binnen (§4), en de puntendekking van de
catalogus is geteld (§3.4).

---

## 0. De vraag die dit plan maakt of breekt

**Zou hij een gevulde winkelwagen echt verlaten voor 8,5%?**

Deze vraag staat bovenaan omdat hij de waarde van het geheel beslist, en hij staat hier **onbeantwoord**.

Klarna's percentages zijn echt en ik heb ze zelf gemeten (§3.2). Maar ze zijn alleen te verdienen bij
afrekenen **in de Klarna-app**, met een Klarna-saldo, en de winkel moet het goedkeuren. De extensie
staat op de afrekenpagina in zijn browser — precies de plek waar dat voordeel niet bestaat.

De vraag is dus niet of het percentage klopt. De vraag is of hij, met een winkelwagen van € 400 bij
Zalando, die pagina verlaat en opnieuw begint in een telefoon-app voor € 34.

- **Zegt hij ja**, dan zijn winkelaanbiedingen de kop van de extensie. Dit wordt dan een
  koopjesproduct, de Klarna-tabel verdient een eigen slice, en Optie B (§5) wordt serieuzer dan ik
  hem hier maak. Dan is mijn aanbeveling verkeerd.
- **Zegt hij nee**, dan is de extensie wat §5 Optie A beschrijft: de logica van de Travel Agent op het
  moment van een echte aankoop. Klarna blijft dan één gelabelde regel eronder.

Ik kan dit niet meten en ik ga het niet raden. *Een feit van de gebruiker gaat boven elke agent.*

---

## 1. De aanbeveling

**Bouw Optie A — alleen publieke data, geen login — als één Manifest V3-extensie voor Chrome én
Edge.** Lever hem als *"Aan de kassa"*: op een afrekenpagina rangschikt hij **zijn eigen kaarten** naar
wat deze aankoop op elk daarvan werkelijk kost, uit de gebundelde catalogus. Winkelaanbiedingen zijn
een gelabelde tweede regel, geen kop.

Drie dingen dragen dat, en het tweede en derde zijn nieuw sinds de notitie van 19 augustus.

1. **De reden om te wachten is vervallen.** De notitie zei *"de eerlijke stand vandaag is 20 van de
   124 gedekt"* en concludeerde dat de extensie moest wachten op dekking. Gemeten in
   `docs/catalog/catalog.json` (122 producten, gegenereerd 19-08): **73** FX-percentages, **51**
   puntencijfers, **32** spaarrentes, **8** cashbackcijfers. Zes extra FX-pins liggen klaar in
   `2026-08-20-catalog-fx-gaps-and-ing-punten-data.md` en brengen kaart-FX naar 79 van 82 — die merge
   is nog niet gedaan, de vastgelegde catalogus staat nog op 73. Het wachten is voorbij; "onbekend" is
   de uitzondering geworden en niet meer de regel.

2. **Klarna houdt geen stand als premisse.** De opdracht zei dat publieke data het alleen voor Klarna
   draagt. De percentages zijn echt en ik heb ze gereproduceerd — maar Klarna's eigen voetnoot zegt
   dat de cashback alleen wordt verdiend bij aankopen **in de Klarna-app**. Een extensie die in zijn
   browser afgaat, kan hem niet leveren. Details en citaten in §3.2. Dit is de meting die het plan
   beslist: de enige publieke aanbiedingenset die we hebben, beschrijft een voordeel dat **niet
   bestaat op de pagina waar de extensie op staat**.

3. **Punten zijn buiten American Express nergens te bewijzen.** Van de 51 puntencijfers zijn er 37 een
   bewezen nul en 14 groter dan nul, en die 14 zijn állemaal Amex (§3.4). Een puntenkop is dus een
   Amex-kop, voor hem en voor bijna niemand anders.

Wat overblijft is dus geen kortingszoeker. Het is de *"pay with Revolut, that saves you € 14 on a
thousand"*-logica van de Travel Agent, verplaatst naar het moment van een echte aankoop — en dat is
ook precies wat hij vroeg, en de enige versie waarvan we de getallen kunnen bewijzen.

---

## 2. Wat er al staat, zodat dit een oppervlak is en geen herbouw

Gemeten, niet aangenomen — elk pad hieronder is gelezen.

| Onderdeel | Waar | Wat het al doet |
|---|---|---|
| De gebundelde catalogus | `docs/catalog/catalog.json`, als statische module geïmporteerd door `apps/web/src/catalogue-rates.ts`, `views/Valuta.tsx`, `components/blocks/TravelBlock.tsx` | 122 producten, elk cijfer met `value` + `sourceUrl` + `checkedAt` + `conditions` |
| Rangschikken op FX-kosten | `packages/core/src/catalogRates.ts` → `marketFxOptions`, `fxSwitchGain` | goedkoopste eerst; `fxSwitchGain` geeft **null** als zijn eigen tarief onbekend is, met opzet |
| Rangschikken op cashback | zelfde bestand → `marketCashbackOptions`, `cashbackSwitchGain` | beste eerst; een bewezen 0% blijft een *feit* maar telt niet als *aanbod* |
| Dubbelzinnigheid zonder vraag | zelfde bestand → `issuerConsensus` | "American Express / activity" → 2,5% omdat alle 13 Amex-producten het eens zijn; geeft null zodra ze dat niet zijn |
| Eén aankoop prijzen | `packages/core/src/travel.ts` → `bestPayAdvice`, `rankSpendOptions`, `payHeadline`, `costOnReferenceSpend` | prijst een betaling al over koersopslag en cashback en maakt er de zin bij |
| Wat een kaart oplevert op een uitgave | `packages/core/src/returns.ts` → `annualSpendCents`, `accountReturns`, `optimiseReturns` | met `SpendKind` al gemodelleerd als `exact` / `upper-bound` / `unknown` |
| Bundelen tijdens de sweep, draait al | `scripts/bundle-bank-logos.ts` → `apps/web/src/assets/bank-logos.generated.ts` (44 kB data-URI's) + `TRADEMARKS.md` | het patroon dat review-3 item 12 goedkeurt: opgehaald tijdens de sweep, ingebed, **in de browser niets opgehaald** |

**De extensie schrijft geen rangschiklogica.** Hij schrijft een content script, een kanaal en een
popup. Alles wat rekent is een aanroep in `@lavega/core`. Dat is de belangrijkste reden om de kleine
versie te kiezen: het dure, geteste, eerlijke deel is klaar.

`bank-logos.generated.ts` verdient een aparte vermelding, want het is het antwoord op het bezwaar dat
hij in review-3 item 12 terecht heeft weggestreept, en het staat al in de boom. De kop van dat bestand
zegt de regel in de woorden van de repo zelf: *"Elk logo is tijdens een SWEEP bij de aanbieder zelf
opgehaald en hier als data-URI neergelegd. In de browser wordt er dus niets opgehaald."* Wat de
extensie ook nodig heeft om te tonen — een kaartvlak, een winkelmerk, een vlag — dat gaat door die
deur of het gaat niet mee.

---

## 3. Wat de houding toevoegt, specifiek voor een extensie

De vier regels uit de backlog blijven staan. Drie extra beperkingen volgen uit het feit dat dit een
*extensie* is en geen tab, en die stonden niet in de notitie van 19 augustus:

**3a. Een MV3 host permission is een staande bevoegdheid, geen eenmalige leesbeurt.** `activeTab`
wordt per gebruikersgebaar gegeven en sterft met de tab; een `host_permissions`-patroon is permanent
en stil. De extensie gebruikt daarom **`activeTab` + `optional_host_permissions`**, en nooit een
statische matchlijst. Hij klikt op het icoon op een afrekenpagina; die klik ís de toestemming. Daarmee
is "opt-in per site, standaard uit" een eigenschap die de **browser afdwingt**, en niet een belofte
die onze code nakomt.

**3b. De extensie mag de kluis niet kunnen lezen, ook niet als hij het zou willen.** Het kanaal is
`window.postMessage` naar een open LaVega-tab (of `externally_connectable` naar de app-origin), en de
vorm van vraag en antwoord ligt vast en is klein:

```
extensie → LaVega-tab : { kind: "quote", merchant: string, currency: string, amountCents: number }
LaVega-tab → extensie : { rows: [ { product, costCents, netPct, sourceUrl, asOf, note } ],
                          unknowns: [ { product, why } ] }
```

De tab rekent; de extensie toont. Geen saldi, geen IBAN's, geen transactietekst, geen rekeningsleutels
over die grens — dezelfde redactiediscipline als bij de LLM-proxy, toegepast op ons eigen oppervlak.
De extensie bewaart niets tussen twee pagina's.

**3c. `packages/core` blijft puur, dus het bedrag én de datum komen van de aanroeper.** De extensie
leest nergens een datum; de tab geeft `asOf` mee. Geen `Date.now()`, geen `new Date()`, geen fetch in
de nieuwe core-code — net als de rest van het pakket.

---

## 4. Chrome en Edge — besloten

Zijn keuze, review 3 (avond): **één Manifest V3-extensie voor Chrome en Edge.** Firefox valt af, want
dat zou een tweede kanaal vragen voor de verbinding met de LaVega-tab.

Wat die keuze concreet betekent voor de bouw:

- **Eén codebase, één manifest.** Edge draait op Chromium en leest hetzelfde MV3-manifest; de
  `chrome.*`-API's bestaan er onder dezelfde naam. Er is geen tweede build-target, geen
  `browser.*`-wrapper en geen polyfill.
- **Het kanaal uit §3b werkt in beide.** `externally_connectable` naar de app-origin is een
  Chromium-mechanisme. Firefox ondersteunt het niet op dezelfde manier: daar zou het via een content
  script en `window.postMessage` moeten, of via een eigen transport. Dat is letterlijk het tweede
  kanaal dat hij niet wil, en het is een tweede plek waar de redactiegrens (§3b) getest en bewaakt
  moet worden. Dat is de echte kost, niet het manifest.
- **Twee winkels, twee inzendingen.** Chrome Web Store en Microsoft Partner Center. Dezelfde bundel,
  twee beoordelingen, twee wachttijden — en twee keer dezelfde vraag over machtigingen, waarop
  `activeTab` het beste antwoord is dat er is (§3a).
- **Wat er niet mee komt:** Safari. Dat is geen Chromium en geen kleine stap; het staat hier alleen
  zodat niemand denkt dat "Chrome en Edge" per ongeluk "alle browsers behalve Firefox" betekende.

---

## 5. Wat ik heb gemeten

### 5.1 Amex Offers — schoon negatief, opnieuw bevestigd

Vier NL-paden, browser-UA, redirects gevolgd:

```
https://www.americanexpress.com/nl-nl/aanbiedingen/           → 404
https://www.americanexpress.com/nl-nl/benefits/amex-offers/    → 404
https://www.americanexpress.com/nl-nl/offers/                  → 404
https://www.americanexpress.com/nl-nl/kaarten/aanbiedingen/    → 404
```

Amex Offers is geen publiek NL-oppervlak. Het zit achter de kaarthouderslogin, of het bestaat niet in
deze markt — welke van de twee, zeggen deze 404's niet, en dat verschil hoort niet weggeschreven te
worden. Wat het wel vaststelt: er is **niets publieks om tegenaan te bouwen**. Dat is het sterkste
argument dat Optie B de enige route naar aanbiedingen op winkelniveau is, en meteen de reden dat
Optie B duur is (§6).

### 5.2 Klarna — de percentages zijn echt, en ze zijn **niet uitgeefbaar in de browser**

`https://www.klarna.com/nl/cashback/` → **200, plain curl, browser-UA, 802.909 bytes, zonder render**.
De percentages per winkel staan in de geserveerde HTML in `data-slot`-spans. Er met een gewone regex
uit gehaald, op de dag van meten:

| winkel | tag, letterlijk |
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

12 winkels, 12 `store-name`-slots, 12 `store-tag`-slots — exact, geen steekproef. **De opdracht noemt
29 direct en 218 met een render; op deze URL kreeg ik er 12.** Ik rapporteer wat ik heb gemeten in
plaats van de opdracht na te zeggen. Die 29 kunnen van een ander Klarna-oppervlak komen; als dat zo
is, hoort iemand te zeggen welk, want het is deze niet.

**En dan het deel dat het plan beslist.** Elke tag eindigt op *"in de app"*, en Klarna's eigen voetnoot
zegt waarom, letterlijk:

> Verdien cashback op aankopen via de Klarna App. Een Klarna-saldo account is vereist om cashback te
> ontvangen. De uitgifte van cashback is afhankelijk van goedkeuring door de winkel en kan worden
> beïnvloed door cookie-instellingen, het combineren van aanbiedingen, productuitsluitingen of andere
> factoren waar wij geen invloed op hebben.

en, van dezelfde pagina:

> Cashback verdien je als punten wanneer je shopt met Klarna. Je kunt cashback verdienen op
> geselecteerde aankopen in de Klarna-app, en met een lidmaatschap kun je ook cashback verdienen op
> alle betaalpasaankopen met de Klarna Card of wanneer je Betaal nu gebruikt met je Klarna-saldo.

Dus: verdiend in de Klarna-app, niet in de browser. Vereist een actief Klarna-saldo. Het bedrag hangt
af van goedkeuring door de winkel, van cookies en van het stapelen van aanbiedingen. Sommige tarieven
alleen met een betaald lidmaatschap. En het landt als **punten**, in te wisselen voor Klarna-saldo —
niet als geld op zijn rekening.

Drie huisregels bijten tegelijk. *Beweer geen conclusie die een afwezigheid niet kan dragen* — een kop
"8,5% terug bij Zalando" op een Zalando-afrekenpagina is een bewering die die pagina niet waarmaakt.
*Een melding geeft nooit advies dat niet kan werken in de toestand waarin het verschijnt* — iemand
vertellen dat hij een gevulde winkelwagen moet verlaten en opnieuw beginnen in een telefoon-app, is
advies dat niet werkt waar het staat. En *onbekend is nooit een vergelijking* — een aanbieding die
afhangt van goedkeuring door de winkel is geen getal dat je naast een bewezen 2,5% koersopslag legt om
er vervolgens van af te trekken.

**Waar Klarna wél goed voor is:** een gelabelde, eerlijke tweede regel. *"Klarna geeft hier 8,5% — maar
alleen als je in de Klarna-app afrekent, met een Klarna-saldo, en de winkel moet het goedkeuren."* Dat
is waar, het heeft een bron, het heeft een datum, en het doet niet alsof het onderdeel is van de som.

Of die regel een kop wordt, hangt aan §0.

### 5.3 Trading 212 winkelaanbiedingen — onbruikbaar, zoals genoteerd

Overgenomen uit de opdracht zonder eigen meting: T212 heeft winkelaanbiedingen die voor hem
onbruikbaar zijn. Gemarkeerd als **niet door mij geverifieerd**; het verandert de aanbeveling in geen
van beide richtingen, want beide opties behandelen winkelaanbiedingen als tweede regel.

### 5.4 Welke producten in de catalogus een aantoonbaar puntenprogramma hebben

Geteld in `docs/catalog/catalog.json`, 122 producten:

| | aantal |
|---|---|
| producten met een `pointsPerEuro`-cijfer | **51** |
| daarvan een **bewezen nul** | **37** |
| daarvan **groter dan nul** | **14** |
| producten zonder enig puntencijfer | 71 |

**Alle 14 positieve cijfers zijn American Express:**

| product | punten per euro |
|---|---|
| Amex Blue Card | 0,5 |
| Amex Green Card | 1,0 |
| Amex Gold Card | 1,0 |
| Amex Platinum Card | 1,0 |
| Flying Blue Amex Entry | 0,5 |
| Flying Blue Amex Silver | 0,8 |
| Flying Blue Amex Gold | 1,0 |
| Flying Blue Amex Platinum | 1,5 |
| Amex Business Entry Card | 1,0 |
| Amex Business Green Card | 1,0 |
| Amex Business Gold Card | 1,0 |
| Amex Corporate Card | 1,0 |
| Amex Corporate Gold Card | 1,0 |
| KLM Amex Corporate Card | 1,0 |

**Wat dat betekent voor de extensie.** Buiten Amex is er in de catalogus geen enkel product waarvan de
puntenopbrengst per bestede euro te bewijzen valt. Een puntenkop is dus een Amex-kop. Voor hém werkt
dat toevallig — hij heeft de Business Gold, 1,0 punt per euro, 2,5% koersopslag — maar voor de meeste
gebruikers zou de extensie op dit onderdeel niets te zeggen hebben, en dan hoort hij te zwijgen in
plaats van iets te schatten.

**Twee toevoegingen liggen klaar en zijn nog niet samengevoegd** (`docs/catalog/staging-points.json`,
uit de ronde van 21 augustus). Beide raken dit plan direct:

- **ING Punten bestaan, en er is geen koers per bestede euro.** De verdientabel is inmiddels leesbaar
  via ING's eigen payload-API, maar ING beloont **drempels**: *"Meer dan € 100 uitgeven met je ING
  Creditcard Extra of Max → 250 punten per maand"* — bij € 100 en bij € 4.000 evenveel. Er valt dus
  niets te vermenigvuldigen met een winkelwagenbedrag. Dit is geen ontbrekend cijfer maar een
  ontbrekende *vorm*, en dat is een sterker soort onbekend: geen latere zoekronde lost het op. Over
  inwisselen is ING wél expliciet, en dat is een bekende nul: *"ING Punten hebben geen geldwaarde."*
- **RevPoints hebben wél een koers**: 0,1 / 0,1 / 0,25 / 0,5 punt per euro voor Standard / Plus /
  Premium / Metal. De inwisselwaarde niet, en Revolut zegt dat zelf: *"RevPoints hebben geen vaste
  geldwaarde en hun waarde hangt af van de gekozen inwisselmethode."*

**Gevolg voor §8's regel "geen euro-waardering van punten":** die rust nu op drie onafhankelijke
uitspraken van uitgevers en niet meer op één principe van ons.

En het spiegelbeeld, want het is de andere helft van de ranglijst: **cashback staat op 8 van de 122
producten.** De cashback-kant van de rangschikking rust dus op een smalle basis, en dat hoort de UI te
laten zien in plaats van te verbergen.

---

## 6. De twee opties

### Optie A — alleen publieke data

**Wat het is.** MV3-extensie voor Chrome en Edge. Het content script leest **merchant-host + totaal +
valuta** van de afrekenpagina en verder niets. Het stuurt dat naar de open LaVega-tab. De popup toont
zijn kaarten, gerangschikt naar wat deze aankoop op elk kost, uit de gebundelde catalogus, elke regel
met zijn brondatum. Gebundelde Klarna-percentages verschijnen als gelabelde bijregel waar de host
overeenkomt.

**Wat hij eraan heeft.** Bij een afrekening van € 300 in USD een gerangschikte lijst: *"Revolut Metal
— € 300,00, 0% (revolut.com, 9 juli 2026). ING betaalpas — € 304,20, 1,40% koersopslag
(assets.ing.com, 15 juni 2026). Verschil: € 4,20."* Binnenlandse aankopen in euro's rangschikken op
cashback, via `marketCashbackOptions`. Waar het cijfer van een kaart niet bewezen is, zegt de regel
**onbekend** en wordt hij niet gerangschikt — nooit een nul, nooit een default.

**Kosten.** Klein. Zes plakjes, §8. Geen nieuwe rangschiklogica: `bestPayAdvice`, `marketFxOptions`,
`fxSwitchGain`, `issuerConsensus` en `marketCashbackOptions` bestaan en zijn getest. Nieuw is een
lezer voor merchant en bedrag, een kanaal, een popup, en één buildscript dat de Klarna-tabel bundelt
zoals `bundle-bank-logos.ts` de logo's bundelt.

**Risico's, eerlijk.**
- *Het bedrag van een willekeurige afrekenpagina lezen is het moeilijke deel, niet het rekenwerk.* Er
  is geen standaard. Realistische eerste slag: `<meta itemprop="price">`, JSON-LD `Offer.price` /
  `Order.total`, plus de valuta uit hetzelfde blok. Op een pagina die niets daarvan biedt, moet de
  extensie zeggen *"ik kan het bedrag hier niet lezen"* en een handmatig invoerveld geven — hij mag
  nooit gokken op de grootste eurotekst op de pagina. Een verkeerd bedrag levert stilletjes een
  verkeerde aanbeveling, en dat is erger dan geen aanbeveling.
- *De winkeldekking is dun.* 12 Klarna-winkels, allemaal consumentenretail. Op de meeste
  afrekenpagina's ontbreekt de bijregel gewoon, en dat is prima — de kaartrangschikking is het
  product.
- *Verouderde catalogusdata valt op een slechter moment op.* Een tarief van drie jaar oud is te
  verdragen in een tab en ongemakkelijk aan de kassa. Verzachting: elke regel toont zijn datum al, en
  `2026-08-17-card-terms-freshness-design.md` bestaat precies hiervoor. Voorbehoud: bij `ing-betaalpas`
  is die datum zelf verdacht — het bronbestand heet `…_2023.pdf` en de regel draagt `2026-06-15`
  (`docs/BACKLOG.md` §2.3). Aan de kassa is een verkeerde datum erger dan in een tab, want daar is de
  datum het enige dat de gebruiker over de betrouwbaarheid vertelt.

### Optie B — achter zijn eigen login

**Wat het is.** De extensie, of een metgezel, logt als hem in bij Amex / Klarna / kaartportalen en
leest zijn persoonlijke aanbiedingenlijst — de enige plek waar NL-winkelaanbiedingen aantoonbaar staan
(§5.1).

**Wat hij eraan heeft.** Echte, op hem gerichte aanbiedingen. Inhoudelijk beter dan Optie A ooit kan
tonen.

**Kosten.** Groot, en het meeste ervan is geen code.
- Brede `host_permissions` op zijn bank- en kaartdomeinen, permanent. Dat is het omgekeerde van §3a.
- De extensie zit dan binnen een ingelogde banksessie. Elke bug erin is een bug met zijn ingelogde
  Amex-account. Een portaal scrapen is bovendien bij de meeste uitgevers in strijd met de
  voorwaarden — en de read-only-houding in `docs/CONTEXT.md` bestaat juist om buiten die categorie
  vragen te blijven.
- Selectors tegen een ingelogd portaal breken stil en vaak, en elke breuk is onzichtbaar totdat een
  aanbeveling zachtjes fout is.
- Het vernietigt de eigenschap die hem is beloofd: er wordt tijdens runtime niets opgehaald. Een
  aanbiedingenlijst lezen aan de kassa **ís** een runtime-fetch, en hij vertelt die server waar hij
  naar kijkt.

**Risico's.** Sessiecompromittering, schending van voorwaarden, stille breuk, en het verlies van de
ene claim die LaVega anders maakt. Plus: Amex' vier 404's betekenen dat er geen stabiel publiek
contract is om tegenaan te bouwen, dus dit is voor altijd een bewegend doel scrapen.

### De vergelijking, één regel per rij

| | Optie A | Optie B |
|---|---|---|
| Data | gebundelde catalogus (73/82 FX nu, 79/82 na de merge) + 12 Klarna-winkels | zijn persoonlijke aanbiedingenlijsten |
| Netwerk tijdens runtime | **geen** | vereist, per afrekening |
| Machtigingen | `activeTab` + optionele hosts | staande host permissions op bankdomeinen |
| Raakt zijn sessies | nee | ja |
| Breekt bij een herontwerp van een site | de bedraglezer | alles |
| Kwaliteit van het antwoord | bewezen, gedateerd, smal | rijk, niet te verifiëren, broos |
| Omvang van de bouw | klein | groot, en nooit af |

**Aanbevolen: A.** B is geen latere fase van A — het is een ander product met een andere risicohouding,
en er mag niet per ongeluk aan begonnen worden.

---

## 7. Wat de aanbeveling zou veranderen

Opgeschreven zodat het besluit omkeerbaar is op bewijs en niet op stemming.

- **Zijn antwoord op §0.** Zegt hij dat hij voor 8,5% echt overstapt naar de Klarna-app, dan wordt de
  bijregel een kop en heb ik het mis. Dat is de invoer die ik niet kan meten en die boven mijn lezing
  gaat.
- **Een publieke, gedateerde aanbiedingenfeed per winkel voor een kaart die hij écht heeft.** Niet
  Klarna's alleen-in-de-app-tabel, maar iets dat in een browser uitgeefbaar is.
- **De Klarna-cijfers "29 direct / 218 gerenderd" gereproduceerd op een genoemde URL** waar de
  aanbieding *niet* app-only is. Dan wordt de winkelhelft van Optie A echt en een eigen slice waard.
- **Een tweede uitgever met een bewijsbare puntenkoers.** Vandaag is dat alleen Amex (§5.4). Komt daar
  een tweede bij die publiek een koers per euro noemt, dan wordt een puntenkolom in de popup
  verdedigbaar; nu is het één merk.

---

## 8. Optie A, in plakjes — TDD, kleinste eerst

Elk plakje begint met een falende test en eindigt groen op `pnpm turbo run typecheck --force` **en**
`pnpm turbo run test --force`.

**Plakje 1 — `packages/core/src/checkout.ts`, puur.**
`quoteCheckout({ entries, held, merchantHost, currency, amountCents, asOf })` → gerangschikte rijen +
`unknowns`. Hergebruikt `marketFxOptions` / `issuerConsensus` / `marketCashbackOptions`; voegt geen
nieuw rekenwerk toe. Tests die eerst moeten falen:
- een kaart die hij heeft met een onbewezen `fxFeePct` belandt in `unknowns` met een reden en **nooit**
  op 0;
- een aankoop in euro's rangschikt op cashback, een aankoop in dollars op koersopslag, en die twee
  worden niet gemengd;
- `issuerConsensus` lost "American Express / activity" op naar 2,5% en weigert zodra de kandidaten het
  oneens zijn;
- elke teruggegeven rij draagt `sourceUrl` en `asOf`; een rij zonder allebei is een gefaalde test;
- een lege catalogus geeft `rows: []` en **geen** kop — de fout *"je saldi staan al op de beste plek"*,
  overgezet naar dit oppervlak en hier getest.

**Plakje 2 — de bedraglezer, puur.**
`readCheckout(html) → { currency, amountCents } | { reason }`. Op fixtures: JSON-LD `Offer`, microdata
`itemprop="price"`, `<meta property="product:price:amount">`, en — belangrijk — drie fixtures die een
`reason` moeten geven in plaats van een getal. Geen DOM, geen netwerk; het content script geeft er een
string aan.

**Plakje 3 — het kanaal.**
De vaste vraag-en-antwoordvorm uit §3b, met een schematest die bewijst dat de vraag **alleen**
merchant/valuta/bedrag draagt en het antwoord geen saldo, IBAN, rekeningsleutel of transactietekst.
Deze test is de redactiegrens; hij hoort te lezen als die van de LLM-proxy.

**Plakje 4 — de schil van de extensie.**
`apps/extension/`: manifest (MV3, `activeTab`, `optional_host_permissions`, geen statische matchlijst),
content script, popup. Nederlandse UI. Eén bundel voor Chrome en Edge (§4). Kan het bedrag niet gelezen
worden, dan zegt de popup dat gewoon en biedt een handmatig veld — hij gokt nooit.

**Plakje 5 — de Klarna-bijregel, gebundeld.**
`scripts/bundle-merchant-offers.ts` → `apps/extension/src/merchant-offers.generated.ts`, in exact de
vorm van `bundle-bank-logos.ts`: opgehaald tijdens de sweep, ingebed, `sourceUrl` + `fetchedAt` per
regel, in de browser niets opgehaald. Elke regel draagt de app-only-voorwaarde als tekst, en de UI
toont die als voorbehoud naast het percentage — niet als term in de som.

**Plakje 6 — de lege en de onbekende toestand.**
Een afrekening waar niets bewezen is, moet een bruikbaar en eerlijk scherm opleveren: wat hij niet kon
lezen, waarom, en geen ranglijst. Getest als eersteklas uitkomst, niet als randgeval.

**Expliciet buiten v1**, elk met een reden:
- **geen euro-waardering van punten** — de Punten-tab liet "indicatief" op principe vallen, en er zijn
  nu drie uitspraken van uitgevers die het dragen: ING (*"Nee, ING Punten hebben geen monetaire waarde
  en kunnen niet worden ingewisseld voor geld."*), Revolut (*"RevPoints hebben geen vaste
  geldwaarde"*), en Amex, dat zijn verhouding van 1.000 punten = € 3 zelf "zonder voorafgaande
  kennisgeving" kan wijzigen;
- geen autofill, geen onderschepping van de afrekening, geen kaartkeuze namens hem;
- nergens inloggen;
- geen enkele fetch tijdens runtime — geen logo, geen tile, geen font;
- geen Firefox en geen Safari (§4).

---

## 9. Openstaande vragen

1. **De vraag in §0** — zou hij een gevulde winkelwagen echt verlaten voor 8,5%? Hij beslist of
   winkelaanbiedingen de kop zijn of een voetnoot, en daarmee waar dit plan over gaat.
2. **Moet de popup werken met de LaVega-tab dicht?** Het huidige ontwerp zegt nee, en dat is precies wat
   de kluis buiten de extensie houdt. Ja zeggen betekent dat de extensie zelf data gaat bewaren, en dat
   is een ander plan.
3. **Voor welke kaarten mag hij rangschikken — alleen die hij heeft, of alles?** De Travel Agent is in
   review 3 juist de andere kant op gegaan: aanbevelen wat het beste is, ook een kaart die hij niet
   heeft, met het verschil in euro's ernaast. Aan de kassa is dat advies minder bruikbaar (hij kan die
   kaart nú niet gebruiken), maar het is wel eerlijker. Niet zelf besluiten.

**Beslist en niet meer open:** de browser (§4 — Chrome en Edge, één MV3-bundel).
