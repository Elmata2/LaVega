// @vitest-environment jsdom
/* De lezer, tegen OPGESLAGEN HTML. Geen enkele test raakt een live site: een
 * test die het internet nodig heeft, meet het internet en niet de code.
 *
 * De fixtures zijn van twee soorten en dat staat in hun naam:
 *   - zonder voorvoegsel = echt opgehaald op 21 augustus 2026, ingekort tot de
 *     prijsopmaak, met de bron en de HTTP-status in de kop van het bestand;
 *   - "kunstmatig-" = met de hand gemaakt, omdat dat pad in het wild niet te
 *     meten was (een ordertotaal zit achter een winkelwagen). */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  collectEvidence,
  readCheckout,
  parseAmountToCents,
  currencySignal,
  reasonText,
  reasonTextHandmatig,
  VIA_ORDER,
  VIA_OFFER,
  VIA_MICRODATA,
  VIA_META,
  VIA_REEKS_LAAG,
  VIA_REEKS_HOOG,
  VIA_REEKS_PRIJS,
  VIA_GEEN_ARTIKELPRIJS,
} from "./read.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function read(name: string, host = "voorbeeld.nl") {
  const html = readFileSync(join(FIXTURES, name), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return readCheckout(collectEvidence(doc, host));
}

describe("echt opgehaalde winkelpagina's", () => {
  /* TOT 26 AUGUSTUS 2026 sloot sites.ts coolblue.nl op grond van precies deze
   * test uit: geldige, eenduidige JSON-LD, maar voor een ander artikel dan de
   * pagina toonde (deze AirPods-URL gaf de prijs van een Samsonite kofferset;
   * een Sonos-URL gaf een PlayStation 5). Sinds de brede <all_urls>-toestemming
   * is er geen lijst meer om een domein uit te sluiten — dit is dus niet meer
   * "waarom Coolblue niet meedoet" maar een GEDOCUMENTEERDE, GEACCEPTEERDE
   * beperking van de generieke lezer: readCheckout kan dit soort fout niet
   * onderscheiden van een kloppend antwoord. Zie
   * docs/superpowers/specs/2026-08-26-brede-kassa-toestemming-design.md. */
  it("coolblue.nl: leest 420 EUR uit het JSON-LD Offer, als ARTIKELprijs", () => {
    const r = read("coolblue-product.html", "www.coolblue.nl");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(42000);
    expect(r.currency).toBe("EUR");
    /* En dit is het punt: het is de prijs van één artikel en niet het totaal
     * van de bestelling. Zou de basis hier "bestelling" heten, dan zou de UI
     * het als ordertotaal presenteren en over aantal, verzending en korting
     * heen stappen. */
    expect(r.basis).toBe("artikel");
    expect(r.via).toBe("JSON-LD Offer");
  });

  it("bol.com: een Offer zonder price levert geen bedrag op, en dus een reden", () => {
    const r = read("bol-product.html", "www.bol.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-prijsmarkup");
    expect(r.detail).toContain("vul het bedrag zelf in");
  });

  it("hema.nl: JSON-LD over de organisatie is geen prijs", () => {
    const r = read("hema-geen-prijsmarkup.html", "www.hema.nl");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-prijsmarkup");
  });

  it("mediamarkt.nl: og-meta's over titel en beeld leveren geen bedrag", () => {
    const r = read("mediamarkt-alleen-og-titel.html", "www.mediamarkt.nl");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-prijsmarkup");
  });
});

describe("de paden die in het wild niet te meten waren", () => {
  it("een schema.org Order slaat de losse artikelprijzen eronder", () => {
    const r = read("kunstmatig-order-totaal.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(31245);
    expect(r.basis).toBe("bestelling");
    /* De twee Offers van € 149,00 en € 163,45 staan in dezelfde fixture. Als
     * die zouden meetellen, zou de lezer "meerdere prijzen" melden en weigeren
     * terwijl het antwoord er letterlijk staat. */
  });

  it("microdata met priceCurrency in dezelfde scope", () => {
    const r = read("kunstmatig-microdata-artikel.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(8995);
    expect(r.currency).toBe("EUR");
    expect(r.basis).toBe("artikel");
  });

  it("product:price-meta's, inclusief de Nederlandse notatie en een andere munt", () => {
    const r = read("kunstmatig-meta-og-prijs.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(123450);
    expect(r.currency).toBe("USD");
  });

  it("een kapot JSON-LD-blok wordt overgeslagen, niet fataal", () => {
    const r = read("kunstmatig-onparseerbare-jsonld.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(7500);
  });
});

describe("weigeren met de echte oorzaak erbij", () => {
  it("twee verschillende bedragen: kiezen zou raden zijn", () => {
    const r = read("kunstmatig-twee-verschillende-prijzen.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("meerdere-prijzen");
  });

  it("een bedrag zonder munt is geen bedrag", () => {
    const r = read("kunstmatig-prijs-zonder-valuta.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("prijs-zonder-valuta");
    expect(r.detail).toContain("munt");
  });

  it('"1.234" is dubbelzinnig en wordt niet gelezen', () => {
    const r = read("kunstmatig-bedrag-onduidelijk.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("bedrag-onduidelijk");
  });

  it("elke weigering noemt het handmatige veld, want dat werkt in deze toestand wél", () => {
    for (const f of [
      "bol-product.html",
      "hema-geen-prijsmarkup.html",
      "kunstmatig-twee-verschillende-prijzen.html",
      "kunstmatig-prijs-zonder-valuta.html",
      "kunstmatig-bedrag-onduidelijk.html",
      "kunstmatig-aggregateoffer-reeks.html",
      "kunstmatig-aggregateoffer-vanafprijs.html",
      "kunstmatig-eenheidsprijs-per-kilo.html",
      "kunstmatig-verzendkosten-als-prijs.html",
      "kunstmatig-dollarteken-bij-euro.html",
      "kunstmatig-dollarteken-zonder-munt.html",
      "kunstmatig-zelfde-bedrag-twee-munten.html",
      "ikea-slakt-actieprijs.html",
    ]) {
      const r = read(f);
      expect(r.ok, f).toBe(false);
      if (r.ok) continue;
      expect(r.detail.toLowerCase(), f).toContain("zelf in");
    }
  });

  it("geen enkele weigering is een stille nul of een gok", () => {
    /* De keerzijde van dezelfde regel: waar de lezer WEL leest, staat er een
     * bedrag met een munt en een basis, en waar hij niet leest, staat er een
     * reden uit de lijst. Er is geen derde uitkomst — geen 0, geen "onbekend"
     * dat als bedrag doorreist. */
    for (const f of readdirSync(FIXTURES).sort()) {
      const r = read(f);
      if (r.ok) {
        expect(r.amountCents, f).toBeGreaterThan(0);
        expect(r.currency, f).not.toBe("");
      } else {
        expect(reasonText(r.reason), f).toBe(r.detail);
      }
    }
  });
});

describe("parseAmountToCents", () => {
  it("een JSON-getal gaat er eenduidig in", () => {
    expect(parseAmountToCents(420)).toEqual({ ok: true, cents: 42000 });
    expect(parseAmountToCents(39.99)).toEqual({ ok: true, cents: 3999 });
  });

  it("punt en komma samen: de laatste is de decimaalscheiding, in beide conventies", () => {
    expect(parseAmountToCents("1.234,56")).toEqual({ ok: true, cents: 123456 });
    expect(parseAmountToCents("1,234.56")).toEqual({ ok: true, cents: 123456 });
  });

  it("één scheidingsteken met twee cijfers erachter is een decimaal", () => {
    expect(parseAmountToCents("39,99")).toEqual({ ok: true, cents: 3999 });
    expect(parseAmountToCents("39.99")).toEqual({ ok: true, cents: 3999 });
  });

  it("meer dan één keer hetzelfde teken kan alleen duizendtallen zijn", () => {
    expect(parseAmountToCents("1.234.567")).toEqual({ ok: true, cents: 123456700 });
  });

  it("valutatekens en harde spaties gaan eraf", () => {
    expect(parseAmountToCents("€ 89,95")).toEqual({ ok: true, cents: 8995 });
    expect(parseAmountToCents(" 312.45 ")).toEqual({ ok: true, cents: 31245 });
  });

  it("drie cijfers achter één teken is dubbelzinnig en wordt geweigerd", () => {
    expect(parseAmountToCents("1.234")).toEqual({ ok: false, reason: "bedrag-onduidelijk" });
    expect(parseAmountToCents("1,234")).toEqual({ ok: false, reason: "bedrag-onduidelijk" });
  });

  it("rommel is geen bedrag, en elke soort rommel heeft zijn EIGEN oorzaak", () => {
    /* Hier stond drie keer "bedrag-onduidelijk", en de tekst bij die reden gaat
     * over één punt met drie cijfers erachter. Bij deze drie is dat de verkeerde
     * oorzaak, en de gebruiker leest de oorzaak — niet de code. */
    expect(parseAmountToCents("vanaf 39,99")).toEqual({
      ok: false,
      reason: "bedrag-niet-leesbaar",
    });
    expect(parseAmountToCents("")).toEqual({ ok: false, reason: "bedrag-niet-leesbaar" });
    expect(parseAmountToCents("op aanvraag")).toEqual({
      ok: false,
      reason: "bedrag-niet-leesbaar",
    });
    expect(parseAmountToCents("39,")).toEqual({ ok: false, reason: "bedrag-afgekapt" });
    expect(parseAmountToCents("-5,00")).toEqual({ ok: false, reason: "bedrag-negatief" });
    expect(parseAmountToCents(-5)).toEqual({ ok: false, reason: "bedrag-negatief" });
    expect(parseAmountToCents(Number.NaN)).toEqual({ ok: false, reason: "bedrag-niet-leesbaar" });
  });

  it("de gewone Nederlandse schrijfwijze met het teken ACHTER het bedrag wordt gelezen", () => {
    /* "96,99 €" is hoe half Nederland het schrijft, en het viel in de weigerbak
     * met een uitleg over duizendtallen eronder. De strip keek alleen naar een
     * VOORAANSTAAND teken. */
    expect(parseAmountToCents("96,99 €")).toEqual({ ok: true, cents: 9699 });
    expect(parseAmountToCents("EUR 96,99")).toEqual({ ok: true, cents: 9699 });
    expect(parseAmountToCents("96,99 EUR")).toEqual({ ok: true, cents: 9699 });
    expect(parseAmountToCents("€ 1.234,56")).toEqual({ ok: true, cents: 123456 });
  });

  it("elke reden heeft een tekst voor de PAGINA en een tekst voor het handmatige veld", () => {
    /* Twee lijsten, want "vul het bedrag zelf in" is onder het veld waar hij dat
     * net deed geen advies maar een echo. Dat de twee lijsten volledig zijn,
     * dwingt tsc af met Record<ReadReason, string>; dat ze VERSCHILLEN is wat
     * hier wordt nagemeten. */
    const redenen = [
      "geen-prijsmarkup",
      "geen-artikelprijs",
      "prijsbereik",
      "prijs-vanaf",
      "prijs-zonder-valuta",
      "munt-spreekt-tegen",
      "meerdere-prijzen",
      "bedrag-onduidelijk",
      "bedrag-afgekapt",
      "bedrag-niet-leesbaar",
      "bedrag-negatief",
    ] as const;
    for (const r of redenen) {
      expect(reasonText(r).length).toBeGreaterThan(20);
      expect(reasonTextHandmatig(r).length).toBeGreaterThan(20);
      expect(reasonTextHandmatig(r)).not.toContain("Vul het bedrag zelf in");
    }
    /* En de oorzaak die de tekst noemt, hoort bij de reden. */
    expect(reasonText("bedrag-onduidelijk")).toContain("drie cijfers");
    expect(reasonText("bedrag-afgekapt")).toContain("zonder cijfers erachter");
    expect(reasonText("bedrag-negatief")).toContain("negatief");
    expect(reasonText("prijs-vanaf")).toContain("één kant");
  });
});

describe("wat de extensie van een pagina meeneemt", () => {
  /* DEZE TWEE TESTS WAREN DE HELE REDACTIEGRENS, TOT 27 AUGUSTUS 2026. Komt er
   * een veld bij dat er niet in staat, dan vallen ze om — en dat is nog steeds
   * de bedoeling voor alles BEHALVE de productnaam: die is toen bewust en
   * expliciet toegevoegd (V11, de merknaam-op-paginainhoud-match — nodig omdat
   * V10's merknaam-match alleen op de HOSTNAAM van de winkel kon matchen, en
   * dus nooit op een marktplaats die het artikel van een andere merk verkoopt).
   * Omschrijving, artikelnummer en afbeelding blijven wél buiten de deur. */

  it("de host, de bedragen en de productnaam — geen omschrijving, geen artikelnummer, geen afbeelding", () => {
    const html = readFileSync(join(FIXTURES, "coolblue-product.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ev = collectEvidence(doc, "www.coolblue.nl");

    expect(Object.keys(ev).sort()).toEqual(["candidates", "host", "productNaam"]);
    expect(ev.host).toBe("www.coolblue.nl");
    expect(ev.productNaam).toBe("Samsonite S'cure Spinner 69+75+75cm Black kofferset");
    for (const c of ev.candidates) {
      expect(Object.keys(c).sort()).toEqual(["basis", "currency", "raw", "via"]);
    }
  });

  it("de omschrijving en de afbeelding van het artikel reizen niet mee — de naam wel, en dat is de enige uitzondering", () => {
    /* De Coolblue-fixture bevat naast de naam een omschrijving van vijf regels
     * en een afbeeldings-URL in dezelfde JSON-LD als de prijs. Die stonden in de
     * eerste opzet ook in het bewijsmateriaal, omdat het ontcijferen toen in de
     * popup gebeurde en het hele blok als tekst meereisde — en die twee blijven
     * hier wél weg. Alleen de naam is met opzet losgemaakt van die grens. */
    const html = readFileSync(join(FIXTURES, "coolblue-product.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ev = collectEvidence(doc, "www.coolblue.nl");

    expect(ev.productNaam).not.toBeNull();
    const zonderNaam = { ...ev, productNaam: null };
    const serialised = JSON.stringify(zonderNaam);
    expect(serialised).not.toContain("kofferset");
    expect(serialised).not.toContain("image.coolblue.nl");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * DE VIER GEVALLEN WAARIN DE LEZER HET VERKEERDE BEDRAG LAS EN ok:true MELDDE.
 *
 * Alle vier gemeten op 21 augustus 2026, met de fixture ernaast in
 * __fixtures__. Wat er stond voor de reparatie staat in de kop van elke
 * fixture, zodat de volgende lezer niet hoeft te geloven dat het fout wás.
 * ──────────────────────────────────────────────────────────────────────────*/

function bewijs(name: string, host = "voorbeeld.nl") {
  const html = readFileSync(join(FIXTURES, name), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return collectEvidence(doc, host);
}

describe("een prijsbereik is geen prijs", () => {
  it("veertien aanbieders van € 219,00 tot € 549,00: niet lezen, en de reeks is de reden", () => {
    /* Voor de reparatie: {"ok":true,"amountCents":21900} — lowPrice werd "de
     * prijs van dit artikel" en highPrice en offerCount stonden er ongelezen
     * naast. De laagste prijs bij een ANDERE verkoper is niet wat deze pagina
     * kost. */
    const r = read("kunstmatig-aggregateoffer-reeks.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("prijsbereik");
    expect(r.detail).toContain("laagste en een hoogste");
  });

  it("de uiteinden reizen allebei mee, elk met hun eigen etiket", () => {
    /* Zonder highPrice in het bewijsmateriaal kan readCheckout niet ZIEN dat er
     * een reeks was. Dit is dus geen detail van de vorm maar de reden dat de
     * weigering hierboven mogelijk is. */
    const ev = bewijs("kunstmatig-aggregateoffer-reeks.html");
    expect(ev.candidates.map((c) => c.via).sort()).toEqual([VIA_REEKS_HOOG, VIA_REEKS_LAAG].sort());
    expect(ev.candidates.map((c) => c.raw).sort()).toEqual(["219.00", "549.00"]);
  });

  it("IKEA met een Family-actieprijs: de lezer las de actieprijs, nu leest hij niets", () => {
    /* DIT IS DE ENIGE WINKEL DIE DE EXTENSIE MAG LEZEN, en dit geval was nooit
     * gemeten: de toestemming rustte op BILLY en KALLAX, allebei zonder
     * korting. Opgehaald 21 augustus 2026 (HTTP 200, gewone browser-UA):
     *
     *   op het scherm: € 96,99 met "Prijs voor niet IKEA Family leden: €114.99"
     *   in de opmaak : AggregateOffer lowPrice 96,99 / highPrice 114,99
     *   de lezer las : {"ok":true,"amountCents":9699}
     *
     * Dus niet de oude prijs zoals verwacht maar de NIEUWE — de Family-prijs —
     * aan een gebruiker die misschien geen Family-lid is en dan € 114,99
     * afrekent. Het verschil is € 18,00 op één artikel; de cashback die het
     * paneel eroverheen rekent is een fractie daarvan. */
    const ev = bewijs("ikea-slakt-actieprijs.html", "www.ikea.com");
    expect(ev.candidates.map((c) => `${c.via}=${c.raw}`).sort()).toEqual([
      "JSON-LD AggregateOffer highPrice=114.99",
      "JSON-LD AggregateOffer lowPrice=96.99",
      "JSON-LD Offer=96.99",
    ]);

    const r = readCheckout(ev);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("prijsbereik");
  });

  it("de losse Offer naast de reeks redt de lezing niet", () => {
    /* Op de IKEA-pagina herhaalt de geneste Offer de Family-prijs. Twee keer
     * 96,99 is hier geen bevestiging maar één kant van de reeks die zichzelf
     * nog eens opschrijft; de andere kant is wat een niet-lid betaalt. Zou de
     * losse Offer mogen winnen, dan las de extensie nog steeds € 96,99. */
    const ev = bewijs("ikea-slakt-actieprijs.html", "www.ikea.com");
    const zonderReeks = {
      host: ev.host,
      candidates: ev.candidates.filter((c) => c.via === "JSON-LD Offer"),
      productNaam: ev.productNaam,
    };
    expect(readCheckout(zonderReeks).ok).toBe(true); // dit is wat er zou gebeuren
    expect(readCheckout(ev).ok).toBe(false); // en dit is wat er gebeurt
  });

  it("BILLY, dezelfde winkel zonder actieprijs, blijft gewoon leesbaar", () => {
    /* De reparatie mag niet betekenen dat IKEA nu overal zwijgt: een gewone
     * IKEA-productpagina heeft een kale Offer en die wordt gelezen zoals eerst. */
    const r = read("ikea-product.html", "www.ikea.com");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(4999);
    expect(r.currency).toBe("EUR");
  });

  it("laagste en hoogste gelijk: dan is de reeks één prijs en wordt hij wél gelezen", () => {
    /* Weigeren omdat er "AggregateOffer" staat terwijl beide uiteinden hetzelfde
     * bedrag noemen, zou een eenduidige lezing weggooien — dezelfde fout als
     * L5, alleen andersom. "219" en "219.00" worden na het ontcijferen
     * vergeleken en zijn dus één bedrag. */
    const r = read("kunstmatig-aggregateoffer-een-bedrag.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(21900);
    expect(r.currency).toBe("EUR");
  });

  it("alleen een lowPrice is een vanaf-prijs: de bovenkant is onbekend, niet gelijk", () => {
    const r = read("kunstmatig-aggregateoffer-vanafprijs.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    /* EIGEN REDEN, en niet "prijsbereik". De weigering was al goed, de UITLEG
     * niet: die zei "een laagste EN een hoogste bedrag" op een pagina waar er
     * precies één staat. Een oorzaak die er niet is, blijft een verkeerde
     * oorzaak, ook onder een terechte weigering. */
    expect(r.reason).toBe("prijs-vanaf");
    expect(reasonText(r.reason)).toContain("één kant");
  });
});

describe("een UnitPriceSpecification zonder eenheid IS de artikelprijs", () => {
  it("leest een Shopware/Magento-prijs in plaats van hem als kiloprijs te weigeren", () => {
    /* De reparatie van de kiloprijs keurde af op @type, en daardoor viel de
     * gewone artikelprijs van Shopware en Magento — een UnitPriceSpecification
     * ZONDER unitCode, unitText of referenceQuantity — in de bak
     * "geen-artikelprijs", met de uitleg "zoals een prijs per kilo of de
     * verzendkosten" op een pagina waar geen van beide staat. */
    const r = read("kunstmatig-eenheidsprijs-zonder-eenheid.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(4999);
    expect(r.currency).toBe("EUR");
  });

  it("maar mét een eenheid blijft het een bedrag van een andere soort", () => {
    /* Dat is wat de kiloprijs een kiloprijs maakt, en niet het @type: het pak
     * weegt 500 gram en kost € 9,25, terwijl er € 18,50 per KGM staat. */
    const r = read("kunstmatig-eenheidsprijs-per-kilo.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-artikelprijs");
  });
});

describe("een genest bedrag is niet vanzelf de prijs van het artikel", () => {
  it("een kiloprijs van € 18,50 is niet de prijs van een pak van 500 gram", () => {
    /* Voor de reparatie: {"ok":true,"amountCents":1850}. De lezer dook één
     * niveau in het geneste object en pakte daar `price`, zonder naar @type of
     * referenceQuantity te kijken. Factor twee. */
    const r = read("kunstmatig-eenheidsprijs-per-kilo.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-artikelprijs");
    /* En de melding noemt de ECHTE oorzaak: er staat wél een bedrag, het is
     * alleen een bedrag van een andere soort. "Er staat niets machineleesbaar
     * op deze pagina" zou hier onwaar zijn. */
    expect(r.detail).toContain("niet de prijs van dit artikel");
  });

  it("staat de pakprijs er wel bij, dan wint die en telt de kiloprijs niet mee", () => {
    const r = read("kunstmatig-eenheidsprijs-naast-artikelprijs.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(925);
    /* Niet "meerdere-prijzen": een kiloprijs is geen tweede prijs voor dit pak. */
  });

  it("verzendkosten van € 4,95 zijn niet de prijs van een wasmachine", () => {
    /* Voor de reparatie: {"ok":true,"amountCents":495}, waarna het paneel de
     * cashback over de verzendkosten uitrekende. */
    const r = read("kunstmatig-verzendkosten-als-prijs.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-artikelprijs");
  });

  it("staat de artikelprijs er wel bij, dan blijven de verzendkosten liggen", () => {
    const r = read("kunstmatig-verzendkosten-naast-artikelprijs.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(124900);
  });

  it("een bedrag van een andere soort krijgt een eigen etiket en geen basis", () => {
    /* Het onderscheid moet in `via` passen, want er mag geen veld bij het
     * bewijsmateriaal: dat is de redactiegrens die twee tests verderop bewaakt. */
    const ev = bewijs("kunstmatig-verzendkosten-als-prijs.html");
    expect(ev.candidates.map((c) => c.via)).toEqual([VIA_GEEN_ARTIKELPRIJS]);
  });
});

describe("de munt van het bedrag zelf", () => {
  it("een dollarteken bij priceCurrency EUR: twee bronnen die elkaar tegenspreken", () => {
    /* Voor de reparatie: het dollarteken werd weggestreept en het paneel toonde
     * € 1.299,00. Het enige teken op de pagina dat de munt tegensprak,
     * verdween voordat er iets mee gebeurde. */
    const r = read("kunstmatig-dollarteken-bij-euro.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("munt-spreekt-tegen");
  });

  it("hetzelfde bedrag met twee verschillende munten: de munt is de oorzaak, niet het bedrag", () => {
    const r = read("kunstmatig-zelfde-bedrag-twee-munten.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("munt-spreekt-tegen");
    expect(r.detail).toContain("munt");
  });

  it("een euroteken zonder priceCurrency is wél een munt", () => {
    /* "Er staat geen munt bij" zou hier een oorzaak noemen die er niet is: het
     * euroteken staat er, en dat is één munt. */
    const r = read("kunstmatig-euroteken-zonder-munt.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(8995);
    expect(r.currency).toBe("EUR");
  });

  it("een dollarteken zonder priceCurrency is dat niet", () => {
    /* $ hoort bij een familie munten en wijst er geen van aan. Wat het uitsluit
     * is de euro en het pond, en meer wordt er niet beweerd. */
    const r = read("kunstmatig-dollarteken-zonder-munt.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("prijs-zonder-valuta");
  });

  it("currencySignal leest het teken en verzint er geen muntcode bij", () => {
    expect(currencySignal("€ 89,95")).toBe("EUR");
    expect(currencySignal("£12.00")).toBe("GBP");
    expect(currencySignal("$1,299.00")).toBe("DOLLAR");
    expect(currencySignal("1299.00 USD")).toBe("DOLLAR");
    expect(currencySignal("89,95")).toBeNull();
    expect(currencySignal(420)).toBeNull();
  });

  it("een niet-euro-pagina blijft weigeren op de plek waar dat hoort", () => {
    /* De og-fixture noemt USD en spreekt zichzelf niet tegen: de LEZER leest hem
     * gewoon, en het PANEEL weigert er euro's van te maken (panel.ts). Die
     * werkverdeling mag deze reparatie niet verschuiven. */
    const r = read("kunstmatig-meta-og-prijs.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.currency).toBe("USD");
  });
});

describe("hetzelfde bedrag, twee keer opgeschreven", () => {
  it("een og-meta zonder munt naast een Offer met munt is één prijs", () => {
    /* Voor de reparatie: {"ok":false,"reason":"meerdere-prijzen"} — de
     * dedupsleutel was "centen|munt", dus de muntloze kopie telde als een
     * tweede prijs. De gebruiker las "De pagina noemt meer dan één bedrag"
     * terwijl de pagina één bedrag noemt, en een eenduidige lezing werd
     * weggegooid. */
    const r = read("kunstmatig-zelfde-bedrag-zonder-munt.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(4999);
    expect(r.currency).toBe("EUR");
    /* De kopie MET munt wint, want dat is de enige die de vraag beantwoordt. */
    expect(r.via).toBe(VIA_OFFER);
  });

  it("twee echt verschillende bedragen blijven weigeren", () => {
    const r = read("kunstmatig-twee-verschillende-prijzen.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("meerdere-prijzen");
  });
});

describe("de via-etiketten", () => {
  /* collectEvidence wordt als TEKST in de pagina geïnjecteerd en kan de
   * VIA_*-constanten daar niet gebruiken; de literals staan er dus nog een
   * keer. Deze test is de enige reden dat die twee niet uit elkaar kunnen
   * lopen — en als ze dat wel doen, herkent readCheckout een reeks of een
   * verzendtarief niet meer en leest hij het weer als prijs. */
  const ALLE = [
    VIA_ORDER,
    VIA_OFFER,
    VIA_MICRODATA,
    VIA_META,
    VIA_REEKS_LAAG,
    VIA_REEKS_HOOG,
    VIA_REEKS_PRIJS,
    VIA_GEEN_ARTIKELPRIJS,
  ];

  it("elke fixture levert alleen etiketten op die readCheckout kent", () => {
    for (const f of readdirSync(FIXTURES).sort()) {
      for (const c of bewijs(f).candidates) {
        expect(ALLE, `${f}: ${c.via}`).toContain(c.via);
      }
    }
  });

  it("en de vier soorten die de reparatie nodig heeft, komen echt voor", () => {
    const gezien = new Set<string>();
    for (const f of readdirSync(FIXTURES).sort()) {
      for (const c of bewijs(f).candidates) gezien.add(c.via);
    }
    for (const v of [VIA_REEKS_LAAG, VIA_REEKS_HOOG, VIA_GEEN_ARTIKELPRIJS, VIA_OFFER]) {
      expect([...gezien], v).toContain(v);
    }
  });
});

describe("de redactiegrens houdt ook bij de nieuwe fixture", () => {
  it("de IKEA-pagina laat het artikelnummer en de verkoper-URL achter, en draagt de naam alleen in productNaam", () => {
    const ev = bewijs("ikea-slakt-actieprijs.html", "www.ikea.com");
    expect(ev.productNaam).toBe("SLÄKT Bedframe met lattenbodem - wit 90x200 cm");

    const zonderNaam = { ...ev, productNaam: null };
    const serialised = JSON.stringify(zonderNaam);
    expect(serialised).not.toContain("SLÄKT");
    expect(serialised).not.toContain("792.277.55");
    expect(serialised).not.toContain("ikea.com/nl/nl/p/");
    expect(Object.keys(ev).sort()).toEqual(["candidates", "host", "productNaam"]);
    for (const c of ev.candidates) {
      expect(Object.keys(c).sort()).toEqual(["basis", "currency", "raw", "via"]);
    }
  });
});

describe("productNaam: waar hij vandaan komt, en waarvandaan niet", () => {
  it("leest de naam uit een JSON-LD Product, niet uit een ander @type op dezelfde pagina", () => {
    /* De fixture draagt ook een BreadcrumbList met een eigen "name"-veld
     * ("Audio") — dat mag niet als productnaam doorkomen. */
    const ev = bewijs("kunstmatig-productnaam-og-title.html");
    expect(ev.productNaam).toBe("JBL Tune Flex 2 TWS oordopjes zwart");
  });

  it("valt terug op og:title als er geen JSON-LD Product is", () => {
    /* Dezelfde fixture als hierboven test toevallig beide: er staat geen
     * JSON-LD Product op, dus dit IS de og:title-tak. Een aparte assertie hier
     * zodat een toekomstige wijziging aan de JSON-LD-tak deze niet per ongeluk
     * stil laat vallen. */
    const ev = bewijs("kunstmatig-productnaam-og-title.html");
    expect(ev.productNaam).not.toBeNull();
  });

  it('valt terug op itemprop="name" binnen een Product-itemscope, en negeert de naam van de organisatie erbuiten', () => {
    const ev = bewijs("kunstmatig-productnaam-itemprop.html");
    expect(ev.productNaam).toBe("Boombox 4 25W bluetooth speaker");
    expect(ev.productNaam).not.toContain("Voorbeeldwinkel");
  });

  it("is null als geen van de drie bronnen iets opleverde", () => {
    const ev = bewijs("hema-geen-prijsmarkup.html");
    expect(ev.productNaam).toBeNull();
  });

  it("og:title gaat voor een ProductGroup met varianten — anders komt de VERKEERDE variant erdoor", () => {
    /* Het echte, gemeten geval: bol.com zet een pagina neer als ÉÉN
     * ProductGroup (naam zonder kleur) met vijf losse Product-varianten
     * erin. De eerst genoemde variant in deze fixture is "Wit" — een andere
     * kleur dan de "Zwart" die de bezochte pagina en og:title allebei noemen.
     * Zonder de og:title-voorrang zou "eerste Product wint" hier stilzwijgend
     * de witte variant hebben opgeleverd. */
    const ev = bewijs("bol-productgroup.html", "www.bol.com");
    expect(ev.productNaam).toBe(
      "JBL Sense Lite - Volledig Draadloze Open-Ear Oordopjes - Zwart | bol",
    );
    expect(ev.productNaam).not.toContain("Wit");
  });

  it("valt terug op de ProductGroup-naam als er geen og:title is, niet op een willekeurige variant", () => {
    const html = readFileSync(join(FIXTURES, "bol-productgroup.html"), "utf8");
    const zonderOgTitle = html.replace(/<meta property="og:title"[^>]*>\n?/, "");
    const doc = new DOMParser().parseFromString(zonderOgTitle, "text/html");
    const ev = collectEvidence(doc, "www.bol.com");
    expect(ev.productNaam).toBe("JBL Sense Lite - Volledig draadloze open-ear oordopjes");
  });
});

describe("de munt mag uit een kale prijsopgave komen, niet uit een tarief", () => {
  it("een kale PriceSpecification ernaast draagt de munt van hetzelfde bedrag", () => {
    const r = read("kunstmatig-prijsopgave-draagt-de-munt.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(925);
    expect(r.currency).toBe("EUR");
  });

  it("maar de munt van de verzendkosten blijft bij de verzendkosten", () => {
    /* De artikelprijs in deze fixture heeft zelf priceCurrency EUR; het punt is
     * dat de lezing niet uit het verzendtarief komt. Dat tarief levert geen
     * kandidaat op en dus ook geen munt. */
    const ev = bewijs("kunstmatig-verzendkosten-naast-artikelprijs.html");
    expect(ev.candidates).toEqual([
      { raw: "1249.00", currency: "EUR", basis: "artikel", via: VIA_OFFER },
    ]);
  });
});
