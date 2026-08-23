# LaVega — backlog

Bijgewerkt **21 augustus 2026**, na de drie app-reviews van 20 augustus
(`docs/reviews/2026-08-20-app-review.md`, `-2.md`, `-3.md`).

**Gegroepeerd op wat een punt blokkeert**, niet op wanneer het is opgeschreven. Bij elk open punt
staat waarom het open staat. Staat die reden er niet bij, dan hoort het punt hier niet.

Wat af is, staat er niet meer in. §0 noemt in één tabel wat er sinds 19 augustus is gesloten, met de
commit erbij, zodat het terug te vinden is zonder hier ruimte te blijven innemen.

Werkafspraak, ongewijzigd: **één ding tegelijk** — eerst de vraag bevestigen, dan bouwen, dan test
hij, dan het volgende.

---

## 0. Afgesloten sinds 19 augustus — verdwijnt uit deze backlog

Alle drie de reviews van 20 augustus zijn verwerkt, in de 50 commits die die dag draagt. Wat
hieronder staat is gebouwd en getest in de repo; wat hij daarvan zelf op het scherm heeft
teruggezien, staat eronder.

| Uit | Wat | Commit |
|---|---|---|
| R1-1 | ING stond op `aangenomen 0%` in Optimalisatie — de catalogusrij werd niet gevonden. Tegelijk de actierente: standaardrente rangschikt, promo staat er annotatief bij | `b16640f` |
| R1-2 | De AI leest de onbekende rijen nu echt uit, en "onbekend" zegt waarom hij onbekend is | `6a88373` |
| R1-3, R2-4 | Abonnementen groeperen per merchant, en weigeren wat hij niet betaalt | `7493837`, `8e40d5d` |
| R1-4 | Een met de hand ingetypt puntensaldo kan niet meer worden overschreven of stilletjes verdwijnen | `2077c86` |
| R1-5, R1-10 | Valuta: één rij per bank, en de hele catalogus gerangschikt in plaats van alleen zijn eigen rekeningen | `8dd061d` |
| R1-6, R1-7, R1-8, R3-2, R3-3 | Travel Agent: geldopname erbij, cashback erbij, en de aanbeveling is de beste kaart in plaats van de kaart die hij toevallig heeft — met het verschil in euro's | `d0aa742`, `d764baf`, `8600380`, `5b655bf` |
| R1-11 | Het IBAN-veld op de kaarten toont echte laatste vier cijfers of niets (`ibanTail` geeft `null`) | in `KaartenBlock` |
| R1-12, R2-10, R2-11 | "Positie per onderneming" en "Aandacht" zijn schakelbare widgets, uit tenzij aangezet | `a833577`, `f4ee5fb` |
| R1-13 (deels), R2-12, R3-5, R3-6, R3-7, R3-8 | Statistieken: donut plus groeigrafiek, exact getal af te lezen per balk/boog/punt met hover, tap én toets, doorklikken naar de categorie | `53c4ebc`, `2a0b21a`, `9e5616a` |
| R1-17 (deels), R3-12 | Banklogo's worden tijdens de sweep opgehaald en gebundeld — in de browser wordt niets opgehaald. Kaartvlak in de huisstijlkleur van dat logo | `7f1c353`, `3eafe6f` |
| R1-20, R2-16 | Facturen: een geverifieerde factuur boekt en koppelt zichzelf, met een plafond van € 10.000. Het doorstuuradres is invoerbaar, want Cloudflare bepaalt hem | `470dd3a`, `8b0f7a3`, `e3b39f5` |
| R2-2 | "Al op de beste plek" bij 0% was een conclusie die het cijfer niet droeg — er wordt nu vergeleken met Scalable Capital en het euro-bedrag staat erbij | `9e5616a` |
| R2-3 | De Investing-link opende een localhost die weigerde. Hij verschijnt nu pas als de investing-app antwoordt (zie §4.1 — de app zelf draait nog niet) | `ce8fb09` |
| R2-5 | Betaalagenda ziet ook binnenkomende terugkerende stromen (DUO), en zijn eigen rekeningen | `8e40d5d` |
| R2-6 | Categorieën lezen wie de tegenpartij is: een persoon, een incasso, of hijzelf | `c5d42ac`, `170e327` |
| R2-9 | Cashback-blok in de vorm van het huurblok, gerekend over echte maanduitgaven | `56e2a8c`, `e0abd93` |
| R2-13 | Weg wat niets opleverde: de gele voorwaardenregel, de forecast-uitleg, woonlasten, lege blokken | `56e2a8c` |
| R3-1 | De donut zei € 2 miljoen — overboekingen naar eigen spaar- en beleggingsrekeningen werden als uitgave geteld; creditcard-afbetaling telt niet meer mee | `19e7573`, `5b655bf` |
| R3-4 | Het heet Travel Agent | `5b655bf` |
| R3-9 | Profiel opgeschoond: de n8n-opzethulp weg, het paar dat Facturen nodig heeft blijft | `dc06b59` |
| R3-10 | Nul ondernemingen is geen openstaande vraag — dan is het één zzp'er en gaat de factuur gewoon in het overzicht | `a6e7d7b` |
| R3-11 | Regels alfabetisch, op een kopie gesorteerd zodat de winnende regel niet stilletjes verandert | in `Regels.tsx` |
| R1-19, R3-13 | Implementatieplan voor de extensie | `docs/superpowers/specs/2026-08-20-checkout-extension-implementation-plan.md` |
| R3-14, R3-15 | De laatste kaarten zonder FX-cijfer en de ING-puntendata — gevonden, nog niet samengevoegd (§2.1) | `docs/superpowers/specs/2026-08-20-catalog-fx-gaps-and-ing-punten-data.md` |
| B7 (oude backlog) | `category-trend.ts` met zijn zeven misleidend groene tests is weg; de dode `rules`-tak is weg en er staat nu bij waarom `koppelingen` en `backup` géén dode takken zijn; `saveScheduledFlows` merget, dus Belasting kan een gescopete lijst krijgen | diverse |
| B6 (oude backlog) | Trendlijnen: de groeigrafiek en het weekdagpatroon staan er, en die vond hij goed | `53c4ebc` |

**Gebouwd, maar door hem nog niet teruggezien.** Alles in de tabel hierboven is na review 3 gebouwd
of vlak ervoor. Hij heeft review 3 gedicteerd om 23:14; wat daarna landde (`5b655bf` en verder) is
door niemand anders dan de tests bekeken. Twee daarvan verdienen expliciet zijn oog, omdat ze eerder
al eens "gefixt" zijn geweest en toch terugkwamen:

- **Simyo.** Drie keer gemeld (R1-3, R2-4), twee keer aangepakt. Er is geen meting tegen zijn echte
  rijen, alleen tegen de tests. Tot hij het ziet, is dit niet af.
- **De donut van € 2 miljoen.** De hypothese uit review 3 klopte en is gerepareerd, maar het getal
  dat er nu staat is nooit door hem gecontroleerd.

---

## 1. Blokkeert de data die binnenkomt

### 1.1 Enable Banking ververst niet. Zijn saldo is van het moment dat hij koppelde.

**Dit is een gat, geen instelling.** Er is niets uitgezet dat aangezet kan worden.

`apps/server/src/eb-routes.ts` registreert vier routes en niet meer:

| Route | Wat hij doet |
|---|---|
| `GET /api/eb/aspsps` | de bankenlijst voor de kiezer |
| `POST /api/eb/auth` | start de autorisatie, geeft de bank-URL terug |
| `GET /api/eb/callback` | wisselt de code in voor een sessie en stuurt door naar `/?eb=<sessionId>` |
| `GET /api/eb/accounts` | haalt saldi en transacties op, geeft de rauwe bank-JSON door aan de browser |

Er is **geen refresh-route** en er is **geen interval** — niet in de server, niet in `App.tsx`. Data
komt alleen binnen op de terugweg van een autorisatie. Drie dingen maken dat harder dan het klinkt:

1. **`/accounts` is eenmalig.** Direct na het uitleveren staat er `sessions.delete(sessionId)`.
   Dezelfde sessie een tweede keer bevragen geeft *"Sessie onbekend of verlopen — koppel de bank
   opnieuw."*
2. **De sessies staan in het geheugen**, met een TTL van 60 minuten, en zijn weg na elke deploy of
   herstart van de Railway-service.
3. **De toestemming die hij gaf loopt 89 dagen** (`access: { valid_until: validUntil(89) }`). Het
   recht om nog eens op te halen bestaat dus wél; wat ontbreekt is de route en de aanleiding die het
   zou gebruiken.

**Wat de gebruiker hiervan merkt, en waarom dat het ergste deel is.** Het saldo op zijn scherm is het
saldo van het moment dat hij koppelde, en er staat nergens een datum bij: in `Rekeningen.tsx` is geen
"bijgewerkt op". Een getal zonder datum leest als een getal van nu. De catalogus wordt élke maandag
om 05:00 UTC ververst (`.github/workflows/catalog-sweep.yml`); zijn eigen saldi nooit.

Wat het oplost, in volgorde van eerlijkheid:

- **Eerst de datum.** Zet bij elke gekoppelde rekening wanneer die stand is opgehaald. Dat kan
  vandaag, kost niets, en haalt de stilzwijgende bewering weg.
- **Dan de knop.** Eén "opnieuw ophalen" die de autorisatie overdoet, met in de tekst de echte
  oorzaak: er is geen achtergrondverversing, dus de bank vraagt opnieuw om toestemming.
- **Dan pas het schema.** Een echte verversing binnen die 89 dagen vraagt om het bewaren van de
  Enable Banking-sessie buiten het procesgeheugen, en dat botst met de opzet dat de server niets van
  de gebruiker bewaart (`docs/CONTEXT.md`). Dat is een ontwerpbeslissing, geen bugfix, en hij hoort
  hem te nemen — niet wij, en niet stilzwijgend.

### 1.2 Puntensaldi komen alleen met de hand binnen

Punten staan niet in een bankkoppeling, in geen enkele. De Punten-tab is een handmatige teller en dat
is bewust. Zijn eigen wens (R1-7 uit de eerste ronde, en de "high trust"-variant in het oude item 7):
één keer toegang geven, daarna afleiden uit de transacties.

Dat is nu niet te bouwen, en de reden is niet techniek maar rekenkunde: voor ING bestaat er **geen
koers per bestede euro** om mee te vermenigvuldigen (§5.1). Voor Amex bestaat die wel en zou het
kunnen — maar dan alleen voor Amex, en dan moet er bij staan dat het een berekening is en geen saldo
van de uitgever.

### 1.3 De structurele oplossing is geen code maar toegang

Realtime toegang tot de meeste rekeningen, inclusief Amex, komt niet uit een betere poller maar uit
een LSP/TPP-status. Dat staat in §4.2, want daar wacht het op iemand anders.

---

## 2. Blokkeert het cijfer op het scherm

### 2.1 Twee voorstellen liggen klaar en zijn niet samengevoegd

Beide zijn expliciet als *voorstel* geschreven en raken `catalog.json` niet aan. Zolang ze niet zijn
samengevoegd, mist de app cijfers die in huis zijn.

| Voorstel | Wat erin zit | Wat het samenvoegen tegenhoudt |
|---|---|---|
| `docs/superpowers/specs/2026-08-20-catalog-fx-gaps-and-ing-punten-data.md` | zes FX-cijfers om vast te pinnen (Revolut Premium/Metal 0, Amex Corporate 2,5, Gnosis Pay 0, paysafecard 3, Tria 0) — dat brengt kaart-FX van 73/82 naar 79/82. Plus drie schone negatieven met reden | Alleen dat iemand het doet. De gemeten stand in `catalog.json` is nog steeds 73 |
| `docs/catalog/staging-points.json` | 15 producten, ING Punten en RevPoints als programma, en twee inwisselwaarden | Zes regels leunen op **`enumerated-absence`** (een complete eigen productopsomming waarin punten ontbreken), niet op een uitgesproken "wij hebben geen punten". Die bewijssoort is één beslissing van hem — zie §6 |
| `docs/catalog/staging-account-fees.json` | 105 tarieven met bron en citaat, waarvan 26 een **uitgesproken** nul (elke studentenrekening) | Er is nog geen veld in de catalogus waar een maand- of jaarlast in past. `value` + `unit` horen bij elkaar en er mag niet worden omgerekend |

### 2.2 Wat de catalogus vandaag dekt, gemeten

**185 producten** in `catalog.json` (gegenereerd 2026-08-21). Per veld:
**73** `fxFeePct`, **89** `accountFee`, **51** `pointsPerEuro`,
**32** `interestPct`, **8** `cashbackPct`.

Twee dingen die daarin verstopt zitten en die elke agent raken:

- **Van de puntencijfers zijn er 14 groter dan nul, en die 14 zijn állemaal American Express.**
  Buiten Amex heeft geen enkel product een aantoonbare koers per bestede euro.
- **Cashback staat op 8.** Elk cashback-antwoord rust dus op een smalle basis — en van die 8
  draagt er geen enkele óók een prijs, wat de nettotak van de extensie blokkeert tot de
  kaartkosten-sweep is samengevoegd (§2.1).


### 2.3 Vier datums dragen mogelijk de dag dat wij keken

Huisregel: elk cijfer draagt de datum die *het document* noemt, niet de dag dat wij keken. Twee
regels zijn al gevonden door de lane die er niet in mocht schrijven; twee komen erbij uit een
telling van 21-08 (het jaartal in de `sourceUrl` vergeleken met het jaartal in `checkedAt`, drie
treffers op 122 producten):

| Regel | Veld | Staat er nu | Waar de twijfel op rust |
|---|---|---|---|
| `american-express-corporate-gold-card` | `fxFeePct` | `2026-08-19` | URL-pad `…/2022-12-15/…`, PDF-`CreationDate` 7 december 2022 — **bevestigd** |
| `zeal-card-gnosis-pay-rails` | `fxFeePct` | `2026-04-27` | Zendesk-API `updated_at: 2026-08-12`, `created_at: 2025-07-21` — **bevestigd** |
| `ing-betaalpas` | `fxFeePct` | `2026-06-15` | bron heet `ING_Kostenoverzicht-betaalproducten-particulieren_**2023**.pdf` — alleen de bestandsnaam gezien, het document zelf is niet geopend |
| `klm-american-express-corporate-card` | `fxFeePct` | `2026-08-19` | URL-pad `…/2022-12-15/…`, bestand `NL_KLM_Corporate_Cardmember_TCs_**Dec2022**.pdf` — idem |

De laatste twee zijn **kandidaten, geen vondsten**: een jaartal in een URL is geen bewijs van de
datum die het document zelf noemt. Ze horen opengemaakt te worden in dezelfde pass als de merge van
§2.1, anders staan de nieuwe regels naast een paar die het anders doen.

Dit raakt de gebruiker direct: `ing-betaalpas` is de rij die hij het vaakst ziet, en de datum ernaast
suggereert dat de koersopslag van twee maanden geleden is gecontroleerd.

---

## 3. Blokkeert de oplevering van de MVP

Zijn eigen doel uit review 3: *"as much as possible an MVP of the final product."* Dit is wat daar
nog tussen zit, met per punt de reden dat het er nog is.

| # | Wat | Waarom het open staat |
|---|---|---|
| **M1** | **Echte kaartafbeeldingen** (R1-17). De logo's zijn gebundeld en het kaartvlak heeft de huisstijlkleur; de kaart zelf is nog geen kaart | Merkenrecht. Een banklogo mag doorgaans gebruikt worden om dát product te identificeren, mits met disclaimer (`apps/web/src/assets/TRADEMARKS.md`); een kaartafbeelding is een ontwerp. Ophalen tijdens de sweep is de goedgekeurde route, de vraag is of het mág — niet of het kan |
| **M2** | **De interactieve wereldkaart in Valuta** (R1-16) | Onderweg in deze ronde: `WorldMap.tsx`, `world-map.generated.ts` en `scripts/bundle-world-map.ts` staan in de werkboom en zijn nog niet gecommit. Gebundelde geodata mag, tiles ophalen niet — dat zou verraden naar welke landen hij kijkt |
| **M3** | **Gemiddelde inkomsten en gemiddelde uitgaven** per periode (R1-13, laatste deel) | Niet gebouwd. Het weekdaggemiddelde bestaat, dit niet |
| **M4** | **Periodeschakelaar op Abonnementen** (R1-14) | Niet gebouwd. In `Optimalisatie.tsx` staat overal "per maand" als vaste eenheid |
| **M5** | **Een beter kostenoverzicht**, *"like an earlier version we worked with"*, waar categorieën als transport vanzelf goed stonden (R1-15) | Onduidelijk welke eerdere versie hij bedoelt. Dat moet hij aanwijzen; ernaar raden levert een tweede overzicht op in plaats van een beter |
| **M6** | **De forecast zelf** (oude B2) | Het cashflowblok vindt hij goed, de voorspelling erachter is niet af. Nooit herzien sinds ronde 1 |
| **M7** | **De Punten-UI mooier** (oude B5) | Cosmetisch, en de inhoud van die tab verandert nog (§1.2, §5.1) |
| **M8** | **Rekeningen groeperen per bank**, met het logo en de kaarten achter een klik (oude B4) | Zijn eigen woorden: *"maybe just test this out, I'm not sure yet."* Het logo bestaat nu wel, dus het is goedkoper geworden om te proberen |
| **M9** | **De vindbaarheid van "Ververs voorwaarden"** in het reisblok (oude B3) | Niet opnieuw gemeld in ronde 2 of 3. Niet gemeten of het nog speelt — dus ook niet afgevinkt |
| **M10** | **Niets van deze ronde staat op lavega.dev** | Wacht op zijn go |

---

## 4. Wacht op iemand anders

### 4.1 Zijn cofounder — de investing-app

Twee losse dingen, en het tweede is groter dan het eerste.

**a) Investing als tweede Railway-service.** `Dockerfile.investing` bestaat en is beschreven in
`docs/investing/DOCKER.md`: één container die de dashboard en de API serveert op poort 8788, met
`/data` als volume voor de prijs-cache en de versleutelde brokerkluis. `railway.json` bouwt vandaag
alleen de gewone `Dockerfile`. Wat er moet gebeuren: een tweede service die op
`Dockerfile.investing` bouwt, en daarna `VITE_INVESTING_URL` op de web-build zetten. Tot dat er
staat, verbergt `investing.ts` de link — bewust, want *"a link that refuses to connect is worse than
no link"* — en ziet hij de app dus niet in de navigatie.

**b) Eén account over beide apps.** Dit is niet af te vinken met een omgevingsvariabele. LaVega
bewaart alles in een versleutelde kluis in de browser; de investing-app heeft een eigen kluis op de
server (`/data/credentials.json`, ontgrendeld met `LAVEGA_VAULT_PASSPHRASE`). Dat zijn twee
sleutelbossen met twee bewaarplaatsen. "Eén account" betekent kiezen welke van de twee de
waarheid is, en die keuze raakt de belofte dat de server niets van de gebruiker bewaart. Zijn
cofounder bouwt de investing-kant; deze vraag hoort door hen samen beantwoord te worden voordat er
iemand code voor schrijft.

### 4.2 Enable Banking en FinAPI — de aanvraag

R1-18: mailen of we een paar maanden als LSP/TPP mogen optreden en wat dat kost — *"hopefully free"*.
De prijs die het oplevert: realtime toegang tot de meeste rekeningen **inclusief Amex**, wat geen
enkele CSV-import geeft.

**Stand: de brieven zijn nog niet geschreven.** Er staat geen concept in de repo. Dat is onze stap,
niet die van hem; daarna is het wachten op hun antwoord en kan er van onze kant niets versneld
worden. Wat er in moet, en waarom het geen standaardmail is: de huidige sandbox is beperkt tot één
ING-rekening tegelijk, en dat is precies de beperking waar hij tegenaan loopt.

Zolang dat antwoord er niet is, blijft §1.1 zoals hij is: koppelen, ophalen, klaar.

### 4.3 Cloudflare — gedaan, maar nooit end-to-end gezien

Zijn cofounder heeft de Cloudflare-kant gedaan (review 2, item 16) en `e3b39f5` maakt het
doorstuuradres invoerbaar omdat Cloudflare bepaalt hoe hij heet. Wat niemand heeft gemeld is een
echte mail die de hele keten door is gekomen tot een geboekte factuur. Dat is geen blokkade, wel een
onbevestigde aanname.

---

### Het doorstuuradres bestaat nog niet (22 augustus)

Hij probeerde weg 1 te testen en stuurde een factuur naar het doorstuuradres. Zijn
bevinding: **dat adres bestaat niet.** Er kwam dus niets bij Cloudflare aan, niets bij n8n,
en er valt langs die weg voorlopig niets te testen.

**Twee blokkades die niet door elkaar mogen lopen**, want ze zitten op verschillende
plekken in de keten en de een lost de ander niet op:

1. **De mailkant.** Het doorstuuradres moet bestaan en op de Cloudflare-worker uitkomen.
   Zolang dat er niet is, is weg 1 niet te testen — ook niet gedeeltelijk. Wacht op zijn
   cofounder (zie sectie 4).
2. **De ophaalkant.** Los daarvan gaf de app "geen antwoord van n8n", en dat is een ANDER
   probleem: de app haalt de wachtrij op met een eigen header, dus de browser doet eerst
   een CORS-preflight, en een geweigerde preflight laat in n8n géén uitvoering achter.
   Zet Allowed Origins in de Webhook-node, of controleer de URL met curl buiten de browser
   om. Die controle kan hij nu al doen, zonder dat het mailadres bestaat.

**Wat intussen wél werkt en wat hij dus kan blijven gebruiken:** de PDF in Facturen slepen
(werkt, bevestigd) en de nepwachtrij met `--rows` en zijn eigen cijfers. Die twee dekken
samen alles behalve de afzendercontrole.

**Nog open aan de facturenkant:** xlsx wordt niet gelezen. Hij had een factuur met btw in
xlsx en moest hem overslaan.

## 5. Onbereikbaar gebleken — met de reden

**Wat hier staat is "wij zijn er langs deze routes niet in gekomen", niet "het bestaat niet".** Een
afwezigheid draagt die conclusie niet. Elk punt hieronder noemt de route die dichtging, zodat een
nieuwe route herkenbaar is als hij zich voordoet.

En één waarschuwing bij alle vier: op dezelfde dag gaf `r.jina.ai` in de ene ronde HTTP 403 met een
Cloudflare-challenge (`docs/research/2026-08-20-rekeningkosten.md`) en in de andere gewoon de pagina
(`docs/research/2026-08-20-punten-koersen.md`). "Onbereikbaar" is hier dus een waarneming van een
moment, geen eigenschap van de bron.

### 5.1 De euro-waarde van een ING-punt

De eerdere blokkade (shadow DOM) klopte voor de landingspagina, maar is voor de **verdienkant**
inmiddels omzeild langs de voordeur: `api.www.ing.nl/nl/public/pagemodel?pageUrl=…` geeft HTTP 200 op
plain curl en bevat de hele spaartabel. Dat deel is dus niet meer onbereikbaar.

Wat wél dicht is, en waarschijnlijk dicht blijft:

- **Wat een punt aan korting oplevert in de ING Winkel.** `www.ing.nl/punten/*` verbreekt de
  HTTP/2-stream (ook op `--http1.1`), `r.jina.ai` meldt *"This page contains shadow DOM that are
  currently hidden"* en levert alleen de titel, en de Wayback CDX heeft van dat pad uitsluitend
  JS-bundles. De Winkel zit achter Mijn ING.
- **Een koers per bestede euro bestaat niet.** ING beloont drempels: *"Meer dan € 100 uitgeven met je
  ING Creditcard Extra of Max → 250 punten per maand"*, bij € 100 én bij € 4.000. Wie daar 2,5 punt
  per euro van maakt, verzint een getal dat een factor 40 mis kan zitten. Dit veld blijft leeg — niet
  omdat we het niet konden vinden, maar omdat het niet bestaat.

Wat ING wél uitspreekt is een **bekende nul**, en die is als zodanig genoteerd: *"ING Punten hebben
geen geldwaarde. Je kan je ING Punten niet inwisselen voor geld"*
(`Voorwaarden-ING-Punten-vanaf-1-oktober-2025.pdf`).

### 5.2 De inwisselwaarde van RevPoints

De 403 gold voor directe curl op `revolut.com`. Via de reader kwamen `help.revolut.com/nl-NL/…` en
de RevPoints-voorwaarden wel binnen — dezelfde publieke pagina, niets omzeild. **De verdienkoers is
daarmee gevonden**: € 10 / € 10 / € 4 / € 2 per punt voor Standard / Plus / Premium / Metal, oftewel
0,1 / 0,1 / 0,25 / 0,5 punt per euro.

De inwisselwaarde blijft onbereikbaar omdat Revolut zegt dat hij niet bestaat: *"RevPoints hebben
geen vaste geldwaarde en hun waarde hangt af van de gekozen inwisselmethode."* Daarom `null` en geen
0. Het enige euro-per-punt dat Revolut noemt — maximaal € 0,02 bij het terugvorderen van een negatief
saldo — is een plafond op een vordering en staat apart, zodat niemand het per ongeluk als koers
leest.

### 5.3 Het tariefdocument van Wise

De vondst is niet "onleesbaar" maar sterker: **Wise heeft geen kaart-FX-percentage.** De pagina's
lezen prima. `wise.com/nl/pricing/` geeft 200 op plain curl (578 kB) en noemt geen percentage per
corridor; `wise.com/nl/pricing/card-fees` rekent live ("Fixed fee 0 EUR / Variable fee 4.58 EUR") in
plaats van iets te publiceren.

Het ene document dat het zou beslechten — het wettelijk gestandaardiseerde tarievendocument op
`wise.com/pricing/fees-documents`, waar de prijspagina zelf naar linkt — geeft **403** op curl met
browser-UA en Accept-Language, en via de reader tweemaal een 160-byte advertentiepixel in plaats van
de pagina. Die route is dicht en dat is genoteerd, niet omzeild.

Een 0 invullen zou hier de gevaarlijkste soort fout zijn: Wise zou de reisranglijst winnen van elke
kaart die zijn percentage eerlijk opschrijft, terwijl er een laag lager wél kosten worden gerekend.
Als de Travel Agent Wise ooit moet rangschikken, is de eerlijke ingang
`api.wise.com/v4/comparisons` — publiek, geen auth, 200, met de eigen quote erin — als **live** bron
naast de ECB, precies zoals de Valuta-tab het al doet.

### 5.4 De logo's van SNS en ASN

Op 20-08-2026 byte-identiek gecontroleerd op 16×16, 32×32 en 96×96: `snsbank.nl`, `asnbank.nl` en
`regiobank.nl` serveren vanuit één CMS van de Volksbank **exact hetzelfde icoon** — een oranje
eekhoorn. Dat is een groepsicoon, geen merkicoon, en uit hun eigen pagina's valt niet aan te tonen
welk van de drie merken het zou identificeren.

Daarom staan SNS en ASN in de `NO_LOGO`-lijst van `scripts/bundle-bank-logos.ts`, met de reden en de
dag erbij. **Een verkeerd logo is erger dan geen logo**: het zegt met stelligheid iets fouts over bij
wie hij bankiert. RegioBank kreeg er wel een, maar uit een andere bron (Wikimedia Commons, CC BY-SA
4.0 — naamsvermelding is daar een verplichting en staat in `TRADEMARKS.md`).

Wat het zou openen: hun eigen merkrichtlijnen, of een per-merk asset die aantoonbaar bij één van de
drie hoort.

---

## 6. Wacht op zijn beslissing

### Beantwoord op 23 augustus

**V1 — JA, hij zou een gevulde winkelwagen verlaten voor 8,5%.** Dat is het antwoord waar het
extensieplan op wachtte, en het draait de opzet om: aanbiedingen zijn de KOP van de extensie, geen
voetnoot. De volgorde op een afrekenpagina is daarmee (1) een aanbieding die hij hier kan gebruiken,
(2) welke kaart het meest oplevert, (3) welke punten hij heeft liggen.

**V3 — JA op optie B, mét expliciete toestemming.** De extensie mag zijn eigen, ingelogde
Amex-aanbiedingen lezen. Gebouwd op 22–23 augustus: aparte vraag, standaard uit, uitzetten wist wat
er ligt, en `host_permissions` blijft leeg zodat Chrome het pad afdwingt. Wat nog niet is gezien is
de echte pagina — dat kan alleen hij.

**De vier verdachte datums (§2.3): later.** Zijn woorden: *"datum kunnen we later testen."*

**De euro-waarde van een punt: niet belangrijk.** *"Eurowaarde is niet per se belangrijk."* Dat maakt
§5.1 en §5.2 minder zwaar: een saldo in punten is een feit, en de omrekening was altijd de zwakste
schakel. Het scherm toont geen euro-waarde meer.

**Het doorstuuradres bestaat: `ale@invoices.lavega.dev`**, en hij draait het zelf. Daarmee vervalt de
blokkade uit §4.3 zodra het loopt — de mailketen is dan end-to-end te testen. Let op wat er dan nog
overblijft: de CORS-preflight op de ophaalkant is een ANDER probleem en gaat hier niet mee weg.

### Nog open


| # | De vraag | Waarom niemand anders hem kan beantwoorden |
|---|---|---|
| **V2** | **Is `enumerated-absence` sterk genoeg bewijs?** Zes regels in `staging-points.json` leunen erop: een complete eigen productopsomming waarin punten ontbreken, terwijl de aanbieder nergens zegt "wij hebben geen punten" | Consistent met hoe ICS, ABN en Rabobank al op 0.0 staan. Accepteert hij het niet, dan blijven die zes leeg — één regel werk, maar het is zijn lat |
| **V4** | **De belastingoptimalisatie** (R2-15). Er ligt een voorstel: `docs/superpowers/specs/2026-08-20-belastingoptimalisatie-design.md` | Zijn woorden waren *"I'm thinking I do something here"* — een open brief, nog geen opdracht |
| **V5** | **Kleuren en fontgroottes** | Zijn eigen instructie: pas als de inhoud staat. Nu duur, straks goedkoop |
| **V6** | **Wat de chatwidget wordt** | Uit de chrome gehaald, zijn `[later]` |
| **V7** | **Meldingen in het profiel** | Er is nog geen meldingsmechanisme in de app, dus er valt nog niets in te stellen. Eerst de functie |
| **V8** | **Disclaimers en voorwaarden** | Bij lancering, niet in het werkscherm |
| **V9** | **Enable Banking met meerdere rekeningen** | Zijn instructie: na de MVP. Zie ook §1.1 — dat gat komt eerst |

---

## 7. Besluiten die blijven gelden

Geen open werk, wel de grond waar het open werk op staat. Niet weggooien: dit is waar de specs naar
verwijzen.

### 7.1 De houding van de extensie

Het extensieplan (`docs/superpowers/specs/2026-08-20-checkout-extension-implementation-plan.md`)
neemt deze vier regels als gegeven en herhaalt ze niet:

- hij leest de merchant en het bedrag van de pagina, en **niets anders** — geen pagina-inhoud, geen
  formuliervelden, geen cookies, geen geschiedenis;
- hij houdt geen saldi. Hij vraagt het de LaVega-tab en toont het antwoord; de kluis blijft waar hij
  is;
- hij belt nooit naar huis. Ontbreekt een cijfer in de catalogus, dan zegt hij **onbekend** in plaats
  van het midden in een afrekening op te zoeken;
- opt-in per site, standaard uit — dezelfde vorm als elke andere agent hier.

Waarom dit in LaVega hoort en niet los: een extensie die "gebruik kaart X" zegt, gokt. Een extensie
met de catalogus eronder — per product de koersopslag, cashback en punten, elk met bron en datum —
antwoordt. `packages/core/src/returns.ts` rangschikt al op wat een uitgave oplevert en `travel.ts`
prijst al een hele reis. De extensie is een nieuw **oppervlak** op werk dat er is.

### 7.2 Facturen komen binnen via een doorstuuradres; OAuth is v2

Elke gebruiker krijgt `<slug>-<random>@invoices.lavega.dev` en stuurt facturen door. Cloudflare Email
Routing plus een Email Worker POST't naar de n8n-webhook, en alles daarna is de pijplijn die al
gebouwd en gedebugd is. Ontwerp:
`docs/superpowers/specs/2026-08-17-invoice-forwarding-address-design.md`.

Waarom niet meteen "Connect Gmail": `gmail.readonly` is een **restricted** scope, dus een publieke
app heeft OAuth-verificatie **plus een CASA Tier 2-beoordeling, elke 12 maanden opnieuw**, vanaf zo'n
$3.000 — een rekening vóór de eerste klant, in ruil voor toegang tot de hele mailbox. Dext, Hubdoc en
Xero doen het allemaal via een doorstuuradres.

Twee dingen die deze route uitstelt en die niet vergeten mogen worden:

1. **Het adres ÍS een credential.** Voor één operator werkt de pull, want zijn browser kent zijn
   eigen webhook-URL en token. Bij vreemden zijn die URL en dat token voor iedereen hetzelfde, en
   scheidt alleen het willekeurige deel van het adres de ene wachtrij van de andere. Wie je volledige
   adres kent, kan je wachtrij ophalen. Dat is aanvaardbaar voor een MVP en het is hoe meerdere
   "stuur je bonnen hierheen"-producten echt werken — maar het moet **in de UI staan** in plaats van
   ontdekt worden. De vervanging, zodra er echte gebruikers zijn: bind de wachtrij aan de kluis in
   plaats van aan het adres.
2. **Operator en gebruiker zijn verschillende mensen.** De n8n base-URL en API-key zijn van de
   OPERATOR, eenmalig. Een gebruiker hoort ze nooit te zien, hoort niet te weten dat n8n bestaat en
   hoort geen sleutel te houden voor infrastructuur die hij niet draait. Hij ziet precies één ding:
   zijn doorstuuradres.

Beperkingen van OAuth, opgeschreven zodat ze niet opnieuw ontdekt worden: restricted scope met
jaarlijkse betaalde beoordeling; achtergrondsync vraagt een **server-side refresh token** met
staande toegang tot de hele mailbox (de browser is dicht als de job draait — dat beëindigt
local-first voor deze functie en botst met `CONTEXT.md`); versleutelen naar de publieke sleutel van
de gebruiker helpt alleen *at rest*, want tijdens extractie staat de platte tekst in servergeheugen;
n8n wordt één workflow over veel gebruikers, met een HTTP Request-node per token, want de Gmail-node
bindt aan één credential. En **Outlook is mogelijk de goedkopere eerste OAuth** — publisher
verification, voor zover bekend zonder betaalde jaarlijkse beoordeling; te verifiëren voordat er iets
op gepland wordt.

Niets van de doorstuurroute is weggegooid werk: extractie, wachtrij, bevestigen-voor-boeken en dedup
zitten allemaal ná de vraag hoe de mail binnenkwam.

### 7.3 LaVega configureert n8n zelf, en waarom dat browser-direct blijft

Zijn keuze: één keer de n8n base-URL en een API-key plakken, de rest doet LaVega. Wat dat weghaalt:
JSON exporteren en importeren, een token maken, de Header Auth-credential aanmaken, de webhook-URL
overtypen en op "Ophalen" drukken.

**Wat in geen enkele variant te automatiseren is:** de Gmail-credential koppelen. Google's consent is
met opzet interactief, en n8n's publieke API kan bewust geen credentials *opsommen*, dus LaVega kan
de credential die hij al maakte niet vinden en binden. Dat blijft één handmatige stap en de UI hoort
dat gewoon te zeggen in plaats van te lijken te falen.

**De voorwaarde die hij moet zetten, en meteen de reden dat het misschien niet werkt:** n8n's REST
API stuurt standaard geen CORS-headers, dus een browser kan hem niet cross-origin aanroepen. Op zijn
eigen instance zijn dat twee variabelen:

    N8N_DEFAULT_CORS=true
    N8N_CORS_ALLOW_ORIGIN=https://lavega.dev,http://localhost:5174

De aanroep in de **browser** houden is wat de houding bewaart: de n8n API-key raakt de LaVega-server
nooit. Server-side proxyen zou CORS omzeilen maar parkeert een sleutel die workflows kan maken en
wijzigen op een gedeelde host — een slechtere ruil dan het handmatige plakken dat het vervangt.

Dus: browser-direct bouwen, en als CORS het blokkeert **die twee variabelen in de foutmelding
noemen** in plaats van een algemene fout. Het handmatige plakken blijft bestaan en moet blijven
werken — dat is de weg die niets van zijn n8n nodig heeft.

### 7.4 De catalogus is het einddoel, en hij ververst zichzelf

**Elk geldproduct dat een Nederlander kan gebruiken, met een waarde, een bron, een datum en de
voorwaarden, op een schema ververst, als voeding voor elke agent.** 124 producten in
`docs/catalog/watchlist.md`, 122 in `catalog.json`, elke maandag 05:00 UTC opnieuw gesweept.

Niet af zolang niet alle vier de delen er voor allemaal zijn. Een tarief zonder zijn voorwaarden is
geen dekking: 104 van de 124 kopcijfers zijn voorwaardelijk, en Revolut's 0% stond ooit bovenaan in
de app op een tarief dat € 1.000 de maand in verloopt.

### 7.5 Waarom dit product bestaat — het pijnpunt uit het klantgesprek

Uit een gesprek met een Duitse zzp'er, en het is een pijn en geen feature-verzoek: in Duitsland moet
je vennootschapsbelasting **vooruit** betalen zodra je inkomen maakt. 1M winst → 250k aan het begin
van het volgende jaar. Mensen geven geld uit dat nooit van hen was.

Ontwerp voor **de onverwachte voorafbetaling**. Dat is net zo goed een forecast- en
reserveringsprobleem als een belastingregelprobleem, en LaVega heeft de machinerie er al voor
(BTW-reservering plus ingeplande stromen). Het is ook de reden dat belastingregels de **landkeuze van
de gebruiker** moeten volgen en niet NL-only mogen zijn.
