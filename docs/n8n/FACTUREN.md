# n8n — facturen uit Gmail

`lavega-invoices.json` leest je Gmail, laat Claude bepalen of er een factuur in
zit, haalt de bedragen eruit, en houdt ze vast **in n8n** tot LaVega ze ophaalt.
Er wordt niets automatisch geboekt: jij bevestigt elke regel.

Backlog-item 3. De lang uitgestelde "Phase 2b e-mailconnectors" wordt hiermee
overgeslagen: de OAuth-koppeling zit in **n8n**, niet in LaVega. LaVega bezit
dus nooit een Google-token.

Outlook zit er bewust niet in. De stappen staan onderaan, voor later.

## Het pad van de gegevens: jouw mailbox → jouw n8n → jouw browser

```
Gmail  ──►  n8n (jouw Railway)  ──►  browser (kluis, versleuteld)
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

## Stap 1 — Gmail koppelen (Google Cloud)

Je hebt de **callback-URL van n8n** nodig. Die staat in n8n zelf: *Credentials →
New → Gmail OAuth2 API*, bovenaan. Hij ziet eruit als
`https://<jouw-n8n>/rest/oauth2-credential/callback`. Kopieer hem eerst.

1. **console.cloud.google.com** → nieuw project, bijvoorbeeld `lavega-n8n`.
2. *APIs & Services* → *Library* → zoek **Gmail API** → **Enable**.
3. *OAuth consent screen* → **External** → vul naam en e-mailadres in.
4. *Scopes* → **Add or remove scopes** → voeg toe:
   `https://www.googleapis.com/auth/gmail.readonly`. Meer niet. Alleen lezen.
5. *Test users* → voeg je eigen adres toe.
6. *Credentials* → **Create credentials** → *OAuth client ID* → **Web
   application** → bij *Authorized redirect URIs* de n8n-callback-URL plakken.
7. Client ID en Client Secret in n8n bij *Gmail OAuth2 API*, dan **Connect my
   account**.

> **Val hier niet in.** Blijft de consent screen op **Testing** staan, dan laat
> Google je refresh-token na **7 dagen** verlopen en stopt de workflow er
> wekelijks mee. Zet hem op **In production** (*Publish app*). Voor alleen je
> eigen account is verificatie niet nodig; je klikt één keer langs een
> "unverified app"-scherm.

## Stap 2 — De sleutel voor het lezen

`FT_ANTHROPIC_KEY` in n8n (dezelfde die de kaarttarieven gebruikt). n8n leest
omgevingsvariabelen alleen bij het opstarten: **herstart de n8n-service** na het
toevoegen.

## Stap 3 — De webhook waarmee LaVega ophaalt

1. Open de node **LaVega vraagt de rij op**. Zet *Authentication* op **Header
   Auth** en maak daar een credential voor:
   - Header Name: `x-lavega-token`
   - Value: `openssl rand -hex 24`
2. **Activeer de workflow** (schakelaar rechtsboven). Een webhook werkt alleen
   in een actieve workflow — in de test-modus luistert hij maar één keer.
3. Kopieer de **Production URL** van de webhook.
4. Zet die URL en dat token in LaVega onder *Koppelingen* — dat scherm bestaat
   nu. LaVega bewaart beide lokaal, net als je andere instellingen. Daarna haal
   je de rij op met **Ophalen uit n8n** in *Facturen*, en bevestig je hem regel
   voor regel.

De node staat ingesteld op `allowedOrigins: https://lavega.dev,
http://localhost:5173`. Draai je LaVega op een andere poort, pas dat dan aan,
anders blokkeert de browser het antwoord.

## Wat er in de Gmail-node is gezet, en waarom

Twee instellingen waar dit zonder mankeren op stukloopt:

| Instelling | Waarde | Waarom |
|---|---|---|
| **Read Status** | `both` | n8n staat standaard op **alleen ongelezen**. Een factuur die je al gelezen had zou dan nooit meekomen, en de workflow zou "werken" en stil niets opleveren. |
| **Download Attachments** | aan, náást *Simplify* | Dit veld hoort bij Simplify, niet bij *Options*. Staat het in Options, dan negeert n8n het en komt er nooit een PDF mee. |
| **Simplify** | uit | Aan levert alleen headers, dus geen bijlagen en geen tekst. |
| **Search** | `newer_than:7d (factuur OR invoice OR rekening OR receipt)` | Te breed kost tokens, te smal mist facturen. Begin liever te smal. |

## Wat je moet controleren bij de eerste run

- Draai *Handmatig starten* en kijk of *Normaliseer bericht* berichten met
  `pdfs` erin oplevert. Zijn de PDF's leeg, dan staat Download Attachments niet
  goed.
- Kijk wat *Zet in de wachtrij* teruggeeft: `{added, inQueue}`.
- Roep daarna de webhook-URL aan. Je hoort dezelfde facturen terug te krijgen,
  en een **tweede** aanroep hoort leeg te zijn — dat is de rij die zichzelf
  opruimt.
- **PDF-ondersteuning.** De bijlage gaat als `document`-blok naar Claude. Geeft
  *Lees de factuur* een 400 over het documenttype, voeg dan de header
  `anthropic-beta: pdfs-2024-09-25` toe aan die node.

## Grenzen

- Maximaal 25 berichten per run, maximaal 3 PDF's per bericht, elk maximaal
  4 MB. Een mail zonder PDF én zonder bruikbare tekst wordt overgeslagen.
- Maximaal 200 facturen in de rij; daarboven vallen de oudste eruit. Een rij die
  niemand ophaalt is een lek, geen archief.
- Ontdubbeld op `messageId`, want de schedule loopt elk uur over dezelfde zeven
  dagen mail.
- Een regel zonder bedrag wordt geweigerd. Een verzonnen factuur in een
  boekhouding is erger dan een gemiste factuur.
- Aanmaningen en orderbevestigingen zonder bedrag gelden niet als factuur.
- De rij die je nog niet hebt afgehandeld staat alleen in het geheugen van de
  pagina. De webhook leegt zichzelf bij het ophalen, dus **na een herlaadbeurt of
  Vergrendel is hij weg** en komt hij niet terug. Handel hem af in één zitting.
- Leest het model geen valuta van de factuur, dan blijft die leeg en kun je de
  regel pas bevestigen als je hem invult. Er wordt niet stilzwijgend EUR van
  gemaakt: een dollarfactuur die als euro geboekt wordt is een verkeerd bedrag in
  je boekhouding, en niets zou je daarvoor waarschuwen.

---

## Outlook later toevoegen

Niet nodig nu. Als het zover is:

1. In n8n een **Microsoft Outlook OAuth2 API**-credential maken en de
   callback-URL kopiëren.
2. **entra.microsoft.com** → *App registrations* → **New registration**:
   - *Supported account types*: werkaccount → **Single tenant**; een gewoon
     outlook.com-adres → **any organizational directory + personal accounts**.
   - *Redirect URI*: type **Web**, de n8n-callback-URL.
   - *Certificates & secrets* → **New client secret** → kopieer de **Value**,
     niet de Secret ID. Die is daarna niet meer te zien.
   - *API permissions* → Graph → **Delegated** → `Mail.Read`, `offline_access`,
     `User.Read`. In een bedrijfstenant: **Grant admin consent**.
   - Bij **Single tenant** moet de tenant-ID in de auth-URL's in plaats van
     `common`.
3. In de workflow: een node `Outlook: recente mail` erbij, een **Merge** ertussen
   (Gmail op input 1, Outlook op input 2), en `Normaliseer bericht` moet dan ook
   de Outlook-vorm aankunnen: `receivedDateTime`, `bodyPreview`, en
   `from.emailAddress.address`.
