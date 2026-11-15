/* GEGENEREERD — niet met de hand bijwerken.
 *
 * Bron: docs/catalog/catalog.json (generatedAt 2026-08-24).
 * Gemaakt door apps/extension/scripts/bundle-catalog.ts.
 *
 * 84 producten waarmee je kunt afrekenen. Daarvan:
 *   83 met een koersopslag-cijfer,
 *   8 met een cashback-cijfer,
 *   58 met een puntencijfer,
 *   41 met kaartkosten INCLUSIEF periode (maand of jaar),
 *   2 met ALLEBEI een cashback-cijfer en kaartkosten.
 * 0 fee-cijfer(s) zijn overgeslagen omdat er geen leesbare
 * periode bij stond; een bedrag zonder periode is niet te verrekenen.
 *
 * DAT LAATSTE GETAL IS HET BELANGRIJKSTE VAN DEZE KOP. Een netto-uitkomst — de
 * opbrengst van een aankoop min wat de kaart kost om te openen — vereist die
 * twee cijfers samen op één kaart. Is het 2, dan wordt de
 * netto-tak van rank.ts door deze data NOOIT bereikt, en dan mag geen enkel
 * scherm beloven dat de kaartkosten "erin verrekend" zijn. Ze worden verrekend
 * waar ze bekend zijn, en dat is hier 2 keer.
 * rank.test.ts legt dit getal vast, zodat het omvalt zodra de data verandert.
 *
 * Dat 43 van de 84 producten GEEN
 * kaartkosten in de catalogus hebben, is geen fout in dit bestand en ook geen
 * nul: het is de reden dat rank.ts een aparte, brutouitkomst kent waar het
 * woord "netto" niet valt.
 */

import type { CheckoutCard } from "../types.js";

export const CATALOG_GENERATED_AT = "2026-08-24";

export const CHECKOUT_CARDS: readonly CheckoutCard[] = [
  {
    id: "ing-betaalpas",
    product: "ING betaalpas",
    issuer: "ING Bank N.V.",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.4,
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        "Geldt bij betalen met de Betaalpas in het buitenland bij winkels, tankstations, restaurants, etc. in vreemde valuta (betalingen in euro's € 0,00); volgens noot 1 berekent ING een koersopslag op alle transacties in vreemde valuta, verwerkt in het bestede bedrag. Hetzelfde percentage (1,40% koersopslag niet-euro Betaalpas) staat vermeld bij ING Go, ING More, ING Extra en ING Max; bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%).",
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "ing-creditcard",
    product: "ING creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://assets.ing.com/m/6ebeaa434999a60b/original/ING_Kostenoverzicht-betaalproducten-particulieren.pdf",
      checkedAt: "2022-10-01",
      conditions:
        'Geldt bij betalen met een creditcard bij winkels, tankstations, restaurants, etc. "In vreemde valuta" (betalen "In euro\'s" is € 0,00); volgens voetnoot 1 berekent ING een koersopslag op alle transacties in vreemde valuta, verwerkt in het bestede bedrag, met de wisselkoersen van MasterCard International voor haar creditcards. Bij geldopnemen met de creditcard in vreemde valuta geldt een andere prijs: 4,00% van het opgenomen bedrag met minimum € 4,50 + 2,00% koersopslag.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 2,
      period: "maand",
      sourceUrl:
        "https://assets.ing.com/m/a4631974e5e7bab1/original/ING_Informatiedocument-OranjePakket.pdf",
      checkedAt: "2026-01-01",
      conditions:
        "Bovenop de € 4,00 per maand van het ING OranjePakket: dit document is het Informatiedocument van die betaalrekening en de kaart is er een 'aan uw betaalrekening gekoppelde dienst'. Een extra Creditcard kost € 1,25 per maand. Koersopslag 2,00% per transactie in vreemde valuta; geldopname met de creditcard 4,00% van het opgenomen bedrag met een minimum van € 4,50, in vreemde valuta plus 2,00% koersopslag; daglimiet € 400. LET OP DE NAAMOVERLAP: het ING Kostenoverzicht van 15 juni 2026 kent deze naam niet meer en zet op precies dezelfde twee bedragen 'ING Creditcard More € 2,00' en 'extra ING Creditcard More € 1,25'. Zie 'openstaandeVragen' in het verslag — dit is vermoedelijk dezelfde kaart onder een oude naam.",
    },
  },
  {
    id: "ing-platinumcard",
    product: "ING Platinumcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://assets.ing.com/m/a4631974e5e7bab1/original/ING_Informatiedocument-OranjePakket.pdf",
      checkedAt: "2026-01-01",
      conditions:
        "0% koersopslag voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00% koersopslag per transactie",
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 4.35,
      period: "maand",
      sourceUrl:
        "https://assets.ing.com/m/a4631974e5e7bab1/original/ING_Informatiedocument-OranjePakket.pdf",
      checkedAt: "2026-01-01",
      conditions:
        "Bovenop de € 4,00 per maand van het ING OranjePakket. Een extra Platinumcard kost € 2,60 per maand. Hetzelfde document draagt al de koersopslag van deze rij: 0% voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00% per transactie; opnamelimiet € 1.000 per dag in plaats van € 400. LET OP DE NAAMOVERLAP: het ING Kostenoverzicht van 15 juni 2026 kent de naam Platinumcard niet meer en zet op precies dezelfde twee bedragen 'ING Creditcard Extra € 4,35' en 'additionele ING Creditcard Extra € 2,60', met dezelfde 0%-tot-€1.000-clausule. Zie 'openstaandeVragen' in het verslag.",
    },
  },
  {
    id: "abn-amro-betaalpas",
    product: "ABN AMRO betaalpas",
    issuer: "ABN AMRO Bank N.V.",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.2,
      sourceUrl:
        "https://assets.abnamro.com/api/public/content/informatiedocument-vergoedingen-basispakket-betalen.pdf",
      checkedAt: "2026-01-01",
      conditions:
        "Geldt binnen het BasisPakket Betalen bij betalen met een betaalpas in vreemde valuta; per keer komt daar € 0,15 bovenop (de koersopslag bij geldopname in vreemde valuta is een aparte regel met eigen tariefklassen)",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.abnamro.nl/nl/prive/betalen/creditcards/index.html",
      checkedAt: "2026-08-20",
      conditions: "Geen puntenprogramma op deze betaalpas.",
    },
    fee: {
      value: 1.5,
      period: "maand",
      sourceUrl:
        "https://assets.abnamro.com/api/public/content/informatiedocument-vergoedingen-basispakket-betalen.pdf",
      checkedAt: "2026-01-01",
      conditions:
        "DIT IS DE ENIGE VAN DE ACHT BANKEN DIE ZIJN BETAALPAS APART PRIJST. Het bedrag geldt voor de eerste betaalpas als je géén BasisPakket Betalen en géén Studenten Pakket hebt; binnen die twee pakketten zit één betaalpas in de pakketprijs. Een extra betaalpas kost hetzelfde: € 1,50 per maand (€ 18,00 per jaar). Bovenop de € 4,30 per maand van de losse ABN AMRO betaalrekening — wie geen pakket heeft betaalt dus rekening én pas, en daarom is pricedOnItsOwn false. Een vervangende betaalpas bij verlies kost € 5,00 per keer; dat is eenmalig en geen doorlopende post. Een digitale betaalpas, Apple Pay en Google Pay zijn gratis. Het document noemt zowel de maand- als de jaarprijs; er is niet omgerekend, de maandregel is aangehouden zoals de tariefregel hem zet.",
    },
  },
  {
    id: "abn-amro-creditcard",
    product: "ABN AMRO creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/666/ICS-157-NL-082026%20av%20abn%20amro%20en%20abn%20amro%20meespierson",
      checkedAt: "2026-08-19",
      conditions:
        "Geldt voor betalingen en geldopnames in vreemde valuta, die door Mastercard naar euro's worden omgerekend op basis van de Wisselkoers (de door Mastercard vastgestelde wisselkoers vermeerderd met een opslag); de omrekening gebeurt op de datum van de betaling of geldopname. Voor geldopnames gelden daarnaast aparte transactiekosten (1% met maximum € 1,50 uit positief saldo, anders 4%).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.abnamro.nl/nl/prive/betalen/creditcards/index.html",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 2.55,
      period: "maand",
      sourceUrl:
        "https://assets.abnamro.com/api/public/content/informatieblad-betaaldiensten-particulieren.pdf",
      checkedAt: "2026-01",
      conditions:
        "Extra ABN AMRO Credit Card € 1,05 per maand. Uitgegeven door ICS; de voorwaarden van ICS zijn van toepassing. Binnen het ABN AMRO Studenten Pakket € 1,31 per maand (€ 15,72 per jaar), uit hetzelfde informatieblad.",
    },
  },
  {
    id: "abn-amro-gold-card",
    product: "ABN AMRO Gold Card",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/666/ICS-157-NL-082026%20av%20abn%20amro%20en%20abn%20amro%20meespierson",
      checkedAt: "2026-08-19",
      conditions:
        "Geldt voor betalingen en geldopnames in vreemde valuta: deze worden door Mastercard omgerekend naar euro's op basis van de Wisselkoers (de door Mastercard vastgestelde koers vermeerderd met een opslag); de opslag is 2%. Voor geldopnames brengen wij daarnaast aparte kosten in rekening (artikel 13.3).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.abnamro.nl/nl/prive/betalen/creditcards/index.html",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 4.45,
      period: "maand",
      sourceUrl:
        "https://assets.abnamro.com/api/public/content/informatieblad-betaaldiensten-particulieren.pdf",
      checkedAt: "2026-01",
      conditions: "Extra ABN AMRO Gold Card € 2,10 per maand.",
    },
  },
  {
    id: "rabobank-betaalpas",
    product: "Rabobank betaalpas",
    issuer: "Coöperatieve Rabobank U.A.",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.4,
      sourceUrl:
        "https://web.archive.org/web/20260423003428id_/https://www.rabobank.nl/particulieren/betalen/betaalproducten/kosten-voorwaarden",
      checkedAt: "2026-04-23",
      conditions:
        "Geldt bij betalen met je betaalpas in vreemde valuta (in euro's geen extra kosten); dezelfde 1,4% koersopslag staat vermeld bij alle betaalpakketten (Rabo Standaard, Rabo Comfort, Rabo RiantPakket, Rabo Free, Rabo JongerenRekening). Contant geld opnemen in vreemde valuta is een aparte post (bijv. € 3,50 + 1,4% koersopslag).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl:
        "https://web.archive.org/web/20260412125233id_/https://www.rabobank.nl/particulieren/betalen/creditcard/rabocard",
      checkedAt: "2026-08-20",
      conditions: "Geen puntenprogramma op deze betaalpas.",
    },
    fee: null,
  },
  {
    id: "rabobank-creditcard",
    product: "Rabobank creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://web.archive.org/web/20260412125233id_/https://www.rabobank.nl/particulieren/betalen/creditcard/rabocard",
      checkedAt: "2026-04-12",
      conditions:
        'Geldt voor de RaboCard: "Betaal je met een andere munt (vreemde valuta) dan de euro, dan betaal je daar iets extra over" — bij betalen in euro\'s, ook in het buitenland, zijn er geen extra kosten. Bij opname van contant geld bij een geldautomaat of aan de balie geldt € 4,50 per opname + 2% koersopslag. "(Online) dienstverleners, banken of winkeliers vragen soms een toeslag bij betalingen of geldopnames met jouw creditcard."',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl:
        "https://web.archive.org/web/20260412125233id_/https://www.rabobank.nl/particulieren/betalen/creditcard/rabocard",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 2,
      period: "maand",
      sourceUrl:
        "https://media.rabobank.com/m/58242d90fc02d281/original/Tarieven-en-limieten-particulier-betalingsverkeer-per-dec-2025.pdf",
      checkedAt: "2025-12",
      conditions:
        "Bovenop de € 3,45 per maand van Rabo Standaard. Een extra RaboCard of Rabo GoldCard kost € 0,75 per maand. Bij Rabo Free is dezelfde kaart € 1,25 per maand.",
    },
  },
  {
    id: "rabo-goldcard",
    product: "Rabo GoldCard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://web.archive.org/web/20260411080707id_/https://www.rabobank.nl/particulieren/betalen/creditcard/rabo-goldcard",
      checkedAt: "2026-04-11",
      conditions:
        'Geldt alleen als je betaalt "in een andere muntsoort, dus een vreemde valuta"; betalingen in euro\'s, ook in het buitenland, kennen geen extra kosten ("kosten euro\'s geen extra kosten"). Bij geld opnemen in vreemde valuta geldt daarnaast € 4,50 per opname + 2% koersopslag. (Online) dienstverleners, banken of winkeliers kunnen bovendien zelf een toeslag vragen.',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl:
        "https://web.archive.org/web/20260420213121id_/https://www.rabobank.nl/particulieren/betalen/creditcard/rabo-goldcard/visa-merchant-offer-program",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 2,
      period: "maand",
      sourceUrl:
        "https://media.rabobank.com/asset/34bbb881-8b03-425c-a2bd-3d6cafbb1d06/Informatiedocument-betreffende-de-vergoedingen-Rabo-Standaard.pdf",
      checkedAt: "2026-07-01",
      conditions:
        "Bovenop de € 3,45 per maand van Rabo Standaard; dit document is het Informatiedocument van dat pakket en noemt de kaart bij naam. Binnen Rabo Comfort (€ 6,95 per maand) zit één Rabo GoldCard in de pakketprijs en kost een extra kaart € 0,75 per maand (Informatiedocument Rabo Comfort, 7 januari 2026). Bij Rabo Free is dezelfde kaart € 1,25 per maand en bij Rabo RiantPakket kost een extra GoldCard € 0,50 per maand (Tarieven en limieten, december 2025). Koersopslag 2,0% bij betalen in vreemde valuta; geldopname € 4,50, in vreemde valuta € 4,50 + 2,0%. Het document noemt zowel de maand- als de jaarprijs; er is niet omgerekend.",
    },
  },
  {
    id: "sns-betaalpas",
    product: "SNS betaalpas",
    issuer: "ASN Bank N.V. (formerly SNS Bank N.V. / de Volksbank)",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.4,
      sourceUrl: "https://www.snsbank.nl/downloads/tarievenwijzer-betalen.html",
      checkedAt: "2026-02-01",
      conditions:
        "Geldt bij betalen met een betaalpas in vreemde valuta (in euro is het € 0,00); bij betalen in een andere geldsoort dan de euro worden de wisselkoersen van Mastercard of Visa gebruikt. Contant geld opnemen met de betaalpas in vreemde valuta is een apart tarief (1,4% + € 3,50 per opname).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.snsbank.nl/particulier/betalen/creditcard.html",
      checkedAt: "2026-08-20",
      conditions: "Geen puntenprogramma op deze betaalpas.",
    },
    fee: null,
  },
  {
    id: "sns-creditcard",
    product: "SNS creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.snsbank.nl/downloads/tarievenwijzer-betalen.html",
      checkedAt: "2026-02-01",
      conditions:
        'Geldt voor de SNS Creditcard, een Visa-card uitgegeven door International Card Services: "De SNS Creditcard is een product van International Card Services (ICS). SNS heeft de dienstverlening van de creditcard bij ICS ondergebracht." De opslag hangt aan de VALUTA, niet aan het land: de Tarievenwijzer zet "Betalen met een creditcard / in euro € 0,00" direct boven "in vreemde valuta 2% wisselkoersopslag", en de SNS-productpagina schrijft het uit als "Betalen in het buitenland in euro\'s € 0" tegenover "Betalen met buitenlands geld 2% wisselkoersopslag". Bij geldopname stapelt hij: "Opname van contant geld met een creditcard in vreemde valuta 4% van opgenomen bedrag + 2% wisselkoersopslag". De 2% komt bovenop de Visa-wisselkoers. Geen maximum, staffel, vrijstelling of pakketvoorwaarde bij deze regel; het document schrijft maxima wél uit waar ze bestaan — "Dan betaal je 1% (in plaats van 4%) van het bedrag dat je opneemt, maar nooit meer dan € 1,50" — dus de kale regel is informatief, niet slechts stilzwijgend. Scope: particuliere Tarievenwijzer; de SNS Creditcard bij Studentenrekening (€ 27,50/jaar i.p.v. € 37,50) valt onder dezelfde 2%-regel, zakelijke ICS-cards niet (die staan op 2,5%, zie blocker-veld van knab-creditcard).',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.snsbank.nl/particulier/betalen/creditcard.html",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 37.5,
      period: "jaar",
      sourceUrl: "https://www.snsbank.nl/downloads/tarievenwijzer-betalen.html",
      checkedAt: "2026-02-01",
      conditions:
        "Jaarlijkse kosten. Bij een SNS Studentenrekening € 27,50 per jaar. De SNS Creditcard is een product van ICS; alle kosten betaal je aan ICS.",
    },
  },
  {
    id: "asn-betaalpas",
    product: "ASN betaalpas",
    issuer: "ASN Bank N.V.",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.4,
      sourceUrl: "https://www.asnbank.nl/downloads/tarievenwijzer-1.html",
      checkedAt: "2026-07-01",
      conditions:
        "Geldt bij betalen met een betaalpas in het buitenland in vreemde valuta (1,4% van het betaalde bedrag); betalen in euro € 0. Voor de omrekening worden de wisselkoersen van Mastercard of Visa gebruikt. Geldt voor ASN Bankrekening, ASN Basisbankrekening, ASN Studentenrekening en ASN Jongerenpakket. Contant geld opnemen in vreemde valuta is een aparte tarief (1,4% + € 3,50 per opname).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.asnbank.nl/betalen/asn-creditcard.html",
      checkedAt: "2026-08-20",
      conditions: "Geen puntenprogramma op deze betaalpas.",
    },
    fee: null,
  },
  {
    id: "asn-creditcard",
    product: "ASN Creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/626/Algemene%20Voorwaarden%20ASN%20Creditcard%20-%2040",
      checkedAt: "2026-08-19",
      conditions:
        "Geldt bij betalingen en geldopnames in vreemde valuta, die door Visa (Visa Cards) of Mastercard (Mastercards) worden omgerekend naar euro's op basis van de Wisselkoers; de opslag komt bovenop die Wisselkoers. Voor geldopnames worden daarnaast aparte kosten in rekening gebracht (artikel 12.3).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.asnbank.nl/betalen/asn-creditcard.html",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 37.5,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260421225556id_/https://www.icscards.nl/ics-info/faq-jaarbijdrage-verhoging-asn",
      checkedAt: "2025-11-01",
      conditions:
        '"... de jaarbijdrage van uw ASN Creditcard vanaf 1 november 2025", met "Waarom wordt de jaarbijdrage voor mijn ASN Creditcard € 37,50?". De kaart wordt uitgegeven door ICS en de ASN-tarievenwijzer noemt hem niet, daarom is dit een ICS-pagina; asnbank.nl noemt op zijn eigen kostenpagina op 21 augustus 2026 hetzelfde bedrag, maar zonder datum. De live ICS-URL geeft 404, dus gelezen is de Wayback-kopie van 21 april 2026.',
    },
  },
  {
    id: "regiobank-betaalpas",
    product: "RegioBank betaalpas",
    issuer: "ASN Bank N.V. (formerly RegioBank N.V.)",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.4,
      sourceUrl: "https://www.regiobank.nl/downloads/tarievenwijzer-betalen-1.html",
      checkedAt: "2026-02-01",
      conditions:
        "Geldt bij betalen met een betaalpas in vreemde valuta (een andere geldsoort dan de euro); betalen in euro is € 0,00. Plus eventuele lokale kosten bij een betaling. Voor opname van contant geld in vreemde valuta geldt een ander tarief (1,4% + € 3,50 per opname). Omrekening gebeurt met de wisselkoersen van Mastercard (Maestro, Debit Mastercard) of Visa (VPay, Visa Debit).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.regiobank.nl/betalen/regiobank-creditcard.html",
      checkedAt: "2026-08-20",
      conditions: "Geen puntenprogramma op deze betaalpas.",
    },
    fee: null,
  },
  {
    id: "regiobank-creditcard",
    product: "RegioBank creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://web.archive.org/web/20241121084450id_/https://www.regiobank.nl/downloads/tarievenwijzer-betalen-1.html",
      checkedAt: "2024-07-01",
      conditions:
        "Geldt bij betalen met de RegioBank Creditcard in vreemde valuta; betalen in euro in Nederland en andere Eurolanden is € 0,00. Voor opname van contant geld in vreemde valuta geldt een ander tarief (4% van het opgenomen bedrag + 2% valutawisselkosten).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.regiobank.nl/betalen/regiobank-creditcard.html",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 37.5,
      period: "jaar",
      sourceUrl: "https://www.regiobank.nl/downloads/tarievenwijzer-betalen-1.html",
      checkedAt: "2026-02-01",
      conditions:
        "Tarief bij Betaalrekening Plus Betalen. Bij een Studentenrekening € 27,50 per jaar. Uitgegeven door ICS.",
    },
  },
  {
    id: "knab-betaalpas",
    product: "Knab betaalpas",
    issuer: "Knab (Aegon Bank N.V.)",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.4,
      sourceUrl:
        "https://assets-eu-01.kc-usercontent.com/35355cb5-f8a5-0105-c237-9bab7d11ff84/3ec88fbd-4326-4bf3-be18-ed80334ade03/20251001%20Informatiedocument%20Knab%20Betaalrekening.pdf",
      checkedAt: "2025-10-01",
      conditions:
        'SCOPE IS DE VOORWAARDE: het Informatiedocument is gekopt "Naam van de rekening: Knab Betaalrekening" — het particuliere pakket (Privérekening € 6 p/m, één rekeninghouder; Gezamenlijke rekening € 7 p/m, twee rekeninghouders). Zakelijke Knab-rekeningen hebben een eigen tarievenpagina en vallen hier niet onder. Dezelfde 1,4% staat op knab.nl/tarieven ("Tarieven per 18-02-2026") met de geografische inkadering erbij: "Betalen en opname van contant geld in eurolanden Gratis*" tegenover "Betalen en opname van contant geld buiten eurolanden Mastercard wisselkoers + 1,4% koersopslag in euro*", met voetnoot "* Let op: buitenlandse banken kunnen kosten rekenen voor het gebruik van een geldautomaat." De 1,4% komt dus bovenop de Mastercard-wisselkoers. Geen plafond, staffel, vrij bedrag of promo bij deze regel; het document schrijft samengestelde voorwaarden wél uit waar ze bestaan ("Overboeking in andere valuta buiten SEPA € 15 + koersopslag van 0,1%", en de pakketsplitsing Privé € 72 / Gezamenlijk € 84 totale jaarlijkse vergoeding), dus de onvoorwaardelijke 1,4%-regel is informatief. Dezelfde 1,4% geldt in het FID ook voor "Opname van contant geld met een betaalpas in vreemde valuta".',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: null,
  },
  {
    id: "knab-creditcard",
    product: "Knab creditcard",
    issuer: "Knab (Aegon Bank N.V.)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.knab.nl/tarieven",
      checkedAt: "2026-02-18",
      conditions:
        'SCOPE IS DE VOORWAARDE: de pagina is gekopt "Rente & tarieven — Particulier / Op deze pagina vind je de rentes en tarieven van de producten binnen het particuliere aanbod van Knab", met aparte links naar "Zakelijke Knab-producten" en "Voormalige Aegon Bank-producten". De Knab Creditcard is een ICS-product: het Knab FID zet er een voetnoot bij — "De Knab Creditcard is een product van International Card Services (ICS)... alle kosten met betrekking tot je creditcard betaal je aan hen" — en de bijbehorende ICS-voorwaarden (Algemene Card Voorwaarden Banken, ICS-50-NL-05/2026, "Diemen, mei 2026", https://www.icscards.nl/webdocuments/628) bevestigen het per-card: art. 12.1 "Betalingen en geldopnames in vreemde valuta worden door Visa voor Visa Cards en door Mastercard voor Mastercards omgerekend naar euro\'s op basis van de Wisselkoers. De opslag is 2%." De 2% komt dus bovenop de Visa/Mastercard-koers. Niet verwarren met art. 12.4 van diezelfde voorwaarden: "Voor het overboeken van geld van uw Card naar een (bank)rekening... U moet 2,5% van het overgeboekte of opgewaardeerde bedrag betalen" — dat is een geldovermakingstarief, geen valutaopslag. Los daarvan: "Contant geld opnemen 4% van het opgenomen bedrag". Geen plafond of vrij bedrag; de pagina schrijft plafonds en staffels wél uit waar ze bestaan ("€ 15 + een koersopslag van 0,1% (indien overgeboekt naar landen buiten EER)", "Minimum inlegbedrag € 1.000", "Je krijgt rente tot € 500.000").',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.knab.nl/particulier/betalen/creditcard",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma op dit product; de kaartvoordelen zijn verzekeringen, acceptatie en app-inzicht.",
    },
    fee: {
      value: 28,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260415102754id_/https://www.icscards.nl/ics-info/faq-jaarbijdrage-verhoging-knab",
      checkedAt: "2025-11-01",
      conditions:
        "PRIJSSTIJGING AL AANGEKONDIGD: dezelfde URL toont vandaag (24 augustus 2026) de volgende ronde — 'de jaarbijdrage van uw Knab Creditcard vanaf 1 november 2026' met 'Waarom wordt de jaarbijdrage voor de Knab Creditcard € 31?' en 'Ook de jaarbijdrage voor uw Extra Card wijzigt van € 28 in € 31'. Die zin bevestigt tegelijk dat € 28 het bedrag is dat vandaag geldt. Vanaf 1 november 2026 is het € 31 per jaar, ook voor een Extra Card. Alleen aan te vragen bij een Knab bankpakket (de eigen productpagina is gekopt 'Creditcard aanvragen bij je bankpakket'), dus bovenop de € 6,00 per maand van de Knab Privérekening of € 7,00 van de Gezamenlijke rekening. De kaart is een ICS-product: het Informatiedocument van Knab (01-10-2025) zet bij 'Aanbieden van een creditcard' de tekst 'Dienst niet beschikbaar' met de voetnoot dat alle kosten aan ICS worden betaald en 'daarom staan die kosten niet in dit overzicht'. Koersopslag 2%, geldopname 4% van het opgenomen bedrag (knab.nl/tarieven, Tarieven per 18-02-2026).",
    },
  },
  {
    id: "triodos-betaalpas",
    product: "Triodos betaalpas",
    issuer: "Triodos Bank N.V.",
    kind: "betaalpas",
    fxFeePct: {
      value: 1,
      sourceUrl:
        "https://www.triodos.nl/downloads/informatiedocument-vergoedingen-betaalrekening?id=1c5f1621483d",
      checkedAt: "2026-05-01",
      conditions:
        'SCOPE IS DE VOORWAARDE: "Naam van de rekening: Triodos Internet Betaalrekening" — Triodos\' enige particuliere betaalrekening, met een pakketprijs die per leeftijd/soort verschilt (18 t/m 22 jaar € 0,00 p/m; 23 t/m 25 jaar € 3,50; vanaf 26 jaar € 5,00; en/of-rekening € 8,00) maar de 1% is voor alle vier gelijk — één regel voor de hele rekening. Geldt alleen bij BETALEN met de betaalpas in vreemde valuta; geldopname is een aparte, duurdere regel: "Opname van contant geld met een betaalpas in vreemde valuta — € 2,25 voor elke opname + 1% koersopslag over het opgenomen bedrag". Creditcard is niet van toepassing ("Aanbieden van een creditcard — Dienst niet beschikbaar"). Geen minimum, maximum, staffel of vrij bedrag bij de 1%-regel; het document schrijft min/max wél uit waar ze bestaan ("0,1% van het bedrag met minimum van € 7,50 en maximum van € 75,00"), dus de kale 1% is informatief. De Triodos servicepagina voegt toe dat Visa de koers zet: "Visa bepaalt de wisselkoersen en opslagen."',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: null,
  },
  {
    id: "bunq-free-betaalpas",
    product: "bunq Free betaalpas",
    issuer: "bunq B.V. (NL banking licence); Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 3,
      sourceUrl: "https://www.bunq.com/nl-nl/personal/plans/bunq-free",
      checkedAt: "2026-08-19",
      conditions:
        'Geldt alleen boven de gratis ZeroFX-allowance: "Als je het gratis abonnement hebt, kun je tot €1.000 per jaar tegen deze koers uitgeven. Na €1.000 aan pinbetalingen in vreemde valuta in een kalenderjaar, geldt een tarief van 3% van elk volgend transactiebedrag."',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-core-betaalpas",
    product: "bunq Core betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl: "https://www.bunq.com/nl-nl/personal/plans/bunq-core",
      checkedAt: "2026-08-19",
      conditions:
        'Geldt via ZeroFX bij paspbetalingen in het buitenland "wanneer de markten open zijn"; voor Core geldt "ZeroFX tot je abonnementslimiet" en "Core, Pro en Elite hebben onbeperkt ZeroFX" (de €1.000-limiet per jaar geldt alleen voor bunq Free, daarboven standaard conversiekosten)',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-pro-betaalpas",
    product: "bunq Pro betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://static.bunq.com/website/documents/bunq-information-sheet-pricing-nl-nl.pdf",
      checkedAt: "2026-08-03",
      conditions:
        "SCOPE IS THE CONDITION AND THE COLUMN IS THE SCOPE. The sheet is an 8-column plan table (bunq Elite | bunq Pro | bunq Core | bunq Free | bunq Elite Business | bunq Pro Business | bunq Core Business | bunq Free Business) and this quote is the bunq Pro cell of the row labelled 'Kaartbetaling (vreemde valuta)', inside the section headed 'Passen'. NO CAP, NO TIER, NO ALLOWANCE for bunq Pro — and the row itself positively establishes that, because the SAME row does price a cap in two other columns: the bunq Free and bunq Free Business cells carry 'Dit geldt voor € 1000 per jaar, daarna bedragen de kosten 1.5% van het transactiebedrag' and the Pro cell does not. A silent Pro cell in a row that demonstrably writes caps where they exist is informative, not merely silent. NOTE ON THE WORDING: 'valutaschommelin gen preventie' is how pdftotext returns the hyphenated cell — the document means 'valutaschommelingen preventie', quoted unfixed per instruction. The 0.5% is a spread added to the Mastercard rate, not a separate line-item fee; the running text on p.18 confirms 'Voor transacties die worden uitgevoerd in andere valuta dan euro, wordt het bedrag van de transactie omgezet naar euro via de Mastercard wisselkoers' and 'Wij kunnen ook valutaschommelingen preventie in rekening brengen voor uw transactie.' Footnote 7 prices the same 0,5% on cash withdrawals needing conversion. bunq issues one card type (Mastercard); there is no separate debit/credit FX row.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-elite-betaalpas",
    product: "bunq Elite betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl: "https://www.bunq.com/nl-nl/personal/plans/bunq-elite",
      checkedAt: "2026-08-19",
      conditions:
        '"toeslag van 0,5% wanneer de markten open zijn" (buiten de openingstijden van de markten geldt dus een andere situatie); volgens de FAQ: "bunq Free bevat tot €1.000 aan ZeroFX-uitgaven in vreemde valuta per jaar; daarboven gelden standaard conversiekosten. Core, Pro en Elite hebben onbeperkt ZeroFX."',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-creditcard",
    product: "bunq creditcard",
    issuer: "bunq B.V. (self-issued, Mastercard) — notably NOT ICS",
    kind: "creditcard",
    fxFeePct: {
      value: 0.5,
      sourceUrl: "https://help.bunq.com/articles/whats-zerofx-and-how-does-it-save-me-money",
      checkedAt: "2026-08-19",
      conditions:
        "bunq Free users can make up to €1,000 ZeroFX payments per year in foreign currencies. All payments beyond the €1,000 are subject to regular 3% currency conversion fees.&nbsp; bunq Core, Pro, and Elite users can make unlimited ZeroFX payments per year.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-free-business-betaalpas",
    product: "bunq Free Business betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://static.bunq.com/website/documents/bunq-information-sheet-pricing-nl-nl.pdf",
      checkedAt: "2026-08-03",
      conditions:
        "THIS IS THE CAPPED PLAN AND THE CAP IS THE WHOLE STORY. Column 8 (bunq Free Business) of the row 'Kaartbetaling (vreemde valuta)'. 0.5% applies only to the first € 1000 of foreign-currency card spend per year; above that the fee is 1.5% of the transaction amount — three times higher. Serving 0.5% here without the cap would be the same failure mode as the Revolut 0% miss. The identical cap text sits in the bunq Free (personal) column; the six paid plans (Elite/Pro/Core personal and business) carry the 0.5% cell with NO cap text. Wording quoted unfixed — 'valutaschommelin gen preventie' is the hyphenated cell as pdftotext returns it, and the ZERO-WIDTH SPACE between 'gen preventie' and 'Dit geldt voor' is in the PDF, not added by me.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-core-business-betaalpas",
    product: "bunq Core Business betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://static.bunq.com/website/documents/bunq-information-sheet-pricing-nl-nl.pdf",
      checkedAt: "2026-08-03",
      conditions:
        "SCOPE IS THE CONDITION: column 7 (bunq Core Business) of the row 'Kaartbetaling (vreemde valuta)' in the 8-column plan table, section 'Passen'. NO CAP for this plan, positively established: the same row carries 'Dit geldt voor € 1000 per jaar, daarna bedragen de kosten 1.5% van het transactiebedrag' in the bunq Free and bunq Free Business columns only. Wording quoted unfixed. The 0.5% is a spread inside the Mastercard exchange rate, not a separate fee line.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-pro-business-betaalpas",
    product: "bunq Pro Business betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://static.bunq.com/website/documents/bunq-information-sheet-pricing-nl-nl.pdf",
      checkedAt: "2026-08-03",
      conditions:
        "SCOPE IS THE CONDITION: column 6 (bunq Pro Business) of the row 'Kaartbetaling (vreemde valuta)' in the 8-column plan table, section 'Passen'. NO CAP for this plan, and that is positively established rather than assumed: the identical row prices 'Dit geldt voor € 1000 per jaar, daarna bedragen de kosten 1.5% van het transactiebedrag' in the bunq Free and bunq Free Business columns, so the document does write the cap where one exists. Wording quoted unfixed — 'valutaschommelin gen preventie' is the hyphenated cell as pdftotext returns it. The 0.5% is a spread inside the Mastercard exchange rate.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "bunq-elite-business-betaalpas",
    product: "bunq Elite Business betaalpas",
    issuer: "bunq B.V.; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://static.bunq.com/website/documents/bunq-information-sheet-pricing-nl-nl.pdf",
      checkedAt: "2026-08-03",
      conditions:
        "SCOPE IS THE CONDITION: column 5 (bunq Elite Business) of the row 'Kaartbetaling (vreemde valuta)' in the 8-column plan table, section 'Passen'. This row previously had NO figure at all in the catalog; the figure is 0.5% and it is the same in every one of the eight columns. NO CAP for this plan, positively established: the same row carries the €1000-per-year cap text in the bunq Free and bunq Free Business columns only. Wording quoted unfixed. The 0.5% is a spread inside the Mastercard exchange rate.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://help.bunq.com/articles/bunq-points",
      checkedAt: "2026-08-20",
      conditions:
        "Uitgesproken afwezigheid, geen aanname: bunq zegt zelf dat je op betalingen géén punten meer ontvangt. Sparen stopte definitief op 13 april 2026 (voor wie na 12 februari 2026 klant werd: direct geen punten). Reeds gespaarde punten blijven inwisselbaar tot 13 april 2027: “Got a stash of bunq Points which you’re ready to use? Awesome! You’ll have a full year to cash in all the points you’ve earned. You can redeem them at your own time — just be sure to use your Points before April 13, 2027 !” Historische koers t/m 13-04-2026: “Here’s how many points you can earn, depending on your subscription plan: bunq Core: 1 point per €1 spent with your card bunq Pro: 1 point per €1 spent with your card bunq Elite: 2 points per €1 spent with your card” met plafond “You can earn up to 10,000 bunq Points per month.” Wat er nu in de plaats staat is een loterij, geen puntenkoers: “We’ve combined the best of bunq Points, Cashback and Winning back Groceries to bring you daily rewards, simply for using your bunq Card! Every time you make a payment with your bunq Card, you earn a spin on the Wheel of Fortune. You can spin the wheel for a chance to win up to 10x the value of your payment back.”",
    },
    fee: null,
  },
  {
    id: "revolut-standard-betaalpas",
    product: "Revolut Standard betaalpas",
    issuer: "Revolut Bank UAB (Lithuania), in NL via passport/branch",
    kind: "betaalpas",
    fxFeePct: {
      value: 1,
      sourceUrl:
        "https://web.archive.org/web/20250719221017id_/https://www.revolut.com/nl-NL/legal/standard-fees/",
      checkedAt: "2025-07-19",
      conditions:
        "Geldt alleen boven de wissellimiet van het Standard-plan: 'Standard: wissellimiet van EUR 1.000 per maand. Daarna zijn er fair usage-kosten van 1% per geldwissel van toepassing.' Binnen de limiet en op weekdagen (tussen 18:00 uur op zondag en 17:00 uur op vrijdag, New York tijd) gelden geen kosten; bij wisselen in het weekend geldt een kost van 1%.",
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "revolut-plus-betaalpas",
    product: "Revolut Plus betaalpas",
    issuer: "Revolut Bank UAB",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://web.archive.org/web/20250808164730id_/https://www.revolut.com/nl-NL/legal/plus-fees/",
      checkedAt: "2025-08-08",
      conditions:
        'Geldt alleen boven de wissellimiet van het Plus-plan: "Plus: wissellimiet van EUR 3.000 per maand. Op alle extra geldwisseltransacties zijn er fair usage-kosten van 0,5% van toepassing." Binnen de limieten gelden geen kosten bij wisselen op weekdagen (tussen 18:00 uur op zondag en 17:00 uur op vrijdag, New York tijd); in het weekend geldt een kost van 1%. Kaartbetalingen in vreemde valuta waarvoor in realtime moet worden gewisseld, tellen mee voor deze fair usage-limiet.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "revolut-premium-betaalpas",
    product: "Revolut Premium betaalpas",
    issuer: "Revolut Bank UAB",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://www.revolut.com/nl-NL/legal/premium-fees/",
      checkedAt: "2026-07-09",
      conditions:
        'Geen wissellimiet en geen fair usage-kosten op het Premium-plan: "Premium, Metal en Ultra: Geen wissellimiet. Geen fair usage-kosten." Dezelfde bulletlijst zet Standard op 1% en Plus op 0,5%, dus de rijtoewijzing rust op dezelfde vorm als die twee al gepinde cijfers. DE WEEKENDCLAUSULE IS NIET OPTIONEEL, want zonder haar is de nul niet waar: hij is aan de klok gebonden en niet aan de limiet. "Er gelden geen kosten als je geld wisselt op weekdagen (tussen 18:00 uur op zondag en 17:00 uur op vrijdag, New York tijd) en binnen de limieten van je plan. Als je in het weekend geld wisselt (tussen 17:00 uur op vrijdag en 18:00 uur op zondag, New York tijd) geldt er een kost van 1%." Kaartbetalingen in vreemde valuta waarvoor in realtime gewisseld moet worden vallen hieronder, en Revolut waarschuwt zelf dat juist daar de totale kosten niet vooraf te tonen zijn. Het abonnementsgeld van het plan is een aparte post en staat op de rij revolut-premium. De datum is de eigen ingangsdatum van het document: "Deze versie van de voorwaarden is van toepassing vanaf 9 juli 2026, tenzij anders aangegeven is." Route: elk plan heeft nu zijn eigen per-plan-URL; revolut.com weigert curl en node fetch met 403, maar r.jina.ai geeft deze pagina volledig terug (200, 16.444 bytes).',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "revolut-metal-betaalpas",
    product: "Revolut Metal betaalpas",
    issuer: "Revolut Bank UAB",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://www.revolut.com/nl-NL/legal/metal-fees/",
      checkedAt: "2026-07-09",
      conditions:
        'Zelfde cijfer en zelfde voorwaarden als Revolut Premium, maar uit de EIGEN tarievenpagina van het Metal-plan; die is apart opgehaald en niet uit de Premium-pagina afgeleid. "Premium, Metal en Ultra: Geen wissellimiet. Geen fair usage-kosten." DE WEEKENDCLAUSULE STAAT OOK OP DEZE PAGINA en hoort erbij: "Er gelden geen kosten als je geld wisselt op weekdagen (tussen 18:00 uur op zondag en 17:00 uur op vrijdag, New York tijd) en binnen de limieten van je plan. Als je in het weekend geld wisselt (tussen 17:00 uur op vrijdag en 18:00 uur op zondag, New York tijd) geldt er een kost van 1%." Het abonnementsgeld van het plan staat op de rij revolut-metal. De datum is de eigen ingangsdatum van het document (9 juli 2026). Route: r.jina.ai geeft de pagina volledig terug (200, 16.552 bytes) waar curl 403 krijgt.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "n26-standard-betaalpas",
    product: "N26 Standard betaalpas",
    issuer: "N26 Bank AG (Germany) — German IBAN even for Dutch residents; Mastercard Debit",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "WORDING CAVEAT — the document expresses the 0 as words, not a numeral: the row reads 'Free' + 'Conversion to real exchange rate without foreign currency surcharge'. No '0' appears in the row, so a literal value-in-quote check will fail on this and the other zero-FX findings; the value-in-DOCUMENT and quote-in-document checks both pass. SCOPE: the price list's cover names the countries it governs and the Netherlands is on that list ('Price List applicable to users who register with an address in Belgium, Denmark, Estonia, Finland, Greece, Iceland, Ireland, Latvia, Liechtenstein, Lithuania, Luxembourg, Netherlands, Norway, Poland, Portugal, Slovakia, Slovenia, Sweden, Switzerland'). The 0% is CARD PAYMENTS only. Cash withdrawal in a foreign currency is NOT free on this plan: the separate row 'Mastercard withdrawals at ATMs in other currencies:' gives 'For Business, Current Account, N26 Smart, N26 Business Smart                 1.7% of amount drawn' — the standard N26 account is the 'Current Account' line, so 1.7% applies to Standard. EUR-ATM fair-use is separate again (2 free withdrawals/calendar month, EUR 2.00 each thereafter).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "Geen puntenprogramma bij de particuliere N26-plannen. Wel cashback, maar alleen op N26 Business (0,1%) en N26 Business Metal (0,5%) — producten die niet in deze catalogus staan.",
    },
    fee: null,
  },
  {
    id: "n26-smart-betaalpas",
    product: "N26 Smart betaalpas",
    issuer: "N26 Bank AG; Mastercard Debit",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "WORDING CAVEAT — the 0 is written as 'Free' / 'without foreign currency surcharge'; no numeral in the row. SCOPE: NL is named on the price list's country cover. The FX row is not plan-differentiated — one row covers all N26 plans. 0% is CARD PAYMENTS only; foreign-currency ATM withdrawals cost 1.7% on Smart: 'For Business, Current Account, N26 Smart, N26                 1.7% of amount drawn'. EUR-ATM fair use on Smart is 3 free withdrawals per calendar month, EUR 2.00 each thereafter. Smart costs '4.90 € per month (membership fee)'.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "Geen puntenprogramma bij de particuliere N26-plannen. Wel cashback, maar alleen op N26 Business (0,1%) en N26 Business Metal (0,5%) — producten die niet in deze catalogus staan.",
    },
    fee: null,
  },
  {
    id: "n26-go-betaalpas",
    product: "N26 Go betaalpas",
    issuer: "N26 Bank AG; Mastercard Debit",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "WORDING CAVEAT — the 0 is written as 'Free' / 'without foreign currency surcharge'; no numeral in the row. SCOPE: NL named on the price list's country cover. Unlike Standard/Smart, Go ALSO gets foreign-currency ATM withdrawals free: 'For, N26 Go, N26 Business Go, N26 Metal and N26               Free / Business Metal users'. EUR-ATM fair use on Go is 5 free withdrawals per calendar month, EUR 2.00 each thereafter.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "Geen puntenprogramma bij de particuliere N26-plannen. Wel cashback, maar alleen op N26 Business (0,1%) en N26 Business Metal (0,5%) — producten die niet in deze catalogus staan.",
    },
    fee: null,
  },
  {
    id: "n26-metal-betaalpas",
    product: "N26 Metal betaalpas",
    issuer: "N26 Bank AG; metal Mastercard Debit",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "WORDING CAVEAT — the 0 is written as 'Free' / 'without foreign currency surcharge'; no numeral in the row. SCOPE: NL named on the price list's country cover. Metal also gets foreign-currency ATM withdrawals free ('For, N26 Go, N26 Business Go, N26 Metal and N26               Free'). EUR-ATM fair use on Metal is 8 free withdrawals per calendar month, EUR 2.00 each thereafter. Metal costs '16.90 € per month (membership fee)'; a replacement Metal card is 45.00 €.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://docs.n26.com/legal/06+EU/01+Account/en/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditions:
        "Geen puntenprogramma bij de particuliere N26-plannen. Wel cashback, maar alleen op N26 Business (0,1%) en N26 Business Metal (0,5%) — producten die niet in deze catalogus staan.",
    },
    fee: null,
  },
  {
    id: "trade-republic-betaalpas",
    product: "Trade Republic betaalpas",
    issuer: "Trade Republic Bank GmbH (Germany), Nederlandse vestiging Amsterdam; Visa debit",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://traderepublic.com/nl-nl/kaart/_payload.json",
      checkedAt: "2026-05-11",
      conditions:
        "WORDING CAVEAT — the 0 is written as 'brengen wij geen extra omwisselkosten in rekening'; no numeral. The rate applied is Visa's, not Trade Republic's own: a second entry on the same page reads 'Je profiteert direct van de leidende Visa-wisselkoersen bij uitgaven in het buitenland. We rekenen geen valutawisselvergoedingen.' DCC WARNING published by the issuer itself: 'Betaal altijd in de lokale valuta als je erom wordt gevraagd, anders kunnen verkopers extra valutawisselvergoedingen rekenen.' ATM: free worldwide but only above € 100 per withdrawal — a separate entry states 'Voor opnames onder de €100 € geldt een vergoeding van €1.' Card carries no subscription fee. All Trade Republic card tiers share these terms ('bieden allemaal dezelfde voordelen').",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: {
      value: 0,
      period: "maand",
      sourceUrl: "https://traderepublic.com/nl-nl/kaart/_payload.json",
      checkedAt: "2025-09-10",
      conditions:
        "Eenmalige kosten voor de fysieke kaart komen er wel: virtuele kaart gratis, Classic kaart € 5 eenmalig, Mirror kaart € 50 eenmalig. De pagina zegt daarnaast 'Wij rekenen geen kosten voor onze betaalrekening'. De payload noemt geen ingangsdatum, alleen een updatedAt per veld. Uitgesproken nul.",
    },
  },
  {
    id: "212-card",
    product: "212 Card",
    issuer:
      "Paynetics (card issuer); NL customers under Trading 212 Markets Ltd (Cyprus) or Trading 212 EU GmbH (Germany)",
    kind: "betaalpas",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://helpcentre.trading212.com/hc/en-us/articles/17749229128221-Can-I-use-the-card-if-I-travel-abroad",
      checkedAt: "2026-08-19",
      conditions:
        'Applies to card payments/transactions: "All card transactions have 0% FX fee, even if the purchase is in a currency the customer doesn\'t hold. Other fees may apply." The separate "0.15% FX fee applies only when the customer manually converts money in the app ... It does not apply to card payments." Card use abroad is possible only "as long as the payment is executed within one of the supported countries".',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "maand",
      sourceUrl:
        "https://helpcentre.trading212.com/hc/en-us/articles/19288398028317-What-are-the-fees-for-using-the-212-card",
      checkedAt: "2026-01-26",
      conditions:
        "Er is wél een eenmalige uitgiftevergoeding voor de fysieke kaart; die staat in een apart artikel zonder bedrag ('You will see it upon completing your order'). Het bedrag is dus onbekend, niet nul. Uitgesproken nul geldt alleen voor de doorlopende onderhoudskosten.",
    },
  },
  {
    id: "openbank-betaalpas-r42-betaalpas",
    product: "Openbank betaalpas (R42 Betaalpas)",
    issuer: "Open Bank S.A. (Spain, Santander group) — Spanish IBAN used in NL; Mastercard",
    kind: "betaalpas",
    fxFeePct: {
      value: 1.5,
      sourceUrl:
        "https://www.openbank.nl/assets/static/nl/pdf/Products/Precontractuele_informatie_Betaalpas_Maestro_Mastercard_NL.pdf",
      checkedAt: "2026-08-19",
      conditions:
        'Geldt in de kolom "Travel + uitgeschakeld" voor "Aankopen in buitenlandse valuta (niet €)"; met "Travel+ ingeschakeld" (€ 4,99/maand abonnementskosten) is dit € 0',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl:
        "https://www.openbank.nl/assets/static/nl/pdf/Products/Precontractuele_informatie_Betaalpas_Maestro_Mastercard_NL.pdf",
      checkedAt: "2024-07-01",
      conditions: "Geen puntenprogramma op deze betaalpas.",
    },
    fee: {
      value: 0,
      period: "maand",
      sourceUrl:
        "https://www.openbank.nl/assets/static/nl/pdf/Products/Precontractuele_informatie_Betaalpas_Maestro_Mastercard_NL.pdf",
      checkedAt: "2024-07-01",
      conditions:
        "Abonnementskosten zijn € 0 zolang Travel+ uit staat; met Travel+ ingeschakeld € 4,99 per maand. Verzendkosten € 0 in beide gevallen. Uitgesproken nul.",
    },
  },
  {
    id: "american-express-blue-card",
    product: "American Express Blue Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        'Geldt voor een "Transactie in vreemde valuta": wisselkoersopslag op het omgewisselde bedrag in euro, d.w.z. "de wisselkoersopslag voor transacties die niet in euro zijn uitgevoerd"; bij een transactie die eerst in USD en dan in euro\'s wordt omgezet brengen wij "slechts eenmaal een wisselkoersopslag in rekening"; als u een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) toestaat de transactie in euro\'s om te zetten voordat deze aan ons wordt voorgelegd, "zullen wij geen wisselkoersopslag in rekening brengen". Deze overeenkomst geldt voor American Express Consumenten Kaarthouders (per maart 2022).',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0.5,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/blue-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: {
      value: 0,
      period: "jaar",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "The Blue Card € 0 per jaar" met voetnoot 1: "Bij een minimale besteding van € 3.000 per jaar. Anders kost de kaart € 35 per jaar." De nul geldt dus alleen bij een minimale besteding van € 3.000 per jaar; wie die niet haalt betaalt € 35 per jaar. Inclusief 2 extra kaarten, daarna € 15 per jaar per extra kaart. De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag.',
    },
  },
  {
    id: "american-express-green-card",
    product: "American Express Green Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        "Wisselkoersopslag op het omgewisselde bedrag in euro bij transacties in vreemde valuta; volgens 6.15 geldt de opslag voor 'transacties die niet in euro zijn uitgevoerd', wordt bij omzetting via de VS-dollar slechts eenmaal een wisselkoersopslag in rekening gebracht, en brengen wij geen wisselkoersopslag in rekening wanneer een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) de transactie al in euro's heeft omgezet.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/green-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: {
      value: 6.5,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "The Green Card € 6,50 per maand", inclusief 2 extra kaarten; daarna € 30 per jaar per extra kaart. De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag. De productpagina noemt op 21 augustus 2026 hetzelfde bedrag, maar draagt geen datum.',
    },
  },
  {
    id: "american-express-gold-card",
    product: "American Express Gold Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        "Wisselkoersopslag op het omgewisselde bedrag in euro, voor transacties (en terugbetalingen) die niet in euro zijn uitgevoerd; bij omrekening via Amerikaanse dollars wordt slechts eenmaal een wisselkoersopslag in rekening gebracht; als u een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) toestaat de transactie vóór verwerking in euro's om te zetten, brengen wij geen wisselkoersopslag in rekening. Geldt volgens de Overeenkomst voor de American Express Consumenten Kaarthouders (per maart 2022).",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/gold-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: {
      value: 20,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "The Gold Card € 20,00 per maand", inclusief 4 extra Green Cards; daarna € 85 per jaar per extra kaart. De aanvraagbrochure van dezelfde kaart zegt hetzelfde in jaarvorm: "De jaarbijdrage die u betaalt is € 240 per jaar (€ 20 per maand)". De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag.',
    },
  },
  {
    id: "american-express-platinum-card",
    product: "American Express Platinum Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        'Geldt onder de "Overeenkomst voor de American Express Consumenten Kaarthouders" (per maart 2022) voor transacties in vreemde valuta: de wisselkoersopslag geldt "voor transacties die niet in euro zijn uitgevoerd" en wordt berekend op het omgewisselde bedrag in euro; bij een transactie in een andere vreemde valuta dan Amerikaanse dollars wordt eerst naar dollars en dan naar euro\'s omgezet, maar "brengen wij slechts eenmaal een wisselkoersopslag in rekening"; als u een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) toestaat de transactie in euro\'s om te zetten voordat deze aan ons wordt voorgelegd, "zullen wij geen wisselkoersopslag in rekening brengen".',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/platinum-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: {
      value: 65,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "The Platinum Card € 65,00 per maand / Inclusief: 4 extra Green Cards", met daarnaast "Extra Platinum kaart (maximum 1 kaart): € 10 per maand" en "Extra Green kaart € 10 per maand". Amex noemt deze bijdrage zelf per maand; er is niet omgerekend. De datum is het versiestempel FEE_CONS_V7_240704_NL dat boven de titel en in de voettekst van het document staat — hetzelfde stempel dat de zeven andere Amex-consumentenkaarten in deze catalogus dateert. LET OP HET VERSCHIL MET DE PRODUCTPAGINA: americanexpress.com/nl-nl/creditcard/platinum-card zegt "Kosten: € 75 per maand", maar die pagina draagt geen enkele datum (alleen "Copyright © 2026") en kwam daarom niet door de eis. Amex heeft de bijdrage dus vermoedelijk verhoogd van 65 naar 75 en dit bedrag is een ONDERGRENS, geen actuele prijs. Het gedateerde stuk is aangehouden omdat de eis de documentdatum voorschrijft; wie een nieuwer gedateerd tarievenblad vindt, hoort dit veld te vervangen. De rest van beide bronnen spreekt elkaar niet tegen: de extra Platinum-kaart staat op beide plaatsen op € 10 per maand en vier extra Green Cards zijn op beide plaatsen inbegrepen.',
    },
  },
  {
    id: "flying-blue-american-express-entry-card",
    product: "Flying Blue - American Express Entry Card",
    issuer: "American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        "Wisselkoersopslag op het omgewisselde bedrag in euro bij een transactie in vreemde valuta, d.w.z. de wisselkoersopslag voor transacties die niet in euro zijn uitgevoerd; bij omzetting via Amerikaanse dollars wordt slechts eenmaal een wisselkoersopslag in rekening gebracht, en als u een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) toestaat de transactie in euro's om te zetten voordat deze aan American Express wordt voorgelegd, wordt geen wisselkoersopslag in rekening gebracht",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0.5,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/flying-blue-entry-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Koers geldt voor ‘overige uitgaven’; bij Air France, KLM en Hertz is de koers 0,5 Miles per euro. Minimum uitgave is € 1. De volgende uitgaven leveren geen Miles op: kaartlidmaatschapsbijdrage, storneringskosten, vergoedingen, toeslagen, boetes voor te late betalingen en opname van contant geld , aankopen van American Express Travellers Cheques en vreemde valuta, restituties of andere vormen van creditering. Afronding: ‘De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde euro en vervolgens worden de Miles [toegekend]’. Miles van een extra kaart gaan naar het Flying Blue-account van de hoofdkaarthouder.",
    },
    fee: {
      value: 3,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "De Flying Blue - American Express Entry Card € 3,00 per maand", inclusief 2 extra kaarten; een extra kaarthouder is voor deze kaart "niet van toepassing". De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag.',
    },
  },
  {
    id: "flying-blue-american-express-silver-card",
    product: "Flying Blue - American Express Silver Card",
    issuer: "American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        'Geldt als wisselkoersopslag op het omgewisselde bedrag in euro bij een transactie in vreemde valuta ("de wisselkoersopslag voor transacties die niet in euro zijn uitgevoerd"); bij transacties in andere valuta dan de Amerikaanse dollar wordt via USD omgerekend maar wordt slechts eenmaal een wisselkoersopslag in rekening gebracht; wanneer een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) de transactie in euro\'s omzet voordat deze aan American Express wordt voorgelegd, wordt geen wisselkoersopslag in rekening gebracht. Voorwaarden gelden voor de American Express Consumenten Kaarthouders (overeenkomst per maart 2022).',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0.8,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/flying-blue-silver-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Koers geldt voor ‘overige uitgaven’; bij Air France, KLM en Hertz is de koers 1 Miles per euro. Minimum uitgave is € 1. De volgende uitgaven leveren geen Miles op: kaartlidmaatschapsbijdrage, storneringskosten, vergoedingen, toeslagen, boetes voor te late betalingen en opname van contant geld , aankopen van American Express Travellers Cheques en vreemde valuta, restituties of andere vormen van creditering. Afronding: ‘De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde euro en vervolgens worden de Miles [toegekend]’. Miles van een extra kaart gaan naar het Flying Blue-account van de hoofdkaarthouder.",
    },
    fee: {
      value: 6.25,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "De Flying Blue - American Express Silver Card € 6,25 per maand", inclusief 2 extra kaarten; een extra kaarthouder is voor deze kaart "niet van toepassing". De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag.',
    },
  },
  {
    id: "flying-blue-american-express-gold-card",
    product: "Flying Blue - American Express Gold Card",
    issuer: "American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        "Wisselkoersopslag op het omgewisselde bedrag in euro bij een transactie in vreemde valuta; geldt volgens 6.15 voor 'transacties die niet in euro zijn uitgevoerd' en wordt slechts eenmaal in rekening gebracht (ook als eerst naar Amerikaanse dollars en dan naar euro's wordt omgezet). Wanneer u een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) toestaat de transactie in euro's om te zetten voordat deze aan ons wordt voorgelegd, brengen wij geen wisselkoersopslag in rekening. Dit is de algemene overeenkomst voor American Express Consumenten Kaarthouders; er wordt geen apart tarief voor de Flying Blue Gold Card genoemd.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/flying-blue-gold-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Koers geldt voor ‘overige uitgaven’; bij Air France, KLM en Hertz is de koers 1,5 Miles per euro. Minimum uitgave is € 1. De volgende uitgaven leveren geen Miles op: kaartlidmaatschapsbijdrage, storneringskosten, vergoedingen, toeslagen, boetes voor te late betalingen en opname van contant geld , aankopen van American Express Travellers Cheques en vreemde valuta, restituties of andere vormen van creditering. Afronding: ‘De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde euro en vervolgens worden de Miles [toegekend]’. Miles van een extra kaart gaan naar het Flying Blue-account van de hoofdkaarthouder.",
    },
    fee: {
      value: 16.5,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "De Flying Blue - American Express Gold Card € 16,50 per maand", inclusief 2 extra kaarten; een extra kaarthouder is voor deze kaart "niet van toepassing". De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag.',
    },
  },
  {
    id: "flying-blue-american-express-platinum-card",
    product: "Flying Blue - American Express Platinum Card",
    issuer: "American Express (self-issued in NL; co-brand with Flying Blue / KLM-Air France)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-03-01/overeenkomst-voor-consumenten-american-express-kaarthouders-maart-2022.pdf",
      checkedAt: "2022-03-01",
      conditions:
        'Wisselkoersopslag op het omgewisselde bedrag in euro bij een transactie in vreemde valuta, ofwel "de wisselkoersopslag voor transacties die niet in euro zijn uitgevoerd"; geldt onder deze Overeenkomst voor de American Express Consumenten Kaarthouders (niet productspecifiek geprijsd per kaart). Laat u een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) de transactie in euro\'s omzetten voordat deze aan American Express wordt voorgelegd, dan "zullen wij geen wisselkoersopslag in rekening brengen".',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1.5,
      sourceUrl: "https://www.americanexpress.com/nl-nl/creditcard/flying-blue-platinum-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Koers geldt voor ‘overige uitgaven’; bij Air France, KLM en Hertz is de koers 2 Miles per euro. Minimum uitgave is € 1. De volgende uitgaven leveren geen Miles op: kaartlidmaatschapsbijdrage, storneringskosten, vergoedingen, toeslagen, boetes voor te late betalingen en opname van contant geld , aankopen van American Express Travellers Cheques en vreemde valuta, restituties of andere vormen van creditering. Afronding: ‘De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde euro en vervolgens worden de Miles [toegekend]’. Miles van een extra kaart gaan naar het Flying Blue-account van de hoofdkaarthouder.",
    },
    fee: {
      value: 55,
      period: "maand",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/bedrijf/legaal/website-regels-en-voorschriften/FEE_CONS_V7_240704_NL.pdf",
      checkedAt: "2024-07-04",
      conditions:
        '"Overzicht Kaartlidmaatschapsbijdragen", rij "De Flying Blue - American Express Platinum Card € 55,00 per maand", inclusief 1 extra Platinum Card en 4 extra Gold Cards. De datum is het versiestempel FEE_CONS_V7_240704_NL dat in het document zelf staat, boven de titel en in de voettekst. Dat 240704 een datum is en geen volgnummer blijkt uit de voorganger V6, die op dezelfde legal-pagina staat, hetzelfde stempel draagt en 4 juli 2024 als aanmaakdatum heeft; V6 en V7 noemen voor deze kaart hetzelfde bedrag.',
    },
  },
  {
    id: "american-express-business-entry-card",
    product: "American Express Business Entry Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2023-03-15/NL-Overeenkomst-voor-de-American-Express-Business-Card-15032023.pdf",
      checkedAt: "2023-03-15",
      conditions:
        'Geldt als "wisselkoersopslag op het omgewisselde bedrag in euro" bij een "Transactie in vreemde valuta", d.w.z. "de wisselkoersopslag voor transacties die niet in Euro zijn uitgevoerd"; bij een transactie in andere valuta dan USD wordt eerst naar dollars en dan naar euro\'s omgezet, maar "wij brengen slechts eenmaal een wisselkoersopslag in rekening"; laat de kaarthouder een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) de transactie in euro\'s omzetten, dan "zullen wij geen wisselkoersopslag in rekening brengen". Document is de Overeenkomst voor de American Express Business Card per 15 maart 2023.',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/en-nl/business/cards/business-entry-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: null,
  },
  {
    id: "american-express-business-green-card",
    product: "American Express Business Green Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2023-03-15/NL-Overeenkomst-voor-de-American-Express-Business-Card-15032023.pdf",
      checkedAt: "2023-03-15",
      conditions:
        "Wisselkoersopslag op het omgewisselde bedrag in euro bij een 'Transactie in vreemde valuta', d.w.z. de wisselkoersopslag voor transacties die niet in Euro zijn uitgevoerd; geldt onder de Overeenkomst voor de American Express Business Card (per 15 maart 2023). Als een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) de transactie vóór indiening in euro's omzet, geldt: 'zullen wij geen wisselkoersopslag in rekening brengen'.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl:
        "https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-companion-card/green/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: null,
  },
  {
    id: "american-express-business-gold-card",
    product: "American Express Business Gold Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2023-03-15/NL-Overeenkomst-voor-de-American-Express-Business-Card-15032023.pdf",
      checkedAt: "2023-03-15",
      conditions:
        "Geldt volgens deze overeenkomst voor de American Express Business Card: wisselkoersopslag op het omgewisselde bedrag in euro bij transacties die niet in Euro zijn uitgevoerd; bij niet-dollartransacties wordt eerst naar Amerikaanse dollars en dan naar euro's omgezet maar slechts eenmaal een wisselkoersopslag in rekening gebracht; als een derde partij (bijvoorbeeld het kaartaccepterende bedrijf) de transactie al in euro's omzet, brengen wij geen wisselkoersopslag in rekening.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl:
        "https://www.americanexpress.com/nl-nl/zakelijk/kaarten/business-companion-card/gold/",
      checkedAt: "2026-08-20",
      conditions:
        "Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: {
      value: 270,
      period: "jaar",
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl-nl/zakelijk/kaarten/business-gold-card/pdf/xsell-26Q2-actievoorwaarden-business-gold-card.pdf",
      checkedAt: "2026-06-02",
      conditions:
        "Het eerste jaar kosteloos zolang je een American Express consumentenkaart blijft gebruiken; daarna € 270 per jaar. Aanvragen kan als het bedrijf minimaal 12 maanden bij de KvK staat ingeschreven. LET OP: de bron is een actievoorwaarden-PDF die gold van 2 tot en met 30 juni 2026 — het eerstejaarsaanbod is dus verlopen, het jaarbedrag van € 270 staat ook op de Business Companion Gold-pagina (die geen datum draagt).",
    },
  },
  {
    id: "american-express-corporate-card",
    product: "American Express Corporate Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-12-15/NL_Proprietary_Corporate_Cardmember_TCs_Dec2022.pdf",
      checkedAt: "2022-12-15",
      conditions:
        'Wisselkoersopslag van 2,5% op de American Express-wisselkoers, verschuldigd zodra een Transactie of creditering niet in euro\'s is: "Een wisselkoersopslag van 2,5% is verschuldigd wanneer een bij ons ingediende Transactie in een andere valuta dan de euro plaatsvindt of als we een creditering ontvangen in een andere valuta dan de euro." Artikel 11 (Transacties in vreemde valuta) zegt het een tweede keer: "Deze koers wordt de ‘American Express-wisselkoers’ genoemd en wordt vermeerderd met een wisselkoersopslag van 2,5%." DIT IS HET DOCUMENT VAN DE CORPORATE CARD ZELF — de kop luidt "AMERICAN EXPRESS® CORPORATE CARD / Kaarthouder Algemene Voorwaarden" — en de rij stond leeg terwijl de Corporate Gold Card al uit ditzelfde stuk was gepind. De opslag valt weg bij DCC ("Aangezien een Transactie die via de derde wordt omgerekend, bij ons wordt ingediend in de Euro\'s, zullen we geen wisselkoersopslag in rekening brengen") — dat is Amex\' eigen tekst en geen advies om DCC te kiezen, want de derde partij rekent dan zijn eigen koers en commissie. Transacties buiten de dollar lopen via Amerikaanse dollars en de opslag wordt dan slechts eenmaal gerekend. Contante opnames zijn een aparte post: 3,8% van het opgenomen bedrag met een minimum van € 4,50. De datum is die van het document: het URL-pad zegt 2022-12-15 en de PDF-CreationDate 7 december 2022. BESCHIKBAARHEID: dit is een kaart die een werkgever uitgeeft, en state.json zet availableToNL op false. Dat is een reden om hem niet aan te raden, geen reden om het cijfer onbekend te laten.',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/en-nl/business/welcome/corporate-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Alleen als de werkgever het toestaat en na aparte inschrijving, tegen een eigen jaarbijdrage: ‘If the company allows it, you can participate in the Membership Rewards Programme for an annual fee of €25.’ en ‘It is required to register for the Membership Rewards Programme.’ Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: null,
  },
  {
    id: "american-express-corporate-gold-card",
    product: "American Express Corporate Gold Card",
    issuer: "American Express (self-issued in NL; NOT ICS)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-12-15/NL_Proprietary_Corporate_Cardmember_TCs_Dec2022.pdf",
      checkedAt: "2022-12-15",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/en-nl/business/welcome/corporate-gold-card/",
      checkedAt: "2026-08-20",
      conditions:
        "Alleen als de werkgever het toestaat en na aparte inschrijving tegen €25 per jaar: ‘If the company allows it, you can participate in the Membership Rewards Programme for an annual fee of €25.’ Punten worden niet verdiend op: • rente, vergoedingen (inclusief vergoedingen ingeval van achterstallige betaling), contante opnamen (inclusief transacties die als contante opnamen worden beschouwd), het opladen van prepaid kaarten, aankopen van American Express Travellers Cheques en vreemde valuta; en • bedragen die zijn bijgeschreven op uw Kaartrekening door middel van restituties of andere vormen van crediteringen. De waarde van elke aankoop wordt afgerond op de dichtstbijzijnde EUR en vervolgens worden de Punten toegekend op basis van elke hele EUR die u hebt besteed. Deelname aan het Programma is inbegrepen bij uw jaarlijkse kaartlidmaatschapsbijdrage, tenzij u zichzelf afzonderlijk hebt ingeschreven voor het Programma Essentials, Classic of Accelerator in welk geval een jaarlijkse vergoeding van respectievelijk EUR 15, EUR 25 of EUR 40 (inclusief BTW) in rekening zal worden gebracht.",
    },
    fee: null,
  },
  {
    id: "klm-american-express-corporate-card",
    product: "KLM American Express Corporate Card",
    issuer: "American Express (self-issued in NL; co-brand with KLM / Flying Blue / bluebiz)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.americanexpress.com/content/dam/amex/nl/assets/pdf/voorwaarden-en-overeenkomsten/2022-12-15/NL_KLM_Corporate_Cardmember_TCs_Dec2022.pdf",
      checkedAt: "2026-08-19",
      conditions:
        "Verschuldigd wanneer een bij ons ingediende Transactie in een andere valuta dan de euro plaatsvindt of als we een creditering ontvangen in een andere valuta dan de euro; de opslag komt bovenop de American Express-wisselkoers. Wordt de Transactie door een derde (bijvoorbeeld het Kaartaccepterend Bedrijf) vóór indiening omgerekend in Euro's, dan brengen wij geen wisselkoersopslag in rekening. Geldt voor de KLM American Express Corporate Card; contante opnames kennen daarnaast een aparte vergoeding van 3,8%.",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 1,
      sourceUrl: "https://www.americanexpress.com/en-nl/business/welcome/corporate-klm-card/",
      checkedAt: "2026-08-20",
      conditions:
        "1 Mile per euro op overige aankopen, 1,5 Miles per euro bij boekingen bij KLM, Air France, Transavia en Hertz. Voorwaarde: de werkgever moet het goedkeuren (‘If your company approves this’). Deelname zit inbegrepen, dus geen €25 zoals bij de gewone Corporate Card.",
    },
    fee: null,
  },
  {
    id: "ics-visa-world-card",
    product: "ICS Visa World Card",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card",
      checkedAt: "2026-08-18",
      conditions: "voor EU landen zonder euro en voor landen buiten EU",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 42.95,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260519164655id_/https://www.icscards.nl/info/visa-world-card-jaarbijdrage",
      checkedAt: "2025-06-01",
      conditions:
        'Wijzigingspagina "Wijziging jaarbijdrage van de Visa World Card (Panda)": "de jaarbijdrage van uw World Card (Panda) vanaf 1 juni 2025" en "Waarom wordt de jaarbijdrage voor de World Card € 42,95?". Een Extra Card kost € 21,95 per jaar. ICS heeft die pagina van de site gehaald (de live URL geeft 404), dus gelezen is de Wayback-kopie van 19 mei 2026; het bedrag staat op 21 augustus 2026 nog steeds zo op icscards.nl/creditcards-vergelijken.',
    },
  },
  {
    id: "ics-visa-world-card-gold",
    product: "ICS Visa World Card Gold",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/webdocuments/624/Algemene%20Voorwaarden%20ICS%20-%20121",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card-gold",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 57.95,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260415092101id_/https://www.icscards.nl/info/visa-world-card-gold-jaarbijdrage-extra-card",
      checkedAt: "2025-04-01",
      conditions:
        'Tabel op de wijzigingspagina van de Extra Card: kolommen "Huidige jaarbijdrage" en "Vanaf 1 april 2025", rij "Hoofd Card" € 57,95 in allebei; alleen de Extra Card gaat van € 5 naar € 15. Per 15 september 2026 gaat de jaarbijdrage naar € 59,50 — de aparte ICS-pagina daarover staat live en noemt dat bedrag. De pagina met de tabel geeft live een 404, dus gelezen is de Wayback-kopie van 15 april 2026.',
    },
  },
  {
    id: "ics-visa-world-card-platinum",
    product: "ICS Visa World Card Platinum",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card-platinum",
      checkedAt: "2026-08-18",
      conditions: "voor EU landen zonder euro en voor landen buiten EU",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card-platinum",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 175,
      period: "jaar",
      sourceUrl: "https://www.icscards.nl/tips/wat-kost-een-creditcard",
      checkedAt: "2026-04-30",
      conditions:
        'Tarieventabel op "Wat kost een creditcard?", die zichzelf dateert met "Gepubliceerd op 3 mrt 2025, laatst bijgewerkt op 30 apr 2026". Dat is een bijwerkdatum en geen ingangsdatum; die is er voor deze kaart niet, want de eigen wijzigingspagina van ICS noemt alleen een jaartal ("vanaf 2025", Hoofd Card van € 164,95 naar € 175). Een Extra Card kost € 25 per jaar.',
    },
  },
  {
    id: "ics-visa-world-card-panda",
    product: "ICS Visa World Card Panda",
    issuer:
      "International Card Services B.V. (ICS, an ABN AMRO subsidiary) — co-brand with Wereld Natuur Fonds (WWF)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card-panda",
      checkedAt: "2026-08-18",
      conditions: "voor EU landen zonder euro en voor landen buiten EU",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/visa-world-card-panda",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 42.95,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260519164655id_/https://www.icscards.nl/info/visa-world-card-jaarbijdrage",
      checkedAt: "2025-06-01",
      conditions:
        'Dezelfde wijzigingspagina als de gewone World Card, en die noemt de Panda in zijn eigen titel: "Wijziging jaarbijdrage van de Visa World Card (Panda)", "vanaf 1 juni 2025", "€ 42,95". Een Extra Card kost € 21,95 per jaar. De live URL geeft 404, dus gelezen is de Wayback-kopie van 19 mei 2026; icscards.nl/creditcards-vergelijken noemt de Panda op 21 augustus 2026 nog los, met hetzelfde bedrag.',
    },
  },
  {
    id: "ics-mastercard-classic",
    product: "ICS Mastercard Classic",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/mastercard-classic",
      checkedAt: "2026-08-18",
      conditions: "2% voor EU landen zonder euro en voor landen buiten EU",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/mastercard-classic",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 38.95,
      period: "jaar",
      sourceUrl: "https://www.icscards.nl/info/mastercard-classic-jaarbijdrage",
      checkedAt: "2026-06-01",
      conditions:
        '"Bekijk op deze pagina de antwoorden op vragen over de jaarbijdrage van uw Mastercard Classic vanaf 1 juni 2026", met "Waarom wordt de jaarbijdrage voor de Mastercard Classic € 38,95?". Een Extra Card blijft € 21,95 per jaar.',
    },
  },
  {
    id: "ics-mastercard-gold",
    product: "ICS Mastercard Gold",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/mastercard-gold",
      checkedAt: "2026-08-18",
      conditions: "voor EU landen zonder euro en voor landen buiten EU",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/mastercard-gold",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 45,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260210001645id_/https://www.icscards.nl/info/ics-mastercard-gold-jaarbijdrage",
      checkedAt: "2025-04-01",
      conditions:
        '"... de jaarbijdrage van uw Mastercard Gold vanaf 1 april 2025", met "Gewijzigde jaarbijdrages Mastercard Gold Hoofd Card: € 42,95 naar € 45". Een Extra Card kost € 15 per jaar. Per 15 september 2026 gaat de jaarbijdrage naar € 46,50: dezelfde URL is live inmiddels herschreven naar dat nieuwe bedrag, en daarom is hier de Wayback-kopie van 10 februari 2026 gelezen. Dat de € 45 vandaag nog geldt staat op icscards.nl/creditcards-vergelijken-mastercard.',
    },
  },
  {
    id: "ics-mastercard-black",
    product: "ICS Mastercard Black",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/mastercard-black",
      checkedAt: "2026-08-19",
      conditions: "geldt voor EU landen zonder euro en voor landen buiten EU",
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/creditcard-aanvragen/mastercard-black",
      checkedAt: "2026-08-20",
      conditions:
        "Geen puntenprogramma. ‘Sparen’ betekent bij ICS spaarRENTE op een creditsaldo op de kaart, niet punten; en ‘ICS Specials’ zijn winkelkortingen. De Algemene Voorwaarden van ICS bevatten geen enkel loyaliteits- of puntenartikel (gecontroleerd met pdftotext op de AV-PDF's van 2026).",
    },
    fee: {
      value: 225,
      period: "jaar",
      sourceUrl: "https://www.icscards.nl/nieuwe-reisservices-en-jaarbijdrage-mastercard-black",
      checkedAt: "2025-07-01",
      conditions:
        '"Toename van kosten zorgt ervoor dat we de jaarbijdrage van de Mastercard Black vanaf 1 juli 2025 verhogen van € 204 naar € 225, en bij de Extra Card van € 124 naar € 135." Dezelfde pagina beschrijft de reisservices die per die datum wijzigden.',
    },
  },
  {
    id: "ics-visa-world-card-business",
    product: "ICS Visa World Card Business",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/678/VISA-66-NL-072026%20AV%20Visa%20Worldcard%20Business",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: null,
  },
  {
    id: "ics-visa-world-card-business-gold",
    product: "ICS Visa World Card Business Gold",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/679/VISA-27-NL-072026%20AV%20Visa%20Worldcard%20Business%20Gold",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: null,
  },
  {
    id: "ics-mastercard-business",
    product: "ICS Mastercard Business",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/676/MC-108-NL-072026%20AV%20ICS%20Mastercard%20Business",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: null,
  },
  {
    id: "ics-mastercard-corporate",
    product: "ICS Mastercard Corporate",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    kind: "creditcard",
    fxFeePct: {
      value: 2.5,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/677/MC-206-NL-072026%20AV%20ICS%20Mastercard%20Corporate",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "user:eigenaar-2026-08-24",
      checkedAt: "2026-08-24",
      conditions:
        "Nul op gezag van de eigenaar (24 augustus 2026): hij weet dat deze aanbieder geen puntenprogramma voert. De eigen productpagina somt de kaart volledig op zonder loyaliteitsrubriek, wat daarmee strookt — maar de nul rust op zijn uitspraak en niet op een zin van de aanbieder. Een programma dat later alsnog verschijnt wordt hier niet vanzelf opgemerkt; de jaarlijkse sweep is de correctie.",
    },
    fee: null,
  },
  {
    id: "anwb-visa-classic-card",
    product: "ANWB Visa Classic Card",
    issuer: "International Card Services B.V. (ICS) on behalf of ANWB",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/633/Algemene%20Voorwaarden%20ANWB%20Creditcard%20-%20122",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/anwb/creditcard-aanvragen/anwb-visa-card",
      checkedAt: "2026-08-20",
      conditions:
        "Er bestaan GÉÉN ANWB-punten op deze kaarten. ‘Sparen met je ANWB Creditcard’ betekent op ANWB's eigen pagina uitsluitend spaargeld/spaarrente op de kaart: ‘Vergroot je bestedingsruimte [...] De limiet vormt samen met je spaarsaldo de totale bestedingsruimte van je creditcard.’ De ANWB-AV bij ICS (webdocument 633) bevat geen puntenartikel.",
    },
    fee: {
      value: 29.95,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260305072213id_/https://www.icscards.nl/anwb/anwb-info/faq-jaarbijdrage-verhoging-anwb",
      checkedAt: "2025-11-01",
      conditions:
        '"... de jaarbijdrage van uw ANWB Creditcard vanaf 1 november 2025", rij "ANWB Visa Card of ANWB Mastercard": "De bijdrage wijzigt van € 24,95 in € 29,95 per jaar"; Extra Card € 29,95 per jaar. Bovenop de kaartprijs komt een verplicht ANWB-lidmaatschap: anwb.nl/creditcard/informatie/kosten zet bij deze drie bedragen "De hierboven aangegeven prijzen zijn exclusief de kosten van een ANWB lidmaatschap", en wat dat lidmaatschap kost staat in geen van beide documenten. Per 1 november 2026 gaat de bijdrage naar € 31,70. De live pagina gaat al over die verhoging, dus gelezen is de Wayback-kopie van 5 maart 2026.',
    },
  },
  {
    id: "anwb-visa-silver-card",
    product: "ANWB Visa Silver Card",
    issuer: "International Card Services B.V. (ICS) on behalf of ANWB",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl: "https://www.icscards.nl/anwb/creditcard-aanvragen/anwb-visa-silver-card",
      checkedAt: "2026-08-19",
      conditions:
        'Koersopslag geldt "voor EU landen zonder euro en voor landen buiten EU"; de pagina noemt geen bedragslimiet of vrijstelling',
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/anwb/creditcard-aanvragen/anwb-visa-silver-card",
      checkedAt: "2026-08-20",
      conditions:
        "Er bestaan GÉÉN ANWB-punten op deze kaarten. ‘Sparen met je ANWB Creditcard’ betekent op ANWB's eigen pagina uitsluitend spaargeld/spaarrente op de kaart: ‘Vergroot je bestedingsruimte [...] De limiet vormt samen met je spaarsaldo de totale bestedingsruimte van je creditcard.’ De ANWB-AV bij ICS (webdocument 633) bevat geen puntenartikel.",
    },
    fee: {
      value: 39.95,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260305072213id_/https://www.icscards.nl/anwb/anwb-info/faq-jaarbijdrage-verhoging-anwb",
      checkedAt: "2025-11-01",
      conditions:
        '"... de jaarbijdrage van uw ANWB Creditcard vanaf 1 november 2025", rij "ANWB Visa Silver Card": "De bijdrage wijzigt van € 34,95 in € 39,95 per jaar"; Extra Card € 19,95 per jaar. Bovenop de kaartprijs komt een verplicht ANWB-lidmaatschap: anwb.nl/creditcard/informatie/kosten zet bij deze drie bedragen "De hierboven aangegeven prijzen zijn exclusief de kosten van een ANWB lidmaatschap", en wat dat lidmaatschap kost staat in geen van beide documenten. Per 1 november 2026 gaat de bijdrage naar € 41,70. De live pagina gaat al over die verhoging, dus gelezen is de Wayback-kopie van 5 maart 2026.',
    },
  },
  {
    id: "anwb-visa-gold-card",
    product: "ANWB Visa Gold Card",
    issuer: "International Card Services B.V. (ICS) on behalf of ANWB",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://www.icscards.nl/webdocuments/633/Algemene%20Voorwaarden%20ANWB%20Creditcard%20-%20122",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: {
      value: 0,
      sourceUrl: "https://www.icscards.nl/anwb/creditcard-aanvragen/anwb-visa-card",
      checkedAt: "2026-08-20",
      conditions:
        "Er bestaan GÉÉN ANWB-punten op deze kaarten. ‘Sparen met je ANWB Creditcard’ betekent op ANWB's eigen pagina uitsluitend spaargeld/spaarrente op de kaart: ‘Vergroot je bestedingsruimte [...] De limiet vormt samen met je spaarsaldo de totale bestedingsruimte van je creditcard.’ De ANWB-AV bij ICS (webdocument 633) bevat geen puntenartikel.",
    },
    fee: {
      value: 51.95,
      period: "jaar",
      sourceUrl:
        "http://web.archive.org/web/20260305072213id_/https://www.icscards.nl/anwb/anwb-info/faq-jaarbijdrage-verhoging-anwb",
      checkedAt: "2025-11-01",
      conditions:
        '"... de jaarbijdrage van uw ANWB Creditcard vanaf 1 november 2025", rij "ANWB Visa Gold Card": "De bijdrage wijzigt van € 46,95 in € 51,95 per jaar"; Extra Card € 19,95 per jaar. Bovenop de kaartprijs komt een verplicht ANWB-lidmaatschap: anwb.nl/creditcard/informatie/kosten zet bij deze drie bedragen "De hierboven aangegeven prijzen zijn exclusief de kosten van een ANWB lidmaatschap", en wat dat lidmaatschap kost staat in geen van beide documenten. Per 1 november 2026 gaat de bijdrage naar € 53,70. De live pagina gaat al over die verhoging, dus gelezen is de Wayback-kopie van 5 maart 2026.',
    },
  },
  {
    id: "crypto-com-prepaid-card-basic-midnight-blue",
    product: "Crypto.com Prepaid Card — Basic (Midnight Blue)",
    issuer: "Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)",
    kind: "prepaid",
    fxFeePct: {
      value: 0.2,
      sourceUrl:
        "https://help.crypto.com/en/articles/5977463-crypto-com-prepaid-visa-card-fees-and-limits-europe-for-users-with-a-residential-address-in-europe",
      checkedAt: "2026-08-19",
      conditions:
        "Midnight tier: 0.2% applies to non-EUR purchases and ATM transactions made within the EU and UK (rate schedule stated as applying till 30 September 2026; same 0.2% restated as effective 1 October 2026)",
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "maand",
      sourceUrl:
        "https://help.crypto.com/en/articles/1345769-how-to-apply-for-a-crypto-com-prepaid-card",
      checkedAt: "2026-04-22",
      conditions:
        'Uitgesproken nul: "you can get your Crypto.com Prepaid Card for free: - No monthly fee* - No annual fee* - No setup fee". VAN DE VIJF CRYPTO.COM-NIVEAUS IS DIT HET ENIGE WAARBIJ DIE NUL COMPLEET IS, en dat is de reden dat de vier hogere niveaus geen prijs in de catalogus hebben. Het sterretje verwijst naar de abonnementskosten van Level Up, en juist Basic heeft die niet: het gedateerde artikel "How do I join Level Up?" (help.crypto.com/en/articles/12017604, lastUpdatedDate 18 juni 2026) zet in zijn eigen tabel "Basic | No subscription or CRO Lockup/Stake required". Er zit dus geen niveaupoort achter deze nul. Wat wel geld kost, uit het aparte tarievenstuk (help.crypto.com/en/articles/5977463, lastUpdatedDate 31 juli 2026): de fysieke Midnight-kaart EUR 4,99, vervanging EUR 45,01, rekening sluiten EUR 50, en EUR 5 per maand na twaalf maanden zonder eigen transactie (EUR 6 per 1 oktober 2026). Die laatste is een voorwaardelijke maandpost en geen vaste prijs; hij hoort in deze tekst en niet in het bedrag. Deze kaart heeft geen cashbackcijfer in de catalogus.',
    },
  },
  {
    id: "crypto-com-prepaid-card-plus-ruby-steel",
    product: "Crypto.com Prepaid Card — Plus (Ruby Steel)",
    issuer: "Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)",
    kind: "prepaid",
    fxFeePct: {
      value: 0.2,
      sourceUrl:
        "https://help.crypto.com/en/articles/5977463-crypto-com-prepaid-visa-card-fees-and-limits-europe-for-users-with-a-residential-address-in-europe",
      checkedAt: "2026-08-19",
      conditions:
        'Effective 1 October 2026, Ruby tier: non-EUR purchases and ATM transactions within the EU & UK 0.2%; outside the EU & UK no fee up to EUR 400 per calendar month, 2.0% thereafter (until 30 September 2026 Ruby falls under "Other Card Tiers: No fee")',
    },
    cashbackPct: {
      value: 2,
      sourceUrl:
        "https://help.crypto.com/en/articles/2742447-crypto-com-prepaid-card-rewards-benefits",
      checkedAt: "2026-01-01",
      conditions:
        "The two values are the table's two rate columns, headed 'Spending Reward Rate in Year 1 1 Jan 2025 - 31 Dec 2025' and 'Spending Reward Rate After Year 1 1 Jan 2026 onwards'. For Plus both read 2%, so 2% is the ongoing rate with no legacy first-year uplift. The same 2% appears on crypto.com/nl/cards for Ruby Steel. CAP: the article's other table reads 'Level Up Plan Monthly Spending Cap Eligible for Rewards (USD or the equivalent amount in other fiat currencies) Basic (previously Midnight) N/A Plus (previously Ruby) Prepaid Card: $1,250' — spend above $1,250 per calendar month earns nothing, resetting 00:00:00 UTC on the first of the month. TIER GATE: requires an active Level Up Plus subscription — crypto.com/nl/cards prices Ruby Steel at '€3.99/month or €39.90 yearly (16% off) or €450 12-month CRO staking' — and 'You will be downgraded to the Basic plan if you unlock or unstake your CRO after the holding period, or if you cancel your subscription and your current billing cycle has ended.' PAID IN CRO, not euro, credited to the Token Wallet after each eligible purchase; certain merchant categories, channels and countries are excluded.",
    },
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "crypto-com-prepaid-card-pro-jade-green-royal-indigo",
    product: "Crypto.com Prepaid Card — Pro (Jade Green / Royal Indigo)",
    issuer: "Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)",
    kind: "prepaid",
    fxFeePct: {
      value: 0.2,
      sourceUrl:
        "https://help.crypto.com/en/articles/5977463-crypto-com-prepaid-visa-card-fees-and-limits-europe-for-users-with-a-residential-address-in-europe",
      checkedAt: "2026-08-19",
      conditions:
        'Jade / Indigo tier, effective 1 October 2026: 0.2% applies to non-EUR purchases within the EU &amp; UK; outside the EU &amp; UK there is "No fee up to EUR 800 per calendar month, 2.0% thereafter". Until 30 September 2026 Jade/Indigo fall under "Other Card Tiers: No fee".',
    },
    cashbackPct: {
      value: 3,
      sourceUrl:
        "https://help.crypto.com/en/articles/2742447-crypto-com-prepaid-card-rewards-benefits",
      checkedAt: "2026-01-01",
      conditions:
        "WATCH THE TWO COLUMNS: 3.5% is the first column, 'Spending Reward Rate in Year 1 1 Jan 2025 - 31 Dec 2025' — a legacy first-year uplift for cards issued between 6 November 2024 and 1 September 2025. 3% is the second column, 'Spending Reward Rate After Year 1 1 Jan 2026 onwards', and is the ongoing rate; crypto.com/nl/cards independently shows 3% for Jade Green / Royal Indigo. CAP: 'Pro (previously Jade/Indigo) Prepaid Card: $2,500' monthly spend eligible for rewards; crypto.com/nl/cards gives the same cap as '$75' of monthly rewards. TIER GATE: Level Up Pro, priced on crypto.com/nl/cards at '€24.99/month or €249.90 yearly (16% off) or €4,500 12-month CRO staking'; unstaking or cancelling downgrades you to Basic. Paid in CRO to the Token Wallet, not euro.",
    },
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "crypto-com-prepaid-card-private-icy-white-rose-gold",
    product: "Crypto.com Prepaid Card — Private (Icy White / Rose Gold)",
    issuer: "Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)",
    kind: "prepaid",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://help.crypto.com/en/articles/5977463-crypto-com-prepaid-visa-card-fees-and-limits-europe-for-users-with-a-residential-address-in-europe",
      checkedAt: "2026-07-31",
      conditions:
        "THE VALUE IS WRITTEN IN WORDS: 'Other Card Tiers: No fee'. The numerals inside the quote (0.2%, 2.0%, 400, 800) belong to the OTHER tiers and must not be attached to this card — they are quoted precisely because the enumeration is what proves 'Other Card Tiers' means Icy White / Rose Gold / Obsidian. Value 0 is the reading of 'No fee'. WHY THIS TIER IS THE RESIDUAL: the article's own tier table names the tiers as 'Basic (previously Midnight)', 'Plus (previously Ruby)', 'Pro (previously Jade/Indigo)', 'Private (previously Icy/Rose/Obsidian)'. The Effective-1-October-2026 list enumerates Midnight, Ruby, and Jade/Indigo individually and sweeps the rest into 'Other Card Tiers: No fee' — so Private is the no-fee tier. BOTH REGIMES AGREE: the earlier block, 'Foreign Transaction Fee (Till 30 September 2026): Midnight: All non-EUR purchases and ATM transactions will be charged as follows / Other Card Tiers: No fee', also puts Private at no fee. So 0% holds before and after 1 October 2026. This POSITIVELY establishes there is no cap on FX for Private, because the same paragraph writes monthly FX allowances where they exist (EUR 400/month for Ruby, EUR 800/month for Jade/Indigo). SEPARATE CONDITIONS THAT DO BITE, from the same article: ATM is not free — 'ATM Withdrawal: 2% on amounts above the monthly free ATM limit', with the Free ATM limit (Monthly) at €800 for the Icy / Rose Card. Card Max Balance – All Card Tiers: €25,000. POS Purchase Limit – All Card Tiers: Daily €25,000 / Monthly €25,000 / Yearly €250,000. Inactivity €5 per month after 12 months (€6 from 1 October 2026). Document scope: 'Crypto.com Prepaid Visa Card Fees and Limits (Europe – for users with a residential address in Europe)'. Note the document's own caveat: 'This document is a translation of its English version. In case of conflict, the English version shall prevail.'",
    },
    cashbackPct: {
      value: 4,
      sourceUrl:
        "https://help.crypto.com/en/articles/2742447-crypto-com-prepaid-card-rewards-benefits",
      checkedAt: "2026-01-01",
      conditions:
        "Second column is the ongoing rate: 5% is 'Spending Reward Rate in Year 1 1 Jan 2025 - 31 Dec 2025' (legacy), 4% is 'Spending Reward Rate After Year 1 1 Jan 2026 onwards'. crypto.com/nl/cards shows 4% for Icy White / Rose Gold. CAP: 'Private (previously Icy/Rose/Obsidian) Unlimited' monthly spend eligible for rewards. TIER GATE is severe: crypto.com/nl/cards prices Icy White / Rose Gold at '€45,000 12-month CRO staking' — there is no monthly-subscription route to this tier. Paid in CRO to the Token Wallet, not euro. Note also 'Starting 2 November 2025, non-staking card spending rewards of 1% for Icy/Rose Crypto.com cards and 2% for Obsidian prepaid cards issued before 6 November 2024 will no longer be available' — legacy holders who stopped staking now earn nothing.",
    },
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "crypto-com-prepaid-card-private-obsidian",
    product: "Crypto.com Prepaid Card — Private (Obsidian)",
    issuer: "Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)",
    kind: "prepaid",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://help.crypto.com/en/articles/5977463-crypto-com-prepaid-visa-card-fees-and-limits-europe-for-users-with-a-residential-address-in-europe",
      checkedAt: "2026-07-31",
      conditions:
        "THE VALUE IS WRITTEN IN WORDS: 'Other Card Tiers: No fee'. The numerals in the quote belong to Midnight / Ruby / Jade / Indigo and must not be attached to Obsidian; they are quoted because the enumeration is what proves the residual. The article's tier table names 'Private (previously Icy/Rose/Obsidian)', and the fee list names Midnight, Ruby and Jade/Indigo individually, so Obsidian falls in 'Other Card Tiers'. BOTH REGIMES AGREE: the Till-30-September-2026 block also reads 'Midnight: All non-EUR purchases and ATM transactions will be charged as follows / Other Card Tiers: No fee'. No FX cap for this tier is positively established, because the same paragraph writes monthly FX allowances (EUR 400, EUR 800) where they exist. WHERE OBSIDIAN DIFFERS FROM ICY/ROSE: its Free ATM limit (Monthly) is €1,000 rather than €800 — above that, 'ATM Withdrawal: 2% on amounts above the monthly free ATM limit'. Shared limits: Card Max Balance – All Card Tiers €25,000; POS Purchase Limit – All Card Tiers daily €25,000 / monthly €25,000 / yearly €250,000; ATM withdrawal limit Daily €2,000, Monthly €10,000, Yearly €75,000. Scope: 'Crypto.com Prepaid Visa Card Fees and Limits (Europe – for users with a residential address in Europe)'; 'This document is a translation of its English version. In case of conflict, the English version shall prevail.'",
    },
    cashbackPct: {
      value: 5,
      sourceUrl:
        "https://help.crypto.com/en/articles/2742447-crypto-com-prepaid-card-rewards-benefits",
      checkedAt: "2026-01-01",
      conditions:
        "Second column is the ongoing rate: 6.5% is the legacy 'Spending Reward Rate in Year 1 1 Jan 2025 - 31 Dec 2025', 5% is 'Spending Reward Rate After Year 1 1 Jan 2026 onwards'. crypto.com/nl/cards shows 5% for Obsidian with rewards cap 'No limit'. TIER GATE: crypto.com/nl/cards prices Obsidian at '€450,000 12-month CRO staking'. Paid in CRO to the Token Wallet, not euro. The 'up to 5%' in the page title 'Crypto.com Visa Card: Earn Up to 5% back on your daily spending' is this tier and this tier only.",
    },
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "nexo-card",
    product: "Nexo Card",
    issuer:
      "Nexo (dual Credit/Debit mode card; the issuing e-money institution is NOT named anywhere on the page)",
    kind: "creditcard",
    fxFeePct: {
      value: 0.2,
      sourceUrl: "https://nexo.com/crypto-card",
      checkedAt: "2026-08-18",
      conditions: "FX Fees on Weekdays, EEA/UK/CH",
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "maand",
      sourceUrl: "https://nexo.com/crypto-card",
      checkedAt: "2026-07-31",
      conditions:
        'Uitgesproken nul: "Enjoy daily spending with no monthly, annual, or inactivity card fees." DIT IS DE ZWAKSTE BRON VAN DEZE RONDE EN DAAROM MET DE REDEN EROP: het is een verkooppagina en geen tarievenoverzicht. Hij komt hier binnen omdat de zin drie soorten kosten met naam noemt in plaats van "geen kosten" te roepen, en omdat de pagina zelf een machineleesbare wijzigingsdatum draagt (pageUpdateDate voor pageSlug "crypto-card" in de eigen JSON-payload) — dezelfde route waarmee het Trade Republic-veld op 21 augustus 2026 is toegelaten. nexo.com/legal geeft HTTP 404 en er is geen los tarievenstuk gevonden. Voorwaarden: een virtuele kaart vraagt minimaal USD 50 op de Nexo-rekening, een fysieke kaart meer dan USD 5.000 aan digitale activa en minstens Gold Loyalty Tier (verzending gratis). Geldopname kost 2% met een minimum van 1,99 EUR boven de vrije maandruimte van je tier (Base EUR 200, Silver EUR 400, Gold EUR 1.000, Platinum EUR 2.000). Uitsluitend voor inwoners van geselecteerde Europese landen (EER en Verenigd Koninkrijk).',
    },
  },
  {
    id: "krak-card-kraken",
    product: "Krak Card (Kraken)",
    issuer: "Monavate UAB, Lithuania (EEA); Monavate Ltd in the UK — Mastercard debit",
    kind: "betaalpas",
    fxFeePct: {
      value: 1,
      sourceUrl: "https://krak.app/pricing",
      checkedAt: "2026-08-19",
      conditions:
        'Applies to US debit card customers ("Foreign Exchange (FX) for US debit card customers"), on debit card transactions, on top of the Visa exchange rate; under "Foreign Exchange (FX) for EEA debit card customers" and "for UK debit card customers" the page instead says "We don\'t charge FX fees when you spend in foreign currencies. We pass on the Mastercard exchange rate without markup."',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "plutus-card",
    product: "Plutus Card",
    issuer:
      "Plutus (Visa debit, NL IBAN per their marketing; issuing EMI not named on the plans page)",
    kind: "betaalpas",
    fxFeePct: {
      value: 2.5,
      sourceUrl: "https://plutus.it/fees",
      checkedAt: "2026-08-19",
      conditions: null,
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "bleap-card",
    product: "Bleap Card",
    issuer: "Bleap SIA (Latvia), Mastercard debit, self-custodial",
    kind: "crypto",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://bleap.finance/legal-agreements/bleap-cardholder-terms-eea-bleap-sia",
      checkedAt: "2026-06-28",
      conditions:
        'Uitgesproken nul die de eigen toeslag noemt en de koers bij het netwerk laat: artikel 6 van de Cardholder Terms EEA zegt "Bleap charges no issuance, monthly, usage or exchange fees for Card activity", en 6.3 "Currency conversion - If you transact in a different currency, the amount is converted at the Mastercard network rate applicable at processing time". DE NUL IS DUS BLEAPS EIGEN OPSLAG, NIET DE KOERS: hetzelfde artikel zegt dat "Mastercard scheme fees, network FX rates, merchant surcharges, ATM operator fees and government taxes may apply and are your responsibility". Zelfde vorm als gnosis-pay-card-direct-consumer en trade-republic-betaalpas, waar de nul ook de opslag van de uitgever is en de koers die van het kaartnetwerk. Dit is hetzelfde document en dezelfde datum als de accountFee van deze rij, die uit artikel 6.1 komt.',
    },
    cashbackPct: {
      value: 1,
      sourceUrl: "https://help.bleap.finance/en/articles/14655112-why-didn-t-i-receive-cashback",
      checkedAt: "2026-04-20",
      conditions:
        "Default ongoing rate on all eligible purchases, with a fair-usage cap of €500 per transaction and €3,000 per month in transaction value. Everything above 1% is MERCHANT-SPECIFIC and belongs in a per-merchant table, not this field: 'Uber, Bolt 3%' and 'Just Eat, Deliveroo, Uber Eats, Glovo, Bolt Food 3%' (each €50 per transaction, €500/month), and 20% on named subscriptions with tight value caps — Netflix €20/month, YouTube Premium €20/month, Amazon Prime €10/month, ChatGPT €30/month, Gemini €20/month, Claude €250/year, Disney+ €200/year, Steam €80/year, PlayStation Plus €220/year, Xbox Game Pass €30/month, Nintendo Switch Online €80/year. EXPIRED PROMO: the row 'Restaurants & supermarkets (promo until 31 May 2026) 2%' has lapsed as of today — do not serve it. EXCLUSIONS are extensive: cash/quasi-cash, stored-value loads, financial institutions, securities, insurance, gambling, taxes and fines, government services, utilities, postal, gift shops, software and IT services (5734, 7372), professional services, charities, hospitals, art dealers, business services. Payments routed through Curve earn nothing even on a Bleap card.",
    },
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "maand",
      sourceUrl: "https://bleap.finance/legal-agreements/bleap-cardholder-terms-eea-bleap-sia",
      checkedAt: "2026-06-28",
      conditions:
        'Uitgesproken nul. Artikel 6.1 noemt de drie soorten kosten met naam in plaats van "geen kosten" te roepen: "Cards are free. Bleap charges no issuance, monthly, usage or exchange fees for Card activity." Artikel 6.2 zegt wat er WEL is: "Mastercard scheme fees, network FX rates, merchant surcharges, ATM operator fees and government taxes may apply and are your responsibility." De vorige versie van hetzelfde stuk (Updated: 25 May 2026) heeft clausule 6.1 woordelijk gelijk, dus dit is geen eenmalige formulering van een marketingtekst. DE BRON IS BEWUST NIET DE LANDINGSPAGINA: bleap.finance zegt daar "No fees (really!)" zonder datum en zonder eenheid, en die zin draagt geen van de vier eisen. De 1% cashback op deze rij komt uit een ander gedateerd stuk (help.bleap.finance), dus prijs en opbrengst leunen hier niet op dezelfde pagina.',
    },
  },
  {
    id: "zeal-card-gnosis-pay-rails",
    product: "Zeal Card (Gnosis Pay rails)",
    issuer: "Monavate Limited (UK, FCA EMI, FRN 901097) with Gnosis Pay Co Ltd — Visa debit",
    kind: "crypto",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://help.gnosispay.com/hc/en-us/articles/39533569163284-Understanding-Your-Card-s-Fees-and-Limits",
      checkedAt: "2026-08-12",
      conditions:
        "SCOPE — READ BEFORE SERVING. This document is GNOSIS PAY'S, and it talks about 'your Gnosis Pay Card' throughout. It never mentions Zeal. Zeal runs on Gnosis Pay rails but publishes nothing of its own (zeal.app has no fee page), so this is evidence about the rails, not proof that Zeal passes them through unmarked. See askUserInstead. On the rails themselves: no added FX fee, Visa's rate applied at purchase, and the issuer's own advice is 'When travelling, always select the local currency at payment terminals for better rates.' Spending is 1:1 against stablecoin ('a €10 purchase = 10 EURe'). ATM is NOT free past a small allowance: 'You can make up to 5 free ATM withdrawals per month or withdraw up to 200 EURe/GBPe/USDCe—whichever comes first' then '2% fee per additional withdrawal'; daily ATM cap 500, single 250. Daily spend cap 8,000, single transaction 5,000. Card replacement 4.99. No gas fees on card transactions. WORDING CAVEAT — the 0 is written as 'No added fees'; no numeral appears.",
    },
    cashbackPct: {
      value: 1,
      sourceUrl: "https://help.gnosispay.com/api/v2/help_center/en-us/articles/40288567337876.json",
      checkedAt: "2026-07-15",
      conditions:
        "Zeal runs no cashback programme of its own — it rides Gnosis Pay rails and inherits the Gnosis Pay tiers, so the figure and every condition are the Gnosis Pay ones. zeal.app footnote 3 states it explicitly: 'The cashback program is managed by Gnosis Pay. Rewards are paid in GNO, a digital currency, on the Gnosis Chain. To be eligible for cashback, you must hold GNO in your Gnosis Pay card Safe. The amount of cashback you earn is determined by the amount of GNO you hold. Cashback rates are subject to change and may vary by program.' TEMPORARY: the programme is 'active until 30 September 2026'. ENTRY TIER needs ≥0.1 GNO held in the Gnosis Pay Card Safe (nothing below that), capped at $250 eligible weekly spend, no rollover. Ladder: 1 GNO → 2%, 10 GNO → 3%, 100 GNO → 4%, plus 1% with the OG NFT. Paid weekly in GNO. zeal.app's own meta description advertises 'up to 4% cashback with Zeal' — that is the top base tier (100 GNO), not the entry rate, and must not be carried into this field.",
    },
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "gnosis-pay-card-direct-consumer",
    product: "Gnosis Pay Card (direct consumer)",
    issuer: "Gnosis Pay Co Ltd / Monavate Limited",
    kind: "crypto",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://help.gnosispay.com/hc/en-us/articles/39533569163284-Understanding-Your-Card-s-Fees-and-Limits",
      checkedAt: "2026-08-12",
      conditions:
        'Uitgesproken nul, in woorden en niet in cijfers: "No added fees from Gnosis Pay for currency conversions / Visa\'s exchange rate is applied automatically at the time of purchase." De nul is dus de eigen toeslag van de uitgever; de koers is die van Visa. Dezelfde bron waarschuwt zelf voor DCC: "When travelling, always select the local currency at payment terminals for better rates." Kaartbetalen is verder kosteloos en 1:1 in stablecoin ("No transaction fees when spending with your card"; "1:1 stablecoin usage — a €10 purchase = 10 EURe"). Geldopnames zijn een aparte post: tot 5 gratis opnames per maand óf tot 200 EURe/GBPe/USDCe, wat het eerst komt, daarna 2% per extra opname; een vervangende kaart 4,99. DIT IS HETZELFDE DOCUMENT DAT zeal-card-gnosis-pay-rails GEBRUIKT, maar dit is het product waar het over gaat: het stuk spreekt over "your Gnosis Pay Card" en noemt Zeal nergens. De afgeleide rij had het cijfer en de rij van het eigen product niet. De datum is de updated_at van het artikel in de eigen Zendesk-API van de site (created_at 21 juli 2025). BESCHIKBAARHEID: state.json zet availableToNL op false en gnosispay.com/card, /pricing en /personal geven alle drie 404; het tarief is aangetoond, de bereikbaarheid voor Nederland niet.',
    },
    cashbackPct: {
      value: 1,
      sourceUrl: "https://help.gnosispay.com/api/v2/help_center/en-us/articles/40288567337876.json",
      checkedAt: "2026-07-15",
      conditions:
        "TEMPORARY PROGRAMME — this is the dominant caveat: 'This article details the Gnosis Pay interim cashback programme, starting on the 9 November 2025 and active until 30 September 2026 (previously it was the 31st January and 31st March).' After 30 September 2026 'new partner-led incentive programmes will be introduced'; the 1% is not guaranteed past that date, six weeks out. ENTRY TIER requires holding at least 0.1 GNO in the Gnosis Pay Card Safe — below 0.1 GNO there is no cashback at all — and at 0.1 GNO the maximum weekly spend eligible for cashback is $250, with 'No rollover: unused cap doesn't carry over.' The rest of the ladder: 1 GNO → 2% ($375/week), 10 GNO → 3% ($500/week), 100 GNO → 4% ($1250/week); the further +1% (to the advertised 'up to 5%') needs the OG NFT as well as ≥0.1 GNO. PAID WEEKLY IN GNO to the Safe, not euro; holdings are measured as 'Lowest GNO amount within the snapshot period', Sunday→Saturday, paid the following Thursday. INELIGIBLE: ATM withdrawals and cash advances, bank/wallet top-ups (Revolut, Wise, PayPal), investments, interest and insurance premiums, taxes/fines/government charges, postal services, donations, utilities, direct technology services and software, and any transaction routed through Curve.",
    },
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "bybit-card",
    product: "Bybit Card",
    issuer: "Bybit EU (EUR card for EEA residents); issuing EMI not obtainable",
    kind: "betaalpas",
    fxFeePct: {
      value: 0.5,
      sourceUrl:
        "https://www.bybit.eu/en-EU/help-center/article/Fees-and-Spending-Limits-Bybit-Card",
      checkedAt: "2026-06-03",
      conditions:
        'Trigger, in the document\'s own words: "Foreign exchange (FX) Fee applies to transactions that are performed in a currency other than the currency your card is denominated in. For example, a Bybit Card is denominated in EUR for USD transactions." De 0,5% komt bovenop de Mastercard-koers en er is geen padding: "FX Padding 0%". STAPELT met de crypto-kant: "Crypto Conversion Fee 0.9% (On top of Bybit EU\'s One-Click Sell Exchange Rate)" en "Crypto Conversion Fee applies to all transactions funded with non-fiat assets in your Bybit EU Funding Account" — wie vanuit crypto betaalt, betaalt in de praktijk 0,5% + 0,9%. Geldopname is een aparte regel: "ATM Withdrawal Fee 2% (after the first 100 EUR monthly)". Geen vrij bedrag of plafond op de FX-fee zelf, en dat is positief vastgesteld: diezelfde tabel schrijft vrijstellingen wél uit waar ze bestaan ("2% (after the first 100 EUR monthly)", "None (for virtual Bybit Card)", "Replacement: 5 EUR"). Wel bestedingslimieten per tier: Tier 1 5.000 EUR per transactie / 5.000 daily / 10.000 monthly / 60.000 annual, oplopend tot Tier 3 15.000 / 15.000 / 50.000 / 250.000; en "the Virtual Card Lite will be subjected to a Lifetime Spending Limit of 150 EUR". Scope: Bybit EU (EEA), kaart luidt in EUR. Disclaimer van de uitgever zelf: "Bybit EU reserves the right to introduce or amend the Fees and Limits according to market conditions."',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "jaar",
      sourceUrl:
        "https://www.bybit.eu/en-EU/help-center/article/Fees-and-Spending-Limits-Bybit-Card",
      checkedAt: "2026-06-03",
      conditions:
        'Uitgesproken nul. DE EENHEID IS DIE VAN HET DOCUMENT: het is de tabelrij met het opschrift "Annual Fee", dus per jaar, en er is niet omgerekend — maand tegen jaar scheelt een factor twaalf. Dezelfde tabel zet ook "Inactivity Fee | None" en "Card Cancellation Fee | None", dus de nul is niet elders verstopt als slaapkosten. Wat niet nul is: 0,5% opslag op de Mastercard-koers, 0,9% voor cryptoconversie, 2% geldopname na de eerste 100 EUR per maand, en 5 EUR voor een vervangende fysieke kaart. TIJDELIJK EN DAAROM NIET IN DE WAARDE: bij de uitgiftekosten staat een sterretje met "No fee is required for the issuance of Bybit Card until further notice" — dat is een opgeschorte prijs en geen vaste nul. Bij "Annual Fee | None" staat dat voorbehoud niet, dus deze nul draagt de tijdelijkheid niet mee. Deze kaart heeft geen cashbackcijfer in de catalogus; hij vult de prijskant en zet de nettotak niet aan.',
    },
  },
  {
    id: "wirex-card-wirex-one",
    product: "Wirex Card (Wirex One)",
    issuer:
      "Wirex; card issuer previously UAB PayrNet, current EEA issuer not stated on any readable page",
    kind: "crypto",
    fxFeePct: null,
    cashbackPct: {
      value: 0.5,
      sourceUrl: "https://help.wirexapp.com/article/x-tras-pricing-plans-and-tiers-1337",
      checkedAt: "2024-01-11",
      conditions:
        "Standard plan, Entry tier — the free tier: 'The Standard plan is the most basic X-tras subscription plan, and it is available to all Wirex users for free.' The article's summary table confirms it across all eight tiers: 'WXT Lock 0 150,000 0 250,00 750,000 0 1.5m 7.5m' against 'Cryptoback™ 0.5% 1% 1% 2% 3% 4% 6% 8%'. PAID IN CRYPTO (Cryptoback™), not euro. Everything above 0.5% costs money or locked tokens: Standard Enhanced needs 150,000 WXT locked for 180 days → 1%; Premium is '€9.99, or €102 annually' → 1% entry, 2% with 250,000 WXT, 3% with 750,000 WXT; Elite is '€29.99 monthly or €306 annually' → 4% entry, 6% with 1,500,000 WXT, 8% with 7,500,000 WXT. No cap on the cashback is stated anywhere in this article — that is a gap in the source, not a confirmed absence of a cap. STALENESS WARNING: this is much the oldest figure in the lane; the article's own metadata gives updatedAt 2024-01-11, more than two and a half years ago, and Wirex has restructured its EEA card issuing since (the catalogue itself records the previous issuer UAB PayrNet as defunct with no current EEA issuer stated). Re-check before serving.",
    },
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "maand",
      sourceUrl: "https://help.wirexapp.com/article/x-tras-pricing-plans-and-tiers-1337",
      checkedAt: "2024-01-11",
      conditions:
        'Uitgesproken nul voor het X-tras-plan Standard, Entry-tier — precies het niveau waar de 0,5% Cryptoback op deze rij bij hoort, en dat is de reden dat deze rij hier wel binnenkomt: één artikel geeft zowel het abonnementsbedrag als het beloningspercentage. "The Standard plan is the most basic X-tras subscription plan, and it is available to all Wirex users for free. The Entry tier is the basic tier and offers 0.5% Cryptoback on card purchases." HET DOCUMENT HANGT GEEN PERIODE AAN HET WOORD "FREE"; de eenheid staat hier op maand omdat de buurplannen in dezelfde tabelrij per maand geprijsd zijn (Premium EUR 9,99 per maand of EUR 102 per jaar, Elite EUR 29,99 per maand of EUR 306 per jaar). Bij een nul maakt de periode niets uit, maar dat is een leesbeslissing en geen citaat, en daarom staat het er. Alles boven 0,5% kost wel iets: Standard Enhanced vraagt 150.000 WXT die 180 dagen vast blijven staan. Uitgifte is apart bevestigd in het losse artikel "Wirex Fees" (updatedAt 14 december 2023): "Card Issuance | EEA | Free", met kaartbezorging EEA 5 EUR (DHLWorldMail, niet volgbaar) of 15 EUR (DHL Express). HOUDBAARHEID: dit is met afstand het oudste cijfer in dit veld — twee en een half jaar — en het tarievenartikel waarschuwt zelf dat de tarieven kunnen wijzigen; Wirex heeft zijn EEA-uitgifte sinds die datum verbouwd (de eerdere uitgever UAB PayrNet staat er niet meer, de huidige wordt niet genoemd). Hercontroleer hem voordat je hem serveert.',
    },
  },
  {
    id: "paysafecard-prepaid-code-paysafewallet",
    product: "paysafecard (prepaid code / PaysafeWallet)",
    issuer: "Paysafe",
    kind: "prepaid",
    fxFeePct: {
      value: 3,
      sourceUrl: "https://www.paysafecard.com/nl-nl/alg-vw/",
      checkedAt: "2026-05-26",
      conditions:
        'Omrekeningskosten van 3% van het transactievolume bij elke betaling in een andere valuta dan die van de PaysafeCard, en die wordt in euro\'s uitgegeven. Artikel 7.2: "Voor elke betaling gedaan in een andere valuta dan de valuta van uw PaysafeCard (zogenaamde kruisvaluta transacties) rekenen we omrekeningskosten. Deze kosten bedragen 3% van het transactievolume." Artikel 7.1 stelt vast dat het een europroduct is: "De PaysafeCard wordt uitgegeven in Euro (€)." DE 3 IS NIET HET MAXIMUM: dezelfde clausule zet een tweede, hoger tarief neer als de euro helemaal niet in de transactie voorkomt — "Voor kruisvaluta transacties, waarbij de euro niet is betrokken in de betalingstransactie, zal een wisselkoers van 6,09% van de betalingstransactie worden toegepast." Los van de omrekening: terugbetalingsvergoeding € 7,50 en maandelijkse beschikbaarheidskosten na de eerste 30 dagen. De datum komt uit de bestandsnaam van het document zelf (nl_paysafecard_26-05-2026.htm). TEGENSPRAAK OM MEE TE DRAGEN, NIET OM WEG TE LATEN: de marketingkostenpagina (paysafecard.com/nl-nl/kosten-limieten) zegt "Vanaf de 2e maand worden maandelijkse activeringskosten van 3 EUR ... afgetrokken", terwijl deze voorwaarden zeggen "de eerste 30 (dertig) dagen na aankoop van uw PaysafeCard GRATIS. Daarna € 4 per maand." Twee bronnen van dezelfde uitgever, twee bedragen, en dat gaat over de maandkosten en niet over de omrekening — daarom heeft dit product nog geen accountFee. MEETPUNT OM NIET TE HERHALEN: het detail-eindpunt levert voor alle drie de tx_pscterms_pi3-bestandsnamen hetzelfde document van 100.518 bytes, byte-identiek; de mypaysafecard- en mastercard-varianten zijn langs die route dus niet te bereiken en over die twee zegt dit cijfer niets.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "tria-card",
    product: "Tria Card",
    issuer: "Tria (self-custodial Visa; issuing EMI not stated)",
    kind: "crypto",
    fxFeePct: {
      value: 0,
      sourceUrl: "https://help.tria.so/en/articles/13513481-what-are-tria-cards",
      checkedAt: "2026-06-14",
      conditions:
        'Uitgesproken nul die de valutakosten met naam noemt, en die voor alle drie de tiers geldt — dus geen toewijzingsprobleem: "Tria offers three tiers to match how you use your crypto. Every tier enjoys zero deposit fees and zero foreign exchange fees." DE NUL DEKT DE VALUTAKOSTEN VAN TRIA EN NIET DE CONVERSIE ZELF: de kaart zet crypto om op het moment van betalen ("Real-time conversion: Your crypto is converted at payment time") en welke spread daarbij wordt gerekend staat in geen enkel leesbaar document. De 0 is dus een tarief en geen totale prijs. De datum is de eigen dateModified uit de JSON-LD van het artikel. BESCHIKBAARHEID: state.json zet availableToNL op "unverified" en de uitgevende instelling wordt op geen enkele pagina genoemd; een aangetoond tarief bewijst niet dat hij de kaart kan houden.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
  },
  {
    id: "ing-creditcard-more",
    product: "ING Creditcard More",
    issuer: "ING Bank N.V.",
    kind: "creditcard",
    fxFeePct: {
      value: 2,
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        'Vlakke 2,00% koersopslag, zonder plafond. Uit de tabel "ING Creditcards / Koersopslag non-euro" van het Kostenoverzicht (geldig vanaf 15 juni 2026): in de kolommen ING Go en ING More staat "ING Creditcard More 2,00%". LET OP DE NAAMVAL: de ING STUDENTEN Creditcard More is een ANDER product en staat in hetzelfde document op "in vreemde valuta tot EUR 500 per creditcardperiode 0,00% koersopslag" en daarboven 2,00%. Die 0% hoort dus NIET bij deze rij. Volgens noot 1 rekent ING de koersopslag als percentage ten opzichte van de ECB-referentiekoers, verwerkt in het bestede bedrag.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 2,
      period: "maand",
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        "Prijs geldt bij ING Go; bij ING More is de kaart inbegrepen in het pakket. Een extra ING Creditcard More kost € 1,25 per maand. De kosten van een additioneel afgenomen creditcard worden 1x per jaar afgeschreven.",
    },
  },
  {
    id: "ing-creditcard-extra",
    product: "ING Creditcard Extra",
    issuer: "ING Bank N.V.",
    kind: "creditcard",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        'VOORWAARDELIJKE NUL, en het plafond hoort bij het cijfer: 0,00% koersopslag tot EUR 1.000 per creditcardperiode, DAARBOVEN 2,00%. Letterlijk uit de tabel "ING Creditcards / Koersopslag non-euro": "ING Creditcard Extra tot EUR 1000*** per maand 0,00%", met noot ***: "Tot EUR 1000 geen koersopslag per maandcyclus per creditcard contract, daarboven 2,00%". Twee keer bevestigd in hetzelfde document: de opnamesectie zet "Vreemde valuta opnemen tot EUR 1000 euro per creditcardperiode" op 0,00% koersopslag en daarboven op 2,00%. Dezelfde vorm als ing-platinumcard, en dezelfde reden dat het plafond meereist: een 0% die als onvoorwaardelijk wordt getoond zet deze kaart bovenaan een reisranglijst terwijl er boven EUR 1.000 wel wordt gerekend. Het cijfer geldt bij ING Go, ING More en ING Extra.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 4.35,
      period: "maand",
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        "Prijs geldt bij ING Go. Bij ING More € 2,18 (50% korting), bij ING Extra inbegrepen. Additionele ING Creditcard Extra € 2,60 per maand.",
    },
  },
  {
    id: "ing-creditcard-max",
    product: "ING Creditcard Max",
    issuer: "ING Bank N.V.",
    kind: "creditcard",
    fxFeePct: {
      value: 0,
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        'Onvoorwaardelijke 0,00% koersopslag, en dat is hier gemeten in plaats van aangenomen: in de tabel "ING Creditcards / Koersopslag non-euro" staat in de ING Max-kolom "0,00% ING Creditcard Max" ZONDER het plafond en ZONDER noot *** die de Extra-cel wel draagt, en de opnamesectie zegt onafhankelijk daarvan "Met een ING Creditcard Max - Vreemde valuta opnemen: 4,00% van het opgenomen bedrag met een minimum van EUR 4,50 + 0,00% koersopslag", ook zonder plafond. DE KAART IS ALLEEN BINNEN HET ING MAX-PAKKET TE KRIJGEN (EUR 44,99 per maand); deze nul is dus geen gratis nul maar een nul binnen een pakket dat geld kost, en dat staat ook zo in accountFee van dezelfde rij. Bij geldopname komt bovenop deze nul nog 4,00% van het opgenomen bedrag.',
    },
    cashbackPct: null,
    pointsPerEuro: null,
    fee: {
      value: 0,
      period: "maand",
      sourceUrl:
        "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditions:
        "Alleen binnen het ING Max-pakket (€ 44,99 per maand); de kaart zelf kost daarbovenop niets. Een additionele ING Creditcard Max kost € 10,00 per maand. Dit is dus geen gratis kaart, maar een kaart zonder aparte cardfee binnen een betaald pakket.",
    },
  },
];
