# Tegenspraak — apps/extension

Opdracht: probeer deze extensie af te keuren. Wat hieronder staat is een oordeel,
geen reparatie. Er is geen regel code veranderd.

Alles is nagemeten. Waar ik niets vond staat het commando erbij; waar ik iets
vond staat het bestand, de regel en de uitkomst erbij. Eigen fixtures staan
BUITEN de repo, in de scratch-map, en zijn nergens neergezet.

**Uitkomst in één zin:** de privacy- en rechtenkant is echt schoon — schoner dan
de meeste extensies die ik lees — en de adviesskant klopt niet. Van de 77
gebundelde kaarten kan er geen enkele een netto-uitkomst opleveren, en de acht
die überhaupt een aanbeveling kunnen dragen zijn crypto-kaarten waarvan de
voorwaarden wél in de bundel zitten en nergens gelezen worden. Het eindoordeel
staat onderaan.

---

## 1. Lekt er iets?

**Oordeel: nee, er gaat niets naar buiten. Maar twee van de drie hekken die dat
moeten bewaken, staan open.**

### Wat ik heb gedraaid

```bash
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|new Image\(|\.src *=|import\(" \
  src public scripts --include='*' | grep -v '__fixtures__'
grep -rnoE "https?://[^ \"')]+" src public scripts --include='*' | grep -v __fixtures__ | grep -v generated/catalog
```

De eerste grep geeft **alleen treffers in `scripts/copy-static.mjs`** — dat zijn
de naalden van de buildcontrole zelf en één `await import()` van een lokaal pad
(regel 119). Nul treffers in `src/` en nul in `public/`.

De tweede geeft twee soorten URL's: `https://www.ikea.com/nl/nl/p/*` (matchpatroon,
geen verkeer) en `https://voorbeeld.nl/...` in testbestanden. In de gebundelde
catalogus staan bron-URL's als tekst; die worden nergens opgevraagd — `sourceLine`
in `lines.ts:93` toont alleen de datum, niet de URL.

Het paneel gebruikt uitsluitend systeemfonts (`content.ts:54`). Geen remote script,
geen remote font, geen extern beeld. `chrome.d.ts` bevat vier namespaces en geen
enkele die het netwerk raakt.

### B1 — de netwerkcontrole in de build kijkt alleen naar `.js` — MATIG

`scripts/copy-static.mjs:174`

```js
if (!naam.endsWith(".js")) continue;
```

`public/` levert `popup.html`, `options.html`, `stijl.css` en `manifest.json` mee
naar `dist/`. Die worden door de controle overgeslagen, waarna de build afsluit
met `ok — geen netwerkaanroepen in de bundel`.

Nagemeten op een KOPIE in de scratch-map (repo niet aangeraakt): ik heb aan
`stijl.css` een `@font-face` met `fonts.gstatic.com` en een `background-image`
naar `tracker.example.com` toegevoegd, en aan `popup.html` een 1×1 `<img>` met
`?bedrag=4999` in de querystring. Uitkomst:

```
[copy-static] ok — geen netwerkaanroepen in de bundel
[copy-static] dist/ is klaar om te laden via "Laad uitgepakte extensie".
EXITCODE=0
dist/stijl.css:2   ← beide URL's staan er gewoon in
dist/popup.html:1
```

Waarom dat fout is: dit is het hek waar de README (regel 105-109) naar wijst als
bewijs dat er niets naar buiten gaat. Een hek dat één van de twee poorten niet
bewaakt, is precies zo betrouwbaar als de poort die het níét bewaakt — en de
poort die het niet bewaakt is degene waar een trackingpixel doorheen gaat, mét
het bedrag erin. Vandaag is er geen lek. De controle die dat morgen moet
tegenhouden, houdt het niet tegen.

### B2 — de CSP noemt scripts en verbindingen, maar geen beeld, font of stijl — MATIG

`public/manifest.json:42-44`

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'none'"
}
```

Er staat geen `default-src`, dus er is niets om op terug te vallen: `img-src`,
`font-src`, `style-src` en `media-src` zijn onbeperkt. Samen met B1 betekent dat:
de pixel uit het experiment hierboven passeert de build én zou door Chrome geladen
worden. `connect-src 'none'` vangt `fetch`/XHR/WebSocket, en dat is de aanval die
iedereen verwacht — niet de aanval die een `<img>` is.

Dit is gelezen uit het manifest en uit het MV3-CSP-model, niet gemeten in een
draaiende Chrome. De maatregel is één regel: `default-src 'self'` erbij.

### B3 — `connect-src 'none'` dekt het content script niet — KLEIN

`extension_pages` geldt voor extensiepagina's en de service worker. Het content
script draait in de pagina van de winkel en valt er buiten. In `content.ts` staat
geen netwerkaanroep (gemeten, zie de grep), en `copy-static` scant `content.js`
wél omdat het `.js` is — dus het is gedekt, alleen niet door wat `chrome.d.ts:17-19`
en de README als de dekking presenteren. Waard om de zin te corrigeren, niet om
iets aan te bouwen.

---

## 2. Hoe breed zijn de rechten?

**Oordeel: smal, en verdedigd. Twee kanttekeningen, geen overtreding.**

Letterlijk in `public/manifest.json:36-40`:

```json
"permissions": ["storage", "scripting"],
"host_permissions": [],
"optional_host_permissions": ["https://www.ikea.com/nl/nl/p/*"]
```

- Geen `<all_urls>`, geen wildcard-subdomein, geen `tabs`, geen `cookies`, geen
  `webRequest`, geen `history`. `chrome.d.ts` bevat exact vier namespaces
  (`runtime`, `storage`, `permissions`, `scripting`), dus iets anders aanroepen
  kost iemand een bewuste regel in dat bestand.
- `host_permissions` is leeg en de build weigert het tegendeel
  (`copy-static.mjs:111-114`). Bij installatie heeft de extensie nul leesrecht.
- `scripting` is nodig voor `registerContentScripts` én `executeScript`, en beide
  werken alleen op een host waarvoor toestemming ís gegeven. Het recht verbreedt
  het bereik dus niet.
- `activeTab` was hier geen alternatief: het paneel hoort te verschijnen bij het
  laden van de pagina, en `activeTab` bestaat pas na een klik op het icoon. De
  popup, die wél na een klik komt, leest juist helemaal geen pagina — dat is de
  betere keuze dan `activeTab` en die is gemaakt.

### R1 — de belofte "niet de winkelwagen, niet je account" wordt door niets in deze code afgedwongen — MATIG

`sites.ts:103` zet die zin in de UI en `options.ts:186` toont hem onder het vinkje.
De hele belofte rust op de vraag of Chrome het PAD in een verleende optional host
permission afdwingt. In deze codebase gebeurt het niet:

- `siteForHost` (`sites.ts:120-126`) matcht **alleen op het hostdeel** — het
  commentaar zegt dat zelf en schuift het pad door naar Chrome.
- `beantwoord` (`background.ts:163-173`) roept `executeScript` aan op
  `{ target: { tabId } }`. Er wordt nergens gekeken naar de URL of het pad van dat
  tabblad, en er wordt geen `documentIds` meegegeven om de lezing vast te pinnen
  aan het document dat erom vroeg.

De bouwer noteert zelf dat het toestemmingsdialoog nooit is gedraaid. Dan is de
zin onder het vinkje een bewering die op een aanname rust, en dat is precies wat
regel 2 verbiedt. Het experiment is klein: vink IKEA aan in een echte Chrome, lees
af wat het dialoog zegt (origin of pad), en probeer daarna
`chrome.permissions.contains({origins:["https://www.ikea.com/nl/nl/winkelwagen/"]})`.
Komt daar `true` uit, dan moet de zin veranderen.

### R2 — de test die dit zou bewaken, test iets anders dan zijn naam — KLEIN

`sites.test.ts:22` heet *"staat nooit `<all_urls>` toe, en ook geen kaal domein
zonder pad"*. De vier asserties eronder controleren dat tweede niet. Nagemeten
met de vier asserties uitgeschreven:

```
PASSEERT sites.test.ts   https://www.ikea.com/*          ← kaal domein
valt om                  https://*.ikea.com/*
PASSEERT sites.test.ts   https://www.ikea.com/nl/nl/p/*
valt om                  http://x.nl/*
```

In het bestand waarvan de kop zegt *"elke host moet te verantwoorden zijn"* is dit
de ene test die de belangrijkste helft niet vasthoudt.

---

## 3. Wordt er iets bewaard dat niet bewaard mag worden?

**Oordeel: nee. Geen bevinding.**

```bash
grep -rn "chrome.storage" src --include='*.ts' | grep -v '\.test\.'
```

Vijf treffers, allemaal in `store.ts` (regel 47, 52, 56, 61) plus één
`onChanged`-listener in `background.ts:130` die alleen kijkt of de sleutel
`enabledSiteIds` is veranderd en dan hersynchroniseert.

Twee sleutels, `store.ts:27-28`: `heldIds` en `enabledSiteIds`. Allebei gaan ze
heen én terug door `schoonLijst` (`store.ts:33-44`): alleen strings, getrimd,
ontdubbeld, maximaal 200. Er is geen derde schrijfpad.

Wat er dus níét in staat, en ik heb er gericht op gezocht: geen bedragen, geen
`amountCents`, geen host, geen URL, geen paginatitel, geen tijdstempel, geen
teller van hoe vaak het paneel verscheen. Het bewijsmateriaal uit
`collectEvidence` gaat van de pagina naar de worker, wordt daar in
`beantwoord` (`background.ts:183-200`) omgezet in zinnen, en verdwijnt met de
functie. De kaartkeuze mag en is het enige wat er ligt.

Bijvangst, geen bevinding: `setHeldIds` accepteert elke string, ook een id die
niet in de catalogus voorkomt. `rankCheckout` doet daar niets mee (`held.has(card.id)`),
dus rommel is inert.

---

## 4. Kan het advies fout zijn?

**Oordeel: ja, en dit is waar de extensie op valt.**

Eerst wat er níét fout is, want dat is ook een uitkomst:

- **Geen onbekende kaartprijs wordt als nul behandeld.** `grep -rnE "\?\? *0|\|\| *0" src`
  geeft nul treffers voor een prijs of percentage. De enige harde `0` is
  `rank.ts:146` (`fxPct = 0` bij een aankoop in euro's), en dat is een uitgesproken
  nul omdat de omrekening niet plaatsvindt — de keerzijde van regel 1, correct
  toegepast. Een kaart zonder cashbackcijfer valt uit de ranglijst
  (`rank.ts:154`), een kaart zonder feecijfer gaat naar een aparte brutogroep
  (`rank.ts:172-177`). Nergens een stille nul.
- **Het woord "netto" valt nooit in een regel waar de kosten onbekend zijn.**
  Uitputtend nagemeten over de hele gebundelde catalogus, beide muntsoorten, vier
  bedragen (inclusief `null`), elke kaart één keer als bezit en één keer niet:
  **7.792 gerenderde bruto-regels, 0 met het woord "netto".**
- **Geen factor twaalf.** `minimumCharge` (`horizon.ts:58-78`) rekent een
  jaarkaart naar boven af op hele jaren en deelt nooit door twaalf; elke
  netto-regel draagt het periodelabel mee (`lines.ts:59`).

Dan wat er wél fout is.

### A1 — geen enkele kaart in de bundel kan een netto-uitkomst opleveren — BLOKKEREND

Een netto-rij vereist `cashbackPct != null` **én** `fee != null` (`rank.ts:154`
en `rank.ts:172`). Nagemeten tegen `src/generated/catalog.generated.ts`:

```
totaal kaarten            : 77
met cashbackPct           : 8
met fee                   : 9
MET BEIDE (netto mogelijk): 0
```

De acht cashbackkaarten zijn vier Crypto.com-tiers, Bleap, Zeal, Gnosis Pay en
Wirex. De negen feekaarten zijn ABN (2×), Rabobank, SNS, RegioBank, Trade Republic,
212, Openbank en Amex Business Gold. **De doorsnede is leeg.**

Gevolg, ook nagemeten (niets aangevinkt, € 1.000,00, EUR én USD):
`openWorthIt: 0`, `openBackwards: 0`, `openUnknownCost: 8` respectievelijk `5`.

Dat betekent: `horizon.ts` in zijn geheel, `minimumCharge`, de netto-tak van
`netLine` (`lines.ts:58-64`), de groep "Kost na kaartkosten meer dan het oplevert"
— dat is allemaal dood tegen de data die daadwerkelijk meegaat. Het best
doordachte bestand in deze map draait nooit.

En dan de beweringen die daar bovenop staan:

- `public/manifest.json:5` en `README.md:3-5`: *"laat zien met welke van jouw
  kaarten je het meeste overhoudt — met de kaartkosten erin verrekend"*. Bij nul
  van de 77 kaarten wordt er iets verrekend.
- `lines.ts:123`, letterlijk op het scherm bij een lege selectie: *"Hieronder staat
  wat er te halen valt, en wat het kost om zo'n kaart te openen."* Daaronder volgt
  bij elke kaart dat we niet weten wat het kost. De kop belooft iets dat het lijf
  structureel niet kan leveren. Dat is regel 3.

Nagemeten paneel, houder van een ING betaalpas en een ABN AMRO creditcard, op de
echte IKEA-fixture (€ 49,99):

```
KOP    : Van de kaarten die je hebt aangevinkt, weten we bij geen enkele wat
         deze aankoop oplevert.
  [onbekende-kosten] Crypto.com Prepaid Card — Private (Obsidian)
      Levert € 2,50 op. Dat is het brutobedrag: …
  [onbekend] ING betaalpas    : we weten niet of deze kaart iets teruggeeft.
  [onbekend] ABN AMRO creditcard : we weten niet of deze kaart iets teruggeeft.
```

Voor de meest waarschijnlijke Nederlandse gebruiker is de enige uitkomst van deze
extensie: "over jouw kaarten weten we niets, overweeg Crypto.com Obsidian".

### A2 — de voorwaarden zitten in de bundel en worden nergens gelezen — BLOKKEREND

```bash
grep -rn "conditions" src --include='*.ts' | grep -v generated/ | grep -v '\.test\.'
# → src/types.ts:9  (commentaar)
# → src/types.ts:17 (de velddeclaratie)
```

Twee treffers, allebei de definitie. `conditions` wordt door
`scripts/bundle-catalog.ts:66-91` bewust **voluit** meegenomen — de kop van dat
bestand legt uit waarom afkappen niet mag, met crypto.com als voorbeeld — en
daarna leest niets die tekst. Niet `rank.ts`, niet `lines.ts`, niet `panel.ts`,
niet `options.ts`.

Wat er in die genegeerde tekst staat, bij precies de acht kaarten die de enige
aanbevelingen kunnen dragen:

| kaart | wat het scherm zegt | wat `conditions` in dezelfde record zegt |
| --- | --- | --- |
| Crypto.com Plus (Ruby Steel) | cashback 2% | cap **$1.250 per maand**, uitbetaald **in CRO**, alleen met lopend Level Up Plus (€3,99/mnd of €450 CRO gestaked) |
| Crypto.com Pro | cashback 3% | cap $2.500/maand, in CRO, Level Up Pro €24,99/mnd of €4.500 CRO |
| Crypto.com Private (Icy/Rose) | cashback 4% | **€45.000 CRO staking, geen abonnementsroute** |
| Crypto.com Private (Obsidian) | cashback 5% | **€450.000 CRO staking** |
| Bleap | cashback 1% | €3.000/maand plafond, en een uitsluitingslijst die o.a. software, verzekeringen en nutsbedrijven omvat |
| Gnosis Pay / Zeal | cashback 1% | ≥0,1 GNO aanhouden, $250 **per week** plafond, **programma loopt af 30 september 2026**, in GNO |
| Wirex One | cashback 0,5% | in crypto; bron van **11 januari 2024**, en de catalogus noteert er zelf bij dat de EEA-uitgever onbekend is |

Nagemeten uitkomst voor iemand die zo'n kaart wél heeft, aankoop € 4.000,00:

```
KOP: Betaal met Crypto.com Prepaid Card — Plus (Ruby Steel). Dat levert € 80,00 op.
```

Het echte getal is hooguit 2% van $1.250 ≈ € 21, in CRO, en alleen zolang er een
abonnement loopt. Het scherm zegt € 80,00 in euro's, in de gebiedende wijs, terwijl
de correctie letterlijk in dezelfde record staat. Dat is regel 2: een conclusie die
de gegevens niet dragen — en hier is het erger dan een afwezigheid, want de
gegevens spreken hem tegen.

Zelfde categorie, kleiner: `ing-platinumcard` heeft `fxFeePct: 0` met
`conditions: "0% koersopslag voor transacties tot € 1.000 per maandelijkse
incassoperiode, daarna 2,00%"`. Een voorwaardelijke nul die als onvoorwaardelijke
nul in de som gaat. Die kaart heeft geen cashbackcijfer en valt daardoor toevallig
al uit de ranglijst — maar de fout zit in `rank.ts`, niet in het toeval.

### A3 — "staat niet in onze gegevens" is niet waar — ERNSTIG

`lines.ts:70-76`:

```
Dat is het brutobedrag: wat deze kaart kost om te hebben, staat niet in onze
gegevens. Zoek dat op bij <issuer> voordat je hem opent — wat je overhoudt,
hangt daarvan af.
```

Voor Obsidian staat in onze gegevens: *"crypto.com/nl/cards prices Obsidian at
'€450,000 12-month CRO staking'"*. De zin noemt dus niet de echte oorzaak (regel 3):
de oorzaak is niet dat we het niet weten, maar dat het in `conditions` staat en
`fee` alleen een bedrag-met-periode accepteert (`bundle-catalog.ts:80-91`, terecht).
En het advies stuurt de gebruiker naar de website van de uitgever voor iets wat
al in de bundel zit.

Dit is de enige regel die de extensie met de huidige data ooit als aanbeveling
afdrukt. Hij is bij alle acht kaarten onwaar.

### A4 — de netto-groep vergelijkt een maandbedrag met een jaarbedrag — ERNSTIG (latent)

`rank.ts:203-208`, `byResult` sorteert op `resultCents`. Maar `resultCents` van een
maandkaart is "opbrengst min één maand" en van een jaarkaart "opbrengst min één
jaar". Die twee tegen elkaar afzetten is exact de fout die de kop van `horizon.ts`
verbiedt — alleen dan één laag hoger, in de volgorde in plaats van in de som.

Nagemeten met twee synthetische kaarten, beide 1% cashback, aankoop € 10.000:

```
[openWorthIt] Maandkaart  resultCents=9100  (1 maand)   ← € 9/mnd  = € 108/jaar
[openWorthIt] Jaarkaart   resultCents=4000  (1 jaar)    ← € 60/jaar
```

De duurste kaart staat bovenaan. Elke regel noemt keurig zijn eigen periode, dus
de TEKST liegt niet — maar de positie in de lijst is de uitspraak "deze is beter",
en die rust op een vergelijking van twee verschillende eenheden. Vandaag onbereikbaar
(zie A1); het slaat toe op de dag dat er één kaart met zowel cashback als fee in de
catalogus komt, en dan is er geen test die het vangt.

### A5 — de kop kan "er is niets bekend" zeggen boven een uitgerekende rij — MATIG (latent)

`lines.ts:116` telt `openWorthIt` en `openUnknownCost` mee in de leegtest, maar
`openBackwards` niet. Nagemeten met één kaart (1% cashback, € 270/jaar), aankoop € 50:

```
KOP : Er staat geen kaart aangevinkt en er is niets bekend om te vergelijken.
  regel eronder: … Netto over 1 jaar: -€ 269,50 — dat is achteruit, dus dit is
                 geen aanbeveling.
```

De kop ontkent wat er een regel lager volledig uitgerekend staat.

### A6 — de kostenregel in het optiescherm staat in het Engels genoteerd — KLEIN

`options.ts:63`: `` `kosten € ${c.fee.value} per ${c.fee.period}` ``. Ruwe
JavaScript-nummers, geen `money.ts`. Letterlijk op het scherm:

```
ABN AMRO creditcard : "kosten € 2.55 per maand"
SNS creditcard      : "kosten € 37.5 per jaar"
Rabobank creditcard : "kosten € 2 per maand"
```

`€ 37.5` is in een Nederlands scherm misleesbaar (€ 37,05? € 37,50?), en
`money.ts` bestaat precies hiervoor — `options.ts` importeert er al `pct` en
`dateNL` uit. Regel 6.

### A7 — de uitgeversnaam wordt midden in een Nederlandse zin geplakt — KLEIN

`lines.ts:73` interpoleert `card.issuer`. Uitkomst, ongewijzigd:

```
Zoek dat op bij Wirex; card issuer previously UAB PayrNet, current EEA issuer
not stated on any readable page voordat je hem opent — …
```

De bouwer noemt dit zelf als openstaand punt en schuift het naar de datakwaliteit.
Dat klopt half: het veld is rommelig, maar de zin die het onbewerkt in een
Nederlandse hoofdzin plakt staat in `lines.ts`, en dat is het bestand waarvan de
kop zegt dat een zin een uitspraak is die getest hoort te worden.

### Bijvangst: de testsuite raakt de verzonden data niet aan

```bash
grep -rn "CHECKOUT_CARDS\|catalog.generated" src/*.test.ts   # → geen treffer
grep -rln "background\|content\.js\|popup\.js\|options\.js" src/*.test.ts  # → geen
```

89 tests, allemaal groen, en geen enkele raakt `src/generated/catalog.generated.ts`
of één van de vier bestanden waar de `chrome.*`-bedrading, de toestemmingsdans en
de paneel-DOM in zitten. Elke test die de netto-tak controleert bouwt zijn kaarten
met de hand (`panel.test.ts:79-83`, `rank.test.ts`). Dat is waarom A1 niet is
opgevallen: de suite bewijst dat de code klopt over kaarten die niet bestaan.

---

## 5. Liegt het lezen van de pagina?

**Oordeel: ja, in vier gevallen die de fixtures niet dekken — en één weigering
noemt de verkeerde oorzaak.**

Ik heb zeven eigen fixtures gemaakt in de scratch-map (buiten de repo) en ze door
de echte `collectEvidence` + `readCheckout` + `buildPanel` gehaald.

### L1 — `AggregateOffer` → de laagste van veertien prijzen wordt "de prijs van één artikel" — ERNSTIG

`read.ts:104` laat `AggregateOffer` door `isOffer` heen; `read.ts:181` zet
`lowPrice` in de picklijst. Fixture: één `AggregateOffer` met
`lowPrice 219,00`, `highPrice 549,00`, `offerCount 14`.

```
kandidaten: [{"raw":"219.00","currency":"EUR","basis":"artikel","via":"JSON-LD Offer"}]
lezing    : {"ok":true,"amountCents":21900,"currency":"EUR","basis":"artikel"}
PANEEL    : € 219,00 | "gelezen als prijs van één artikel …
             Aantal, bezorgkosten en korting zitten er niet in."
```

`highPrice` en `offerCount` staan in dezelfde markup en worden genegeerd. Er is
geen twijfel in beeld: `ok: true`, geldige munt. Dit is exact het faalpatroon dat
Coolblue heeft laten uitsluiten — een zelfverzekerd bedrag dat niet het te betalen
bedrag is — alleen dan van binnenuit de lezer in plaats van van buitenaf.

### L2 — `UnitPriceSpecification` → de kiloprijs wordt de artikelprijs — ERNSTIG

`read.ts:113-127`: `pick` duikt één niveau in een genest object en pakt daar
`price` of `value`, **zonder naar `@type` of `referenceQuantity` te kijken**.
Fixture: pak oude kaas van 500 g, € 9,25, met een `UnitPriceSpecification` van
€ 18,50 per KGM.

```
lezing : {"ok":true,"amountCents":1850,"currency":"EUR","basis":"artikel"}
PANEEL : € 18,50
```

Factor twee, met vlag en wimpel. Dit is de "prijs per stuk bij meerdere stuks"
uit de opdracht, en de fixtures dekken hem niet. Het commentaar op regel 118-119
zegt *"Eén niveau diep volgen is genoeg; dieper wordt het raden"* — maar één
niveau diep is al raden, want daar kan een eenheidsprijs of een verzendtarief
liggen.

### L3 — `DeliveryChargeSpecification` → de verzendkosten worden de prijs — ERNSTIG

Zelfde regel, andere `@type`. Fixture: artikel van € 1.249,00, `Offer` zonder
eigen `price`, met een `priceSpecification` van € 4,95 verzendkosten.

```
lezing : {"ok":true,"amountCents":495,"currency":"EUR","basis":"artikel"}
PANEEL : € 4,95
```

Het paneel rekent daarna de cashback over € 4,95 uit. De uitkomst is stil, klein
en volledig verkeerd.

### L4 — een dollarteken wordt weggestreept en niet tegen `priceCurrency` gelegd — MATIG

`read.ts:274` haalt `^[€$£]` van de string af. Fixture: `price: "$1,299.00"` met
`priceCurrency: "EUR"`.

```
lezing : {"ok":true,"amountCents":129900,"currency":"EUR"}
PANEEL : € 1.299,00
```

Het enige teken op de pagina dat de munt tegenspreekt, wordt verwijderd voordat
er iets mee gebeurt. Twee bronnen die het oneens zijn is geen bedrag; hier is het
er wel één.

### L5 — hetzelfde bedrag twee keer geeft de melding "meer dan één bedrag" — MATIG (regel 3)

`read.ts:349`: de sleutel is `${cents}|${currency}`, dus twee kopieën van hetzelfde
bedrag waarvan er één geen munt draagt, tellen als twee prijzen. Fixture: JSON-LD
`Offer` met `49.99 EUR` plus `<meta property="product:price:amount" content="49.99">`
zonder bijbehorende `product:price:currency` — een heel gewone combinatie in
Nederlandse webshops.

```
kandidaten: [{"raw":"49.99","currency":"EUR",…},{"raw":"49.99","currency":"",…}]
lezing    : {"ok":false,"reason":"meerdere-prijzen"}
PANEEL    : "De pagina noemt meer dan één bedrag, en welke bij jouw bestelling
             hoort staat er niet bij. Vul het bedrag zelf in."
```

De pagina noemt één bedrag, twee keer. De oorzaak is dat één kopie geen munt
draagt. De melding noemt dus de verkeerde oorzaak — regel 3 — en gooit bovendien
een lezing weg die eenduidig was.

### L6 — de IKEA-toestemming rust op twee metingen, allebei zonder korting — MATIG

`sites.ts:104-107` en `README.md:79-80`: BILLY (€ 49,99) en KALLAX (€ 69,99).
Twee artikelen, allebei zonder IKEA Family-prijs en allebei geen multipack. Het
geval "gewone prijs naast Family-prijs" — dus precies de doorgestreepte-oude-prijs
uit de opdracht — is niet gemeten, terwijl het bij IKEA NL geen randgeval is.

Nagemeten met een fixture waarin een `Offer` van € 499,00 een genest
`UnitPriceSpecification` van € 399,00 met naam "IKEA Family" draagt: de lezer
pakt € 499,00 en ziet de € 399,00 niet. Dat is hier de veilige kant (een
niet-Family-lid betaalt € 499), maar het is geen keuze — het is een gevolg van het
feit dat de nesting nooit is bekeken. Als IKEA de Family-prijs ooit in de `price`
zet en de gewone prijs in de specificatie, draait het om, en dan merkt niemand het.

### Wat de lezer wél goed doet

- `parseAmountToCents` weigert `"1.234"` in plaats van te kiezen — de factor
  duizend is echt afgevangen, en de popup heeft er een eigen tekst voor omdat
  `reasonText` daar niet past (`popup.ts:63-83`). Dat is regel 3 goed toegepast.
- Een ordertotaal slaat de artikelprijzen eronder (`read.ts:330-331`), zonder in
  "meerdere prijzen" te vervallen.
- Twee echt verschillende bedragen → weigeren.
- Een niet-euro-pagina → weigeren met de reden erbij (`panel.ts:129-139`), in
  plaats van het bedrag met een euroteken ervoor te tonen. Die tak is goed
  doordacht.
- Kapotte JSON-LD wordt overgeslagen, niet fataal.
- De redactiegrens klopt: uit `collectEvidence` komen alleen `host` en
  `{raw, currency, basis, via}`. Ik heb de Coolblue-fixture door de compileerde
  functie gehaald; naam, omschrijving en beeld-URL's reizen niet mee.

---

## Oordeel

**Nee — deze v1 hoort nog niet in zijn browser. Niet vanwege een lek en niet
vanwege een recht, maar omdat het enige wat hij zegt niet klopt.**

Het schone deel is echt schoon en verdient dat het zo blijft: nul uitgaande
verbindingen, leeg `host_permissions`, opt-in per winkel, twee lijstjes in de
opslag en geen spoor van wat iemand koopt. De redactiegrens tussen pagina en
extensie is scherper getrokken dan gebruikelijk en er is een test die hem bewaakt.
Op die as zou ik hem installeren.

Maar installeren betekent dat het paneel op IKEA-productpagina's verschijnt en
advies geeft, en met de data die meegaat is dat advies in álle gevallen één van
deze twee:

1. "over de kaarten die je hebt aangevinkt weten we niets" (bij elke gangbare
   Nederlandse kaart, want 69 van de 77 hebben geen cashbackcijfer), of
2. "Crypto.com Obsidian levert hier € 2,50 op; wat die kaart kost weten we niet,
   zoek het op bij Crypto.com" — terwijl in dezelfde bundel staat dat het
   € 450.000 aan gestakete CRO kost en dat de uitkering in CRO is.

Dat is regel 2 en regel 3, allebei, in de enige zin die het product afdrukt.

### Wat er eerst moet gebeuren — blokkerend

1. **A2/A3 — de brutogroep mag niet als aanbeveling op het scherm.** Zolang
   `conditions` niet gelezen wordt, is `openUnknownCost` geen kandidatenlijst maar
   een lijst kaarten waar we een halve uitspraak over hebben. Óf de
   voorwaardentekst komt in de rij te staan, óf de groep verdwijnt uit het paneel.
   Wat er niet mag blijven staan is de huidige middenweg: een euro-bedrag met een
   uitnodiging om te openen.
2. **A3 — de zin "staat niet in onze gegevens" moet weg.** Hij is onwaar bij alle
   acht kaarten waarvoor hij kan worden afgedrukt.
3. **A1 — de kop mag niet beloven wat het lijf niet kan dragen.** `lines.ts:123`
   noemt "wat het kost om zo'n kaart te openen"; met deze catalogus komt dat er
   nooit. Hetzelfde geldt voor `manifest.json:5` en de eerste alinea van de README:
   "met de kaartkosten erin verrekend" gebeurt bij nul van de 77 kaarten.
4. **A2 — de crypto-uitkering mag niet als euro's op het scherm.** "Dat levert
   € 80,00 op" bij een uitkering in CRO met een maandplafond is de duurste zin in
   deze map.

### Daarna, vóór er een tweede winkel bij komt

5. **L1/L2/L3** — `AggregateOffer` afwijzen of als reeks behandelen; de nesting in
   `pick` op `@type` en `referenceQuantity` controleren. Op IKEA-productpagina's
   bijten deze drie vandaag niet, maar ze zijn de reden dat een tweede winkel
   gevaarlijk is en het pad "meten en toevoegen" uit `sites.ts` schijnzekerheid geeft.
6. **L5** — de weigering "meerdere prijzen" splitsen van "één bedrag, één kopie
   zonder munt". Nu leest de gebruiker een oorzaak die er niet is.
7. **R1** — het toestemmingsdialoog één keer in een echte Chrome draaien en meten
   of het pad wordt afgedwongen, vóórdat de zin "niet de winkelwagen, niet je
   account" onder een vinkje mag blijven staan.

### Klein, maar goedkoop

8. **B1/B2** — de netwerkcontrole in `copy-static.mjs` ook over `.html` en `.css`
   laten lopen, en `default-src 'self'` in de CSP. Twee regels, en dan klopt de
   belofte in de README weer met wat er wordt afgedwongen.
9. **A4/A5** — `byResult` en de leegtest in `headline` repareren zolang ze nog dood
   zijn; ze worden levend op de dag dat de eerste kaart zowel cashback als een fee
   krijgt, en dan is er geen test die ze vangt.
10. **A6/A7, R2** — `money.ts` gebruiken in `options.ts:63`, de uitgeversnaam
    inkorten voor gebruik in een zin, en `sites.test.ts:22` laten testen wat zijn
    naam belooft.

### Eén observatie over de suite zelf

89 groene tests en geen enkele die de meegeleverde catalogus of één van de vier
`chrome.*`-bestanden aanraakt. Een test die `rankCheckout` op `CHECKOUT_CARDS`
loslaat en vastlegt hoeveel kaarten in welke groep landen, had A1 op dag één
laten omvallen. Dat is de goedkoopste test die hier ontbreekt.
