# De 21 rijen die op een ontbrekende documentdatum strandden

Vervolg op `merge-2026-08-20.md`, dat 21 rekeningkosten buiten de catalogus
hield: het bedrag kwam van een productpagina zonder eigen datum, en de
toelatingseis is waarde + bron + **datum** + voorwaarden, met de datum van het
document zelf. De opdracht was een gedateerd tariefdocument zoeken in plaats van
die pagina, zonder dat er een cijfer verandert.

**Uitkomst: 18 van de 21 binnen, geen enkel bedrag gewijzigd.** Drie bleven
buiten en staan onderaan met wat er ontbrak. Er is geen product toegevoegd en
geen `docUrl`/`docDate` van een andere lane overschreven; net als bij de negen
van 20 augustus staat de vondst alleen als `accountFee` in `catalog.json`.

## Waar de datums vandaan komen

Niet uit een tarieven-PDF. Die route liep dood: de Algemene Voorwaarden van ICS
(`ICS-121-NL-01/2025`) dragen wél een datum maar geen bedrag — artikel 8.1 zegt
letterlijk "De hoogte van de Card-bijdrage staat vermeld in de Documentatie" en
verwijst dus door. De vergelijkingspagina's van ICS dragen wél alle bedragen maar
geen datum.

Wat het wél doet is de **wijzigingspagina van de jaarbijdrage**: per kaart een
eigen pagina die één bedrag aan één ingangsdatum koppelt ("Bekijk op deze pagina
de antwoorden op vragen over de jaarbijdrage van uw Mastercard Classic vanaf
1 juni 2026" — "Waarom wordt de jaarbijdrage voor de Mastercard Classic
€ 38,95?"). Dat is precies de vorm die de toelatingseis vraagt.

Er zit één addertje onder, en het bepaalt de helft van de bronkeuzes hieronder:
**ICS haalt zo'n pagina weg zodra de volgende verhoging is aangekondigd.** De
live pagina van de Visa World Card Gold gaat inmiddels over € 59,50 per
15 september 2026; over de € 57,95 die je vandaag betaalt zegt hij niets meer.
Voor zes rijen is daarom de Wayback-kopie gelezen. De timestamp van die kopie is
níet als datum gebruikt — die telt niet — alleen de ingangsdatum die in de tekst
zelf staat. Dat het bedrag vandaag nog geldt is los nagekeken op de
vergelijkingspagina's van ICS (die dragen geen datum, dus ze leveren de datum
niet, alleen de bevestiging dat het cijfer niet is verschoven).

## Wat erin ging: 18 rekeningkosten

| catalogusrij                                 | bedrag         | checkedAt  | document                                                      |
| -------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------- |
| `ics-visa-world-card`                        | € 42,95 /jaar  | 2025-06-01 | wijziging jaarbijdrage World Card (Panda), Wayback 19-05-2026 |
| `ics-visa-world-card-panda`                  | € 42,95 /jaar  | 2025-06-01 | zelfde pagina — de Panda staat in de titel                    |
| `ics-visa-world-card-gold`                   | € 57,95 /jaar  | 2025-04-01 | wijziging Extra Card VWC Gold, Wayback 15-04-2026             |
| `ics-visa-world-card-platinum`               | € 175,00 /jaar | 2026-04-30 | "Wat kost een creditcard?" (live)                             |
| `ics-mastercard-classic`                     | € 38,95 /jaar  | 2026-06-01 | wijziging jaarbijdrage Mastercard Classic (live)              |
| `ics-mastercard-gold`                        | € 45,00 /jaar  | 2025-04-01 | wijziging jaarbijdrage Mastercard Gold, Wayback 10-02-2026    |
| `ics-mastercard-black`                       | € 225,00 /jaar | 2025-07-01 | nieuwe reisservices en jaarbijdrage Black (live)              |
| `anwb-visa-classic-card`                     | € 29,95 /jaar  | 2025-11-01 | FAQ jaarbijdrage ANWB, Wayback 05-03-2026                     |
| `anwb-visa-silver-card`                      | € 39,95 /jaar  | 2025-11-01 | zelfde pagina, eigen rij                                      |
| `anwb-visa-gold-card`                        | € 51,95 /jaar  | 2025-11-01 | zelfde pagina, eigen rij                                      |
| `asn-creditcard`                             | € 37,50 /jaar  | 2025-11-01 | FAQ jaarbijdrage ASN bij ICS, Wayback 21-04-2026              |
| `american-express-blue-card`                 | € 0,00 /jaar   | 2024-07-04 | Overzicht Kaartlidmaatschapsbijdragen (PDF)                   |
| `american-express-green-card`                | € 6,50 /maand  | 2024-07-04 | zelfde PDF                                                    |
| `american-express-gold-card`                 | € 20,00 /maand | 2024-07-04 | zelfde PDF                                                    |
| `flying-blue-american-express-entry-card`    | € 3,00 /maand  | 2024-07-04 | zelfde PDF                                                    |
| `flying-blue-american-express-silver-card`   | € 6,25 /maand  | 2024-07-04 | zelfde PDF                                                    |
| `flying-blue-american-express-gold-card`     | € 16,50 /maand | 2024-07-04 | zelfde PDF                                                    |
| `flying-blue-american-express-platinum-card` | € 55,00 /maand | 2024-07-04 | zelfde PDF                                                    |

Alle achttien bedragen zijn identiek aan wat de zoekronde van 21 augustus op de
productpagina's vond. Er is dus niets herzien; er is alleen een document bij
gezocht dat mag worden geciteerd.

### Vier dingen die bewust zo staan

1. **`asn-creditcard` hoorde tot de twee die volgens de opdracht niet te redden
   waren, en is toch binnen.** De ASN-tarievenwijzer noemt de creditcard
   inderdaad niet, maar de kaart wordt uitgegeven door ICS en die heeft er een
   eigen wijzigingspagina voor: "de jaarbijdrage van uw ASN Creditcard vanaf
   1 november 2025" met "Waarom wordt de jaarbijdrage voor mijn ASN Creditcard
   € 37,50?". Dat is hetzelfde bedrag dat asnbank.nl vandaag ongedateerd toont.

2. **De drie ANWB-rijen staan op `pricedOnItsOwn: false`.** Niet omdat de
   kaartprijs onzeker is, maar omdat `anwb.nl/creditcard/informatie/kosten` onder
   dezelfde drie bedragen zet: "De hierboven aangegeven prijzen zijn exclusief de
   kosten van een ANWB lidmaatschap". Bovenop de kaart komt dus een tweede
   product, en wat dat kost staat in geen van beide documenten — dat blijft
   onbekend en is niet ingevuld. Een tip "stap over naar de ANWB Visa voor
   € 29,95" zou een bedrag beloven dat niemand betaalt. De voorwaardentekst is
   zo geformuleerd dat `isPricedOnItsOwn` in `accountCosts.ts` erop aanslaat; die
   functie leest tekst, dus de tekst is code.

3. **Amex Blue staat op € 0,00 per jaar en op `pricedOnItsOwn: false`.** Het
   overzicht zegt "The Blue Card € 0 per jaar" met voetnoot: "Bij een minimale
   besteding van € 3.000 per jaar. Anders kost de kaart € 35 per jaar." Dat is
   een uitgesproken nul mét de prijs die geldt als je de drempel niet haalt — het
   gat dat `merge-2026-08-20.md` bij deze kaart signaleerde ("nul-of-onbekend is
   geen besparing") is hiermee dicht. De nul telt mee voor wie de kaart heeft en
   wordt nooit als besparing aangeraden.

4. **Elke rij waarvan de prijs al is aangekondigd te stijgen, zegt dat in zijn
   voorwaarden**: ICS Visa World Card Gold → € 59,50 per 15-09-2026, ICS
   Mastercard Gold → € 46,50 per 15-09-2026, de drie ANWB-kaarten → +€ 1,75 per
   01-11-2026. Zonder die zin zou het scherm een besparing kunnen voorstellen die
   over een paar weken al niet meer klopt.

### De datum van de Amex-kaarten, apart uitgelegd

Zeven Amex-kaarten hangen aan één document: `FEE_CONS_V7_240704_NL.pdf`, het
"Overzicht Kaartlidmaatschapsbijdragen" waar de kaarthoudersovereenkomst zelf
naar doorverwijst voor de bedragen. In dat document staat geen "geldig vanaf".
Wat er wél in staat, boven de titel en in de voettekst, is het versiestempel
`FEE_CONS_V7_240704_NL`.

Dat `240704` een datum is en geen volgnummer is niet geraden. De voorganger V6
staat op dezelfde legal-pagina, draagt hetzelfde stempel in de tekst, heeft
`V6_240704_NL` als PDF-onderwerp en 4 juli 2024 als aanmaakdatum. Amex stempelt
zijn documenten zo vaker: de Flying Blue-bijlage draagt `versie_jan24` op de
eerste regel. V6 en V7 noemen voor deze zeven kaarten precies hetzelfde bedrag.

Twee dingen om te weten:

- **Het bestand van vandaag is jonger dan zijn eigen stempel.** V7 is op
  3 december 2025 aangemaakt en draagt nog steeds `240704`. 2024-07-04 is dus de
  oudste lezing, en dat is de kant waarop je wilt afronden: bij een consensus
  neemt `accountCosts` om dezelfde reden de oudste datum.
- **Eén rij in dat document is aantoonbaar achterhaald** (Platinum, zie
  hieronder). Dat maakt de andere zeven niet onwaar — hun bedrag staat op
  21 augustus 2026 nog letterlijk zo op de productpagina's — maar het is de reden
  dat dit document als bron zwakker is dan de ICS-wijzigingspagina's, en dat het
  hier expliciet staat.

## De twee uitgesproken nullen: een naam, geen bedrag

N26 Standard en Revolut Standaard droegen hun € 0,00 per maand al sinds
21 augustus in de catalogus. Ze waren alleen onvindbaar.

`productNamedByAccount` in `accountCosts.ts` haalt de haakjes uit de
productnaam en zoekt de overgebleven woorden als aaneengesloten reeks terug in
`"<bank> <rekeningnaam>"`. Bij `"N26 Account (Standard)"` is dat `n26 account`,
en dat staat in geen rekeningnaam die iemand intikt. Bij `"Revolut Standaard"` is
het `revolut standaard`, en dat is niet `revolut standard`. Beide vielen dus
door naar de consensusregel, en die kan niets: N26 heeft acht geprijsde plannen
van € 0,00 tot € 16,90 en Revolut vijf van € 0,00 tot € 60,00, dus ze zijn het
over niets eens. Het antwoord was `product-unknown` — terecht, maar de nul was
per constructie nooit te bereiken.

Gemeten, met de echte code, vóór en na de hernoeming:

| rekening                     | vóór                                     | na                                      |
| ---------------------------- | ---------------------------------------- | --------------------------------------- |
| N26 · "N26 Standard"         | `unknown product-unknown` (8 kandidaten) | `known € 0,00/maand` via product-name   |
| N26 · "Standard"             | —                                        | `known € 0,00/maand`                    |
| Revolut · "Revolut Standard" | `unknown product-unknown` (5 kandidaten) | `known € 0,00/maand`                    |
| N26 · "Betaalrekening"       | `unknown product-unknown`                | `unknown product-unknown` (ongewijzigd) |
| N26 · "N26 Smart"            | `known € 4,90/maand`                     | `known € 4,90/maand` (ongewijzigd)      |

De laatste twee regels zijn de controle: een N26-rekening die zijn pakket niet
noemt komt nog steeds op onbekend uit en niet op de goedkoopste die past.

De namen zijn in `state.json` én `catalog.json` tegelijk gewijzigd, want de sweep
schrijft `product` uit `state.json` over de catalogusrij heen. `"N26 Standard"`
sluit aan op de zusterrijen N26 Smart/Go/Metal en op de kaartrij "N26 Standard
betaalpas"; `"Revolut Standard"` op Plus/Premium/Metal/Ultra en op "Revolut
Standard betaalpas". Geen bedrag, geen bron en geen datum aangeraakt.

## Wat er niet in ging: 3 rijen

**`american-express-platinum-card` — het gedateerde document noemt een ander
bedrag.** Het Overzicht Kaartlidmaatschapsbijdragen zet The Platinum Card op
€ 65,00 per maand; de aanvraagbrochure en de productpagina zeggen op
21 augustus 2026 € 75 per maand (€ 900 per jaar). De brochure draagt alleen
"Copyright © 2026", en dat is hetzelfde jaartal-zonder-datum waarop deze kaart
op 20 augustus al strandde. Er is dus wél een gedateerd document en wél een
actueel bedrag, maar niet in hetzelfde document. Waarde, bron en voorwaarden
zijn er; de datum bij het juiste bedrag niet.

**`american-express-business-green-card` — het document noemt nergens een
datum.** `nl-overzicht-jaarbijdragen-business-card.pdf` zet de Business Green
Card op € 85 en is daarmee de juiste bron voor het bedrag, maar de twee
pagina's bevatten geen enkele datum: geen ingangsdatum, geen versiestempel, zelfs
geen copyrightregel. De enige datums zijn de mapnaam in de URL (`2024-09-02`) en
de PDF-metadata (ModDate 2 september 2024). Dat zijn twee datums die overeenkomen,
maar geen van beide staat in het document dat de lezer opent, en de vorige ronde
heeft precies dat onderscheid gemaakt. Als de eigenaar besluit dat PDF-metadata
telt, is dit de eerste rij die alsnog binnenkomt.

**`wise-betaalpas` — nog steeds geen datum.** De tarievenpagina `wise.com/nl/pricing/`
haalt HTTP 200 en noemt de nul, maar draagt geen datum. Gezocht naar een
gedateerd alternatief: `wise.com/nl/legal/`, `/nl/legal/terms-of-use`,
`/nl/legal/fee-information-document` en `/gb/legal/` geven alle vier 404 op een
directe fetch. Er is geen EU-informatiedocument gevonden. Los daarvan zou deze
rij nog niets doen: `accountCosts` koppelt een rij met `kind: "betaalpas"` nooit
aan een rekening.

## Routes: wat werkte en wat niet

- **Wijzigingspagina van de jaarbijdrage (ICS/ANWB/ASN)** — de winnende route,
  11 rijen. Vindbaar via `icscards.nl/sitemap.xml` (1.501 URL's) op het woord
  `jaarbijdrage`; de weggehaalde exemplaren via Wayback CDX op
  `www.icscards.nl/info/` als prefix.
- **Statische PDF met tarieven (Amex)** — 7 rijen, via de PDF-links op
  `americanexpress.com/nl/informatie/algemene-voorwaarden.html`.
- **Algemene Voorwaarden als tariefbron** — werkt niet bij ICS: de AV verwijst
  voor het bedrag door naar "de Documentatie".
- **Wayback vóór ~mei 2025 bij ICS** — de oude paginasjabloon rendert de
  FAQ-tekst met JavaScript, dus die snapshots leveren alleen navigatie. Het
  nieuwere sjabloon (ruwweg vanaf najaar 2025) staat wel volledig in de HTML.
  Bij vier pagina's is daarom de nieuwste snapshot gelezen die het oude bedrag
  nog noemt, niet de oudste.
- **Nuxt `_payload.json` / Next `__NEXT_DATA__` en `r.jina.ai`** — niet nodig
  geweest; alle hosts gaven HTTP 200 op een gewone `curl` met een browser-UA.
- **Botdetectie** — nergens tegengekomen bij icscards.nl, anwb.nl, asnbank.nl,
  americanexpress.com of wise.com. De enige 404's zijn echte 404's.

## Stand van de catalogus

185 producten, ongewijzigd, in dezelfde volgorde in `state.json` en
`catalog.json`. **89 rijen met een `accountFee`** (was 71), alle 89 komen door
`readAccountFee` heen en geen ervan draagt een ophaaldag als datum.

`cd packages/core && npx vitest run src/catalogArtifact.test.ts src/travel.test.ts`
→ **88 geslaagd, 1 gefaald**, in 2 bestanden.

De ene faler is de telling zelf: `catalogArtifact.test.ts` regel 72 zegt
`expect(withFee).toHaveLength(71)` en het zijn er nu 89. Alle andere assertions
in dat bestand slagen, inclusief `expect(refused).toEqual([])`, de datumvorm en
de gelijkheid van beide bestanden. Het testbestand is van een andere lane en is
daarom niet aangepast; `71` → `89` op regel 72 is de hele reparatie.
