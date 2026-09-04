# Kosten van kaarten — zijn ze vindbaar? Voor twee kaarten meteen, en dat is genoeg.

Zijn opdracht, 22 augustus: _"de kosten, doe een vergelijkbare sweep als voor de rente die
we al hebben gedaan."_ De aanleiding was scherp: van de 77 gebundelde kaarten draagt er
**geen enkele** zowel een cashbackcijfer als een prijs, dus de extensie kan niets netto
rangschikken. Acht kaarten hebben een cashbackcijfer. Eén prijs bij één van die acht zet de
hele nettotak aan.

**Dat zijn er twee geworden, schoon, en nog eens vier met een poort ervoor.**

- **Bleap Card** — 1% cashback, **EUR 0 per maand**, uit gedateerde kaartvoorwaarden.
- **Wirex One** — 0,5% cashback, **EUR 0 per maand**, uit hetzelfde artikel dat het
  cashbackcijfer geeft. Wel het oudste cijfer in de lijst.

Die twee zijn direct netto te rangschikken. De vier Crypto.com-niveaus hebben ook een
gedateerde nul, maar die nul mag niet als prijs geserveerd worden, en daar gaat de helft van
dit stuk over.

De verkooppagina was inderdaad de verkeerde plek — precies zoals hij had gemeten. Alle zes de
gedateerde vondsten komen uit iets anders: kaartvoorwaarden, een helpcentrum-tarievenblad, of
de eigen JSON van de site.

## Wat het verschil maakte tussen zijn meting en deze

Zijn eigen aantekening bij Bleap was: _"No fees (really!)"_ op de landingspagina — vindbaar,
niet toelaatbaar. Klopt. Maar hetzelfde bedrijf heeft **`/legal-agreements`**, en daar staat:

> **6.1 No Bleap card fees.** Cards are free. Bleap charges no issuance, monthly, usage or
> exchange fees for Card activity.
>
> — Bleap Cardholder Terms (EEA) Bleap SIA, _Updated: 28 June 2026_

Dat is dezelfde bewering, maar nu met een datum, een artikelnummer, drie benoemde
kostensoorten in plaats van één uitroepteken, en een artikel 6.2 dat zegt wat er **wel**
blijft (Mastercard scheme fees, ATM-operatorkosten, belastingen). De vorige versie van
hetzelfde stuk (25 mei 2026) heeft clausule 6.1 woordelijk gelijk — het is dus geen
eenmalige formulering die volgende maand kan verdampen.

Eén valstrik voor de volgende keer: `bleap.finance/legal`, `/terms`, `/fees`, `/pricing` en
`/terms-of-service` geven **allemaal HTTP 404**. Het juiste pad staat alleen in de linklijst
van de homepage. Wie de gebruikelijke paden afgaat en opgeeft, mist precies het document
waar deze sweep om draaide.

## De zes met een gedateerde prijs

| kaart                                       | bedrag | eenheid      | bron                                     | datum in het document |
| ------------------------------------------- | ------ | ------------ | ---------------------------------------- | --------------------- |
| Bleap Card                                  | 0      | per maand    | Cardholder Terms (EEA) Bleap SIA         | 28 juni 2026          |
| Wirex One (X-tras Standard)                 | 0      | per maand    | helpcentrum via eigen JSON               | 11 januari 2024       |
| Bybit Card                                  | 0      | **per jaar** | helpcentrum-tarievenblad                 | 3 juni 2026           |
| Crypto.com Basic (Midnight Blue)            | 0      | per maand    | helpcentrum via eigen JSON               | 22 april 2026         |
| Nexo Card                                   | 0      | per maand    | productpagina met eigen `pageUpdateDate` | 31 juli 2026          |
| Crypto.com Plus / Pro / Icy-Rose / Obsidian | 0      | per maand    | idem als Basic                           | 22 april 2026         |

Bybit staat er in **jaren** omdat het document de rij zo noemt — `Annual Fee | None`. Er is
niet omgerekend, ook niet bij een nul.

Twee dingen die deze zes eerlijk maken in plaats van alleen aanwezig:

- **Wirex** is de mooiste vondst in vorm en de zwakste in houdbaarheid. Hetzelfde artikel
  geeft de prijs én de 0,5% — prijs en opbrengst uit één bron, geen koppelrisico. Maar de
  `updatedAt` in de eigen JSON van de site is **11 januari 2024**, tweeënhalf jaar oud, en
  het losse Wirex-tarievenblad waarschuwt zelf: _"these fees are subject to change."_ De
  catalogus tekende eerder al aan dat Wirex zijn EEA-uitgifte sindsdien heeft verbouwd.
  Hercontroleren voor gebruik.
- **Nexo** is de zwakste van de zes en staat er met de reden erop: het is een verkooppagina.
  Hij komt binnen omdat de zin drie kostensoorten met naam noemt (_"no monthly, annual, or
  inactivity card fees"_) in plaats van "geen kosten" te roepen, en omdat de pagina een
  machineleesbare wijzigingsdatum in zijn eigen payload draagt — dezelfde route als het
  Trade Republic-veld dat op 21 augustus wel is toegelaten. `nexo.com/legal` geeft 404; er
  is geen los tarievenstuk.

## De vier waar een nul een leugen zou worden

Crypto.com zegt het zelf, in een gedateerd artikel van 22 april 2026:

> Unlike traditional banks that often charge hundreds of dollars annually for metal cards,
> you can get your Crypto.com Prepaid Card for free: — No monthly fee\* — No annual fee\* —
> No setup fee
>
> \*While the Crypto.com Prepaid Card itself does not have any monthly or annual fees, please
> note that **subscribing to the Level Up program to access certain tiers or benefits may
> require a monthly or annual subscription fee.**

De nul is echt. Maar de 2%, 3%, 4% en 5% in de catalogus hangen niet aan de kaart, ze hangen
aan het **niveau**, en het niveau kost geld. Zou de extensie hier 0 invullen, dan zegt hij
"5% cashback, gratis" over Obsidian — het hoogste cashbackcijfer in de hele catalogus zou
bovenaan elke nettolijst komen te staan op grond van een voetnoot die het tegendeel zegt.
Dat is precies een conclusie die een afwezigheid niet kan dragen.

Daarom staan deze vier in het staging-bestand in een **aparte lijst**, niet in `entries`, met
`netRankingSafe: false` en de reden erbij. Een vlaggetje binnen `entries` was niet genoeg —
een samenvoeging die alleen `value` leest, veegt zo'n vlag weg. De vorm van het bestand moet
de waarschuwing dragen, niet een veld erin.

**En het gereedschap hiervoor bestaat al.** `packages/core/src/netBenefit.ts` heeft precies
deze toestand al gemodelleerd, met deze omschrijving:

> `needs-another-product` — De bron noemt wél een bedrag, maar het is de prijs van dit product
> BINNEN een ander product. Wat het kost om dit te openen is dus HOGER dan het genoemde
> bedrag, en hoeveel hoger staat er niet. Het genoemde bedrag doorgeven zou een te lage prijs
> zijn, wat erger is dan geen prijs.

Dat is woord voor woord het Crypto.com-geval. De vier niveaus horen dus **niet** als
`KnownHoldingCost` met bedrag nul binnen te komen, maar als
`{ kind: "unknown", reason: "needs-another-product" }`. Dan zegt het scherm de echte oorzaak
— "de prijs zit in het Level Up-niveau" — in plaats van "gratis", en dan is er niets nieuws
te bouwen om dat goed te doen.

En de twee Private-niveaus zijn nog een graad erger dan de andere twee. Het gedateerde
artikel _How do I join Level Up?_ (18 juni 2026) zet in zijn eigen tabel:

| niveau  | toegang                                      |
| ------- | -------------------------------------------- |
| Private | **CRO Lockup/Stake**                         |
| Pro     | Subscription or CRO Lockup/Stake             |
| Plus    | Subscription or CRO Lockup/Stake             |
| Basic   | No subscription or CRO Lockup/Stake required |

Voor Private bestaat er **geen abonnementsroute**. Er is dus geen maandprijs om te vinden —
de toegang is een vastzetting (crypto.com/nl/cards noemt EUR 45.000 en EUR 450.000, maar
zonder datum). Een vastgezet bedrag is geen tarief. Het hoort niet in `accountFee`, en het
hoort ook niet weggelaten te worden.

**Basic (Midnight Blue) is de enige van de vijf waar de nul compleet is**, want daar zegt
diezelfde tabel dat er helemaal geen abonnement of inleg nodig is. Die staat wel gewoon in
`entries`.

## Twee gedateerde documenten die elkaar tegenspreken

Bij Gnosis Pay kwam iets boven dat geen vondst is maar wel opgeschreven moet worden. Twee
stukken van dezelfde uitgever, allebei met een datum, over dezelfde handeling:

| bron                                        | datum               | wat het zegt over een kaart bestellen                                       |
| ------------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| _Understanding Your Card's Fees and Limits_ | updated 12 aug 2026 | `Card Order \| FREE \| FREE shipping of your physical card`                 |
| _How To Pay for Your Gnosis Card_           | updated 28 jun 2026 | "✅ 30.23 EURe Ready — You will need **exactly 30.23 EURe** in your wallet" |

Ik kies hier geen winnaar. Het tarievenblad is het jongste, maar zijn toelichtingskolom gaat
over **verzending** en niet over de bestelling, dus het is niet eens zeker dat ze over
hetzelfde gaan. Beide staan met datum en citaat in `eenmaligeKosten`.

## De doodlopende wegen, met de reden erbij

- **Gnosis Pay** (1% cashback) — vier gedateerde documenten gelezen (tarievenblad, Monavate
  Cardholder Terms EEA, Terms of Service, How To Pay) en de Zendesk-zoek-API afgelopen op
  _fee, pricing, subscription, monthly, free, issuance, order_ — 23 artikelen. **Geen enkel
  document noemt een maand- of jaarprijs, en geen enkel document zegt dat die nul is.** Een
  ontbrekende rij in een tarievenoverzicht is geen uitgesproken nul. Dus onbekend.
- **Zeal** (1% cashback) — publiceert niets eigens. De enige tariefverwijzing op `zeal.app`
  gaat naar `help.gnosispay.com/en/articles/8663251-fees-and-limits`, en die geeft **404**.
  Dat is dezelfde dode URL die de Monavate Cardholder Terms **vier keer** aanhalen met de zin
  _"You can see all fees applicable to you here."_ De contractuele tariefverwijzing van de
  kaartuitgever wijst naar een pagina die niet meer bestaat, sinds Gnosis Pay van Intercom
  naar Zendesk verhuisde. Dat is zelf een bevinding.
- **Krak (Kraken)** — de EEA-tabel is compleet en de eigen payload draagt `updatedAt`
  7 augustus 2026, maar er is **geen rij voor maand- of jaarkosten**. Alle "Free" die er
  staat is eenmalig of per transactie.
- **Tria** — `tria.so` 200 (308 kB), `www.tria.so/card` 404. Geen tarievenpagina, geen
  kostenzin. Publiceert kennelijk niets.
- **Crypto.com Level Up-prijzen** — `crypto.com/document/<slug>` geeft **HTTP 403**
  (genoteerd, niet omzeild — het helpcentrum verwijst er zelf naar, dus daar zou het
  gedateerde stuk kunnen staan). `/legal`, `/eea/level-up` en `/nl/level-up` geven 404. In
  het helpcentrum gezocht op _3.99_, _24.99_, _subscription price_ en _Level Up terms_: de
  twee gedateerde Level Up-artikelen beschrijven de plannen en de CRO-tredes in dollars en
  drukken het eurobedrag nergens af.
- **Wayback (route 4)** — vier keer **HTTP 429 Too Many Requests**, ook met 20 seconden
  pauze ertussen. Route 4 was deze sessie niet beschikbaar. Niet omheen gewerkt; op
  21 augustus werkte hij wel (Revolut).
- **Nexo** — eerste ophaalpoging liep vast (>2 minuten zonder antwoord); met `--max-time 30`
  kwam de pagina wel binnen op 657 kB. Waard om te onthouden voor de volgende run.

## Wat er wel is en toch niet toegewezen kan worden

Twee aanbieders leverden gedateerde bedragen die op een **rijbeslissing** stranden, niet op
een datum. Dat is een ander soort blokkade en hij is met opzet apart gehouden.

- **bunq** — het Tarievenblad van **03/08/2026** heeft de kaartrij, en de acht kolommen zijn
  op tekenpositie tegen de kop gelegd voordat ik iets opschreef (Elite / Pro / Core / Free en
  dezelfde vier Business). Eerste Mastercard: Elite en Pro "combinatie van 3 passen gratis
  inbegrepen", Core "1 pas gratis inbegrepen", Free **"n.v.t."**. Elke extra pas: EUR 9,99
  eenmalig **+ EUR 3,49 per maand** (Elite, Pro) of **+ EUR 3,99 per maand** (Business).
  Waarom het blijft liggen: bunq heeft in dit document **één** kaartrij, de catalogus heeft
  **negen** bunq-kaartrijen, en bunq noemt zijn eigen plastic hier "creditcard" terwijl de
  catalogus dezelfde kaart "betaalpas" noemt. Welke rij dit is, is een beslissing en geen
  meting — precies de fout waar `state.json` op 18 augustus voor waarschuwde. En let op dat
  bunq Free daar **n.v.t.** heeft staan: dat is geen nul en geen prijs.
- **Plutus** — EUR 6,99 / 9,99 / 19,99 per maand voor Starter / Everyday / Premium. Eén
  catalogusrij, drie abonnementen, en geen datum op `plutus.it/plans` noch op
  `plutus.it/fees`. Faalt dus op twee dingen tegelijk.

## De telling

|                                                                                       | aantal |
| ------------------------------------------------------------------------------------- | ------ |
| **Gevonden** — een terugkerend maand- of jaarbedrag bij een kaart uit de catalogus    | **17** |
| Daarvan **door de toelatingseis** (waarde + bron + datum + voorwaarden)               | **9**  |
| — waarvan **direct te serveren** (`entries`)                                          | 5      |
| — waarvan **achter een niveaupoort** (`entriesMetTierpoort`, niet netto rangschikken) | 4      |
| **Stranden op alleen de datum**                                                       | **3**  |
| **Stranden op de rijtoewijzing** (waarde én datum compleet, rij onbeslist)            | **5**  |

De drie die op alleen de datum stranden zijn de categorie waar een gedateerd stuk ze alsnog
binnenhaalt: **paysafecard** (EUR 3 per maand vanaf de tweede maand, staat er letterlijk,
maar de kostenpagina draagt nergens een datum) en de **twee Level Up-abonnementsprijzen**
(EUR 3,99 en EUR 24,99 per maand). Die laatste twee zijn de duurste openstaande post van
allemaal: zodra ze een datum krijgen, worden vier Crypto.com-niveaus in één klap netto
rangschikbaar in plaats van geblokkeerd.

## Wat dit voor het scherm betekent

Op de acht kaarten met een cashbackcijfer staat de stand nu zo:

| kaart                         | cashback | prijs                              | netto te rangschikken?                    |
| ----------------------------- | -------- | ---------------------------------- | ----------------------------------------- |
| Bleap Card                    | 1%       | EUR 0 / maand                      | **ja**                                    |
| Wirex One                     | 0,5%     | EUR 0 / maand                      | **ja**, met een houdbaarheidswaarschuwing |
| Crypto.com Plus (Ruby Steel)  | 2%       | kaart 0, niveau onbekend-met-datum | nee — poort                               |
| Crypto.com Pro (Jade/Indigo)  | 3%       | kaart 0, niveau onbekend-met-datum | nee — poort                               |
| Crypto.com Private (Icy/Rose) | 4%       | kaart 0, toegang is een inleg      | nee — poort                               |
| Crypto.com Private (Obsidian) | 5%       | kaart 0, toegang is een inleg      | nee — poort                               |
| Gnosis Pay Card               | 1%       | onbekend                           | nee                                       |
| Zeal Card                     | 1%       | onbekend                           | nee                                       |

De nettotak van de extensie kan aan. Hij kan twee kaarten echt rangschikken en moet bij zes
nog steeds "kosten onbekend" of "prijs zit in het niveau" zeggen — maar dat is nu een
**uitspraak met een reden erachter**, en niet meer hetzelfde lege "kosten onbekend" bij alle 77.

---

Bestanden: `docs/catalog/staging-kaartkosten.json` (de vondsten, vier lijsten die apart
gelezen moeten worden). `docs/catalog/catalog.json` is niet aangeraakt — samenvoegen is een
aparte stap met zijn eigen toelatingspoort.
