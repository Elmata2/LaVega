# Kaartgegevens en valuta per land

_Gegenereerd door `scripts/bundle-world-map.ts` op 2026-08-20. Niet met de hand aanpassen._

De kaart in de Valuta-tab wordt **tijdens de sweep opgehaald en meegebundeld**,
net als de banklogo's (zie `TRADEMARKS.md`). In de browser wordt er niets
opgehaald: een tile-request zou de tileserver vertellen naar welk land de
gebruiker kijkt, en in deze tab is dat "waar ga ik heen en hoeveel geld neem ik
mee". Het gegenereerde bestand is `world-map.generated.ts` (187 kB).

## Bronnen

| Wat | Bron | Licentie | Gelezen op |
| --- | --- | --- | --- |
| Landgrenzen | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson | publiek domein (Natural Earth — geen bronvermelding vereist, wel gegeven) | 2026-08-20 |
| Valuta per land | https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json | Unicode-ICU licentie (CLDR) | 2026-08-20 |
| Welke valuta wij kunnen prijzen | https://api.frankfurter.dev/v1/currencies | ECB-referentiekoersen via Frankfurter (open, geen sleutel) | 2026-08-20 |

### Wat er is geprobeerd

| Uitkomst | URL | Wat er gebeurde |
| --- | --- | --- |
| gelukt | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson | 242 vlakken, 237 landen met een ISO-code |
| niet geprobeerd | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson | niet nodig — de bron erboven werkte |
| niet geprobeerd | https://unpkg.com/world-atlas@2/countries-110m.json | niet nodig — de bron erboven werkte |
| mislukt | https://restcountries.com/v3.1/all?fields=cca2,currencies,name | onleesbaar: de dienst antwoordt met een fout: This API version has been deprecated. Please visit https://restcountries.com/docs/countries/legacy-api-deprecation to migrate to our new version (v5). — begint met: { "success": false, "data": null, "errors": [ { "message": "This API version has been deprecated. Please visit https://restcount |
| gelukt | https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json | 255 landen met een geldige valuta op 2026-08-20 |
| niet geprobeerd | https://raw.githubusercontent.com/mledoze/countries/master/countries.json | niet nodig — de bron erboven werkte |
| gelukt | https://api.frankfurter.dev/v1/currencies | 30 valuta's (ECB, via Frankfurter) |

## Wat er is weggelaten, en waarom

- **Antarctica.** Op een equirectangular kaart beslaat het de hele onderrand, en
  CLDR geeft het geen wettig betaalmiddel (XXX). Weggelaten uit de kaart én uit
  de tabel.
- **Losse eilanden onder ±400 km².** Vlakken kleiner dan 0.25 doekeenheid² gaan
  eruit (855 in totaal): Corsica blijft, Ibiza en Texel niet. Het **grootste
  vlak van een land gaat er nooit uit** — anders zou Malta van de kaart vallen
  omdat Malta klein is.
- **Detail onder 0.4 doekeenheid.** Douglas-Peucker met die drempel; op een kaart
  van 1000 px breed is dat minder dan een pixel. Ver inzoomen maakt de kustlijn
  hoekig — dat is de prijs van een kaart die in de bundel past.

  Elk land wordt LOS vereenvoudigd, dus twee buurlanden houden niet exact
  dezelfde grenspunten over en er blijft een haarlijn tussen ze staan (op 10×
  inzoomen zichtbaar gemeten; op ware grootte niet). De component hoort daarom
  elk vlak te tekenen met een `stroke` in de kleur van de vulling. Topologisch
  vereenvoudigen (gedeelde grenzen één keer) zou het bij de bron oplossen en is
  de volgende stap als het ooit stoort.
- **Gebieden zonder ISO-code.** De geometriebron kent ze wel, maar zonder code is
  er geen valuta aan te koppelen: Somaliland, Northern Cyprus, Siachen Glacier.
- **Landen zonder eigen vlak in de bron** (13): Caribisch Nederland (BQ), Bouveteiland (BV), Cocoseilanden (CC), Christmaseiland (CX), Frans-Guyana (GF), Gibraltar (GI), Guadeloupe (GP), Martinique (MQ), Réunion (RE), Spitsbergen en Jan Mayen (SJ), Tokelau (TK), Kleine afgelegen eilanden van de Verenigde Staten (UM), Mayotte (YT). Ze staan wél in de tabel, met valuta, en met `path: null`. De Franse
  overzeese departementen (GF, GP, MQ, RE, YT) zitten in het vlak van Frankrijk:
  wie daar klikt krijgt Frankrijk, en omdat er in euro's betaald wordt is het
  antwoord hetzelfde.
- **Fijner afgerond waar het moest** (49 landen). Op één decimaal valt een land
  van een halve doekeenheid in één rastercel en houdt het nul punten over — dan
  is fijner afronden de enige manier om het niet weg te gooien: 43 op 2 decimalen (AD, AG, AI, AS, AW, BB, BH, BL, BM, CK, CW, DM, FM, GD, GG, HM, IO, JE, KN, KY, LI, MF, MH, MO, MP, MS, MT, MV, NF, NU, PF, PM, PW, SC, SG, SH, SM, TC, TO, VC, VG, VI, WF); 6 op 3 decimalen (MC, NR, PN, SX, TV, VA).

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
dat is een uitspraak over de wereld die een storing niet kan dragen.
