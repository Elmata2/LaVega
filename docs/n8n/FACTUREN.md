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
| **Download Attachments** | aan, **in Options** | Alleen daar leest n8n hem. In de broncode staat letterlijk `getNodeParameter('options.downloadAttachments', 0, false)`. Zet je hem ernaast, als buur van *Simplify*, dan bestaat de vlag niet en komt er nooit een PDF mee — zie het kopje hieronder. |
| **Simplify** | uit | Aan levert alleen headers, dus geen bijlagen en geen tekst. |
| **Search** | zie hieronder | Te breed kost tokens, te smal mist facturen. |

De zoekopdracht is nu:

```
(newer_than:7d has:attachment filename:pdf)
OR (newer_than:7d (factuur OR facturen OR invoice OR rechnung OR nota OR "uw rekening"
                   OR betalingsherinnering OR aanmaning))
OR (newer_than:30d label:lavega)
```

Drie dingen zijn veranderd. `receipt` is eruit: dat trok elke Apple-, Spotify-
en Amex-bevestiging binnen, en een betaalbewijs wordt toch nooit geboekt. Kale
`rekening` is vervangen door `"uw rekening"`, want in het Nederlands is een
rekening net zo vaak een bankrekening. En er is een net bijgekomen dat geen
woorden nodig heeft: `has:attachment filename:pdf` vangt ook de Duitse
*Rechnung* en de mail waarvan de hele inhoud `2026-08.pdf` heet.

> **Maak het label eerst aan.** `label:lavega` verwijst naar een Gmail-label dat
> je zelf onderhoudt: zie je een gemiste factuur, dan plak je dat label erop en
> pikt de volgende run hem op — zonder dat er JSON aangepast hoeft te worden. Op
> termijn is dat het net dat het werk doet; de woordenlijst is de startset.
> **Maak het label `lavega` in Gmail aan vóór je de workflow importeert.** Ik heb
> niet kunnen testen wat de Gmail-API doet met een label dat niet bestaat.

## Wat er mis was, en wat je na het opnieuw importeren moet controleren

Op 16 augustus 2026 antwoordde Claude netjes dat er "geen bijlage en geen bedrag"
in de mail zat. Dat klopte — voor wat hij gekregen had. Het hele verzoek was 768
invoer-tokens: geen PDF, en van sommige mails geen tekst. Drie fouten stapelden
op elkaar:

1. **Download Attachments stond op de verkeerde plek.** Hij stond náást
   *Simplify* in plaats van in *Options*. n8n leest alleen
   `options.downloadAttachments`, dus de vlag was dood en `item.binary` bleef
   leeg. Er is dus nooit één PDF meegegaan, bij geen enkele run. De regel in de
   tabel hierboven beweerde precies het omgekeerde; die is rechtgezet.
2. **De tekst werd op de verkeerde plek gezocht.** *Normaliseer bericht* las
   `text` en anders `snippet`. Maar onder *Simplify uit* bestaat `snippet`
   helemaal niet, en `text` blijft leeg zodra een mail alleen een HTML-deel
   heeft — de gewoonste vorm van een factuurmail. Zulke mails vielen stil weg
   vóór het model, en een gemiste factuur zag er dus uit als geen factuur.
   Er wordt nu ook naar `html` en `textAsHtml` gekeken, en van die drie wint de
   langste. Op de testmails: 0 tekens werd 532, en 133 tekens werd 526.
3. **Het verzoek beweerde iets dat wij niet wisten.** Er stond altijd een regel
   `Bijlagen: ` in het bericht, ook als er niets bij zat. Dat leest als "er zat
   niets bij", terwijl wij alleen weten dat n8n ons niets gaf. Het model
   herhaalde onze eigen bewering. Die regel staat er nu alleen nog als er ook
   echt een bijlage meegaat.

Wat je na *Import from File* moet nalopen:

- **Gmail-credential opnieuw koppelen.** Een geïmporteerde workflow heeft geen
  credential; kies je bestaande *Gmail OAuth2 API* opnieuw in de node.
- Open **Gmail: recente mail** → *Options* en controleer dat **Download
  Attachments** aan staat en **Simplify** uit.
- Draai *Handmatig starten* en kijk in **Normaliseer bericht**: elk bericht hoort
  nu `textSource` te tonen (`text`, `html` of `textAsHtml`), een `textChars` die
  niet 0 is, en bij een factuurmail een gevulde `pdfs`. Staat er iets in
  `skipped`, dan is er een bijlage bewust niet meegegaan, mét reden.
- Kijk in **Bouw Claude-verzoek** naar het veld `sent`: `documents` hoort 1 te
  zijn bij een mail met een PDF, en `textChars` een paar honderd. Blijft
  `documents` 0 terwijl er wél een PDF in de mail zit, dan staat Download
  Attachments alsnog verkeerd.
- Staat `N8N_DEFAULT_BINARY_DATA_MODE` op je Railway-instantie op iets anders dan
  `default` (dus `filesystem`, `s3` of `database`), dan zit de PDF niet in het
  item zelf. De node haalt hem in dat geval alsnog op met
  `helpers.getBinaryDataBuffer`. Lukt dat niet, dan zie je dat terug in
  `skipped` — niet als een stilzwijgend ontbrekende bijlage. **Ik heb dit niet
  op jouw instantie kunnen controleren.**
- Kijk wat *Zet in de wachtrij* teruggeeft: `{addedInvoices, addedNotices,
  inQueue, noticesInQueue, remembered}`.

## Meldingen: wat er wel binnenkwam maar geen factuur was

Een mail die zegt "uw factuur staat klaar, log in" is geen factuur. Hem stil als
"geen factuur" wegzetten is liegen door weglating: er wacht wel degelijk iets op
je. Zulke mail komt nu terug als **melding** in een tweede lijst, en LaVega toont
die onder *Facturen → Zelf ophalen*.

Vier soorten worden een melding:

| Soort | Wat het is |
|---|---|
| `notification` | de factuur staat bij de leverancier klaar; jij moet inloggen |
| `reminder` | herinnering of aanmaning voor een factuur die je al hoorde te hebben |
| `no-amount` | het model zag een factuur maar las er geen bedrag in |
| `unreadable` | er viel niets uit de mail te lezen, of het model gaf geen antwoord |

Een melding heeft **geen bedragveld** — niet leeg, niet nul: het veld bestaat
niet. Er is dus geen weg waarlangs een melding een boeking wordt, en daar is geen
extra controle voor nodig. De knop is *Gedaan*, niet *Bevestigen*.

De link gaat naar **jouw eigen Gmail**, niet naar de link uit de mail. Die link
komt van buiten, is vaak eenmalig, en een nepfactuur ziet er precies hetzelfde
uit. Eén klik extra, en die hele categorie problemen is weg.

Een betaalbewijs (`receipt`) wordt niet eens een melding: dat geld is al
afgeschreven en staat in je bankafschriften. Als verwachte factuur inboeken zou
het dubbel in de prognose zetten. Die worden alleen geteld.

## Waar de code van de Code-nodes vandaan komt

De logica van de Code-nodes stond als tekst in dit JSON-bestand, en niets
controleerde hem. Dat is precies waarom een verzoek zonder bijlage en zonder
tekst maandenlang de deur uit kon.

Nu staat die logica in `packages/core/src/n8n/` als gewone bestanden, met tests
ernaast (`pnpm --filter @lavega/core test`). `pnpm run sync:n8n` schrijft ze
letterlijk in de nodes; `codeNodes.test.ts` bouwt ze opnieuw en vergelijkt, dus
een node die uit de pas loopt laat de testsuite vallen.

> **Let op bij bewerken in n8n zelf.** Pas je de Code in de n8n-web-UI aan en
> exporteer je de workflow terug hierheen, dan wint jouw versie en faalt die
> test. Dat is de bedoeling — het is de enige manier waarop de twee uit elkaar
> kunnen lopen. Wijzig liever het bestand in `packages/core/src/n8n/` en draai
> `pnpm run sync:n8n`.

## Wat je moet controleren bij de eerste run

- De punten onder "Wat er mis was" hierboven — die gaan over precies deze run.
- Roep daarna de webhook-URL aan. Je hoort dezelfde facturen terug te krijgen
  (plus een `notices`-lijst), en een **tweede** aanroep hoort leeg te zijn — dat
  is de rij die zichzelf opruimt.
- **PDF-ondersteuning.** De bijlage gaat als `document`-blok naar Claude. Geeft
  *Lees de factuur* een 400 over het documenttype, voeg dan de header
  `anthropic-beta: pdfs-2024-09-25` toe aan die node.
- **`Invalid base64 data` (opgelost 2026-08-17).** Staat
  `N8N_DEFAULT_BINARY_DATA_MODE` niet op `default`, dan bewaart n8n de bytes
  búiten het item: `binary[key].data` bevat dan een verwijzing
  (`filesystem-v2:...`) en `binary[key].id` is gevuld. Die verwijzing werd als
  base64 doorgestuurd en Anthropic weigerde hem — terecht. Nu beslist **`b.id`**
  of de bytes opgehaald moeten worden met `getBinaryDataBuffer`, niet of `data`
  toevallig leeg is. En wat er dan nog uitkomt wordt gecontroleerd: is het geen
  base64, dan gaat de bijlage niet mee en staat de reden in `skipped`. Liever
  weigeren dan iets versturen dat we niet gelezen hebben.

## Grenzen

- Maximaal 25 berichten per run, maximaal 3 PDF's per bericht, elk maximaal
  4 MB. Wat afvalt, valt met een reden af: die staat in `skipped` bij het
  bericht. Een mail zonder PDF én zonder bruikbare tekst wordt geen factuur maar
  een melding — hij verdwijnt niet.
- Maximaal 200 facturen in de rij; daarboven vallen de oudste eruit. Een rij die
  niemand ophaalt is een lek, geen archief.
- Ontdubbeld op `messageId`, want de schedule loopt elk uur over dezelfde zeven
  dagen mail. Sinds deze versie onthoudt n8n ook wélke berichten het model al
  beoordeeld heeft (`seenIds`, maximaal 2000). Zonder dat ging dezelfde mail —
  inclusief PDF, en dus inclusief echte tokens — tot 168 keer naar Claude, want
  de wachtrij wordt bij elk ophalen geleegd. Mislukt de modelaanroep, dan wordt
  het bericht NIET onthouden en probeert de volgende run het opnieuw.
- Een regel zonder bedrag wordt geweigerd. Een verzonnen factuur in een
  boekhouding is erger dan een gemiste factuur.
- Aanmaningen en orderbevestigingen gelden niet als factuur, ook niet als er een
  bedrag in staat: een aanmaning heeft een ander `messageId` maar hetzelfde
  factuurnummer, dus die zou als tweede, verse betaalpost binnenglippen. Ze
  worden een melding.
- Een melding is geen factuur en wordt nooit geboekt — hij herinnert je eraan dat
  je hem zelf moet ophalen. Er zit geen bedragveld in.
- Spam blijft onzichtbaar: `includeSpamTrash` staat uit, en dat blijft zo, want
  aanzetten haalt ook verwijderde mail terug.
- Je eigen verzonden facturen komen mee (die zoekwoorden staan er ook in) en zijn
  bedoeld als `income`. Heb je zo'n factuur zelf al ingetypt, dan kan hij als
  tweede regel terugkomen als de vervaldatum net anders is.
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
