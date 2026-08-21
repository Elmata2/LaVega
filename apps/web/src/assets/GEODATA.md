# Kaartgegevens en valuta per land

_Gegenereerd door `scripts/bundle-world-map.ts` op 2026-08-21. Niet met de hand aanpassen._

De wereldbol in de Valuta-tab wordt **tijdens de sweep opgehaald en
meegebundeld**, net als de banklogo's (zie `TRADEMARKS.md`). In de browser wordt
er niets opgehaald: een tile-request zou de tileserver vertellen naar welk land de
gebruiker kijkt, en in deze tab is dat "waar ga ik heen en hoeveel geld neem ik
mee". Het gegenereerde bestand is `world-map.generated.ts` (203 kB,
11580 punten in 649 ringen).

## Van platte kaart naar bol

Hier stonden **geprojecteerde SVG-paden** in een viewBox van 1000×500
(equirectangular). Die zijn eruit en er staat nu per land een lijst **ruwe ringen
in graden**: `[lengtegraad, breedtegraad]`, afgerond op 1 decimaal.

De reden is niet smaak. Een bol projecteert **per frame anders** — de stand van de
bol zit in de projectie. Een punt dat één keer is platgeslagen kun je niet
terugzetten: de omkering is alleen exact als je weet welke projectie erop zat, en
dan kost hij per frame hetzelfde als het ruwe punt projecteren. De paden staan er
ook niet naast: dat zou het bestand verdubbelen voor data die niemand meer
tekent.

Wat er in de bundel opnieuw is afgewogen, nu de kaart een bol is:

| Drempel | Was (doekeenheden) | Is (graden) | Waarom |
| --- | --- | --- | --- |
| Afronden | 0,1 eenheid = 0,036° | 1 decimaal = 0,1° (±11 km) | Op een bol van 640 px is 0,1° een halve pixel, en naar de rand van de schijf knijpt de projectie horizontaal dicht — nooit open. Wat sub-pixel is in het midden is dat overal. |
| Vereenvoudigen | 0,4 eenheid = 0,144° | 0,15° | Praktisch dezelfde drempel, zodat de bol niet grover is dan de kaart die hij vervangt. |
| Los vlak weglaten | 0,25 eenheid² | 0,0324°² | Exact dezelfde drempel omgerekend, zodat de verhuizing hier niets verandert. |
| Langste recht stuk | (bestond niet) | 5° | Nieuw, en puur een bol-probleem. Zie hieronder. |

### Lange rechte stukken (nieuw)

Een lijn tussen twee geprojecteerde punten is een rechte op het **scherm**, dus
op een bol de projectie van de koorde dwars door de bol — niet van de grens over
het oppervlak. Op een platte kaart valt dat samen, op een bol niet, en
Douglas-Peucker maakt het erger omdat het juist de lange rechte stukken tot twee
punten terugbrengt.

Gemeten aan de twee ergste gevallen: de grens VS/Canada volgt de 49e breedtegraad
28° lang, en de koorde daartussen wijkt **0,86°** (±95 km) van die breedtegraad af
— op een bol van 640 px ruim 3 px dwars door Canada. Een meridiaanstuk van 30° is
wél een grootcirkel, maar de koorde snijdt de boog met een pijlhoogte van
0,034×R: op 320 px straal is dat 11 px.

Daarom worden stukken langer dan 5° opgedeeld (26 punten bijgezet). Dat gebeurt
**lineair in lengte/breedte** en niet over de grootcirkel, want zo zijn die
grenzen ook gedefinieerd: de 49e breedtegraad *volgt* de breedtegraad.
Grootcirkel-interpolatie zou die grens 0,86° verkeerd neerzetten in plaats van
goed.

### De speld

`pin` was het midden van de omhullende van het grootste vlak. Dat ligt bij
Noorwegen in Zweden en bij Frankrijk — met Frans-Guyana in de omhullende — op de
Atlantische Oceaan. Op een platte kaart met een speld van drie pixels viel dat
niet op; op een bol waar je naar je keuze **toe draait** valt het meteen op.

`pin` is nu het punt in `rings[0]` dat het **verst van elke grens** af ligt, met
alle ringen van het land mee in de meting — anders legt de speld van Zuid-Afrika
zich pal naast Lesotho. Het zwaartepunt zou goedkoper zijn maar ligt bij een holle
vorm buiten het land (Kroatië krijgt er een speld in Bosnië).

Landen waar geen enkel rasterpunt binnen het vlak viel en de speld dus op het
zwaartepunt is gezet — dat is de eerlijke uitkomst, geen goed nieuws (0): geen.

### De omhullende

`bbox` is van `rings[0]` en niet van alle ringen bij elkaar. Bij de datumgrens is
dat het verschil tussen bruikbaar en niet: de bron knipt Rusland, Fiji en de
Aleoeten op ±180° in twee vlakken, dus de omhullende van álle ringen van Rusland
loopt van −180° tot 180° — de hele wereld. Van het grootste vlak is het Siberië,
en dat is wat iemand bedoelt die "Rusland" zoekt.

De omhullende van alles wat er getekend wordt: -180, -55.6, 180, 83.6 (lonMin, latMin, lonMax, latMax).

Wat de bol daarmee doet staat in `countryFocus()` in `worldMap.ts`: het **midden
van de `bbox`** is waar de bol naartoe draait, en dat is met opzet een ander punt
dan `pin`. Draaien wil zeggen "zet het hele land in het midden van de schijf", en
dat doet het midden van de omhullende; `pin` ligt in het land en is waar een
bolletje of een label hoort. Bij een holle vorm liggen ze ver uit elkaar — het
midden van de omhullende van Kroatië ligt in Bosnië. Eén punt voor beide zou dus
of scheef draaien of een speld in het buurland zetten.

Diezelfde `bbox` geeft de **omvang** van een land in graden, en die is nodig
omdat een bol een schaal heeft die een platte kaart niet had: Singapore is 0,35°
breed, op een bol van 640 px ruim één pixel. Zonder dat getal zou een component
een vlak tekenen dat niemand kan aanwijzen; mét dat getal kan hij besluiten er een
punt van te maken. Bij een land zonder vlak is de omvang `null` en niet 0 — wij
weten waar het ligt, niet hoe groot het is.

## Bronnen

| Wat | Bron | Licentie | Gelezen op |
| --- | --- | --- | --- |
| Landgrenzen | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson | publiek domein (Natural Earth — geen bronvermelding vereist, wel gegeven) | 2026-08-21 |
| Labelpunten voor landen zonder eigen vlak | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_tiny_countries.geojson | publiek domein (Natural Earth — geen bronvermelding vereist, wel gegeven) | 2026-08-21 |
| Valuta per land | https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json | Unicode-ICU licentie (CLDR) | 2026-08-21 |
| Welke valuta wij kunnen prijzen | https://api.frankfurter.dev/v1/currencies | ECB-referentiekoersen via Frankfurter (open, geen sleutel) | 2026-08-21 |

### Wat er is geprobeerd

| Uitkomst | URL | Wat er gebeurde |
| --- | --- | --- |
| gelukt | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson | 242 vlakken, 237 landen met een ISO-code |
| niet geprobeerd | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson | niet nodig — de bron erboven werkte |
| niet geprobeerd | https://unpkg.com/world-atlas@2/countries-110m.json | niet nodig — de bron erboven werkte |
| mislukt | https://restcountries.com/v3.1/all?fields=cca2,currencies,name | onleesbaar: de dienst antwoordt met een fout: This API version has been deprecated. Please visit https://restcountries.com/docs/countries/legacy-api-deprecation to migrate to our new version (v5). — begint met: { "success": false, "data": null, "errors": [ { "message": "This API version has been deprecated. Please visit https://restcount |
| gelukt | https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json | 255 landen met een geldige valuta op 2026-08-21 |
| niet geprobeerd | https://raw.githubusercontent.com/mledoze/countries/master/countries.json | niet nodig — de bron erboven werkte |
| gelukt | https://api.frankfurter.dev/v1/currencies | 30 valuta's (ECB, via Frankfurter) |
| gelukt | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_tiny_countries.geojson | 74 labelpunten (alleen gebruikt voor landen zonder eigen vlak) |

## Wat er is weggelaten, en waarom

- **Antarctica.** Geen wettig betaalmiddel volgens CLDR (XXX), dus geen valuta om
  te wisselen. **Dit is een open punt geworden** — zie hieronder.
- **Losse eilanden onder ±400 km².** Vlakken kleiner dan 0,0324°² gaan eruit
  (703 in totaal): Corsica blijft, Ibiza en Texel niet. Het **grootste vlak van
  een land gaat er nooit uit** — anders zou Malta van de kaart vallen omdat Malta
  klein is. Een graad² krimpt met cos(breedte), dus bij 75° NB is deze drempel nog
  ±100 km² en blijven daar kleinere eilanden staan. Op de bol is dat precies goed:
  je kunt recht op de noordpool kijken, en dan wil je de Canadese archipel zien.
- **Eilandjes die op dit raster geen vlak meer zijn** (169). Ze waren groot genoeg
  voor de drempel hierboven, maar houden na afronden geen omtrek meer over. Apart
  geteld, want het is een andere uitspraak dan "te klein om te tellen" — en het is
  de enige post waar de overstap van doekeenheden naar graden echt iets weghaalt.
  Gemeten bij die overstap: op het oude, fijnere raster (0,036°) gebeurde dit met
  152 vlakken, op 0,1° met 169. Dat verschil zit bij eilanden rond de 400 km²:
  0,18° breed, dus op het oude raster vijf cellen en op dit raster minder dan
  twee. Op een bol van 640 px is zo'n eiland 0,65 px. Het **grootste** vlak van een
  land valt hier nooit onder: dat krijgt een fijner raster (zie hieronder) in
  plaats van te verdwijnen.
- **Detail onder 0,15°.** Douglas-Peucker met die drempel. Ver inzoomen maakt de
  kustlijn hoekig — dat is de prijs van een bol die in de bundel past.

  Elk land wordt LOS vereenvoudigd, dus twee buurlanden houden niet exact dezelfde
  grenspunten over en er blijft een haarlijn tussen ze staan. De component hoort
  daarom elk vlak te tekenen met een `stroke` in de kleur van de vulling — dat
  dicht ook de rand die bij de datumgrens langs de meridiaan loopt. Topologisch
  vereenvoudigen (gedeelde grenzen één keer) zou het bij de bron oplossen en is de
  volgende stap als het ooit stoort.
- **Gebieden zonder ISO-code.** De geometriebron kent ze wel, maar zonder code is
  er geen valuta aan te koppelen: Somaliland, Northern Cyprus, Siachen Glacier.
- **Landen zonder eigen vlak in de bron** (13): Caribisch Nederland (BQ), Bouveteiland (BV), Cocoseilanden (CC), Christmaseiland (CX), Frans-Guyana (GF), Gibraltar (GI), Guadeloupe (GP), Martinique (MQ), Réunion (RE), Spitsbergen en Jan Mayen (SJ), Tokelau (TK), Kleine afgelegen eilanden van de Verenigde Staten (UM), Mayotte (YT). Ze staan wél in
  de tabel, met valuta, en met `rings: null`. Vier van de Franse overzeese
  departementen (GF, GP, MQ, RE) zitten in het vlak van Frankrijk: wie daar klikt
  krijgt Frankrijk, en omdat er in euro's betaald wordt is het antwoord hetzelfde.
  Nagemeten op de gebundelde tabel, want het is een bewering over wat er
  gebeurt en niet over wat er hoort te gebeuren: Frankrijk heeft ringen voor het
  vasteland, Frans-Guyana, Corsica, Réunion, Martinique en Guadeloupe. **Mayotte (YT)
  staat daar niet bij** — dat eiland is kleiner dan de drempel voor losse vlakken,
  dus er is niets om op te klikken. Dat is een leemte en geen antwoord: het
  valuta-antwoord (EUR) staat er wél. Hetzelfde geldt voor Spitsbergen: dat wordt
  getekend als deel van Noorwegen, dus een klik daar geeft NO en niet SJ — en
  omdat er in beide gevallen in NOK betaald wordt, verandert dat het antwoord niet.

  Van die landen hebben 5 wél een `pin` gekregen uit de puntenlaag van
  dezelfde bron (Caribisch Nederland (BQ), Gibraltar (GI), Guadeloupe (GP), Martinique (MQ), Tokelau (TK)): dan weten we waar het ligt, tekenen we het niet,
  en kan de bol er via de zoekbalk toch naartoe draaien. De rest heeft `pin: null`
  — dat betekent "wij weten het niet" en **niet** [0, 0], want dat is een plek in
  de Golf van Guinee.
- **Fijner afgerond waar het moest** (53 landen). Op één decimaal valt een land van
  een halve graad in één rastercel en houdt het nul punten over — of het houdt
  drie punten over die niet meer op het land lijken. Een land moet daarom ook
  minstens de helft van zijn oppervlakte overhouden; lukt dat niet, dan gaat de
  afronding voor dat ene land fijner: 43 op 2 decimalen (AD, AG, AI, AS, AW, BB, BH, BL, BM, CK, CW, DM, FM, GD, GG, GU, HK, HM, IO, JE, KI, KN, KY, LI, MF, MP, MS, MT, MV, NU, PF, PM, PW, SC, SG, SH, SM, ST, TC, TO, VC, VG, VI); 10 op 3 decimalen (MC, MH, MO, NF, NR, PN, SX, TV, VA, WF).

## Open punt: Antarctica

Antarctica staat **niet** in de bundel. Op de platte kaart was dat vooral
opruimen: het beslaat daar de hele onderrand, uitgesmeerd door de projectie, en er
is geen valuta.

Op een bol is die afweging anders. Je kunt naar de zuidpool **toe draaien**, en
dan is daar niets — geen land, geen ijs, alleen de kleur van de oceaan. De
onderkant van wat er wél staat ligt op -55.6° NB; daaronder is de bol leeg.

Wat het kost om het terug te zetten: de kustlijn van Antarctica is met deze
drempels ongeveer 1.500 punten, dus ±15 kB — er is ruimte. Wat het kost om het
weg te laten: één zichtbaar gat, precies op de plek waar iemand die met een bol
speelt vroeg of laat naartoe draait.

Drie mogelijkheden, met wat elk betekent:

1. **Laten zoals het is.** Goedkoopst, en de vraag "wat kost omwisselen" is er
   niet — maar de bol liegt over de wereld.
2. **Wel tekenen, niet aanklikbaar, zonder valuta-antwoord.** Eerlijk: het land is
   er, er is niets te wisselen. Vraagt van de UI dat een klik daar "hier valt
   niets te wisselen" zegt en niet stil niets doet, en niet "0%" — daar zit de
   valkuil.
3. **Wel tekenen en aanklikbaar met het antwoord "geen wettig betaalmiddel".**
   Netter dan 2 en het is precies wat CLDR zegt (XXX). Vraagt een zesde soort
   antwoord in `conversionFor()`, want dit is niet `unknown` (wij weten het) en
   niet `noRate` (er is geen koers omdat er geen valuta is, niet omdat wij hem
   missen).

Advies: **3**, als er tijd is voor dat zesde antwoord, anders **2**. Beide zijn
beter dan een bol met een gat erin, en 1 is alleen goed te praten zolang de bol
niet naar de zuidpool kan draaien. De keuze is aan de eigenaar; dit script hoeft
er alleen `DROP_CODES` voor te verliezen.

## Landen met meer dan één valuta

- **Bhutan** (BT) — BTN (geen koers bij ons) en INR
- **Haïti** (HT) — HTG (geen koers bij ons) en USD
- **Lesotho** (LS) — ZAR en LSL (geen koers bij ons)
- **Namibië** (NA) — NAD (geen koers bij ons) en ZAR
- **Panama** (PA) — PAB (geen koers bij ons) en USD
- **Palestijnse gebieden** (PS) — ILS en JOD (geen koers bij ons)
- **Zimbabwe** (ZW) — ZWG (geen koers bij ons) en USD

Deze landen krijgen géén stilzwijgend gekozen valuta. De datalaag geeft ze
allebei terug en de UI hoort het te vragen; in Panama is USD wél te prijzen en
PAB niet, dus "de eerste maar pakken" zou het antwoord veranderen.

## Kosovo

Kosovo heeft geen door ISO toegewezen alpha-2-code. `XK` is de gebruikerscode
die de EU, CLDR en Natural Earth alle drie hanteren, en die gebruiken wij ook.
Zonder die uitzondering zit er een gat in de Balkan dat op niets klikt.

## Valuta die wij niet kunnen prijzen

De ECB-lijst dekt 30 valuta's. Alle andere staan in de tabel met
`priceable: false`. Dat betekent **"wij hebben geen koers"** en nooit "geen
kosten" of "0%": een land waarvan wij de koers niet kennen mag in de UI niet als
gratis eindigen. Bij landen met twee valuta's staat het per valuta, want in
Panama kennen wij de USD-koers wel en de PAB-koers niet.

## Verversen

```
pnpm exec tsx scripts/bundle-world-map.ts --dry   # kijken
pnpm exec tsx scripts/bundle-world-map.ts         # schrijven
```

Valt een bron weg, dan pakt het script de volgende in de ketting en zet hij dat
in de tabel hierboven. Valt de ECB-lijst weg, dan schrijft het script **niets**:
dan zou elk land `priceable: false` krijgen op grond van onze eigen storing, en
dat is een uitspraak over de wereld die een storing niet kan dragen. Valt alleen
de puntenlaag weg, dan schrijft het script wél — dan missen een paar landen zonder
vlak hun `pin`, en dat is een leemte die zichzelf netjes als `null` meldt.
