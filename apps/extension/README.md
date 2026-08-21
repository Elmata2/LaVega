# LaVega — aan de kassa

Een browserextensie voor Chrome en Edge (Manifest V3) die bij het afrekenen laat
zien wat jouw kaarten op die aankoop opleveren: het bedrag, waar dat cijfer
vandaan komt en van welke datum het is. Onbekende cijfers worden niet op nul
gezet — ze staan er als onbekend.

Alles gebeurt in je eigen browser. Er gaat geen enkel verzoek naar buiten, ook
niet naar lavega.dev.

### Wat "verrekenen" hier betekent, en hoe vaak dat vandaag gebeurt

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

Klik op het icoon → **Kaarten en winkels instellen** (of rechtsklik op het icoon
→ **Opties**).

- **Welke kaarten heb je?** Vink aan wat je in je portemonnee hebt. Dit is de
  hele koppeling met LaVega in deze versie: één lijstje in je browser. Geen
  account, geen verbinding met je kluis, geen server.
- **Op welke winkels mag het paneel verschijnen?** Standaard staat alles uit en
  heeft de extensie geen enkele leestoestemming. Vink je een winkel aan, dan
  vraagt Chrome apart om toestemming voor dat ene adres.

Waarom het uitmaakt wat je aanvinkt: een kaart die je AL hebt, kost je die
maand- of jaarprijs toch. Die kosten worden daarom niet van de opbrengst
afgetrokken — ze staan ernaast als feit. Bij een kaart die je nog niet hebt
gebeurt het omgekeerde: dan is die prijs wél een gevolg van het advies, en wordt
er netto gerekend. Het waarom staat uitgeschreven in `src/rank.ts`. Dat is de
regel; met de huidige bundel komt hij nooit aan de beurt, want geen enkele kaart
heeft zowel een cashbackcijfer als een prijs.

## Wat hij doet

**Het werkbalkvenster werkt overal.** Je typt een bedrag, kiest eventueel de
munt waarin de winkel afrekent, en krijgt de ranglijst. Dit venster leest geen
enkele pagina en vraagt daar ook geen toestemming voor. Dat is het normale
gebruik.

**Het paneel op de winkelpagina is de uitzondering.** Op een winkel die je hebt
aangevinkt leest de extensie het bedrag van de pagina en zet het antwoord in een
klein paneel rechtsonder. Je sluit het met het kruisje of met Escape.

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

## Op welke sites hij werkt, waarom het er maar één is, en wie het pad afdwingt

| Winkel | Patroon | Status |
| --- | --- | --- |
| IKEA Nederland | `https://www.ikea.com/nl/nl/p/*` | werkt — productpagina's |

Dat is de hele lijst. De drempel is niet "de winkel is groot" maar: **kunnen we
aantonen dat het bedrag dat we lezen ook echt het bedrag op díé pagina is.**

Op 21 augustus 2026 zijn eenentwintig Nederlandse winkelpagina's opgehaald. Eén
gaf een machineleesbaar bedrag mét munt dat ook bij het juiste artikel hoorde.

De belangrijkste uitkomst is een winkel die er **niet** in staat. Coolblue geeft
keurige JSON-LD (schema.org) met een prijs en een munt — maar die JSON-LD gaat
over een ánder product dan de pagina toont:

```
/product/949341/apple-airpods-pro-3.html   → Samsonite kofferset, € 420
/product/865867/sonos-era-100-zwart.html   → PlayStation 5, € 490
```

De lezer heeft daar geen verweer tegen: het is geldige opmaak met een geldige
munt, dus er komt met vlag en wimpel € 490 uit op een Sonos van € 279. Daarna
rekent de ranglijst daar een percentage over uit en rolt er een aanbeveling uit
die nergens op slaat, zonder dat er ergens twijfel in beeld komt. **Een winkel
waar je het verkeerde bedrag leest, is erger dan een winkel waar je zwijgt.**

Bol.com staat er om een andere reden niet in: die geeft opmaak zonder prijs, dus
de leestoestemming zou niets opleveren wat het handmatige veld niet al doet.

De volledige meting en de afweging staan in `src/sites.ts`. Wie een winkel wil
toevoegen, meet hem eerst en zet de meting erbij.

### Alleen productpagina's — en dat dwingt de extensie zelf af

Het patroon is `https://www.ikea.com/nl/nl/p/*`. De winkelwagen, het
bestelproces en je account vallen erbuiten.

Dat is met opzet geen belofte die op Chrome rust. Chrome's toestemmingsdialoog
praat over een DOMEIN, en of een verleende host-toestemming het pad ook
afdwingt, is hier nooit gemeten — dus wordt er niet op gebouwd. Wat er wél
gebeurt, staat in deze map:

- `siteForUrl` in `src/sites.ts` weigert elke URL waarvan schema, host of pad
  niet klopt (ook `https://www.ikea.com/` en `https://www.ikea.com/nl/nl/pizza/`).
  De service worker leest geen pagina zonder dat die functie ja zegt.
- `src/background.ts` legt daarbij `sender.url`, `sender.origin` en de URL van
  het tabblad naast elkaar. Spreken die elkaar tegen, dan zwijgt het paneel.
- de build weigert een matchpatroon dat alleen een domein aanwijst
  (`https://www.ikea.com/*` laat `pnpm build` omvallen).
- `registerContentScripts` krijgt hetzelfde patroon mét pad, dus Chrome draait
  het content script alleen daar.

Wat er overblijft, en dat hoort hier te staan: navigeert het tabblad in de
milliseconden tussen de vraag van het content script en de lezing naar een
andere pagina op dezelfde host, dan gaat de lezing over die andere pagina. Na de
lezing wordt de host nog één keer gecontroleerd, dus dat blijft binnen dezelfde
winkel. Helemaal dicht is het met `documentIds` bij `executeScript`; dat staat
niet in `src/chrome.d.ts` en dat bestand is met opzet de complete lijst van wat
deze extensie mag aanroepen.

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
     tekst voorkomen, want de catalogus draagt bij elk cijfer zijn bron mee en
     er wordt niets mee opgehaald.
  2. **de CSP** in het manifest, voor de extensiepagina's en de service worker:
     `default-src 'none'` met `img-src`, `font-src`, `media-src`, `connect-src`,
     `object-src`, `frame-src` en `child-src` allemaal op `'none'`, en
     `script-src 'self'`. Zonder die `default-src` — de vorige vorm — waren
     `img-src`, `font-src` en `style-src` onbeperkt: `connect-src 'none'` vangt
     fetch en XHR, maar niet een `<img>` met het bedrag in de querystring.

  Wat de CSP níét dekt: het content script op de winkelpagina. `extension_pages`
  geldt voor de extensiepagina's en de worker; het content script draait in de
  pagina van de winkel en valt daarbuiten. Daar is hek 1 de dekking — `content.js`
  wordt net zo hard gescand als de rest.
- **Geen `<all_urls>`.** `host_permissions` is leeg. Alle sites lopen via
  `optional_host_permissions`, zodat Chrome het per winkel aan jou vraagt en je
  het in `chrome://extensions` weer kunt intrekken. Trek je het in, dan gaat het
  vinkje in de opties vanzelf uit. Geeft Chrome de toestemming ruimer dan het
  patroon — voor het hele domein — dan blijft de extensie zich aan het pad
  houden; zie [Alleen productpagina's](#alleen-productpaginas--en-dat-dwingt-de-extensie-zelf-af).
- **Geen bedragen of ordergegevens bewaren.** In de opslag staan twee lijstjes:
  welke kaarten je hebt en welke winkels aan staan. Niets dat aan een bezoek
  vastzit — geen bedragen, geen artikelen, geen hosts, geen tijdstippen.
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
public/options.html      kaarten en winkels         → src/options.ts
src/content.ts           het paneel op de pagina    (klassiek script, geen imports)
src/background.ts        service worker: registratie, lezen, antwoorden
src/read.ts              bedrag van een pagina lezen, of weigeren met een reden
src/rank.ts              welke kaart hier het meeste oplevert
src/horizon.ts           de horizonregel: eenmalig versus terugkerend
src/lines.ts             de Nederlandse zinnen
src/panel.ts             van rangschikking naar schermtekst
src/sites.ts             welke winkels, en de meting waarop dat rust
src/money.ts             centen en nl-NL-notatie
src/store.ts             de twee lijstjes in chrome.storage
src/generated/           de gebundelde kaartgegevens (77 producten)
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
4. loopt `optional_host_permissions` nog gelijk met `src/sites.ts`, en wijst elk
   patroon een pad aan in plaats van een heel domein?
5. heeft de CSP een `default-src`, en staan `img-src`, `font-src`, `media-src`
   en `connect-src` op `'none'`?
6. past de `description` binnen de 132 tekens die Chrome toestaat?

Die fouten zie je anders pas als de extensie al geïnstalleerd is — of, bij de
tweede, alleen in de console van de winkelpagina.

**Controle 3 controleert ook zichzelf.** Bij elke build gaat er eerst een
zelftest doorheen: zeven bestanden die er niet doorheen mógen (een `@font-face`
naar `fonts.gstatic.com`, een `background-image` naar een vreemd domein, een
1×1-`<img>` met het bedrag in de querystring, een schemaloos `//domein`, een
`fetch(` in een inline script, een remote `url()` in een stylesheet die
JavaScript in de pagina zet, en een vreemd adres in het manifest) en vier die er
juist met rust gelaten moeten worden (de echte popup, de echte stylesheet, het
echte manifest met zijn matchpatroon, en de catalogus met haar bronvermeldingen
als tekst). Mist de poort er één, dan is de build klaar en is er niets gescand.

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

- Eén winkel. Meer winkels betekent meer metingen, niet meer regels in het
  manifest.
- Geen brug naar de LaVega-kluis. Het kaartenlijstje is met de hand.
- Het paneel verschijnt op elke aangevinkte productpagina en wordt per pagina
  weggeklikt; er is geen "niet meer tonen op deze winkel" die iets onthoudt,
  omdat daarvoor bijgehouden zou moeten worden waar je bent geweest.
- Geen netto-antwoord. Zie de meting in de eerste sectie: geen enkele kaart in
  de bundel heeft zowel een cashbackcijfer als een prijs, dus de netto-tak van
  de code draait vandaag niet.
- De CSP laat nog `'unsafe-inline'` toe voor stijl. Dat is voor één ding: het
  attribuut `style="margin-top: 16px"` in `public/popup.html`. Verhuist die
  regel naar `stijl.css`, dan kan `style-src` terug naar `'self'`. Het is geen
  gat naar buiten — elke richting die iets kan ophalen (`img-src`, `font-src`,
  `media-src`, `connect-src`) staat op `'none'`.
- Het toestemmingsdialoog van Chrome is nog nooit in het echt gedraaid. Chrome
  151 weigert `--load-extension` zodra de sessie geautomatiseerd is, dus de
  extensie is hier niet in een echte Chrome geladen. Wat wél is gemeten: de CSP
  uit dit manifest, met deze `popup.html`, `options.html` en `stijl.css`, in een
  echte Chromium — de pagina's werken zonder één CSP-weigering, en een
  trackingpixel, een remote font, een vreemde stylesheet en een vreemd script
  worden alle vier geweigerd.
