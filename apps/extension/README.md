# LaVega — aan de kassa

Een browserextensie voor Chrome en Edge (Manifest V3) die bij het afrekenen laat
zien met welke van jouw kaarten je het meeste overhoudt — met de kaartkosten
erin verrekend, en met de onbekende cijfers erbij in plaats van op nul gezet.

Alles gebeurt in je eigen browser. Er gaat geen enkel verzoek naar buiten, ook
niet naar lavega.dev.

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
onder **Fouten**. De build controleert van tevoren op de vier oorzaken die dat
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
er netto gerekend. Het waarom staat uitgeschreven in `src/rank.ts`.

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

## Op welke sites hij werkt, en waarom het er maar één is

| Winkel | Patroon | Status |
| --- | --- | --- |
| IKEA Nederland | `https://www.ikea.com/nl/nl/p/*` | werkt — productpagina's |

Dat is de hele lijst. De drempel is niet "de winkel is groot" maar: **kunnen we
aantonen dat het bedrag dat we lezen ook echt het bedrag op díé pagina is.**

Op 21 augustus 2026 zijn eenentwintig Nederlandse winkelpagina's opgehaald. Eén
gaf een machineleesbaar bedrag mét munt dat ook bij het juiste artikel hoorde.

De belangrijkste uitkomst is een winkel die er **niet** in staat. Coolblue geeft
keurige schema.org-opmaak met een prijs en een munt — maar de opmaak beschrijft
een ander artikel dan de pagina:

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

## Wat hij niet doet

- **Geen netwerkverkeer.** Geen fetch, geen analytics, geen telemetrie, ook niet
  naar lavega.dev. De kaartgegevens zitten in de bundel en worden niet
  bijgewerkt zonder een nieuwe versie van de extensie. Het manifest zet er
  `connect-src 'none'` overheen en de build weigert een bundel waarin `fetch(`,
  `XMLHttpRequest`, `WebSocket`, `sendBeacon` of `EventSource` voorkomt.
- **Geen `<all_urls>`.** `host_permissions` is leeg. Alle sites lopen via
  `optional_host_permissions`, zodat Chrome het per winkel aan jou vraagt en je
  het in `chrome://extensions` weer kunt intrekken. Trek je het in, dan gaat het
  vinkje in de opties vanzelf uit.
- **Geen bedragen of ordergegevens bewaren.** In de opslag staan twee lijstjes:
  welke kaarten je hebt en welke winkels aan staan. Niets dat aan een bezoek
  vastzit — geen bedragen, geen artikelen, geen hosts, geen tijdstippen.
- **Niets van de pagina behalve het bedrag.** Wat de extensie uit een pagina
  meeneemt is de host plus de bedragen die er machineleesbaar op staan. Geen
  titel, geen artikelnaam, geen omschrijving. Twee tests in `read.test.ts`
  bewaken die grens.
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

npx vitest run          # 89 tests
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
3. staat er iets in de bundel dat het netwerk op gaat?
4. loopt `optional_host_permissions` nog gelijk met `src/sites.ts`?

Alle vier zijn fouten die je anders pas ziet als de extensie al geïnstalleerd
is — of, bij de tweede, alleen in de console van de winkelpagina.

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
