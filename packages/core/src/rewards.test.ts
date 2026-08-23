import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeRewardsBalance, isStale, REWARD_PROGRAMS } from "./rewards.js";

const amex = makeRewardsBalance({ program: "American Express Membership Rewards", points: 10000, updatedAt: "2026-06-01" });

test("makeRewardsBalance: stable id per program (same program -> same id)", () => {
  const a = makeRewardsBalance({ program: "American Express Membership Rewards", points: 1, updatedAt: "2026-01-01" });
  const b = makeRewardsBalance({ program: "  american express membership rewards ", points: 999, updatedAt: "2026-07-01" });
  expect(a.id).toBe(b.id); // dedupe by normalized program name
  expect(typeof a.id).toBe("string");
  expect(a.id.length).toBeGreaterThan(0);
});

test("isStale: true past maxDays, false within", () => {
  expect(isStale(amex, "2026-06-15", 90)).toBe(false); // 14 days
  expect(isStale(amex, "2026-10-01", 90)).toBe(true);   // ~122 days
});

test("reference table is non-empty and well-formed", () => {
  expect(REWARD_PROGRAMS.length).toBeGreaterThan(5);
  expect(REWARD_PROGRAMS.every((p) => p.name && p.category)).toBe(true);
});

/* ══════════════ DE ING-REGEL, GETOETST AAN DE BRON EN NIET AAN ZICHZELF ══════
 *
 * Een test die de note met een letterlijke kopie van diezelfde note vergelijkt
 * bewijst alleen dat niemand hem heeft aangeraakt. Dat is precies wat hier
 * misging: de oude note ("ING NL heeft geen puntenprogramma") stond er maanden,
 * werd door geen enkele test tegengesproken, en was al die tijd fout.
 *
 * Dus wordt hier het RESEARCHDOCUMENT gelezen — het verslag van de zoekronde van
 * 21 augustus 2026, met ING's eigen tabel en het citaat uit de voorwaarden erin —
 * en wordt elk cijfer in de note daartegen gehouden. Verandert de bron, dan valt
 * deze test om; verzint iemand een koers, dan ook.
 *
 * I/O in een test van packages/core is geen I/O in packages/core: het pakket
 * blijft puur, dit bestand leest alleen wat het moet toetsen — dezelfde
 * uitzondering die catalogArtifact.test.ts en bankNl.test.ts al maken. */

const REPO = new URL("../../../", import.meta.url);

/** De bron als één doorlopende regel. Markdown breekt een citaat over meerdere
 *  regels met "> " ervoor, en een zin die in het document over twee regels staat
 *  is nog steeds dezelfde zin. Zonder deze afvlakking zou de test de opmaak van
 *  het document toetsen in plaats van wat er staat. */
const flat = (s: string): string => s.replace(/^\s*>\s?/gm, " ").replace(/\s+/g, " ").trim();
const SOURCE = flat(readFileSync(new URL("docs/research/2026-08-20-punten-koersen.md", REPO), "utf8"));

const ING = REWARD_PROGRAMS.find((p) => p.name === "ING");
const ingNote = (): string => {
  expect(ING, "de referentielijst hoort een ING-regel te houden").toBeDefined();
  return ING!.note ?? "";
};

test("geen enkele note in de lijst ontkent nog een puntenprogramma", () => {
  // De ontkenning was de fout, en ze is niet ING-specifiek: elke "X heeft geen
  // puntenprogramma" is een conclusie die alleen een uitspraak van de aanbieder
  // zelf kan dragen, en die stond er niet. Vandaar de lijstbrede vorm.
  for (const p of REWARD_PROGRAMS) {
    expect(p.note ?? "", `${p.name}`).not.toMatch(/geen puntenprogramma/i);
  }
  expect(SOURCE).toContain("ING Punten bestaan");
});

test("elke drempel in de ING-note staat met hetzelfde cijfer in de bron", () => {
  const note = ingNote();
  // Per regel twee toetsen: de bron zegt het (de tabelrij staat er letterlijk),
  // en de note zegt hetzelfde (bedrag en aantal in één zinsdeel, zodat ze niet
  // uit elkaar te lezen zijn).
  expect(SOURCE).toMatch(/Elke maand minimaal € 700 bijschrijven op je Betaalrekening \| 250 per maand/);
  expect(note).toMatch(/250 punten per maand bij minimaal € 700/);

  expect(SOURCE).toMatch(/Meer dan € 100 uitgeven met je ING Creditcard Extra of Max \| 250 per maand/);
  expect(note).toMatch(/250 bij meer dan € 100 besteed met de Creditcard Extra of Max/);

  expect(SOURCE).toMatch(/Meer dan € 100 uitgeven met je ING \(studenten\) Creditcard More \| 100 per maand/);
  expect(note).toMatch(/100 met de \(studenten\) Creditcard More/);
});

test("de note noemt geen koers per euro — die bestaat niet", () => {
  const note = ingNote();
  // 250 punten bij "meer dan € 100" gedeeld door € 100 is 2,5 punt per euro, en
  // dat getal staat in geen enkel document van ING: bij € 4.000 besteding zijn
  // het nog steeds 250 punten. De bron noemt de deling met zoveel woorden als
  // fout, dus mag ze hier niet stiekem terugkomen.
  expect(SOURCE).toContain("een koers die niet bestaat");
  expect(note).not.toMatch(/punt(?:en)? per euro/i);
  expect(note).not.toContain("2,5");
  expect(note).toMatch(/per drempel, niet per bestede euro/);
});

test("het citaat over de geldwaarde staat woordelijk in de bron, met zijn datum", () => {
  const note = ingNote();
  const quoted = note.match(/“([^”]+)”/);
  expect(quoted, "de note hoort de voorwaarden te CITEREN, niet samen te vatten").not.toBeNull();
  // De blokcitaten in het document eindigen zonder punt; de note is een lopende
  // zin en heeft er wel een. Dat verschil is opmaak, niet inhoud.
  expect(SOURCE).toContain(quoted![1].replace(/\.$/, ""));
  expect(SOURCE).toContain("geldig vanaf **1 oktober 2025**");
  expect(note).toContain("1 oktober 2025");
});

test("de note draagt zijn eigen bron en datum, en houdt de ING Winkel onbekend", () => {
  const note = ingNote();
  // Bron en datum staan IN de note en niet in een apart veld: een afdrukkende
  // regel die alleen `note` pakt, zet de claim dan nog steeds met herkomst neer.
  expect(note).toContain("ing.nl/particulier/ing-punten");
  expect(note).toContain("21-08-2026");
  expect(SOURCE).toContain("opgehaald 21-08-2026");
  // "Geen geldwaarde" gaat over inwisselen tegen geld. Wat een punt in de ING
  // Winkel aan korting doet is niet openbaar, en dat blijft onbekend — nul zou
  // een conclusie zijn die deze afwezigheid niet kan dragen.
  expect(note).toMatch(/ING Winkel/);
  expect(note).toMatch(/onbekend, geen nul/);
});
