# Nederlandse gemiddelden per uitgavecategorie — bestaan ze, en kan LaVega ze eerlijk tonen?

Onderzoek uitgevoerd 21 augustus 2026. Alle cijfers hieronder zijn opgehaald bij de
bron, niet uit het geheugen. Geen Anthropic API-credits gebruikt; alleen de open
CBS-OData-API, de Eurostat-API, en het publieke deel van nibud.nl.

## Kern

**De cijfers bestaan. Ze zijn niet koppelbaar aan LaVega's categorieën, en een
percentiel erop is niet eerlijk te tonen. Aanbeveling: bouw dit niet tegen een
Nederlands gemiddelde.**

Drie dingen breken het, elk op zichzelf al genoeg:

1. **CBS deelt in naar PRODUCT, LaVega naar TEGENPARTIJ.** Eén afschrijving van
   Albert Heijn is in LaVega 100% "Boodschappen"; in het CBS valt diezelfde kar
   uiteen over voeding (01), drank en tabak (02), schoonmaakmiddelen (05.6),
   verzorging (12.1) en dierenvoer (09.3.4). Er is geen omrekening die dit
   herstelt, want het bonniveau zit niet in een banktransactie. Dit is geen
   marge-probleem maar een categorie-fout.
2. **De grootste post van het CBS is geen banktransactie.** "Toegerekende huur
   eigen woning" is €5.597 per huishouden per jaar (2020) — 16% van het totaal —
   en is een _rekenkundige_ huurwaarde voor mensen met een koophuis. Er staat
   geen afschrijving tegenover. Omgekeerd staan LaVega's grootste woonposten
   (hypotheekaflossing, hypotheekrente) niet in de CBS-cijfers, want dat is geen
   consumptie. Voor een huiseigenaar is "Wonen & energie" dus principieel
   onvergelijkbaar.
3. **Het meest recente cijfer per categorie is van 2020, een coronajaar, en de
   opvolger komt eind 2027.** Horeca lag in 2020 22,8% lager dan in 2015, kleding
   12,4% lager. Daarbovenop is het algemene prijspeil sinds 2020 met 25,1%
   gestegen en energie met 56,9%. Elk getal dat je nu toont is minstens twee
   correcties verwijderd van wat de gebruiker deze maand betaalt.

En als klapstuk: **twee officiële CBS-bronnen zijn het onderling niet eens.** De
nationale rekeningen komen voor 2025 uit op €60.139 consumptie per huishouden, het
Budgetonderzoek 2020 geïndexeerd naar 2025 op €44.047. Per categorie loopt de
verhouding uiteen van 0,88 (energie) tot 2,60 (restaurants en cafés). Er is dus
niet één "Nederlands gemiddelde" — er zijn er meerdere, en welke je kiest bepaalt
of de gebruiker boven of onder de streep valt.

De aparte lane die tegen zijn eigen geschiedenis rekent is niet alleen een
alternatief — het is de enige variant die klopt. Zie §4 voor de aanbeveling en
voor wat er wél kan.

---

## 1. Bestaan de cijfers, per categorie, met een jaar?

Ja, drie bronnen, met echte URL's en echte jaartallen.

### 1a. CBS Budgetonderzoek — de beste bron

Het CBS Budgetonderzoek (BO) is de enige Nederlandse statistiek die uitgaven per
categorie _per huishoudtype_ geeft. Drie levende tabellen:

| Tabel    | Wat                                                                                                                           | Jaren      | Eenheid                                 | URL                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- | ---------------------------------------------------------- |
| 83676NED | Bestedingen per bestedingscategorie, alle huishoudens, 400 categorieën tot 5 cijfers COICOP, mét 95%-betrouwbaarheidsinterval | 2015, 2020 | euro per jaar                           | https://opendata.cbs.nl/statline/#/CBS/nl/dataset/83676NED |
| 85419NED | Bestedingen per hoofdgroep × 88 huishoudkenmerken                                                                             | 2015, 2020 | ×1.000 euro per jaar (afgerond op €100) | https://opendata.cbs.nl/statline/#/CBS/nl/dataset/85419NED |
| 85420NED | Bestedings*aandeel* per categorie (alle 400) × 88 huishoudkenmerken                                                           | 2015, 2020 | procent                                 | https://opendata.cbs.nl/statline/#/CBS/nl/dataset/85420NED |

Open OData-API, geen sleutel nodig, geen rate limit tegengekomen. Voorbeeld:

```
https://opendata.cbs.nl/ODataApi/odata/83676NED/TypedDataSet?$format=json&$filter=Perioden eq '2020JJ00'
```

Licentie, letterlijk uit de metadata van 85419NED:

> Copyright (c) Centraal Bureau voor de Statistiek, Den Haag/Heerlen
> Verveelvoudiging is toegestaan, mits CBS als bron wordt vermeld.

Dus: bundelen mag, met bronvermelding.

**Jaar: 2020.** Definitief. Volgende meting is 2026, nieuwe cijfers "naar
verwachting eind 2027" (letterlijk in de tabeltoelichting van 85419NED, gewijzigd
27 januari 2023). Er komt tot dan niets nieuwers per categorie.

Twee stopgezette voorgangers, niet gebruiken: 83678NED en 83679NED (opgevolgd door
85419NED resp. 85420NED).

Methode (bron: https://www.cbs.nl/nl-nl/onze-diensten/methoden/onderzoeksomschrijvingen/korte-onderzoeksbeschrijvingen/budgetonderzoek):
deelnemers noteren vier weken lang alle aankopen van €20 en meer, en in één van die
vier weken ook alles onder de €20. In 2015 deden ~15.000 huishoudens mee.

### 1b. CBS Nationale rekeningen — actueler, maar een ander begrip

85873NED, "Consumptieve bestedingen; verbruiksfunctie, nationale rekeningen",
1995–2025, in miljoen euro:
https://opendata.cbs.nl/statline/#/CBS/nl/dataset/85873NED

Dit loopt tot en met **2025** en is dus vijf jaar actueler. Maar het is een
macrototaal voor heel Nederland, niet uit te splitsen naar huishoudtype. Delen door
het aantal particuliere huishoudens (8.430.352 op 1 januari 2025, 71486ned) geeft
een "gemiddelde", maar een ander gemiddelde dan het BO — zie §3.

### 1c. Nibud — actueel (2026), maar grotendeels achter een betaalmuur

De volledige Nibud-referentiebegrotingen (minimumvoorbeeldbegroting en gemiddelde
begroting per huishoudtype) staan **niet** gratis online. Ze zitten in het
Budgethandboek, vanaf €144,00 incl. btw
(https://www.nibud.nl/samenwerken/cijfers-en-rekentools/referentiebegrotingen/).
Geen API, geen open dataset.

Wat wél gratis en met jaartal op nibud.nl staat, en bruikbaar is:

| Onderwerp                         | Cijfers                                                                                                                                        | Jaar / bron zoals Nibud die noemt                                                                                      | URL                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Voeding, minimaal                 | alleenstaande €63,03/wk = €273,13/mnd; stel €114,59/wk = €497,92/mnd; stel + 2 kinderen (8 en 13 jr) €146,47/wk = €636,47/mnd                  | "Bron: Referentievoedingen, Voedingscentrum 2021, Nederlandse Vereniging van Diëtisten 2020. Berekeningen: Nibud 2026" | https://www.nibud.nl/onderwerpen/uitgaven/huishoudelijke-uitgaven/ |
| Gas per woningtype                | flat €116/mnd (770 m³/jr), tussenwoning €144, hoekwoning €163, 2-onder-1-kap €181, vrijstaand €228, gemiddeld alle woningen €140 (1.000 m³/jr) | "Bron: Milieu Centraal en CBS (berekening Nibud, 2026)", tarieven per januari 2026                                     | https://www.nibud.nl/onderwerpen/uitgaven/kosten-energie-water/    |
| Elektriciteit per huishoudgrootte | 1p €31/mnd (1.600 kWh), 2p €49, 3p €61, 4p €73, 5+ €81, gemiddeld €46 (2.260 kWh)                                                              | idem, januari 2026                                                                                                     | idem                                                               |
| Water per huishoudgrootte         | 1p €17,70/mnd, 2p €21,85, 3p €26,10, 4p €32,25, 5p €35,95                                                                                      | "Bron: Vewin (berekening Nibud, januari 2026)"                                                                         | idem                                                               |
| Auto per klasse, totaal per maand | mini €370, compact €432, kleine middenklasse €572, middenklasse €724 — waarvan brandstof €88,00 / €93,50 / €108,00 / €130,50                   | "Bron: ANWB, juni 2025 (bewerking Nibud juni 2026)", benzine €2,19/l                                                   | https://www.nibud.nl/onderwerpen/uitgaven/autokosten/              |

**Maar**: de licentie sluit hergebruik uit. Letterlijk van
https://www.nibud.nl/copyrights-nibud/:

> Het overnemen, opslaan en verspreiden van (delen van) teksten of andere inhoud is
> in principe niet toegestaan, tenzij hier vooraf schriftelijke toestemming voor is
> gekregen van het Nibud.

De pagina noemt referentiecijfers in rekentools en op webpagina's expliciet. Dus
zelfs waar Nibud statistisch bruikbaar zou zijn, mag het niet gebundeld worden
zonder vooraf schriftelijke toestemming. Dat is een blokkade die los staat van alle
andere bezwaren.

### 1d. Eurostat HBS — voegt niets toe

https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/hbs_str_t224?format=JSON&geo=NL&lang=en&time=2020

Werkt (HTTP 200, geen sleutel), maar het is dezelfde Nederlandse golf van 2020 —
het CBS levert hem aan. Uitgaven staan er alleen als **aandeel in promille**; de
enige euro-achtige eenheid is PPS (koopkrachtstandaard), niet euro, en alleen als
totaal (hbs_exp_t134), niet per categorie. Laatste golf voor NL: 2020. Dus:
grover, in een vreemde eenheid, en niet actueler. Overslaan.

---

## 2. Zijn de categorieën te koppelen aan die van LaVega?

De echte lijst is `CATEGORY_OPTIONS` in `packages/core/src/categorize.ts` — 25
categorieën, inclusief de vier die een mechanisme beschrijven in plaats van een
soort uitgave (`PERSON_CATEGORY`, `CREDIT_CARD_PAYMENT_CATEGORY`,
`DIRECT_DEBIT_CATEGORY`, "Eigen overboeking"). De bijbehorende matchregels staan in
`packages/core/src/categories.ts`. Hieronder per LaVega-categorie het oordeel.

Legenda: **ja** = één-op-één te koppelen; **deels** = koppelbaar met een
correctie die genoemd moet worden; **nee** = niet koppelbaar.

| LaVega-categorie       | CBS-tegenhanger                                       | Oordeel   | Waarom                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boodschappen           | 01 Voeding en alcoholvrije dranken                    | **nee**   | LaVega vult dit met supermarkt-_tegenpartijen_ (albert heijn, jumbo, lidl, picnic, bakkerij, slagerij…). Een supermarktafschrijving bevat ook drank, tabak, schoonmaak, verzorging en dierenvoer, die het CBS in 02, 05.6, 12.1 en 09.3.4 boekt. Optellen om te repareren kan niet: van 02 wordt niet alles bij de supermarkt gekocht, en van 01 wordt een deel bij de markt of online gehaald.                                                                  |
| Eten & drinken         | 11.1 Restaurants, cafés, kantines                     | **deels** | Begrip klopt, cijfer niet: het BO meet horeca structureel te laag. BO 2020 → 2025 geïndexeerd €1.507, nationale rekeningen 2025 €3.912 — factor 2,6 uit elkaar. En 2020 was een sluitingsjaar (−22,8% t.o.v. 2015).                                                                                                                                                                                                                                              |
| Transport              | 07 Vervoer                                            | **deels** | 07.1 "Aankoop van voertuigen" (€1.614/jr gemiddeld) is voor de meeste huishoudens in de meeste jaren nul en in één jaar €20.000; een gemiddelde daarover naast een maandtotaal leggen is zinloos. Alleen 07.2.2 brandstof (€985/jr) en 07.3 vervoersdiensten (€207/jr) zijn maandelijkse posten. Bovendien: leasekosten en een privéauto op de zaak zitten er niet in.                                                                                           |
| Reizen                 | 09.6 Pakketreizen + 11.2 Accommodaties                | **deels** | Samen €662/jr (2020) — maar 2020 is precies het jaar waarin niemand reisde, dus dit getal is onbruikbaar. Vliegtickets zitten bovendien in 07.3, niet hier.                                                                                                                                                                                                                                                                                                      |
| Wonen & energie        | 04 Huisvesting, water en energie                      | **nee**   | Zie de kern: 04.2 toegerekende huur (€5.597/jr) is geen transactie, en hypotheekrente en -aflossing staan nergens in het CBS. Alleen voor een **huurder** is er een schoon deelcijfer: 04.1 werkelijke woninghuur = €7.006/jr = €584/mnd voor huurders (2020). Voor een koopwoning is de post onvergelijkbaar.                                                                                                                                                   |
| Abonnementen           | —                                                     | **nee**   | Bestaat niet als CBS-categorie. Het equivalent ligt verspreid over 08.3 telefonie/internet (€1.050/jr), 09.4.2.3 tv-abonnementen (€64/jr), delen van 09.4.1 sport, 09.5.2 kranten, en 05.6.2 huishoudelijke diensten. LaVega heeft 67 abonnementsregels — de grootste categorie in de rules-lijst — en het CBS heeft er geen.                                                                                                                                    |
| Verzekeringen          | 12.5 Verzekeringen                                    | **nee**   | 12.5 telt op tot €1.180/jr: woning €105, ziekte €168, vervoer €490, overig €417. Die €168 heet voluit "Aanvullende verzekeringen i.v.m. ziekte" en is de héle zorgpost — de **nominale basispremie** (~€1.400–€1.900/jr) zit er niet in, want die telt als sociale premie en niet als consumptie. LaVega ziet die afschrijving elke maand wél. Het CBS-cijfer is dus systematisch meer dan €1.000 per jaar te laag en de gebruiker lijkt altijd een uitschieter. |
| Gezondheid             | 06 Gezondheid                                         | **deels** | €575/jr = €48/mnd, en dat is puur eigen betaling (eigen risico, tandarts, medicijnen). Klopt qua begrip met wat LaVega ziet, mits de zorgpremie in "Verzekeringen" blijft. Wel klein en dus met een brede marge (95%-interval €542–€608).                                                                                                                                                                                                                        |
| Kleding & winkelen     | 03 Kleding en schoenen                                | **deels** | Begrip klopt redelijk, maar LaVega's "Kleding & winkelen" bevat ook warenhuizen die het CBS elders boekt, en 2020 lag 12,4% onder 2015.                                                                                                                                                                                                                                                                                                                          |
| Online shopping        | —                                                     | **nee**   | Het CBS deelt in naar wat je koopt, niet waar. Bol.com is in het CBS geen categorie.                                                                                                                                                                                                                                                                                                                                                                             |
| Elektronica            | 09.1 audio/video/foto + 05.3 huishoudelijke apparaten | **deels** | Verspreid over twee hoofdgroepen, en het is bij uitstek een lompe post: nul in elf maanden, €900 in de twaalfde.                                                                                                                                                                                                                                                                                                                                                 |
| Entertainment          | 09.4 Diensten voor recreatie en cultuur               | **deels** | Streaming zit deels in 09.4.2.3 en deels bij abonnementen; 09.4.3 kansspelen zit erbij in.                                                                                                                                                                                                                                                                                                                                                                       |
| Huis & tuin            | 04.3 onderhoud + 05.1 meubelen + 09.3.3 tuin          | **deels** | Drie hoofdgroepen samenvoegen; de bijbehorende marge maakt het cijfer stomp.                                                                                                                                                                                                                                                                                                                                                                                     |
| Huisdieren             | 09.3.4 producten + 09.3.5 diensten                    | **ja**    | €233/jr gemiddeld = €19/mnd. Netjes koppelbaar. Maar: gemiddeld over _alle_ huishoudens, inclusief de meerderheid zonder huisdier. Voor iemand mét een hond is €19 geen zinnige lat.                                                                                                                                                                                                                                                                             |
| Goede doelen           | 15 Goede doelen                                       | **ja**    | €141/jr = €12/mnd. Het CBS heeft hier een eigen hoofdgroep buiten COICOP voor gemaakt. Zelfde bezwaar: gemiddelde over gevers en niet-gevers samen.                                                                                                                                                                                                                                                                                                              |
| Belastingen & overheid | 13 Consumptiegebonden belastingen                     | **deels** | 13 is alleen zuiveringsheffing, motorrijtuigenbelasting en hondenbelasting: €594/jr. LaVega's categorie bevat ook inkomstenbelasting, btw-afdracht en gemeentelijke aanslagen — die zijn per definitie geen consumptie en staan niet in het BO.                                                                                                                                                                                                                  |
| Bankkosten             | 12.6 Financiële diensten n.e.g.                       | **deels** | €192/jr. Bevat ook advieskosten en provisies, niet alleen betaalpakketten.                                                                                                                                                                                                                                                                                                                                                                                       |
| Sparen & beleggen      | —                                                     | **nee**   | Sparen is geen consumptie. Bestaat niet in het BO.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Overboekingen          | —                                                     | **nee**   | Idem.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tussen personen        | —                                                     | **nee**   | Idem.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Creditcard afbetaald   | —                                                     | **nee**   | Idem.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Automatische incasso   | —                                                     | **nee**   | Een mechanisme, geen bestedingscategorie.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Eigen overboeking      | —                                                     | **nee**   | Idem.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Geldopname             | —                                                     | **nee**   | Contant geld verdwijnt in het BO ín de categorie waar het aan wordt uitgegeven; in LaVega blijft het een opname. Precies andersom.                                                                                                                                                                                                                                                                                                                               |
| Inkomen                | —                                                     | **nee**   | Het BO gaat over uitgaven.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Telling over 25 categorieën: 2 ja, 10 deels, 13 nee.** De twee schone
(Huisdieren, Goede doelen) zijn net de twee waar het gemiddelde over houders/gevers
én niet-houders/niet-gevers samen loopt en dus niets zegt. En de vier posten die in
een Nederlands huishoudboekje het zwaarst wegen — Boodschappen, Wonen & energie,
Abonnementen, Verzekeringen — staan alle vier op "nee".

---

## 3. Waarvan is het een gemiddelde?

Dit is de vraag waarop de bron het best scoort en de toepassing het slechtst.

### Er ís uitgesplitst, en royaal

85419NED en 85420NED kennen 88 huishoudkenmerken:

- **Huishoudgrootte**: 1, 2, 3, 4, 5+ personen
- **Huishoudtype**: eenpersoons (man/vrouw, onder/vanaf AOW), eenoudergezin, paar
  met/zonder kinderen, meerpersoons overig
- **Leeftijd hoofdkostwinner**: 7 klassen van "tot 25" tot "75 of ouder"
- **Inkomensbron**: werknemer, zelfstandige, pensioen, bijstand, studiefinanciering…
- **Woningbezit**: eigen woning, huur, huur met/zonder huurtoeslag
- **Besteedbaar inkomen**: 10 decielen en 5 kwintielen
- **Gestandaardiseerd inkomen**: idem
- **Herkomst**, en **onder/boven de lage-inkomensgrens**

Dus ja: je kunt een eenpersoonshuishouden naast een eenpersoonshuishouden leggen,
en een huurder naast een huurder.

### En de spreiding laat zien waarom je dat moet

Totale bestedingen per jaar, 2020, 85419NED:

| Kenmerk                           | Totaal per jaar |
| --------------------------------- | --------------- |
| Alle particuliere huishoudens     | €35.200         |
| 1 persoon                         | €23.600         |
| 2 personen                        | €37.300         |
| 3 personen                        | €43.300         |
| 4 personen                        | €50.500         |
| 5 of meer personen                | €52.000         |
| Besteedbaar inkomen, 1e 20%-groep | €19.900         |
| Besteedbaar inkomen, 5e 20%-groep | €56.000         |
| Eigen woning                      | €42.800         |
| Huurwoning                        | €25.200         |

Factor 2,8 tussen de laagste en de hoogste inkomenskwintiel; factor 1,7 tussen
huur en koop. **Het gemiddelde over alle huishoudens (€35.200) beschrijft geen
enkel bestaand huishouden.** Zonder conditionering op minstens huishoudgrootte,
woningbezit én inkomen is elk percentiel dat je toont een percentiel ten opzichte
van een fictie.

### Twee bezwaren die conditioneren niet oplost

**Het gemiddelde loopt over deelnemers en niet-deelnemers.** "Huisdieren €19 per
maand" is het gemiddelde over huishouden mét en zónder huisdier. Voor iemand met
een hond ligt zijn eigen uitgave altijd ver boven "het gemiddelde", en dat betekent
niets. Hetzelfde geldt voor Goede doelen, Onderwijs, Reizen, en de aankoop van een
voertuig. Het CBS publiceert geen mediaan en geen verdeling — alleen een gemiddelde
en een betrouwbaarheidsinterval _van dat gemiddelde_. Een percentiel valt er dus
sowieso niet uit te rekenen: je hebt de verdeling nodig en die is er niet.

**Twee officiële CBS-bronnen geven verschillende antwoorden.** Budgetonderzoek 2020
geïndexeerd met de CBS-CPI naar 2025, naast nationale rekeningen 2025 gedeeld door
8.430.352 huishoudens:

|                                 | BO 2020 → 2025 | NR 2025 / huishouden | verhouding |
| ------------------------------- | -------------- | -------------------- | ---------- |
| Totaal                          | €44.047        | €60.139              | 1,37       |
| Voeding en alcoholvrije dranken | €5.830         | €6.968               | 1,20       |
| Restaurants en cafés            | €1.507         | €3.912               | 2,60       |
| Energie                         | €2.416         | €2.138               | 0,88       |
| Kleding en schoenen             | €1.603         | €2.901               | 1,81       |
| Vervoer                         | €4.978         | €7.349               | 1,48       |

De verschillen zijn deels definitorisch (de nationale rekeningen tellen ook
instellingen zonder winstoogmerk, drugs, en consumptie in het buitenland mee) en
deels meetfout (een dagboekje van vier weken vangt horeca slecht). Maar het effect
op de app is hetzelfde: **welke bron je pakt bepaalt of de gebruiker boven of
onder het gemiddelde uitkomt**, en bij horeca scheelt dat een factor 2,6. Dat is
geen marge waar je een percentiel op zet.

### Veroudering, gekwantificeerd

CBS-CPI (86141NED, 2025=100), jaargemiddelden 2020 → 2025:

| Afdeling                             | index 2020 | index 2025 | factor 2020→2025 |
| ------------------------------------ | ---------- | ---------- | ---------------- |
| Alle bestedingen                     | 79,94      | 100        | ×1,251           |
| Voeding en alcoholvrije dranken      | 76,47      | 100        | ×1,308           |
| Alcoholhoudende dranken en tabak     | 66,45      | 100        | ×1,505           |
| Kleding en schoenen                  | 86,94      | 100        | ×1,150           |
| Huisvesting en nutsvoorzieningen     | 79,51      | 100        | ×1,258           |
| Elektriciteit, gas en brandstoffen   | 63,73      | 100        | ×1,569           |
| Huishoudelijke goederen en diensten  | 86,79      | 100        | ×1,152           |
| Gezondheid                           | 83,79      | 100        | ×1,193           |
| Vervoer                              | 79,45      | 100        | ×1,259           |
| Informatie en communicatie           | 103,77     | 100        | ×0,964           |
| Recreatie, sport en cultuur          | 82,44      | 100        | ×1,213           |
| Onderwijs                            | 79,79      | 100        | ×1,253           |
| Restaurants en accommodatie          | 74,50      | 100        | ×1,342           |
| Verzekeringen en financiële diensten | 76,35      | 100        | ×1,310           |

Let op: de CPI is inmiddels op ECOICOP 2023 overgestapt (afdeling 08 heet nu
"Informatie en communicatie", 12 "Verzekeringen en financiële diensten"), terwijl
het Budgetonderzoek 2020 nog de oude indeling gebruikt. Indexeren is dus zelf al
een benadering, geen conversie.

En het is niet alleen prijs. Het BO-jaar 2020 is volumematig vertekend
(83676NED, 2015 vs 2020):

| Afdeling              | 2015   | 2020   | verschil |
| --------------------- | ------ | ------ | -------- |
| Restaurants en hotels | €1.994 | €1.651 | −17,2%   |
| — waarvan catering    | €1.455 | €1.123 | −22,8%   |
| Kleding en schoenen   | €1.591 | €1.394 | −12,4%   |
| Vervoer               | €4.351 | €3.955 | −9,1%    |
| Recreatie en cultuur  | €3.257 | €3.020 | −7,3%    |
| Voeding               | €3.721 | €4.458 | +19,8%   |

Corona zit ingebakken en is niet uit te filteren: 2015 is de enige andere
waarneming, en die is elf jaar oud.

---

## 4. Kan LaVega dit eerlijk tonen?

**Nee. Niet als percentiel, en niet als "u gaf X% meer uit dan het Nederlandse
gemiddelde".** De aanbeveling is: bouw dit niet.

Vier redenen, in volgorde van hardheid:

1. **Er is geen verdeling, dus er is geen percentiel.** Het CBS publiceert per
   categorie een gemiddelde plus een betrouwbaarheidsinterval van dat gemiddelde.
   Geen mediaan, geen decielen van de _uitgaven_. Een percentiel uitrekenen vergt
   de verdeling; die is niet openbaar. Wie hem toch toont, verzint hem. (De
   microdata bestaan wel, maar alleen onder CBS-remote-access met contract en
   goedkeuring — dat is geen route voor een lokale app.)
2. **De categorieën koppelen niet.** Van de 25 LaVega-categorieën zijn er 2 schoon
   koppelbaar, en dat zijn de twee kleinste. De grote posten — Boodschappen, Wonen
   & energie, Abonnementen, Verzekeringen — matchen niet, om structurele redenen
   (product versus tegenpartij, toegerekende huur, zorgpremie buiten de
   consumptie). Een gemiddelde voor "01 Voeding" naast LaVega's "Boodschappen"
   leggen is precies de appel-naast-peer waar dit onderzoek voor moest waken.
3. **De bronnen zijn het onderling oneens**, tot een factor 2,6 per categorie. Er
   is geen manier om te kiezen die niet neerkomt op: kies het cijfer dat het
   verhaal het beste past.
4. **Het cijfer is zes jaar oud, uit een uitzonderlijk jaar, en blijft dat tot eind 2027.** Elke correctie die je erop loslaat (CPI-indexatie, terug naar 2015)
   voegt een aanname toe die de gebruiker niet ziet.

Een melding als "u zit in het 80e percentiel voor Boodschappen" zou dus een
conclusie zijn die de onderliggende afwezigheid — geen verdeling, geen koppelbare
categorie — niet kan dragen. Dat is precies de fout die de huisregels verbieden.

### Wat wel kan

**Doen: eigen geschiedenis.** De andere lane. Zijn eigen maandelijkse uitgave per
categorie tegen zijn eigen mediaan over de afgelopen twaalf maanden. Dezelfde
categorie-indeling aan beide kanten, dezelfde persoon, dezelfde bank, en de
verdeling is er echt. Dat is het enige percentiel dat in LaVega klopt.

**Eventueel doen: drie losse, geconditioneerde ijkpunten — als aparte feiten, niet
als vergelijking.** Er zijn drie plekken waar een LaVega-post één-op-één een
transactie is die het CBS ook als transactie meet, en waar het huishoudkenmerk
bekend of te vragen is:

| Post                              | Cijfer                                     | Voorwaarde                                                                                                                 | Bron                                                               |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Huur                              | €584 per maand (€7.006/jr)                 | alleen huurders; 2020, dus vóór de huurstijgingen sinds 2021                                                               | CBS 85419NED + 85420NED, huishoudkenmerk "Woningbezit: huurwoning" |
| Energie (gas + elektra)           | €94/mnd (1 persoon), €137/mnd (2 personen) | 2020, vóór de energiecrisis — met de CPI-factor ×1,569 wordt dat €147 resp. €215, en dat is een schatting, geen waarneming | CBS 85419NED/85420NED, huishoudgrootte                             |
| Water, riool, afvalstoffenheffing | €71/mnd (1 persoon), €90/mnd (2 personen)  | 2020                                                                                                                       | idem                                                               |

Toon die dan als "CBS Budgetonderzoek 2020, eenpersoonshuishouden: €94 per maand",
met jaar en huishoudtype in de regel zelf — niet als percentiel, niet als
"u zit erboven". Een los feit dat de gebruiker zelf kan wegen, niet een oordeel.

Mijn advies is om zelfs dit niet in de eerste versie te bouwen. Drie ijkpunten
tussen 25 categorieën ziet er willekeurig uit, en de energiepost is zonder
indexatie fout en mét indexatie een schatting. De eigen-geschiedenis-lane levert
alle 25.

**Niet doen: Nibud.** Statistisch is de voedingstabel (2026!) de mooiste die er
is, en de gas/elektra/water-tabellen zijn per huishoudgrootte uitgesplitst en
actueel. Maar (a) het is een _minimum_ voor een verantwoord voedingspakket, geen
gemiddelde uitgave — Nibud zegt zelf "Werkelijke uitgaven zijn afhankelijk van het
inkomen" — en (b) hergebruik vereist vooraf schriftelijke toestemming, expliciet
óók voor referentiecijfers in rekentools. Wil je die route toch, dan is de eerste
stap een mail naar Nibud, niet een commit.

### Wanneer dit heroverwogen mag worden

Eind 2027, als de cijfers uit het Budgetonderzoek 2026 verschijnen. Dan is het jaar
recent, niet-corona, en de tabellen 85419NED/85420NED worden bijgewerkt op dezelfde
URL's. De koppelbaarheid verandert daar niet door — punten 1, 2 en 3 hierboven
blijven staan — dus ook dan is de eerlijke uitkomst waarschijnlijk nog steeds "nee,
niet als percentiel".

---

## Bijlage A — de cijfers, voor als een volgende agent ze toch wil bundelen

CBS Budgetonderzoek **2020**, gemiddelde bestedingen per particulier huishouden per
jaar en per maand. Kolom "alle hh" komt rechtstreeks uit 83676NED (euro-precisie);
de kolommen per huishoudgrootte zijn berekend als _aandeel uit 85420NED × totaal
uit 85419NED_, want 85419NED geeft alleen hoofdgroepen en rondt af op €100.

Totalen gebruikt voor de berekening: alle huishoudens €35.211, 1 persoon €23.600,
2 personen €37.300.

| COICOP-categorie                                        | alle hh /jr | /mnd      | 1 pers /jr | /mnd      | 2 pers /jr | /mnd      |
| ------------------------------------------------------- | ----------- | --------- | ---------- | --------- | ---------- | --------- |
| 01 Voeding en alcoholvrije dranken                      | 4.458       | 372       | 2.690      | 224       | 4.700      | 392       |
| 02 Alcoholhoudende dranken en tabak                     | 1.222       | 102       | 1.227      | 102       | 1.231      | 103       |
| 03 Kleding en schoenen                                  | 1.394       | 116       | 732        | 61        | 1.343      | 112       |
| 04.1 Werkelijke woninghuur                              | 3.181       | 265       | 4.319      | 360       | 2.872      | 239       |
| 04.2 Toegerekende huur eigen woning _(geen transactie)_ | 5.597       | 466       | 3.115      | 260       | 6.528      | 544       |
| 04.4 Water, riool, afvalstoffen                         | 979         | 82        | 850        | 71        | 1.082      | 90        |
| 04.5 Energie (gas, elektra)                             | 1.540       | 128       | 1.133      | 94        | 1.641      | 137       |
| 05 Stoffering en huishoudelijke apparaten               | 2.282       | 190       | 1.274      | 106       | 2.462      | 205       |
| 05.6.1 Niet-duurzame huishoudproducten                  | 214         | 18        | 142        | 12        | 224        | 19        |
| 06 Gezondheid (eigen betalingen)                        | 575         | 48        | 354        | 30        | 709        | 59        |
| 07.1 Aankoop van voertuigen _(lompe post)_              | 1.614       | 134       | 826        | 69        | 1.865      | 155       |
| 07.2 Gebruik privévoertuigen                            | 2.134       | 178       | 1.038      | 87        | 2.201      | 183       |
| 07.2.2 Brandstoffen en smeermiddelen                    | 985         | 82        | 519        | 43        | 1.044      | 87        |
| 07.3 Vervoersdiensten (OV, taxi, vliegtickets)          | 207         | 17        | 189        | 16        | 224        | 19        |
| 08.3 Telefoon- en internetdiensten                      | 1.050       | 88        | 826        | 69        | 1.082      | 90        |
| 09 Recreatie en cultuur                                 | 3.020       | 252       | 1.770      | 148       | 3.245      | 270       |
| 09.3.4 Producten voor huisdieren                        | 189         | 16        | 142        | 12        | 224        | 19        |
| 09.3.5 Diensten voor huisdieren                         | 44          | 4         | 24         | 2         | 37         | 3         |
| 09.4.2.3 Televisieabonnementen                          | 64          | 5         | 47         | 4         | 75         | 6         |
| 09.6 Pakketreizen                                       | 133         | 11        | 71         | 6         | 149        | 12        |
| 10 Onderwijs                                            | 440         | 37        | 212        | 18        | 261        | 22        |
| 11.1 Restaurants, cafés, kantines                       | 1.123       | 94        | 661        | 55        | 1.194      | 99        |
| 11.2 Accommodaties (hotels)                             | 529         | 44        | 212        | 18        | 560        | 47        |
| 12.1 Persoonlijke verzorging                            | 719         | 60        | 425        | 35        | 746        | 62        |
| 12.5 Verzekeringen _(excl. basispremie zorg)_           | 1.180       | 98        | 708        | 59        | 1.343      | 112       |
| 12.6 Financiële diensten n.e.g.                         | 192         | 16        | 142        | 12        | 186        | 16        |
| 13 Consumptiegebonden belastingen                       | 594         | 50        | 283        | 24        | 709        | 59        |
| 15 Goede doelen                                         | 141         | 12        | 94         | 8         | 186        | 16        |
| **Alle bestedingen**                                    | **35.211**  | **2.934** | **23.600** | **1.967** | **37.300** | **3.108** |

Naar woningbezit (2020; totalen €42.800 eigen woning, €25.200 huurwoning):

| Categorie                                  | Eigen woning /jr | /mnd  | Huurwoning /jr | /mnd |
| ------------------------------------------ | ---------------- | ----- | -------------- | ---- |
| 04 Huisvesting, water en energie           | 13.311           | 1.109 | 9.274          | 773  |
| 04.1 Werkelijke woninghuur                 | 300              | 25    | 7.006          | 584  |
| 04.2 Toegerekende huur _(geen transactie)_ | 9.716            | 810   | 151            | 13   |
| 04.4 Water, riool, afvalstoffen            | 1.113            | 93    | 781            | 65   |
| 04.5 Energie                               | 1.798            | 150   | 1.184          | 99   |

Bronnen bij elke regel hierboven: CBS StatLine 83676NED, 85419NED, 85420NED,
peiljaar 2020, geraadpleegd 21 augustus 2026. Bronvermelding verplicht,
verveelvoudiging toegestaan.

Nibud-cijfers (2026, per maand) staan in §1c, met de waarschuwing dat hergebruik
zonder schriftelijke toestemming niet is toegestaan.

## Bijlage B — doodlopende routes

| Route                                                         | Wat er gebeurde                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nibud referentiebegrotingen per huishoudtype                  | Niet gratis. Alleen in het Budgethandboek vanaf €144,00 incl. btw. Geen API, geen open dataset.                                                                                                   |
| Nibud-cijfers overnemen                                       | Verboden zonder vooraf schriftelijke toestemming, expliciet ook voor referentiecijfers in rekentools (copyrights-nibud). Blokkade los van de statistiek.                                          |
| https://www.nibud.nl/onderwerpen/uitgaven/voorbeeldbegroting/ | HTTP 404. De pagina bestaat niet (meer).                                                                                                                                                          |
| Nibud "Vergelijk jezelf" / Persoonlijk Budgetadvies           | Landingspagina zonder cijfers; de bedragen zitten in de tool, niet in de pagina.                                                                                                                  |
| Eurostat HBS                                                  | API werkt, maar het is dezelfde NL-golf 2020, alleen in promille-aandelen; euro's alleen als PPS-totaal. Voegt niets toe aan het CBS.                                                             |
| CBS 83678NED / 83679NED                                       | Stopgezet per 27 januari 2023, opgevolgd door 85419NED / 85420NED. Niet gebruiken.                                                                                                                |
| CBS-microdata Budgetonderzoek                                 | Zou de verdeling geven, maar vereist remote access met contract en goedkeuring. Geen route voor een lokale app.                                                                                   |
| Nationale rekeningen als "actueler alternatief" (85873NED)    | Loopt tot 2025 en is per categorie beschikbaar, maar niet naar huishoudtype uit te splitsen, en wijkt per categorie tot factor 2,6 af van het Budgetonderzoek. Ander begrip, geen vervanging.     |
| CPI-indexatie van BO 2020 naar 2026                           | Kan technisch (86141NED), maar de CPI is inmiddels op ECOICOP 2023 en het BO nog op de oude COICOP, dus de indexatie is zelf al een benadering. En het lost het volume-effect van corona niet op. |

## Bijlage C — hoe je deze cijfers opnieuw ophaalt

Geen sleutel nodig; alles is open OData / JSON.

```bash
# Metadata en categorieënlijst
curl -s "https://opendata.cbs.nl/ODataApi/odata/83676NED/TableInfos?\$format=json"
curl -s "https://opendata.cbs.nl/ODataApi/odata/85419NED/KenmerkenHuishoudens?\$format=json"
curl -s "https://opendata.cbs.nl/ODataApi/odata/85420NED/Bestedingscategorieen?\$format=json"

# Bedragen per categorie, alle huishoudens, met 95%-interval
curl -s "https://opendata.cbs.nl/ODataApi/odata/83676NED/TypedDataSet?\$format=json&\$filter=Perioden%20eq%20%272020JJ00%27"

# Aandelen per categorie voor een huishoudkenmerk (1011400 = 1 persoon)
curl -s "https://opendata.cbs.nl/ODataApi/odata/85420NED/TypedDataSet?\$format=json&\$filter=Perioden%20eq%20%272020JJ00%27%20and%20KenmerkenHuishoudens%20eq%20%271011400%27"

# Totaal per huishoudkenmerk (×1.000 euro) — nodig om aandeel × totaal te doen
curl -s "https://opendata.cbs.nl/ODataApi/odata/85419NED/TypedDataSet?\$format=json&\$filter=Perioden%20eq%20%272020JJ00%27"

# CPI-indexcijfers per afdeling (2025 = 100)
curl -s "https://opendata.cbs.nl/ODataApi/odata/86141NED/TypedDataSet?\$format=json&\$filter=Perioden%20eq%20%272020JJ00%27%20or%20Perioden%20eq%20%272025JJ00%27"
```

Let op bij het filteren: de sleutel van `Bestedingscategorieen` is gepadd met
spaties (`'T001112  '`), die van `KenmerkenHuishoudens` niet. Filteren op een
gepadde sleutel zonder padding levert een lege `value`-array op — geen foutmelding,
gewoon niets. Eerst één rij ophalen met `$top=1` en de echte sleutel aflezen
scheelt een half uur.
