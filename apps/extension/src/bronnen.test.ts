import { describe, it, expect } from "vitest";
import { ontleedMatch, padIsSpecifiek, BRON_MATCHES } from "./bronnen.js";

describe("het matchpatroon van een bron valt uit elkaar in host en pad", () => {
  it("herkent host en padPrefix", () => {
    expect(ontleedMatch("https://mijn.ing.nl/punten*")).toEqual({
      host: "mijn.ing.nl",
      padPrefix: "/punten",
    });
    expect(ontleedMatch("https://global.americanexpress.com/offers/eligible*")).toEqual({
      host: "global.americanexpress.com",
      padPrefix: "/offers/eligible",
    });
  });

  it("geeft null bij een wildcard-subdomein, een ander schema of geen * aan het eind", () => {
    expect(ontleedMatch("https://*.ing.nl/*")).toBeNull();
    expect(ontleedMatch("http://mijn.ing.nl/punten*")).toBeNull();
    expect(ontleedMatch("https://mijn.ing.nl/punten")).toBeNull();
  });

  it("padIsSpecifiek is false voor een kaal domein en true voor een echt pad", () => {
    expect(padIsSpecifiek("https://mijn.ing.nl/*")).toBe(false);
    expect(padIsSpecifiek("https://mijn.ing.nl/punten*")).toBe(true);
  });

  it("elk patroon in BRON_MATCHES wijst een pad aan, geen heel domein", () => {
    for (const patroon of BRON_MATCHES) {
      expect(padIsSpecifiek(patroon), patroon).toBe(true);
    }
  });
});
