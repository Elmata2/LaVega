# LaVega — aan de kassa

Een browserextensie voor Chrome en Edge (Manifest V3) die bij het afrekenen twee
dingen laat zien:

1. **welke punten je hier hebt liggen** — en waar een uitgever een koers
   publiceert, wat ze van deze aankoop dekken, met bron en datum;
2. **welke van jouw kaarten op deze aankoop het meeste oplevert** — met dezelfde
   bron-en-datumregel.

Onbekende cijfers worden niet op nul gezet: ze staan er als onbekend, met de
reden waarom.

Alles gebeurt in je eigen browser. Er gaat geen enkel verzoek naar buiten, ook
niet naar lavega.dev.

### De punten: wat we weten en wat we niet weten

**Wij kennen je saldo. Wij kennen niet wat een winkel accepteert.** Die twee
zinnen bepalen alles wat er op het scherm mag staan.

Je saldi typ je zelf in (zie "Eerst instellen"). De koersen zitten in de bundel,
uit `docs/catalog/staging-points.json`, met per regel de letterlijke zin van de
uitgever, de bron en de datum. Gemeten op 22 augustus 2026:

```bash
node -e "import('./dist/generated/points-rates.generated.js').then(m=>{
  const r=m.POINTS_RATES;const per=s=>r.filter(x=>x.soort===s).length;
  console.log(r.length,'programma\'s |','koers:',per('koers'),
    '| uitgesproken nul:',per('uitgesproken-nul'),
    '| geen vaste waarde:',per('geen-vaste-waarde'),
    '| niet gelezen:',per('niet-gepubliceerd'))})"
# → 4 programma's | koers: 1 | uitgesproken nul: 1 | geen vaste waarde: 1 | niet gelezen: 1
```

Bij **één** programma mag er dus een bedrag én een percentage op het scherm:
Amex Membership Rewards, `1.000 punten = € 3`, zelf opgehaald met kale curl
(HTTP 200, 604.301 bytes, citaat woordelijk aanwezig). Bij de andere drie staat
er alleen dát je punten hebt, met per programma een andere reden waarom er geen
bedrag bij staat:

| Programma | Wat er op het scherm mag | Waarom |
| --- | --- | --- |
| Amex Membership Rewards | bedrag én percentage | de uitgever publiceert de koers |
| ING Punten | geen percentage, wel de nul | ING zegt zélf "geen geldwaarde" — een uitgesproken nul, maar alleen voor géld; wat een punt in de ING Winkel aan korting doet is onbekend |
| Revolut RevPoints | alleen het saldo | Revolut zegt zelf dat er géén vaste waarde is. Dat is iets anders dan nul |
| Flying Blue Miles | alleen het saldo | **wij** konden geen koers lezen (404 op het inwisselpad). Een gat in onze meting, geen uitspraak van de uitgever |

Een programma dat niet in die lijst staat, mag hij zelf toevoegen. Dan staat er
"we weten niet wat een punt hier waard is" — nooit een verzonnen bedrag.

**En één zin die de verkoopkant van dit idee tegenspreekt, en er daarom staat:**
inwisselen levert overal dezelfde koers op, dus er is aan deze kassa geen
voordeel te halen dat er morgen niet ook is. Door hier met een andere kaart te
betalen gaat er niets verloren. Dit blok is een **herinnering** — dat je punten
hebt liggen op het moment dat het ertoe doet — en geen arbitrage. Bij een
aankoop in vreemde valuta is het sterker: met de kaart van het programma betalen
om punten te kunnen inwisselen kost koersopslag over het hele bedrag, terwijl
diezelfde punten volgende week op een euro-aankoop even veel waard zijn. Dat
staat er dan ook.

**Wat er nooit staat**, elk met de fout die eronder ligt:

- een percentage bij een programma zonder gepubliceerde koers — verzonnen getal;
- "deze winkel accepteert je punten" — dat kunnen we op een afrekenpagina niet
  zien, en de koers die we hebben is niet winkelspecifiek;
- een saldo zonder de datum waarop je het invoerde — een saldo van vier maanden
  oud als "nu" presenteren is een stille onwaarheid;
- "gebruik je punten hier en bespaar X" — inwisselen gebeurt bij Amex achteraf in
  de app, dus dat is advies dat aan deze kassa niet uit te voeren is.

### Waarom de saldi in de extensie worden ingetypt en niet uit de kluis komen

Er waren twee wegen en geen goede.

**Een brug naar de LaVega-tab** houdt het saldo op één plek. Maar het is een
nieuw kanaal: `externally_connectable` of hostrechten op het eigen domein, een
berichtvorm, en aan beide kanten een redactiegrens die bewaakt moet worden. Elk
van die drie kan stukgaan, en de derde kan stukgaan met iets dat weglekt.
Bovendien werkt hij niet als de tab dicht is — precies op het moment waarvoor
dit gebouwd is.

**Twee keer invoeren** levert saldi op die uit elkaar lopen met de kluis. Dat is
een echte kost en hij is niet te vermijden, alleen zichtbaar te maken: elk saldo
draagt de datum waarop je het opschreef, die datum staat altijd op het scherm, en
na negentig dagen (`VEROUDERD_NA_DAGEN`, hetzelfde getal als `isStale` in
`packages/core`) zegt de extensie erbij dat het oud is.

**V1 kiest de tweede weg, want die kan op minder manieren kapot**: geen kanaal,
geen tweede grens, en hij werkt met de kluis dicht. De eerste weg blijft open —
komt er ooit een brug, dan vervangt die de invoer en verandert er in `points.ts`
geen regel, want dat bestand krijgt zijn saldi als parameter.

### Wat "verrekenen" bij de KAARTEN betekent, en hoe vaak dat vandaag gebeurt

Een eerdere versie van deze alinea zei "met de kaartkosten erin verrekend". Dat
klopte niet, en de reden is te meten.

Van de opbrengst worden kaartkosten alleen afgetrokken als de bundel van
diezelfde kaart **allebei** kent — een cashbackcijfer én een prijs — en je die
kaart nog niet hebt. Gemeten op 21 augustus 2026, op de bundel van 19 augustus
2026 (`CATALOG_GENERATED_AT`):

```bash
node -e "import('./dist/generated/catalog.generated.js').then(m=>{const c=m.CHECKOUT_CARDS,
  h=v=>v!==null&&v!==undefined;console.log(c.length,
  c.filter(k=>h(k.cashbackPct)).length, c.filter(k=>h(k.fee)).length,
  c.filter(k=>h(k.cashbackPct)&&h(k.fee)).length)})"
# → 77 kaarten, 8 met cashbackcijfer, 27 met een prijs, 0 met allebei
```

Nul met allebei betekent: er wordt op dit moment bij geen enkele kaart iets
verrekend. Wat je op het scherm ziet zijn brutobedragen, met de kaartkosten als
open vraag ernaast. Het woord "netto" komt er dan ook niet in voor — dat is
getest — maar verwacht van deze versie geen netto-antwoord.

Het middelste getal beweegt: aan de catalogus wordt gewerkt. Draai het commando
hierboven opnieuw na elke `pnpm bundle:catalog`. **Zodra het laatste getal niet
meer nul is, klopt deze alinea niet meer en hoort hij herschreven te worden** —
dan is "met de kaartkosten erin verrekend" opeens wél waar, voor precies dat
aantal kaarten.

---

## In Chrome laden

De extensie staat niet in de Web Store. Je laadt hem uitgepakt:

```bash
pnpm --filter @lavega/extension build
```

Dat zet een complete, laadbare map in `apps/extension/dist`. Dan:

1. open `chrome://extensions` (in Edge: `edge://extensions`);
2. zet **Ontwikkelaarsmodus** rechtsboven aan;
3. klik **Laad uitgepakte extensie**;
4. kies de map `apps/extension/dist` — niet `apps/extension` zelf, en niet een
   los bestand;
5. het icoon (een lichte pas op donkergroen) verschijnt in de werkbalk. Zet hem
   eventueel vast via het puzzelstukje.

Na een nieuwe `build` klik je op `chrome://extensions` op het herlaadpictogram
van de extensie. Chrome pakt de nieuwe bestanden niet vanzelf op.

Als de extensie niet laadt, staat de reden op de kaart in `chrome://extensions`
onder **Fouten**. De build controleert van tevoren op de oorzaken die dat
meestal zijn; zie [Wat de build controleert](#wat-de-build-controleert).

## Eerst instellen

Klik op het icoon → **Kaarten, punten en winkels instellen** (of rechtsklik op
het icoon → **Opties**).

- **Welke kaarten heb je?** Vink aan wat je in je portemonnee hebt. Dit is de
  hele koppeling met LaVega in deze versie: één lijstje in je browser. Geen
  account, geen verbinding met je kluis, geen server.
- **Mag het paneel op winkelpagina's verschijnen?** Standaard staat dit uit en
  heeft de extensie geen enkele leestoestemming. Zet je het vinkje aan, dan
  vraagt Chrome in één keer om toestemming voor alle websites — niet per
  winkel — en die toestemming kun je in `chrome://extensions` altijd weer
  intrekken; het vinkje in de opties gaat dan vanzelf uit.

Waarom het uitmaakt wat je aanvinkt: een kaart die je AL hebt, kost je die
maand- of jaarprijs toch. Die kosten worden daarom niet van de opbrengst
afgetrokken — ze staan ernaast als feit. Bij een kaart die je nog niet hebt
gebeurt het omgekeerde: dan is die prijs wél een gevolg van het advies, en wordt
er netto gerekend. Het waarom staat uitgeschreven in `src/rank.ts`. Dat is de
regel; met de huidige bundel komt hij nooit aan de beurt, want geen enkele kaart
heeft zowel een cashbackcijfer als een prijs.

### En je puntensaldi

In hetzelfde optiescherm staat **Welke punten heb je liggen?**. Vier programma's
staan er al in omdat we van elk weten welke soort uitspraak we mogen doen; typ er
het aantal punten in dat je hebt. Wat je invoert krijgt de datum van vandaag mee,
en die datum komt aan de kassa op het scherm — na negentig dagen met de
mededeling dat het saldo oud is.

Een programma dat er niet bij staat, voeg je onderaan toe. Dan zie je aan de
kassa dát je punten hebt, met de mededeling dat we niet weten wat ze waard zijn.
Leeg maken van het veld haalt het saldo weg; nul punten en geen saldo zijn twee
verschillende dingen en nul levert geen regel op — er ligt dan niets om aan te
herinneren.

## Wat hij doet

**Het puntenblok staat bovenaan, en werkt ook zonder leesbaar bedrag.** Wat je
aan punten hebt liggen hangt niet af van wat er op de pagina staat. Alleen het
percentage doet dat, en dat verdwijnt dan — het bedrag dat je saldo bij de
gepubliceerde koers waard is, blijft staan. Dat is precies de toestand op een
IKEA-pagina met een actieprijs, waar de extensie over het bedrag zwijgt.

**Het werkbalkvenster werkt overal.** Je typt een bedrag, kiest eventueel de
munt waarin de winkel afrekent, en krijgt de ranglijst. Dit venster leest geen
enkele pagina en vraagt daar ook geen toestemming voor. Dat is het normale
gebruik.

**Het paneel op de winkelpagina is de uitzondering.** Staat het vinkje "Paneel
op winkelpagina's" aan, dan leest de extensie het bedrag van de pagina en zet
het antwoord in een klein paneel rechtsonder. Je sluit het met het kruisje, of
met Escape **zodra de
aandacht in het paneel zit** — klik er dus eerst in, of gebruik het kruisje. Er
hangt met opzet geen globale Escape-vanger in de pagina: die zou de zoekbalk of
de maatkiezer van de winkel in de weg zitten, en een extensie hoort geen toetsen
af te pakken van de winkel waar je aan het afrekenen bent.

In beide gevallen staat onder elk cijfer waar het vandaan komt en wanneer het
voor het laatst is gecontroleerd. Aan een kassa is die datum het enige waarop je
de betrouwbaarheid kunt afmeten.

**Wat je met een gewone Nederlandse pas te zien krijgt:** van de 77 kaarten in
de bundel hebben er 8 een cashbackcijfer, en dat zijn alle acht cryptokaarten.
Heb je een ING-betaalpas en een ABN-creditcard aangevinkt, dan is het antwoord
"over deze kaarten weten we niet of ze iets teruggeven" plus een lijstje van wat
er elders te halen valt. Dat is een eerlijk antwoord op de vraag, maar het is
zelden een bruikbaar antwoord — en dat verandert pas als de catalogus voor
gangbare Nederlandse kaarten cijfers krijgt.

## Op welke sites hij werkt, en wat dat vinkje wel en niet dekt

Tot 26 augustus 2026 stond hier een tabel met precies één rij: IKEA Nederland,
`https://www.ikea.com/nl/nl/p/*`, de enige winkel die eerst gemeten en
goedgekeurd was voor het paneel er mocht draaien. Die curatie is vervangen
door **één brede, optionele toestemming**: `<all_urls>` in
`optional_host_permissions`, aan- of uitgezet met het vinkje "Paneel op
winkelpagina's" in de opties (`kassaOveralAan` in `chrome.storage.local`, zie
`src/store.ts`). Staat het vinkje aan **en** heeft Chrome de toestemming
gegeven, dan probeert het paneel te lezen op elke `https:`-pagina — niet meer
op een lijst die per winkel is goedgekeurd. Staat één van de twee uit, dan
nergens.

Wat daarbij niet is veranderd: de lezer zelf. `src/read.ts`
(`collectEvidence`/`readCheckout`) was al volledig generiek — hij leest
JSON-LD, `itemprop`-microdata en Open Graph price-tags, ongeacht welke host
erbij staat, met elf benoemde weigerredenen (rangeprijzen, valutategenspraak,
meerdere prijzen op één pagina, etc.). Dat bestand is voor deze wijziging geen
regel veranderd; het was al gebouwd om overal te kunnen draaien en kreeg door
de curatie eerder alleen nooit de kans. Wat LaVega van een pagina meeneemt is
dus nog steeds precies wat het altijd was: **de machineleesbare
productgegevens die een winkel zelf op de pagina zet** — dezelfde gegevens die
zoekmachines gebruiken voor hun productkaarten. Nooit de rest van de pagina,
nooit de zichtbare tekst, nooit een titel of omschrijving.

### Wat dat vinkje niet dekt, en waarom dat een bewuste keuze is

Machineleesbare opmaak kan geldig zijn en toch over het VERKEERDE artikel
gaan. Op 21 augustus 2026 gaf Coolblue keurige JSON-LD (schema.org) met een
prijs en een munt — maar die JSON-LD ging over een ánder product dan de pagina
toonde:

```
/product/949341/apple-airpods-pro-3.html   → Samsonite kofferset, € 420
/product/865867/sonos-era-100-zwart.html   → PlayStation 5, € 490
```

Tegen geldige opmaak met de verkeerde inhoud heeft de lezer geen verweer: er
komt met vlag en wimpel € 490 uit op een Sonos van € 279, de ranglijst rekent
daar een percentage over uit, en er rolt een aanbeveling uit die nergens op
slaat, zonder dat er ergens twijfel in beeld komt. **Een winkel waar je het
verkeerde bedrag leest, is erger dan een winkel waar je zwijgt.**

Onder het oude, per-site gemeten model was precies dit de reden om Coolblue
buiten de lijst te houden. Onder `<all_urls>` bestaat die lijst niet meer, en
dus ook niet de mogelijkheid om één winkel op deze grond uit te sluiten. Dat
is geen oversight: het is een bewuste risico-acceptatie voor persoonlijk
gebruik, expliciet zo besloten op 26 augustus 2026 (zie
`docs/superpowers/specs/2026-08-26-brede-kassa-toestemming-design.md`) —
alles gaat mee, en wat in de praktijk fout blijkt wordt gaandeweg gesignaleerd
in plaats van vooraf dichtgetimmerd. `read.test.ts` legt dit nu vast als een
GEDOCUMENTEERDE, GEACCEPTEERDE beperking (de Coolblue-fixture geeft
`{ ok: true }` terug met het bekend-verkeerde bedrag) en niet meer als "deze
winkel staat er niet in". Bol.com is om een andere reden geen bijzonder geval:
die geeft opmaak zonder prijs, dus daar komt sowieso niets uit — met of zonder
lijst.

Dezelfde kwetsbaarheid geldt voor een `AggregateOffer`-actieprijs — een
IKEA-productpagina met een Family-actieprijs naast de gewone prijs geeft de
lezer bijvoorbeeld een prijsbereik zonder te vermelden welke van de twee bij
jou geldt, en de lezer pakt dan de laagste in plaats van te zwijgen. Zie de tak
"prijsbereik" en de meting daarachter in `src/read.ts`.

**Wat er op elke pagina wél blijft staan, ongeacht dit vinkje**: je
puntensaldi. Die hangen niet van het bedrag op de pagina af, dus daar is de
leestoestemming niet voor nodig.

### De build-controle op een heel domein geldt nu alleen nog voor ING/Amex

Vroeger weigerde de build een matchpatroon dat alleen een domein aanwees
(`https://www.ikea.com/*` liet `pnpm build` omvallen) — dat gold voor de ene
winkel die er stond, en het dwong af dat de goedkeuring niet verder reikte dan
het gemeten pad. Die controle bestaat nog, maar geldt nu alleen voor de
accountpatronen van ING en Amex in `src/bronnen.ts` (`padIsSpecifiek`,
gecontroleerd door `scripts/copy-static.mjs`) — niet voor de kassa-registratie.
`<all_urls>` is geen `https:`-patroon met een pad om op te controleren, dus die
controle is voor de brede toestemming niet van toepassing: er is geen pad meer
dat afgedwongen kan worden, en de enige begrenzing die voor het kassa-paneel
overblijft is het vinkje zelf plus wat `read.ts` weigert te lezen.

Wat er voor de kassa-lezing wel overblijft, en dat hoort hier te staan:
navigeert het tabblad in de milliseconden tussen de vraag van het content
script en de lezing naar een andere pagina op dezelfde host, dan gaat de
lezing over die andere pagina. Na de lezing wordt de host nog één keer
gecontroleerd tegen `hostVanAfzender` in `src/background.ts` (schema, poort,
en of `sender.origin`/het tabblad hetzelfde https-origin dragen), dus dat
blijft binnen hetzelfde origin. Helemaal dicht is het met `documentIds` bij
`executeScript`; dat staat niet in `src/chrome.d.ts` en dat bestand is met
opzet de complete lijst van wat deze extensie mag aanroepen.

## Wat hij niet doet

- **Geen netwerkverkeer.** Geen fetch, geen analytics, geen telemetrie, ook niet
  naar lavega.dev. De kaartgegevens zitten in de bundel en worden niet
  bijgewerkt zonder een nieuwe versie van de extensie. Twee hekken houden dat
  tegen, en ze dekken verschillende dingen:

  1. **de build.** `scripts/copy-static.mjs` scant ALLES wat in `dist/` belandt —
     `.js`, `.html`, `.css`, JSON en de gegenereerde iconen — op verkeer
     (`fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`,
     `importScripts`, `new Image(`) en op adressen in resourcepositie
     (`url()`, `@import`, `src=`, `href=`). In alles wat geen `.js` is geldt nul
     tolerantie voor http(s):// en voor `//domein`; in `.js` mag een URL als
     tekst voorkomen, want de catalogus en de puntenkoersen dragen bij elk cijfer
     hun bron mee en er wordt niets mee opgehaald.
  2. **de CSP** in het manifest, voor de extensiepagina's en de service worker:
     `default-src 'none'` met `img-src`, `font-src`, `media-src`, `connect-src`,
     `object-src`, `frame-src` en `child-src` allemaal op `'none'`,
     `script-src 'self'` en `style-src 'self'` — zonder `'unsafe-inline'`, sinds
     het ene `style`-attribuut in `popup.html` naar `stijl.css` is verhuisd; de
     build weigert het nu ook als het terugkomt. Zonder die `default-src` — de vorige vorm — waren
     `img-src`, `font-src` en `style-src` onbeperkt: `connect-src 'none'` vangt
     fetch en XHR, maar niet een `<img>` met het bedrag in de querystring.

  Wat de CSP níét dekt: het content script op de winkelpagina. `extension_pages`
  geldt voor de extensiepagina's en de worker; het content script draait in de
  pagina van de winkel en valt daarbuiten. Daar is hek 1 de dekking — `content.js`
  wordt net zo hard gescand als de rest.
- **Geen leestoestemming zonder dat jij hem geeft.** `host_permissions` in het
  manifest is leeg — de extensie krijgt bij installatie nul toegang tot enige
  pagina. Alles loopt via `optional_host_permissions`
  (`<all_urls>` voor het kassa-paneel, plus de aparte ING/Amex-patronen), en
  elk van die drie vraagt apart om toestemming: het aanzetten van het ene
  vinkje zet niet ook de andere twee aan. Sinds 26 augustus 2026 is de
  kassa-toestemming zelf breed — `<all_urls>`, niet meer per winkel gemeten —
  maar ze blijft **optioneel en herroepbaar**: jij zet het vinkje om, Chrome
  vraagt het, en trek je de toestemming in `chrome://extensions` weer in, dan
  gaat het vinkje in de opties vanzelf uit. Zie [Op welke sites hij
  werkt](#op-welke-sites-hij-werkt-en-wat-dat-vinkje-wel-en-niet-dekt) voor
  wat die brede toestemming wel en niet dekt.
- **Geen bedragen of ordergegevens bewaren.** In de opslag staan drie dingen:
  welke kaarten je hebt, of het paneel op winkelpagina's mag verschijnen (één
  aan/uit-vinkje, `kassaOveralAan` — geen lijst van winkels meer), en de
  puntensaldi die je zelf hebt ingetypt. Niets dat aan een BEZOEK vastzit —
  geen bedragen van een pagina, geen artikelen, geen hosts, geen tijdstippen.

  Dat derde lijstje verdient een aparte zin, want het lijkt een uitzondering op
  de eerste. Wat er niet in mag is alles wat ONTSTAAT doordat je ergens kijkt;
  dat is de data waarvan een bewaarde kopie een boodschappenlijst is. Een
  puntensaldo is het omgekeerde: je eigen opgave over jezelf, ingetypt op een
  leeg formulier, en het verandert niet doordat je een winkel bezoekt. Er zit
  geen euro in, geen rekeningnummer en geen transactie — een programmanaam, een
  aantal punten en de dag waarop je het opschreef. En dat aantal gaat nooit als
  getal naar een winkelpagina: het content script krijgt afgemaakte zinnen, net
  als bij de kaarten.
- **Niets van de pagina behalve het bedrag.** Wat de extensie uit een pagina
  meeneemt is de host plus de bedragen die er machineleesbaar op staan. Geen
  titel, geen artikelnaam, geen omschrijving. `read.test.ts` bewaakt die grens
  ("wat de extensie van een pagina meeneemt").
- **Geen remote code.** Manifest V3 verbiedt het en er staat niets in dat het
  zou proberen.
- **Nooit gokken.** Vindt de lezer geen eenduidig bedrag, dan zegt het paneel
  dát, met de reden, en wijst het naar het handmatige veld. Staat de prijs in
  een andere munt dan de euro, dan weigert het paneel ook: omrekenen zou een
  wisselkoers vragen en die halen we nergens op.
- **Geen animaties.** Het paneel staat er of het staat er niet.

## Hoe het in elkaar zit

```
public/manifest.json     Manifest V3
public/popup.html        het werkbalkvenster        → src/popup.ts
public/options.html      kaarten, punten, kassa-vinkje, bronnen → src/options.ts
src/content.ts           het paneel op de pagina    (klassiek script, geen imports)
src/background.ts        service worker: registratie, lezen, antwoorden
src/read.ts              bedrag van een pagina lezen, of weigeren met een reden
src/points.ts            wat je puntensaldi hier dekken — of waarom niet
src/rank.ts              welke kaart hier het meeste oplevert
src/horizon.ts           de horizonregel: eenmalig versus terugkerend
src/lines.ts             de Nederlandse zinnen
src/panel.ts             van rangschikking naar schermtekst
src/bronnen.ts           de lijst van aanbiedingenbronnen (ING/Amex) en hun matchpatronen
src/money.ts             centen en nl-NL-notatie
src/store.ts             kaarten, kassa-vinkje, puntensaldi en per-bron gegevens in chrome.storage
src/generated/           de gebundelde kaartgegevens (77 producten) en
                         de puntenkoersen (4 programma's)
```

De keten bij een winkelpagina: content script meldt zich → service worker
controleert de herkomst en het vinkje → `chrome.scripting.executeScript` draait
`collectEvidence` in de pagina → `readCheckout` → `rankCheckout` → `buildPanel` →
er gaan **alleen afgemaakte Nederlandse zinnen** terug naar de pagina. Het
content script kan niet rekenen en hoeft dat niet; het plakt tekst in een
gesloten schaduw-DOM die de winkel niet kan uitlezen.

Dat het content script niets importeert is geen slordigheid: een content script
in MV3 is een klassiek script, en één `import` maakt het stil onwerkzaam. De
gedeelde typen staan daarom als ambient globals in `src/messages.d.ts`.

## Ontwikkelen

```bash
cd apps/extension

npx vitest run          # de hele suite (het aantal groeit; pin het hier niet vast)
npx tsc --noEmit        # typecheck
pnpm build              # dist/ vullen en controleren
pnpm bundle:catalog     # src/generated/ opnieuw maken uit docs/catalog/catalog.json
```

De fixtures in `src/__fixtures__/` zijn opgeslagen HTML. Geen enkele test raakt
een live site: een test die het internet nodig heeft, meet het internet en niet
de code. Fixtures zonder voorvoegsel zijn echt opgehaald (met bron en
HTTP-status in de kop van het bestand); `kunstmatig-` is met de hand gemaakt
omdat dat pad in het wild niet te meten was.

Er is geen bundelaar. `tsc` schrijft ES-modules met `.js`-extensies naar `dist/`,
en dat is precies wat een MV3 service worker (`"type": "module"`) en een
`<script type="module">` in een extensiepagina nodig hebben.

### Wat de build controleert

`scripts/copy-static.mjs` kopieert niet alleen, het weigert een bundel die
Chrome zou afwijzen of die stilletjes niets doet:

1. verwijst het manifest naar een bestand dat niet bestaat?
2. is `content.js` per ongeluk een ES-module geworden?
3. staat er iets in de bundel dat het netwerk op gaat? (alles in `dist/`, niet
   alleen `.js`)
4. staat `<all_urls>` plus de accountpagina's van `src/bronnen.ts` in het
   manifest, en wijst elk accountpatroon (ING/Amex) een pad aan in plaats van
   een heel domein? (Vóór 26 augustus 2026 stond hier een lijst met
   individueel gemeten winkels in plaats van `<all_urls>`.)
5. heeft de CSP een `default-src`, staan `img-src`, `font-src`, `media-src` en
   `connect-src` op `'none'`, en staat `style-src` op `'self'` zonder
   `'unsafe-inline'`?
6. past de `description` binnen de 132 tekens die Chrome toestaat?

Die fouten zie je anders pas als de extensie al geïnstalleerd is — of, bij de
tweede, alleen in de console van de winkelpagina.

**Controle 3 controleert ook zichzelf.** Bij elke build gaat er eerst een
zelftest doorheen: **acht** bestanden die er niet doorheen mógen (een
`@font-face` naar `fonts.gstatic.com`, een `background-image` naar een vreemd
domein, een 1×1-`<img>` met het bedrag in de querystring, een schemaloos
`//domein`, een `fetch(` in een inline script, een remote `url()` in een
stylesheet die JavaScript in de pagina zet, een vreemd adres in het manifest, en
een adres in een bestand met een **onbekende extensie**) en vijf die er juist met
rust gelaten moeten worden (de echte popup, de echte stylesheet, het echte
manifest met zijn matchpatroon, de catalogus met haar bronvermeldingen als tekst,
en de puntenkoersen met de bron van de koers als tekst). Mist de poort er één,
dan is de build klaar en is er niets gescand.

Dat achtste geval is er op 22 augustus 2026 bij gezet, want het was nergens
bewezen: de poort behandelt alles wat niet `.js` is als "elk adres verboden",
maar dat gold voor `.html` en `.css` alleen omdat die in de zelftest stonden.
Een `.png`, een `.txt` of een `.woff2` viel onder dezelfde regel zonder dat
iemand het had nagemeten. Onafhankelijk nagemeten in een kopie buiten de repo:
met een `dist/pixel.dat` erbij die één adres bevat, sluit de build af met exit 1
en `dist/pixel.dat:1 bevat een http(s)-adres`.

Dat staat er omdat de vorige versie van deze controle alleen naar `.js` keek.
`public/` levert ook `.html` en `.css` mee, dus een trackingpixel mét bedrag ging
er ongezien doorheen terwijl de build afsloot met `ok — geen netwerkaanroepen in
de bundel`. Een poort die groen meldt terwijl er iets doorheen komt is erger dan
geen poort. Om die reden staat er nu ook geen `ok` meer boven een controle die
iets gevonden heeft.

De iconen worden tijdens de build gegenereerd (`scripts/icon-png.mjs`, een PNG
met de hand geëncodeerd op `node:zlib`). Er komt geen afbeelding van internet in
de bundel.

## Wat er nog niet is

- Geen denylist. Sinds 26 augustus 2026 dekt één brede, optionele toestemming
  elke `https:`-winkel, zonder dat er per winkel gemeten en goedgekeurd wordt —
  zie [Op welke sites hij werkt](#op-welke-sites-hij-werkt-en-wat-dat-vinkje-wel-en-niet-dekt)
  voor wat dat wel en niet dekt, en waarom dat een bewuste keuze is en geen
  oversight.
- Geen brug naar de LaVega-kluis. Het kaartenlijstje én de puntensaldi zijn met
  de hand. Waarom dat een keuze is en niet een tekort, staat in "Waarom de saldi
  in de extensie worden ingetypt" hierboven — met de kost die eraan vastzit.
- Eén programma met een koers. Komt er een tweede, dan groeit
  `points-rates.generated.ts` met één regel en verandert er verder niets; dat is
  met opzet zo gebouwd.
- Het paneel verschijnt op elke pagina waar het vinkje en de toestemming het
  toelaten, en wordt per pagina weggeklikt; er is geen "niet meer tonen op deze
  winkel" die iets onthoudt, omdat daarvoor bijgehouden zou moeten worden waar
  je bent geweest.
- Geen netto-antwoord. Zie de meting in de eerste sectie: geen enkele kaart in
  de bundel heeft zowel een cashbackcijfer als een prijs, dus de netto-tak van
  de code draait vandaag niet.
- Het **toestemmingsdialoog** van Chrome is nog nooit in het echt doorlopen. Wat
  hier eerder stond — "Chrome 151 weigert `--load-extension` zodra de sessie
  geautomatiseerd is" — was onjuist, en dat is met één commando te weerleggen:

  ```bash
  CHR=".../Google Chrome for Testing"   # 151.0.7922.34
  "$CHR" --user-data-dir=$D --no-first-run --disable-extensions-except=$E \
         --load-extension=$E --remote-debugging-port=9444 --headless=new about:blank
  curl -s http://127.0.0.1:9444/json/list
  ```

  Gedraaid op 22 augustus 2026: de extensie **laadt** (id
  `bpbjefffbjacklbbfndibdlcmghogigk`), de service worker `background.js` draait,
  en `popup.html` en `options.html` renderen volledig — met **nul**
  `Log.entryAdded`-meldingen, dus geen CSP-weigering en geen console-fout. Ook
  het paneel van het content script is daar gemeten, met een gestubde service
  worker: het staat in zijn gesloten schaduw-DOM, in beide toestanden, ook zonder
  leesbaar bedrag.

  Wat wél onmeetbaar blijft: het toestemmingsvenster zelf is een venster van het
  besturingssysteem en blijft in een headless sessie hangen. Na een echte klik op
  het vinkje stond `permissions.getAll()` nog op `{"origins":[]}`. De code hangt
  daar niet van af — `hostVanAfzender` in `src/background.ts` controleert
  schema, poort en origin zelf, en de build weigert voor de ING/Amex-patronen
  nog steeds een patroon zonder pad (zie [Wat de build
  controleert](#wat-de-build-controleert)).
