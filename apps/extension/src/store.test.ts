/* De zeef over de opslag. Klein bestand, maar het gaat over de vraag wat er
 * gebeurt als er rommel in chrome.storage staat — en het antwoord mag niet zijn
 * "dan is de lijst stilletjes leeg". */

import { describe, it, expect } from "vitest";
import { _schoonLijst } from "./store.js";

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
