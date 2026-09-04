# De negen spaarrekeningen alsnog dateren

Vervolg op `2026-08-22-spaarrekening-kosten.md`, dat negen uitgesproken nullen
vond en er nul in de catalogus kreeg, om één reden: productpagina's zonder eigen
datum. De opdracht was het gedateerde stuk zoeken zonder dat er een bedrag
verandert — hetzelfde verificatiewerk dat op 21 augustus 18 van de 21
rekeningkosten alsnog binnenhaalde.

**Uitkomst: van de negen zijn er vier compleet, drie stranden op een preciezer
probleem dan "geen datum", en twee stranden nog steeds op de datum. Er kwamen
drie rijen bij die niet in de negen zaten, waarvan één rij die op 22 augustus
juist was afgewezen.** Zeven rijen zijn dus klaar voor de toelatingspoort, tegen
nul op 22 augustus. Geen enkel bedrag is herzien; er is alleen een document bij
gezocht dat mag worden geciteerd.

Alles staat in `docs/catalog/staging-spaarkosten.json`. `catalog.json` is niet
aangeraakt.

## Het onderscheid dat deze ronde erbij maakte

Op 22 augustus was de zeef: is het een echte nul of een gratis webinar? Die zeef
haalde vijf treffers eruit. Bij het dateren blijkt er een tweede zeef nodig, en
die kost vier van de negen rijen.

`accountFee` is de **doorlopende** prijs van het aanhouden van een rekening —
dat is wat de rentemodule van het rendement aftrekt. Vier gedateerde documenten
zeggen wél "geen kosten", maar over een **andere kostenpost**: het openen, het
opnemen of het opzeggen. Dat is dezelfde soort fout als de Trade Republic-treffer
van 22 augustus, die over de betaalrekening ging in plaats van de spaarrekening:
de goede woorden, het verkeerde tarief. Een openingsnul doorgeven als
maandprijs zou een cijfer beweren dat in geen enkel document staat.

Vandaar drie bakken in het staging-bestand in plaats van twee:

| bak                             | wat het is                                                                |
| ------------------------------- | ------------------------------------------------------------------------- |
| `entries`                       | gedateerde nul voor het **aanhouden** — samen te voegen                   |
| `gedateerdMaarAndereKostenpost` | gedateerde nul, maar voor openen/opnemen/opzeggen — **geen** `accountFee` |
| `strandtOpDatum`                | nul voor het aanhouden staat er, het document draagt geen datum           |

## Wat erin ging: 7 rijen

| catalogusrij                            | waarde | datum      | document                                                 |
| --------------------------------------- | ------ | ---------- | -------------------------------------------------------- |
| `santander-consumer-bank-spaarrekening` | € 0,00 | 2026-07-23 | Tarieven en Intresten (PDF, `TINL20260723`)              |
| `argenta-internetspaarrekening`         | € 0,00 | 2025-09    | Algemene voorwaarden De Argenta spaarrekening (PDF)      |
| `lloyds-bank-spaarrekening`             | € 0,00 | 2024-12-15 | Voorwaarden Lloyds Bank Sparen (PDF), artikel 3          |
| `openbank-welkom-spaarrekening`         | € 0,00 | 2023-06-14 | eigen page-data JSON, FAQ-node                           |
| `openbank-open-spaarrekening`           | € 0,00 | 2023-02-28 | eigen page-data JSON, FAQ-node                           |
| `nexent-bank-spaarrekening`             | € 0,00 | 2026-07-02 | Tarieven en Renteoverzicht (PDF), § 3                    |
| `brand-new-day-de-spaarrekening`        | € 0,00 | 2025-02-25 | Kosten spaarrekening, `dateModified` in de eigen JSON-LD |

Vier daarvan komen uit de negen (Santander, Argenta, Lloyds, Openbank Welkom).
Drie zaten er niet in: Openbank Open, Nexent Bank en Brand New Day.

### De drie sterkste vondsten, en waarom ze sterk zijn

**Santander — de tarievenwijzer die precies de goede kostenpost noemt.**
`santanderconsumerbank.nl/nl/documenten` draagt een volledig gedateerd archief:
elke versie van "Tarieven en interesten" en van de "Informatiefiche
spaarrekening" staat er met datum in de linktekst, terug tot 18-12-2023. De
huidige draagt rechtsboven `23/07/2026` en in de voettekst het versiestempel
`TINL20260723`, en zegt onder het kopje "1. Spaarrekening" letterlijk:
"Beheerskosten: Openen, sluiten, beheer: GRATIS". Dat is niet één van de drie
maar alle drie tegelijk, en "beheer" is precies het woord dat de doorlopende
kosten dekt. Dit is het model waarnaar de andere acht zijn gezocht.

**Argenta — een voorwaardendocument met een eigen artikel over kosten.**
`Argenta_Voorwaarden_spaarrekening.pdf` draagt op alle twaalf pagina's de
voettekst "De Argenta spaarrekening - September 2025" en zegt het twee keer:
in de samenvatting ("Welke kosten zijn er? De Argenta spaarrekening kost
niets.") en in artikel 1.7 ("De kosten. Er zijn geen kosten voor jouw
spaarrekening."). Geen doorverwijzing naar een tarievenlijst — het bedrag staat
in het gedateerde stuk zelf.

**Lloyds — het enige document dat de vraag als kopje voert.** Artikel 3 heet
"Wat zijn de kosten van de spaarrekening?" en antwoordt: "U hoeft ons niets te
betalen om uw spaarrekening te openen en te gebruiken. (…) Ook zijn al onze
standaarddiensten voor het online bekijken en beheren van uw spaarrekening
gratis." De omslag zegt "Versie december 2024" en de spaarvoorwaarden zelf
"Geldig vanaf 15 december 2024"; die laatste is aangehouden, want dat is de
datum die aan dít onderdeel hangt.

### De asterisk bij Openbank, uitgezocht

`2026-08-22` zette bij Openbank Welkom "let op de asterisk". Die is nagelopen en
hij hangt **niet aan het woord gratis**. In de eigen page-data van de pagina
staat de voetnoot voluit: "*Voorbeeld rente-uitkering over de eerste zes maanden
bij een startsaldo van € 10.000,00 en 2,80% jaarlijkse nominale rente: € 139,65
bruto." Het sterretje hoort dus bij het rentepercentage en bij de looptijd van
zes maanden, niet bij de prijs. De prijszin staat er ongekwalificeerd naast:
"Aan het openen, aanhouden of opzeggen van de Welkom spaarrekening zijn geen
kosten of commissies verbonden."

### Openbank Open Spaarrekening: op 22 augustus terecht afgewezen, nu terecht binnen

Deze rij was één van de vijf afvallers omdat de treffer in een **URL-pad** zat
(`/gratis-spaarrekening`) en niet in een zin. Die afwijzing was juist. In de
page-data van diezelfde pagina staat echter wél een zin, in een FAQ-knoop met
een eigen datum: "Het openen, aanhouden en opzeggen van je Openbank
Spaarrekening is gratis." Een tweede knoop op dezelfde pagina zegt het opnieuw
("Helemaal gratis — Het openen, aanhouden en opzeggen van je spaarrekening is
volledig gratis", `changed` 2025-04-30). De rij komt dus niet binnen omdat de
afwijzing fout was, maar omdat er nu een zin en een datum zijn waar toen alleen
een URL was.

### Twee soorten datum, en waarom ze uit elkaar staan

Vier van de zeven dragen een datum die de lezer op het papier ziet staan
(`in-document`). Drie dragen een datum uit de eigen JSON van de site
(`cms-datum`): de twee Openbank-rijen uit de `changed` van de Drupal-knoop in
`page-data.json`, en Brand New Day uit `dateModified` van de JSON-LD
`WebPage`-knoop van precies deze URL. Elke `entry` draagt daarom een veld
`datumSoort`, zodat de samenvoegende lane die twee desgewenst kan scheiden.

Dat de tweede soort meetelt is niet nieuw: de kaartkostenronde van 22 augustus
schreef in haar eigen legenda "Bij helpcentra en CMS-pagina's is dat de
updatedAt/lastUpdated uit de eigen JSON van de site" en nam op die grond vier
kaarten op. Het is ook niet hetzelfde als de PDF-metadata die op 21 augustus is
geweigerd: een `ModDate` is een eigenschap van het bestand, terwijl deze datums
door de aanbieder aan de inhoudsknoop zelf hangen en met de tekst meeverhuizen.
Wie strenger wil zijn, laat `datumSoort: "cms-datum"` buiten de merge en houdt
vier rijen over.

### Geen enkele bron hangt een periode aan de nul

Geen van de zeven documenten zegt "€ 0 per maand" of "€ 0 per jaar" — ze zeggen
"gratis" of "geen kosten". `readPeriod` weigert een rij zonder eenheid, en
terecht: bij een bedrag scheelt de verkeerde eenheid een factor twaalf. **Bij
nul scheelt hij niets**, want 0 × 12 = 0. De eenheid staat daarom op
`EUR per maand` — de eenheid waarin de andere doorlopende kosten in de catalogus
staan — en elke `entry` zegt in zijn `conditions` dat het document zelf geen
periode noemt. Dit volgt de Wirex-rij van 22 augustus, die om dezelfde reden op
maand staat.

## Wat gedateerd is maar een andere kostenpost prijst: 4 rijen

Deze vier hebben een gedateerd document én een uitgesproken nul, en horen tóch
niet als `accountFee` in de catalogus.

**`nibc-spaarrekening` en `nibc-kwartaalspaarrekening` —
"Voorwaarden Sparen per 20 juni 2026" (PDF).** Het document noemt het woord
"kosten" zeven keer. Drie daarvan zijn nullen: "Aan het openen van je rekening
zijn geen kosten verbonden", "er worden geen kosten in rekening gebracht" (bij
opzeggen) en "Wij brengen geen kosten in rekening voor het beëindigen van de
rekening". Over het aanhouden zegt het niets. De productpagina's zeggen "Geen
minimum inleg. Geen kosten" en dragen geen datum. Twee details die het beeld
compleet maken: de openingszin is **nieuw in juni 2026** — de versies van
januari 2025 en januari 2026 hebben hem niet, die noemen "kosten" maar één keer
— en de inhoudsopgave heeft geen kostenhoofdstuk. NIBC prijst zijn spaarrekening
dus nergens gedateerd; het prijst er twee handelingen omheen.

**`ayvens-bank-flexibel-sparen` — "Voorwaarden Online Spaarrekening, Juli 2026"
(PDF).** Eén nul: "Aan het openen van een Online Spaarrekening zijn geen kosten
verbonden." De inhoudsopgave (vijf hoofdstukken, 26 artikelen) kent geen artikel
over kosten. De zin uit de meting van 22 augustus — "opent u een gratis Online
Spaarrekening" — gaat bij nalezen over dezelfde handeling: openen.

**`dhb-bank-saveonlinerekening` — "Voorwaarden DHB S@veOnlinerekening" (PDF).**
Deze zat niet in de negen en komt hier binnen als vierde van deze soort. Drie
nullen: openen, opnemen ("U mag altijd uw spaargeld opnemen. Aan het opnemen
zijn geen kosten verbonden") en beëindigen. Over het aanhouden niets. Let op de
datum: het URL-pad heet `...-30-september-2025`, maar het document zelf zegt
"Deze voorwaarden zijn geldig vanaf 1 juli 2026". De datum ín het stuk telt, dus
2026-07-01.

Als de eigenaar besluit dat een nul voor openen én opnemen én opzeggen samen
genoeg is om ook het aanhouden op nul te zetten, dan is DHB de eerste die
alsnog binnenkomt, gevolgd door NIBC (openen + opzeggen) en Ayvens (alleen
openen). Die volgorde is de sterkte van het bewijs.

## Wat nog steeds op de datum strandt: 2 rijen

**`bigbank-flexibel-sparen` — het bedrag staat in een prijslijst zonder datum.**
Dit is de ICS-situatie van 21 augustus, maar zonder de uitweg die ICS had. De
twee gedateerde stukken — "Algemene Voorwaarden van Bigbank AS" en "Algemene
Voorwaarden van de Flexibel Sparen Overeenkomst", allebei "geldig vanaf
15 oktober 2025" — definiëren de Prijslijst ("een document van de Bank met het
overzicht van de tarieven") en verwijzen er voor de bedragen naar door, precies
zoals artikel 8.1 van ICS naar "de Documentatie" verwees. De Prijslijst zelf
draagt alle nullen die je maar wilt ("Flexibel Sparen: Kosten voor het openen
van een rekening € 0 · Rekening beëindiging € 0 · Jaarlijkse kosten € 0 ·
Administratiekosten € 0 / maand · Opnamekosten € 0 / opname · Bankafschrift
Gratis") en nergens een datum. Waar ICS een wijzigingspagina per kaart had, heeft
Bigbank die niet: de enige gedateerde aankondiging op de site
(`/blog/nieuwe-algemene-voorwaarden-vanaf-31-maart-2024/`, "Gepubliceerd
15 maart 2024") somt de wijzigingen op zonder één bedrag te noemen. Wayback CDX
over het hele domein op `prijs|price|tarief` levert één URL op, uit 2012.

De Prijslijst is trouwens alleen met JavaScript te lezen; `curl` krijgt een lege
Nuxt-schil, `r.jina.ai` krijgt de tabel wel. Dat is een leesprobleem, geen
datumprobleem.

**`triodos-bank-internet-sparen` — de gedateerde stukken zwijgen erover.**
Triodos heeft een voorbeeldig gedateerd documentenhuis: "Kenmerken Triodos
Internet Sparen · mei 2026" (productblad, precies dit product) en "Voorwaarden
Sparen · mei 2026", plus van allebei de vorige versie met "geldig tot 1 juli
2026" in de naam. Geen van beide noemt een prijs voor het aanhouden. De
Kenmerken noemen één bedrag in het hele stuk — "€ 2,20 per afschrift" voor
papieren afschriften — en de Voorwaarden hebben in 36 artikelen geen
kostenartikel, alleen "zonder kosten opzeggen" (9.2 en 9.3). De vorige Kenmerken
(november 2025) zwijgen net zo goed. De nul staat wél in een FAQ ("Wat betaal ik
voor een particuliere spaarrekening bij Triodos Bank? — Een spaarrekening bij
Triodos Bank is gratis."), maar die pagina draagt geen datum, en anders dan bij
Openbank en Brand New Day staat er ook geen datumveld in de HTML: geen JSON-LD,
geen `dateModified`, geen eigen JSON. Zwijgen is hier dus geen nul — een
document dat één prijs noemt en de rest onbenoemd laat, draagt geen conclusie
over de rest.

De zin uit de meting van 22 augustus, "een gratis spaarrekening bij Triodos Bank
openen", gaat bovendien over openen. Zelfs met een datum erbij zou hij in de
vorige bak zijn geland.

## Wat er verder is nagekeken

Buiten de negen is doorgezocht zolang er vooruitgang was. Dat leverde drie rijen
op (Nexent, Brand New Day, en DHB in de tweede bak). De rest van wat is
opengeslagen, met wat het opleverde:

- **`ING_Kostenoverzicht-betaalproducten-particulieren` (15 juni 2026)** — het
  document dat op 21 augustus vier ING-pakketten dateerde. Het prijst de Oranje
  Spaarrekening **niet**: sparen komt er alleen in voor als pakketvoordeel
  ("0,50% extra spaarrente"). Geen bruikbare rij.
- **Nationale-Nederlanden, "Productvoorwaarden Internetsparen", Datum 1 augustus
  2026** — keurig gedateerd, twaalf artikelen, en geen kostenartikel. Het woord
  "gratis" komt één keer voor, over de NN App.
- **Centraal Beheer, "Voorwaarden RentePlús Rekening augustus 2025"** — gedateerd
  op elke pagina, maar noemt geen nul; wel dat de bank in bepaalde situaties
  "administratiekosten in rekening" mag brengen. Dat is het tegenovergestelde van
  een uitgesproken nul.
- **Knab, tarievenpagina** — de spaarsectie noemt alleen rentes en de
  opnamekosten van een deposito. Belangrijker: Flexibel Sparen zit **binnen een
  pakket** ("de saldolimiet geldt voor het totale saldo van alle Flexibele
  Spaarrekeningen binnen je pakket") en dat pakket kost € 6 per maand. Ook mét
  een gedateerde nul zou deze rij `pricedOnItsOwn: false` moeten zijn — de
  tijdelijke actie "12 maanden gratis" die op 22 augustus is afgewezen, zit op
  dat pakket.
- **Trade Republic** — de afwijzing van 22 augustus is bevestigd op de eigen
  payload-JSON: "We rekenen geen kosten voor onze betaalrekening" staat er nog
  steeds, en de rentesectie noemt geen prijs voor het kassaldo.
- **ABN AMRO** — ook bevestigd: de enige "gratis" op de spaarrentepagina is het
  "Gratis oriëntatiegesprek" in de pensioennavigatie.
- **SNS, RegioBank, Trading 212, N26** — opgehaald (HTTP 200), geen kostenzin op
  de pagina en geen datumveld in de HTML. Dat komt overeen met de meting van
  22 augustus, die deze vier niet als treffer had.
- **bunq** — het helpartikel over MassInterest draagt geen datum en geen
  datumveld. De spaarrekening zit bovendien in een abonnement (Free/Core/Pro/
  Elite), dus dit wordt hoe dan ook een `pricedOnItsOwn`-vraag.

## Wat een antwoord gaf zonder inhoud te geven

Vier hosts weigerden. Er is niets omzeild; de status is genoteerd zoals hij was.

| host             | status            | wat er is opgevraagd                     |
| ---------------- | ----------------- | ---------------------------------------- |
| `rabobank.nl`    | HTTP 403          | actuele spaarrentes                      |
| `revolut.com`    | HTTP 403          | precontractuele informatie spaarrekening |
| `klarna.com`     | HTTP 202, 0 bytes | productpagina Flex rekening              |
| `garantibank.nl` | HTTP 403          | Gouden Internet Rekening                 |

De 403 van Revolut is de vervelendste, want `state.json` noemt voor die rij een
`docDate` van 2026-07-09 op precies dat precontractuele stuk — het bestaat en het
is gedateerd, het is vandaag alleen niet te lezen zonder botdetectie te omzeilen.
Dat gebeurt niet.

## Routes: wat werkte en wat niet

- **Gedateerd tarievenarchief van de aanbieder zelf** — de beste route, en de
  enige die zowel het bedrag als de datum in één stuk levert. Werkte bij
  Santander (`/nl/documenten` met de datum in elke linktekst) en Nexent
  (`Tarieven en Renteoverzicht`, "Geldig vanaf 02.07.2026 tot nader order").
- **Voorwaarden met een kostenartikel** — werkte bij Argenta (1.7) en Lloyds
  (artikel 3). Werkte níet bij NIBC, Ayvens, DHB, Triodos, NN en Centraal Beheer:
  die documenten zijn wél gedateerd, maar prijzen het aanhouden niet.
- **Voorwaarden die naar een tarievenlijst doorverwijzen** — dood spoor, precies
  als bij ICS op 21 augustus. Bigbank strandt hierop.
- **Eigen JSON van de site** — leverde drie rijen. Gatsby `page-data.json` bij
  Openbank (Drupal-knopen met `changed`/`created` per FAQ en per highlight) en
  JSON-LD `WebPage.dateModified` bij Brand New Day. Nagekeken en leeg bij Bigbank,
  NIBC, Ayvens, Triodos, Lloyds, Argenta, Santander, SNS, RegioBank, Trading 212,
  N26 en bunq: geen van die pagina's draagt een datumveld.
- **`r.jina.ai`** — onmisbaar bij Bigbank, waar de documentenlijst en de
  Prijslijst client-side worden ingeladen en `curl` een lege schil krijgt. Het
  loste daar het leesprobleem op, niet het datumprobleem.
- **Een `.html`-pad dat een PDF serveert** — drie keer voorgekomen: de
  Triodos-downloads (`/downloads/kenmerken-internet-sparen?id=…`), de
  NN-downloads (`/Download/….htm`) en de Santander-documenten
  (`/nl/document/…pdf` zonder extensie). Sniffen op `%PDF-` en `pdftotext
-layout` was elke keer het antwoord.
- **Wayback CDX** — twee keer geprobeerd (Bigbank op prijslijsten, Ayvens/
  LeasePlan op tariefdocumenten) en beide keren niets bruikbaars: bij Bigbank één
  URL uit 2012, bij LeasePlan alleen productvoorwaarden uit 2011 die het huidige
  product niet meer beschrijven. Geen enkele Wayback-timestamp is als datum
  gebruikt.
- **Sitemaps** — de goedkoopste eerste stap, en bij vier banken de enige manier
  om het documentenhuis te vinden (Triodos 2.082 URL's, NIBC 735, Ayvens 344,
  Argenta 175). Let op de naamruimte: Triodos serveert `<ns2:loc>` in plaats van
  `<loc>`, wat een naïeve grep leeg laat teruggeven.
- **WebSearch** — niet beschikbaar geweest: het budget van de sessie was op bij
  de eerste poging (200 van 200). Alles hierboven is met `curl`, sitemaps,
  `r.jina.ai`, Wayback CDX, `jq`/Python en `pdftotext` gevonden.

## Telling

Van de negen van 22 augustus:

|                                                      | aantal | rijen                                                  |
| ---------------------------------------------------- | ------ | ------------------------------------------------------ |
| gedateerd en compleet                                | **4**  | Santander, Argenta, Lloyds, Openbank Welkom            |
| gedateerd, maar de nul geldt openen/opnemen/opzeggen | **3**  | NIBC Spaarrekening, NIBC Kwartaalspaarrekening, Ayvens |
| nul voor het aanhouden, document zonder datum        | **2**  | Bigbank, Triodos¹                                      |

¹ Triodos is de enige rij die in beide laatste bakken past en staat in de
tweede. De gedateerde Triodos-stukken (Kenmerken mei 2026, Voorwaarden Sparen
mei 2026) zwijgen over het aanhouden; de zin die het wél dekt — "Een
spaarrekening bij Triodos Bank is gratis" — bestaat, maar ongedateerd. Dat is
letterlijk het probleem van 22 augustus, en het is de bak waar één gedateerd stuk
de rij alsnog binnenhaalt. De openingszin uit de meting ("een gratis
spaarrekening … openen") zou in de eerste bak vallen en levert niets op.

Erbij gekomen buiten de negen: **3** rijen — Openbank Open Spaarrekening en
Nexent Bank in `entries`, DHB Bank in `gedateerdMaarAndereKostenpost`.

**Stand: 7 rijen klaar voor de merge, 4 met een gedateerde nul voor de verkeerde
kostenpost, 2 met de goede nul zonder datum.** Van de 34 spaarproducten zijn er
daarmee 7 geprijsd en 27 nog niet. Van die 27 zijn er 6 met een bekende reden
buiten bereik (4 × geblokkeerd — Rabobank, Revolut, Klarna, Garanti BBVA — plus
Knab en bunq, die hun spaarrekening binnen een betaald pakket verkopen en dus
eerst een `pricedOnItsOwn`-beslissing vragen), 6 met een gedateerd document dat
de verkeerde of geen kostenpost prijst, en 15 waarvan de bron simpelweg geen
kostenzin bevat.

Geen bedrag gewijzigd, geen product toegevoegd, `catalog.json` en `state.json`
niet aangeraakt.

## Gemeten, niet aangenomen

De zeven voorstellen zijn niet "waarschijnlijk goed": ze zijn door de echte
`readAccountFee` gehaald, met de velden precies zoals ze eruit zien nadat de
samenvoegende lane ze in `fields.accountFee` heeft gezet (`value`, `unit`,
`route`, `sourceUrl`, `checkedAt`, `conditions`, `conditionsKnown`). Dat is de
functie die `isCovered` aanroept en die zonder eenheid, bron, datum of
vastgestelde voorwaarden weigert.

```
OK   santander-consumer-bank-spaarrekening    € 0,00/maand  asOf 2026-07-23
OK   argenta-internetspaarrekening            € 0,00/maand  asOf 2025-09
OK   lloyds-bank-spaarrekening                € 0,00/maand  asOf 2024-12-15
OK   openbank-welkom-spaarrekening            € 0,00/maand  asOf 2023-06-14
OK   openbank-open-spaarrekening              € 0,00/maand  asOf 2023-02-28
OK   nexent-bank-spaarrekening                € 0,00/maand  asOf 2026-07-02
OK   brand-new-day-de-spaarrekening           € 0,00/maand  asOf 2025-02-25

7 door de poort, 0 geweigerd.
```

De maandprecisie van Argenta (`2025-09`) komt er dus doorheen, zoals
`catalogArtifact.test.ts` ook voor het ABN-informatieblad ("Januari 2026")
toestaat. Ook nagekeken: alle dertien genoemde id's bestaan in `catalog.json`,
elke `unit` noemt precies één periode, en geen enkele `sourceDate` is de
ophaaldag 2026-08-24.

`cd packages/core && npx vitest run src/accountCosts.test.ts
src/catalogArtifact.test.ts` → **57 geslaagd, 0 gefaald**, in 2 bestanden. Dat is
de stand vóór én na dit werk: er is geen catalogusbestand gewijzigd, dus de
ondergrens `withFee.length >= 89` beweegt pas als de samenvoegende lane de zeven
rijen erin zet. Daarna zouden het er 96 zijn.
