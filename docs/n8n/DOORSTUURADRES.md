# Facturen doorsturen naar een eigen adres

Ontwerp: `docs/superpowers/specs/2026-08-17-invoice-forwarding-address-design.md`.
Dit bestand is de bouw- en instelhandleiding.

Je stuurt een factuurmail door naar een adres van jezelf. Een Cloudflare Email
Worker neemt hem aan en POST hem naar dezelfde n8n-workflow die Gmail al voedt.
Daarna gebeurt er precies wat er nu ook gebeurt: PDF → Claude → wachtrij → jij
bevestigt elke regel. Er wordt niets automatisch geboekt.

```
factuur@leverancier.nl
      │  (jij stuurt hem door, of een Gmail-filter doet dat)
      ▼
alexander-7f3a@invoices.lavega.dev
      │  Cloudflare Email Routing → Worker `lavega-email-in`
      ▼
n8n-webhook "E-mail binnen"  ──►  hetzelfde pad als Gmail:
      │                            "Bouw Claude-verzoek" → "Lees de factuur"
      ▼                            → "Zet in de wachtrij"
LaVega haalt de rij op, jij bevestigt
```

**Er verdwijnt geen mail.** Dat is de enige harde eigenschap van dit pad. Elke
uitkomst is óf "hij staat in de wachtrij", óf een **bounce** met de oorzaak erin,
óf een **antwoord** met de uitleg. Er is geen vierde uitgang. Een doorgestuurde
factuur die spoorloos verdwijnt is het ergste wat hier kan gebeuren, want dan
denk je dat je hem hebt.

---

## Wat je aanzet, in vier stappen

### Stap 1 — Email Routing op `lavega.dev`

`lavega.dev` staat al op Cloudflare (`wells.ns.cloudflare.com`) en had **geen MX-records**,
dus er wordt niets verdrongen en Email Routing is gratis.

1. Cloudflare-dashboard → **lavega.dev** → **Email** → **Email Routing** → **Get started**.
2. Cloudflare zet zelf de benodigde **MX**-records en een **SPF-TXT**-record neer.

> **Kijk eerst of je al SPF hebt.** Verstuur je al mail vanaf `lavega.dev` (een
> nieuwsbrief, een SMTP-relay), dan mag Cloudflare's `v=spf1
include:_spf.mx.cloudflare.net ~all` het bestaande record niet **vervangen** —
> de twee moeten samengevoegd worden tot één TXT-record met beide `include`'s.
> Twee losse SPF-records maken je domein ongeldig voor SPF, en dan zakt élke mail
> die je verstuurt. Op 17 augustus 2026 stond er geen mailverkeer op dit domein,
> dus dit is nu waarschijnlijk niet aan de orde — controleer het toch.

**Op welk domein komt het adres?**

- Het ontwerp gebruikt de subdomein-vorm: `<slug>-<code>@invoices.lavega.dev`.
  Voordeel: de apex (`@lavega.dev`) blijft vrij voor gewone post.
- **Ik heb niet kunnen nagaan of jouw Cloudflare-account subdomein-routing
  aanbiedt.** Zie je onder _Email Routing_ geen mogelijkheid om
  `invoices.lavega.dev` toe te voegen, gebruik dan de apex en zet het onderscheid
  in het lokale deel: `factuur-alexander-7f3a@lavega.dev`. De Worker en n8n
  werken in beide gevallen hetzelfde — de wachtrijsleutel is het lokale deel vóór
  de `@`, en dat is in beide vormen `factuur-alexander-7f3a` respectievelijk
  `alexander-7f3a`.
- Kies één vorm en houd hem vast. Het adres staat in je Gmail-filter, en een
  veranderd adres betekent stilzwijgend geen facturen meer.

### Stap 2 — Het geheim, en de webhook in n8n

1. Maak een geheim:
   ```bash
   openssl rand -hex 24
   ```
2. **In n8n:** importeer `docs/n8n/lavega-invoices.json` (Workflows → _Import from
   File_) als je dat nog niet gedaan hebt. Open de node **E-mail binnen**:
   - _Authentication_ staat al op **Header Auth**. Maak daar een credential voor:
     - **Name:** `x-lavega-token` — dezelfde naam als de credential die LaVega
       zelf aanmaakt bij _Verbind met n8n_. n8n weigert een workflow te
       activeren zolang één van zijn webhook-nodes een credential mist die hij
       zegt nodig te hebben, dus dezelfde credential hangt aan **beide**
       webhooks. Eén credential, één headernaam.
     - **Value:** het geheim uit stap 1
   - _HTTP Method_ is **POST**, _Path_ is `lavega-mail-in`, _Respond_ is
     **When Last Node Finishes**. Laat die drie staan — zie "Waarom Respond op
     _When Last Node Finishes_ staat" hieronder.
3. **Activeer de workflow** (de schakelaar rechtsboven). Een webhook werkt alleen
   in een actieve workflow; in de test-modus luistert hij precies één keer, en
   daarna geeft hij `404`.
4. Kopieer de **Production URL** van de node. Neem níet de test-URL — die staat op
   `/webhook-test/…` en levert na één keer een bounce met "404 … de workflow staat
   niet op Actief, of dit is de test-URL".

### Stap 3 — De Worker deployen

Er staat **geen wrangler in de repo** en de Worker heeft **nul
afhankelijkheden** — er loopt niets mee in een pad dat een factuur draagt. Je
haalt wrangler per keer op.

1. URL en geheim gaan **niet** in de repo:
   ```bash
   cd apps/email-worker
   pnpm dlx wrangler@4 secret put N8N_WEBHOOK_URL       # plak de Production URL
   pnpm dlx wrangler@4 secret put N8N_SHARED_SECRET     # plak het geheim
   pnpm dlx wrangler@4 deploy
   ```

### Stap 4 — De route: alle mail naar de Worker

Cloudflare-dashboard → **Email Routing** → **Routes**:

1. **Catch-all address** → **Edit** → _Action_: **Send to a Worker** → kies
   `lavega-email-in` → **Save** en zet hem **aan**.
2. Catch-all betekent: een nieuw adres kost geen configuratie. Het lokale deel
   bepaalt bij welke wachtrij het hoort.

> De Worker staat alleen in die lijst als hij een `email()`-handler heeft en
> gedeployd is. Zie je hem niet, dan is stap 3 niet gelukt — kijk naar de uitvoer
> van `wrangler deploy`, niet naar deze pagina.

Een **Gmail-filter** doet daarna het werk: _Instellingen → Filters → Nieuw
filter_ op je factuur-zoekopdracht, actie **Doorsturen naar** het nieuwe adres.
Gmail wil dat adres eerst als doorstuuradres bevestigd hebben: het stuurt er een
verificatiecode naartoe, en die code komt bij deze opzet in **n8n** terecht (als
melding of als een run zonder factuur), niet in je inbox. Zoek hem op in n8n →
Executions → de body van "E-mail binnen".

---

## Waarom het zo in elkaar zit

### Waarom Respond op _When Last Node Finishes_ staat

De standaardinstelling van een n8n-webhook (_Immediately_) geeft `200` zodra het
verzoek binnen is. De Worker zou dan een succes zien vóórdat er iets gebeurd is,
en een mail die daarna alsnog omvalt zou verdwijnen terwijl jij denkt dat hij
aankwam. Met _When Last Node Finishes_ krijgt de Worker het antwoord van **"Zet
in de wachtrij"** — `{addedInvoices, addedNotices, inQueue, noticesInQueue,
remembered}` — en daar leest hij aan af of er echt iets in de rij staat.

Er staat met opzet **geen `Respond to Webhook`-node** in het pad. Dat pad wordt
gedeeld met de Gmail-tak, en die heeft geen webhook om op te antwoorden; een
respond-node zou elke uurlijkse Gmail-run laten omvallen.

### Waarom er geen tweede verwerkingspad is

De nieuwe tak bestaat uit precies twee nodes: de webhook **E-mail binnen** en de
Code-node **Normaliseer binnengekomen mail**. Die tweede komt uit op **dezelfde
If-node** ("Iets te lezen?") als Gmail, en dus op dezelfde "Bouw Claude-verzoek"
→ "Lees de factuur" → "Naar LaVega-vorm" → "Zet in de wachtrij".

Alles wat betekenis heeft — welke tekst de hoofdtekst is, welke bijlage een
factuur kan zijn, wanneer er niets te lezen valt — komt uit dezelfde functies
(`pickBody`, `pickPdfs`) die de Gmail-tak gebruikt. Alleen de **envelop** is
anders: `normalizeInboundMail` weet welk JSON-veld welk deel van een bericht is.
Twee normalisaties naast elkaar zouden binnen een maand uit elkaar lopen, en het
eerste dat je daarvan merkt is een gemiste factuur.

`pnpm run sync:n8n` schrijft die code letterlijk in de nodes;
`packages/core/src/n8n/codeNodes.test.ts` bouwt hem opnieuw en vergelijkt. Pas je
de Code in de n8n-UI aan en exporteer je terug, dan valt die test om. Dat is de
bedoeling.

### Geen ontdubbeling op `seenIds` in deze tak

De Gmail-tak loopt elk uur over dezelfde zeven dagen mail en moet zichzelf
remmen, anders gaat dezelfde PDF 168 keer naar Claude. Een doorgestuurde mail is
een **handeling van jou**. Stuur je er één opnieuw door omdat de eerste niet
aankwam, dan hoort die opnieuw verwerkt te worden — en niet stil te verdwijnen
omdat hij ooit al eens langskwam. De wachtrij ontdubbelt nog steeds op
`messageId`, dus twee keer hetzelfde bericht levert één regel op en de Worker
antwoordt je dat er niets is toegevoegd.

### Grenzen, en waar ze gecontroleerd worden

| Grens                | Waar                                       | Wat er gebeurt bij overschrijding                                |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| 17.0 MB per bericht  | Worker, **vóór het parsen** (op `rawSize`) | bounce: "deze mail is X MB en LaVega neemt maximaal 17.0 MB aan" |
| 4 MB per PDF         | Worker, na het parsen                      | bounce **met de bestandsnaam** erin                              |
| 3 PDF's per bericht  | Worker, na het parsen                      | bounce: "deze mail heeft N PDF-bijlagen; de grens is 3"          |
| 4 MB / 3 PDF's       | `packages/core`, tweede lijn               | de bijlage valt af met een reden in `skipped`                    |
| 6000 tekens tekst    | `packages/core`                            | de tekst wordt afgekapt en het verzoek zegt dat                  |
| 200 regels in de rij | `packages/core`                            | de oudste vallen eruit                                           |

Waarom die eerste drie in de **Worker** zitten en niet alleen in core: alleen
daar kunnen we jou nog iets vertellen. In n8n zou de bijlage met een reden in
`skipped` verdwijnen, en dan zou jij moeten opmerken dat er iets ontbrak.

Die 17.0 MB is geen rond getal maar een som: drie bijlagen van 4 MiB staan op de
lijn als base64, en base64 is 4/3 van de bytes — 16 MiB — plus 1 MiB voor
headers, tekst en een logo. Meer dan dat kán geen mail zijn die aan de
bijlage-limieten voldoet.

---

## Herkomst: wat er in de wachtrij bij komt te staan

Elke regel die via dit pad binnenkomt draagt vier extra velden:

| Veld           | Wat het is                                    |
| -------------- | --------------------------------------------- |
| `deliveredTo`  | het volledige adres waarop de mail binnenkwam |
| `queueKey`     | het lokale deel daarvan                       |
| `from`         | wie hem stuurde — **niet geverifieerd**       |
| `senderCheck`  | `passed`, `failed` of `unknown`               |
| `senderChecks` | de letterlijke uitslag van SPF, DKIM en DMARC |

Een regel uit Gmail heeft die velden **niet**, en dat is opzet: er wás geen
doorstuuradres en er is geen SPF-uitslag. Een leeg `deliveredTo` zou zeggen dat
er wél een adres was en dat we het kwijt zijn.

**`senderCheck: 'passed'` is geen goedkeuring van de factuur.** Het betekent
alleen dat de mail echt van dat domein kwam. Een echte mail van een echte
leverancier kan nog steeds een nepfactuur bevatten. Daarom heet dit veld nergens
`verified`, en daarom wordt een mail die **zakt** gemarkeerd en niet weggegooid:
weggooien betekent dat een echte factuur van een domein met een slordig
SPF-record verdwijnt zonder dat iemand het merkt.

**Let op wat `from` betekent bij doorsturen.** Stuur je een mail door uit je
Gmail, dan ben jij de afzender — niet de leverancier. De leverancier komt uit de
factuur zelf en staat als `counterparty` in de regel. Dat is ook waarom
`senderCheck` bij een doorgestuurde mail over _jouw_ domein gaat.

> **Nog niet in beeld.** De velden komen tot in de wachtrij en de webhook geeft
> ze terug, maar `parseQueue` in `apps/web/src/n8n.ts` bouwt zijn rij op uit een
> vaste lijst velden en laat onbekende velden vallen. Er staat dus nog **niets**
> van deze herkomst op je scherm; je ziet ze nu alleen in n8n → Executions.
> `apps/web` viel buiten de opdracht die deze tak bouwde. Wat er moet gebeuren:
> `N8nInvoiceRow` en `N8nNotice` uitbreiden met deze vier velden, ze in
> `parseQueue` overnemen, en ze in de reviewregel in `views/Facturen.tsx` tonen —
> met bij `senderCheck: 'failed'` een zichtbare markering en géén woord dat op
> "geverifieerd" lijkt.

### Er is nog steeds één wachtrij

`queueKey` wordt vastgelegd, maar n8n houdt **één** rij in
`getWorkflowStaticData`. Er wordt niet per sleutel gescheiden. Voor één gebruiker
maakt dat niets uit en dit is wat het ontwerp vraagt ("single-user vandaag,
multi-user later zonder herontwerp"). Zet er geen tweede persoon op zonder eerst
die scheiding te bouwen — anders komen twee mensen hun facturen in dezelfde rij
terecht.

---

## Wat je bij de eerste doorgestuurde factuur nakijkt

Stuur één echte factuurmail met een PDF door en loop dit af.

1. **De Worker heeft hem gezien.**

   ```bash
   cd apps/email-worker && pnpm dlx wrangler@4 tail
   ```

   Je hoort één regel te zien: `[lavega-email-in] 1 factuur/facturen en 0
melding(en) toegevoegd voor wachtrij <sleutel>`. Er staat geen adres, geen
   onderwerp en geen bedrag in die logregel — met opzet.

   **Zie je niets?** Dan is de mail niet bij de Worker gekomen: dat is Email
   Routing (stap 1 en 4), niet de Worker. Kijk bij _Email → Email Routing →
   Overview_ of er verkeer binnenkomt.

2. **n8n heeft hem verwerkt.** n8n → **Executions** → de nieuwste run van
   _LaVega — facturen_. Klik op **Normaliseer binnengekomen mail** en kijk naar:
   - `textSource` — `text` of `html`, en `textChars` niet 0;
   - `pdfs` — één regel, met een `bytes` die op de PDF lijkt;
   - `skipped` — leeg. Staat er iets in, dan is een bijlage bewust niet
     meegegaan, **met de reden erbij**;
   - `deliveredTo`, `queueKey` en `senderChecks` — gevuld.

3. **Het model heeft iets gekregen.** Klik op **Bouw Claude-verzoek** en kijk naar
   `sent`: `documents` hoort **1** te zijn bij een mail met een PDF, en
   `textChars` een paar honderd. Blijft `documents` 0 terwijl er wél een PDF in de
   mail zat, dan is de bijlage in de Worker afgevallen en staat de reden in
   `skipped` bij de vorige node.

4. **De rij is gegroeid.** De laatste node geeft
   `{addedInvoices, addedNotices, inQueue, …}`. Haal daarna de rij op in LaVega
   (_Facturen → Ophalen uit n8n_) en bevestig de regel.

5. **Kwam er een bounce?** Lees hem. Elke bounce van dit pad noemt de oorzaak bij
   naam — een variabele, een status, een bestandsnaam. De vijf die je in het begin
   kunt verwachten:

   | In de bounce                                      | Wat er echt aan de hand is                                              |
   | ------------------------------------------------- | ----------------------------------------------------------------------- |
   | `N8N_WEBHOOK_URL is niet gezet`                   | stap 3.1 overgeslagen: `wrangler.toml` heeft nog een lege URL           |
   | `N8N_SHARED_SECRET is niet gezet`                 | `wrangler secret put` niet gedaan, of na de deploy pas                  |
   | `weigerde de Worker (401)`                        | het geheim in de Worker ≠ de Value van de Header Auth-credential        |
   | `gaf 404`                                         | de workflow staat niet op **Actief**, of dit is de test-URL             |
   | `zonder de telling {addedInvoices, addedNotices}` | _Respond_ van "E-mail binnen" staat niet op **When Last Node Finishes** |

6. **Kwam er een antwoord in plaats van een bounce?** Dan is de mail volledig
   verwerkt en is er niets aan de rij toegevoegd. Het antwoord noemt de drie
   mogelijke oorzaken (betaalbewijs, al in de rij, geen factuur en geen melding).
   Welke van de drie het was, staat in n8n → Executions.

---

## Wat hier niet getest is, en dus in productie kan falen

Eerlijk opgeschreven, want dit is precies waar dit soort werk misgaat.

**Wél in tests vastgelegd** (`pnpm --filter @lavega/email-worker test`, 55 tests;
`pnpm --filter @lavega/core test`, 430 tests): het MIME-parsen op vijf echte
mailvormen, RFC 2047 en RFC 2231 in headers en bestandsnamen, base64 en
quoted-printable, het lezen van `Authentication-Results`, het lokale deel van een
adres, elke bounce-tekst met zijn oorzaak, de terugval van antwoord naar bounce,
de bijlage-limieten, en het naadje tussen wat de Worker POST en wat
`packages/core` leest.

**Niet te testen zonder Cloudflare, dus kan alleen bij de eerste echte mail
blijken:**

- of Email Routing de mail überhaupt aan de Worker geeft — inclusief of jouw
  account **subdomein-routing** op `invoices.lavega.dev` toestaat (zie stap 1);
- of `message.setReject()` bij de verzendende server echt een bounce oplevert die
  bij een mens aankomt;
- of Cloudflare het antwoord van `message.reply()` accepteert. De vorm klopt met
  wat de documentatie eist (From = het ontvangende adres, `In-Reply-To` gelijk aan
  de `Message-ID`) en er is een terugval naar een bounce als het faalt, maar het
  antwoordpad zelf is hier niet gelopen;
- **welke `Authentication-Results`-header Cloudflare precies meestuurt.** De
  parser leest de eerste uitslag die hij tegenkomt, en als een upstream-MTA er al
  één had toegevoegd kan dat die van een andere hop zijn. Ontbreekt de header,
  dan is de uitslag `unknown` — nooit `pass`. Kijk bij de eerste mail in n8n naar
  `senderChecks`: staat daar drie keer `unknown` bij een mail die je van een net
  ingericht domein doorstuurde, dan zet Cloudflare de header niet zoals hier
  aangenomen;
- of de Workers-runtime een bericht van 17 MB in het geheugen aankan. De limiet
  is zo gekozen dat het moet passen, maar de bovengrens is niet opgezocht;
- `message/rfc822` wordt **niet** uitgepakt. Stuur je een mail door "als bijlage"
  in plaats van gewoon door te sturen, dan komt de PDF niet mee. Dat is zichtbaar:
  er staat geen bijlage in de melding. Stil is het niet.
