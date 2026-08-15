# n8n — kaartvoorwaarden voor LaVega

`lavega-card-terms.json` haalt per betaalproduct de **eigen tarievenpagina** op,
laat Claude daar de cijfers uit lezen, en stuurt die naar LaVega.

## Waarom niet gewoon de agent

De reis-agent in LaVega zoekt zelf op internet. Dat werkte voor ING, ABN AMRO en
American Express, maar Revolut kwam keer op keer leeg terug — en die pagina
bestaat gewoon. De zwakke stap is niet het *lezen* van een tarief, het is het
*vinden* ervan. Deze workflow slaat dat over: één vaste URL per product.

Dat is precies waarom de geld.nl-scraper voor spaarrentes betrouwbaarder is dan
een model laten zoeken. De agent blijft bestaan als terugval voor aanbieders
waarvoor hier geen bron staat.

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
   - `ANTHROPIC_API_KEY` — je eigen sleutel

   Werkt `$env` in jouw n8n niet (sommige installaties blokkeren dat), maak dan
   in plaats daarvan twee **Header Auth**-credentials aan en koppel die aan de
   twee HTTP Request-nodes.
4. **Importeren:** n8n → *Workflows* → *Import from File* → dit JSON-bestand.
5. Klik **Handmatig starten** om te testen. De schedule staat op maandagochtend
   06:00.

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
