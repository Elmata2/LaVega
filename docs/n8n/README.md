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
| Revolut | 403 | 403 — "Just a quick security check" (Cloudflare) |
| Trading 212 | 403 | 403 — Cloudflare |
| ING (beide) | verbinding verbroken | idem, ook via HTTP/1.1 (Akamai) |
| American Express | 404 | 404 — de URL bestaat niet meer |

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

**American Express staat er bewust niet meer bij.** Zijn URL gaf 404: de pagina
is verhuisd. Een URL die verhuist, verhuist nog een keer — en dan staat er weer
stil een 0 in de uitkomst. Amex hoort daarom permanent bij de agent, die zelf
zoekt en dus niet omvalt van een verhuizing. Dit is de regel, niet de
uitzondering: een vaste URL is alleen beter dan zoeken zolang die URL blijft
staan en de fetch wordt toegelaten.

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
