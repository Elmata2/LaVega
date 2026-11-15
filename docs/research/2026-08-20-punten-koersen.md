# Puntenkoersen — de ontbrekende cijfers

Zoekronde van **21 augustus 2026**. Lane `punten-koersen`. Geen Anthropic API-credits gebruikt:
alles is curl, `pdftotext`, `r.jina.ai`, de Wayback CDX en de eigen JSON-payloads van de sites.

Het voorstel staat in `docs/catalog/staging-points.json`. Dit bestand raakt `catalog.json` niet aan.

## De kern in vier regels

1. **ING Punten bestaan en de koers is nu leesbaar — maar er is geen koers per bestede euro.**
   ING beloont drempels (`250 punten per maand bij ≥ € 700 instroom`), niet bedragen. Wie er een
   `pointsPerEuro` van maakt, verzint een getal.
2. **Revolut is opgelost.** De vorige ronde noteerde RevPoints als "programma bestaat, koers niet
   gepubliceerd". De koers stáát er, in euro's, per plan: 0,1 / 0,1 / 0,25 / 0,5 punt per euro.
3. **Amex' tweede cijfer is binnen.** `1.000 Membership Rewards punten zijn gelijk aan € 3` —
   € 0,003 per punt. Dat is de inwisselwaarde; de verdienkoers stond al in de catalogus.
4. **Twee cijfers, niet één.** Verdienen en inwisselen zijn losse velden in het stagingbestand.
   Voor geen enkel programma zijn ze allebei bekend en hard.

## ING Punten — de route die openging

De eerdere blokkade was juist: `ing.nl/particulier/ing-punten` rendert zijn inhoud in een shadow
DOM en levert bij een gewone fetch alleen een lege `<ing-app-open-page>`. Maar in de `<head>` van
diezelfde pagina staat een preload naar de eigen API:

```
https://api.www.ing.nl/nl/public/pagemodel?pageUrl=%2Fnl%2Fparticulier%2Fing-punten%2Fzo-spaar-je-ing-punten
```

Die geeft HTTP 200 op plain curl en bevat de complete spaartabel als tekst. Dat is route 2 uit de
opdracht, en hij werkt precies zoals voorspeld: shadow DOM aan de voorkant, alles leesbaar in de
payload. De Wayback-snapshot (`20260218053411`) was de opstap — daar stond de preload-URL in, plus
de FAQ als JSON-LD.

### Wat ING zelf zegt over verdienen

Uit de payload van `ing.nl/particulier/ing-punten/zo-spaar-je-ing-punten` (het document noemt geen
eigen datum; opgehaald 21-08-2026):

| Waar krijg je Punten voor                                      | Punten        |
| -------------------------------------------------------------- | ------------- |
| Elke maand minimaal € 700 bijschrijven op je Betaalrekening    | 250 per maand |
| 10 transacties met je Betaalrekening                           | 100 per maand |
| Meer dan € 100 uitgeven met je ING Creditcard Extra of Max     | 250 per maand |
| Meer dan € 100 uitgeven met je ING (studenten) Creditcard More | 100 per maand |
| Openen eerste Betaalrekening                                   | 2.500         |
| Creditcard toevoegen aan je wallet                             | 100           |
| Eerste Oranje Spaarrekening openen                             | 500           |
| Rond af & Spaar actief gebruiken                               | 100 per maand |
| Hypotheek hebben                                               | 250 per maand |

Bovenop de tabel geldt een pakketvermenigvuldiger, letterlijk:

> Met een ander pakket spaar je meer ING Punten op alle onderstaande activiteiten. ING Go |
> onderstaand aantal Punten. ING More | 10% meer Punten. ING Extra | 20% meer Punten. ING Max |
> 30% meer Punten

**Waarom `pointsPerEuro` toch leeg blijft.** De regel "Meer dan € 100 uitgeven met je ING Creditcard
Extra of Max → 250 per maand" is een drempel, geen tarief. Bij € 100 én bij € 4.000 besteding zijn
het 250 punten. Delen door de drempel levert 2,5 punt per euro op — een koers die niet bestaat en
die bij normaal gebruik een factor 40 te hoog kan uitvallen. Dat is dezelfde soort fout als de acht
valse nullen, alleen de andere kant op. Het veld blijft leeg; de echte cijfers staan in
`earnRules` in het stagingbestand.

**De Platinumcard staat er niet in.** ING's tabel kent alleen "ING (studenten) Creditcard More" en
"ING Creditcard Extra of Max". Of de Platinumcard onder een van die regels valt, is niet
vastgesteld. Niet invullen, ook niet met nul.

### Wat ING zelf zegt over inwisselen

Uit `Voorwaarden-ING-Punten-vanaf-1-oktober-2025.pdf`, geldig vanaf **1 oktober 2025**:

> ING Punten hebben geen geldwaarde. Je kan je ING Punten niet inwisselen voor geld en niet
> overdragen aan anderen

En in de FAQ op de landingspagina, in nog kortere bewoordingen:

> Nee, ING Punten hebben geen monetaire waarde en kunnen niet worden ingewisseld voor geld.

Dat is een **uitgesproken nul** en hij is als zodanig opgeslagen — maar alleen voor het inwisselen
tegen geld. Wat een punt aan korting oplevert in de ING Winkel is een ander cijfer, en dat is niet
openbaar. De enige indicatie die ING zelf geeft is opzettelijk vaag: 250 punten zijn volgens de
landingspagina "in te wisselen voor een paar euro korting op je bioscoopkaartjes". Daar is geen
koers uit te halen en er is er dus ook geen genoteerd.

Voorwaarden die erbij horen: alleen particuliere ING-klanten met minimaal één Betaalrekening met
Nederlandse IBAN, automatisch vanaf 12 jaar, bijschrijving in de tweede week van de volgende maand,
punten verlopen niet maar vervallen direct bij uitschrijven of bij het opzeggen van de laatste
Betaalrekening. En: "ING bepaalt het aantal ING Punten dat je ontvangt voor deze bankzaken en kan
dit aantal wijzigen."

## Revolut — RevPoints, van "niet gepubliceerd" naar hard cijfer

De vorige ronde zette RevPoints op `active-rate-unpublished`. Dat klopte voor de bron die toen
gebruikt is (de Engelstalige voorwaardenpagina). De Nederlandse helppagina noemt de koers wel, in
euro's:

> Standard: €10 voor 1 RevPoint | Plus: €10 voor 1 RevPoint | Premium: €4 voor 1 RevPoint |
> Metal: €2 voor 1 RevPoint | Ultra: €1 voor 1 RevPoint

Omgekeerd: **0,1 / 0,1 / 0,25 / 0,5** punt per euro voor de vier plannen die in de catalogus staan.
Dat is een rechtstreekse omkering van een gepubliceerd cijfer, geen schatting.

De inwisselwaarde is er niet, en Revolut zegt dat zelf:

> RevPoints hebben geen vaste geldwaarde en hun waarde hangt af van de gekozen inwisselmethode.

Daarom `null` en niet `0`. Eén euro-per-punt noemt Revolut wél, in de voorwaarden van
**18 juni 2026**: bij het terugvorderen van een negatief puntensaldo "bedraagt het bedrag dat we je
per punt in rekening brengen niet meer dan 0,02 euro". Dat is een plafond op een vordering, geen
inwisselwaarde, en het staat in het stagingbestand onder een eigen sleutel zodat het niet per
ongeluk als koers wordt gelezen.

Uitsluitingen die erbij horen: overboekingen, wallet-opwaarderingen, crypto- en brokerage-aankopen,
belastingen en boetes, gokken en loterijen, nutsbedrijven, goede doelen, onderwijsinstellingen en
alles op een Revolut Pro-rekening. Punten zijn drie jaar geldig en het programma vereist aanmelding.

Over de eerdere 403: die gold voor directe curl op revolut.com. Via `r.jina.ai` komen zowel
`help.revolut.com/nl-NL/...` als `revolut.com/nl-NL/legal/RevPoints/` gewoon binnen. Er is niets
omzeild — het is dezelfde publieke pagina via een reader.

## American Express — het inwisselcijfer

`americanexpress.com/nl-nl/rewards/membership-rewards/`, gelezen met plain curl (HTTP 200,
604 kB), onder het kopje "Betalen met punten via de Amex App in drie stappen":

> 1.000 Membership Rewards punten zijn gelijk aan € 3. Deze verhouding kan naar goeddunken van
> American Express en zonder voorafgaande kennisgeving gewijzigd worden.

**€ 0,003 per punt**, en alleen voor Betalen met Punten via de app of het online account. Overboeken
naar Flying Blue of een hotelpartner heeft een andere waarde die Amex niet publiceert. De zin zegt
er zelf bij dat de verhouding zonder aankondiging kan wijzigen, dus dit cijfer heeft een korte
houdbaarheid en hoort met een datum in beeld te komen.

De verdienkoersen van Amex stonden al in de catalogus en zijn niet opnieuw opgehaald.

## De vier ICS-zakenkaarten, Knab en Triodos — vervangen bewijs

Deze zes zaten bij de acht teruggedraaide nullen, en terecht: de bron was een
voorwaarden- of kostendocument. Zo'n document zegt niets over punten, dus het kan geen nul dragen.

Nu is de bron de eigen, complete productopsomming van de aanbieder:

- **ICS Visa World Card Business / Business Gold / Mastercard Business / Mastercard Corporate** —
  alle vier hebben op `icscards.nl/zakelijk/zakelijke-creditcard-aanvragen/…` een blok
  "Eigenschappen van de creditcard" met daaronder jaarlijkse kosten, bestedingslimiet,
  uitgavenbeheer, digitaal betalen, facturatie en rente, inbegrepen verzekeringen en garanties,
  services en voorwaarden. Geen puntenrubriek, op geen van de vier.
- **Knab betaalpas** — de negenpunts-opsomming "Waarom je bankrekening openen bij Knab?" noemt
  spaarpotjes, spaarrente, vijf betaalrekeningen, Apple/Google Pay, gratis pinnen in Eurolanden, de
  app en het depositogarantiestelsel. Geen punten.
- **Triodos betaalpas** — "Handig om te weten" somt de hele dienstverlening op, met daarnaast een
  volledige tarieventabel per 01-05-2025. Geen punten.

**Dit is bewust een zwakkere bewijssoort.** Geen van deze aanbieders zégt "wij hebben geen
puntenprogramma". Het is een complete eigen opsomming waarin het ontbreekt — in het stagingbestand
`enumerated-absence`, `confidence: middel`. Dat is dezelfde lat waarop de consumentenkaarten van
ICS, ABN en Rabobank al op 0.0 in de catalogus staan, dus consistent. Wil de hoofdsessie alleen
uitgesproken afwezigheid accepteren, dan blijven deze zes leeg; de bewijssoort staat er per regel
bij zodat dat besluit één regel kost.

## Trade Republic — geen punten, wel Saveback

De eigen kaartpagina somt alle voordelen op: 3% rente op kassaldo, Round up, geen
abonnementskosten, gratis opnames vanaf € 100, wisselkoersen. En:

> Verdien 1 % Saveback op kaartbetalingen voor een periodieke belegging.

Saveback is **geen** puntenprogramma. Het is 1% van de kaartbesteding die in een periodieke
belegging gaat, met koersrisico dat Trade Republic er zelf bij noemt. Het hoort in een
cashback- of beleggingsveld, niet in `pointsPerEuro`. Voor `pointsPerEuro` geldt hier dezelfde
enumerated-absence als hierboven.

## Plutus — een programma zonder puntenkoers

Plutus heeft wél een beloningsprogramma, dus 0 zou fout zijn. Maar het is een percentage in
PLU-tokens, geen aantal punten per euro:

> Earn a minimum of 3% for every swipe or tap of your card.
>
> Start with a guaranteed 3% rewards and stack them to progress through levels, earning up to a
> maximum of 9%.

Boven de 3% moet je PLU aanhouden in een gekoppelde wallet, en er gelden caps per niveau. Wat de
uitkering in euro waard is hangt af van de PLU-koers op het moment van de transactie; Plutus
publiceert die niet. `pointsPerEuro` blijft leeg, het percentage staat apart in het stagingbestand.
Welke niveaus voor een Nederlandse gebruiker gelden is niet vastgesteld — de pagina rekent in £ en €
door elkaar.

## Wat niet gelukt is

| Wat                                                  | Route               | Waarom het stukliep                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Euro-waarde van een ING-punt in de ING Winkel        | shop, jina, Wayback | `www.ing.nl/punten/*` verbreekt de HTTP/2-stream (ook op `--http1.1`); `r.jina.ai` haalt de pagina wel op maar meldt "This page contains shadow DOM that are currently hidden" en levert alleen de titel, ook met `x-with-shadow-dom`; de Wayback CDX heeft van `ing.nl/punten*` uitsluitend JS-bundles, geen productpagina's. De Winkel zit achter Mijn ING. |
| ING Platinumcard                                     | payload-json        | ING's spaartabel noemt de kaart niet. Geen bewijs is hier geen nul en ook geen koers.                                                                                                                                                                                                                                                                         |
| Inwisselwaarde Flying Blue Miles                     | jina                | `flyingblue.com/nl/miles/spend` geeft 404 en valt terug op een Franstalige foutpagina. Niet verder gezocht.                                                                                                                                                                                                                                                   |
| Wise betaalpas                                       | curl, jina          | `wise.com/nl/card/` levert via curl 6 kB JS-shell en via `r.jina.ai` een tracking-pixel in plaats van de pagina. Het helpartikel dat naar een rewards-programma verwees, leidt door naar een pagina over regelgeving per land. Geen uitspraak van Wise verkregen, in geen van beide richtingen.                                                               |
| 212 Card                                             | curl, jina          | `trading212.com/nl/card` stuurt door naar de algemene beleggingspagina in het Engels; geen kaart-voordelenopsomming te pakken gekregen.                                                                                                                                                                                                                       |
| Crypto.com, Nexo, Krak Card, Bybit Card, paysafecard | —                   | Niet geprobeerd deze ronde. Deze producten belonen in tokens/cashback, niet in punten, maar dat is een verwachting en geen vondst; ze blijven leeg.                                                                                                                                                                                                           |
| ABN AMRO en Rabobank spaarprogramma's                | WebSearch           | Eén zoekopdracht op rabobank.nl leverde alleen spaarrekeningpagina's op, daarna was het WebSearch-budget van de sessie op (200/200). De catalogus houdt beide al op 0.0 via hun eigen productpagina's; daar is deze ronde niets aan toegevoegd of afgedaan.                                                                                                   |
| ICS zakelijke kaarten via de AV-PDF's                | provider-pdf        | Bewust niet gebruikt. Een voorwaardendocument dat punten niet noemt bewijst niet dat punten niet bestaan — dat is precies hoe de acht valse nullen ontstonden.                                                                                                                                                                                                |

## Controle

Er is geen code in deze lane, alleen twee documenten, en de opdracht staat geen derde bestand toe.
In plaats van een vitest-bestand is `staging-points.json` met een script in de scratchpad
gevalideerd op de invarianten die hier gelden: geldige JSON, elke waarde met `sourceUrl` en
`evidence`, en — de belangrijkste — **geen enkele `0.0` zonder een bewijssoort die een nul kan
dragen** (`stated-absence` of `enumerated-absence`), en geen `0.0` waar een programma is
aangetoond. Uitkomst: 6 controles, alle 6 groen. Zie het slotverslag van de lane voor de
uitvoer.
