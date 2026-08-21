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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectEvidence, readCheckout, parseAmountToCents } from "./read.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function read(name: string, host = "voorbeeld.nl") {
  const html = readFileSync(join(FIXTURES, name), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return readCheckout(collectEvidence(doc, host));
}

describe("echt opgehaalde winkelpagina's", () => {
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
    ]) {
      const r = read(f);
      expect(r.ok, f).toBe(false);
      if (r.ok) continue;
      expect(r.detail.toLowerCase(), f).toContain("zelf in");
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

  it("rommel is geen bedrag", () => {
    expect(parseAmountToCents("vanaf 39,99")).toEqual({ ok: false, reason: "bedrag-onduidelijk" });
    expect(parseAmountToCents("")).toEqual({ ok: false, reason: "bedrag-onduidelijk" });
    expect(parseAmountToCents("39,")).toEqual({ ok: false, reason: "bedrag-onduidelijk" });
  });
});

describe("wat de extensie van een pagina meeneemt", () => {
  /* DEZE TWEE TESTS ZIJN DE REDACTIEGRENS. Komt er een veld bij dat er niet in
   * staat, dan vallen ze om — en dat is de bedoeling: dat is het moment waarop
   * iemand moet uitleggen waarom de extensie méér van de pagina nodig heeft dan
   * een bedrag. */

  it("alleen de host en de bedragen — geen titel, geen artikelnaam, geen omschrijving", () => {
    const html = readFileSync(join(FIXTURES, "coolblue-product.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ev = collectEvidence(doc, "www.coolblue.nl");

    expect(Object.keys(ev).sort()).toEqual(["candidates", "host"]);
    expect(ev.host).toBe("www.coolblue.nl");
    for (const c of ev.candidates) {
      expect(Object.keys(c).sort()).toEqual(["basis", "currency", "raw", "via"]);
    }
  });

  it("de naam en de omschrijving van het artikel reizen niet mee", () => {
    /* De Coolblue-fixture bevat de naam "Samsonite S'cure Spinner" en een
     * omschrijving van vijf regels in dezelfde JSON-LD als de prijs. Die stonden
     * in de eerste opzet in het bewijsmateriaal, omdat het ontcijferen toen in
     * de popup gebeurde en het hele blok als tekst meereisde. */
    const html = readFileSync(join(FIXTURES, "coolblue-product.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ev = collectEvidence(doc, "www.coolblue.nl");

    const serialised = JSON.stringify(ev);
    expect(serialised).not.toContain("Samsonite");
    expect(serialised).not.toContain("kofferset");
    expect(serialised).not.toContain("image.coolblue.nl");
  });
});
