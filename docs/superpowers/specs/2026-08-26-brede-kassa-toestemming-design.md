# Brede kassa-toestemming: van curatie per site naar één vinkje

26 augustus 2026. Vervolg op de V10-melding (`docs/BACKLOG.md`) — tijdens het
testen daarvan bleek dat de kassa-paneel-lezer alleen op IKEA-productpagina's
draait, omdat elke site in `sites.ts` handmatig gemeten en goedgekeurd moet
worden voor hij mee mag. Dit document beschrijft **deel A**: dat vinkje
vervangen door één brede toestemming. **Deel B** (een tekstheuristiek voor
sites zonder machineleesbare productgegevens) is expliciet latere,
losstaande scope — zie onderaan.

## Doel

Eén toestemmingsvinkje in het optiescherm dat, eenmaal aangezet, het
kassa-paneel op ELKE `https:`-pagina laat proberen te lezen — zonder dat er
per site een nieuwe meting, een nieuwe `SITES`-regel of een nieuwe
build nodig is.

## Wat ongemoeid blijft

- **De ING- en Amex-toestemmingen.** Dit gaat alleen over de kassa-lezer op
  publieke winkelpagina's, niet over het lezen van ingelogde
  account-pagina's. Die permissies (`BRONNEN` in `bronnen.ts`, de aparte
  vinkjes per bron) blijven exact zo nauw als nu — verbreden zou daar een
  heel ander soort risico zijn (een ingelogde, persoonlijke pagina i.p.v.
  een publieke productpagina) en staat niet ter discussie.
- **`read.ts` (`collectEvidence`/`readCheckout`).** Deze code is al volledig
  generiek — leest JSON-LD, `itemprop="price"`-microdata en Open Graph
  price-tags, ongeacht welke host erbij staat, met elf benoemde
  weigerredenen (rangeprijzen, valutategenspraak, meerdere prijzen, etc.).
  Er verandert hier geen regel code.
- **`content.ts`** (het paneel zelf) — geen imports, geen berekening, ontvangt
  afgemaakte zinnen. Ongewijzigd.

## Wat weg gaat

- `sites.ts`: het `Site`-type, de `SITES`-array (nu: alleen `ikea-nl`),
  `SITE_MATCHES`, `ontleedMatch`, `padIsSpecifiek`, `siteForUrl`. Deze hele
  laag bestond specifiek om per site te kunnen zeggen "deze wel, die niet, en
  hier is het bewijs" — met één brede toestemming is er geen "welke site" meer
  om over te beslissen.
- `options.ts`: de per-site rij-rendering (`tekenSites`, `zetSite`, de
  `sitesLijst`/`sitesMelding`-elementen en hun HTML in `options.html`).
- `manifest.json`: de IKEA-specifieke regel in `optional_host_permissions`
  (overbodig zodra `<all_urls>` erbij staat).

## Wat erbij komt

**1. Manifest.** `optional_host_permissions` krijgt `<all_urls>` naast de
bestaande ING/Amex-regels (die blijven staan, ongewijzigd).

**2. Opslag — één vlag, zelfde patroon als `getBronAan`/`setBronAan`
(`store.ts:248-254`).**
```ts
const KEY_KASSA_OVERAL = "lavega.kassa.overal";
export async function getKassaOveralAan(): Promise<boolean> { ... }
export async function setKassaOveralAan(aan: boolean): Promise<void> { ... }
```

**3. `background.ts`'s `syncRegistraties` (nu regels 98-154).** De
`SITES`-lus (103-106, 128-130) vervalt. Erbij: als `getKassaOveralAan()` waar
is EN `chrome.permissions.contains({ origins: ["<all_urls>"] })` waar is,
registreer `content.js` op `["<all_urls>"]` onder één vast id (bv.
`${REG_PREFIX}kassa-overal`); anders (één van de twee onwaar) hoort dat id in
`wegHalen` terecht te komen — dezelfde aan/uit-symmetrie die er al is voor
`bronnenAan`.

**4. `options.ts` — één vinkje i.p.v. de site-lijst.** Zelfde
gebruikersgebaar-eis als nu (`chrome.permissions.request` als allereerste,
niet-awaited regel in de handler — zie het bestaande commentaar op
`options.ts:5`). Bijschrift, met de Coolblue-les er expliciet in i.p.v.
verstopt:

> "LaVega leest de machineleesbare productgegevens die een winkel zelf op de
> pagina zet — dezelfde gegevens die zoekmachines gebruiken. LaVega vergelijkt
> dat niet met de rest van de pagina: een winkel die dat verkeerd zet (het is
> gemeten dat dit gebeurt), kan LaVega niet opvangen. Zwijgen bij twijfel blijft
> gelden; een geldig maar verkeerd bedrag is de uitzondering die dit vinkje
> accepteert."

## De Coolblue-vraag, en het besluit

`sites.ts` sloot coolblue.nl bewust uit: geldige, eenduidige JSON-LD, maar
voor een ander artikel dan de pagina toonde (AirPods-URL → Samsonite-koffer;
Sonos-URL → PlayStation 5). Met `<all_urls>` en zonder lijst is er niets meer
dat coolblue.nl (of een site die zich hetzelfde gedraagt) uitsluit.

**Besluit (26 augustus, expliciet gevraagd): geen denylist bij deze stap.**
Alles gaat mee; wat in de praktijk fout blijkt, wordt gaandeweg gesignaleerd
en dan gericht aangepakt — niet vooraf dichtgetimmerd. Dat is een bewuste
risico-acceptatie voor persoonlijk gebruik, niet een oversight.

**Wat dit concreet betekent voor `sites.test.ts`'s Coolblue-test:** die test
bewees "coolblue.nl blijft buiten `SITES`" — een garantie die na deze wijziging
niet meer bestaat, want er is geen lijst meer. De test wordt niet stilletjes
verwijderd maar OMGEZET: hij bewijst straks dat `readCheckout` op de
coolblue-fixture `{ ok: true }` teruggeeft met het bekend-verkeerde bedrag —
d.w.z. dat dit een gedocumenteerde, geaccepteerde beperking is en geen
onopgemerkt gat. De fixture blijft liggen; hij bewijst nu het omgekeerde van
waar hij voor gebouwd was.

## Testplan

- Nieuwe tests voor de brede registratie in `background.test.ts`: vlag aan
  zonder toestemming → niets geregistreerd; toestemming zonder vlag → niets;
  beide aan → `<all_urls>` geregistreerd; één van de twee uit → weer weg.
- `sites.test.ts`: de tests voor `ontleedMatch`/`padIsSpecifiek`/`siteForUrl`
  vervallen samen met de code die ze testen. De Coolblue-test verhuist zoals
  hierboven beschreven (waarschijnlijk naar `read.test.ts`, waar de fixture al
  gebruikt wordt).
- `read.test.ts`: ongewijzigd — geen nieuwe eisen aan de lezer zelf.
- Handmatige stap (niet automatiseerbaar): na implementatie het vinkje
  aanzetten en een echte productpagina bezoeken om te zien dat het paneel
  verschijnt zonder dat er een build/redeploy per site nodig was.

## Niet in scope (deel B, later, los te brainstormen)

Een tekstheuristiek die op zichtbare paginatekst naar een bedrag zoekt voor
sites zonder machineleesbare productgegevens (bv. wehkamp.nl, gemeten zonder
`priceCurrency`). Groter risico dan deel A: geen vast schema om op te
vergelijken, dus meer kans op een plausibel maar verkeerd getal. Wordt pas
opgepakt als de dekking van deel A in de praktijk te smal blijkt.
