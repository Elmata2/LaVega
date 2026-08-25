# LaVega — backlog

Bijgewerkt **25 augustus 2026**. Basis: de drie app-reviews van 20 augustus
(`docs/reviews/2026-08-20-app-review.md`, `-2.md`, `-3.md`), plus §0b hieronder voor wat er op
24–25 augustus bij is gekomen en gesloten.

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

## 0b. Afgesloten op 24–25 augustus

Zes commits op `master` (`1048eff`, `8e7b54a`, `7143b82`, `99f2cf5`, `2cf7232`, plus de
cofounder-commits `88c67c6`/`c9f1fa9` na goedkeuring van drie `NEEDS_APPROVAL`-deploys). Wat hierin
staat vervangt de cijfers in §2.2 en de openstaande vraag in §2.1 — die twee secties liepen 25 augustus
achter de werkelijkheid aan en zijn hieronder bijgewerkt.

| Wat | Uitkomst |
|---|---|
| §2.1, voorstel 1 (kaartkosten-FX-gaten + ING-puntendata, 20 aug) en voorstel 2 (`staging-account-fees.json`) | **Samengevoegd.** `catalog.json`: 185 → 192 producten, `accountFee` 89 → 107, `fxFeePct` 73 → 83 |
| Zeven kaarten zonder `fxFeePct` die wél reizen (gevonden via een productieregel: `79 accepted, 113 refused`) | **Vier erin** (ING Creditcard More/Extra/Max, Bleap — uit documenten die de catalogus al citeerde), **drie blijven leeg met een gemeten reden** (Wise publiceert geen kaart-FX-percentage; Wirex' eigen artikel heeft nul FX-treffers en drie andere paden geven 404; bunq crypto is geen kaart). `83 accepted, 109 refused` is het nieuwe productiecijfer |
| §2.3, `ing-betaalpas`-datum | **Bevestigd correct.** Het ING-kostenoverzicht zelf zegt "geldig vanaf 15 juni 2026" — precies de `checkedAt` die er al stond. Staat nog op `route: "agent"` in plaats van `provider-pdf`, wat een onderwaardering is en geen fout in het cijfer |
| Extensie: `bepaalClaim` gaf altijd een caveat bij een niet-lege voorwaardentekst, dus basis "netto" was onbereikbaar | **Gerepareerd.** Herkomstnotitie en beperking worden nu onderscheiden; bij twijfel blijft het een beperking. Gemeten: 0 netto-rijen op de echte bundel, in EUR en USD — de tak leeft maar is op de data van vandaag onbereikbaar |
| Extensie: ING Winkel las nul artikelen | **Twee fouten, allebei gemeten door de eigenaar.** Het adres stond op `www.ing.nl/punten`, hij zat op `mijn.ing.nl/punten/overview` — de voorwaarden van ING noemden de ingang, niet de pagina. En de kaarten staan in open shadow roots; `collectIngWinkel` piercet ze nu, met plafonds tegen een pathologische pagina. Sluitende roots en iframes geven bewust een eerlijke "kan hier niet in kijken"-zin in plaats van een gok |
| `docs/n8n/2026-08-24-workflow-diagnose.md`: de wachtrij-leegmaker zat op het mailpad | **Gecorrigeerde workflow klaar** (`docs/n8n/lavega-facturen-workflow.json`) plus een permanente structuurwacht (49 tests). **Nog niet geïmporteerd in n8n — wacht op de cofounder die de Cloudflare-kant aanpast.** Zie §4.3 |
| `/investing/` laadde een blanco pagina | **Root cause was Turbo, niet Vite:** `envMode: "strict"` filterde `INVESTING_WEB_BASE` uit de tweede, overschrijvende build. Hernoemd naar `VITE_INVESTING_BASE` (Turbo laat `VITE_*` automatisch door), dubbele build eruit, een build-poort die het image laat falen als de base terugvalt. **Live bevestigd na deploy:** `/investing/assets/…` geeft 200 text/javascript, het oude pad geeft nu 404 in plaats van stil 200 HTML |
| Belastingspec van 20 augustus, Richting A | **Was al gebouwd** — `vatPosition` (tax.ts) draagt stage/basis/coverage/rulesAsOf, het lopende kwartaal geeft `status: "expected"`, een teruggave wordt zichtbaar. Niets aan te sluiten |
| Belastingspec, Richting B | **Gebouwd** (`packages/core/src/crossScope.ts`, module "Privé en zakelijk" op Belasting). Meet oversteken BV↔Privé zonder oordeel — alleen een vraag per stroom. Signaal 1 (gebruikelijkloon) bewust niet gebouwd, geen loonadministratie; signaal 2 (box-2) bewust niet gebouwd, "closest thing to advice"; geen boekhouder-export, hij zei nee. **Nog niet gepusht** — lokaal gecommit, wacht op: rekeningen samenvoegen vóór hij de cijfers leest (een dubbel geïmporteerde rekening verdubbelt elke oversteek erop), en de verbogen vormen in de woordwacht (`besparen`, `adviseren`, `moet je` komen er nu doorheen) |

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

### 2.1 Afgesloten op 24 augustus — zie §0b

De twee voorstellen van 20/21 augustus (kaartkosten-FX-gaten + ING-puntendata, en
`staging-account-fees.json`) zijn samengevoegd, plus twee nieuwe rondes op 24 augustus (de acht
grootbanken, en de zeven FX-gaten). Details en de precieze uitkomst staan in §0b.

**Nog wél open uit deze paragraaf:** de zes `enumerated-absence`-regels in `staging-points.json`
wachten nog op de algemene beslissing uit §6 (V2) — dat is een andere vraag dan de zeven die op
24 augustus wél zijn afgehandeld, op zijn eigen gezag en niet op de bewijssoort.

### 2.2 Wat de catalogus vandaag dekt, gemeten (25 augustus)

**192 producten** in `catalog.json` (gegenereerd 2026-08-24). Per veld:
**83** `fxFeePct`, **107** `accountFee`, **58** `pointsPerEuro`,
**32** `interestPct`, **8** `cashbackPct`.

Twee dingen die daarin verstopt zitten en die elke agent raken:

- **Van de puntencijfers zijn er 14 groter dan nul, en die 14 zijn állemaal American Express.**
  Buiten Amex heeft geen enkel product een aantoonbare koers per bestede euro. Ongewijzigd na
  24 augustus — die rondes raakten alleen `accountFee` en `fxFeePct`.
- **Cashback staat op 8, en daarvan draagt Bleap en Wirex nu ook een prijs (was 0, sinds 24
  augustus 2).** Dat is precies wat de nettotak van de extensie nodig had — en toch komt hij er niet
  doorheen: allebei hebben een voorwaarde die de nettoclaim blokkeert (bij Bleap kunnen er
  netwerkkosten bijkomen, bij Wirex is de uitkering geen euro's maar Cryptoback). Een kaart met
  cashback IN EURO'S én een prijs bestaat nog niet in de catalogus.

### 2.3 Twee datums dragen mogelijk de dag dat wij keken

Huisregel: elk cijfer draagt de datum die *het document* noemt, niet de dag dat wij keken.

**`ing-betaalpas` is op 24 augustus opgelost — het was geen fout.** De vondst kwam terzijde, tijdens
het uitlezen van hetzelfde ING-kostenoverzicht voor de FX-gaten-ronde (§0b): het document zelf zegt
"Deze brochure is geldig vanaf 15 juni 2026", en dat is precies de `checkedAt` die er al stond. De
bestandsnaam met `2023` erin wees dus niet naar een oude controle. Wat nog wel klopt: de rij staat op
`route: "agent"` terwijl het cijfer nu uit een gedateerd providerdocument bevestigd is — een
onderwaardering, geen foute waarde, en goedkoop recht te zetten in dezelfde pass als een volgende
Amex-ronde.

Twee blijven kandidaat, niet vondst, uit een telling van 21-08 (het jaartal in de `sourceUrl`
vergeleken met het jaartal in `checkedAt`):

| Regel | Veld | Staat er nu | Waar de twijfel op rust |
|---|---|---|---|
| `american-express-corporate-gold-card` | `fxFeePct` | `2026-08-19` | URL-pad `…/2022-12-15/…`, PDF-`CreationDate` 7 december 2022 — **bevestigd** |
| `zeal-card-gnosis-pay-rails` | `fxFeePct` | `2026-04-27` | Zendesk-API `updated_at: 2026-08-12`, `created_at: 2025-07-21` — **bevestigd** |
| `klm-american-express-corporate-card` | `fxFeePct` | `2026-08-19` | URL-pad `…/2022-12-15/…`, bestand `NL_KLM_Corporate_Cardmember_TCs_**Dec2022**.pdf` — idem |

Een jaartal in een URL is geen bewijs van de datum die het document zelf noemt — ze horen opengemaakt
te worden. De eerste en de derde zijn allebei Amex-rijen, en Amex is intussen het oudste cluster in
de catalogus: elf
FX-cijfers staan op `2022-03-01` en zijn `route: "agent"` (§0b), terwijl Amex de enige uitgever is
waar alle veertien puntencijfers groter dan nul van komen (§2.2). Eén Amex-sweep zou dit hele blok in
één keer meenemen.

### 2.4 Verkoopfacturen tellen niet mee in de btw-positie (25 augustus, niet bevestigd)

Bij BV1 telde een inkoopfactuur wél mee in de btw-module, een verkoopfactuur (de Penshee-factuur,
btw verlegd wegens export naar UK) niet — het scherm gaf zelf de reden: `omzetfacturen-onbekend`,
*"In deze periode staan alleen inkoopfacturen"*.

**Al uitgesloten als oorzaak, met de code erbij:** de vertaling van n8n's `"income"|"expense"` naar
`Invoice.direction` (`"in"|"out"`) staat correct in `apps/web/src/n8n.ts:277`
(`row.direction === "income" ? "in" : "out"`), en `invoiceVatInWindow` in `packages/core/src/invoices.ts:166`
telt `direction === "in"` terecht als omzet. Geen vertaalfout in die laag.

**Leidende hypothese, niet gecontroleerd:** de Penshee-factuur staat waarschijnlijk nog in de
wachtrij ter beoordeling in Facturen en is nooit bevestigd — dan telt hij nergens mee, en is er geen
bug. Niet verder onderzocht omdat cache/browserstaat het testen nu kon vertroebelen. Eerste stap
zodra dat weer schoon te testen is: checken of die factuur al als bevestigde rij in de lijst staat
("AR · inkomend") of nog in de beoordelingssectie.

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

### Het doorstuuradres bestaat sinds 23 augustus, de n8n-workflow zelf niet meer (25 augustus)

Het doorstuuradres was het eerste blokkade en is opgelost: `ale@invoices.lavega.dev` bestaat en de
eigenaar draait het zelf (§6, "Beantwoord op 23 augustus"). Dat maakte de mailketen end-to-end
testbaar — en die test vond een ERNSTIGER probleem terug dan de oude CORS-preflight.

**De diagnose van 24 augustus** (`docs/n8n/2026-08-24-workflow-diagnose.md`): de webhook die de
wachtrij ophaalt staat op GET, LaVega's eigen `n8n.ts` doet ook GET — dat matcht — maar de node die
de wachtrij LEEGT zit op het MAILPAD, niet achter de ophaalkant. Zodra een factuur wordt
doorgestuurd, leegt hij de hele wachtrij voordat de app hem heeft opgehaald. n8n antwoordt daarbij
met 200, dus het dataverlies leest als succes.

**Stand op 25 augustus:** de gecorrigeerde workflow staat klaar
(`docs/n8n/lavega-facturen-workflow.json`) met een permanente structuurwacht van 49 tests
(`apps/web/src/n8n-workflow.test.ts`, commit `7143b82`). **Nog niet geïmporteerd in een echte n8n** —
niets hiervan is tegen een draaiende instantie getest. Blokkeert op de cofounder, die de
Cloudflare-webhookkant aanpast; zodra dat staat kan de gecorrigeerde workflow geïmporteerd en de
negen controlestappen uit de diagnose doorlopen worden.

De oude CORS-preflight op de ophaalkant (Allowed Origins op de Webhook-node) is een apart probleem
en is niet vanzelf meegelost.

**Wat intussen wél werkt:** de PDF in Facturen slepen (werkt, bevestigd) en de nepwachtrij met
`--rows` en zijn eigen cijfers.

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

**V2 — de zeven `enumerated-absence`-regels staan op nul, maar op een ANDERE grond dan gevraagd.**
Zijn woorden: *"ik weet dat er voor die banken geen puntenschema's zijn en verwacht niet dat die
binnenkort zullen komen."* Dat is geen instemming met de bewijssoort maar iets sterkers: een
uitspraak van de eigenaar, en in deze app verslaat een gebruikersfeit elke agent. De zeven dragen
daarom `sourceUrl: user:eigenaar-2026-08-24` en zeggen in hun voorwaarden dat de nul op zijn gezag
rust en niet op een zin van de aanbieder. `enumerated-absence` als losstaande bewijssoort is dus nog
steeds NIET aanvaard — er is alleen geen zaak meer die erop wacht.

Het waren er zeven en niet zes; deze backlog telde er een te weinig. Het gaat om vier ICS-zakenkaarten,
Knab, Triodos en Trade Republic.

**De vier verdachte datums (§2.3): later.** Zijn woorden: *"datum kunnen we later testen."*

**De euro-waarde van een punt: niet belangrijk.** *"Eurowaarde is niet per se belangrijk."* Dat maakt
§5.1 en §5.2 minder zwaar: een saldo in punten is een feit, en de omrekening was altijd de zwakste
schakel. Het scherm toont geen euro-waarde meer.

**Het doorstuuradres bestaat: `ale@invoices.lavega.dev`**, en hij draait het zelf. Daarmee vervalt de
blokkade uit §4.3 zodra het loopt — de mailketen is dan end-to-end te testen. Let op wat er dan nog
overblijft: de CORS-preflight op de ophaalkant is een ANDER probleem en gaat hier niet mee weg. (En
die eindtest vond op 24 augustus meteen een ernstiger probleem — zie de bijgewerkte §4.3.)

### Beantwoord op 24–25 augustus

**V4 — geen boekhouder-export; Richting A afmaken als het makkelijk is; Richting B afmaken.**
Richting A bleek al gebouwd (niets aan te sluiten). Richting B is gebouwd in de vorm die overblijft
zonder loonadministratie — de gebruikelijkloonmeter (signaal 1) is expliciet niet gebouwd op zijn
eigen woorden *"het is niet voor DGA's met loon, het is gewoon inkomen al belast met btw"*, en de
box-2-kalender (signaal 2) is ook niet gebouwd, want de spec noemt hem zelf al *"the closest thing to
advice in the entire proposal"*. Details en de twee openstaande gebreken (dubbele rekeningen
verdubbelen een oversteek; de woordwacht mist verbogen vormen) staan in §0b. **Nog niet gepusht.**

### Nog open


| # | De vraag | Waarom niemand anders hem kan beantwoorden |
|---|---|---|
| **V2** | **Is `enumerated-absence` sterk genoeg bewijs?** Zes regels in `staging-points.json` leunen erop: een complete eigen productopsomming waarin punten ontbreken, terwijl de aanbieder nergens zegt "wij hebben geen punten" | Consistent met hoe ICS, ABN en Rabobank al op 0.0 staan. Accepteert hij het niet, dan blijven die zes leeg — één regel werk, maar het is zijn lat |
| **V5** | **Kleuren en fontgroottes** | Zijn eigen instructie: pas als de inhoud staat. Nu duur, straks goedkoop |
| **V6** | **Wat de chatwidget wordt** | Uit de chrome gehaald, zijn `[later]` |
| **V7** | **Meldingen in het profiel** | Er is nog geen meldingsmechanisme in de app, dus er valt nog niets in te stellen. Eerst de functie |
| **V8** | **Disclaimers en voorwaarden** | Bij lancering, niet in het werkscherm |
| **V9** | **Enable Banking met meerdere rekeningen** | Zijn instructie: na de MVP. Zie ook §1.1 — dat gat komt eerst |

### V10 — een zachte, merknaam-gebaseerde melding op basis van de ING-lezing (GEBOUWD, 25 augustus)

De echte ING Winkel is nu gelezen en werkt: 9 kortingsvouchers, waaronder "JBL Tune Flex 2 (zwart)
voor € 55 kortingsvoucher". Zijn vraag: als hij op jbl.nl of bol.com afrekent, kan de extensie dan
melden dat er op zijn ING-punten een voucher voor DIT merk klaarstaat?

**De domeinkoppeling (`hoortBijWinkel`, `aanbod-kern.ts:281`) kan dit niet — met opzet.** Die matcht
op een echte link IN de kaart, en de ING-kaarten linken naar `ing.nl`, niet naar de fabrikant. Dat is
bewust: "korting hier" zou een aankoop BIJ ING presenteren als inwisselbaar bij de winkel waar hij
staat, en dat is de fout die de code al eens afwees.

**Maar een ZACHTERE claim is iets anders, en dat is waar deze V10 om vraagt.** "Je kunt hier korting
krijgen door naar mijn.ing.nl/punten te gaan en daar een voucher te halen" claimt geen directe
inwisseling op déze kassa — het is een verwijzing, niet een belofte over wat hier gebeurt. Dat is geen
onwaarheid op dezelfde manier als de domeinclaim.

**Gebouwd als een tweede, zwakkere match binnen de bestaande extensie-architectuur** — geen los
"agent"-proces, gewoon een extra `AanbodUitkomst`-tak: `mogelijkeMerknaamMatch` in `aanbod-kern.ts`,
alleen aangeroepen door `aanbodVoorWinkel` voor een
PUNTEN-bron (nooit voor Amex/korting, dat blijft strikt op domein). Matcht het eerste domeinlabel van
de winkelhost (bv. "jbl" uit "jbl.nl") als los woord in de titel, minimaal 3 tekens. Resultaat is een
eigen, zwakkere uitkomst (`mogelijke-merknaam-match`) met een eigen zin in `lines.ts` die GEEN
aanbieding claimt — alleen "in je ING Punten staat een titel die hierbij kan passen, check zelf in
mijn.ing.nl of dit hier te verzilveren is". Getest in `amex.test.ts` (shared kernel, inclusief de
namaakwinkel-casus en dat een korting-bron dit nooit krijgt) en `ing.test.ts` (echte titel, afkapping
bij >3 matches).

**Punt 2 is bewust NIET beantwoord, en dat is waarom de zin zo zwak geformuleerd is.** Verzilvert die
ING-voucher zich bij de fabrikant zelf, of blijft de hele transactie bij ING? Twee gecheckte bronnen
(ING's eigen voorwaarden-PDF, twee onafhankelijke uitlegpagina's) laten dit onbeantwoord; ing.nl's
eigen FAQ is vanaf deze machine niet te bereiken (Akamai-botbeheer). De gekozen zin claimt daarom
zelf geen verzilvering — hij wijst er alleen naar. Als hij zelf ooit een voucher bestelt en ziet wat er
precies gebeurt, kan die zin scherper (of losser).

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
