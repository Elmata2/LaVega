# n8n-workflows voor LaVega

| Bestand | Waarover |
|---|---|
| `FACTUREN.md` | facturen uit Gmail → Claude → wachtrij (`lavega-invoices.json`) |
| `DOORSTUURADRES.md` | facturen doorsturen naar een eigen adres, via een Cloudflare Email Worker — dezelfde workflow, tweede ingang |
| deze pagina | kaartvoorwaarden (`lavega-card-terms.json`) |

---

## Kaartvoorwaarden

`lavega-card-terms.json` doet nog één ding: hij **tikt elke ochtend
`/api/agent/travel-facts` aan**, zodat de voorwaarden al klaarstaan wanneer
iemand het reisblok opent. Vier nodes, geen URL's, geen modelaanroep.

### Waarom het zo klein is geworden

De vorige versie haalde per product een vaste tarievenpagina op en liet Claude
die lezen. Gemeten op 16 en 17 augustus 2026 werkte dat niet:

| Bron | Wat er gebeurde |
|---|---|
| American Express | 404 — de pagina was verhuisd |
| ABN AMRO betaalpas | 200, maar het is marketingtekst zonder tarieven |
| ABN AMRO creditcard | 200, maar een lege JS-schil zonder inhoud |
| Revolut, Trading 212 | 403 achter Cloudflare |
| ING, Rabobank | verbinding verbroken / 403 |
| **Knab** | leverde de **creditcard** (2%) terwijl om de **betaalpas** was gevraagd — die kost 1,4% |

Van zes bronnen leverden er twee een getal, en één daarvan was verkeerd. Eén
verkeerd getal is erger dan geen getal, want een verkeerd getal wordt gebruikt.

Wat wél werkt is de agent zelf: Claude met web search doet precies wat jij doet
als je het handmatig opzoekt. Gemeten leverde hij Revolut 0%, ING betaalpas
1,4%, ING creditcard 2%, ABN AMRO 1,2% en 2%, Trading 212 0%. Zijn zwakte was
nooit de juistheid — het was de wachttijd van 40 seconden tot vijf minuten.

Dat is precies wat een schedule oplost. Vandaar: n8n plant, LaVega zoekt op.

### Waarom de zoekopdracht niet in n8n staat

`apps/server/src/agent/travel.ts` draagt twee dingen die tijd hebben gekost:

- `tool_choice` moet **auto** zijn, niet geforceerd. Geforceerd antwoordt het
  model in zijn eerste beurt, dus vóórdat het één keer heeft kunnen zoeken —
  gemeten: nul zoekopdrachten en lege velden.
- Het antwoord wordt vastgepind op het product waar naar gevraagd is, zodat een
  model geen product kan toevoegen dat de eigenaar niet heeft.

Dat namaken in een Code-node betekent die twee lessen kopiëren en ze daarna uit
elkaar laten groeien. Eén implementatie, op één plek.

### Waar de cijfers vandaan komen

| Bron | Dekt | Versheid | Rol |
|---|---|---|---|
| Jouw eigen correctie | wat jij verbetert | permanent | wint altijd |
| Agent + web search | alles, ook wat ons buitensluit | vandaag | **primair** |
| bank.nl-vergelijking | 7 Nederlandse banken, pas en creditcard apart | eigen datum, maanden oud | **vloer**, zodat het blok nooit leeg is |

De voorrangsladder weegt sinds `79ab906` ook **leeftijd**: een cijfer dat veel
ouder is dan wat er al staat wordt geweigerd, hoe nette bron het ook heeft. Een
koersopslag van januari is in augustus geen antwoord meer.

Live gecontroleerd op 17 augustus 2026: Rabobank betaalpas 1,4% en creditcard 2%,
Triodos 1,0%, ASN 1,4% — allemaal uit bank.nl, inclusief Rabobank, dat onze
directe fetch met een 403 weigert.

### Instellen

1. Importeer het JSON-bestand in n8n.
2. Klik **Handmatig starten** om te testen. Daarna loopt hij elke ochtend 06:00.

Meer is het niet: geen tokens, geen sleutels, geen credentials. Het endpoint is
publiek en accepteert alleen landcodes, een valuta en productnamen — nooit iets
over je rekeningen.

`CARD_TERMS_INGEST_TOKEN` en `POST /api/card-terms/ingest` blijven bestaan als de
manier om van buitenaf een gecorrigeerd tarief binnen te duwen. Zonder die
variabele is dat endpoint dicht.
