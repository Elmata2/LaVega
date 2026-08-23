/* Het bedrag van een pagina lezen.
 *
 * ── WAT IK HEB GEMETEN, WANT DIT ONTWERP VOLGT UIT EEN MEETRESULTAAT ────────
 *
 * Op 21 augustus 2026, dertien Nederlandse winkelpagina's met curl, een gewone
 * browser-UA en redirects gevolgd:
 *
 *   coolblue.nl      200, JSON-LD Offer met price EN priceCurrency  ← leesbaar
 *   bol.com          200, JSON-LD Offer ZONDER price
 *   hema.nl          200, alleen JSON-LD Organization en WebSite
 *   mediamarkt.nl    200, nul JSON-LD-blokken
 *   ikea.com         200, geen prijsopmaak
 *   wehkamp.nl       404 op de gebruikte URL — dus geen meting van de winkel
 *   amazon.nl        404 op de gebruikte URL — dus geen meting van de winkel
 *   ah.nl            403
 *   conrad.nl        403
 *   decathlon.nl     403
 *   thuisbezorgd.nl  403
 *   bax-shop.nl      406
 *   zalando.nl       verbinding mislukte, geen HTTP-status
 *
 * Eén van de dertien gaf een machineleesbaar bedrag met munt. Vijf gaven 403 of
 * 406; dat is een antwoord, en het staat hier genoteerd in plaats van omzeild.
 *
 * En het resultaat dat het ontwerp bepaalt: zowel bij Coolblue als bij bol
 * beschreef de opmaak een ANDER artikel dan de opgevraagde URL — een Samsonite
 * kofferset op een AirPods-URL, een boek op een LEGO-URL. Twee van de vier
 * leesbare pagina's logen dus over hun eigen inhoud.
 *
 * ── DE TWEEDE MEETRONDE, 21 augustus 2026 ───────────────────────────────────
 *
 * De toestemming voor ikea.com rustte op twee metingen (BILLY € 49,99 en KALLAX
 * € 69,99) en die hadden allebei GEEN actieprijs. Dat geval is nu wél gemeten:
 * via https://www.ikea.com/nl/nl/offers/family-offers/ (200) is een pagina met
 * een IKEA Family-actieprijs opgehaald (200, gewone browser-UA, geen
 * botdetectie omzeild). Uitkomst, vastgelegd in
 * __fixtures__/ikea-slakt-actieprijs.html:
 *
 *   op het scherm : € 96,99, "15% korting", "Prijs voor niet IKEA Family
 *                   leden: €114.99"
 *   in de opmaak  : AggregateOffer met lowPrice 96,99 en highPrice 114,99
 *   de lezer las  : {"ok":true,"amountCents":9699,...}
 *
 * Dus de laagste van de twee, met ok:true en zonder twijfel in beeld — aan een
 * gebruiker die misschien geen Family-lid is en dan € 114,99 afrekent. Niet de
 * oude prijs zoals verwacht, maar de nieuwe. Op de enige winkel die deze
 * extensie mag lezen. Vandaar de tak "prijsbereik" hieronder.
 *
 * ── WAT DAT BETEKENT ────────────────────────────────────────────────────────
 *
 * Een gelezen bedrag is hier geen feit maar een VOORSTEL dat de gebruiker
 * bevestigt of overtypt. Dat is geen voorzichtigheid uit gewoonte: een verkeerd
 * bedrag levert stil een verkeerde aanbeveling, en dat is erger dan geen.
 *
 * Elke gelukte lezing draagt daarom een `basis`:
 *   "bestelling" — een schema.org Order/Invoice-totaal. Dit is wat je wilt.
 *   "artikel"    — de prijs van één artikel, en dus NIET het totaal van de
 *                  bestelling: aantal, verzending en korting zitten er niet in.
 *                  De UI zegt dat erbij in plaats van het stil als totaal te
 *                  gebruiken.
 *
 * ── DE REGEL WAAR ALLES OP RUST ─────────────────────────────────────────────
 *
 * BIJ TWIJFEL LEEST DE LEZER NIETS EN ZEGT WAAROM. De gebruiker kan het bedrag
 * altijd zelf invullen; een bedrag dat er verkeerd naast staat kan hij niet
 * corrigeren, want hij ziet niet dat het fout is. Er zijn tien redenen om te
 * weigeren, en alle tien noemen de ECHTE oorzaak:
 *
 *   geen-prijsmarkup     er staat niets machineleesbaars op de pagina
 *   geen-artikelprijs    er staat wel een bedrag, maar het is er een van een
 *                        andere soort: een prijs per kilo, of verzendkosten
 *   prijsbereik          er staat een reeks met twee verschillende uiteinden
 *   prijs-vanaf          er staat maar ÉÉN uiteinde van een reeks; de andere
 *                        kant is onbekend en dus niet gelijk aan deze
 *   prijs-zonder-valuta  een bedrag zonder munt, of met alleen een dollarteken
 *   munt-spreekt-tegen   twee bronnen op de pagina zijn het oneens over de munt
 *   meerdere-prijzen     twee echt verschillende bedragen, geen totaal ertussen
 *   bedrag-onduidelijk   het scheidingsteken kan twee dingen betekenen
 *   bedrag-afgekapt      er staat een scheidingsteken zonder cijfers erachter
 *   bedrag-niet-leesbaar er staat iets anders dan een getal in het veld
 *   bedrag-negatief      het bedrag is negatief, en dat is geen aankoopbedrag
 *
 * ── WAAROM HET ER TIEN ZIJN EN GEEN ZEVEN ──────────────────────────────────
 *
 * Omdat "bedrag-onduidelijk" een vergaarbak was met één uitleg eronder. Gemeten
 * met `parseAmountToCents`: "96,99 €", "EUR 96,99", "vanaf 39,99", "39," en
 * "-5,00" kwamen er allemaal uit als "bedrag-onduidelijk", en de tekst daarbij
 * ging over "één punt met drie cijfers erachter". Bij vijf van de zes gemeten
 * gevallen was dat de verkeerde oorzaak — huisregel 3, in de functie die er het
 * meest last van heeft.
 *
 * De eerste twee van die vijf waren bovendien helemaal geen weigering waard.
 * "96,99 €" is de gewone Nederlandse schrijfwijze en "EUR 96,99" staat in
 * talloze feeds; die worden nu gewoon gelezen. Wat overblijft weigert nog steeds,
 * maar met de oorzaak die er ook echt is.
 *
 * Bij alle tien is het handmatige veld het antwoord dat in die toestand wél
 * werkt, en dat staat in de tekst — in twee smaken, want in het handmatige veld
 * zelf is "vul het bedrag zelf in" geen advies maar een echo. */

export type Basis = "bestelling" | "artikel";

export type ReadReason =
  | "geen-prijsmarkup"
  | "geen-artikelprijs"
  | "prijsbereik"
  | "prijs-vanaf"
  | "prijs-zonder-valuta"
  | "munt-spreekt-tegen"
  | "meerdere-prijzen"
  | "bedrag-onduidelijk"
  | "bedrag-afgekapt"
  | "bedrag-niet-leesbaar"
  | "bedrag-negatief";

export type Reading =
  | { ok: true; amountCents: number; currency: string; basis: Basis; via: string }
  | { ok: false; reason: ReadReason; detail: string };

/** Eén bedrag zoals het op de pagina stond, met waar het stond. `raw` is nog
 *  niet ontcijferd: het scheidingsteken is een apart probleem (zie
 *  parseAmountToCents) en dat hoort niet in de pagina te gebeuren. */
export type PriceCandidate = {
  raw: string | number;
  currency: string;
  basis: Basis;
  via: string;
};

/* ── DE VIA-ETIKETTEN ────────────────────────────────────────────────────────
 *
 * `via` is niet alleen een mededeling aan de gebruiker, het is ook waarop
 * readCheckout een kandidaat HERKENT. Een bedrag dat uit een AggregateOffer
 * komt, is een uiteinde van een reeks en geen prijs; een bedrag uit een
 * eenheids- of verzendtarief is een ander soort bedrag dan de artikelprijs. Dat
 * onderscheid kan niet in `basis` (die zegt iets anders: artikel tegenover
 * bestelling) en er mag geen veld bij, want dan verschuift de redactiegrens die
 * read.test.ts bewaakt.
 *
 * collectEvidence kan deze constanten NIET gebruiken — zie de kop van die
 * functie: ze wordt als tekst in de pagina geïnjecteerd en heeft daar niets
 * buiten haar eigen body. De literals staan daar dus nog een keer, en
 * read.test.ts vergelijkt de twee zodat ze niet uit elkaar kunnen lopen. */
export const VIA_ORDER = "JSON-LD Order";
export const VIA_OFFER = "JSON-LD Offer";
export const VIA_MICRODATA = 'microdata itemprop="price"';
export const VIA_META = "meta product:price";
export const VIA_REEKS_LAAG = "JSON-LD AggregateOffer lowPrice";
export const VIA_REEKS_HOOG = "JSON-LD AggregateOffer highPrice";
export const VIA_REEKS_PRIJS = "JSON-LD AggregateOffer price";
export const VIA_GEEN_ARTIKELPRIJS = "JSON-LD prijsopgave, geen artikelprijs";

/** WAT DE EXTENSIE VAN EEN PAGINA MEENEEMT, en dit is de hele lijst: de host en
 *  de bedragen die er machineleesbaar op staan.
 *
 *  Geen paginatitel, geen artikelnaam, geen omschrijving, geen winkelwagen,
 *  geen cookies, geen URL-pad. De eerste opzet nam de RUWE TEKST van elk
 *  JSON-LD-blok mee en ontcijferde die in de popup — makkelijker te testen, maar
 *  dan reist de naam en de hele omschrijving van het artikel mee, en dan draagt
 *  de extensie gegevens over wat hij koopt terwijl ze alleen een bedrag nodig
 *  heeft. Het ontcijferen is daarom naar de pagina verhuisd en wat eruit komt is
 *  gesnoeid tot getal, munt en herkomst. read.test.ts houdt die lijst kort. */
export type Evidence = {
  host: string;
  candidates: PriceCandidate[];
};

/* ─────────────────────── het aftasten van de pagina ───────────────────────── */

/** Haalt de bedragen uit een Document.
 *
 * DEZE FUNCTIE STAAT OPZETTELIJK OP ZICHZELF: geen imports, geen verwijzing naar
 * iets buiten haar eigen body. Chrome injecteert haar namelijk in de pagina via
 * `chrome.scripting.executeScript({ func })`, en dat gebeurt door de functie als
 * TEKST te versturen. Alles wat ze van buiten zou gebruiken, bestaat daar niet.
 * Ook de VIA_*-constanten hierboven niet; die staan hieronder als literal.
 *
 * Vandaar ook de twee nullable parameters. De `args` van executeScript moeten
 * JSON-serialiseerbaar zijn en een Document is dat niet, dus de injectie roept
 * haar aan met (null, null) en de functie pakt de globals van de pagina zelf.
 * In de test gaat er een jsdom-Document in. Zo is er één implementatie in plaats
 * van twee die uiteen kunnen lopen.
 *
 * DEZE FUNCTIE KIEST NIET. Ze verzamelt, etiketteert en laat readCheckout
 * beslissen — ook bij een AggregateOffer, waar ze allebei de uiteinden meegeeft
 * in plaats van er één te pakken. */
export function collectEvidence(doc?: Document | null, host?: string | null): Evidence {
  const d: Document = doc ?? document;
  const h: string = host ?? location.host;
  const candidates: PriceCandidate[] = [];

  const isOrder = (t: string) => /(^|\/|:)(Order|Invoice)$/i.test(t);
  const isOffer = (t: string) => /(^|\/|:)Offer$/i.test(t);
  const isReeks = (t: string) => /(^|\/|:)AggregateOffer$/i.test(t);

  const types = (o: Record<string, unknown>): string[] => {
    const t = o["@type"];
    if (typeof t === "string") return [t];
    if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
    return [];
  };

  const scalar = (v: unknown): string | number | null => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim()) return v;
    return null;
  };

  /* EEN GENEST BEDRAG IS NIET VANZELF DE PRIJS. schema.org staat een
   * PriceSpecification toe waar een getal mag staan, maar onder diezelfde
   * sleutel hangen ook een UnitPriceSpecification (€ 18,50 per kilo, terwijl
   * het pak van 500 gram € 9,25 kost) en een DeliveryChargeSpecification
   * (€ 4,95 verzendkosten). De vorige versie dook één niveau en pakte daar
   * `price` zonder naar @type of referenceQuantity te kijken; dat las een
   * kiloprijs en een verzendtarief als artikelprijs, allebei met ok:true.
   *
   * Daarom wordt er nu gekeken WAT er hangt:
   *   - een kale PriceSpecification (of helemaal geen @type) zonder eenheid en
   *     zonder referentiehoeveelheid = de prijs;
   *   - alles met een eenheid, een referentiehoeveelheid of een ander @type =
   *     een bedrag van een andere soort. Dat wordt niet weggegooid maar apart
   *     gezet: het is de reden dat de pagina geen artikelprijs heeft, en die
   *     reden hoort de gebruiker te horen. */
  const genest = (
    v: unknown,
  ): { raw: string | number; munt: string; artikelprijs: boolean } | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const inner = v as Record<string, unknown>;
    const raw = scalar(inner["price"]) ?? scalar(inner["value"]);
    if (raw === null) return null;
    const m = inner["priceCurrency"];
    const munt = typeof m === "string" ? m.trim() : "";
    const ts = types(inner);
    /* WAAROM UnitPriceSpecification HIER OOK IN STAAT, terwijl de reparatie van
     * de kiloprijs juist op @type afging.
     *
     * Shopware en Magento schrijven de gewone artikelprijs als een
     * UnitPriceSpecification zonder één eenheidsveld — geen unitCode, geen
     * unitText, geen referenceQuantity. Dat IS de prijs van het artikel, alleen
     * anders opgeschreven. Die werden geweigerd met "het is een bedrag van een
     * andere soort, zoals een prijs per kilo", op een pagina waar geen kiloprijs
     * staat. Een verkeerde oorzaak onder een terechte weigering, en hier zelfs
     * onder een ONterechte weigering.
     *
     * Wat de kiloprijs-fixture tegenhoudt is dus niet het @type maar de
     * eenheidsvelden eronder: die draagt `referenceQuantity: 1 KGM`. Dat is de
     * eigenschap die een eenheidsprijs een eenheidsprijs maakt, en het @type
     * was er alleen een indicatie van. Een DeliveryChargeSpecification blijft
     * buiten de deur omdat die niet in deze lijst staat. */
    const kaal =
      ts.length === 0 ||
      ts.every((t) => /(^|\/|:)(Compound|Unit)?PriceSpecification$/i.test(t));
    const eenheid =
      inner["referenceQuantity"] !== undefined ||
      inner["unitCode"] !== undefined ||
      inner["unitText"] !== undefined ||
      inner["billingIncrement"] !== undefined ||
      inner["billingDuration"] !== undefined;
    return { raw, munt, artikelprijs: kaal && !eenheid };
  };

  /* De volgorde van voorkeur: een bedrag dat er los staat, dan een kale
   * prijsopgave, en pas als geen van beide er is het bedrag van een andere
   * soort — dat laatste niet om het te gebruiken maar om te kunnen zeggen
   * waarom er geen artikelprijs is.
   *
   * Alle sleutels worden bekeken, ook als de eerste al raak is, want een kale
   * prijsopgave ernaast kan de MUNT dragen die bij het losse bedrag ontbreekt.
   * Die munt overnemen van een verzendtarief zou fout zijn; van een kale
   * prijsopgave is het dezelfde prijs, anders opgeschreven. */
  const pick = (
    o: Record<string, unknown>,
    keys: string[],
  ): { raw: string | number; munt: string; artikelprijs: boolean } | null => {
    let direct: string | number | null = null;
    let kaal: { raw: string | number; munt: string; artikelprijs: boolean } | null = null;
    let anders: { raw: string | number; munt: string; artikelprijs: boolean } | null = null;
    for (const k of keys) {
      const s = scalar(o[k]);
      if (s !== null) {
        if (direct === null) direct = s;
        continue;
      }
      const g = genest(o[k]);
      if (!g) continue;
      if (g.artikelprijs) {
        if (!kaal) kaal = g;
      } else if (!anders) {
        anders = g;
      }
    }
    if (direct !== null) return { raw: direct, munt: kaal ? kaal.munt : "", artikelprijs: true };
    return kaal ?? anders;
  };

  /* De munt hoort bij het bedrag dat we hebben gepakt. Vandaar dat een geneste
   * prijsopgave zijn EIGEN priceCurrency meebrengt en die hier voorgaat: de
   * priceCurrency van een verzendtarief bij een artikelprijs leggen is dezelfde
   * fout als een dollarbedrag als euro's rangschikken, alleen kleiner. */
  const currencyOf = (
    o: Record<string, unknown>,
    parent: Record<string, unknown> | null,
  ): string => {
    for (const src of [o, parent]) {
      if (!src) continue;
      for (const k of ["priceCurrency", "currency"]) {
        const v = src[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "";
  };

  d.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    const text = s.textContent;
    if (!text || !text.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* Onparseerbare JSON-LD is geen bedrag en ook geen reden om te gokken. Het
       * blok wordt overgeslagen; de pagina kan langs een andere weg alsnog
       * leesbaar zijn. Dit komt in het wild voor bij servers die hun JSON-LD uit
       * templatefragmenten samenstellen. */
      return;
    }
    const stack: { node: unknown; parent: Record<string, unknown> | null }[] = [
      { node: parsed, parent: null },
    ];
    while (stack.length > 0) {
      const top = stack.pop();
      if (!top) break;
      const { node, parent } = top;
      if (Array.isArray(node)) {
        for (const n of node) stack.push({ node: n, parent });
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      const ts = types(o);
      if (ts.some(isOrder)) {
        const g = pick(o, ["total", "totalPaymentDue", "price", "priceSpecification"]);
        if (g) {
          candidates.push({
            raw: g.raw,
            currency: g.munt || currencyOf(o, parent),
            basis: "bestelling",
            via: g.artikelprijs ? "JSON-LD Order" : "JSON-LD prijsopgave, geen artikelprijs",
          });
        }
      } else if (ts.some(isReeks)) {
        /* EEN AggregateOffer IS GEEN PRIJS MAAR EEN REEKS: laagste en hoogste,
         * over meerdere aanbiedingen. Wat de vorige versie deed was lowPrice
         * pakken en highPrice en offerCount negeren — dan staat er "de prijs van
         * dit artikel: € 219,00" onder een pagina waar dat het bedrag bij een
         * ANDERE verkoper is, en op IKEA de Family-actieprijs onder een
         * gebruiker die misschien geen Family-lid is.
         *
         * Allebei de uiteinden gaan mee, elk met hun eigen etiket. readCheckout
         * leest ze alleen als ze hetzelfde bedrag noemen; dan is de reeks één
         * prijs en valt er niets te kiezen. In alle andere gevallen weigert hij
         * met reden "prijsbereik". Ontbreekt een van de twee uiteinden, dan is
         * het een "vanaf"-prijs en is de bovenkant ONBEKEND — en onbekend is
         * geen nul en ook niet gelijk aan de onderkant. */
        const munt = currencyOf(o, parent);
        const laag = scalar(o["lowPrice"]);
        const hoog = scalar(o["highPrice"]);
        const eigen = scalar(o["price"]);
        if (laag !== null) {
          candidates.push({
            raw: laag,
            currency: munt,
            basis: "artikel",
            via: "JSON-LD AggregateOffer lowPrice",
          });
        }
        if (hoog !== null) {
          candidates.push({
            raw: hoog,
            currency: munt,
            basis: "artikel",
            via: "JSON-LD AggregateOffer highPrice",
          });
        }
        if (eigen !== null) {
          candidates.push({
            raw: eigen,
            currency: munt,
            basis: "artikel",
            via: "JSON-LD AggregateOffer price",
          });
        }
      } else if (ts.some(isOffer)) {
        const g = pick(o, ["price", "priceSpecification"]);
        if (g) {
          candidates.push({
            raw: g.raw,
            currency: g.munt || currencyOf(o, parent),
            basis: "artikel",
            via: g.artikelprijs ? "JSON-LD Offer" : "JSON-LD prijsopgave, geen artikelprijs",
          });
        }
      }
      for (const v of Object.values(o)) {
        if (v && typeof v === "object") stack.push({ node: v, parent: o });
      }
    }
  });

  d.querySelectorAll('[itemprop="price"]').forEach((el) => {
    const raw = (el.getAttribute("content") ?? el.textContent ?? "").trim();
    if (!raw) return;
    /* De munt moet uit DEZELFDE itemscope komen, of uit een scope daarboven.
     * Een prijs uit het ene blok combineren met een munt uit het andere is hoe
     * je een dollarbedrag als euro's gaat rangschikken. */
    let scope: Element | null = el.closest("[itemscope]");
    let itemType = "";
    let currency = "";
    while (scope) {
      if (!itemType) itemType = scope.getAttribute("itemtype") ?? "";
      const c = scope.querySelector('[itemprop="priceCurrency"]');
      if (c) {
        currency = (c.getAttribute("content") ?? c.textContent ?? "").trim();
        break;
      }
      const up: Element | null = scope.parentElement;
      scope = up ? up.closest("[itemscope]") : null;
    }
    candidates.push({
      raw,
      currency,
      basis: isOrder(itemType) ? "bestelling" : "artikel",
      via: 'microdata itemprop="price"',
    });
  });

  const amountEl = d.querySelector(
    'meta[property="product:price:amount"], meta[property="og:price:amount"], meta[name="product:price:amount"]',
  );
  if (amountEl) {
    const amount = (amountEl.getAttribute("content") ?? "").trim();
    if (amount) {
      const currencyEl = d.querySelector(
        'meta[property="product:price:currency"], meta[property="og:price:currency"], meta[name="product:price:currency"]',
      );
      candidates.push({
        raw: amount,
        currency: currencyEl ? (currencyEl.getAttribute("content") ?? "").trim() : "",
        basis: "artikel",
        via: "meta product:price",
      });
    }
  }

  return { host: h, candidates };
}

/* ────────────────────────── het bedrag ontcijferen ───────────────────────── */

/** Een bedrag naar centen, of een reden waarom niet.
 *
 * DE MOEILIJKHEID IS HET SCHEIDINGSTEKEN, en dit is de enige plek in de
 * extensie waar geraden zou kunnen worden. Er wordt niet geraden:
 *
 *  - Een JSON-getal (420) is eenduidig en gaat er zo in.
 *  - Staan er zowel een punt als een komma in ("1.234,56", "1,234.56"), dan is
 *    de LAATSTE de decimaalscheiding. Dat geldt in beide conventies, dus dit is
 *    geen keuze maar een gevolg.
 *  - Staat er één scheidingsteken met precies twee cijfers erachter ("39,99"),
 *    dan is het de decimaalscheiding. Ook eenduidig genoeg.
 *  - Staat er één scheidingsteken met precies DRIE cijfers erachter ("1.234"),
 *    dan is het écht dubbelzinnig: schema.org schrijft de punt als decimaal en
 *    dan is dat € 1,23; de Nederlandse gewoonte maakt er € 1.234 van. Een factor
 *    duizend. Hier wordt geweigerd met reden "bedrag-onduidelijk". Toen deze tak
 *    er nog niet was, koos de code de Nederlandse lezing, en dan gaf een
 *    schema.org-conforme winkel met "1.234" een winkelwagen van € 1.234 in
 *    plaats van € 1,23 — waarna er een percentage over wordt uitgerekend en het
 *    verschil netjes meegroeit.
 *  - Meer dan één keer hetzelfde teken ("1.234.567") kan alleen duizendtallen
 *    zijn, dus dat is weer eenduidig.
 *
 * Het valutateken gaat er hier af omdat het geen cijfer is. Dat het ergens
 * GELEZEN wordt voordat het verdwijnt, gebeurt in currencySignal hieronder —
 * niet hier, want deze functie gaat over het getal en niet over de munt. */
export function parseAmountToCents(
  raw: string | number,
): { ok: true; cents: number } | { ok: false; reason: ReadReason } {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "bedrag-niet-leesbaar" };
    if (raw < 0) return { ok: false, reason: "bedrag-negatief" };
    return { ok: true, cents: Math.round(raw * 100) };
  }

  /* Valutatekens en spaties (ook de harde) eraf, AAN ALLEBEI DE KANTEN.
   *
   * Hier stond alleen `^[€$£]` en `(EUR|USD|GBP)$`, en daardoor viel de gewone
   * Nederlandse schrijfwijze "96,99 €" in de weigerbak — met een uitleg over
   * duizendtallen eronder. "EUR 96,99", zoals talloze feeds het schrijven, ook.
   * Dat waren geen onleesbare bedragen maar een te smalle strip.
   *
   * Dat we het teken hier weghalen kost niets: currencySignal leest het
   * afzonderlijk uit dezelfde ruwe string, en die functie krijgt de ruwe waarde
   * en niet deze. Deze functie gaat over het getal. */
  const s = raw
    .replace(/\s| /g, "")
    .replace(/^(?:EUR|USD|GBP)/i, "")
    .replace(/^[€$£]/, "")
    .replace(/(?:EUR|USD|GBP)$/i, "")
    .replace(/[€$£]$/, "");

  /* Nu moet er een getal staan. Staat er iets ANDERS — "vanaf 39,99", "circa
   * 40", "op aanvraag" — dan is dat de oorzaak, en niet een scheidingsteken dat
   * twee dingen kan betekenen. */
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, reason: "bedrag-niet-leesbaar" };
  if (s.startsWith("-")) return { ok: false, reason: "bedrag-negatief" };

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let normalised: string;
  if (dots > 0 && commas > 0) {
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalised = s.split(thousands).join("").replace(decimal, ".");
  } else if (dots + commas === 0) {
    normalised = s;
  } else if (dots > 1 || commas > 1) {
    normalised = s.replace(/[.,]/g, "");
  } else {
    const sep = dots === 1 ? "." : ",";
    const after = s.length - s.indexOf(sep) - 1;
    /* Drie cijfers erachter: dubbelzinnig, en dít is het enige geval waar de
     * duizendtal-uitleg over gaat. Nul cijfers erachter ("39,") is iets anders:
     * daar is iets afgekapt en weten we niet wat. Die twee kregen dezelfde
     * reden en dus dezelfde, half onware uitleg. */
    if (after === 3) return { ok: false, reason: "bedrag-onduidelijk" };
    if (after === 0) return { ok: false, reason: "bedrag-afgekapt" };
    normalised = s.replace(sep, ".");
  }

  const n = Number(normalised);
  if (!Number.isFinite(n)) return { ok: false, reason: "bedrag-niet-leesbaar" };
  if (n < 0) return { ok: false, reason: "bedrag-negatief" };
  return { ok: true, cents: Math.round(n * 100) };
}

/* ─────────────────────────────── de munt ─────────────────────────────────── */

/** Wat het bedrag ZELF over zijn munt zegt, los van wat de opmaak beweert.
 *
 * "$1,299.00" met priceCurrency EUR is geen euro-bedrag met een vlekje: het zijn
 * twee bronnen op dezelfde pagina die elkaar tegenspreken. De vorige versie
 * streepte het teken weg voordat er iets mee gebeurde en toonde € 1.299,00.
 *
 * Het dollarteken krijgt hier geen muntcode maar "DOLLAR", en dat is het punt:
 * $ hoort bij een familie (USD, CAD, AUD, SGD …) en wijst er geen van aan. Wat
 * het WEL uitsluit is de euro en het pond, want die schrijven zich anders. Meer
 * dan dat beweren zou raden zijn. */
export type CurrencySignal = "EUR" | "GBP" | "DOLLAR";

export function currencySignal(raw: string | number): CurrencySignal | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s| /g, "");
  if (s.includes("€")) return "EUR";
  if (s.includes("£")) return "GBP";
  if (s.includes("$")) return "DOLLAR";
  const m = /^(EUR|USD|GBP)|(EUR|USD|GBP)$/i.exec(s);
  if (m) {
    const code = (m[1] ?? m[2] ?? "").toUpperCase();
    if (code === "EUR") return "EUR";
    if (code === "GBP") return "GBP";
    return "DOLLAR";
  }
  return null;
}

/** Spreken het teken bij het bedrag en de opgegeven munt elkaar tegen? Alleen
 *  wat te bewijzen is telt: een dollarteken sluit euro en pond uit, maar zegt
 *  niet welke dollar het is, dus "$" bij "CAD" is geen tegenspraak. */
function muntSpreektTegen(teken: CurrencySignal | null, opgegeven: string): boolean {
  if (!teken || !opgegeven.trim()) return false;
  const m = opgegeven.trim().toUpperCase();
  if (teken === "EUR") return m !== "EUR";
  if (teken === "GBP") return m !== "GBP";
  return m === "EUR" || m === "GBP";
}

/** De munt van een kandidaat: wat de opmaak zegt, en anders wat het teken zegt.
 *
 *  Een pagina die "€ 89,95" schrijft zonder priceCurrency NOEMT de munt — hem
 *  daar "er staat geen munt bij" tegen zeggen zou een oorzaak noemen die er niet
 *  is. Een dollarteken levert géén munt op: dan is inderdaad onbekend welke. */
function muntVan(c: PriceCandidate): string {
  if (c.currency.trim()) return c.currency.trim().toUpperCase();
  const teken = currencySignal(c.raw);
  return teken === "EUR" || teken === "GBP" ? teken : "";
}

/* ─────────────── van bewijsmateriaal naar één bedrag, of niets ───────────── */

const REASON_TEXT: Record<ReadReason, string> = {
  "geen-prijsmarkup":
    "Deze pagina zet het bedrag nergens machineleesbaar neer. Er is dus niets te lezen — vul het bedrag zelf in.",
  "geen-artikelprijs":
    "Er staat wel een bedrag in de opmaak van deze pagina, maar het is niet de prijs van dit artikel: het is een bedrag van een andere soort, zoals een prijs per kilo of de verzendkosten. Wat het artikel zelf kost, staat er niet machineleesbaar bij. Vul het bedrag zelf in.",
  "prijsbereik":
    "Deze pagina noemt geen prijs maar een bereik — een laagste en een hoogste bedrag, bijvoorbeeld van meerdere aanbieders of van een actieprijs naast de gewone prijs. Welke van de twee jij betaalt, staat er niet bij. Vul het bedrag zelf in.",
  "prijs-vanaf":
    "Deze pagina noemt maar één kant van een prijsbereik — een vanaf-prijs of een tot-prijs. De andere kant staat er niet, en onbekend is niet hetzelfde als de kant die er wel staat. Vul het bedrag zelf in.",
  "prijs-zonder-valuta":
    "Er staat wel een bedrag op de pagina, maar er staat niet bij in welke munt. Zonder munt is niet te zeggen of dit euro's of dollars zijn, en dat verandert het antwoord volledig. Een dollarteken alleen is niet genoeg: dat schrijven de Amerikaanse, de Canadese en de Australische dollar allemaal zo. Vul het bedrag en de munt zelf in.",
  "munt-spreekt-tegen":
    "Deze pagina is het met zichzelf oneens over de munt. Dat kan op twee manieren: het teken bij het bedrag hoort bij een andere munt dan de opmaak noemt, of hetzelfde bedrag staat er twee keer met een andere munt erbij. Twee bronnen die elkaar tegenspreken zijn geen bedrag, en welke van de twee klopt staat er niet bij. Vul het bedrag en de munt zelf in.",
  "meerdere-prijzen":
    "De pagina noemt meer dan één bedrag, en welke bij jouw bestelling hoort staat er niet bij. Vul het bedrag zelf in.",
  "bedrag-onduidelijk":
    "Het bedrag op de pagina is niet eenduidig te lezen: er staat één punt of komma met precies drie cijfers erachter, en dat kan \"1.234\" \u2014 € 1,23 volgens schema.org, € 1.234 volgens de Nederlandse gewoonte \u2014 duizend keer laten schelen. Vul het bedrag zelf in.",
  "bedrag-afgekapt":
    "Het bedrag op de pagina eindigt op een punt of komma zonder cijfers erachter. Er is dus iets afgekapt, en wat er weg is weten we niet. Vul het bedrag zelf in.",
  "bedrag-niet-leesbaar":
    "In het prijsveld van deze pagina staat niet alleen een getal — er staat bijvoorbeeld \"vanaf\" of \"circa\" bij. Wat je hier werkelijk afrekent staat er dus niet. Vul het bedrag zelf in.",
  "bedrag-negatief":
    "Het bedrag in de opmaak van deze pagina is negatief. Dat is een korting of een terugboeking en geen aankoopbedrag. Vul het bedrag zelf in.",
};

export function reasonText(reason: ReadReason): string {
  return REASON_TEXT[reason];
}

/** Dezelfde oorzaken, maar voor het HANDMATIGE veld in de popup.
 *
 *  WAAROM DEZE TWEEDE LIJST BESTAAT. De teksten hierboven eindigen allemaal met
 *  "vul het bedrag zelf in", en dat is het goede advies zolang de oorzaak op een
 *  PAGINA ligt. In het handmatige veld heeft hij dat net gedaan: daar leest
 *  "vul het bedrag zelf in" als een advies dat hij al heeft opgevolgd, en
 *  "het bedrag op de pagina" als een oorzaak die er niet is.
 *
 *  De vorige oplossing was één hardgecodeerde zin in popup.ts. Die noemde bij
 *  vier van de vijf oorzaken het verkeerde probleem — dezelfde fout, één laag
 *  hoger. Twee lijsten naast elkaar in hetzelfde bestand kunnen niet uit elkaar
 *  lopen zonder dat tsc erover valt: `Record<ReadReason, string>` dwingt af dat
 *  elke reden in allebei staat. */
const HANDMATIG_TEXT: Record<ReadReason, string> = {
  "geen-prijsmarkup": "Er staat geen getal in dit veld. Typ het bedrag in euro's, bijvoorbeeld 49,99.",
  "geen-artikelprijs": "Typ het bedrag dat je afrekent, in euro's — bijvoorbeeld 49,99.",
  "prijsbereik": "Typ één bedrag en geen bereik: het bedrag dat je hier werkelijk afrekent.",
  "prijs-vanaf": "Typ het bedrag dat je werkelijk afrekent, niet de vanaf-prijs.",
  "prijs-zonder-valuta": "Typ alleen het bedrag in euro's; de munt van de winkel kies je in het vak eronder.",
  "munt-spreekt-tegen": "Typ alleen het bedrag in euro's; de munt van de winkel kies je in het vak eronder.",
  "meerdere-prijzen": "Typ één bedrag: het totaal dat je hier afrekent.",
  "bedrag-onduidelijk":
    "Eén punt of komma met drie cijfers erachter kan twee dingen betekenen: \"1.234\" is € 1,23 volgens schema.org en € 1.234 volgens de Nederlandse gewoonte. Dat scheelt duizend keer, dus we kiezen niet. Schrijf het voluit met centen — 1234,00 of 1.234,00 — dan is er niets te raden.",
  "bedrag-afgekapt": "Er staat een punt of komma zonder cijfers erachter. Schrijf de centen erbij, bijvoorbeeld 39,00.",
  "bedrag-niet-leesbaar":
    "Er staat iets anders dan een getal in het veld. Alleen cijfers, met een komma voor de centen — bijvoorbeeld 49,99.",
  "bedrag-negatief":
    "Dit is een negatief bedrag. Vul in wat je afrekent, niet wat je terugkrijgt — bijvoorbeeld 49,99.",
};

export function reasonTextHandmatig(reason: ReadReason): string {
  return HANDMATIG_TEXT[reason];
}

function weiger(reason: ReadReason): Reading {
  return { ok: false, reason, detail: REASON_TEXT[reason] };
}

/** Is dit bedrag een uiteinde van een AggregateOffer-reeks? */
function isReeks(c: PriceCandidate): boolean {
  return c.via === VIA_REEKS_LAAG || c.via === VIA_REEKS_HOOG || c.via === VIA_REEKS_PRIJS;
}

/** Wat er van een AggregateOffer-reeks te maken valt.
 *
 *  "een-bedrag"  — laagste én hoogste staan er en noemen hetzelfde bedrag. Dan
 *                  valt er niets te kiezen en is de reeks gewoon een prijs.
 *  "bereik"      — allebei de uiteinden staan er en ze verschillen.
 *  "eenzijdig"   — er staat maar één uiteinde. De andere kant is ONBEKEND, en
 *                  onbekend is niet gelijk aan de kant die er wel staat.
 *
 *  DIT ONDERSCHEID BESTAAT OMDAT DE TEKST HET MOET DRAGEN. Beide gevallen
 *  weigeren terecht, maar de uitleg "een laagste EN een hoogste bedrag" is bij
 *  een vanaf-prijs onwaar — daar staat er precies één. Een oorzaak die er niet
 *  is, is nog steeds een verkeerde oorzaak, ook als de weigering klopt. */
type ReeksVorm = "een-bedrag" | "bereik" | "eenzijdig";

function reeksVorm(reeks: PriceCandidate[]): ReeksVorm {
  const heeftLaag = reeks.some((c) => c.via === VIA_REEKS_LAAG);
  const heeftHoog = reeks.some((c) => c.via === VIA_REEKS_HOOG);
  if (!heeftLaag || !heeftHoog) return "eenzijdig";
  const bedragen = new Set<number>();
  for (const c of reeks) {
    const p = parseAmountToCents(c.raw);
    /* Een uiteinde dat we niet kunnen lezen maakt de reeks niet eenzijdig maar
     * onbepaald: we weten dan niet of de twee kanten gelijk zijn. Dat is een
     * bereik en geen prijs. */
    if (!p.ok) return "bereik";
    bedragen.add(p.cents);
  }
  return bedragen.size === 1 ? "een-bedrag" : "bereik";
}

export function readCheckout(ev: Evidence): Reading {
  if (ev.candidates.length === 0) return weiger("geen-prijsmarkup");

  /* Bedragen van een andere soort (kiloprijs, verzendtarief) zijn geen
   * kandidaten. Blijft er daarna niets over, dan is DAT de oorzaak, en niet
   * "er staat niets machineleesbaar op de pagina" — want er staat wel iets, het
   * is alleen niet de prijs. */
  const bruikbaar = ev.candidates.filter((c) => c.via !== VIA_GEEN_ARTIKELPRIJS);
  if (bruikbaar.length === 0) return weiger("geen-artikelprijs");

  /* Een ordertotaal slaat een artikelprijs altijd. Zijn er ordertotalen, dan
   * worden de artikelprijzen niet eens bekeken: dat zijn de regels ÓNDER dat
   * totaal, en die ernaast leggen zou "meerdere prijzen" opleveren waar er in
   * werkelijkheid één antwoord is. Gemeten in de Order-fixture: totaal 312,45
   * met regels van 149,00 en 163,45 eronder. */
  const orders = bruikbaar.filter((c) => c.basis === "bestelling");
  const tier = orders.length > 0 ? orders : bruikbaar;

  /* Een reeks vergiftigt de hele lezing, ook als er een losse Offer naast
   * staat. Gemeten op IKEA: de AggregateOffer zegt 96,99 tot 114,99 en de Offer
   * eronder zegt 96,99 — dat is niet "twee keer hetzelfde", dat is de
   * Family-prijs die zichzelf herhaalt terwijl de andere kant van de reeks is
   * wat een niet-lid afrekent. Welke van de twee deze gebruiker betaalt, weet
   * de pagina niet en wij dus ook niet. */
  const reeks = tier.filter(isReeks);
  if (reeks.length > 0) {
    const vorm = reeksVorm(reeks);
    if (vorm === "bereik") return weiger("prijsbereik");
    if (vorm === "eenzijdig") return weiger("prijs-vanaf");
  }

  for (const c of tier) {
    if (muntSpreektTegen(currencySignal(c.raw), c.currency)) return weiger("munt-spreekt-tegen");
  }

  const parsed: { cents: number; currency: string; basis: Basis; via: string }[] = [];
  let softReason: ReadReason | null = null;
  for (const c of tier) {
    const p = parseAmountToCents(c.raw);
    if (!p.ok) {
      softReason = p.reason;
      continue;
    }
    parsed.push({ cents: p.cents, currency: muntVan(c), basis: c.basis, via: c.via });
  }

  if (parsed.length === 0) return weiger(softReason ?? "geen-prijsmarkup");

  /* ONTDUBBELEN OP HET BEDRAG, NIET OP BEDRAG-PLUS-MUNT. Dat laatste deed de
   * vorige versie, en dan telt een JSON-LD Offer van 49,99 EUR naast een
   * og-meta van 49,99 zonder munt — een doodgewone combinatie — als twee
   * prijzen. De gebruiker las dan "De pagina noemt meer dan één bedrag" terwijl
   * de pagina één bedrag noemt en het twee keer opschrijft. Verkeerde oorzaak,
   * en een eenduidige lezing die werd weggegooid.
   *
   * Verschillende bedragen blijven weigeren. Hetzelfde bedrag met twee
   * VERSCHILLENDE munten ook, maar dan met de munt als oorzaak: dat is een
   * tegenspraak en geen tweede prijs. */
  const bedragen = new Set(parsed.map((p) => p.cents));
  if (bedragen.size > 1) return weiger("meerdere-prijzen");

  const munten = new Set(parsed.map((p) => p.currency).filter((m) => m !== ""));
  if (munten.size > 1) return weiger("munt-spreekt-tegen");

  /* De kopie mét munt wint van de kopie zonder: allebei noemen ze hetzelfde
   * bedrag, dus de enige vraag is welke van de twee de munt draagt. */
  const winner = parsed.find((p) => p.currency !== "") ?? parsed[0];
  if (!winner) return weiger("geen-prijsmarkup");
  if (!winner.currency) return weiger("prijs-zonder-valuta");
  return {
    ok: true,
    amountCents: winner.cents,
    currency: winner.currency,
    basis: winner.basis,
    via: winner.via,
  };
}
