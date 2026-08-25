# Diagnose van de factuur-workflow, en de gecorrigeerde versie

24 augustus 2026. Aanleiding: elke doorgestuurde mail komt terug als bounce met
`404 op /webhook/lavega-facturen`.

Het gecorrigeerde bestand staat naast dit document:
**`docs/n8n/lavega-facturen-workflow.json`**.

Ik heb jouw JSON niet als uitgangspunt genomen maar onze eigen code, want die is
wat er aan beide kanten van de webhook draait:

| Bestand | Wat het vastlegt |
|---|---|
| `apps/email-worker/src/handler.ts` | wat de Cloudflare-worker POST, met welke header, en welke node-namen zijn bounces noemen |
| `apps/web/src/n8n.ts` | met welke **methode** en welke header LaVega ophaalt, en welke vorm `parseQueue` accepteert |
| `scripts/fake-invoice-queue.mjs` | de nepwachtrij — het antwoord waarvan bewezen is dat de app het slikt |
| `docs/n8n/lavega-invoices.json` | de werkende workflow; zijn Code-nodes worden getest door `packages/core/src/n8n/codeNodes.test.ts` |

---

## Kort

**De 404 en het echte probleem zijn twee verschillende dingen.**

De 404 is een registratieprobleem in n8n en zegt niets over de inhoud van je
workflow. Het echte probleem zit eronder: `/webhook/lavega-facturen` is bij jou
de webhook waarmee **LaVega de wachtrij OPHAALT EN LEEGT**. Als de 404 morgen
verdwijnt, komt elke doorgestuurde factuur binnen op de node die je wachtrij
leegkiepert.

En daaronder zit nog iets: er wordt in jouw workflow **nergens iets in de
wachtrij geschreven**. `Naar LaVega-vorm` hangt nergens aan, en
`$getWorkflowStaticData('global').queue` wordt alleen gelézen. De wachtrij is dus
per definitie leeg — ook als de mailkant het morgen zou doen.

Acht bevindingen, hieronder één voor één.

---

## 1. Er is geen intake voor doorgestuurde mail

**Wat er misgaat.** `handler.ts` POST naar de URL in `N8N_WEBHOOK_URL`, met de
header `x-lavega-token` (regel 54 en 262-266). In jouw workflow bestaat er geen
node die die POST kan opvangen. De enige webhook die POST accepteert is
`LaVega vraagt de rij op` — en die zit vast aan `Geef de rij en leeg hem`, dat
`store.queue = []` doet.

**Wat je ziet.** Nu: de bounce met 404. Zodra de 404 weg is: **elke doorgestuurde
mail leegt je factuurwachtrij**. De drain-node draait vóór `Antwoord aan LaVega`,
dus de rij is al weg op het moment dat de rest omvalt. De worker leest daarna
geen `{addedInvoices, addedNotices}` en bouncet met "antwoordde zonder de
telling" (`handler.ts` 335-342) — een bounce die de verkeerde oorzaak noemt,
terwijl je facturen inmiddels nergens meer staan.

**De reparatie.** Een aparte webhook `E-mail binnen`: **POST**, eigen pad
`lavega-mail-in`, Header Auth, Respond = *When Last Node Finishes*. Daarachter
`Normaliseer binnengekomen mail`, die uitkomt op dezelfde `Iets te lezen?` als
Gmail. Dat is precies wat `handler.ts` bij naam noemt in twee van zijn
foutmeldingen, en wat `docs/n8n/DOORSTUURADRES.md` stap 2 beschrijft.

> **Dit betekent dat je de Worker-secret moet omzetten.** `N8N_WEBHOOK_URL` wijst
> nu naar `…/webhook/lavega-facturen`; hij moet naar `…/webhook/lavega-mail-in`.
> Zie stap 6 hieronder.

---

## 2. De 404 zelf

Je POST gaat naar een pad waar in jouw workflow wél een **POST**-node op staat.
Een geregistreerde route die de methode accepteert geeft geen 404 — die geeft 200
of 500. Een 404 betekent hier dus: **de route bestaat niet**, niet "de route
weigert dit verzoek". En hij komt bij *elke* mail, dus het is niet iets
tijdelijks.

Vier verklaringen, op volgorde van waarschijnlijkheid:

**a. De workflow staat niet op Actief.** Verreweg het waarschijnlijkst. n8n
registreert de productieroute (`/webhook/…`) alleen voor actieve workflows.
Opslaan is niet activeren. Dit is ook wat `handler.ts` zelf als eerste noemt
(regel 290-298), en het past bij het beeld: alles aan je verzoek klopt, alleen
het adres bestaat niet.

**b. n8n weigert te activeren omdat een webhook-node zijn credential mist.** Zet
je *Authentication* op **Header Auth** zonder een credential te kiezen, dan
weigert n8n de workflow te activeren — de schakelaar springt terug en er
verschijnt een rode melding. Wie die melding wegklikt houdt een workflow over die
"aan lijkt te staan" en 404 geeft. Dit staat als reden in `handler.ts` regel 44-53
en is precies de reden dat één credential aan **beide** webhooks hangt.

**c. Het is de test-URL.** `/webhook-test/…` in plaats van `/webhook/…`. Die
luistert één keer, nadat je op *Listen for test event* hebt gedrukt, en geeft
daarna 404. Je bounce citeert de volledige URL — kijk erin welke van de twee er
staat.

**d. Er staan twee workflows en de actieve is de andere.** Twee actieve workflows
kunnen niet hetzelfde pad claimen; n8n weigert de tweede. Zit je in het ene
tabblad te bewerken en luistert het andere, dan verandert er niets aan wat er
buiten gebeurt.

**Minder waarschijnlijk, maar bij jouw opstelling niet uit te sluiten:** je n8n
draait in queue-mode. Draait het webhook-verkeer via een apart proces, dan moet
dát proces de registratie hebben. Blijft de 404 staan terwijl de workflow
aantoonbaar actief is, herstart dan de n8n-service en probeer opnieuw.

**Wat ik niet kan vaststellen.** Ik heb geen toegang tot jouw n8n. Ik kan niet
zien of de workflow actief is, wat er letterlijk in `N8N_WEBHOOK_URL` staat, of
er een tweede workflow bestaat, of welke n8n-versie je draait. De volgorde
hierboven is een redenering op wat je verzoek en onze code zeggen, geen meting.
Stap 3 van de controlelijst haalt het onderscheid in één `curl` naar boven.

---

## 3. De Gmail-tak gooit zijn resultaat weg

**Wat er misgaat.** In je `connections` staat `"Naar LaVega-vorm": { "main": [[]] }`
— de node heeft geen uitgang. Er is geen node `Zet in de wachtrij`, en
`$getWorkflowStaticData('global').queue` wordt nergens geschreven. Alleen
`Geef de rij en leeg hem` leest hem.

**Wat je ziet.** Groene runs elk uur, kosten bij Anthropic, en in LaVega een lege
wachtrij. Dat is de vervelendste soort storing: alles staat op groen.

**De reparatie.** De node `Zet in de wachtrij` erbij, met `Naar LaVega-vorm` →
`Zet in de wachtrij`. Die node draait de geteste `addToQueue` uit
`packages/core/src/n8n/queue.js` en **ontdubbelt op `messageId`**. Zie bevinding 8
voor wat die ontdubbeling wel en niet doet.

---

## 4. De ophaalkant staat op POST; LaVega doet GET

**Wat er misgaat.** `apps/web/src/n8n.ts` regel 223-225:

```ts
res = await fetchImpl(url.trim(), {
  method: "GET",
  headers: { "x-lavega-token": token.trim() },
});
```

Jouw node `LaVega vraagt de rij op` staat op **POST**. n8n registreert een webhook
per methode én pad, dus een GET op een pad dat alleen POST kent is een 404 — een
tweede 404, aan de andere kant van de keten.

Er komt nog iets bij: `apps/web/src/n8n-provision.ts` zoekt de ophaal-webhook op
door de webhook te pakken die op **GET** staat (`findQueueWebhookNode`). Staat
geen van beide op GET, dan eindigt *Verbind met n8n* op "geen webhook-node
gevonden".

**Wat je ziet.** In *Facturen* → *Ophalen uit n8n*: een foutmelding met status
404 (`FetchOutcome` `http-error`).

**De reparatie.** `LaVega vraagt de rij op` staat in het nieuwe bestand op **GET**,
pad `lavega-facturen` — dus jouw bestaande URL in *Koppelingen* blijft geldig. De
POST-ingang verhuist naar het eigen pad `lavega-mail-in`.

---

## 5. Respond: `lastNode` mét een `Respond to Webhook`-node

**Wat er misgaat.** Je webhook staat op `responseMode: "lastNode"` terwijl er een
`Antwoord aan LaVega` (respondToWebhook) achter hangt. Die node werkt alleen als
de webhook die hem voedt op *Using Respond to Webhook Node* staat; anders valt hij
om. Onze eigen documentatie zegt hetzelfde vanaf de andere kant:

> "Er staat met opzet **geen `Respond to Webhook`-node** in het pad. Dat pad wordt
> gedeeld met de Gmail-tak, en die heeft geen webhook om op te antwoorden; een
> respond-node zou elke uurlijkse Gmail-run laten omvallen."
> — `docs/n8n/DOORSTUURADRES.md`

**Dit verklaart de 404 níet.** Een verkeerd ingestelde Respond levert een 500 of
een antwoord in de verkeerde vorm, geen 404 — de 404 valt vóór dit punt. Wat het
wél verklaart is het beeld eromheen: een 500 of een lege body op de ophaalkant,
terwijl de drain-node de wachtrij al geleegd heeft.

**Welke van de twee wij verwachten — allebei, elk op zijn eigen webhook:**

| Webhook | Respond | Waarom |
|---|---|---|
| `E-mail binnen` (POST) | **When Last Node Finishes** | De worker leest het antwoord van `Zet in de wachtrij`: `{addedInvoices, addedNotices, …}`. Op *Immediately* zou hij een 200 zien vóórdat er iets gebeurd is en zou een mail kunnen verdwijnen terwijl jij denkt dat hij aankwam. `handler.ts` 317-342 noemt deze instelling twee keer bij naam. |
| `LaVega vraagt de rij op` (GET) | **Using Respond to Webhook Node** | Hier hoort de `Antwoord aan LaVega`-node bij, die `{invoices, notices, servedAt}` teruggeeft — de vorm die `parseQueue` accepteert. |

Die scheiding werkt omdat de Respond-node in de mailtak nooit meedraait: hij zit
op de ophaaltak, en die tak start alleen bij een GET op `lavega-facturen`.

---

## 6. Geen tokencontrole op de ophaal-webhook

**Wat er misgaat.** Jouw `LaVega vraagt de rij op` heeft geen *Authentication*.
Iedereen die het pad kent kan je factuurwachtrij ophalen — en omdat het ophalen
hem ook **leegt**, kan iedereen die het pad kent je facturen weggooien.

**Wat je ziet.** Niets. Dat is het probleem.

**De reparatie.** Beide webhooks op **Header Auth**, met dezelfde credential:
headernaam `x-lavega-token`. Eén credential voor allebei is geen netheid maar een
eis — n8n weigert te activeren zolang een node een credential mist die hij zegt
nodig te hebben (`handler.ts` 44-53), en de worker en de browser sturen dezelfde
header. In het JSON-bestand staat alleen de **keuze** `"authentication":
"headerAuth"`; de waarde zit in de n8n-credential en komt de repo niet in.

---

## 7. De false-tak van `Iets te lezen?` gaat nergens heen

**Wat er misgaat.** Je `Iets te lezen?` heeft alleen een true-uitgang. Een mail
zonder leesbare tekst en zonder PDF-bijlage loopt daar dood.

**Wat je ziet.** Bij Gmail: die mail verdwijnt, en een gemiste factuur ziet er
precies zo uit als geen factuur. Bij een doorgestuurde mail is het erger op een
andere manier: de laatst uitgevoerde node is dan `Iets te lezen?`, en die geeft
geen `{addedInvoices, addedNotices}` terug — dus bouncet de worker met "antwoordde
zonder de telling", een melding die naar de verkeerde knop wijst.

**De reparatie.** De node `Melding: zelf ophalen` op de false-uitgang, die er een
`notice` van maakt en die óók in de wachtrij zet. Een melding heeft structureel
géén bedragveld en kan dus nooit een boeking worden; het is een briefje dat er
iets op je wacht. `parseQueue` leest ze uit `body.notices`.

---

## 8. Ontdubbelen: twee remmen, en wat elk van de twee doet

Je schema draait elk uur over dezelfde zeven dagen mail. Zonder rem zou dezelfde
factuur twaalf keer per dag in de rij komen — en, duurder, twaalf keer met PDF
naar het model gaan. Er zitten twee remmen in, en ze doen niet hetzelfde.

**Rem 1 — `seenIds`, vóór het model.** `Normaliseer bericht` slaat elk bericht
over waarvan `Zet in de wachtrij` het `messageId` al onthouden heeft. Gemeten met
de code uit het nieuwe bestand:

```
uur 1 -> naar het model: 1 | tekst: 128 tekens, bron text
uur 2 -> naar het model: 0   (0 = de rem werkt; de mail is al beoordeeld)
```

Een `messageId` komt pas in `seenIds` als het model hem ook echt beoordeeld heeft.
Mislukt de aanroep, dan blijft hij onbekend en probeert de volgende run het
opnieuw — een fout wordt niet als "afgehandeld" onthouden.

**Rem 2 — ontdubbelen op `messageId`, bij het schrijven.** `addToQueue` weigert
een `messageId` dat al in de rij staat. Gemeten, drie keer dezelfde factuur
aangeboden:

```
1e keer : {"addedInvoices":1,"addedNotices":0,"inQueue":1,...}
2e keer : {"addedInvoices":0,"addedNotices":0,"inQueue":1,...}   <- ontdubbeld
3e keer : {"addedInvoices":0,"addedNotices":0,"inQueue":1,...}
```

**Eerlijk over de grens van rem 2:** hij kijkt naar wat er op dát moment in de rij
staat. Heeft LaVega de rij net opgehaald (en dus geleegd), dan zou dezelfde factuur
er opnieuw in kunnen. Gemeten:

```
na het legen nog eens aangeboden: {"addedInvoices":1,...}
```

Dat gebeurt in de praktijk niet, omdat rem 1 die mail dan al niet meer naar het
model stuurt. Maar het is rem 1 die de twaalf keer tegenhoudt, niet rem 2 — rem 2
vangt de dubbelingen binnen één run en binnen één rij.

**En met opzet géén rem op doorgestuurde mail.** `Normaliseer binnengekomen mail`
filtert niet op `seenIds`. Stuur je een factuur nog eens door omdat de eerste niet
aankwam, dan hoort die opnieuw verwerkt te worden en niet stil te verdwijnen omdat
hij ooit al eens langskwam.

---

## Wat er in het gecorrigeerde bestand staat

`docs/n8n/lavega-facturen-workflow.json` — 15 nodes, twee ingangen, één wachtrij.

```
E-mail binnen (POST /lavega-mail-in, Header Auth, When Last Node Finishes)
      └─► Normaliseer binnengekomen mail ─┐
                                          │
Handmatig starten ─┐                      │
Elk uur ───────────┴─► Gmail: recente mail │
                             └─► Normaliseer bericht ─┤
                                                     ▼
                                             Iets te lezen?
                                          true │        │ false
                                               ▼        ▼
                                   Bouw Claude-verzoek   Melding: zelf ophalen
                                               ▼                    │
                                       Lees de factuur              │
                                               ▼                    │
                                       Naar LaVega-vorm             │
                                               └────────┬───────────┘
                                                        ▼
                                              Zet in de wachtrij

LaVega vraagt de rij op (GET /lavega-facturen, Header Auth, Respond-node)
      └─► Geef de rij en leeg hem ─► Antwoord aan LaVega
```

Wat er ten opzichte van jouw versie veranderd is:

| Verandering | Waarom |
|---|---|
| `E-mail binnen` toegevoegd — POST, pad `lavega-mail-in` | Bevinding 1. De naam is niet vrij: `handler.ts` noemt hem in twee bounces. |
| `Normaliseer binnengekomen mail` toegevoegd | Vertaalt de JSON van de worker naar dezelfde vorm die Gmail levert, inclusief `deliveredTo`, `queueKey`, `senderCheck` en `senderChecks`. |
| `Zet in de wachtrij` toegevoegd, `Naar LaVega-vorm` erop aangesloten | Bevinding 3. Ook deze naam noemt `handler.ts` letterlijk. |
| `Melding: zelf ophalen` toegevoegd op de false-tak | Bevinding 7. |
| `LaVega vraagt de rij op`: POST → **GET** | Bevinding 4 — `n8n.ts` doet GET. |
| `LaVega vraagt de rij op`: Respond → **Using Respond to Webhook Node** | Bevinding 5. |
| Header Auth op **beide** webhooks | Bevinding 6. Alleen de keuze staat in het bestand, niet de waarde. |
| `allowedOrigins` gevuld | Zie hieronder. |
| Gmail-tak behouden | Jouw tak, jouw nodes. Twee dingen aangezet die er anders stilletjes voor zorgen dat er nooit een PDF meekomt (zie hieronder), en je zoekwoord `receipt` staat in de zoekopdracht. |

**`allowedOrigins`** staat op:
`https://lavega.dev, https://www.lavega.dev, https://lavegaweb-production.up.railway.app, http://localhost:5173`.
Dat is de oorzaak van je eerdere "geen antwoord van n8n": de browser stuurt vanwege
de header `x-lavega-token` eerst een preflight, en zonder toegestane origin
blokkeert hij het antwoord — waarna `fetchQueue` het als `network` rapporteert,
want een geblokkeerde preflight is voor `fetch` niet van een netwerkfout te
onderscheiden. Draai je op een andere poort of host, zet die er dan bij.
Op `E-mail binnen` staat er met opzet niets: de worker is geen browser en stuurt
geen preflight.

**Twee Gmail-instellingen die er in staan en die je moet laten staan:** *Simplify*
uit, en *Download Attachments* **binnen Options**. n8n leest alleen
`options.downloadAttachments`; zet je hem ernaast, dan bestaat de vlag niet en
komt er nooit een bijlage mee. Dat is in augustus gemeten: 768 invoer-tokens, geen
PDF. Staat uitgeschreven in `packages/core/src/n8n/normalizeGmailMessage.js`.

**Geen sleutels in het bestand.** De Anthropic-sleutel staat als expressie:
`{{ $env.FT_ANTHROPIC_KEY || $env.ANTHROPIC_API_KEY }}`. n8n leest
omgevingsvariabelen alleen bij het opstarten — herstart de service nadat je hem
gezet hebt. Het factuurtoken staat nergens in het bestand; dat is een
n8n-credential.

---

## Importeren en controleren

Negen stappen. Bij elke stap staat wat je moet zien als het goed is.

**1. Zet je huidige workflow uit.**
n8n → Workflows → je bestaande factuurworkflow → schakelaar rechtsboven op
**Inactief**. Hernoem hem naar `OUD — facturen (24 aug)` of verwijder hem.
*Je moet zien:* de schakelaar staat op inactief.
*Waarom:* twee actieve workflows kunnen niet hetzelfde pad claimen. Sla je deze
stap over, dan weigert de nieuwe te activeren en houd je precies de 404 die je nu
hebt.

**2. Importeer het nieuwe bestand.**
Workflows → **Import from File** → `docs/n8n/lavega-facturen-workflow.json`.
*Je moet zien:* 15 nodes, en linksboven twee losse ingangen (`E-mail binnen` en
`LaVega vraagt de rij op`) naast `Handmatig starten` en `Elk uur`.
De naam is met opzet gelijk gebleven aan die van je oude workflow
(`LaVega — facturen uit de mail`); *Verbind met n8n* in Koppelingen zoekt op die
naam.

**3. Hang de credentials erin.** Drie stuks:
- `Gmail: recente mail` → je Gmail-OAuth-credential.
- `E-mail binnen` → *Credential for Header Auth* → maak of kies
  `LaVega factuurtoken`, met **Name** `x-lavega-token` en als **Value** het geheim
  dat ook in `N8N_SHARED_SECRET` van de worker staat.
- `LaVega vraagt de rij op` → **dezelfde** credential.

*Je moet zien:* geen rood driehoekje meer op de drie nodes.
*Waarom dit de kritieke stap is:* laat je er één leeg, dan weigert n8n in stap 4
te activeren, en dan krijg je dezelfde 404 terug — met de tweede verklaring uit
bevinding 2 als oorzaak.

**4. Activeer.**
Schakelaar rechtsboven op **Actief** en **sla op**.
*Je moet zien:* de schakelaar blijft op actief staan en er verschijnt geen rode
melding. Springt hij terug: lees die melding, want daar staat welke node zijn
credential mist. Klik hem niet weg.

**5. Controleer allebei de paden met een `curl`.**
Vervang `$JOUW_N8N` en `$TOKEN`; zet ze in je shell, niet in een bestand.

```bash
# ophaalkant — moet 200 geven met {"invoices":[],"notices":[],"servedAt":"..."}
curl -i -H "x-lavega-token: $TOKEN" "$JOUW_N8N/webhook/lavega-facturen"

# intake — moet 200 geven met {"addedInvoices":0,"addedNotices":0,...}
curl -i -X POST -H "content-type: application/json" -H "x-lavega-token: $TOKEN" \
  -d '{"to":"test@invoices.lavega.dev","queueKey":"test","from":"jij@voorbeeld.nl","subject":"proef","date":"","messageId":"proef-1","text":"","html":"","attachments":[]}' \
  "$JOUW_N8N/webhook/lavega-mail-in"
```

*Je moet zien:* twee keer `HTTP/… 200`.
*Als je 404 krijgt:* de workflow is niet actief, of je gebruikt `/webhook-test/`
in plaats van `/webhook/`.
*Als je 403 krijgt:* het token klopt niet met de credential-waarde.
*Als de tweede 200 geeft maar geen `addedInvoices`:* `Respond` van `E-mail binnen`
staat niet op *When Last Node Finishes*.

**6. Zet de Worker om.**
De URL is veranderd van `lavega-facturen` naar `lavega-mail-in`:

```bash
cd apps/email-worker
pnpm dlx wrangler@4 secret put N8N_WEBHOOK_URL     # …/webhook/lavega-mail-in
pnpm dlx wrangler@4 deploy
```

*Je moet zien:* `wrangler` bevestigt de deploy. Plak de **Production URL** uit de
node `E-mail binnen` — niet de test-URL.

**7. Stuur één echte factuur door.**
*Je moet zien:* **geen bounce**. In n8n → Executions staat een run op `E-mail binnen`
die eindigt op `Zet in de wachtrij` met `addedInvoices: 1`.
*Krijg je wel een antwoord* met "aangekomen en volledig verwerkt, maar er is niets
aan de wachtrij toegevoegd": dat is geen storing maar een van de drie gevallen die
in dat bericht staan (betaalbewijs, al eerder ingestuurd, of niets factuurachtigs).
De run in Executions zegt welke van de drie.

**8. Haal op in de app.**
LaVega → *Facturen* → **Ophalen uit n8n**.
*Je moet zien:* de regel verschijnt.
*Zegt de app "geen antwoord van n8n":* open de browserconsole. Staat daar een
CORS-fout, dan mist jouw origin in `allowedOrigins` van `LaVega vraagt de rij op`
— zet hem erbij en sla op.

**9. De uurlijkse tak.**
Klik **Handmatig starten** en kijk in de run wat `Zet in de wachtrij` teruggeeft.
Klik nog een keer.
*Je moet zien:* de eerste keer `addedInvoices` groter dan 0, de tweede keer 0 met
hetzelfde getal bij `inQueue` — dat is de ontdubbeling uit bevinding 8.

### De bouncetekst als wegwijzer

`handler.ts` noemt bij elke weigering de echte oorzaak. Wat welke bounce betekent:

| In de bounce staat | Dat betekent |
|---|---|
| `gaf 404 op …` | de workflow staat niet op Actief, of dit is de test-URL |
| `weigerde de Worker (401/403)` | `N8N_SHARED_SECRET` ≠ de Value van de Header Auth-credential |
| `antwoordde met status … maar geen JSON` | `Respond` van `E-mail binnen` staat niet op *When Last Node Finishes* |
| `antwoordde zonder de telling {addedInvoices, addedNotices}` | de laatste node van de run is niet `Zet in de wachtrij` — meestal hangt er een tak los |
| `gaf status 500` | een node viel om; n8n → Executions laat zien welke |
| `was niet bereikbaar op …` | de URL klopt niet of n8n ligt eruit |

---

## Wat ik heb gedraaid, en wat niet

**Wel gedraaid, met uitkomst:**

- `packages/core` n8n-suite: **81 tests, 81 geslaagd** (7 bestanden).
- `apps/web`: `n8n.test.ts` + `facturen-n8n.test.tsx`: **57 tests, 57 geslaagd**.
- `node scripts/sync-n8n-code.mjs --check`: de bron-JSON loopt niet achter, dus de
  Code-nodes die ik heb overgenomen zijn de geteste versie.
- Ik heb de zes Code-nodes in het nieuwe bestand opnieuw opgebouwd uit
  `packages/core/src/n8n/` en vergeleken: **6/6 letterlijk identiek**.
- Ik heb `Zet in de wachtrij` en `Geef de rij en leeg hem` als losse functies
  gedraaid op een nagemaakte `$getWorkflowStaticData`, en het antwoord daarvan door
  `parseQueue` uit `apps/web/src/n8n.ts` gehaald: **1 rij, 0 meldingen, 0
  weggevallen**, rij daarna leeg. Ook de ontdubbeling en de `seenIds`-rem zijn zo
  gemeten (de uitvoer staat bij bevinding 8).
- Structuurcontroles op het nieuwe bestand: precies twee webhooks, precies één op
  GET (anders vindt `findQueueWebhookNode` hem niet), paden `lavega-facturen` en
  `lavega-mail-in`, Header Auth op allebei, geen node zonder ingang, geen node met
  een lege uitgang, beide takken van `Iets te lezen?` aangesloten, en een scan op
  iets dat op een sleutel lijkt: niets gevonden.

**Niet gedraaid — ik heb geen n8n om tegen te testen:**

- **Het bestand is niet geïmporteerd in een echte n8n.** Ik heb niet gezien of
  n8n de node-parameters accepteert zoals ze er staan, en niet of hij activeert.
- **Geen enkele webhook is echt aangeroepen.** De 200'en in stap 5 zijn wat ik
  verwacht, niet wat ik gemeten heb.
- **De CORS-preflight met Header Auth erop is niet getest.** Dit is wel de
  combinatie die `apps/web/src/n8n-provision.ts` zelf uitrolt (`bindWebhookNode`
  zet `authentication: "headerAuth"` én `allowedOrigins` op de ophaal-webhook),
  dus het is de vorm die de app al provisioneert — maar ik heb hem niet zien
  werken. Blijft stap 8 hangen op een CORS-fout, dan is dit de eerste verdachte.
- **Het exacte gedrag van `Respond to Webhook` onder `responseMode: lastNode`**
  heb ik niet gereproduceerd. Dat de twee niet samengaan staat in onze eigen
  `DOORSTUURADRES.md`; welke foutmelding n8n er precies bij geeft, weet ik niet.
- **De Gmail-node is niet gedraaid** — daar hoort een Google-credential bij.
- **Ik heb jouw JSON-bestand niet gezien**, alleen de beschrijving ervan. De
  bevindingen 1, 3 en 5 volgen uit die beschrijving; bevinding 4, 6 en 7 volgen uit
  onze eigen code en gelden ongeacht wat er precies in jouw export staat.
- **Ik kan niet zeggen welke van de vier oorzaken in bevinding 2 het is.** Stap 5
  haalt dat boven water.
