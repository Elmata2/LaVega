# Wat kost het om een rekening te houden

Zoekronde van **21 augustus 2026**. Lane `rekeningkosten`. Geen Anthropic API-credits gebruikt:
alles is `curl`, `pdftotext -layout`, de Wayback CDX en de eigen JSON-payloads van de sites.

Het voorstel staat in `docs/catalog/staging-account-fees.json`. Dat bestand raakt `catalog.json`
niet aan.

## De kern in vijf regels

1. **105 tarieven gevonden, met bron, citaat en voorwaarden.** 82 daarvan komen uit een document
   dat zijn eigen datum noemt; bij de overige 23 staat letterlijk dat de bron geen datum draagt.
2. **26 van die 105 zijn een uitgesproken nul.** Elke studentenrekening in dit land staat op
   € 0,00 en de aanbieder zegt dat zelf, letterlijk, in het wettelijk verplichte kostendocument.
   Dat is een bekende nul, geen leeg veld.
3. **Route 1 uit de opdracht deed bijna al het werk.** Het EU-verplichte _Informatiedocument
   betreffende de vergoedingen_, de Tarievenwijzer en het ABN-Informatieblad leverden ING, ABN AMRO,
   Rabobank, SNS, ASN, RegioBank, Knab en Triodos in één ochtend. Dat zijn de acht grootste
   Nederlandse aanbieders.
4. **`r.jina.ai` is dood.** Route 3 geeft nu HTTP 403 met een Cloudflare-challenge, ook op
   `https://r.jina.ai/https://example.com`. De volgende ronde moet die route overslaan.
5. **Waar de nul een voorwaarde heeft, staat die erbij.** Rabo Free is 18 t/m 24, Triodos is
   gratis tot en met 22 en kost € 5,00 vanaf 26, ABN's Studenten Pakket is 18 tot 25 (medisch tot
   30). "Gratis" zonder leeftijd bestaat hier niet.

## Wat de vraag was, en wat er nu ligt

Zijn vraag: _"Hoeveel kost een rekening om te behouden (ING student etc)"_. Dus de vaste maand- of
jaarlast van een betaalpakket of creditcard — niet de transactiekosten, niet de koersopslag (die
staat al in `catalog.json` als `fxFeePct`).

Elke regel in het stagingbestand heeft `value` + `unit`, en die twee horen bij elkaar. **Er is
nergens omgerekend.** ING zegt "€ 4,00 per maand", ICS zegt "€ 42,95 per jaar", en zo staat het er.
Wie € 4,00 × 12 maakt, verliest wat het document zei; ING's eigen informatiedocument noemt het
jaartotaal trouwens zélf (€ 48,00), en dan staat het in `conditions`.

## De acht Nederlandse banken

Alle acht publiceren een gedateerd kostendocument. Dat is geen toeval: het is wettelijk verplicht
(het Informatiedocument betreffende de vergoedingen uit de Payment Accounts Directive). Route 1 uit
de opdracht is daarom niet zomaar de eerste route — het is de enige die per definitie moet bestaan.

| Aanbieder | Basispakket                    | Gratis variant                  | Datum in het document  |
| --------- | ------------------------------ | ------------------------------- | ---------------------- |
| ING       | ING Go € 4,00/mnd              | ING Student (18–30) € 0         | 15 juni 2026           |
| ABN AMRO  | BasisPakket Betalen € 4,30/mnd | Studenten Pakket (18–25) gratis | januari 2026           |
| Rabobank  | Rabo Standaard € 3,45/mnd      | Rabo Free (18–24) € 0,00        | 1 juli 2026 / dec 2025 |
| SNS       | SNS Basis € 4,00/mnd           | SNS Studentenrekening € 0,00    | 1 februari 2026        |
| ASN       | ASN Bankrekening € 4,00/mnd    | ASN Studentenrekening kosteloos | 1 juli 2026            |
| RegioBank | Plus Betalen € 4,00/mnd        | Studentenrekening € 0,00        | 1 februari 2026        |
| Knab      | Privérekening € 6,00/mnd       | —                               | 18-02-2026             |
| Triodos   | € 5,00/mnd vanaf 26 jaar       | 18 t/m 22 jaar € 0,00           | mei 2026               |

### ING — het pakketlandschap is verbouwd

Het bestand `ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf` uit de catalogus heeft een
misleidende naam: de inhoud is **geldig vanaf 15 juni 2026** en beschrijft vier pakketten die er in
2023 niet waren.

> Betaalpakketten ING Go / ING More / ING Extra / ING Max — Kosten per maand € 4,00 / € 7,00 /
> € 15,99 / € 44,99

Twee dingen die niet in het lijstje uit de opdracht pasten:

- **"ING Basis" bestaat niet meer als open pakket.** Het BasisPakket staat op pagina 16 onder
  _Niet meer te openen betaalpakketten_, samen met OranjePakket met korting (€ 3,55), BetaalPakket
  (€ 6,85) en RoyaalPakket (€ 9,90). Het BasisPakket kost € 4,85 per maand voor wie het nog heeft.
  Dat is een prijs voor bestaande klanten, geen keuze die iemand vandaag kan maken — het staat als
  aparte regel in het stagingbestand, zodat de app niet gaat suggereren dat je erheen kunt.
- **Het OranjePakket zit in een tussenstand.** Het ING-informatiedocument van 1 januari 2026 noemt
  het OranjePakket op € 4,00 per maand (€ 48,00 per jaar). Het kostenoverzicht van 15 juni 2026
  noemt het niet meer in de actuele lijst, en zet ING Go op precies diezelfde € 4,00. Beide staan in
  het stagingbestand, met hun eigen datum; ik kan niet uit de documenten afleiden of dit één product
  met een nieuwe naam is of twee.

De studentenrekening is een uitgesproken nul:

> ING Student (van 18 tot 30 jaar) — gratis

Ook `Jongerenrekening (van 12 tot 18 jaar) gratis` en `Kinderrekening (van 0 tot 12 jaar) gratis`.
Let op de leeftijden: ING Student loopt tot 30, ABN's Studenten Pakket sinds januari 2026 nog maar
tot 25.

### ABN AMRO — het Informatieblad is de sleutel, niet de tarievenpagina

De FID voor het BasisPakket zat al in de catalogus. Maar er bestaat geen losse FID voor het
Studenten Pakket; ik heb acht URL-varianten geprobeerd en alle acht gaven 404. Het bedrag staat wél
in het **Informatieblad Betaaldiensten Particulieren (januari 2026)**, dat vanaf de productpagina
gelinkt wordt:

> Studenten Pakket (betaalpakket). Een Studenten Pakket is beschikbaar voor klanten van 18 tot 25
> jaar. Voor medische studenten is het Studenten Pakket tot 30 jarige leeftijd beschikbaar. Daarna
> wordt het pakket omgezet naar BasisPakket Betalen. Openingskosten geen. Tarief (inclusief
> Studentenrekening, één betaalpas, Internet Bankieren en ABN AMRO app) — gratis

Dat ene document bevat ook de Jongerengroeirekening (gratis), de Credit Card (€ 2,55/mnd), de Gold
Card (€ 4,45/mnd), de Studenten Credit Card (€ 1,31/mnd, met het jaartotaal € 15,72 erbij) en de
Vreemde Valuta Rekening (€ 5,00/mnd). Eén PDF, acht tarieven.

### Rabobank — 403 aan de voordeur, alles open aan de achterdeur

`rabobank.nl` geeft op elke productpagina HTTP 403 op een gewone `curl`. Dat blokkeerde niets:
`media.rabobank.com` serveert de PDF's zonder enige horde, en de Wayback-snapshot van
`kosten-voorwaarden` (23 april 2026) bevat de directe links naar al die PDF's. Zo kwamen de vier
informatiedocumenten binnen plus _Tarieven en limieten — Nieuwe betaalpakketten, December 2025_,
dat in één tabel elf pakketprijzen zet.

Let op de valkuil die ik bijna in liep: `media.rabobank.com/asset/<uuid>/<willekeurige-naam>.pdf`
geeft **HTTP 200 voor elke naam** en levert altijd hetzelfde bestand. Naam-varianten proberen
(`...-Rabo-Basis.pdf`, `...-Rabo-Comfort.pdf`) lijkt te werken en levert vier keer hetzelfde
Rabo Standaard-document. De UUID bepaalt het bestand, niet het pad.

Rabo Free is de gratis variant, en de voorwaarden staan in een apart document:

> Rabo Free is bedoeld voor rekeninghouders van 18 tot en met 24 jaar. Als wij dat toestaan, kan
> een minderjarige vanaf 16 jaar ook gebruik maken van het pakket.
> — _Bijzondere voorwaarden Rabo Free 2025_, artikel 2

Wij zetten het pakket in ieder geval om als je 25 wordt, zegt artikel 3. Die omzetting is precies
het soort ding waar een alert over zou moeten gaan; de bank bepaalt zelf naar welk pakket.

### De Volksbank-drieling — één PDF-body achter drie .html-paden

SNS, ASN en RegioBank serveren hun tarievenwijzer op een `.html`-pad met een PDF-body, precies
zoals de opdracht waarschuwde. Sniffen op `%PDF-` werkte; op de extensie afgaan zou drie
documenten hebben gekost.

De drie merken lopen niet gelijk. ASN's wijzer is van **1 juli 2026**, SNS en RegioBank van
**1 februari 2026**. SNS heeft zes betaalrekeningvarianten (Compleet € 5,35, Basis € 4,00, EU
Betaalrekening € 4,00, Basis Privérekening € 4,00, Jongerenpakket € 0,00, Studentenrekening
€ 0,00); ASN en RegioBank hebben er drie.

Alle drie de creditcards zijn ICS-producten en staan **per jaar**, niet per maand:

> SNS Creditcard (jaarlijkse kosten) € 37,50 — SNS Creditcard bij Studentenrekening (jaarlijkse
> kosten) € 27,50

RegioBank hanteert exact dezelfde twee bedragen. ASN ook, maar bij ASN staat de creditcard niet in
de tarievenwijzer — alleen op de ongedateerde productpagina. Dat verschil staat in het
stagingbestand.

### Knab en Triodos

Knab's tarievenpagina noemt zijn eigen datum in de voettekst — `Tarieven per 18-02-2026` — en
bevestigt de € 6 / € 7 per maand uit het informatiedocument van 01-10-2025. Op diezelfde pagina
staat een actie ("Tijdelijk 12 maanden gratis"). Die actie is geen tarief en staat daarom niet als
nul in de data; hij staat als voorwaarde bij de € 6.

Triodos is de enige die de leeftijd rechtstreeks in de prijs verwerkt, met vier trappen in één
tabel: € 0,00 (18 t/m 22), € 3,50 (23 t/m 25), € 5,00 (vanaf 26), € 8,00 (en/of-rekening). Dat is
geen studentenkorting maar een leeftijdstarief — de bank vraagt niet of je studeert.

## De neobanken

**bunq** publiceert een tarievenblad met een datum in de kop (03/08/2026) en acht kolommen:
Free € 0, Core € 3,99, Pro € 9,99, Elite € 18,99, plus de vier Business-varianten (€ 0 / € 7,99 /
€ 13,99 / € 23,99). Allemaal per maand.

**N26**'s prijslijst (Version 4.0, 26.06.2026) geldt expliciet voor wie zich met een Nederlands
adres registreert. Het lijstje uit de opdracht klopt niet meer: **"N26 You" bestaat niet in deze
lijst**, het abonnement heet nu **N26 Go** (€ 9,90/mnd). Standard is `Free`, Smart € 4,90, Metal
€ 16,90.

**Revolut** blokkeert elke directe fetch met 403 — ook via WebFetch, ook op de legal-pagina's. De
Wayback-snapshots werkten wel, maar de archiefserver gaf onderweg voortdurend 503; met herhalen
(8–12 seconden ertussen) kwamen alle vijf plannen binnen. Dat kost tijd en het is de moeite waard
om te weten: dit is geen blokkade, het is een wachtrij.

| Revolut   | Per maand | Per jaar | Document van      |
| --------- | --------- | -------- | ----------------- |
| Standaard | Kosteloos | —        | 22 april 2025     |
| Plus      | € 3,99    | € 40,00  | 22 april 2025     |
| Premium   | € 9,99    | € 100    | 28 augustus 2024  |
| Metal     | € 18,99   | € 185    | 16 september 2024 |
| Ultra     | € 60      | € 600    | 22 april 2025     |

Premium en Metal komen uit oudere versies van de voorwaarden dan Standaard en Plus. Dat betekent
niet dat ze verouderd zijn — Revolut dateert per plan — maar het is wél het eerste wat een volgende
ronde opnieuw moet ophalen.

**Trade Republic**, **Trading 212** en **Wise** zeggen alle drie zelf dat er geen doorlopende kosten
zijn. Dat is een uitgesproken nul en zo staat het in de data. Maar er zit bij alle drie een
eenmalige kaartprijs achter die géén nul is:

- Trade Republic: virtuele kaart gratis, Classic € 5, Mirror € 50 (eenmalig).
- Wise: € 7 eenmalig voor de debitcard, met er letterlijk naast "Geen abonnementskosten".
- Trading 212: er ís een eenmalige uitgiftevergoeding, maar het bedrag staat er niet — _"You will
  see it upon completing your order"_. Dat is onbekend, niet nul, en staat in de `unknown`-lijst.

## De creditcards

De ICS-familie rekent **per jaar**. Twee prijsverhogingen staan al aangekondigd in de bron zelf, en
dat is precies het soort ding dat een tracker moet vasthouden:

- Visa World Card Gold: € 57,95 → **€ 59,50 vanaf 15 september 2026**
- Mastercard Gold: € 45 → **€ 46,50 vanaf 15 september 2026**
- ANWB Visa Classic/Silver/Gold: € 29,95 / € 39,95 / € 51,95 → **+ € 1,75 vanaf 1 november 2026**

American Express rekent juist **per maand**, ook voor kaarten die iedereen als jaarkaart kent:
Gold € 20, Platinum € 75, Green € 6,50, Flying Blue Gold € 16,50, Flying Blue Platinum € 55. Alleen
de zakelijke kaarten staan per jaar (Business Gold € 270, Business Green € 85). Omrekenen zou hier
dus twee kanten op moeten en is nergens gedaan.

De Blue Card is de lastigste regel van de hele ronde:

> Kosten: € 0 per maand (bij minimale besteding van € 3.000 per jaar)
> \*Geeft u elk jaar minimaal € 3.000 per lidmaatschapsjaar uit? Dan blijft de kaart gratis
> t.w.v. € 35 per jaar.

De nul is echt en uitgesproken, maar hij hangt aan een bestedingsvoorwaarde. Wat je betaalt als je
die € 3.000 niet haalt, staat er niet — de € 35 is de waarde van de vrijstelling, niet aantoonbaar
het tarief dat je dan krijgt. Dus: 0 met de voorwaarde erbij, en de rest onbekend.

**Voor zijn eigen Business Gold Card** is er wél een gedateerd document. De productpagina is
ongedateerd, maar de actievoorwaarden-PDF (`NL T&C X-SELL LTO Q2 2026`, 2 juni t/m 30 juni 2026)
noemt hetzelfde bedrag:

> De American Express Business Gold Card is het eerste jaar kosteloos, zolang u gebruik blijft
> maken van uw consumentenkaart van American Express. Daarna betaalt u € 270 per jaar.

## Waar het cijfer onbekend bleef

Vijf gaten, en ze zijn geen nul:

1. **ING Studenten Creditcard More.** Het kostenoverzicht noemt de kaart vier keer (koersopslag,
   geldopname, daglimiet) maar zet hem niet in de cardfee-tabel bij de vier pakketten. Er is geen
   bedrag.
2. **Knab Creditcard.** De tarievenpagina somt rente, opnamekosten en koersopslag op; een
   jaarbijdrage ontbreekt.
3. **ABN's opslag voor klanten buiten Nederland.** Drie categorieën (€ 2 / € 8 / € 15 per maand),
   maar welk land in welke categorie valt staat niet in het Informatieblad.
4. **bunq studentenkorting < 26 jaar.** Zie hieronder.
5. **Trading 212 kaartuitgifte.** Bedrag niet gepubliceerd.

### De bunq-rij die ik niet durf te lezen

In het tarievenblad staat een rij `Aanhouden van de account: Studentenkorting voor <26 jaar` met
onder bunq Elite `€ 9 per maand`, onder bunq Pro `Gratis` en onder bunq Core `€ 3,99 per maand`.
Pro gratis maar Core betaald is geen korting die logisch loopt, en de plannenpagina van bunq noemt
de studentenkorting helemaal niet. De kolomuitlijning in de PDF is schoon — het is geen
parseerfout, het document zelf is zo. Ik heb hier geen getal van gemaakt; er is geen lezing die ik
kan verdedigen.

## Doodlopende wegen

| Wat                                                           | Route                          | Waarom niet                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`r.jina.ai` (route 3)**                                     | lezer-proxy                    | HTTP 403 met een Cloudflare-"Just a moment"-challenge, óók op `r.jina.ai/https://example.com`. De proxy zelf is dicht, niet de doelsite. Route 3 bestaat niet meer.                                                   |
| ABN AMRO Studenten Pakket                                     | FID-URL raden                  | 8 varianten op `assets.abnamro.com/api/public/content/informatiedocument-vergoedingen-*.pdf`, alle 404. Er ís geen losse FID; het bedrag staat in het Informatieblad.                                                 |
| ABN AMRO tarievenpagina                                       | directe fetch                  | `tarieven.html` redirect naar de algemene betalen-pagina. `tarieven/dagelijkse-bankzaken.html` heeft de complete tarieftabel wél statisch in de HTML — maar draagt geen datum.                                        |
| Rabobank productpagina's                                      | directe fetch                  | HTTP 403 op `rabobank.nl/particulieren/...`. Wayback + `media.rabobank.com` lossen het volledig op.                                                                                                                   |
| Rabobank asset-URL's                                          | naam raden                     | `media.rabobank.com/asset/<uuid>/<naam>.pdf` geeft 200 voor élke naam en levert altijd het bestand van die UUID. Vier "gevonden" documenten bleken één document.                                                      |
| Revolut                                                       | directe fetch én WebFetch      | HTTP 403 op `revolut.com/nl-NL/legal/*` en op de prijzenpagina. Alleen Wayback werkt.                                                                                                                                 |
| Wayback (tijdens deze ronde)                                  | `web.archive.org/web/<ts>id_/` | Structureel HTTP 503 bij de eerste poging; 2–3 herhalingen met ~10 s ertussen halen hem binnen. Niet opgeven na één 503.                                                                                              |
| Trading 212                                                   | directe fetch                  | HTTP 403 op `trading212.com/nl/card`. De Zendesk-API van het helpcentrum (`/api/v2/help_center/articles/search.json`) geeft 200 met de volledige artikeltekst én `edited_at`/`updated_at`.                            |
| American Express "Overzicht Kaartlidmaatschapsbijdragen"      | directe fetch                  | De consumentenovereenkomst verwijst ernaar op `americanexpress.nl/voorwaarden`. Vier padvarianten geprobeerd, alle 404. Het overzicht is niet gevonden; de bedragen komen daarom van de ongedateerde productpagina's. |
| ABN AMRO `informatiedocument-betreffende-de-vergoedingen.pdf` | directe fetch                  | Werkt (200, februari 2026) maar gaat over de Belgische **Zichtrekening** (EUR 60,50 per jaar). Niet het Nederlandse retailaanbod.                                                                                     |
| bunq helpcentrum over studentenkorting                        | directe fetch                  | 404 op vier URL-varianten; het helpcentrum draait op Framer zonder doorzoekbare API.                                                                                                                                  |
| Wise-datum                                                    | alle routes                    | `wise.com/nl/pricing/` bevat geen datum, geen `dateModified` in de HTML en geen `Last-Modified`-header. De bedragen kloppen, de datum is er niet.                                                                     |

## Wat de volgende ronde als eerste moet doen

1. **Route 3 schrappen.** `r.jina.ai` kost nu alleen tijd.
2. **Wayback met herhaling inbouwen.** Één 503 betekent niets; drie pogingen met 10 seconden
   ertussen halen vrijwel alles binnen.
3. **De twee aangekondigde verhogingen na 15 september en 1 november 2026 opnieuw ophalen.** Die
   staan nu al gedateerd in de bron, dus dit is een agenda-item, geen zoekopdracht.
4. **Revolut Premium en Metal opnieuw.** Hun voorwaarden zijn van 2024, de andere drie van 2025.
5. **Een gedateerde bron zoeken voor ICS, ANWB, Amex, Wise en de ASN-creditcard.** Die publiceren
   hun bedragen op pagina's zonder datum. Dat zijn 23 van de 105 regels — precies de regels waar de
   app straks niet kan zeggen hoe oud het cijfer is.
