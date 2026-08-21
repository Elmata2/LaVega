// @vitest-environment jsdom
/* De hostlijst. Deze tests bewaken een GRENS, niet een gedrag: ze gaan over
 * welke pagina's de extensie mag lezen. Een test die hier omvalt, is bijna nooit
 * een kapotte functie maar iemand die een winkel heeft toegevoegd. */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITES, SITE_MATCHES, siteForUrl, ontleedMatch, padIsSpecifiek } from "./sites.js";
import { collectEvidence, readCheckout } from "./read.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function lees(naam: string) {
  const html = readFileSync(join(FIXTURES, naam), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return readCheckout(collectEvidence(doc, "test"));
}

/** De poort waar elk matchpatroon doorheen moet. Staat hier als FUNCTIE en niet
 *  als losse regels in een test, om één reden: zo kan de test hieronder hem op
 *  patronen loslaten die NIET in SITES staan, en aantonen dat hij afgaat op wat
 *  zijn naam belooft.
 *
 *  De vorige versie van dit bestand had die assertie-regels los in de test
 *  staan, met de naam "en ook geen kaal domein zonder pad" erboven. Van de vier
 *  regels controleerde er geen enkele het pad, dus `https://www.ikea.com/*`
 *  kwam er zonder een kik doorheen — een test die de belangrijkste helft van
 *  zijn eigen naam niet vasthield. */
function keurPatroon(match: string): string[] {
  const bezwaren: string[] = [];
  if (match.includes("<all_urls>")) bezwaren.push("<all_urls>");
  if (!match.startsWith("https://")) bezwaren.push("geen https");
  if (match.includes("://*")) bezwaren.push("schema-wildcard");
  if (/^https:\/\/\*/.test(match)) bezwaren.push("wildcard-subdomein");
  if (ontleedMatch(match) === null) bezwaren.push("niet te ontleden in host + pad");
  else if (!padIsSpecifiek(match)) bezwaren.push("kaal domein zonder pad");
  return bezwaren;
}

describe("elke host moet te verantwoorden zijn", () => {
  it("staat nooit <all_urls> toe, en ook geen kaal domein zonder pad", () => {
    for (const s of SITES) {
      expect(keurPatroon(s.match), s.id).toEqual([]);
    }
  });

  it("en die keuring gaat ook echt af op een kaal domein", () => {
    /* Precies de vier patronen uit de tegenspraak. De eerste is degene die er
     * eerder doorheen kwam; hij staat hier bovenaan zodat het omvalt als iemand
     * de padcontrole weghaalt. */
    expect(keurPatroon("https://www.ikea.com/*")).toEqual(["kaal domein zonder pad"]);
    expect(keurPatroon("https://*.ikea.com/*")).toEqual([
      "schema-wildcard",
      "wildcard-subdomein",
      "niet te ontleden in host + pad",
    ]);
    expect(keurPatroon("https://www.ikea.com/nl/nl/p/*")).toEqual([]);
    expect(keurPatroon("http://x.nl/*")).toEqual([
      "geen https",
      "niet te ontleden in host + pad",
    ]);
    expect(keurPatroon("<all_urls>")).toContain("<all_urls>");
  });

  it("draagt bij elke site de meting waarop de toestemming rust", () => {
    /* Een vinkje "IKEA Nederland" zonder de meting eronder vraagt vertrouwen in
     * plaats van het te verdienen. De UI toont dit veld; deze test houdt tegen
     * dat er een site bijkomt zonder. */
    for (const s of SITES) {
      expect(s.evidence.length, s.id).toBeGreaterThan(40);
      expect(s.evidence, s.id).toMatch(/\d{4}/); // er staat een jaartal in
    }
  });

  it("SITE_MATCHES is precies de lijst en niets meer", () => {
    expect(SITE_MATCHES).toEqual(SITES.map((s) => s.match));
  });
});

describe("IKEA staat erin omdat het aantoonbaar het juiste bedrag geeft", () => {
  it("leest € 49,99 uit de opgeslagen BILLY-pagina", () => {
    const r = lees("ikea-product.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(4999);
    expect(r.currency).toBe("EUR");
    /* Een productprijs, geen ordertotaal: aantal, bezorging en korting zitten er
     * niet in, en de UI hoort dat erbij te zeggen. */
    expect(r.basis).toBe("artikel");
  });

  it("herkent een productpagina", () => {
    expect(siteForUrl("https://www.ikea.com/nl/nl/p/billy-boekenkast-wit-00522047/")?.id).toBe("ikea-nl");
    /* Een URL kent geen hoofdletters in de host; dit is de vorm waarin een
     * afzender hem kan aanleveren. */
    expect(siteForUrl("https://WWW.IKEA.COM/nl/nl/p/kallax-70351888/")?.id).toBe("ikea-nl");
  });
});

describe("de belofte 'niet de winkelwagen, niet je account' wordt hier afgedwongen", () => {
  /* Dit is de test die er niet was. De zin stond onder het vinkje en in
   * sites.ts, en niets in de code controleerde hem: de opzoekfunctie keek alleen
   * naar het hostdeel en schoof het pad door naar Chrome. Elk geval hieronder is
   * een pagina op een host waar de gebruiker WEL ja tegen heeft gezegd. */
  const buiten = [
    ["de winkelwagen", "https://www.ikea.com/nl/nl/shoppingcart/"],
    ["het bestelproces", "https://www.ikea.com/nl/nl/order/checkout/"],
    ["je account", "https://www.ikea.com/nl/nl/profile/login/"],
    ["de voorpagina", "https://www.ikea.com/nl/nl/"],
    ["het kale domein", "https://www.ikea.com/"],
    ["een origin zonder pad", "https://www.ikea.com"],
    ["een pad dat er alleen op lijkt", "https://www.ikea.com/nl/nl/pizza/"],
    ["een omweg via ..", "https://www.ikea.com/nl/nl/p/../shoppingcart/"],
    ["een andere taalversie", "https://www.ikea.com/be/nl/p/billy-00522047/"],
    ["http in plaats van https", "http://www.ikea.com/nl/nl/p/billy-00522047/"],
    ["een afwijkende poort", "https://www.ikea.com:8443/nl/nl/p/billy-00522047/"],
    ["een ander domein dat erop lijkt", "https://www.ikea.com.example.nl/nl/nl/p/billy/"],
    ["geen URL", "ikea"],
  ] as const;

  for (const [wat, url] of buiten) {
    it(`leest ${wat} niet (${url})`, () => {
      expect(siteForUrl(url)).toBeNull();
    });
  }

  it("en leest de productpagina wél, anders bewijst het bovenstaande niets", () => {
    expect(siteForUrl("https://www.ikea.com/nl/nl/p/billy-boekenkast-wit-00522047/")?.id).toBe("ikea-nl");
  });
});

describe("Coolblue staat er NIET in, en dit is de reden", () => {
  it("de lezer geeft daar een zelfverzekerd antwoord dat over een ander artikel gaat", () => {
    /* De fixture is de AirPods-URL. Wat eruit komt is € 420 — de prijs van een
     * Samsonite kofferset die Coolblue op die URL meestuurde. Bij de hermeting
     * gaf de Sonos-URL op dezelfde manier € 490 (een PlayStation 5).
     *
     * Let op WAT deze test vastlegt: niet dat de lezer stuk is, maar dat hij
     * hier niets te merken heeft. `ok: true` met een geldige munt — er is geen
     * signaal waar de UI op kan afslaan. Daarom wordt het domein op het niveau
     * van de toestemming buitengesloten en niet op het niveau van de lezer. */
    const r = lees("coolblue-product.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountCents).toBe(42000);
  });

  it("en krijgt daarom geen leestoestemming", () => {
    expect(siteForUrl("https://www.coolblue.nl/product/949341/apple-airpods-pro-3.html")).toBeNull();
    expect(SITE_MATCHES.join(" ")).not.toContain("coolblue");
  });
});

describe("bol.com staat er niet in omdat de toestemming niets zou opleveren", () => {
  it("de pagina heeft opmaak maar geen bedrag, dus lezen levert alleen een weigering op", () => {
    const r = lees("bol-product.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("geen-prijsmarkup");
    /* Het handmatige veld in de popup doet ditzelfde op elke site zonder dat we
     * één pagina hoeven te lezen. */
    expect(siteForUrl("https://www.bol.com/nl/nl/p/sonos-era-100/9300000123456789/")).toBeNull();
  });
});
