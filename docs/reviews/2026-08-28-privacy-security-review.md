# Privacy- en securityreview — 28 augustus 2026

Volledige review van de repo op `master` (`3eb9daa`), uitgevoerd door Claude op verzoek. Werkboom
schoon, 231 testbestanden groen op het moment van reviewen.

**Wat er gecontroleerd is:** secrets (werkboom + alle 2.659 blobs in de git-historie), de kluis-crypto,
elke server-route en wat hem bewaakt, de redactiegrenzen naar Anthropic, de e-mail/factuur-keten, de
browserextensie, XSS-sinks, opslag buiten de kluis, afhankelijkheden, CI, deploy-configuratie en het
privacybeleid tegen wat de code werkelijk doet.

**Wat er NIET gecontroleerd is:** er is geen enkel verzoek naar de productieomgeving gestuurd. Alle
conclusies over wat live staat komen uit de `Dockerfile` en de code, niet uit een test tegen de
draaiende server. Bevinding C1 en H2 horen door jou tegen de echte host bevestigd te worden voordat je
ze als feit aanneemt. Er is ook geen pentest gedaan en geen dependency-supply-chain-audit verder dan
`pnpm audit`.

---

## Status — bijgewerkt 31 augustus 2026

De review hieronder staat zoals hij op 28 augustus geschreven is. Wat er sindsdien
gerepareerd is, staat hier; de bevindingsteksten zelf zijn niet herschreven, zodat
de redenering van toen leesbaar blijft.

**C1 was echt, niet voorwaardelijk.** De review vroeg om het te controleren tegen de
draaiende host. Dat is op 31 augustus gedaan: `GET /api/brokers/credentials/status`
antwoordde onbevoegd met `{"status":"empty"}`. Het was dus de C1-tak — een vreemde
kon de brokerkluis claimen — en niet de H2-terugval.

| # | Status | Waar |
|---|---|---|
| **C1** | **Opgelost** — `/api/brokers/*` valt nu onder de sessiebewaking; de aanval uit de review geeft 401 | `apiGuard.ts` |
| **H1** | **Opgelost** — één `app.use("/api/*", apiGuard())` vóór alle route-registraties, dicht tenzij publiek of ingelogd. Rate limiter nu per beller per route (`rateLimitKey`) i.p.v. globaal | `apiGuard.ts`, `agent/rateLimit.ts` |
| **H2** | **Opgelost** — `/unlock` zit achter dezelfde bewaking; het orakel is niet meer anoniem bereikbaar | `apiGuard.ts` |
| **H3** | **Opgelost** — minimaal 12 tekens én tekenvariatie voor een NIEUWE kluis | `web/src/vaultPassword.ts` |
| **M3** | **Opgelost** — `secureHeaders()` + CSP, HSTS, `frame-ancestors 'none'`, `no-referrer` | `index.ts` |
| **M8** | **Opgelost** — registratie staat dicht tenzij `LAVEGA_ALLOW_SIGNUP=1` | `auth.ts` |
| H4, M1, M2, M4, M5, M6, M7, L1–L7 | **Nog open** | — |

**Afwijking van het advies, bewust.** H3 vroeg om een minimum bij `setup` *én* `restore`.
Alleen `setup` heeft het gekregen. `restore` en `unlock` controleren een wachtwoord dat
al bestaat; daar een minimum eisen sluit de eigenaar buiten een back-up die vóór deze
regel gemaakt is, en het houdt niemand tegen — de aanvaller met het bestand gebruikt
dit scherm niet.

**Wat de bewaking nodig heeft om iets te doen.** `verifiedSession` leunt op Better Auth,
en dat is op de productiehost níét geconfigureerd (`/api/auth/get-session` gaf 503).
De bewaking faalt dicht, dus zonder `DATABASE_URL` en `BETTER_AUTH_SECRET` op Railway
antwoordt elke niet-publieke route 401 — ook die van de eigenaar. Die twee variabelen
moeten er staan, met één account aangemaakt via een tijdelijke `LAVEGA_ALLOW_SIGNUP=1`,
vóór of tegelijk met het uitrollen hiervan.

Lokale ontwikkeling zet de bewaking uit met `LAVEGA_ALLOW_UNAUTHENTICATED=1`; die vlag
staat standaard uit, want een vlag die standaard openstaat zou precies de fout
terugbrengen die H1 beschrijft.

---

## Kort samengevat

De verdediging in de diepte is opvallend goed op de plekken waar je hem zelf hebt ontworpen: de
kluis-crypto klopt, de extensie is streng, er staat geen enkel geheim in de historie en er is in
120.000 regels geen enkele XSS-sink. Dat is een betere uitgangspositie dan de meeste codebases.

Het gat zit ergens anders, en het is één gat met veel gevolgen: **`verifiedSession` in
`apps/server/src/auth.ts:22` wordt nergens aangeroepen.** Better Auth is aangesloten op Neon
(`116b695`) maar bewaakt geen enkele route. Daardoor staat elke API open — inclusief de routes die
jouw Anthropic-sleutel uitgeven en, ernstiger, de brokerkluis van de investing-app die volgens de
`Dockerfile` wél meedraait in productie.

Zeven van de vijftien bevindingen verdwijnen als je één authenticatie-middleware voor `/api/*` zet.

| | Aantal |
|---|---|
| Kritiek | 1 |
| Hoog | 4 |
| Middel | 8 |
| Laag | 7 |

---

## Kritiek

### C1 — Een anonieme bezoeker kan de brokerkluis op je server claimen

`apps/investing-server/src/index.ts:38`

```
const status = await credentials.status();
if (status === "empty") await credentials.setup(input.passphrase);
else if (!(await credentials.unlock(input.passphrase))) throw new Error("Vault passphrase is incorrect");
```

`POST /api/brokers/credentials` heeft geen authenticatie. Staat er nog geen serverkluis, dan **maakt
deze route hem aan met het wachtwoord dat de aanvrager meestuurt**. Wie dan ook.

Dat dit productie raakt en niet alleen je laptop staat in de `Dockerfile`:

```
ENV INVESTING_WEB_DIST=/app/apps/investing-web/dist
ENV INVESTING_MOUNT=1
```

`shouldMountInvesting()` is daarmee waar, en `apps/server/src/index.ts:146-150` hangt
`/api/brokers/*` en `/api/investing/*` aan de publieke host. De credential-deps worden
onvoorwaardelijk bedraad in `createRuntimeApp` (`index.ts:231-233`), dus ze bestaan ook in de
samengevoegde Railway-build — `investing-mount.ts` geeft ze niet mee, maar dat maakt niet uit.

**Gevolg.** Een vreemde zet een wachtwoord op jouw kluis. Jouw eigen "Broker koppelen" antwoordt
daarna *"Vault passphrase is incorrect"* en je komt er niet meer in. Op Railway ligt dat bestand op
een persistent volume, dus het overleeft een herstart. En de credentials die er dan in staan zijn de
zijne, op jouw host.

**Voorwaarde.** Alleen als er nog géén kluis staat op die instance. Staat hij er wel, dan valt de
route terug op `unlock` en is dit H2 in plaats van C1. Controleer `GET /api/brokers/credentials/status`
op de echte host om te weten welke van de twee je hebt.

**Oplossing.** Authenticatie voor `/api/brokers/*` (zie H1). Als tussenoplossing vandaag:
`INVESTING_MOUNT=0` in de Railway-variabelen tot de auth staat — dat haalt de hele investing-mount
eraf, en de link is volgens backlog §4.1 toch nog verborgen.

---

## Hoog

### H1 — Geen enkele API-route is geauthenticeerd

`apps/server/src/auth.ts:22` definieert `verifiedSession`. Het is de enige plek in de repo waar die
naam voorkomt: hij wordt nooit aangeroepen.

Wat daardoor open staat op de publieke host:

| Route | Wat een vreemde ermee kan |
|---|---|
| `POST /api/agent/chat` | Jouw Anthropic-sleutel uitgeven (Sonnet 5 mét web search) |
| `POST /api/agent/extract-invoice` | Idem, met een PDF van 10 MB per verzoek |
| `POST /api/agent/categorize`, `/travel-facts` | Idem |
| `POST /api/eb/auth` | Autorisaties starten op jouw Enable Banking-app-credential |
| `GET /api/investing/summary`, `/dashboard` | De portefeuille lezen |
| `POST /api/brokers/credentials*` | Zie C1 en H2 |
| `DELETE /api/prices/cache` | De prijscache wissen |

De CORS-middleware (`apps/server/src/index.ts:74`) is zorgvuldig doordacht en echoot alleen een
loopback-origin terug — maar **CORS is geen authenticatie**. Het houdt browsers tegen, niet `curl`.
De redenering in de comment ("een open policy zou elke pagina op internet jouw sleutel laten
uitgeven") klopt precies; alleen dekt de gekozen maatregel de aanval niet af waar hij voor bedoeld is.

De rate limiter (`agent/rateLimit.ts`) is bovendien **globaal, niet per IP**: `limit("chat")` gebruikt
de routenaam als sleutel. Dat betekent twee dingen. Iemand anders kan 20 verzoeken per minuut op jouw
rekening doen, en diezelfde 20 sluiten jou buiten je eigen AI-functies.

**Oplossing.** Eén middleware vóór de route-registraties:

```ts
app.use("/api/*", async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();      // /api/rates, /api/fx/rate, /api/auth/*
  if (!(await verifiedSession(c.req.raw))) return c.json({ error: "unauthorized" }, 401);
  await next();
});
```

En de rate limiter op IP + route in plaats van route alleen.

### H2 — `POST /api/brokers/credentials/unlock` is een open wachtwoord-orakel

`apps/investing-server/src/app.ts:164`. Geen authenticatie, geen rate limiting, geen lockout. 401 bij
fout, 204 bij goed — precies de twee antwoorden die een brute-force nodig heeft.

De enige rem is PBKDF2 met 210.000 iteraties (~0,2 s per poging serverkant). Dat is een echte rem,
maar het is er één die jouw CPU betaalt: het is tegelijk een goedkope DoS op je eigen server.

**Oplossing.** Auth (H1), plus een aparte teller per IP op deze route met een oplopende wachttijd.

### H3 — Een wachtwoord van één teken maakt een geldige kluis

`apps/web/src/components/VaultGate.tsx:95`

```ts
const canSubmit = pass1.length > 0 && pass1 === pass2 && understood && !busy;
```

`length > 0` is de hele eis. Geen minimum, geen sterktemeter, geen zxcvbn.

Dat ondermijnt de crypto eronder, die verder goed is. Het dreigingsmodel van deze kluis is een
**offline** aanval: het `.lavega`-backupbestand is expliciet bedoeld om gedownload en ergens bewaard
te worden, en `export()` geeft het blob mee. Wie dat bestand heeft, kan onbeperkt raden. Bij 210k
iteraties is een viercijferige pincode in seconden om, een woord uit een woordenboek in minuten.

**Oplossing.** Minimaal 12 tekens afdwingen bij `setup` én `restore`, met een sterktemeter die de
reden noemt. Overweeg de PBKDF2-vloer te verhogen of naar Argon2id te gaan — maar het wachtwoord is
hier de zwakke schakel, niet de KDF.

### H4 — Het privacybeleid klopt niet meer met wat de app doet

`apps/server/src/legal.ts`, `UPDATED = "2026-08-03"`. De header van dat bestand zegt zelf: *"Content
reflects how LaVega actually works. Keep this truthful."* Dat is sinds 3 augustus niet meer zo.

Wat er staat:

> De LaVega-server is een dunne tussenlaag die alleen: (a) de Enable Banking-autorisatie uitvoert
> [...] en (b) publieke, niet-persoonlijke spaarrentes ophaalt.

> **Derden:** Enable Banking — banktoegang. Railway — hosting.

Wat de code doet en het beleid niet noemt:

| Ontvanger | Wat er heen gaat | Waar |
|---|---|---|
| **Anthropic** | Hele factuur-PDF's; transactieomschrijvingen mét tegenpartijnaam; chatcontext met saldi, rekeningtypes, abonnementen, facturen, btw-instellingen | `agent-routes.ts`, 5 routes |
| **Cloudflare** | Elke binnenkomende factuurmail, volledig | `apps/email-worker` |
| **n8n** | Diezelfde mail plus bijlagen | `handler.ts:257` |
| **Google (Apps Script)** | E-mailadressen van de wachtlijst | `views/Landing.tsx:9` |
| **Frankfurter** | Valutaparen (publiek, niet persoonlijk) | `fx.ts` |
| **Sentry** | Optioneel, foutcontext | `observability.ts:39` |

Ook de zin *"[je financiële gegevens] worden nooit naar servers van LaVega gestuurd"* is niet meer
letterlijk waar: transactieomschrijvingen, factuurdocumenten en chatcontext gaan wél langs je server,
op weg naar Anthropic. Ze zijn geredigeerd en er is toestemming voor gevraagd — maar dat is een ander
verhaal dan "nooit".

Dit is geen technisch lek. Het is wel de bevinding die het meest botst met waar dit project op staat,
en het beleid is een geregistreerd artefact bij je Enable Banking-aanvraag. Onder de AVG is een
onvolledige verwerkersopsomming bovendien een echt probleem, zeker met Anthropic als verwerking
buiten de EU.

**Oplossing.** Beleid herschrijven naar de werkelijkheid van vandaag, met per verwerker wat er heen
gaat en waarom, en de AI-functies expliciet als opt-in beschreven (wat ze in de code ook zijn).

---

## Middel

### M1 — De OAuth-`state` wordt gemaakt en weggegooid, maar nooit gecontroleerd

`apps/server/src/eb-routes.ts`. Vier regels vertellen het hele verhaal:

```
21:  const pending = new Map<string, PendingAuth>();
69:  sweep(pending, PENDING_TTL_MS);
84:  pending.set(state, { name, country, ts: Date.now() });
100: if (state) pending.delete(state); // one-shot
```

`pending` wordt geschreven en geleegd. Er wordt **nooit uit gelezen.** Er staat nergens
`if (!pending.has(state)) return error`, dus de `state` doet precies niets — terwijl dat de enige
reden is dat hij bestaat.

Daarmee is de callback CSRF-gevoelig: een aanvaller kan zijn eigen autorisatie starten, zijn `code`
bemachtigen en jou naar `/api/eb/callback?code=<zijn code>` sturen. Jouw server wisselt hem in en jouw
app trekt *zijn* rekeninggegevens je kluis in.

`eb-routes.ts` is bovendien het enige route-bestand van de server **zonder testbestand**, wat
waarschijnlijk verklaart waarom dit niet is opgevallen.

**Oplossing.** In de callback: `const p = state && pending.get(state); if (!p) return c.redirect(...)`
— en pas daarna inwisselen.

### M2 — Het `session_id` reist als URL-parameter

`eb-routes.ts:110` redirect naar `/?eb=<sessionId>`, en `/api/eb/accounts?session_id=…` levert daarop
de **rauwe bank-JSON: saldi plus 365 dagen transacties**, zonder verdere controle.

Een bearer-token in een URL komt terecht in browsergeschiedenis, in `Referer`-headers en in de
access-logs van Railway. De mitigaties die er zijn (eenmalig, TTL van 60 minuten, UUID-entropie) zijn
reëel, maar de plek klopt niet.

**Oplossing.** Het token in een `HttpOnly; Secure; SameSite=Strict` cookie zetten in plaats van in de
URL, of het per POST laten ophalen. Zie ook M3 — zonder `Referrer-Policy` is het lek naar buiten toe
het grootst.

### M3 — Geen enkele securityheader

Nergens in `apps/server`, `vercel.json`, `railway.json` of de `Dockerfile` staat een
`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`
of `Referrer-Policy`.

Voor een app die banktransacties in de browser houdt en een n8n-API-sleutel in `localStorage` (M4),
is CSP de goedkoopste verdediging die er niet is. Zonder `frame-ancestors`/`X-Frame-Options` is het
ontgrendelscherm van de kluis bovendien clickjackbaar.

Het contrast is scherp: de **extensie** heeft een voorbeeldige CSP (`default-src 'none'`,
`connect-src 'none'`). De webapp heeft er geen.

**Oplossing.** `secureHeaders()` uit `hono/secure-headers`, plus een CSP die `connect-src` beperkt tot
je eigen origin.

### M4 — n8n-API-sleutel en -token staan in platte `localStorage`

`apps/web/src/settings.ts:217` (`lavega.n8nApiKey`), `:174` (`lavega.n8nInvoiceToken`).

De comment erboven wéégt dit expliciet af — niet in de kluis, want dan reist de sleutel mee in een
backupbestand; niet naar de server, want dan staat een workflow-wijzigende sleutel op een gedeelde
host. Beide redenen kloppen. Alleen is de gekozen derde optie de zwakste van de drie: platte tekst,
leesbaar voor elke `document.cookie`-achtige toegang die één XSS oplevert.

Dat er in de hele codebase geen XSS-sink staat (zie *Wat er goed staat*) maakt dit vandaag klein. Het
maakt het niet nul: de sleutel kan volgens de comment zelf workflows aanmaken en wijzigen.

**Oplossing.** De vierde optie die niet is overwogen: versleutelen onder de kluissleutel en uitsluiten
van het export-blob. Dan is hij beschermd én reist hij niet mee in een backup.

### M5 — De redactiegrenzen op de server controleren vorm, niet inhoud

`apps/server/src/agent/chatContext.ts:33-41`:

```ts
for (const k of allow) if (k in r) out[k] = r[k];
```

De comment noemt dit *"de chat-redactiegrens"*. Het is een allowlist op **sleutelnamen**; de waarde
eronder wordt ongewijzigd overgenomen, tot 60 KB JSON. Voor `rekeningen: ["accounts"]` gaat dus door
wat de client ook maar in `accounts` zet.

Hetzelfde patroon bij `categorize.ts:14`: de server laat `{id, text, sign}` door, maar het schrappen
van IBANs, bedragen en datums gebeurt in `redactForAi` — in de **browser** (`packages/core`). De
server controleert niet of het gebeurd is.

De echte client is hier netjes: `apps/web/src/agent/tabContext.ts:131` projecteert `accounts` naar
`{bank, type, entity, balance}` en laat IBANs weg. De eigenschap rust dus volledig op clientcode. Met
H1 erbij (iedereen mag posten) betekent dat: de grens is een afspraak, geen controle.

**Oplossing.** `redactForAi` ook serverkant draaien in `sanitizeCategorizeInput`, en voor chat per
sleutel een veld-allowlist in plaats van de waarde overnemen.

### M6 — De e-mailworker laat elke afzender door

`apps/email-worker/src/handler.ts`. De beslissingsketen is: config aanwezig → lokaal deel aanwezig →
groottecap → parsebaar → bijlagecaps → doorsturen naar n8n. `parseAuthResults` wordt op regel 176 wél
uitgelezen, maar alleen **meegestuurd** in de payload — nooit gebruikt om te weigeren.

Wie het adres kent (`<naam>-<code>@invoices.lavega.dev`) kan dus mail in de pijplijn krijgen, en dat
adres is een capability-secret dat ook in platte `localStorage` staat (`settings.ts:295`).

**Wat de schade beperkt, en dat is goed werk:** `autoBookDecision` (`apps/web/src/n8n.ts:409`) eist
`senderCheck === "passed"` vóór hij iets automatisch boekt, met een doordachte behandeling van het
SPF-faalt-DKIM-slaagt-patroon van doorgestuurde mail, en een plafond van € 10.000 als laatste rem.
Een gespoofte factuur boekt zichzelf dus niet.

Wat overblijft: een vreemde kan je Facturen-wachtrij vullen met plausibele nepfacturen die op jouw
handmatige bevestiging wachten, en elke bijlage kost een Claude-extractie op jouw sleutel. Dat is
phishing met jouw eigen reviewscherm als bezorgkanaal.

**Oplossing.** In de Worker weigeren bij `dmarc !== "pass"` (of minstens bij een harde SPF-fail zónder
geldige DKIM), vóór de fetch naar n8n.

### M7 — De kluis vergrendelt zichzelf nooit

`storage.lock()` wordt aangeroepen op precies één plek: `App.tsx:393`, de knop "Vergrendel". Er is
geen inactiviteitstimer, geen `visibilitychange`-handler, geen vergrendeling bij het sluiten van het
tabblad.

De sleutel staat alleen in geheugen en verdwijnt bij het sluiten van de pagina, dus dit is beperkt tot
één scenario: een open tabblad op een onbeheerde machine. Voor een app met banktransacties erin is dat
scenario reëel genoeg om te noemen.

**Oplossing.** Automatisch vergrendelen na 15 minuten inactiviteit, met een waarschuwing ervoor.

### M8 — Registratie staat open op `/api/auth/*`

`apps/server/src/auth.ts:17`: `emailAndPassword: { enabled: true }`, zonder
`requireEmailVerification` en zonder `disableSignUp`. Better Auth staat live op de publieke host en
schrijft naar je Neon-database.

Omdat geen enkele route de sessie controleert (H1) levert een account nu niets op — maar het is wel
een open schrijfpad naar je database, zonder rate limiting en zonder e-mailverificatie.

**Oplossing.** Zolang de app op de wachtlijst staat: `disableSignUp: true`, of een allowlist op je
eigen adres.

---

## Laag

| # | Bevinding | Waar |
|---|---|---|
| **L1** | `hono` staat op 4.12.32, de adviezen vragen ≥ 4.12.34 (vier CVE's: ReDoS in CORS, `memo()`-datalek tussen requests, DoS in Language middleware, Proxy-helper headers). **Praktische impact laag** — je gebruikt `hono/cors` niet (CORS is met de hand geschreven) en `memo()` evenmin. Twee patchversies. | `apps/server/package.json` |
| **L2** | `country` wordt ongevalideerd in een URL geïnterpoleerd: `` `/aspsps?country=${country}&psu_type=…` ``. `.toUpperCase()` weert geen `&` of `#`, dus parameter-injectie richting Enable Banking is mogelijk. | `eb-routes.ts:54` |
| **L3** | CI-actions op muteerbare tags (`actions/checkout@v4`) terwijl de job `contents: write` heeft. Een gekaapte tag kan naar je repo schrijven. Verder is de workflow netjes: geen secrets, `git add` op precies twee bestanden, concurrency-guard. | `.github/workflows/catalog-sweep.yml` |
| **L4** | `.dockerignore` sluit `**/.lavega` niet uit, `.vercelignore` wel. Een lokale brokerkluis kan zo in het productie-image belanden (versleuteld, maar hij hoort er niet). | `.dockerignore` |
| **L5** | Het wachtlijst-endpoint (Google Apps Script) heeft geen captcha of rate limiting — iedereen kan de sheet vollopen. | `views/Landing.tsx:9` |
| **L6** | `lavega.n8n.autoBooked.v1` bewaart factuuronderwerpen in platte `localStorage`, buiten de kluis. De comment erkent het als workaround. | `n8n.ts:484` |
| **L7** | `redactForAi` vangt de spatiegegroepeerde IBAN-vorm bewust niet ("NL91 ABNA 0417 1643 00"), gemeten op jouw eigen exports. Correct voor jouw data; het breekt zodra een andere bank of een andere gebruiker die vorm wel print — de comment zegt dat zelf. | `packages/core/src/categorize.ts:118` |

---

## Wat er goed staat

Dit hoort in dezelfde review, want het is niet vanzelfsprekend.

- **Geen enkel geheim in de historie.** Alle 2.659 blobs in alle revisies gescand op sleutelformaten
  (Anthropic, AWS, GitHub, Slack, npm, GitLab), op private keys en op connection strings met
  wachtwoord. Nul treffers. `.gitignore`, `.dockerignore` en `.vercelignore` sluiten `.env` en `*.pem`
  correct uit.
- **Geen enkele XSS-sink in ~120.000 regels.** Geen `dangerouslySetInnerHTML`, geen `innerHTML`, geen
  `insertAdjacentHTML`, geen `eval`, geen `new Function`, geen `srcdoc`. In een React-codebase van
  deze omvang is dat zeldzaam.
- **De kluis-crypto klopt.** AES-GCM-256, een verse 12-byte IV per blob, PBKDF2-SHA256 met 210.000
  iteraties, niet-exporteerbare sleutels, en — dat is het detail dat opvalt — een **vloer** op
  `iterations` die een gemanipuleerd blob tegenhoudt dat de afleiding goedkoop wil maken. Die aanval
  is voorzien voordat iemand hem uitvoerde. De schrijf-serialisatie in `encryptedStorage.ts` met de
  uitleg waaróm (stale snapshot die de blob terugdraait) is net zo goed.
- **De extensie is het strengst getimmerde deel van het project.** `host_permissions: []` — bij
  installatie wordt er niets gevraagd; alles is optioneel en wordt pas op het moment zelf gevraagd.
  De CSP van de extensiepagina's staat op `default-src 'none'` mét `connect-src 'none'`, dus ze kunnen
  fysiek geen verzoek doen. De build controleert de bundel zelf op netwerkverkeer (29 bestanden,
  8 patronen betrapt in de zelftest). Het paneel hangt in een `closed` shadow root met twee
  onderbouwde redenen. En `hostVanAfzender` (`background.ts:273`) valideert https, poort, `origin` én
  `tab.url` tegen elkaar.
- **`mailUrl` is scheme-gevalideerd** (`n8n.ts:160`, `startsWith("https://mail.google.com/")`) — de
  enige `href` in de app die uit een externe bron komt, en precies die is afgedicht.
- **`autoBookDecision`** eist DMARC-pass, één entiteit, complete extractie en een plafond van
  € 10.000, in die volgorde, met de uitleg waarom het plafond als laatste staat.
- **Loggen is schoon.** Zes `console`-regels in beide servers samen, geen PII, plus een
  `redactProblem` die sleutels en bearer-tokens uit foutcontext haalt vóór Sentry.

---

## Volgorde die ik zou aanhouden

1. **Vandaag** — `INVESTING_MOUNT=0` op Railway. Haalt C1 en H2 van het net terwijl je de rest bouwt,
   en kost niets: de link is toch verborgen.
2. **Deze week** — de auth-middleware voor `/api/*` (H1). Ruimt C1, H2 en het grootste deel van M8 op.
   Rate limiter meteen op IP + route.
3. **Deze week** — minimumlengte op het kluiswachtwoord (H3) en `secureHeaders()` + CSP (M3). Allebei
   klein, allebei blijvend.
4. **Voor de eerste externe gebruiker** — het privacybeleid herschrijven (H4). Dit moet af zijn vóór
   iemand anders dan jij een account heeft, niet erna.
5. **Daarna** — M1 (`state` valideren, mét het testbestand dat `eb-routes.ts` nog niet heeft), M6
   (DMARC-poort in de Worker), M5 (redactie ook serverkant), M2, M4, M7.
6. **Los** — `pnpm up hono` en de L-rij.
