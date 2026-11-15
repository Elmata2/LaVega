# Tegenspraak — apps/extension, tweede ronde

Opdracht: opnieuw proberen deze extensie af te keuren, nu de bevindingen van de
eerste ronde zijn gerepareerd. Er is in deze ronde geen regel code veranderd;
alleen dit bestand is bijgewerkt.

Alles hieronder is zelf gedraaid. "De lane zegt dat het opgelost is" staat
nergens als bewijs. Waar ik een uitkomst noem, staat het commando of het
bestand met het regelnummer erbij. Eigen probes staan BUITEN de repo, in de
scratch-map.

**Testen:** `cd apps/extension && npx vitest run` → **161 geslaagd, 0 gefaald**
(store 4, horizon 11, money 8, lines 25, panel 9, rank 34, sites 23, read 47).
`npx tsc --noEmit` schoon. `npx tsc -p tsconfig.build.json && node
scripts/copy-static.mjs` sluit af met exit 0 en 22 gescande bestanden.

**Nieuw in deze ronde, en het verandert twee beweringen in de README:** ik heb
`dist/` wél in een echte Chrome geladen. Zie N10.

**Uitkomst in één zin:** de zeventien oude bevindingen zijn op twee na dicht, en
de extensie liegt niet meer — maar de reparatielaag die dat mogelijk maakte
heeft er drie eigen rekenfouten bijgezet (N1, N2, N3, alle drie latent, alle
drie precies de soort die de eerste ronde als A4 blokkerend noemde), en op de
enige vraag die dit product bestaat om te beantwoorden zegt het nog steeds
niets bruikbaars. Het eindoordeel staat onderaan, met de letterlijke zin erbij.

---

## 1. De oude bevindingen, één voor één

| #   | oordeel                         | in één regel                                                            |
| --- | ------------------------------- | ----------------------------------------------------------------------- |
| A1  | **anders opgelost dan bedoeld** | de onware belofte is weg, de lege doorsnede niet: nog steeds 0 van 77   |
| A2  | **opgelost**                    | `conditions` wordt gelezen; geen euroteken meer boven een CRO-uitkering |
| A3  | **half opgelost**               | de zin is waar geworden, de groepskop erboven niet                      |
| A4  | **opgelost**                    | jaarkaart staat nu boven maandkaart, met de periode in de zin           |
| A5  | **opgelost**                    | `openBackwards` telt mee in de leegtest                                 |
| A6  | **half opgelost**               | de bedragen lopen door `money.ts`, de punten niet                       |
| A7  | **opgelost**                    | `korteUitgever`, 0 van 77 onbruikbaar                                   |
| B1  | **opgelost**                    | onafhankelijk nagemeten: exit 1 met bestand en regelnummer              |
| B2  | **opgelost**                    | en nu ook in een draaiende Chrome gemeten                               |
| B3  | **niet opgelost**               | de zin in `chrome.d.ts` is ongewijzigd                                  |
| L1  | **opgelost**                    | `AggregateOffer` → `prijsbereik`                                        |
| L2  | **opgelost**                    | kiloprijs → `geen-artikelprijs`                                         |
| L3  | **opgelost**                    | verzendkosten → `geen-artikelprijs`                                     |
| L4  | **opgelost**                    | dollarteken bij EUR → `munt-spreekt-tegen`                              |
| L5  | **opgelost**                    | zelfde bedrag, één kopie zonder munt → één lezing                       |
| L6  | **opgelost, met een prijs**     | IKEA-actiepagina wordt nu helemaal niet meer gelezen                    |
| R1  | **opgelost**                    | het pad wordt in onze eigen code afgedwongen; de zin klopt              |
| R2  | **opgelost**                    | `keurPatroon` valt om op `https://www.ikea.com/*`                       |

### A1 — geen enkele kaart kan een netto-uitkomst opleveren — ANDERS OPGELOST

De data is niet veranderd waar het op aankomt. Nagemeten tegen de gebundelde
catalogus zoals hij vandaag meegaat:

```bash
node -e "import('./dist/generated/catalog.generated.js').then(m=>{const c=m.CHECKOUT_CARDS,
  h=v=>v!==null&&v!==undefined;console.log(c.length,c.filter(k=>h(k.cashbackPct)).length,
  c.filter(k=>h(k.fee)).length,c.filter(k=>h(k.cashbackPct)&&h(k.fee)).length)})"
# → 77 8 27 0
```

Het aantal kaarten met een prijs ging van 9 naar 27. **De doorsnede is nog
steeds 0.** `horizon.ts`, `minimumCharge` (`horizon.ts:100`), de netto-tak van
`netLine` en de groep "Kost na kaartkosten meer dan het oplevert" draaien tegen
deze data nog steeds nooit.

Wat wél is gerepareerd, en dat is precies wat de eerste ronde blokkerend noemde:
de beweringen erboven. `manifest.json:5` zegt niets meer over "verrekend"; de
README zet het meetcommando in de eerste sectie; en `headline` in `lines.ts` is
voorwaardelijk geworden. Gemeten kop bij een lege selectie op de BILLY-fixture:

```
Je hebt nog geen kaart aangevinkt. Hieronder staat wat er te halen valt; bij
geen van deze kaarten kennen we een prijs die we daarvan kunnen aftrekken.
```

En de goedkoopste ontbrekende test is er: `rank.test.ts:507` laat `rankCheckout`
op `CHECKOUT_CARDS` los en legt 77 / 8 / 27 / 0 vast.

Dus: de bewering is weg, de leegte niet. Dat is de goede volgorde, maar het is
geen opgelost probleem — het is een eerlijk gemaakte leegte.

### A2 — de voorwaarden worden gelezen — OPGELOST

`leesVoorwaarden` (`rank.ts:181`) leest `conditions` en `bepaalClaim`
(`rank.ts:383`) bepaalt eraan of er een kaal eurobedrag op mag. De gemeten regel
uit de eerste ronde is verdwenen. Houder van Crypto.com Plus, aankoop € 4.000,
peildatum 2026-08-21:

```
was : Betaal met Crypto.com Prepaid Card — Plus (Ruby Steel). Dat levert € 80,00 op.
nu  : Van jouw kaarten staat Crypto.com Prepaid Card — Plus (Ruby Steel) met 2%
      het hoogst, maar die opbrengst komt in CRO en niet in euro's.
```

Nul eurotekens in kop én regel; plafond, drempel en uitsluitingen staan eronder.
Het plafond dat wél in euro's leesbaar is wordt ook echt gebruikt — Bleap bij
€ 4.000: _"Levert hooguit € 5,00 op. Gerekend met het plafond van € 500,00 per
transactie, niet met het hele aankoopbedrag."_ Dat is 1% van € 500 en niet van
€ 4.000, en het staat erbij.

De kleinere helft (`ing-platinumcard` met een voorwaardelijke nul in de
koersopslag) is ook gedekt: dat levert nu een `voorwaardelijke-nul`-caveat op en
een claim "hooguit" in plaats van een kaal bedrag.

Waarschuwing hierbij: de lezer die dit mogelijk maakt is nieuw, en heeft drie
eigen gaten. Zie N1, N2 en N3.

### A3 — "staat niet in onze gegevens" — HALF OPGELOST

De ZIN is waar geworden. `kostenStaanInVoorwaarden` (`lines.ts:142`) houdt hem
tegen zodra er een drempel, een eenmalige post of een "bovenop" in de
voorwaarden staat. Nagemeten over de hele bundel, alle groepen, € 4.000:

```
precies één kaart drukt de zin nog af : bleap-card
```

En bij Bleap is hij waar: `fee: null`, en in de voorwaardentekst staat niets
over wat de kaart kóst om te hebben (alleen over wat hij oplevert en waar niet).
De zeven tokenkaarten drukken hem niet meer af.

**Wat niet is opgelost: de kop erboven.** `content.ts:89` (en `popup.ts:29`) zet
boven diezelfde rijen:

```
KAARTKOSTEN ONBEKEND
  Crypto.com Prepaid Card — Private (Obsidian)
  Deze kaart geeft 5% terug, maar in CRO en niet in euro's …
```

Bij Obsidian staat in dezelfde record letterlijk: _"TIER GATE: crypto.com/nl/cards
prices Obsidian at '€450,000 12-month CRO staking'."_ De kaartkosten zijn daar
niet onbekend; ze staan er. De rij zegt het niet meer, de kop erboven wel — en
een groepskop is de sterkste uitspraak in dat blok. Dit is dezelfde onwaarheid
als A3, één regel hoger. Bovenstaande is afgelezen uit de echte popup in een
draaiende Chrome, niet uit een test.

Oorzaak: de nieuwe basis `voorwaardelijk` (`rank.ts:422`) landt in dezelfde
paneelgroep als `bruto`, terwijl bij die zeven kaarten niet de KOSTEN onbekend
zijn maar de OPBRENGST niet in euro's te geven is. Dat vraagt een eigen
`PaneelGroep`, en dat raakt `messages.d.ts`, `panel.ts` en `content.ts`.

### A4 — maandbedrag tegen jaarbedrag in de sortering — OPGELOST

Nagemeten met precies de twee synthetische kaarten uit de eerste ronde, beide 1%
cashback, aankoop € 10.000:

```
was: [openWorthIt] Maandkaart  resultCents=9100 (1 maand)   ← stond bovenaan
     [openWorthIt] Jaarkaart   resultCents=4000 (1 jaar)
nu : [openWorthIt] Jaarkaart   resultCents= 4000  span=12  "1 jaar"
     [openBackwards] Maandkaart resultCents=-800  span=12  "12 maanden"
```

De duurste kaart is van de eerste plaats naar de groep "achteruit" verhuisd. De
oorzaak zat dieper dan de sorteerfunctie: `DEFAULT_HORIZON_MONTHS` is nu 12 en
elke horizon wordt naar boven op hele jaren afgerond, zodat `charge.spanMonths`
bij elke rij gelijk is. De regel noemt de periode: _"Over 1 jaar kost dat
minstens € 108,00 (12 maanden)."_ Het woord "minstens" blijft daarmee waar.

### A5 — "er is niets bekend" boven een uitgerekende rij — OPGELOST

Eén kaart, 1% cashback, € 270 per jaar, aankoop € 50:

```
was: Er staat geen kaart aangevinkt en er is niets bekend om te vergelijken.
nu : Je hebt nog geen kaart aangevinkt. Hieronder staat wat er te halen valt, en
     bij de kaarten waarvan we de prijs kennen ook wat het openen kost.
     → Netto over 1 jaar: -€ 269,50 — dat is achteruit, dus dit is geen aanbeveling.
```

### A6 — Engelse getalnotatie in het optiescherm — HALF OPGELOST

De bedragen lopen nu door `money.ts`. Gerenderd over alle 27 kaarten met een
prijs:

```
ABN AMRO creditcard : kosten € 2,55 per maand
SNS creditcard      : kosten € 37,50 per jaar
Rabobank creditcard : kosten € 2,00 per maand
```

**Maar in dezelfde functie, één veld verder, staat het defect er nog**
(`options.ts:90`):

```
American Express Blue Card                 : 0.5 punt(en) per euro
Flying Blue - American Express Silver Card : 0.8 punt(en) per euro
Flying Blue - American Express Platinum    : 1.5 punt(en) per euro
```

Ruwe JavaScript-nummers, op een Nederlands scherm. Het veld wordt bij 51 van de
77 kaarten afgedrukt en vier daarvan hebben een niet-heel getal (0,5 / 0,8 /
1,5) — die vier staan er met een Engelse punt. Dat is letterlijk de bevinding
die A6 was; alleen het veld ernaast is meegenomen.

### A7 — de uitgeversnaam in een Nederlandse zin — OPGELOST

`korteUitgever` (`lines.ts:44`) losgelaten op alle 77 uitgeversvelden: 0 keer
`null`, 0 keer een naam langer dan 40 tekens. De gemeten uitschieter uit de
eerste ronde:

```
was: Zoek dat op bij Wirex; card issuer previously UAB PayrNet, current EEA
     issuer not stated on any readable page voordat je hem opent — …
nu : Wirex
```

### B1 — de netwerkcontrole in de build — OPGELOST, ONAFHANKELIJK NAGEMETEN

Ik heb `apps/extension` naar de scratch-map gekopieerd (repo niet aangeraakt),
daar dezelfde drie gevallen ingebracht als in de eerste ronde — een remote
`@font-face`, een remote `background-image` en een 1×1-`<img>` met
`?bedrag=4999` — en `tsc -p tsconfig.build.json && node scripts/copy-static.mjs`
gedraaid:

```
[copy-static] ok — 22 bestanden gescand — zie de fouten hieronder
[copy-static] FOUT — dist/popup.html:46 bevat een verwijzing (src/href/...) naar een ander domein.
[copy-static] FOUT — dist/popup.html:46 bevat een http(s)-adres.
[copy-static] FOUT — dist/stijl.css:118, dist/stijl.css:119 bevat een url(...) die naar een ander domein wijst.
[copy-static] FOUT — dist/stijl.css:118, dist/stijl.css:119 bevat een http(s)-adres.
[copy-static] 4 probleem(en). dist/ is NIET geschikt om in Chrome te laden.
EXITCODE=1
```

De regel "ok — geen netwerkverkeer in de bundel" verschijnt niet meer boven een
controle die iets gevonden heeft. Op de echte bundel: 22 bestanden gescand, exit 0. De zelftest in het script betrapt zeven gevallen en laat vier schone
bestanden met rust, bij elke build.

### B2 — de CSP — OPGELOST, EN NU IN EEN DRAAIENDE CHROME GEMETEN

`manifest.json:42-44` is nu `default-src 'none'` met `img-src`, `font-src`,
`media-src`, `connect-src`, `object-src`, `frame-src` en `child-src` op `'none'`,
`script-src 'self'`, `worker-src 'self'`, en `style-src 'self' 'unsafe-inline'`
voor het ene `style`-attribuut in `public/popup.html:41`. `copy-static.mjs:131`
eist het `default-src` en de vier `'none'`-richtingen, dus het kan er niet
ongemerkt weer uit.

Wat ik daar bovenop heb gemeten (zie N10 voor het commando): met deze CSP
renderen `popup.html` en `options.html` volledig in Chrome 151, met **nul
`Log.entryAdded`-meldingen** — dus geen enkele CSP-weigering en geen console-fout.

### B3 — `connect-src 'none'` dekt het content script niet — NIET OPGELOST

`chrome.d.ts:17-19` staat ongewijzigd:

```
 *   fetch/XHR        — staat niet in dit bestand omdat het in de DOM-lib zit,
 *                      maar het manifest zet er `connect-src 'none'` overheen.
```

`extension_pages` geldt niet voor het content script. Er staat nog steeds geen
netwerkaanroep in `content.ts` en `copy-static` scant het bestand wél, dus er is
niets lek — de bevinding was en is dat de ZIN de dekking verkeerd voorstelt. De
eerste ronde vroeg alleen om die zin te corrigeren. Dat is niet gebeurd.

### L1 t/m L5 — de lezer — OPGELOST

Alle 26 fixtures door de echte `collectEvidence` + `readCheckout` gehaald:

```
L1 kunstmatig-aggregateoffer-reeks.html            was OK 21900    nu WEIGERT prijsbereik
L2 kunstmatig-eenheidsprijs-per-kilo.html          was OK  1850    nu WEIGERT geen-artikelprijs
L3 kunstmatig-verzendkosten-als-prijs.html         was OK   495    nu WEIGERT geen-artikelprijs
L4 kunstmatig-dollarteken-bij-euro.html            was OK 129900   nu WEIGERT munt-spreekt-tegen
L5 kunstmatig-zelfde-bedrag-zonder-munt.html       was WEIGERT     nu OK 4999 EUR
```

En de dingen die goed waren zijn goed gebleven: ordertotaal boven artikelprijzen
(31245, basis "bestelling"), twee echt verschillende bedragen → `meerdere-prijzen`,
kapotte JSON-LD overgeslagen, `"1.234"` geweigerd, de BILLY-fixture nog steeds
4999 EUR.

Twee bijvangsten van de reparatie die naar mijn oordeel de goede kant op vallen:
een euro- of pondteken zónder `priceCurrency` telt nu als munt (dat was
inderdaad hetzelfde regel-3-defect als L5), en een `AggregateOffer` waarvan
laagste en hoogste hetzelfde bedrag noemen wordt wél gelezen.

### L6 — de IKEA-actiepagina — OPGELOST, EN DAT HEEFT EEN PRIJS

De echte fixture `__fixtures__/ikea-slakt-actieprijs.html` (AggregateOffer
lowPrice 96,99 / highPrice 114,99):

```
was: {"ok":true,"amountCents":9699,"currency":"EUR","basis":"artikel"}
nu : {"ok":false,"reason":"prijsbereik"}
```

Dat is de veilige kant en het is een echte vondst — de lezer gaf de
Family-prijs aan een gebruiker die misschien € 114,99 afrekent, op de enige
winkel die de extensie mag lezen. Maar het gevolg staat nergens: **van de twee
ECHTE IKEA-productpaginafixtures in de repo levert er nu één helemaal niets
meer op.** Zie N7.

### R1 — "niet de winkelwagen, niet je account" — OPGELOST

`siteForHost` is `siteForUrl` geworden (`sites.ts:179`) en controleert schema,
host, poort én pad. `siteVanAfzender` (`background.ts:172`) legt `sender.url`,
`sender.origin` en de tab-URL naast elkaar, en na de injectie wordt
`evidence.host` nog een keer tegen het patroon gelegd (`background.ts:229`).

En de zin onder het vinkje is aangepast aan wat er echt gebeurt. Afgelezen uit
het optiescherm in een draaiende Chrome:

```
https://www.ikea.com/nl/nl/p/* — alleen productpagina's onder /nl/nl/p/ — de
extensie slaat elk ander pad zelf over, ook als Chrome de toestemming voor het
hele domein geeft
```

Dat is de reparatie die gevraagd werd: de belofte rust niet meer op een aanname
over Chrome. De open vraag ("dwingt Chrome het pad af in een verleende optional
host permission?") heb ik niet kunnen beantwoorden — ik kon de extensie wél
laden, maar het toestemmingsdialoog is een venster van het besturingssysteem en
bleef in headless hangen: na een echte klik op het vinkje stond
`permissions.getAll()` nog op `{"origins":[]}` en was `chrome.storage.local` nog
leeg. Dat is niet erg meer, want de code hangt er niet meer van af.

Klein gevolg dat ik daarbij zag en dat in een echte Chrome een moment duurt in
plaats van een toestand: zolang het dialoog openstaat, staat het vinkje al aan
en is `sites-melding` leeg.

### R2 — de test die iets anders testte dan zijn naam — OPGELOST

`sites.test.ts:31` heeft er een functie `keurPatroon` van gemaakt en test hem op
de vier patronen uit de eerste ronde:

```
keurPatroon("https://www.ikea.com/*")        → ["kaal domein zonder pad"]   ← viel eerder door
keurPatroon("https://*.ikea.com/*")          → 3 bezwaren
keurPatroon("https://www.ikea.com/nl/nl/p/*") → []
keurPatroon("http://x.nl/*")                 → 2 bezwaren
```

En de build weigert een patroon zonder pad (`copy-static.mjs:180`). Drie sloten
op hetzelfde pad, en dat is er twee meer dan er waren.

---

## 2. Wat de reparatie zelf heeft gebroken

Dit is waar deze ronde de kans zocht, en er is wat te vinden. De drie eerste
zitten allemaal in de nieuwe voorwaardenlezer — de laag die is gebouwd om de
extensie eerlijk te maken.

### N1 — een plafond op de KOERSOPSLAG wordt op de CASHBACK toegepast — ERNSTIG (latent)

`bepaalClaim` (`rank.ts:395`) zoekt het eerste `plafond`-caveat en kijkt daarbij
**niet naar `veld`**. `buildRow` (`rank.ts:536`) rekent er vervolgens mee alsof
het bij de cashback hoort:

```ts
euroCents = pctOfCents(claim.capCents, cashbackPct) - pctOfCents(input.amountCents, fxPct);
```

Nagemeten met één synthetische kaart: cashback 1% zonder voorwaarde, koersopslag
2% met de voorwaarde `"cap of €100 per transaction op de koersopslag"`, aankoop
€ 1.000 in USD:

```
gemeten : "Kost minstens € 19,00 aan koersopslag."
juist   : 1% − 2% = −1% van € 1.000 = € 10,00, en dat is het SLECHTST mogelijke
          geval, want een plafond op de koersopslag verlaagt de kosten
grossCents = -1000, euroCents = -1900, claim = hooguit/capCents=10000/transactie
```

Een plafond dat een KOST begrenst is gelezen als een plafond dat de OPBRENGST
begrenst, en het antwoord is bijna twee keer zo hoog, de verkeerde kant op, met
het woord "minstens" ervoor. Erger nog: `capAlVerwerkt` (`lines.ts:113`)
verbergt het plafond uit de opsomming zodra `euroCents < grossCents`, dus de
gebruiker ziet niet eens dát er met een plafond is gerekend. De regel is één
zin, zonder voorbehoud.

Reikwijdte vandaag: onbereikbaar. Nagemeten met alle 77 kaarten aangevinkt, in
EUR én USD, € 1.000 — geen enkele rij bereikt dit pad (in EUR: 1× `hooguit`, 7×
`niet-in-euro`; in USD: 5× `niet-in-euro`). Dat is exact de status die A4 had
toen de eerste ronde hem blokkerend noemde, en er is geen test die hem vangt.

### N2 — een voorwaarde bij het ene cijfer wordt aan het andere toegeschreven — ERNSTIG (latent)

Zelfde oorzaak: `bepaalClaim` (`rank.ts:384`) gooit de caveats van `cashback` en
`koersopslag` op één hoop en levert één claim op; `grossLine` (`lines.ts:177`) en
`redenGeenEuros` (`lines.ts:338`) formuleren die daarna als een uitspraak over
het CASHBACK-cijfer. Twee metingen, allebei met een kaart waarvan het
cashbackcijfer geen enkele voorwaarde heeft:

```
onduidbare voorwaarde op de KOERSOPSLAG:
  KOP  : Van jouw kaarten staat Testkaart met 1% het hoogst, maar bij dat cijfer
         staat een voorwaarde die we niet konden beoordelen.
  REGEL: Deze kaart noemt 1%, maar bij dat cijfer staat een voorwaarde die we niet
         konden beoordelen, dus er staat hier geen bedrag. Bij de koersopslag hoort
         een voorwaarde: er staat een voorwaarde bij die we niet machinaal konden
         beoordelen.

VERLOPEN einddatum op de KOERSOPSLAG:
  REGEL: Deze kaart noemt 1%, maar dat cijfer gold tot 1 januari 2026 en die datum
         is voorbij, dus we rekenen er niets mee.
```

In het eerste geval spreekt de regel zichzelf één zinsdeel later tegen. In het
tweede geval doet de extensie een onware uitspraak over de kaart: het
cashbackcijfer is niet verlopen, een actie op de koersopslag wel. Dat is regel 3
in de laag die voor regel 3 is gebouwd. Ook hier: met de huidige catalogus
onbereikbaar (gemeten, zie N1), en niet getest.

### N3 — een voorwaardelijke nul in de KAARTKOSTEN gaat ongehinderd de som in — MATIG (latent)

`leesVoorwaarden` herkent `voorwaardelijke-nul`, maar `minimumCharge`
(`horizon.ts:100`) kijkt er nooit naar. Nagemeten: kaart met 1% cashback en
`fee: { value: 0, period: "jaar", conditions: "€ 0 per jaar bij een minimale
besteding van € 3.000 per jaar; anders € 35." }`, aankoop € 1.000:

```
Levert € 10,00 op. Om hiermee te betalen moet je deze kaart openen. Over 1 jaar
kost dat minstens € 0,00. Netto over 1 jaar: € 10,00. Bij de kaartkosten horen
voorwaarden: … deze nul geldt alleen onder voorwaarden, dus het is geen
uitgesproken nul.
```

"Minstens € 0,00" is onwaar in dezelfde regel waar staat dat die nul
voorwaardelijk is; het minimum kan € 35 zijn. Regel 1, in de tak die daarvoor
gebouwd is. Vier echte kaarten dragen al een `fee.value` van 0 (Trade Republic,
212 Card, Openbank, Amex Blue) — er is alleen nog geen cashbackcijfer bij nodig
om dit levend te maken.

### N4 — "bedrag-onduidelijk" is een vergaarbak met één uitleg — MATIG (regel 3)

De kop van `read.ts` zegt: _"Er zijn zeven redenen om te weigeren, en alle zeven
noemen de ECHTE oorzaak."_ Nagemeten met `parseAmountToCents`:

```
"96,99 €"      → bedrag-onduidelijk    (achterstaand euroteken, de gewone NL-schrijfwijze)
"EUR 96,99"    → bedrag-onduidelijk
"vanaf 39,99"  → bedrag-onduidelijk
"39,"          → bedrag-onduidelijk
"-5,00"        → bedrag-onduidelijk
"1.234"        → bedrag-onduidelijk    ← het enige geval waar de tekst over gaat
```

De tekst die daarbij op het scherm komt (`read.ts:552`): _"Het bedrag op de
pagina is niet eenduidig te lezen — bij één punt met drie cijfers erachter kan
het duizend keer schelen."_ Bij vijf van de zes gemeten gevallen is dat de
verkeerde oorzaak. `parseAmountToCents` strijkt alleen een VOORAANSTAAND
`€ $ £` weg, dus `content="96,99 €"` — geen exotische opmaak — valt in de
vergaarbak. `popup.ts:71-81` heeft diezelfde tekst hard ingebakken, met het
ruwe invoerveld ervoor.

### N5 — "prijsbereik" beweert twee uiteinden waar er één staat — KLEIN (regel 3)

`read.ts:544`: _"een laagste en een hoogste bedrag"_. Gemeten op
`kunstmatig-aggregateoffer-vanafprijs.html` (alleen `lowPrice`) en op een
`AggregateOffer` met alleen `highPrice`: allebei `prijsbereik`. De weigering is
juist — de bovenkant is onbekend, en onbekend is niet de onderkant — maar de
oorzaak die op het scherm komt is er niet.

### N6 — een `UnitPriceSpecification` als ENIGE prijs wordt geweigerd als "geen artikelprijs" — MATIG

De reparatie van L2/L3 keurt een genest bedrag af op `@type`, en `kaal`
(`read.ts:210`) accepteert alleen `(Compound)PriceSpecification` of helemaal geen
`@type`. Gemeten:

```json
{"@type":"Offer","priceSpecification":{"@type":"UnitPriceSpecification",
 "price":"49.99","priceCurrency":"EUR","valueAddedTaxIncluded":true}}
→ WEIGERT geen-artikelprijs
```

Er staat geen `unitCode`, geen `referenceQuantity`, geen `unitText`: dit IS de
prijs van het artikel, alleen opgeschreven zoals Shopware en Magento het
schrijven. De gebruiker leest dan (`read.ts:542`): _"het is een bedrag van een
andere soort, zoals een prijs per kilo of de verzendkosten"_ — op een pagina
waar geen kiloprijs en geen verzendtarief staat. Bijt vandaag niet op IKEA
(dat schrijft een kale `price`), bijt wel op het pad "meten en toevoegen"
waarvan `sites.ts` het hele vertrouwen ophangt.

### N7 — de meting die het gedrag op de enige winkel veranderde, staat niet onder het vinkje — MATIG

Afgelezen uit het optiescherm in een draaiende Chrome (`sites.ts:125-127`):

```
Gemeten op 21 augustus 2026: twee van de twee productpagina's met prijsopmaak
gaven het bedrag van het artikel dat er ook echt stond (BILLY € 49,99,
KALLAX € 69,99).
```

De derde meting — SLÄKT, dezelfde dag, een `AggregateOffer` van 96,99 tot
114,99 waarop de lezer nu níéts teruggeeft — staat in de kop van `read.ts` en in
de fixture, maar niet hier en niet in de README (`README.md:114` zegt in de
tabel alleen "werkt — productpagina's"). Van de twee echte
IKEA-productpaginafixtures levert er één niets meer op. "Twee van de twee" is
dus geen onwaarheid maar wel een onvolledig verslag, en het staat onder het
vinkje waarmee iemand leestoestemming geeft — de tekst met de hoogste inzet in
deze map.

Praktisch gevolg dat niemand heeft opgeschreven: op precies de IKEA-pagina's
waar korting staat, zegt de extensie voortaan _"Het bedrag is hier niet te
lezen."_ Ik kon niet nameten hoe vaak dat is: `curl` met een gewone browser-UA
gaf mij op 21 augustus **HTTP 403** op de BILLY-URL, en botdetectie omzeilen doe
ik niet. De sitelijst rust dus op de fixtures van de vorige lane, niet op een
meting van mijzelf.

### N8 — de voettekst dateert de kaartgegevens twee dagen te vroeg — MATIG

Afgelezen uit de echte popup:

```
KAARTGEGEVENS VAN 19 AUGUSTUS 2026. LAVEGA LEEST DEZE PAGINA ALLEEN OM HET
BEDRAG TE VINDEN, BEWAART ER NIETS VAN EN STUURT NIETS NAAR BUITEN.
```

In diezelfde bundel:

```bash
grep -oE '"checkedAt":"2026-08-2[0-9]"' src/generated/catalog.generated.ts | sort | uniq -c
# → 46 "checkedAt":"2026-08-20"
```

Zesenveertig cijfers zijn gecontroleerd ná de datum die het scherm noemt. De
oorzaak zit buiten deze map: `docs/catalog/catalog.json` draagt
`generatedAt: 2026-08-19` terwijl het bestand op 20 en 21 augustus inhoudelijk
is gewijzigd (`git log -- docs/catalog/catalog.json`: `1db720c` 20-08,
`2d2f775` / `d8dd7dd` / `8289f11` 21-08). Maar de extensie is wat het afdrukt,
en `lines.ts` en de README zeggen allebei dat die datum aan een kassa het enige
is waarop de gebruiker kan afgaan.

### N9 — Escape sluit het paneel alleen als de aandacht er al in zit — KLEIN

`README.md:96`: _"Je sluit het met het kruisje of met Escape."_ De
`keydown`-luisteraar hangt aan het paneel (`content.ts`), dat geen `tabindex`
heeft. Wie er niet eerst in klikt, heeft geen Escape. De code legt de keuze uit
(een globale Escape-vanger zou de winkel in de weg zitten) — de README doet de
belofte zonder het voorbehoud.

### N10 — de README zegt dat de extensie nooit in een echte Chrome is geladen, en dat is met één commando te weerleggen

`README.md:324-330`: _"Het toestemmingsdialoog van Chrome is nog nooit in het
echt gedraaid. Chrome 151 weigert `--load-extension` zodra de sessie
geautomatiseerd is, dus de extensie is hier niet in een echte Chrome geladen."_

Dat eerste klopt nog. Het tweede niet. Wat ik heb gedraaid:

```bash
CHR="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$CHR" --version                       # Google Chrome for Testing 151.0.7922.34
"$CHR" --user-data-dir=$D --no-first-run --disable-extensions-except=$E \
       --load-extension=$E --remote-debugging-port=9333 --headless=new about:blank
curl -s http://127.0.0.1:9333/json/list
```

Uitkomst: de extensie laadt (id `bpbjefffbjacklbbfndibdlcmghogigk`), de service
worker `background.js` draait, en `popup.html` en `options.html` renderen
volledig — met nul CSP-weigeringen en nul console-fouten. De volledige tekst van
de popup, de groepskoppen en de voetregel in dit bestand komen uit die sessie.

Dit is de goede soort ongelijk: het werkt beter dan de README beweert. Maar de
README presenteert een niet-meting als een meting, en dat is dezelfde vorm van
fout als een meting die te veel beweert.

---

## 3. Waar ik gericht heb gezocht en niets vond

- **Lekt er iets?** `grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|new Image\(|\.src *=" src public scripts` geeft alleen treffers in de naaldlijst van `copy-static.mjs` zelf. De build scant nu 22 bestanden. Geen remote font, geen extern beeld, geen tracker.
- **Wordt er iets bewaard?** `chrome.storage.local.get(null)` in een verse Chrome-sessie na een klik op het vinkje: `{}`. Twee sleutels in de code, allebei door `schoonLijst`.
- **Slaat de lezer te veel over?** Alle 26 fixtures gedraaid: 12 lezen, 14 weigeren, en elke weigering noemt een reden met een verwijzing naar het handmatige veld. Van die 14 zijn er drie waar de genoemde oorzaak niet klopt — zie N4, N5 en N6.
- **Animaties, transitions, keyframes?** Nul treffers in `public/stijl.css` en `src/content.ts`.
- **Een euroteken boven een niet-euro-opbrengst?** Nul, over de hele bundel, in EUR en USD, met en zonder bedrag.
- **Wordt de bruto-groep als aanbeveling gepresenteerd?** De euro-rijen staan boven de niet-euro-rijen (`byEuroThenPct`, `rank.ts:598`) en de kop noemt geen kaart meer die geen euro-uitspraak kan dragen. Dat deel klopt.

---

## Oordeel

**Nee — deze v1 hoort nog niet in zijn browser. Maar de reden is verschoven, en
dat is winst.**

De vorige keer was het antwoord "nee, want het enige wat hij zegt klopt niet".
Dat is opgelost: hij liegt niet meer. Van de zeventien bevindingen zijn er
vijftien dicht, twee half (A3, A6) en één niet (B3, één zin). De privacykant is
nog steeds schoon en nu ook gemeten in een draaiende Chrome. Op die as zou ik
hem installeren.

Het antwoord is toch nee, om twee dingen.

**Ten eerste: hij zegt niets nuttigs.** Dit is wat er letterlijk op het scherm
komt op een IKEA-productpagina, met de echte gebundelde data, bij een gebruiker
die zijn eigen kaarten heeft aangevinkt (ING betaalpas en ABN AMRO creditcard),
op de BILLY-fixture van € 49,99:

> **Van de kaarten die je hebt aangevinkt, weten we bij geen enkele wat deze
> aankoop oplevert.**
>
> € 49,99 — Van deze pagina gelezen als prijs van één artikel (JSON-LD Offer).
> Aantal, bezorgkosten en korting zitten er niet in.
>
> **Kaartkosten onbekend**
> _Bleap Card_ — Levert hooguit € 0,50 op. Dat is het brutobedrag: wat deze
> kaart kost om te hebben, staat niet in onze gegevens. Zoek dat op bij Bleap
> SIA voordat je hem opent — wat je overhoudt, hangt daarvan af. Bij dit cijfer
> horen voorwaarden: er telt hooguit € 500,00 per transactie mee; een deel van
> de winkels en categorieën is uitgesloten, en of deze aankoop daaronder valt
> weten we niet.
>
> **Hier kunnen we niets over zeggen**
> _ING betaalpas_ — we weten niet of deze kaart iets teruggeeft. Onbekend is
> niet nul, dus deze kaart staat niet in de ranglijst.
> _ABN AMRO creditcard_ — we weten niet of deze kaart iets teruggeeft. Onbekend
> is niet nul, dus deze kaart staat niet in de ranglijst.
>
> Kaartgegevens van 19 augustus 2026.

Uitgeschreven: _over jouw twee kaarten weten we niets; open een Letse
self-custodial crypto-Mastercard om vijftig cent te verdienen op een boekenkast,
en zoek zelf uit wat die kaart kost._ Elk woord daarvan is nu waar. Het is nog
steeds geen antwoord op de vraag waarom iemand deze extensie installeert.

En op de IKEA-pagina's waar er iets te winnen valt — die met een
Family-actieprijs — is de uitkomst sinds de reparatie:

> **Het bedrag is hier niet te lezen.** Deze pagina noemt geen prijs maar een
> bereik — een laagste en een hoogste bedrag, bijvoorbeeld van meerdere
> aanbieders of van een actieprijs naast de gewone prijs. Welke van de twee jij
> betaalt, staat er niet bij. Vul het bedrag zelf in. Dat doe je in het
> LaVega-venster: klik op het icoon in je werkbalk.

Dat is het juiste antwoord, en het betekent dat het paneel zwijgt op precies de
pagina's waar het iets zou moeten doen. Van de twee echte IKEA-fixtures in de
repo levert er één niets op. Een extensie die op de helft van zijn enige winkel
naar het handmatige veld wijst, is een extensie die de leestoestemming niet
verdient — het handmatige veld werkt overal, ook zonder toestemming.

**Ten tweede: de reparatielaag heeft er drie latente rekenfouten bijgezet.** N1
(een plafond op de koersopslag komt op de cashback terecht en levert € 19,00
waar € 10,00 hoort, met "minstens" ervoor en zonder dat het plafond in beeld
komt), N2 (een voorwaarde bij het ene cijfer wordt aan het andere toegeschreven,
inclusief een onware "dat cijfer is verlopen") en N3 (een voorwaardelijke nul in
de kaartkosten gaat als uitgesproken nul de aftreksom in). Alle drie
onbereikbaar met de catalogus van vandaag, alle drie ongetest, alle drie precies
de vorm die de eerste ronde als A4 blokkerend noemde en die toen wél is
gerepareerd. Ze worden levend op dezelfde dag als de netto-tak: zodra er één
kaart met zowel een cashbackcijfer als een prijs in de catalogus komt.

### Wat er eerst moet gebeuren — blokkerend

1. **N1** — `bepaalClaim` moet naar `veld` kijken. Een plafond op de koersopslag
   is geen plafond op de opbrengst. Met een test die de € 19,00 vastlegt zoals
   `rank.test.ts:507` de 77/8/27/0 vastlegt.
2. **N2** — de claim mag niet twee cijfers samenvatten alsof het er één is, of
   de zin moet zeggen bij welk cijfer de voorwaarde hoort.
3. **A1 (de datalaag)** — zolang de doorsnede 0 is, is dit product een lijst met
   crypto-kaarten. Dat is geen codeprobleem en het lost zichzelf niet op door
   nog een ronde in deze map. Eén gangbare Nederlandse kaart met een
   cashbackcijfer verandert meer dan alles wat hierboven staat.

### Daarna

4. **A3 (de kop)** — een eigen `PaneelGroep` voor `voorwaardelijk`. "Kaartkosten
   onbekend" boven een kaart waarvan de kosten in de voorwaarden staan, is
   dezelfde onwaarheid als de zin die net is weggehaald.
5. **N7** — de SLÄKT-meting hoort onder het vinkje en in de README-tabel, met de
   consequentie erbij: op actiepagina's zegt de extensie niets.
6. **N8** — `generatedAt` in `docs/catalog/catalog.json` bijwerken, of de
   voetregel de nieuwste `checkedAt` uit de bundel laten noemen.
7. **N3, N4, N6** — de voorwaardelijke nul in `minimumCharge`, de vergaarbak
   `bedrag-onduidelijk` opsplitsen, en `UnitPriceSpecification` zonder eenheid
   als artikelprijs accepteren.

### Klein

8. **A6** — `pointsPerEuro` ook door `money.ts` (`options.ts:90`).
9. **B3** — de zin in `chrome.d.ts:17-19` corrigeren.
10. **N9, N10** — het Escape-voorbehoud in de README, en de alinea over "nooit in
    een echte Chrome geladen" vervangen door de meting uit N10.
11. `public/popup.html:41` — het `style`-attribuut naar `stijl.css`, dan kan
    `style-src` terug naar `'self'`.

### Eén observatie over de suite

161 groene tests, en de goedkoopste ontbrekende test uit de eerste ronde is er:
`rank.test.ts:507` laat `rankCheckout` op de echte bundel los en legt de
groepsaantallen vast. Dat is de test die A1 op dag één had laten omvallen.

De goedkoopste ontbrekende test van déze ronde is haar tegenhanger: een test die
`leesVoorwaarden` en `bepaalClaim` loslaat op een kaart waarvan de voorwaarden
bij de KOERSOPSLAG staan in plaats van bij de cashback. Dat is één `describe`,
en hij vangt N1 en N2 allebei.

---

# Wat de bouwlane hierna heeft gedaan — 22 augustus 2026

_Toegevoegd door de bouwlane. Boven deze streep is niets veranderd: het oordeel
van de tegenspraak hoort te blijven staan zoals het geschreven is._

De opdracht van deze ronde was niet "de bevindingen afvinken" maar de **eerste**
reden van het oordeel wegnemen: _hij zegt niets nuttigs._ Dat is gedaan door de
puntenkant te bouwen, langs het herschreven plan
(`docs/superpowers/specs/2026-08-20-checkout-extension-implementation-plan.md`).
De bevindingen die klein waren, zijn onderweg meegenomen.

**Gedraaid, met de echte aantallen:** `npx vitest run` → **200 geslaagd, 0
gefaald** (9 bestanden; was 164). `npx tsc --noEmit` schoon. `pnpm build` exit 0,
**24 bestanden gescand** (was 22). En `dist/` is in Chrome 151 geladen: de
extensie laadt, de service worker draait, popup en optiescherm renderen met
**nul** CSP-weigeringen en nul console-fouten. Het paneel van het content script
is daar ook gemeten, met een gestubde worker, in beide toestanden.

## De kop van het oordeel: "hij zegt niets nuttigs"

Op een IKEA-productpagina met twee gewone Nederlandse kaarten aangevinkt stond
er: _"van de kaarten die je hebt aangevinkt, weten we bij geen enkele wat deze
aankoop oplevert"_, met een advies van vijftig cent eronder. Dat staat er nog —
het is waar, en de datalaag (A1) is niet in deze map te repareren.

Wat er nu **boven** staat, letterlijk afgelezen uit de popup in Chrome 151, bij
een saldo van 42.000 punten en een bedrag van € 360:

> **PUNTEN DIE JE HIER HEBT LIGGEN**
> _Amex_ — Je hebt hier 42.000 punten liggen. Bij de gepubliceerde koers van
> Membership Rewards is dat € 126,00 — 35% van deze € 360,00. Inwisselen gaat via
> Betalen met Punten via de Amex App / online account — niet in de kassa van deze
> winkel. Of deze winkel dit programma accepteert, kunnen we hier niet zien.
> Overboeken naar een luchtvaart- of hotelpartner heeft een andere waarde, en die
> publiceert Amex niet.
> Koers: "1.000 Membership Rewards punten zijn gelijk aan € 3." Bron:
> americanexpress.com, gelezen 21 augustus 2026. Op 22 augustus 2026 zelf opnieuw
> opgehaald met kale curl en een browser-UA: HTTP 200, 604.301 bytes, en het
> citaat staat er woordelijk in. Saldo door jou ingevoerd op 12 augustus 2026.
>
> Deze punten gaan niet verloren door hier met een andere kaart te betalen — ze
> blijven staan. Dit is een herinnering, geen voordeel dat je hier moet pakken.

En op een **IKEA-actiepagina**, waar de lezer sinds L6 niets teruggeeft en het
paneel dus zweeg, staat nu hetzelfde puntenblok onder de melding over het bedrag.
Dat is de directe reparatie van de tweede helft van het oordeel: het blok hangt
niet aan een leesbaar bedrag, alleen het percentage doet dat.

Het gat is niet dichtgepraat. Bij één van de vier programma's staat een bedrag,
en bij de andere drie staat er per programma een **andere** reden waarom niet —
ING (uitgesproken nul van de uitgever), Revolut (uitgever zegt: geen vaste
waarde), Flying Blue (wij konden het niet lezen). Dat onderscheid is de kern en
het is getest (`points.test.ts`, 20 tests).

## De openstaande bevindingen

| #            | wat er is gebeurd                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A3**       | **dicht.** Eigen `PaneelGroep` `geen-euro-uitkomst` met de kop "Opbrengst niet in euro's". Afgelezen in Chrome: Bleap staat onder "Kaartkosten onbekend", de zeven tokenkaarten onder de nieuwe kop. Test in `panel.test.ts`.                                                                                                                                                                                                                                                                                 |
| **A6**       | **dicht.** `getal()` in `money.ts`; `options.ts:90` gebruikt hem. "0.5 punt(en) per euro" is "0,5 punt(en) per euro". Test in `money.test.ts`.                                                                                                                                                                                                                                                                                                                                                                |
| **B3**       | **dicht.** De zin in `chrome.d.ts` zegt nu dat `connect-src 'none'` alleen voor `extension_pages` geldt, dat een content script daar buiten valt, en wat de dekking daar wél is (de buildpoort, met de zeven naalden opgesomd).                                                                                                                                                                                                                                                                               |
| **N4**       | **dicht, en de vergaarbak is opgesplitst.** `bedrag-onduidelijk` gaat nu alleen nog over het duizendteken. Erbij: `bedrag-afgekapt`, `bedrag-niet-leesbaar`, `bedrag-negatief`. Bijvangst: `"96,99 €"` en `"EUR 96,99"` werden geweigerd en worden nu gewoon gelezen — de strip keek alleen naar een vooraanstaand teken. En `popup.ts` heeft zijn hardgecodeerde tekst niet meer: er is een tweede lijst `HANDMATIG_TEXT`, want "vul het bedrag zelf in" is onder het veld waar je dat net deed geen advies. |
| **N5**       | **dicht.** Eén uiteinde van een reeks geeft `prijs-vanaf` met een eigen tekst; twee verschillende uiteinden blijven `prijsbereik`.                                                                                                                                                                                                                                                                                                                                                                            |
| **N6**       | **dicht.** Een `UnitPriceSpecification` **zonder** `unitCode`, `unitText` of `referenceQuantity` is de artikelprijs (Shopware/Magento). De kiloprijs-fixture weigert nog steeds — die draagt `referenceQuantity: 1 KGM`, en dát is wat een eenheidsprijs een eenheidsprijs maakt. Nieuwe fixture erbij.                                                                                                                                                                                                       |
| **N7**       | **dicht.** De SLÄKT-meting staat onder het vinkje (`sites.ts`) en in de README-tabel, met de consequentie erbij: op actiepagina's zegt de extensie niets over het bedrag. Plus wat er dan wél staat.                                                                                                                                                                                                                                                                                                          |
| **N8**       | **dicht, maar anders.** De voetregel noemt niet één datum maar de **spreiding**: "Kaartgegevens gecontroleerd tussen 1 maart 2022 en 20 augustus 2026; bij elke regel staat de datum van dat ene cijfer." Geen enkele losse datum kan hier waar zijn — de bouwdatum verzwijgt het oudste cijfer, de nieuwste controledatum verklaart alles vers. Afgeleid uit de bundel zelf, dus het beweegt mee. `docs/catalog/catalog.json` is **niet** aangeraakt: dat is niet van deze lane.                             |
| **N9**       | **dicht.** Het Escape-voorbehoud staat in de README, met de reden dat er geen globale vanger hangt.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **N10**      | **dicht.** De alinea is vervangen door de meting: het commando, de extensie-id, en wat er wel en niet te meten viel. Het toestemmingsvenster blijft onmeetbaar in headless en dat staat er ook.                                                                                                                                                                                                                                                                                                               |
| **11**       | **dicht.** Het `style`-attribuut is naar `stijl.css`; `style-src` staat op `'self'`. De build weigert het nu als `'unsafe-inline'` terugkomt, en dat is nagemeten door het opzettelijk terug te zetten in een kopie buiten de repo.                                                                                                                                                                                                                                                                           |
| **N1/N2/N3** | waren al dicht vóór deze lane, in commit `a4147ec`. Zelf nagelezen in `rank.ts` (`bepaalClaim` neemt `veld`; `feeClaim.soort !== "vast"` maakt van een voorwaardelijke nul een brutoregel) en de tests staan er (`rank.test.ts:479` e.v.). 37 rank-tests groen.                                                                                                                                                                                                                                               |
| **A1**       | **niet dicht, en niet hier te repareren.** 0 van de 77 kaarten heeft zowel een cashbackcijfer als een prijs. De puntenkant is geen oplossing voor A1 — het is een tweede antwoord naast een leeg antwoord.                                                                                                                                                                                                                                                                                                    |

## Wat er bij is gekomen aan poorten

De buildpoort scande "alles in dist", maar dat was alleen bewezen voor `.html` en
`.css`, omdat die in de zelftest stonden. Er staat nu een achtste zelftestgeval:
een adres in een bestand met een **onbekende extensie**. Onafhankelijk nagemeten
in een kopie buiten de repo — met een `dist/pixel.dat` erbij sluit de build af
met exit 1 en `dist/pixel.dat:1 bevat een http(s)-adres`, naast de drie oude
gevallen. Vier op vier betrapt.

## Wat blijft liggen, met de reden

1. **A1, de datalaag.** Buiten deze map. Eén gangbare Nederlandse kaart met een
   cashbackcijfer én een prijs verandert meer dan alles hierboven.
2. **`generatedAt` in `docs/catalog/catalog.json`.** Dat bestand is van een
   andere lane. De voetregel is aan onze kant waar gemaakt; de bron van de
   verwarring niet.
3. **Het toestemmingsdialoog.** Een venster van het besturingssysteem; blijft in
   een headless sessie hangen. De code hangt er niet van af.
4. **Revolut's koersbron is vandaag niet te lezen** (HTTP 403, Cloudflare, ook
   via `r.jina.ai`). Niet omzeild. Die regel draagt daarom de datum van 21
   augustus en zegt dat er zelf bij op het scherm.
5. **Geen brug naar de kluis.** Beredeneerd, niet vergeten: zie "Waarom de saldi
   in de extensie worden ingetypt" in de README en de kop van `store.ts`.
