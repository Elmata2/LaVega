# n8n — facturen uit Gmail en Outlook

`lavega-invoices.json` leest je mailbox, laat Claude bepalen of er een factuur in
zit, haalt de bedragen eruit, en houdt ze vast **in n8n** tot LaVega ze ophaalt.
Er wordt niets automatisch geboekt: jij bevestigt elke regel.

Backlog-item 3. De lang uitgestelde "Phase 2b e-mailconnectors" wordt hiermee
overgeslagen: de OAuth-koppeling zit in **n8n**, niet in LaVega. LaVega bezit
dus nooit een Google- of Microsoft-token.

## Het pad van de gegevens: jouw mailbox → jouw n8n → jouw browser

De eerste opzet stuurde de facturen naar de LaVega-server. Dat is bewust
teruggedraaid, omdat je zo lang mogelijk lokaal wilt blijven — en het kan ook
lokaal:

```
Gmail / Outlook  ──►  n8n (jouw Railway)  ──►  browser (kluis, versleuteld)
                          │
                          └─ de LaVega-server komt hier niet in voor
```

De rij staat in `getWorkflowStaticData`, dus in de database van je eigen n8n.
LaVega haalt hem op via een webhook op diezelfde n8n, en de rij wordt **bij het
ophalen geleegd**: één lezer, één keer. Wat de browser heeft, staat versleuteld
in de kluis; wat in n8n blijft staan, staat er onversleuteld. Hoe korter dat
duurt, hoe beter.

Harde eis 2 uit `docs/CONTEXT.md` blijft hiermee overeind: de LaVega-server ziet
geen persoonlijke bedragen. Alleen Anthropic ziet de factuur zelf, want die moet
hem lezen — net als bij de andere agents, en met dezelfde afweging.

## Stap 1 — Outlook koppelen (Microsoft Entra ID)

Je hebt de **callback-URL van n8n** nodig. Die staat in n8n zelf: *Credentials →
New → Microsoft Outlook OAuth2 API*, bovenaan. Hij ziet eruit als
`https://<jouw-n8n>/rest/oauth2-credential/callback`. Kopieer hem eerst.

1. Ga naar **entra.microsoft.com** → *Applications* → *App registrations* →
   **New registration**.
2. Naam: `LaVega n8n`. Bij *Supported account types*:
   - werk- of schoolaccount → **Single tenant**;
   - een gewoon outlook.com-adres → **Accounts in any organizational directory
     and personal Microsoft accounts**.
3. *Redirect URI*: kies **Web** en plak de callback-URL van n8n. Registreren.
4. **Overview**: noteer *Application (client) ID* en *Directory (tenant) ID*.
5. *Certificates & secrets* → **New client secret** → kopieer de **Value**,
   niet de Secret ID. Die waarde is daarna niet meer te zien.
6. *API permissions* → **Add a permission** → *Microsoft Graph* → **Delegated
   permissions** → zet aan: `Mail.Read`, `offline_access`, `User.Read`.
   Alleen lezen; er staat geen enkele schrijfrechten bij.
   Werk je in een bedrijfstenant, klik dan **Grant admin consent**.
7. In n8n: *Credentials → Microsoft Outlook OAuth2 API* → plak Client ID en
   Client Secret. Bij **Single tenant** moet je de tenant-ID in de auth-URL's
   zetten in plaats van `common`. Klik **Connect my account** en log in.

## Stap 2 — Gmail koppelen (Google Cloud)

1. **console.cloud.google.com** → nieuw project, bijvoorbeeld `lavega-n8n`.
2. *APIs & Services* → *Library* → zoek **Gmail API** → **Enable**.
3. *OAuth consent screen* → **External** → vul naam en e-mail in.
4. *Scopes* → **Add or remove scopes** → voeg toe:
   `https://www.googleapis.com/auth/gmail.readonly`. Meer niet.
5. *Test users* → voeg je eigen adres toe.
6. *Credentials* → **Create credentials** → *OAuth client ID* → **Web
   application** → bij *Authorized redirect URIs* dezelfde n8n-callback-URL.
7. Client ID en Client Secret in n8n bij *Gmail OAuth2 API*, dan **Connect my
   account**.

> **Val hier niet in.** Blijft de consent screen op **Testing** staan, dan laat
> Google je refresh-token na **7 dagen** verlopen en stopt de workflow er
> wekelijks mee. Zet hem op **In production** (*Publish app*). Voor alleen je
> eigen account is verificatie niet nodig; je krijgt één keer een
> "unverified app"-scherm dat je kunt doorklikken.

Gebruik je maar één van de twee? Verwijder dan de andere bronnode én zijn
verbinding naar *Samenvoegen*. Een node zonder credential laat de hele run
vallen.

## Stap 3 — De webhook waarmee LaVega ophaalt

1. Open de node **LaVega vraagt de rij op**. Zet *Authentication* op **Header
   Auth** en maak daar een credential voor:
   - Header Name: `x-lavega-token`
   - Value: `openssl rand -hex 24`
2. Activeer de workflow (schakelaar rechtsboven). Een webhook werkt alleen in
   een actieve workflow — in de test-modus luistert hij maar één keer.
3. Kopieer de **Production URL** van de webhook.
4. Zet die URL en dat token straks in LaVega onder *Koppelingen*. LaVega bewaart
   beide lokaal, net als je andere instellingen.

De node staat al ingesteld op `allowedOrigins: https://lavega.dev,
http://localhost:5173`. Draai je LaVega op een andere poort, pas dat dan aan,
anders blokkeert de browser het antwoord.

## Stap 4 — De sleutel voor het lezen

`FT_ANTHROPIC_KEY` in n8n (dezelfde die de kaarttarieven gebruikt). n8n leest
omgevingsvariabelen alleen bij het opstarten: **herstart de n8n-service** na het
toevoegen.

## Wat je moet controleren bij de eerste run

- **De twee bronnodes.** Gmail en Outlook veranderen hun parameters per
  node-versie. Open ze en controleer dat "Download Attachments" aan staat en dat
  het zoekfilter bestaat in jouw versie. Dit is het meest waarschijnlijke punt
  waar de eerste run struikelt.
- **PDF-ondersteuning.** De bijlage gaat als `document`-blok naar Claude. Geeft
  *Lees de factuur* een 400 over het documenttype, voeg dan de header
  `anthropic-beta: pdfs-2024-09-25` toe aan die node.
- **Het zoekfilter.** Gmail staat op `newer_than:7d` en op factuur / invoice /
  rekening / receipt. Te breed kost tokens, te smal mist facturen. Begin liever
  te smal.
- **De wachtrij.** Draai *Handmatig starten* en kijk wat *Zet in de wachtrij*
  teruggeeft: `{added, inQueue}`. Roep daarna de webhook-URL aan; je hoort
  dezelfde facturen terug te krijgen, en een tweede aanroep hoort leeg te zijn.

## Grenzen

- Maximaal 25 berichten per bron per run, maximaal 3 PDF's per bericht, elk
  maximaal 4 MB. Een mail zonder PDF én zonder bruikbare tekst wordt overgeslagen.
- Maximaal 200 facturen in de rij; daarboven vallen de oudste eruit. Een rij die
  niemand ophaalt is een lek, geen archief.
- Ontdubbeld op `messageId`, want de schedule loopt elk uur over dezelfde zeven
  dagen mail.
- Een regel zonder bedrag wordt geweigerd. Een verzonnen factuur in een
  boekhouding is erger dan een gemiste factuur.
- Aanmaningen en orderbevestigingen zonder bedrag gelden niet als factuur.
- Nog te bouwen in LaVega: het scherm *Koppelingen* voor URL en token, en de
  bevestigingsrij in *Facturen*. Tot dan levert de webhook wel, maar heeft
  LaVega nog geen knop om hem op te halen.
