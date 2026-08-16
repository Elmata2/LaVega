# n8n — facturen uit Gmail en Outlook

`lavega-invoices.json` leest je mailbox, laat Claude bepalen of er een factuur in
zit, haalt de bedragen eruit en zet ze in een **wachtrij** in LaVega. Er wordt
niets automatisch geboekt: jij bevestigt elke regel.

Backlog-item 3. De lang uitgestelde "Phase 2b e-mailconnectors" wordt hiermee
overgeslagen: de OAuth-koppeling zit in **n8n**, niet in LaVega. Jij verbindt
Gmail en Outlook één keer in n8n, en LaVega hoeft nooit een Google- of
Microsoft-token te bezitten.

## Lees dit eerst: dit verandert de privacygrens

Tot nu toe gold: bankgegevens blijven op de machine, de server ziet ze nooit
(`docs/CONTEXT.md`, harde eis 2). Kaarttarieven mochten wel op de server staan,
omdat die publiek zijn en voor iedereen gelijk.

**Een factuur is dat niet.** Bedragen, tegenpartijen en factuurnummers zijn van
jou. Deze workflow stuurt ze naar de LaVega-server, en dat is een bewuste
afwijking van die eis. Wat dat zo klein mogelijk houdt:

- **Alleen in het geheugen.** De wachtrij staat in RAM, wordt nooit naar schijf
  geschreven en is na een deploy leeg.
- **Weg na ophalen.** De browser haalt de rij op en de server gooit hem meteen
  weg. Eén lezer, één keer.
- **Eigen token.** `INVOICE_INGEST_TOKEN` staat los van
  `CARD_TERMS_INGEST_TOKEN`. Kaarttarieven zijn publiek, facturen niet; één
  token voor beide zou dat verschil wegpoetsen.
- **Uit tenzij aangezet.** Zonder die variabele geeft het endpoint 503 en
  accepteert het niets.
- **Jouw eigen infrastructuur.** n8n draait op jouw Railway, de LaVega-server
  ook. Er komt geen derde partij bij, behalve Anthropic voor het lezen zelf —
  net als bij de andere agents.

Wil je die afwijking niet, dan is er een variant zonder server: laat de laatste
node een bestand schrijven in plaats van posten, en importeer dat in LaVega.
Minder comfortabel, nul blootstelling.

## Eenmalig instellen

1. **Koppelingen in n8n.** *Credentials → New*:
   - **Gmail OAuth2** — in Google Cloud een OAuth-client maken, scope
     `gmail.readonly`. Alleen lezen.
   - **Microsoft Outlook OAuth2** — in Entra ID een app-registratie, scope
     `Mail.Read`. Alleen lezen.

   Gebruik je er maar één? Verwijder dan de andere bronnode én zijn verbinding
   naar *Samenvoegen*. Een node zonder credential laat de hele run vallen.

2. **Token maken en op twee plekken zetten:**
   ```bash
   openssl rand -hex 24
   ```
   - Railway, service `@lavega/web`: `INVOICE_INGEST_TOKEN`
   - n8n: `LAVEGA_INVOICE_TOKEN` (dezelfde waarde)

   n8n leest omgevingsvariabelen alleen bij het opstarten: **herstart de
   n8n-service** na het toevoegen.

3. **Importeren:** n8n → *Workflows* → *Import from File*.

4. Klik **Handmatig starten**. De schedule staat daarna op elk uur.

## Wat je moet controleren bij de eerste run

- **De twee bronnodes.** Gmail en Outlook veranderen hun parameters per
  node-versie. Open *Gmail: recente mail* en *Outlook: recente mail* en
  controleer dat "Download Attachments" aan staat en dat het zoekfilter
  overeenkomt met wat jouw versie aanbiedt. Dit is het meest waarschijnlijke
  punt waar de eerste run struikelt.
- **PDF-ondersteuning.** De bijlage gaat als `document`-blok naar Claude. Geeft
  *Lees de factuur* een 400 over het documenttype, voeg dan de header
  `anthropic-beta: pdfs-2024-09-25` toe aan die node.
- **Het zoekfilter.** Gmail staat op `newer_than:7d` en op de woorden factuur /
  invoice / rekening / receipt. Te breed kost tokens, te smal mist facturen.
  Begin liever te smal.

## Grenzen

- Maximaal 25 berichten per bron per run, maximaal 3 PDF's per bericht, elk
  maximaal 4 MB. Een mail zonder PDF én zonder bruikbare tekst wordt overgeslagen.
- Een regel zonder bedrag wordt geweigerd, net als bij de kaarttarieven. Een
  verzonnen factuur in een boekhouding is erger dan een gemiste factuur.
- Aanmaningen, betaalherinneringen en orderbevestigingen zonder bedrag gelden
  niet als factuur.
- Dubbele berichten worden hier niet ontdubbeld. Dat hoort in LaVega, op
  `messageId`, want alleen LaVega weet wat je al bevestigd hebt.
