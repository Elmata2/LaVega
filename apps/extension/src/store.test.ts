/* De zeef over de opslag. Klein bestand, maar het gaat over de vraag wat er
 * gebeurt als er rommel in chrome.storage staat — en het antwoord mag niet zijn
 * "dan is de lijst stilletjes leeg". */

import { describe, it, expect } from "vitest";
import { _schoonLijst, _schoonSaldi } from "./store.js";

describe("wat er uit de opslag komt, is niet te vertrouwen", () => {
  it("laat alleen strings door en gooit dubbele en lege eruit", () => {
    expect(_schoonLijst(["a", "a", "", "  ", "b", 3, null, { id: "c" }])).toEqual(["a", "b"]);
  });

  it("maakt van iets dat geen lijst is een lege lijst en niet een uitzondering", () => {
    /* Een uitzondering hier zou de service worker halverwege laten stoppen en
     * dan verschijnt er helemaal geen paneel, zonder dat er iets te zien is. */
    expect(_schoonLijst(null)).toEqual([]);
    expect(_schoonLijst("ing-betaalpas")).toEqual([]);
    expect(_schoonLijst(undefined)).toEqual([]);
  });

  it("kapt een absurd lange lijst af", () => {
    const veel = Array.from({ length: 500 }, (_, i) => `k${i}`);
    expect(_schoonLijst(veel)).toHaveLength(200);
  });

  it("haalt spaties eraf, zodat ' ing' en 'ing' niet twee kaarten worden", () => {
    expect(_schoonLijst([" ing-betaalpas", "ing-betaalpas"])).toEqual(["ing-betaalpas"]);
  });
});

describe("de zeef over de puntensaldi is strenger, want hier komt een GETAL door", () => {
  it("laat alleen hele, niet-negatieve aantallen door", () => {
    /* NaN en Infinity rollen uit `Number("")` en uit een oud veld, en zouden
     * verderop een dekking van NaN cent opleveren — die rendert als "€ NaN"
     * zonder dat er ergens iets afgaat. Negatief bestaat niet als saldo, en een
     * halve mijl bestaat niet. */
    const uit = _schoonSaldi([
      { program: "Amex", points: 42000, updatedAt: "2026-08-12" },
      { program: "Kapot", points: Number.NaN, updatedAt: "2026-08-12" },
      { program: "Oneindig", points: Number.POSITIVE_INFINITY, updatedAt: "2026-08-12" },
      { program: "Negatief", points: -5, updatedAt: "2026-08-12" },
      { program: "Halve", points: 0.5, updatedAt: "2026-08-12" },
      { program: "Tekst", points: "42000", updatedAt: "2026-08-12" },
      { program: "", points: 100, updatedAt: "2026-08-12" },
    ]);
    expect(uit).toEqual([{ program: "Amex", points: 42000, updatedAt: "2026-08-12" }]);
  });

  it("houdt van twee regels met dezelfde naam de LAATSTE over", () => {
    /* Twee rijen met hetzelfde programma zouden allebei in het paneel komen en
     * optellen tot een saldo dat hij niet heeft. De laatste invoer is de meest
     * recente en dus de waarheid. */
    const uit = _schoonSaldi([
      { program: "Amex", points: 1000, updatedAt: "2026-05-01" },
      { program: "amex", points: 42000, updatedAt: "2026-08-12" },
    ]);
    expect(uit).toHaveLength(1);
    expect(uit[0]!.points).toBe(42000);
  });

  it("maakt van een onleesbare datum een LEGE datum en niet vandaag", () => {
    /* Er stilletjes vandaag van maken zou een saldo van vier maanden oud vers
     * verklaren. points.ts behandelt een lege datum als verouderd. */
    const uit = _schoonSaldi([{ program: "Amex", points: 42000, updatedAt: "gisteren" }]);
    expect(uit[0]!.updatedAt).toBe("");
  });

  it("maakt van rommel een lege lijst en niet een uitzondering", () => {
    expect(_schoonSaldi(null)).toEqual([]);
    expect(_schoonSaldi(["Amex"])).toEqual([]);
    expect(_schoonSaldi([42000])).toEqual([]);
  });

  it("kapt een absurd lange lijst af", () => {
    const veel = Array.from({ length: 300 }, (_, i) => ({
      program: `p${i}`,
      points: 1,
      updatedAt: "2026-08-12",
    }));
    expect(_schoonSaldi(veel)).toHaveLength(50);
  });
});
