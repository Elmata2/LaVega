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
 * En er zijn vier redenen om te weigeren. Alle vier noemen de echte oorzaak, en
 * bij alle vier is het handmatige veld het antwoord dat in die toestand wél
 * werkt. */

export type Basis = "bestelling" | "artikel";

export type ReadReason =
  | "geen-prijsmarkup"
  | "prijs-zonder-valuta"
  | "meerdere-prijzen"
  | "bedrag-onduidelijk";

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
 *
 * Vandaar ook de twee nullable parameters. De `args` van executeScript moeten
 * JSON-serialiseerbaar zijn en een Document is dat niet, dus de injectie roept
 * haar aan met (null, null) en de functie pakt de globals van de pagina zelf.
 * In de test gaat er een jsdom-Document in. Zo is er één implementatie in plaats
 * van twee die uiteen kunnen lopen. */
export function collectEvidence(doc?: Document | null, host?: string | null): Evidence {
  const d: Document = doc ?? document;
  const h: string = host ?? location.host;
  const candidates: PriceCandidate[] = [];

  const isOrder = (t: string) => /(^|\/|:)(Order|Invoice)$/i.test(t);
  const isOffer = (t: string) => /(^|\/|:)(Offer|AggregateOffer)$/i.test(t);

  const types = (o: Record<string, unknown>): string[] => {
    const t = o["@type"];
    if (typeof t === "string") return [t];
    if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
    return [];
  };

  const pick = (o: Record<string, unknown>, keys: string[]): string | number | null => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "number" || (typeof v === "string" && v.trim())) return v;
      /* schema.org staat ook een PriceSpecification toe waar een getal mag
       * staan. Eén niveau diep volgen is genoeg; dieper wordt het raden welk van
       * meerdere geneste bedragen bedoeld is, en dan is weigeren beter. */
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = v as Record<string, unknown>;
        const p = inner["price"] ?? inner["value"];
        if (typeof p === "number" || (typeof p === "string" && p.trim())) return p;
      }
    }
    return null;
  };

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
      const spec = src["priceSpecification"];
      if (spec && typeof spec === "object" && !Array.isArray(spec)) {
        const v = (spec as Record<string, unknown>)["priceCurrency"];
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
        const raw = pick(o, ["total", "totalPaymentDue", "price", "priceSpecification"]);
        if (raw !== null) {
          candidates.push({ raw, currency: currencyOf(o, parent), basis: "bestelling", via: "JSON-LD Order" });
        }
      } else if (ts.some(isOffer)) {
        const raw = pick(o, ["price", "lowPrice", "priceSpecification"]);
        if (raw !== null) {
          candidates.push({ raw, currency: currencyOf(o, parent), basis: "artikel", via: "JSON-LD Offer" });
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
 *    zijn, dus dat is weer eenduidig. */
export function parseAmountToCents(
  raw: string | number,
): { ok: true; cents: number } | { ok: false; reason: ReadReason } {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false, reason: "bedrag-onduidelijk" };
    return { ok: true, cents: Math.round(raw * 100) };
  }

  /* Valutatekens en spaties (ook de harde) eraf. Alles wat daarna nog geen
   * cijfer of scheidingsteken is, maakt het bedrag onbetrouwbaar in plaats van
   * leesbaar — "vanaf 39,99" is geen prijs die je mag gebruiken. */
  const s = raw.replace(/\s| /g, "").replace(/^[€$£]/, "").replace(/(EUR|USD|GBP)$/i, "");
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, reason: "bedrag-onduidelijk" };

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
    /* Drie cijfers erachter: dubbelzinnig. Nul cijfers erachter ("39,"): geen
     * bedrag, want dan is er iets afgekapt en weten we niet wat. */
    if (after === 3 || after === 0) return { ok: false, reason: "bedrag-onduidelijk" };
    normalised = s.replace(sep, ".");
  }

  const n = Number(normalised);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: "bedrag-onduidelijk" };
  return { ok: true, cents: Math.round(n * 100) };
}

/* ─────────────── van bewijsmateriaal naar één bedrag, of niets ───────────── */

const REASON_TEXT: Record<ReadReason, string> = {
  "geen-prijsmarkup":
    "Deze pagina zet het bedrag nergens machineleesbaar neer. Er is dus niets te lezen — vul het bedrag zelf in.",
  "prijs-zonder-valuta":
    "Er staat wel een bedrag op de pagina, maar geen munt. Zonder munt is niet te zeggen of dit euro's of dollars zijn, en dat verandert het antwoord volledig. Vul het bedrag en de munt zelf in.",
  "meerdere-prijzen":
    "De pagina noemt meer dan één bedrag, en welke bij jouw bestelling hoort staat er niet bij. Vul het bedrag zelf in.",
  "bedrag-onduidelijk":
    "Het bedrag op de pagina is niet eenduidig te lezen — bij één punt met drie cijfers erachter kan het duizend keer schelen. Vul het bedrag zelf in.",
};

export function reasonText(reason: ReadReason): string {
  return REASON_TEXT[reason];
}

export function readCheckout(ev: Evidence): Reading {
  if (ev.candidates.length === 0) {
    return { ok: false, reason: "geen-prijsmarkup", detail: REASON_TEXT["geen-prijsmarkup"] };
  }

  /* Een ordertotaal slaat een artikelprijs altijd. Zijn er ordertotalen, dan
   * worden de artikelprijzen niet eens bekeken: dat zijn de regels ÓNDER dat
   * totaal, en die ernaast leggen zou "meerdere prijzen" opleveren waar er in
   * werkelijkheid één antwoord is. Gemeten in de Order-fixture: totaal 312,45
   * met regels van 149,00 en 163,45 eronder. */
  const orders = ev.candidates.filter((c) => c.basis === "bestelling");
  const tier = orders.length > 0 ? orders : ev.candidates;

  const parsed: { cents: number; currency: string; basis: Basis; via: string }[] = [];
  let softReason: ReadReason | null = null;
  for (const c of tier) {
    const p = parseAmountToCents(c.raw);
    if (!p.ok) {
      softReason = p.reason;
      continue;
    }
    parsed.push({ cents: p.cents, currency: c.currency.toUpperCase(), basis: c.basis, via: c.via });
  }

  if (parsed.length === 0) {
    const reason = softReason ?? "geen-prijsmarkup";
    return { ok: false, reason, detail: REASON_TEXT[reason] };
  }

  const distinct = new Set(parsed.map((p) => `${p.cents}|${p.currency}`));
  if (distinct.size > 1) {
    return { ok: false, reason: "meerdere-prijzen", detail: REASON_TEXT["meerdere-prijzen"] };
  }

  const winner = parsed[0];
  if (!winner) {
    return { ok: false, reason: "geen-prijsmarkup", detail: REASON_TEXT["geen-prijsmarkup"] };
  }
  if (!winner.currency) {
    return { ok: false, reason: "prijs-zonder-valuta", detail: REASON_TEXT["prijs-zonder-valuta"] };
  }
  return {
    ok: true,
    amountCents: winner.cents,
    currency: winner.currency,
    basis: winner.basis,
    via: winner.via,
  };
}
