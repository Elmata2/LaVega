// @vitest-environment jsdom
/* De hostlijst. Deze tests bewaken een GRENS, niet een gedrag: ze gaan over
 * welke pagina's de extensie mag lezen. Een test die hier omvalt, is bijna nooit
 * een kapotte functie maar iemand die een winkel heeft toegevoegd. */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITES, SITE_MATCHES, siteForHost } from "./sites.js";
import { collectEvidence, readCheckout } from "./read.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function lees(naam: string) {
  const html = readFileSync(join(FIXTURES, naam), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return readCheckout(collectEvidence(doc, "test"));
}

describe("elke host moet te verantwoorden zijn", () => {
  it("staat nooit <all_urls> toe, en ook geen kaal domein zonder pad", () => {
    for (const s of SITES) {
      expect(s.match, s.id).not.toContain("<all_urls>");
      expect(s.match, s.id).toMatch(/^https:\/\//);
      /* Geen schema-wildcard en geen wildcard-subdomein: het patroon moet één
       * winkel aanwijzen en niet een categorie. */
      expect(s.match, s.id).not.toContain("://*");
      expect(s.match, s.id).not.toMatch(/^https:\/\/\*/);
    }
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

  it("herkent de host van de pagina", () => {
    expect(siteForHost("www.ikea.com")?.id).toBe("ikea-nl");
    expect(siteForHost("WWW.IKEA.COM")?.id).toBe("ikea-nl");
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
    expect(siteForHost("www.coolblue.nl")).toBeNull();
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
    expect(siteForHost("www.bol.com")).toBeNull();
  });
});
