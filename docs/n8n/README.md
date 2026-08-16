# n8n — kaartvoorwaarden voor LaVega

`lavega-card-terms.json` haalt per betaalproduct de **eigen tarievenpagina** op,
laat Claude daar de cijfers uit lezen, en stuurt die naar LaVega.

## Wie doet wat: fetch én agent, niet fetch óf agent

De eerste opzet ging uit van "vinden is de zwakke stap, lezen lukt altijd".
Gemeten op 2026-08-16 klopt dat niet. Van de acht tariefpagina's laten er maar
**drie** een gewone HTTP-fetch toe:

| Bron | Kale fetch | Met browser-User-Agent |
|---|---|---|
| ABN AMRO betaalpas | time-out | **200** |
| ABN AMRO creditcard | time-out | **200** |
| bunq | **200** | **200** |
| Wise | **200** | **200** |
| Knab | **200** | **200** |
| American Express Gold | — | **200** (de oude URL gaf 404: verhuisd) |
| Revolut | 403 | 403 — "Just a quick security check" (Cloudflare) |
| Trading 212 | 403 | 403 — Cloudflare |
| ING (beide) | verbinding verbroken | idem, ook via HTTP/1.1 (Akamai) |
| Rabobank | 403 | 403 |
| N26, Trade Republic | 404 | 404 — die URL's bestaan niet |

Twee conclusies:

1. **De User-Agent beslist over toegang.** ABN AMRO werkt alleen mét de header.
   Die staat nu vast op de node *Haal tariefpagina op*. Dit is dezelfde uitkomst
   als bij de crawl4ai-test van augustus: niet de browser maakt het verschil,
   de UA-string wel. Een echte headless browser is hier dus geen oplossing.
2. **De rest is een bot-check, geen opmaakprobleem.** Een reader-proxy
   (`r.jina.ai`) werd zelf ook met 403 geweigerd. Meer scraping-techniek helpt
   niet tegen een partij die je bewust buiten houdt.

Daarom haalt deze workflow alleen de drie bronnen op die het echt toelaten. De
**reis-agent** in LaVega doet de andere vijf met web search, en die kán het:
gemeten leverde hij Revolut 0%, ING betaalpas 1,4%, ING creditcard 2%, ABN AMRO
creditcard 2% en Trading 212 0%.

Zet een aanbieder er pas bij als een kale fetch zijn pagina teruggeeft.

## Beter op termijn: één vergelijkingsbron in plaats van dertig bankpagina's

Dertig losse tariefpagina's onderhouden is geen plan: de vier belangrijkste
(ING, Rabobank, Revolut, Trading 212) blijven toch geblokkeerd, elke URL
veroudert, en een verouderde URL mislukt stil als een 0.

**Gemeten alternatief, 2026-08-16:**
`https://www.bank.nl/kennisbank/betalen-in-buitenland/` — 200, 96 kB, en de
koersopslagen staan gewoon in de ruwe HTML (0,5% / 1,0% / 1,2% / 1,4% / 1,5% /
2,0%), voor ING, ABN AMRO, Rabobank, American Express, bunq, ICS, Knab, SNS, ASN
en Triodos. De pagina zet er zelf "laatst gecontroleerd op" bij. Eén fetch,
tien aanbieders, inclusief de twee die ons rechtstreeks buitenhouden.

Dat is precies het patroon dat voor spaarrentes al werkt met geld.nl.

Nog niet gebouwd. Wat het nodig heeft:
- een parser per rij (bank → koersopslag), net als `rates.ts` voor geld.nl;
- een naamafbeelding van "ING" op `productOf()`-namen ("ING betaalpas" /
  "ING creditcard"), want de tabel noemt de bank en niet het product;
- een besluit over voorrang: een eigen tariefpagina is preciezer dan een
  vergelijkingstabel, dus de bron per aanbieder moet blijven winnen.

Revolut, Wise en N26 staan er níet in. Consumentenbond noemt die wel, maar zijn
pagina is 1 MB en de percentages in de HTML zijn CSS-breedtes, geen tarieven.
Die drie blijven dus bij de agent.

**American Express staat er weer bij, met een andere URL.** De oude gaf 404,
omdat die pagina verhuisd was. Belangrijker was iets anders: "American Express
creditcard" is geen product. Green, Gold en Platinum hebben verschillende
voorwaarden, dus er viel niets te vinden — de agent kwam daarom keer op keer
leeg terug, en dat lag niet aan het zoeken. De eigenaar heeft de **Gold Card**,
dus dat is de pagina die er nu staat.

Let op de naam in die regel. LaVega vraagt vandaag om `American Express
creditcard`, omdat `productOf()` geen kaartvariant kent. De cijfers van de Gold
Card worden dus onder die algemene naam bewaard. Dat klopt zolang er één Amex
is. Komt er een tweede bij, dan moet LaVega eerst variantnamen leren, anders
overschrijft de ene kaart stil de cijfers van de andere.

Dit is de regel, niet de uitzondering: een vaste URL is alleen beter dan zoeken
zolang die URL blijft staan, de fetch wordt toegelaten, én de productnaam
precies één product aanwijst.

## Eenmalig instellen

1. **Token maken** (32 tekens is prima):
   ```bash
   openssl rand -hex 24
   ```
2. **In Railway** bij service `@lavega/web` een variabele zetten:
   `CARD_TERMS_INGEST_TOKEN` = dat token. Zonder deze variabele geeft de
   endpoint `503` en accepteert hij niets — er kan dus niemand ongevraagd in de
   cache schrijven.
3. **In n8n** twee omgevingsvariabelen zetten:
   - `LAVEGA_INGEST_TOKEN` — hetzelfde token
   - `FT_ANTHROPIC_KEY` — je eigen sleutel. De node accepteert ook
     `ANTHROPIC_API_KEY`; hij pakt `FT_ANTHROPIC_KEY` als die er staat.

   n8n leest omgevingsvariabelen alleen bij het opstarten. Zet je er een bij op
   Railway, **herstart dan de n8n-service** — anders blijft `$env` leeg en geeft
   de laatste node `401 Ongeldige token`.

   Werkt `$env` in jouw n8n niet (sommige installaties blokkeren dat), maak dan
   in plaats daarvan twee **Header Auth**-credentials aan en koppel die aan de
   twee HTTP Request-nodes.
4. **Importeren:** n8n → *Workflows* → *Import from File* → dit JSON-bestand.
5. Klik **Handmatig starten** om te testen. Daarna loopt hij **elke ochtend
   06:00**. Dagelijks en niet wekelijks, omdat de cache in het geheugen van de
   server zit: na een deploy is hij leeg, en met een weekschema zou hij dan tot
   de volgende maandag leeg blijven.

## Wat je moet controleren

- **De URL's verouderen.** Blijft een product leeg, kijk dan eerst of zijn
  tarievenpagina verhuisd is. Ze staan bij elkaar in de eerste Code-node.
- **`provider` moet exact matchen** met wat LaVega toont: bank + `betaalpas` of
  `creditcard` (zie `productOf()` in `packages/core/src/travel.ts`). Staat er
  `ING` in plaats van `ING betaalpas`, dan komt het niet aan.
- **`currency`** in de node *Naar LaVega-vorm* is de valuta van je bestemming
  (`USD` voor de VS). Voorwaarden verschillen per markt, dus ze worden per
  valuta bewaard.

## Grenzen

- Een rij zonder bruikbaar getal wordt geweigerd, net als bij de agent. Beter
  "onbekend" in beeld dan een verzonnen tarief — je kunt hem dan zelf invullen,
  en jouw waarde wordt daarna nooit overschreven.
- De cache zit in het geheugen van de server: **na een deploy is hij leeg** tot
  de volgende run. Draai de workflow handmatig na een deploy, of laat hem
  dagelijks lopen.
- Er gaat geen enkel gegeven over jouw rekeningen doorheen. Deze workflow kent
  alleen productnamen en publieke tariefpagina's.
