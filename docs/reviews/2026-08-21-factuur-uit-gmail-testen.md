# Een factuur uit zijn Gmail door de keten — testplan

Review-4 item **32**: *"Nog te reviewen. Hij wil een plan om te testen met een factuur die nu in zijn
Gmail staat."*

Geschreven op **21 augustus 2026**. De stand van zaken die dit plan aanneemt: de weg naar binnen is
het **doorstuuradres met n8n**, niet Gmail. Er is geen Gmail-koppeling en dus ook geen
afzendercontrole zonder doorstuuradres — er is dan namelijk geen adres waar iets op aankomt. Zijn
cofounder heeft de Cloudflare-kant gedaan.

**Wat hieronder gemeten is en wat afgeleid.** Ik heb geen mail verstuurd — er is dus niets van de
echte keten door mij gelopen. Wat ik wél zelf heb gedraaid staat in §3.3 (de nepwachtrij, met de
uitkomst erbij, en die uitkomst is niet wat je hoopt). Al het andere is afgeleid uit de code die in
deze repo staat: `packages/core/src/n8n/normalizeInboundMail.js`, `apps/web/src/n8n.ts`,
`packages/core/src/tax.ts` en `packages/core/src/invoices.ts`. Waar iets pas bij de eerste echte mail
kan blijken, staat dat er met zoveel woorden bij.

---

## 0. De drie wegen, en wat elk ervan bewijst

| | Weg | Bewijst | Bewijst **niet** | Voorbereiding |
|---|---|---|---|---|
| **1** | De factuur doorsturen naar het doorstuuradres | de **echte keten**: Cloudflare → Worker → n8n → Claude → wachtrij → app, inclusief SPF/DKIM en de auto-boekpoort | niets over de leverancier — zie §2.2 | Cloudflare-route + n8n actief (cofounder) |
| **2** | De nepwachtrij met `--rows` | de **app-helft** met zijn eigen cijfers: de poort, het label "automatisch", terugdraaien, koppelen aan een banktransactie | niets van de mailketen | een JSON-bestand buiten de repo, en de fix uit §3.3 |
| **3** | De PDF in **Facturen** slepen | de **extractie**: leest het model de tegenpartij, het bedrag, de datums en de btw goed uit? | de afzendercontrole helemaal niet, en de poort ook niet | de schakelaar "AI-facturen lezen" aan |

Ze zijn niet uitwisselbaar en ze zijn ook geen volgorde-met-één-winnaar. Als je één avond hebt:
**doe weg 3 eerst** (dertig seconden, en je weet meteen of het model zijn factuur kan lezen), dan
**weg 1** (de enige die de keten bewijst), en houd **weg 2** achter de hand voor het moment dat weg 1
struikelt en je wilt weten of het aan de mail ligt of aan de app.

---

## 1. Drie dingen vooraf, anders vertroebelt elke uitkomst

**a. De kluis moet open zijn en je moet weten op welke onderneming er geboekt wordt.**
Bij precies één onderneming is dat die ene; bij géén is dat de standaard van de app (alles staat op
jou); bij meer dan één boekt LaVega **niets** automatisch en kies je zelf. Onthoud welke naam het
wordt — §5 heeft hem nodig.

**b. Koppelingen moet gevuld zijn.** *Koppelingen → Webhook-URL + Token.* Staat één van beide leeg,
dan haalt `fetchQueue` niets op en zegt het scherm dat ook. Dit geldt voor weg 1 én weg 2; bij weg 2
zet je er de URL van de nepwachtrij in.

**c. Eén `messageId` is één kans.** Zodra je een regel bevestigt óf weigert, gaat zijn `messageId`
in `lavega.n8nHandledMessageIds` en komt hij **nooit meer terug** — ook niet als n8n hem opnieuw
aanbiedt. Dat is met opzet zo (de Gmail-tak loopt elk uur over dezelfde zeven dagen), maar het is de
val waar je bij testen als eerste in stapt: je test twee keer met dezelfde rij en de tweede keer
gebeurt er niets.

> **Test je opnieuw, verzin dan een nieuw `messageId`.** Bij de nepwachtrij typ je dat zelf. Bij de
> echte keten stuur je de mail opnieuw door — dan is het een nieuw bericht met een nieuwe id.
> Wil je met een schone lei beginnen: verwijder `lavega.n8nHandledMessageIds` uit localStorage.

---

## 2. Weg 1 — doorsturen naar het doorstuuradres

Dit is de enige weg die de hele keten test. Alles wat er onderweg misgaat, gaat ook in productie mis.

### 2.1 Wat je doet

1. Zoek in Gmail de factuurmail op. **Eén mail, met de PDF eraan.**
2. Klik **Doorsturen** — de gewone knop. **Niet** "Doorsturen als bijlage". De Worker pakt
   `message/rfc822` niet uit, dus bij "als bijlage" komt de PDF niet mee. Dat is zichtbaar (er staat
   dan geen bijlage in de melding), maar je bent een ronde kwijt.
3. Stuur hem naar het adres dat in Cloudflare geroute wordt. In de app staat dat adres onder
   *Koppelingen → Doorstuuradres voor facturen*. Let op het commentaar dat daar in de code bij staat:
   het adres dat Cloudflare routeert is **`invoices@lavega.dev`** — niet het
   `lavega-<random>@invoices.lavega.dev` dat LaVega zelf kan genereren. Typ het adres in dat je
   cofounder heeft aangemaakt; laat de generator staan.
4. Open **Facturen** en klik **Ophalen uit n8n**. (Het scherm haalt ook zelf op bij openen en daarna
   elke paar minuten; de knop is voor ongeduld.)

### 2.2 Wat de afzendercontrole dan ziet — en dit is het eerlijke deel

**Doorsturen vanuit Gmail verandert de afzender.** De mail die bij Cloudflare aankomt komt van jou,
niet van de leverancier. De leverancier zit in de **PDF** en komt als `counterparty` in de regel
terecht — die kant klopt gewoon. Maar `senderCheck` gaat over de **envelop**, en die is van jou.

De poort werkt zo (`senderCheckOf` in `packages/core/src/n8n/normalizeInboundMail.js`):

```
één van spf/dkim/dmarc is fail, softfail of permerror  → 'failed'
anders: spf === 'pass' OF dkim === 'pass'              → 'passed'
anders                                                 → 'unknown'
```

En `autoBookDecision` (`apps/web/src/n8n.ts`) laat alleen `'passed'` door, plus: geen open vraag over
de onderneming, een complete factuur, en een bedrag onder € 10.000.

**Handmatig doorsturen (de knop).** Je verstuurt een nieuw bericht vanaf je eigen adres via Google.
SPF en DKIM gaan dan over **jouw** domein en die staan bij Google in orde. De verwachte uitkomst is
dus `'passed'` — en als de rest klopt, **boekt de factuur zichzelf**. Wat er dan geverifieerd is, is
dat de mail echt van jou kwam. Over de leverancier zegt het **niets**.

> Is dat erg? Nee, maar het moet gezegd worden. De poort bestaat omdat wie het doorstuuradres kent
> iets in je boeken kan proberen te krijgen. Een mail die aantoonbaar van jou komt, is precies wat
> die poort wil doorlaten. Alleen: lees de badge "automatisch" dan als *"jij hebt dit doorgestuurd"*
> en niet als *"deze leverancier is echt"*. De code heet daarom nergens `verified`.

**Een Gmail-filter dat automatisch doorstuurt is een ander geval, en waarschijnlijk een lastiger.**
Dan blijft `From:` de leverancier terwijl de verzendende server Google is. Staat Google niet in het
SPF-record van die leverancier, dan komt er `fail` of `softfail` uit — en `senderCheckOf` kijkt
**eerst** naar de slechte uitslagen, dus dan is het `'failed'`, óók als DKIM van de leverancier het
doorstaande signaal geeft. De factuur wacht dan op je met deze melding:

> *"De afzender kwam niet door de SPF/DKIM-controle (SPF …, DKIM …, DMARC …). Dat kan een slordig
> ingesteld domein zijn óf een nagemaakte afzender — daarom boekt LaVega deze niet zelf."*

En dan noemt die melding twee oorzaken waarvan er **geen enkele de echte is**: de echte oorzaak is
het doorsturen zelf. Dat botst met de huisregel dat een melding de echte oorzaak noemt.

**Ik heb dit niet gemeten** — er is geen mail verstuurd, en welke `Authentication-Results`-header
Cloudflare precies meestuurt is sowieso pas bij de eerste echte mail te zien. Zo stel je het vast, in
één blik:

> n8n → **Executions** → de nieuwste run van *LaVega — facturen* → node **Normaliseer binnengekomen
> mail** → veld `senderChecks`.
>
> - `spf: pass` en het domein is **jouw** domein → handmatig doorgestuurd, dit is het verwachte geval;
> - `spf: softfail/fail` mét `dkim: pass` → dat is de doorstuur-handtekening. Meld dat aan de
>   hoofdsessie: de tekst van de melding klopt dan niet en dat is een echte bevinding, geen
>   ongemak;
> - drie keer `unknown` → Cloudflare zet de header niet zoals aangenomen. Dan is er geen controle
>   geweest, boekt er niets automatisch, en dat is de juiste uitkomst.

### 2.3 Waar je kijkt als er niets verschijnt

Loop `docs/n8n/DOORSTUURADRES.md` af, sectie *"Wat je bij de eerste doorgestuurde factuur nakijkt"* —
die vijf stappen staan er al en ik herhaal ze hier niet. De volgorde is wat telt, want elke stap
wijst een andere knop aan:

1. `wrangler tail` — heeft de Worker de mail gezien? Zo niet: het ligt aan Email Routing, niet aan de
   Worker.
2. n8n Executions → *Normaliseer binnengekomen mail* — `textChars` niet 0, `pdfs` één regel,
   `skipped` leeg, `deliveredTo`/`queueKey`/`senderChecks` gevuld.
3. *Bouw Claude-verzoek* → `sent.documents` hoort **1** te zijn. Blijft die 0 terwijl er een PDF in
   zat, dan is de bijlage in de Worker afgevallen en staat de reden in `skipped`.
4. *Zet in de wachtrij* → `{addedInvoices, …}`.
5. Facturen → **Ophalen uit n8n**.

**Kwam er een bounce?** Lees hem — elke bounce noemt zijn oorzaak bij naam, en de vijf die je in het
begin kunt verwachten staan met vertaling in dezelfde `DOORSTUURADRES.md`.

**Wil je later een Gmail-filter aanzetten:** Gmail wil het doorstuuradres eerst bevestigd hebben en
stuurt daar een verificatiecode naartoe. Die code komt bij deze opzet in **n8n** terecht, niet in je
inbox — n8n → Executions → de body van *E-mail binnen*. Voor de test van vanavond heb je dat filter
niet nodig; handmatig doorsturen vraagt geen bevestiging.

---

## 3. Weg 2 — de nepwachtrij met `--rows`

`scripts/fake-invoice-queue.mjs` vervangt alleen de laatste schakel: hij antwoordt op precies
dezelfde GET met dezelfde tokenheader als n8n. Daarmee test je de poort, de badge, het terugdraaien
en het koppelen aan een banktransactie **zonder mailketen** — en met je eigen cijfers.

### 3.1 Het bestand met je eigen factuur

**Zet het buiten de repo** (Downloads is prima). Een echte factuur draagt de naam van een echte
leverancier en een echt bedrag, en die horen hier niet thuis.

```json
[{
  "messageId": "eigen-2026-08-21-a",
  "subject": "Factuur 2026-0455",
  "from": "facturen@jouwleverancier.nl",
  "senderCheck": "passed",
  "senderChecks": { "spf": "pass", "dkim": "pass", "dmarc": "pass" },
  "invoiceNumber": "2026-0455",
  "issueDate": "2026-08-04",
  "dueDate": "2026-09-03",
  "amountCents": 24200,
  "vatCents": 4200,
  "currency": "EUR",
  "counterparty": "Jouw Leverancier B.V.",
  "direction": "expense"
}]
```

Drie dingen om te weten bij het invullen:

- **Laat je een veld weg, dan is het ONBEKEND en niet nul.** De app laat die factuur dan wachten en
  zegt wat er ontbreekt. Dat is precies wat je wilt zien, dus laat er bewust eens één weg.
- **`senderCheck` zet je zelf.** Bij de echte keten komt die van Cloudflare; hier speel je hem na.
  Dat is de reden dat deze weg de afzendercontrole *niet* test — je vertelt de app het antwoord.
- **`direction`** is `"expense"` voor een inkoopfactuur en `"income"` voor een verkoopfactuur.
  Alles wat niet letterlijk `"income"` is, wordt inkoop. Dat is in §5 belangrijk.

### 3.2 Starten

```bash
node scripts/fake-invoice-queue.mjs --rows ~/Downloads/mijn-factuur.json
```

Dan in *Koppelingen*: URL `http://127.0.0.1:8791/queue`, token `testtoken`.
Bij een onleesbaar bestand **stopt** het script in plaats van terug te vallen op de voorbeeldrijen —
anders zou je een geslaagde test zien van gegevens die niet van jou zijn.

### 3.3 GEMETEN: zo werkt dit vandaag niet vanuit de browser

Dit heb ik wél zelf gedraaid, en het valt om op de CORS-preflight.

`fetchQueue` stuurt de header `x-lavega-token`. Dat is geen veilige standaardheader, dus de browser
stuurt er eerst een `OPTIONS`-verzoek voor uit — **zonder** die header, want dat is hoe een preflight
werkt. De nepwachtrij controleert het token vóór alles, ziet er geen, en antwoordt 401 zonder één
CORS-header. Daarmee zakt de preflight en komt de echte GET nooit op de lijn.

*(Gedraaid op poort 8799 via `FAKE_QUEUE_PORT`, om niets te verstoren dat op 8791 stond. De poort
doet er niet toe; de 401 wel.)*

```
$ curl -i -X OPTIONS http://127.0.0.1:8799/queue \
    -H "Origin: http://localhost:5173" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: x-lavega-token"
HTTP/1.1 401 Unauthorized
content-type: application/json
{"error":"verkeerde of ontbrekende x-lavega-token"}

$ curl -i http://127.0.0.1:8799/queue -H "x-lavega-token: testtoken"
HTTP/1.1 200 OK
access-control-allow-origin: *
access-control-allow-headers: x-lavega-token, content-type
```

Met curl dus 200, vanuit de browser niets. Wat je op je scherm ziet is:

> *"Geen antwoord van n8n — netwerk, verkeerde URL, of allowedOrigins staat deze pagina niet toe."*

Drie oorzaken, en de echte staat er niet bij. Ga daar dus niet op zoeken.

**Wat er moet gebeuren.** Het is drie regels in `scripts/fake-invoice-queue.mjs`, boven de
tokencontrole — dat bestand is van een andere lane, dus dit is een verzoek aan de hoofdsessie en geen
wijziging die ik heb aangebracht:

```js
if (req.method === "OPTIONS") {
  // Een preflight draagt de tokenheader NIET — dat is precies wat hij komt vragen.
  // Hem afwijzen op een ontbrekend token betekent dat de echte GET nooit vertrekt.
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "x-lavega-token, content-type",
    "access-control-allow-methods": "GET, OPTIONS",
  });
  res.end();
  return;
}
```

**En test deze weg tegen de lokale dev-server** (`http://localhost:5173`), niet tegen de pagina op
Railway. Een https-pagina die naar `127.0.0.1` grijpt loopt tegen een extra browserregel aan
(private network access) die ik hier niet heb kunnen meten. Eén onbekende tegelijk.

### 3.4 Wat je varieert, en wat je dan hoort te zien

Eén factuur per run, `messageId` elke keer anders:

| Wat je verandert | Verwachte uitkomst |
|---|---|
| alles compleet, `senderCheck: "passed"`, bedrag onder € 10.000 | **boekt zichzelf**, badge "automatisch", en **Terugdraaien** zet hem op geannuleerd — hij valt uit de forecast zonder dat het record verdwijnt |
| `senderCheck: "failed"` | wacht, met de SPF/DKIM-uitslagen in de melding |
| `senderCheck` weglaten | wacht: *"Bij deze mail is geen afzendercontrole gedaan."* Geen controle is geen goedkeuring |
| `currency: ""` | wacht: een lege valuta wordt nooit stilletjes EUR |
| `dueDate: null` | wacht op de vervaldatum — en dan komt het bedragplafond niet eens aan de beurt |
| `amountCents` boven 1.000.000 | wacht op de hoogte, óók bij een geverifieerde afzender |
| staat er al een betaling in je transacties die bij het bedrag past | de factuur wordt **vanzelf gekoppeld** — dat gebeurt nu bij elke boeking, niet pas bij de volgende import |

### 3.5 Wat deze weg níet bewijst

De mailketen. Werkt weg 2 en weg 1 niet, dan zit het probleem in Cloudflare, de Worker of n8n — en
dan hoef je in de app niet meer te zoeken. Dat is de hele reden dat dit script bestaat.

---

## 4. Weg 3 — de PDF in Facturen slepen

De snelste van de drie, en de enige die één specifieke vraag beantwoordt: **kan het model zijn
factuur lezen?**

1. *Facturen* → blok **2 · Sleep een factuur hierheen**.
2. Zet **"AI-facturen lezen (PDF → Claude)"** aan. Zonder die schakelaar wordt een PDF geweigerd met
   de reden erbij en is er niets verstuurd — een PDF is niet als tekst te parsen.
3. Sleep de PDF erin, of klik en kies hem.

Wat er dan gebeurt: het bestand gaat via **onze eigen server** naar Claude (nooit rechtstreeks naar
Anthropic vanuit je browser), en het antwoord **vult het handmatige formulier voor** — als concept.
Er wordt niets opgeslagen tot je op **Toevoegen** klikt. Las het model geen valuta, dan blijft dat
veld **leeg** en weigert het formulier te boeken; het erft nooit de "EUR" die er toevallig stond.

Let bij het nakijken op de vier velden die in §5 tellen: **tegenpartij, factuurdatum, bedrag en het
btw-bedrag**. Het btw-bedrag is degene die het vaakst ontbreekt, en zonder dat veld doet de factuur
in de Belasting-tab niets.

**Wat deze weg niet test:** de afzendercontrole, want er is geen afzender. Er komt geen wachtrijregel
aan te pas en de auto-boekpoort wordt niet aangeroepen — je bevestigt zelf, zoals bij handmatige
invoer. En: dit is de enige van de drie waarbij de PDF vanuit **jouw browser** naar een model gaat.
Bij weg 1 doet je eigen n8n dat.

*(CSV en UBL/EN-16931-XML gaan door dezelfde deur en hebben de AI-schakelaar niet nodig — die worden
gewoon gelezen. Het formaat wordt uit de inhoud afgeleid, niet uit de bestandsnaam.)*

---

## 5. De factuur terugzien in de Belasting-tab

Hier gaat het bij een eerste test bijna altijd mis, en zelden door een fout: de tab **weigert** je
facturen te gebruiken zolang één van de voorwaarden hieronder niet vaststaat, en hij zégt dat dan
ook. Loop ze in deze volgorde af — het is de volgorde waarin `vatPosition` ze zelf afloopt.

### 5.1 Zet het stelsel op factuurstelsel, voor de juiste onderneming

*Belasting → de module van jouw onderneming → veld **Stelsel** → **Factuurstelsel**.*

Zolang daar "nog niet ingevuld" staat, lees je dit:

> *"Er staat 1 factuur in deze periode. LaVega gebruikt die nog niet, omdat niet bekend is welk
> stelsel voor deze onderneming geldt: de btw valt bij het factuurstelsel in de periode van de
> factuur en bij het kasstelsel in die van de betaling. Factuurstelsel of kasstelsel?"*

En zet je het op **kasstelsel**, dan gebruikt hij je facturen bewust níet:

> *"Kasstelsel: de btw valt in de periode van de betaling, niet van de factuur. LaVega leidt het
> bedrag daarom niet uit je facturen af."*

Dat is geen bug, dat is de hele reden dat het veld bestaat. **Het stelsel staat per onderneming**, en
het moet op de onderneming staan waarop de factuur geboekt is (zie §1a) — niet op een andere BV.

### 5.2 Maak "Handmatig €" leeg

De basissen worden nooit opgeteld; er wordt er één helemaal gekozen, in volgorde van vertrouwen:

1. **jouw eigen bedrag** ("Handmatig €") — een feit van jou gaat boven elke berekening;
2. **jouw boekhouding**, als die precies deze periode dekt en beide btw-kanten noemt;
3. **jouw facturen** — de enige basis die een onbetaalde factuur al als schuld ziet;
4. de marge over je banktransacties.

Staat er iets bij "Handmatig €", dan wint dat en verandert je factuur **niets**. Dat is het meest
voorkomende "hij doet niks"-moment. Idem voor een geïmporteerde boekhouding die deze periode dekt.

### 5.3 De factuurdatum moet in de lopende aangifteperiode vallen

De tab kijkt naar de **lopende** aangifteperiode, afgeleid uit de frequentie (kwartaal, maand, jaar).
Een factuur met factuurdatum in juni telt bij kwartaalaangifte niet mee in Q3. Gebruik dus een
factuur van deze periode, of zet de frequentie tijdelijk om — en zet hem terug.

### 5.4 Elke factuur in die periode moet een btw-bedrag hebben

Ontbreekt het op één ervan:

> *"Van 1 van de 2 facturen in deze periode is het btw-bedrag onbekend, dus je facturen zijn hier
> niet de basis. Onbekend is geen nul."*

### 5.5 Beide kanten moeten er zijn — en dit is de verrassing

Eén inkoopfactuur alleen levert **geen** btw-bedrag op. Dat is geen fout:

> *"In deze periode staan alleen inkoopfacturen. Wat er aan btw over je omzet tegenover staat, ziet
> LaVega niet — en dat vult het niet met een nul."*

Wil je de factuur het cijfer echt zien **veranderen**, dan heb je in dezelfde periode ook een
verkoopfactuur met een btw-bedrag nodig (`direction: "income"` in de nepwachtrij, of in het formulier
**Richting → Inkomend (verkoop)**). Voeg er anders eentje bij de hand bij — desnoods via het
handmatige formulier — anders test je een regel die per ontwerp weigert.

### 5.6 Wat je hoe dan ook ziet zodra de factuur er staat

Ook zonder dat de basis omschakelt, verschijnt deze regel zodra er één factuur van die onderneming in
de periode staat:

> *"Btw-bedrag bekend op 1 van de 1 facturen in deze periode."*

**Dat is je bewijs dat de factuur is aangekomen en op de goede onderneming en in de goede periode
staat.** Verandert er verder niets, dan zegt de notitie eronder precies welke van de vijf punten
hierboven nog open is.

En als het wél omschakelt: onder *Bron* staat dan **"je facturen (factuurstelsel)"** in plaats van de
marge-benadering, met de btw over omzet en de voorbelasting erachter. Met **Bereken & bewaar** komt
het bedrag op de aangiftedatum in je forecast te staan en gaat het van je beschikbare saldo af.

---

## 6. Wat dit plan niet dekt

Eerlijk opgeschreven, want dit is waar zulke plannen misgaan.

- **Er is geen mail door de keten gegaan.** Alles in §2 volgt uit de code in deze repo, niet uit een
  waarneming. Het eerste echte bericht kan de aanname over `Authentication-Results` omgooien.
- **Wat Cloudflare met een doorgestuurde Gmail-mail doet is niet vastgesteld** — niet welke
  `Authentication-Results`-header hij zet, en niet of hij er meerdere doorlaat. De parser leest de
  **eerste** uitslag die hij tegenkomt; is die van een upstream-hop, dan gaat de badge over de
  verkeerde hop. Kijk bij de eerste mail naar `senderChecks`.
- **De nepwachtrij is vandaag niet vanuit een browser bereikbaar** (§3.3). Dat is gemeten, en de fix
  ligt bij de hoofdsessie.
- **Er is één wachtrij in n8n.** `queueKey` wordt vastgelegd maar er wordt niet op gescheiden. Zet er
  geen tweede persoon op voordat die scheiding er is.
- **De prognosekant is niet getest** — of het btw-bedrag na *Bereken & bewaar* op de juiste datum in
  de forecast landt, staat in `tax.ts` getest maar is hier niet met zijn eigen factuur nagelopen.
