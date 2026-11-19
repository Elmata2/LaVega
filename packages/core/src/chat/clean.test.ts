import { describe, expect, it } from "vitest";
import { cleanName } from "./clean.js";

describe("cleanName: identifiers in every spelling are removed", () => {
  const leaks: [string, RegExp][] = [
    ["NL91.ABNA.0417.1643.00", /NL91|ABNA|0417|1643/],
    ["ABNA 0417.164.300", /0417|164\.300/],
    ["4111 1111 1111 1111", /4111/],
    ["4111-1111-1111-1111", /4111/],
    ["AMEX-3782-822463-10005", /3782|822463|10005/],
    ["NL91ABNA 0417 1643 00", /NL91|ABNA|0417|1643/],
    ["nl91 abna 0417 1643 00", /abna|0417|1643/i],
    ["BSN 111.222.333", /111\.222\.333/],
    ["+31 (0)6 12345678", /12345678/],
    ["+32 475 12 34 56", /475 12 34 56|475/],
    ["https://shop.example.com/pay?token=SECRET123&x=1", /token|SECRET123|pay\?/],
    ["Rekening 0123456789", /0123456789/],
    ["jan@example.nl", /@/],
    ["jörg@exämple.de", /@|jörg|exämple/],
    ["export_NL91ABNA0417164300.csv", /NL91|ABNA|0417164300/],
    ["rek_NL91 ABNA 0417 1643 00_x", /NL91|ABNA|0417/],
  ];
  for (const [input, bad] of leaks)
    it(`removes ${JSON.stringify(input)}`, () => expect(cleanName(input)).not.toMatch(bad));

  it("keeps only the host of a URL", () => {
    expect(cleanName("https://shop.example.com/pay?token=SECRET123")).toBe("shop.example.com");
  });

  it("strips format and control characters (bidi override, zero width)", () => {
    const out = cleanName("Caf‮e​ Bar\u0007");
    expect([...out].some((c) => /[\p{Cf}\p{Cc}]/u.test(c))).toBe(false);
    expect(out).toBe("Cafe Bar");
  });
});

describe("cleanName: ordinary names stay exactly as they are", () => {
  for (const name of [
    "Albert Heijn 1234",
    "Jumbo 4567 Rotterdam",
    "Coffee Corner",
    "Bol.com",
    "Trading 212",
    "NETFLIX.COM",
    "Verhuurder Jansen",
  ])
    it(name, () => expect(cleanName(name)).toBe(name));

  it("still clips to 60 characters", () => {
    expect(cleanName("x".repeat(100)).length).toBe(60);
  });
});
