# De kosten van de acht grote Nederlandse banken — vijf kaarten erbij, en zeven passen die geen prijs hébben

Zijn inschatting klopte: dit is de best gedocumenteerde groep van allemaal. Alle acht — ING,
ABN AMRO, Rabobank, SNS, ASN, RegioBank, Knab en Triodos — publiceren het EU-verplichte
**Informatiedocument betreffende de vergoedingen** of een gedateerde **Tarievenwijzer**, en die
documenten stonden al in de catalogus omdat de rekeningensweep van 21 augustus ze had gebruikt.
Alle dertien gedateerde tariefdocumenten die deze ronde zijn gelezen gaven HTTP 200 op een gewone
`curl` met browser-UA. Route 1 was op één product na genoeg — en die ene uitzondering, Knab, is
meteen de mooiste vondst.

**De uitkomst in één regel: vijf kaartrijen krijgen een prijs, zeven betaalpasrijen krijgen er
bewust géén, en de vier vastgelopen rijen zijn alle vier beantwoord — drie met "voorwaardelijke
variant", één met "de bank doet het allebei".**

De datumcategorie is deze ronde **leeg**. Niet één bedrag strandde op een ontbrekende
documentdatum. Dat is geen geluk maar het gevolg van de wet: een Informatiedocument moet een
datum dragen, en alle acht doen dat.

## De vijf die erin kunnen

| rij | bedrag | eenheid | documentdatum | bron |
|---|---|---|---|---|
| `abn-amro-betaalpas` | € 1,50 | per maand | 1 januari 2026 | Informatiedocument BasisPakket Betalen |
| `ing-creditcard` | € 2,00 | per maand | 1 januari 2026 | Informatiedocument OranjePakket |
| `ing-platinumcard` | € 4,35 | per maand | 1 januari 2026 | idem |
| `rabo-goldcard` | € 2,00 | per maand | 1 juli 2026 | Informatiedocument Rabo Standaard |
| `knab-creditcard` | € 28,00 | **per jaar** | 1 november 2025 | ICS-wijzigingspagina jaarbijdrage (Wayback) |

Knab staat in **jaren** omdat ICS de post zo noemt — *jaarbijdrage*. De andere vier staan op
maand omdat hun document ze zo zet. Er is nergens omgerekend, ook niet waar het document zelf
beide noemt: ABN drukt naast "Per maand € 1,50" ook "Per jaar € 18,00" af, en Rabobank naast
"Per maand € 2,00" ook "Totale jaarlijkse vergoeding € 24,00". Die jaarbedragen staan in de
voorwaarden en niet in het veld.

### Knab was de enige die een route nodig had

Het Informatiedocument van Knab (01-10-2025) zet bij *Aanbieden van een creditcard* de woorden
**"Dienst niet beschikbaar"**, met een voetnoot die precies zegt waarom:

> De Knab Creditcard is een product van International Card Services (ICS). Knab heeft de
> dienstverlening van de creditcard bij ICS ondergebracht. Dat betekent dat je met je creditcard
> klant bent bij ICS; alle kosten met betrekking tot je creditcard betaal je aan hen. **Daarom
> staan die kosten niet in dit overzicht.**

Dat is een weigering op de bon — en tegelijk een routewijzer. `knab.nl/tarieven` ("Tarieven per
18-02-2026") bevestigt hem: daar staan voor de Knab Creditcard alleen debetrente, geldopnamekosten
en koersopslag, en geen jaarbijdrage. Dat is een lege regel, geen nul, en dat noteerde de ronde
van 21 augustus al zo.

De winnende route was dezelfde als toen bij ASN: `icscards.nl/sitemap.xml` (1.501 URL's) op het
woord `jaarbijdrage`. Er staat er precies één voor deze groep, `faq-jaarbijdrage-verhoging-knab`,
en die is **live** — maar hij gaat inmiddels over de vólgende verhoging:

> Bekijk op deze pagina de antwoorden op vragen over de jaarbijdrage van uw Knab Creditcard **vanaf
> 1 november 2026**. […] Waarom wordt de jaarbijdrage voor de Knab Creditcard **€ 31**?

€ 31 is dus niet wat je vandaag betaalt. De Wayback-kopie van **dezelfde URL** (snapshot 15 april
2026) draagt de vorige ronde:

> …de jaarbijdrage van uw Knab Creditcard **vanaf 1 november 2025**. […] Waarom wordt de
> jaarbijdrage voor de Knab Creditcard **€ 28**?

De Wayback-timestamp is niet als datum gebruikt; alleen de ingangsdatum in de tekst telt, en dat
is 1 november 2025. Twee dingen bevestigen dat € 28 het geldende bedrag is: de live pagina zegt
zelf *"Ook de jaarbijdrage voor uw Extra Card wijzigt van € 28 in € 31"*, en `knab.nl` toont op
zijn eigen productpagina vandaag **"€ 28 per jaar"** — ongedateerd, dus niet als bron gebruikt,
alleen als bevestiging dat het cijfer niet is verschoven. De aangekondigde € 31 per 1 november
2026 staat in de voorwaarden, net als bij de ICS- en ANWB-rijen van 21 augustus.

### ABN AMRO is de enige bank die zijn betaalpas apart prijst

Zeven van de acht zeggen "de pas zit in het pakket". ABN AMRO niet:

> **Aanbieden van een betaalpas** — 1e betaalpas zonder BasisPakket Betalen | Per maand **€ 1,50**
> | Per jaar € 18,00 — extra betaalpas | Per maand € 1,50 | Per jaar € 18,00
>
> — Informatiedocument betreffende de vergoedingen, BasisPakket Betalen, *Datum: 1 januari 2026*

Het Informatieblad Betaaldiensten Particulieren (Januari 2026) zegt hetzelfde met een iets
ruimere voorwaarde: *"1e betaalpas € 1,50 per maand (Als u geen BasisPakket Betalen **of Studenten
Pakket** heeft)"*. Twee documenten, dezelfde uitgever, dezelfde maand, hetzelfde bedrag. De ruimere
lezing is aangehouden.

Dit is de spiegel van `abn-losse-betaalrekening`: ABN is de enige die zowel zijn losse rekening
(€ 4,30) als zijn losse pas (€ 1,50) een prijs geeft. **Maar de twee stapelen**, en daarom staat
`pricedOnItsOwn` op false met "bovenop de € 4,30 per maand van de losse ABN AMRO betaalrekening"
in de voorwaarden — die zin doet `isPricedOnItsOwn` in `accountCosts.ts` aanslaan. Zonder die zin
zou het scherm beweren dat een ABN-betaalpas € 1,50 per maand kost, en dat is € 4,30 te laag.

Deze rij is niet inert, en dat is nagekeken. `resolveCost` slaat rijen met `kind: "betaalpas"`
inderdaad over (`if (f.group !== "betaalrekening") continue`), dus op Optimalisatie verandert er
niets. Maar `fxRoutes.ts` roept `holdingCostOfProduct` aan voor kaartrijen, en die geeft nu
`needs-another-product` in plaats van `no-source` — het verschil tussen "wat dit kost weten we
niet" en "de prijs die de bron noemt komt bovenop de rekening van € 4,30". Dat is exact de
precisie die `merge-2026-08-24.md` bij Crypto.com miste.

### De twee ING-kaarten kwamen uit het document dat er al lag

Het Informatiedocument van het ING OranjePakket stond al in de catalogus — als bron voor de
koersopslag van `ing-platinumcard`. Op pagina 3 van datzelfde stuk staat wat er nog niet in stond:

> • Aanbieden van een creditcard
> - Creditcard **€ 2,00 per maand** — extra Creditcard € 1,25 per maand
> - Platinumcard **€ 4,35 per maand** — extra Platinumcard € 2,60 per maand

Vier bedragen, en dat is meteen het probleem — zie *Wat ik niet heb opgelost* hieronder.

### Rabo GoldCard staat er letterlijk, in een jonger document

Het Informatiedocument van Rabo Standaard (**1 juli 2026**) noemt de kaart bij naam:

> Aanbieden van een creditcard | Creditcard **[Rabo GoldCard]** | Per maand € 2,00 | Totale
> jaarlijkse vergoeding € 24,00

Dat is zeven maanden jonger dan het tarievenblad van december 2025 waar `rabobank-creditcard` zijn
€ 2,00 vandaan heeft — en het is voor déze rij de betere bron, want het december-document zet de
twee kaarten in één regel samen ("RaboCard of Rabo GoldCard € 2,00"). **Voor `rabobank-creditcard`
is het géén vervanging**: geen van beide Rabobank-Informatiedocumenten noemt de RaboCard nog. Rabo
Standaard en Rabo Comfort komen allebei met de GoldCard. Die rij is dus met rust gelaten.

## De zeven passen die geen eigen prijs hebben — en waarom daar geen nul komt

Dit is het echte werk van deze ronde, en het levert géén bedrag op. Zeven van de acht banken
zeggen in hun gedateerde document dat de eerste betaalpas **in de pakketprijs zit**:

| bank | wat het document zegt | datum |
|---|---|---|
| ING | "Met inbegrip van een dienstenpakket dat bestaat uit: […] • betaalpas" (€ 4,00/mnd) | 1 jan 2026 |
| Rabobank | "Met inbegrip van een dienstenpakket dat bestaat uit: […] • 1 Betaalpas [Rabo WereldPas]" (€ 3,45/mnd) | 1 jul 2026 |
| SNS | "SNS Basis € 4,00 […] z 1 betaalpas" | 1 feb 2026 |
| ASN | "€ 4,00 per rekening per kalendermaand. **Dit is inclusief één betaalpas.**" | 1 jul 2026 |
| RegioBank | "Aanhouden van de betaalrekening, inclusief […] een betaalpas — € 4,00 per maand" | 1 feb 2026 |
| Knab | "Met inbegrip van een dienstenpakket dat bestaat uit: […] Aanbieden van een betaalpas" (€ 6/€ 7 p/mnd) | 1 okt 2025 |
| Triodos | "Met een dienstenpakket dat bestaat uit: - Een betaalpas [Triodos Betaalpas]" (€ 0,00–€ 8,00) | mei 2026 |

Een nul invullen zou zeggen: *een ING-betaalpas is gratis*. Dat is onwaar op de enige manier
waarop het ertoe doet — de enige manier om er een te hébben is een pakket van minstens € 4,00 per
maand. `netBenefit.ts` heeft hier al een naam voor, en die staat er woord voor woord:
`needs-another-product` — *"de bron noemt wél een bedrag, maar het is de prijs van dit product
BINNEN een ander product […] het genoemde bedrag doorgeven zou een te lage prijs zijn, wat erger
is dan geen prijs."* Deze zeven horen daar, en niet in `accountFee`.

### Drie valstrikken die in deze zeven documenten liggen

**ASN.** Onder *ASN Studentenrekening en ASN Jongerenpakket* staat: "Aanbieden van een ASN
Betaalpas — **Eerste verstrekking betaalpas: € 0**". Een gedateerde, uitgesproken nul, over de
goede kaart. En toch niet bruikbaar: hij prijst het **verstrekken**, een eenmalige handeling, en
zwijgt over het **aanhouden**. Dat is precies de NIBC/Ayvens/DHB-valstrik uit de spaarronde,
alleen dan bij een pas.

**Rabobank.** Het tarievenblad van december 2025 zet in de kolom "Tarief per maand" de regel
**"Digitale betaalpas € 0,00"**. Een echte maandelijkse nul — maar voetnoot 1 zegt wat dat is:
"Betaalvormen zoals Apple Pay, Garmin Pay, Fitbit Pay en Google Pay". Dat is niet de fysieke Rabo
WereldPas waar `rabobank-betaalpas` over gaat. Dezelfde tabel prijst wél een "Betaalpas bij
KeuzePlus Hypotheek" op € 1,40 per maand; die hangt aan een hypotheek en is deze rij evenmin.

**RegioBank en Triodos.** Beide zetten "inclusief een betaalpas" bij een rekening die **€ 0,00**
kost (JongWijs, Studentenrekening, Triodos 18 t/m 22 jaar). Twee nullen naast het woord
"betaalpas" — en allebei zijn ze de prijs van de rékening. Dat is de valse nul die
`merge-2026-08-24.md` bij RegioBank heeft weggehaald door de gewone rekening van € 4,00 toe te
voegen; hij zou hier langs de andere deur weer naar binnen komen.

## Zes echte kaartprijzen zonder rij om ze op te zetten

Wat de acht wél apart prijzen is de **extra** pas. Dat zijn zes gedateerde, doorlopende
kaartprijzen die op precies één ding stranden: de catalogus kent geen rij "extra betaalpas".

| bank | bedrag | eenheid | datum |
|---|---|---|---|
| ING (voor gemachtigde) | € 1,20 | per maand | 1 jan 2026 |
| Rabobank [Rabo WereldPas] | € 1,20 | per maand | 1 jul 2026 |
| SNS (Basis en overige) | € 1,35 | per maand | 1 feb 2026 |
| ASN | € 1,35 | per kalendermaand | 1 jul 2026 |
| RegioBank | € 1,35 | per maand | 1 feb 2026 |
| Triodos (voor gemachtigde) | € 4,00 | per maand | mei 2026 |

ABN staat hier niet omdat zijn extra pas hetzelfde kost als zijn eerste (€ 1,50) en dus in de
voorwaarden van de rij hierboven past. Knab staat er niet omdat bij Knab ook de extra pas in het
pakket zit — dat is een antwoord, geen gat.

Twee dingen die opvallen en die de eigenaar zou willen weten. Het bedrag hangt niet aan de bank
maar aan het **pakket**: bij SNS Compleet en bij Rabo Comfort is dezelfde extra pas € 0,00. En
**Triodos is drie keer zo duur** als de rest — € 4,00 per maand voor een pas voor een gemachtigde
is evenveel als de hele Triodos-rekening voor iemand van 23 t/m 25.

## De vier vastgelopen rijen, beantwoord

De vraag was: is dit een **apart product** of een **voorwaardelijke variant**? En het antwoord
moest komen van wat de bank zelf doet. Drie van de vier zijn eenduidig.

### RegioBank — variant, en dit is de duidelijkste

RegioBank zet één kop en daaronder twee bullets, en die bullets zijn geen kaarten maar
**rekeningen**:

> **RegioBank Creditcard** — Aanbieden van **de** RegioBank Creditcard door ICS
> • Betaalrekening Plus Betalen € 37,50 per jaar
> • Studentenrekening € 27,50 per jaar

De prijs hangt aan de rekening; de kaart is er één. De productpagina zegt het in één zin: *"De
creditcard kost € 37,50 per jaar en voor studenten € 27,50 per jaar."* Geen eigen naam, geen eigen
pagina, geen eigen voorwaarden. **Geen tweede rij.** Het bedrag staat al waar het hoort: in de
voorwaarden van `regiobank-creditcard`.

### SNS — variant, en de bank zegt het in het woordje "bij"

> Aanbieden van een creditcard — SNS Creditcard (jaarlijkse kosten) € 37,50 — SNS Creditcard **bij**
> Studentenrekening (jaarlijkse kosten) € 27,50

Eén kop, één kaartnaam, twee prijzen, en het verschil is de rekening ernaast. De productpagina:
*"De creditcard van ICS kost elk jaar € 37,50. […] Heb je een SNS Jongeren- of Studentenrekening?
Dan betaal je € 27,50 per jaar."* **Geen tweede rij.**

Er is nog een argument dat uit de code komt en dat de zaak beslist: `isPricedOnItsOwn` in
`accountCosts.ts` zet `pricedOnItsOwn` op false zodra de **productnaam** het woord "bij" bevat. De
naam die de staging voorstelde — "SNS Creditcard bij Studentenrekening" — zou de rij dus meteen
markeren als "hangt aan een ander product". Dat is precies wat hij is, en dan hoort hij ook niet
als los product te bestaan.

(Kleine afwijking, genoteerd: de Tarievenwijzer noemt alleen de Studentenrekening, de productpagina
noemt "Jongeren- of Studentenrekening". Het gedateerde document is de smalste en is aangehouden.)

### Openbank — variant, en er valt niets te repareren

Openbank sluit de vraag zelf in één zin:

> **Het pasnummer, de geldigheidsdatum en de CVC zijn in beide gevallen dezelfde**, d.w.z. ongeacht
> of Travel+ wel of niet is ingeschakeld.
>
> — Standaard precontractueel informatiedocument, Я42 Betaalpas, *Geldig vanaf 01-07-2024*

Zelfde pasnummer, zelfde vervaldatum, zelfde CVC, twee kolommen in één tabel: "Travel + uitgeschakeld
€ 0" en "Travel+ ingeschakeld € 4,99/maand". Het is niet eens een tweede kaart die hetzelfde heet —
het is dezelfde plastic met een schakelaar. En *"Wanneer de Pas geleverd wordt, zijn de voordelen
uitgeschakeld"*, dus € 0 is de stand waarin je hem krijgt.

**Deze rij hoeft niet gebouwd te worden en hoeft ook niet meer op de lijst.**
`openbank-betaalpas-r42-betaalpas` draagt vandaag al `accountFee € 0,00 per maand` met in de
voorwaarden "met Travel+ ingeschakeld € 4,99 per maand". Dat is de juiste vorm. Eén ding ontbreekt
er nog: voetnoot 1 zegt *"Deze abonnementskosten zijn niet van toepassing op de eerste Betaalpas in
het geval een klant recht heeft op Travel+ voor altijd gratis"* — een vrijstelling waarvan de
voorwaarde in dit document niet staat.

### ABN AMRO — hier doet de bank het allebei, en de twee spreken elkaar tegen

Dit is de enige van de vier waar het antwoord niet eenduidig is, en dat komt doordat ABN AMRO twee
verschillende dingen zegt.

**Het tariefdocument zegt variant.** De regel heet gewoon "ABN AMRO Credit Card" — dezelfde naam
als de kaart van € 2,55 — en staat binnen het blok *Studenten Pakket*: "ABN AMRO Credit Card €
1,31 per maand (€ 15,72 per jaar)". Eén kaart, twee prijzen, verschil is het pakket. Precies SNS.

**De website zegt apart product**, en niet zwakjes: een eigen naam ("ABN AMRO Studenten Card",
elders "ABN AMRO Studentencreditcard"), een eigen menu-item onder *Studeren*, een eigen pagina
("Meer over de Studenten Creditcard"), een eigen aanvraagknop, een eigen inkomenseis (€ 500 per
maand tot 25 jaar in plaats van € 1.500), en een eigen antwoord in de FAQ op de vraag "Wat is het
verschil tussen de ABN AMRO Creditcard, de ABN AMRO Gold Card en de ABN AMRO Studentencreditcard?":

> De ABN AMRO Studentencreditcard heeft een **lager limiet** maar dezelfde basisverzekering.

Dat is het scherpste onderscheid van de vier: bij SNS, RegioBank en Openbank verschilt alleen de
**prijs**, hier verschilt ook de **kaart**. Een lagere limiet en een eigen inkomenseis zijn
producteigenschappen en geen tariefvoorwaarde.

**Mijn aanbeveling is toch: nog geen rij, en wel om deze reden.** De twee bestaande
ABN-creditcardrijen worden uit elkaar gehouden op hun koersopslag; een derde rij zou dezelfde 2%
dragen als `abn-amro-creditcard` en is dan alleen nog op naam te onderscheiden. Zolang
`catalogueProductFor` een voorwaardelijke variant niet kan onderscheiden van een apart product,
levert de rij een ambiguïteit op waar hij een prijs zou moeten leveren. Het bedrag staat vandaag
in de voorwaarden van `abn-amro-creditcard` en dat is de goede plek tot dat onderscheid bestaat.

Als de eigenaar besluit dat het onderscheid er moet komen, is **dit de eerste rij die er baat bij
heeft** — en de enige van de vier, want de andere drie zijn dan nog steeds varianten.

## Wat ik niet heb opgelost, en het is de grootste vondst van deze ronde

**De ING-catalogus draagt zijn creditcards vermoedelijk dubbel.**

Twee levende ING-documenten kennen elkaars kaartnamen niet:

| Informatiedocument, 1 januari 2026 | Kostenoverzicht, 15 juni 2026 |
|---|---|
| Creditcard **€ 2,00** | ING Creditcard More **€ 2,00** |
| extra Creditcard **€ 1,25** | extra ING Creditcard More **€ 1,25** |
| Platinumcard **€ 4,35** | ING Creditcard Extra **€ 4,35** |
| extra Platinumcard **€ 2,60** | additionele ING Creditcard Extra **€ 2,60** |

Vier bedragen, paarsgewijs identiek. En het is niet alleen de prijs: de koersopslagclausule van de
Platinumcard ("0% voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00%") is
woordelijk de clausule van de ING Creditcard Extra in het andere document, en de opnamelimiet is
in beide gevallen € 1.000 in plaats van € 400.

De catalogus kent **vijf** ING-creditcardrijen: `ing-creditcard`, `ing-platinumcard`,
`ing-creditcard-more`, `ing-creditcard-extra` en `ing-creditcard-max`. Als ING alleen heeft
hernoemd — en daar wijst alles op, met het Informatiedocument als het oudere OranjePakket-document
en het Kostenoverzicht als het nieuwe — dan zijn dat er in werkelijkheid drie.

**Ik heb hier niets aan gedaan.** Rijen samenvoegen is een beslissing en geen meting, en het raakt
`state.json`, waar deze lane niet aan mag komen. De vijf rijen staan er alle vijf nog, en
`ing-creditcard` en `ing-platinumcard` krijgen in de staging gewoon hun bedrag — met de
naamoverlap letterlijk in hun voorwaardentekst, zodat de volgende hem niet opnieuw hoeft te vinden.

Nog twee dingen van dezelfde soort, kleiner:

- **RegioBank zegt op zijn eigen creditcardpagina: "Goed om te weten: je krijgt een ASN
  Creditcard."** `regiobank-creditcard` en `asn-creditcard` zijn dus mogelijk dezelfde kaart. Op
  dit moment onschadelijk — ze staan allebei op € 37,50 per jaar — maar het is dezelfde soort
  dubbeling als bij ING.
- **De ICS-verhoging van 1 november 2026 komt er aan.** Knab gaat van € 28 naar € 31. De ASN-, SNS-
  en RegioBank-kaarten in de catalogus staan op € 37,50 uit november 2025 respectievelijk februari
  2026. Er is vandaag geen ICS-wijzigingspagina voor die drie in `sitemap.xml`, dus er is niets te
  melden — maar dit is de plek om in oktober te kijken.

## Routes: wat werkte

- **Route 1, het gedateerde tariefstuk** — dertien van de dertien documenten, alle HTTP 200 op een
  gewone `curl` met browser-UA. Vier daarvan zijn een `.html`-pad dat een PDF-body serveert
  (`snsbank.nl/downloads/…`, `asnbank.nl/downloads/…`, `regiobank.nl/downloads/…`,
  `triodos.nl/downloads/…?id=…`); `pdftotext -layout` erop en klaar. Het ABN-Informatieblad is
  tweekoloms en moet met `-layout` gelezen worden, anders lopen de tariefregels van de linker- en
  rechterkolom door elkaar.
- **Route 4, Wayback CDX** — één keer, en beslissend: de Knab-jaarbijdrage van € 28. Eén snapshot
  beschikbaar (15 april 2026), HTTP 200, geen 429 deze keer.
- **Routes 2 en 3** — niet nodig geweest.
- **Botdetectie** — één keer: `rabobank.nl/particulieren/betalen/…/kosten-voorwaarden` geeft
  **HTTP 403** op curl met browser-UA. Genoteerd, niet omzeild, en niet nodig: `media.rabobank.com`
  levert alle Rabobank-documenten wel gewoon. Verder nergens een blokkade — niet bij assets.ing.com,
  assets.abnamro.com, snsbank.nl, asnbank.nl, regiobank.nl, triodos.nl, knab.nl, icscards.nl of
  openbank.nl.

## De telling

| | aantal |
|---|---|
| **Gevonden** — een doorlopend maand- of jaarbedrag bij een product van deze groep dat nog geen `accountFee` is | **15** |
| Daarvan **door de toelatingseis** (waarde + bron + datum + voorwaarden) | **15** |
| **Stranden op ALLEEN de datum** | **0** |
| **Stranden op iets anders** | **10** |
| **Voorgesteld voor `entries`** | **5** |

De vijftien dragen alle vier de onderdelen. Dat de datumcategorie leeg is, is de kern van deze
groep: elk van deze acht banken publiceert een wettelijk verplicht, gedateerd document, en dat
document staat sinds 21 augustus al in de catalogus. Er was hier niets te zoeken — alleen te lezen
en toe te wijzen.

De tien die buiten blijven, met per stuk de reden:

| wat | bedrag | waarom niet |
|---|---|---|
| ING extra betaalpas gemachtigde | € 1,20/mnd | geen catalogusrij "extra betaalpas" |
| Rabobank extra betaalpas | € 1,20/mnd | idem; bovendien € 0,00 in Rabo Comfort |
| SNS extra betaalpas | € 1,35/mnd | idem; drie bedragen naar pakket |
| ASN extra betaalpas | € 1,35/kal.mnd | idem |
| RegioBank extra betaalpas | € 1,35/mnd | idem |
| Triodos extra betaalpas gemachtigde | € 4,00/mnd | idem |
| SNS Creditcard bij Studentenrekening | € 27,50/jr | voorwaardelijke variant — hoort in de voorwaarden van `sns-creditcard`, waar hij staat |
| RegioBank Creditcard bij Studentenrekening | € 27,50/jr | idem, bij `regiobank-creditcard` |
| Openbank betaalpas met Travel+ | € 4,99/mnd | voorwaardelijke variant — zelfde pasnummer, zelfde CVC; staat al in `openbank-betaalpas-r42-betaalpas` |
| ABN AMRO Studenten Creditcard | € 1,31/mnd | apart product volgens de website, variant volgens het tariefdocument; wacht op het onderscheid in `catalogueProductFor` |

En daarnaast, buiten de telling omdat er geen bedrag is gevonden maar wel een antwoord: **zeven
betaalpasrijen** waarvan het gedateerde document zegt dat de pas in de pakketprijs zit, en **vier
schone negatieven** (Triodos heeft geen creditcard, Knab noemt zijn jaarbijdrage niet in eigen
documenten, de ING Studenten Creditcard More heeft in geen enkel ING-document een cardfee, en
rabobank.nl geeft 403).

## Wat dit voor het scherm betekent

Deze acht banken hebben samen **21 kaartrijen** in de catalogus. Negen daarvan dragen vandaag een
`accountFee`; met deze staging worden het er **veertien**. De overige zeven zijn precies de zeven
betaalpassen die in hun pakket zitten — die krijgen geen bedrag, maar wel voor het eerst een reden.
Daarmee is er geen kaartrij in deze groep meer over met een leeg veld en geen verklaring.

De vijf nieuwe komen alle vijf binnen met `pricedOnItsOwn: false`, en dat is geen verlies maar de
hele winst. Reizen zegt straks niet meer "wat dit product kost, staat niet in onze bronnen" maar
"de prijs die de bron noemt komt bovenop de rekening" — met het bedrag van die rekening erbij, uit
een rij die de catalogus al draagt.

---

Bestanden: `docs/catalog/staging-kosten-grootbanken.json` (de vondsten, vijf lijsten die apart
gelezen moeten worden — `entries`, `pasZitInHetPakket`, `extraPasZonderRij`,
`strandtOpRijtoewijzing` en `schoneNegatieven`). `docs/catalog/catalog.json` en
`docs/catalog/state.json` zijn niet aangeraakt; samenvoegen is een aparte stap met zijn eigen
toelatingspoort.
