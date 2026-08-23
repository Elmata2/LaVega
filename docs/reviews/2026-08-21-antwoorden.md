# Vier antwoorden — 21 augustus 2026

Bij review 4 (`docs/reviews/2026-08-21-app-review-4.md`), punten 5, 20, 27 en 29. Dit is een
meting, geen wijziging: er is geen productcode aangeraakt. Waar een antwoord om een kleine
reparatie vraagt, staat die beschreven en niet gebouwd. Geen Anthropic-credits gebruikt; alles
is `tsx`, `vitest`, `curl` en `python3`.

---

## 1. Waarom staat Simyo niet bij je abonnementen

**De detector is niet stuk. Een schone Simyo-reeks komt er gewoon doorheen. Wat hem eruit gooit
is de VORM van jouw rijen, en er zijn drie verschillende muren waar hij tegenaan kan lopen —
elk met een ander getal. Twee van die drie muren zijn door LaVega zelf gebouwd.**

Ik heb acht reeksen gebouwd die op jouw geval lijken (€ 11,89 per maand, incasso, wisselende
tenaamstelling) en ze door `detectSubscriptions` gehaald, met daarnaast een kopie van dezelfde
drempelketen die vertelt wáár hij stopt. Script:
`scratchpad/simyo.ts`; de functie staat in `packages/core/src/subscriptions.ts:322`.

| Reeks | Uitkomst | Waar hij stopt | Het gemeten getal |
|---|---|---|---|
| A. schoon, 4× € 11,89, vier schrijfwijzen | **gevonden** | — | intervallen 29/30/32, cv **0,050**; grens 0,4 |
| B. maar twee afschrijvingen | niets | `band.minOcc` | maandritme vraagt **3** afschrijvingen, er zijn er 2 |
| C. juni mist (mislukte incasso) | niets | `maxIntervalCv` | intervallen **31, 61, 30** → gemiddelde 40,67, sd 17,62, **cv 0,433** — net boven **0,4** |
| D. dezelfde betaling twee keer in de kluis | niets | `CADENCE_BANDS` | intervallen **0, 29, 0, 30, 0, 32, 0** → mediaan **0**; de maandband is 26–36 dagen |
| E. bedrag herhaalt zich nooit | niets | eis "een bedrag herhaalt zich" | 1189 / 1244 / 1135 / 1302 — geen bedrag komt twee keer voor |
| F. eenmalige extra 5 dagen na de incasso | niets | `maxIntervalCv` | intervallen 29/30/32/**5** → **cv 0,530** |
| G. tegenpartij leeg | niets | groepering | `merchantKey("")` = `""`, en die rijen worden vóór alles weggegooid |
| H. abonnement + toestelkrediet, zelfde winkel | niets | `CADENCE_BANDS` | intervallen 14/15/16/14/16/16/15 → mediaan **15** |

Reeks A bewijst dat de grondslag klopt: naamvarianten zijn opgelost, `merchantKey` doet zijn
werk, de 32 tests in `packages/core/src/subscriptions.test.ts` zijn groen (32/32, gedraaid). Dat
is precies waarom dit drie keer eerder "gefixt" is en toch terugkwam: **de tests meten reeks A,
en jouw kluis is reeks C, D of H.** Groene tests zijn hier geen bewijs geweest.

### De drie muren, op naam

**Muur 1 — één gemiste incasso is genoeg (reeks C, regel 374).** De drempel is een
variatiecoëfficiënt van 0,4 over álle intervallen tegelijk. Eén overgeslagen maand maakt van
`[31, 30]` de reeks `[31, 61, 30]`, en die komt op 0,433 uit. Dat is 8% boven de grens, bij een
stroom die verder volmaakt maandelijks is.

Dit is het pijnlijkste van de drie, want **de Betaalagenda vindt hem wél.** Op exact dezelfde
rijen:

```
C. juni mist
  Optimalisatie (detectSubscriptions):  NIETS
  Betaalagenda  (detectScheduleStreams): SIMYO B.V. 11.89 elke 30d, 1 overgeslagen
```

`detectScheduleStreams` (zelfde bestand, regel 616) leest de gaten als hele CYCLI: een gat van
61 dagen is één overgeslagen maand, niet een onregelmatigheid. Die reparatie is in ronde 2/3
gebouwd voor de agenda en nooit doorgetrokken naar Optimalisatie. In één bestand staan nu twee
detectoren die het niet met elkaar eens zijn, en de oude zit achter de tab waar jij naar kijkt.

**Muur 2 — twee bronnen voor dezelfde rekening (reeks D).** Een CSV-import en de Enable
Banking-koppeling van dezelfde ING-rekening leveren dezelfde betaling twee keer op. Ze worden
niet ontdubbeld, want `ingest` (`packages/core/src/ingest.ts:4`) kijkt naar de transactie-id, en
die is een hash over `accountKey|datum|bedrag|tegenpartij|omschrijving` (`hash.ts:16`). De bank
schrijft "SIMYO" in de CSV en `creditor.name` levert "Simyo B.V." — verschillende tekst, dus
verschillende id, dus twee rijen. De abonnementendetector ziet daardoor een gat van **0 dagen**
tussen die twee, en de mediaan van de gaten valt buiten elke band. Niets wordt gemeld: de rij
verdwijnt zonder woorden.

**Muur 3 — één winkel is niet één stroom (reeksen F en H).** Sinds `merchantKey` alle Simyo-rijen
op één hoop gooit, komt een eenmalige bundel of een toestelkrediet in dezelfde groep terecht als
de incasso. Dat was de bedoeling — het loste het uiteenvallen op — maar het maakte een nieuw
probleem: het ritme wordt over de HOOP gelezen. Twee betalingen per maand aan Simyo geven een
mediaan van 15 dagen, en dan bestaat het abonnement niet meer.

De bestaande test hierop staat 0,014 van de rand. `subscriptions.test.ts:260` ("a one-off charge
from the same merchant is not the monthly price") zet de eenmalige extra 11 dagen na de laatste
incasso:

```
extra 14 dagen na de incasso -> cv=0,319  toegelaten
extra 11 dagen na de incasso -> cv=0,386  toegelaten   <- de test
extra  9 dagen na de incasso -> cv=0,433  AFGEWEZEN
extra  5 dagen na de incasso -> cv=0,532  AFGEWEZEN
```

Verschuif die ene datum met twee dagen en de test wordt rood. Hij bewijst dus niet wat hij lijkt
te bewijzen.

### Welke van de drie is het bij jou

Dat is met deze meting niet te bepalen en ik ga het niet raden. Jouw transacties staan in de
kluis in je browser, niet in de repo, en een afwezigheid kan die conclusie niet dragen. Wat het
in één blik zou beslissen: de Optimalisatie-tab drukt bovenaan al af over hoeveel dagen afschrift
hij kijkt. Is dat minder dan 60 dagen, dan is het muur B/1 en is er niets stuk. Staat er 90+ dagen
en heb je ING zowel geïmporteerd als gekoppeld, dan is het muur 2.

### Wat er zou moeten gebeuren (niet gebouwd)

Drie stappen, in deze volgorde, want ze lossen andere dingen op:

1. **Ontdubbelen op (rekening, datum, bedrag)**, ongeacht hoe de bron de naam spelt. Gemeten:
   reeks D gaat daarmee van `NIETS` naar `11,89/mnd ×4`. Dit hoort in `ingest`, niet in de
   detector — de dubbele rijen vervuilen ook je uitgaventotalen.
2. **`fitCycles` uit de Betaalagenda hergebruiken** in `detectSubscriptions`, in plaats van de
   variatiecoëfficiënt. Gemeten: dat is precies het verschil tussen de twee uitkomsten op reeks C
   hierboven. Eén detector minder om uit elkaar te laten lopen.
3. **Per winkel eerst op bedrag groeperen, dan pas het ritme lezen.** Gemeten op reeks H: de hoop
   valt uiteen in `11,89/mnd ×4` en `25,00/mnd ×4` — twee stromen die allebei kloppen, in plaats
   van nul.

En los daarvan, omdat dit de vierde ronde is: de lege lijst zegt nu hoeveel uitgaven en hoeveel
ontvangers LaVega zag, maar niet wat er met een BEPAALDE ontvanger gebeurde. Een regel per
afgewezen winkel — "Simyo: 4 afschrijvingen gezien, ritme 31/61/30 dagen, te ongelijk voor een
maandabonnement" — is het verschil tussen een vraag die je vier keer stelt en een antwoord dat op
het scherm staat.

---

## 2. Wat betekent "de AI heeft ze gelezen"

**Er staat niet dat ze gelezen zíjn. Het is een knop, geen mededeling: "Laat de AI ze lezen
(37 van 214)". Er is nog niets verstuurd tot je erop drukt, en er verandert nog niets nadat je
erop hebt gedrukt — je krijgt eerst een voorstel per transactie te zien.**

Dat de zin als voltooid gelezen wordt is op zich al een bevinding; hij staat op een knop, maar
klinkt als een status.

### Wat er gebeurt als je hem indrukt

De knop staat in `apps/web/src/views/Transacties.tsx:275`, in het onbekend-paneel. Volgorde:

1. **Alleen de rijen die nu "onbekend" zijn.** `uncategorizedTxs` (`categorize.ts:43`) neemt
   uitsluitend transacties waar de héle regelketen niets van weet. Die keten is: je eigen
   categorie → je eigen rekeningen en je eigen naam → **jouw regels** → de ingebouwde NL-lijst →
   buitenlandse terminal (`views.ts:133`). De AI komt daar helemaal achteraan. Een regel van jou
   wint dus altijd, en de AI krijgt zo'n rij niet eens te zien.
2. **De tekst wordt geschrobd vóór hij het apparaat verlaat**, in `redactForAi`
   (`categorize.ts:113`). Gemeten op een echte incassoregel:

   ```
   in de kluis : SIMYO B.V. | NL17INGB0539576085 Naam: SIMYO Omschrijving: Simyo
                 FACTUURNUMMER 8391023 Machtiging ID: 014-M162245502 Incassant ID:
                 NL12ZZZ271247010002 Bedrag: 11,89 Datum: 03-08-2026
   na redactie : SIMYO B.V. Naam: SIMYO Omschrijving: Simyo FACTUURNUMMER
                 Machtiging ID: 014-M162245502 Incassant ID: Bedrag: Datum:
   ```

   IBANs, bedragen, datums en lange cijferreeksen zijn eruit; de naam van de winkel blijft staan,
   want daar gaat het om. Eerlijk erbij: het machtigingskenmerk `014-M162245502` overleeft het,
   omdat er een letter en een streepje in zitten. Dat is geen IBAN, geen bedrag en geen datum, dus
   de belofte in de toestemmingstekst klopt — maar het is wel een kenmerk dat naar jou verwijst.
3. **Wat er daadwerkelijk over de lijn gaat, is drie velden per rij**, opgebouwd door
   `aiCategorizeItems` (`categorize.ts:135`):

   ```json
   { "id": "a1", "text": "SIMYO B.V. Naam: SIMYO Omschrijving: Simyo ...", "sign": "out" }
   ```

   Geen bedrag, geen saldo, geen datum, geen rekeningnummer, geen rekeningsleutel. De server bouwt
   die lijst nóg een keer op uit alleen die drie velden (`sanitizeCategorizeInput`,
   `apps/server/src/agent/categorize.ts:14`) — dat is een tweede hek, zodat een fout in de browser
   niet automatisch een lek is. Maximaal 200 rijen per keer; rijen waar na het schrobben geen
   letter meer over is, gaan niet mee en tellen dus ook geen plek op.
4. **Het antwoord is een voorstel, geen wijziging.** Het model (Claude Haiku, via onze eigen
   server, niet vanuit je browser) mag alleen categorieën teruggeven die al in LaVega's eigen
   lijst staan; alles daarbuiten wordt weggegooid. Je krijgt een reviewscherm met een rij per
   voorstel en kunt er per stuk een andere kiezen of hem overslaan. Pas als je bevestigt, gebeurt
   er iets.

### Hoe het zich verhoudt tot je eigen regels

Wat je bevestigt wordt `manual: true` (`applyCategorizations`, `categorize.ts:247`), en `manual`
wordt daarna door niets meer overschreven — ook niet als de regels verbeteren. Een bevestigd
AI-voorstel is dus net zo hard als een categorie die je zelf hebt getypt.

Daarnaast schrijft de bevestiging een REGEL bij, zodat je hem niet elke maand opnieuw hoeft te
doen. Daar zit één zwakke plek in, gemeten:

```
regel die de bevestiging aanmaakt : match "BOULANGERIE MARTEL 8891 PARIS" -> Eten & drinken
bevestigde rij                    : Eten & drinken (manual)
dezelfde winkel volgende maand    : onbekend
```

De regel neemt de tegenpartij LETTERLIJK over, inclusief het terminalnummer, dus volgende maand
past hij niet meer. Dat is dezelfde fout die `merchantKey` bij de abonnementen al heeft opgelost
— het is daar alleen nooit doorgetrokken naar de regels. Bij een winkel zonder nummer in de naam
werkt het wel gewoon.

### Kort, zoals het op het scherm zou kunnen staan

> LaVega kan de tegenpartij en omschrijving van je onbekende transacties door Claude laten lezen.
> Er gaat alleen tekst mee — geen bedragen, saldi, rekeningnummers of datums — en herkenbare
> IBANs, bedragen en datums worden er eerst uit gehaald. Je ziet elk voorstel en bevestigt het
> zelf. Je eigen regels gaan altijd voor.

---

## 3. Waarom hebben sommige landen geen wisselkoers

**Omdat de koerslijst van de ECB komt, en die publiceert er dertig. Van de 237 landen op de bol
hebben er 139 daardoor geen koers — meer dan de helft. Er ís een gratis bron zonder sleutel die
het gat vrijwel helemaal dicht, maar de bruikbaarste ervan verbiedt in zijn voorwaarden precies
wat LaVega ermee zou doen.**

### De meting

De ECB-referentiekoersen komen binnen via Frankfurter (`apps/server/src/fx.ts:8`), vandaag
opgehaald:

```
frankfurter datum 2026-08-21   valuta 30 (incl. EUR)
AUD BRL CAD CHF CNY CZK DKK GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR
NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR
```

Over de landen op de bol gelegd (`apps/web/src/worldMap.ts`, functie `conversionFor`):

| Wat de bol met een land kan | Aantal landen |
|---|---|
| koers bekend | 58 |
| euroland, niets te wisselen | 32 |
| **geen koers** | **139** |
| twee munten, dus eerst een keuze | 7 |
| geen wettig betaalmiddel (Antarctica) | 1 |

Dat zijn **116 verschillende valuta zonder koers**. Bekende bestemmingen die eronder vallen:
Verenigde Arabische Emiraten (AED), Marokko (MAD), Egypte (EGP), Tunesië (TND), Saoedi-Arabië
(SAR), Qatar (QAR), Vietnam (VND), Sri Lanka (LKR), Kenia (KES), Tanzania (TZS), Argentinië (ARS),
Chili (CLP), Colombia (COP), Peru (PEN), Costa Rica (CRC), Dominicaanse Republiek (DOP),
Kaapverdië (CVE), Servië (RSD), Oekraïne (UAH), Georgië (GEL), Rusland (RUB), Taiwan (TWD), en het
hele Caribisch gebied (XCD, AWG voor Aruba, XCG voor Curaçao en Sint-Maarten).

Twee daarvan wringen extra, want de Travel Agent kent de munt wél: `COUNTRY_CURRENCY` in
`packages/core/src/travel.ts:60` zet `MA → MAD` en `AE → AED`. LaVega weet dus dat je in Marokko
dirham betaalt en kan er tegelijk geen bedrag bij zetten.

### Is er een gratis bron die de ECB aanvult

Ik heb er vier geprobeerd met plain `curl`, zonder sleutel en zonder iets te omzeilen:

| Bron | Antwoord | Dekking van de 116 ontbrekende | Afwijking t.o.v. de ECB |
|---|---|---|---|
| `api.exchangerate.host` | HTTP 200, `missing_access_key` | — | — |
| `api.frankfurter.app` | HTTP 301 (verplaatst naar `.dev`) | — | de huidige bron |
| `open.er-api.com` | HTTP 200, 166 valuta | **115 van 116** (alleen KPW niet) | mediaan 0,169%, hoogste 0,66% (KRW) |
| `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api` | HTTP 200, 340 sleutels | **116 van 116** | mediaan 0,101%, hoogste 0,54% (ZAR) |

**De beste van de twee mag niet.** In de voorwaarden van ExchangeRate-API staat letterlijk:

> To further clarify, this license does not permit re-distribution of our data.

LaVega haalt niets op tijdens runtime en zou die koersen dus meebundelen bij een sweep — en
meebundelen ís herdistributie. Dat is geen technische blokkade maar een juridische, en hij geldt
ook voor de gratis laag: het document zegt er zelf bij dat de gratis en betaalde laag onder
dezelfde licentie vallen.

**De tweede mag wel, maar draagt geen bron.** `@fawazahmed0/currency-api` staat onder CC0 1.0
(gecontroleerd in de LICENSE van de repo), dus herdistributie is toegestaan, en hij dekt alle 116.
Alleen: de README noemt nergens wáár de koersen vandaan komen. Voor een app waarvan de hele
belofte "elk cijfer met bron en datum" is, is "een GitHub Action haalde het ergens op" een andere
soort cijfer dan "ECB-referentiekoers van 21-08-2026". Als hij erin komt, hoort hij een eigen,
zichtbaar zwakker label te krijgen — niet stilletjes naast de ECB-koersen te gaan staan.

**Dus: ja, technisch kan het; nee, niet zonder een besluit van jou** over welke van die twee je
accepteert. Blijft het zoals het is, dan blijft "geen koers" het eerlijke antwoord, en de bol zegt
dat nu ook met zoveel woorden in plaats van een 0% te tonen.

---

## 4. Waarom staan de ING-punten er niet

**Omdat ING geen koers per bestede euro heeft. Het programma bestaat, de regels zijn gevonden en
staan sinds vandaag in de app — maar ING beloont drempels, en van een drempel valt geen koers te
maken zonder er een te verzinnen.**

Bron: `docs/research/2026-08-20-punten-koersen.md`, uit ING's eigen pagemodel-API achter
`ing.nl/particulier/ing-punten/zo-spaar-je-ing-punten`, opgehaald 21-08-2026, plus de Voorwaarden
ING Punten geldig vanaf 1 oktober 2025.

### Waarom er geen getal kan staan

ING's tabel zegt: *"Meer dan € 100 uitgeven met je ING Creditcard Extra of Max → 250 punten per
maand."* Dat is een drempel, geen tarief. Bij € 100 zijn het 250 punten, bij € 4.000 ook. Wie door
de drempel deelt krijgt 2,5 punt per euro — een koers die niet bestaat en die bij normaal gebruik
tot een factor 40 te hoog uitvalt. Dat is dezelfde soort fout als de acht valse nullen, alleen de
andere kant op: daar werd onbekend als nul gelezen, hier zou een drempel als tarief gelezen worden.

Dezelfde vorm zit in de andere regels: € 700 instroom per maand → 250 punten; 10 transacties →
100 punten; hypotheek → 250 punten per maand; eerste betaalrekening → 2.500 eenmalig. Plus een
pakketvermenigvuldiger: More +10%, Extra +20%, Max +30%.

### Wat dat betekent voor wat LaVega kan tonen

Drie verschillende soorten uitspraken, en ze mogen niet op één hoop:

- **De verdienregels: bekend en hard.** Ze staan er nu, letterlijk in ING's eigen woorden, in
  `apps/web/src/views/Punten.tsx` (`ING_PUNTEN`) en als toelichting in
  `packages/core/src/rewards.ts:67`. `pointsPerEuro` blijft leeg — geen nul.
- **Inwisselen voor geld: een uitgesproken nul.** Uit de voorwaarden: *"ING Punten hebben geen
  geldwaarde. Je kan je ING Punten niet inwisselen voor geld en niet overdragen aan anderen."* Dat
  is een bekende nul, met bron en datum, en die mag er dus als nul staan.
- **Wat een punt in de ING Winkel aan korting oplevert: onbekend.** Die winkel zit achter Mijn
  ING; `www.ing.nl/punten/*` verbreekt de HTTP/2-stream, `r.jina.ai` levert alleen de titel omdat
  de pagina in een shadow DOM zit, en de Wayback-index heeft er alleen JS-bundles van. Drie routes
  geprobeerd, drie keer niets. ING's enige indicatie is met opzet vaag ("een paar euro korting op
  je bioscoopkaartjes"). Dat blijft onbekend.
- **De Platinumcard staat niet in ING's tabel.** Of die onder een van de regels valt is niet
  vastgesteld. Geen regel, en ook geen nul.

De euro's die je bij ING op het scherm ziet (€ 700, € 100) zijn dus ING's DREMPELS — een voorwaarde
om punten te krijgen — en niet de waarde van een punt. `apps/web/src/views/Punten.test.tsx` pint
dat verschil vast; 47 van 47 tests groen, gedraaid.

### Wat er zou moeten gebeuren om er wél een cijfer van te maken

Twee wegen, allebei zonder verzinnen:

1. **Rekenen met JOUW gedrag in plaats van met een koers.** LaVega ziet je instroom, je aantal
   transacties en je creditcardbesteding per maand. Daarmee is te zeggen: *"vorige maand haalde je
   drie van de vier drempels: 600 punten, met ING Extra 720."* Dat is geen koers, dat is een
   optelling van regels die ING zelf publiceert, en hij is per maand na te rekenen. Dit is de enige
   route die vandaag al kan.
2. **De inwisselkant meten in plaats van opzoeken.** Zodra je in de ING Winkel één artikel ziet met
   én een puntenprijs én een europrijs, is dat één waarneming van een koers. Eén is geen koers, maar
   vijf of tien over verschillende artikelen geven een bandbreedte die je mag noemen — met de datum
   en het aantal waarnemingen erbij. Dat vraagt om jou: die pagina is voor ons niet bereikbaar en we
   gaan er niet omheen werken.

Wat er níét moet gebeuren: een gemiddelde puntenwaarde uit een vergelijkingssite overnemen. Dan
staat er een cijfer dat niemand kan navertellen, op de plek waar LaVega juist belooft dat dat wel
kan.

---

## Wat is er gedraaid

| Wat | Uitkomst |
|---|---|
| `packages/core` → `vitest run src/subscriptions.test.ts` | 32 van 32 groen |
| `apps/web` → `vitest run src/views/Punten.test.tsx` | 47 van 47 groen |
| 8 Simyo-reeksen door `detectSubscriptions` + drempelketen | zie de tabel bij vraag 1 |
| 2 kandidaat-reparaties gemeten (ontdubbelen, per bedrag groeperen) | beide herstellen hun reeks |
| redactie + payload op een echte incassoregel | zie vraag 2 |
| 237 landen tegen de live ECB-lijst gelegd | 139 zonder koers |
| 4 koersbronnen met plain `curl` | 2 leveren data, 1 daarvan verbiedt herdistributie |

Niets gecommit, niets gepusht.
