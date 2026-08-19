import { describe, it, expect } from "vitest";
import { buildExtractPrompt, EXTRACT_TOOL, parseExtractReply, type ExtractRequest } from "./catalogExtract.js";

const SWEEP = "2026-08-18";

/** Page text is written the way the sweep actually sees it: HTML stripped to
 *  prose, or pdftotext output — headings on their own line, rows underneath. */

/** ASN: the cleanest source in the debit bucket. It names its rate and states
 *  that it is the whole story. */
const ASN = `
Betalen in het buitenland
Betaal je buiten de eurolanden? Dan brengen we 1,4% koersopslag in rekening over het betaalde bedrag, ongeacht het bedrag en het pakket.
Geld opnemen buiten de eurolanden kost 1,4% van het opgenomen bedrag + € 3,50 vaste vergoeding per opname.
`;

/** Revolut: the reason the conditions field exists. The 0% is real and it runs
 *  out EUR 1.000 into the month. */
const REVOLUT = `
Standard
Wisselen tot € 1.000 per maand tegen de interbancaire koers, 0% wisselkoersopslag; daarboven geldt een fair-usage opslag van 1%.
Geld opnemen: 5 opnames per maand tot € 200 zonder kosten, daarna 2%.
`;

/** Triodos-shaped: a page that mentions the surcharge, prints a number, and
 *  then refuses to say what governs it. */
const TRIODOS = `
Betaalpas in het buitenland
Buiten de eurozone rekenen wij een koersopslag van 1,0% over het bedrag van de transactie.
Visa bepaalt de wisselkoersen en opslagen. Raadpleeg de rekenhulp voor een actuele berekening.
`;

/** THE KNAB TRAP, reproduced. One page, two products, and the credit card's
 *  heading sits BELOW the debit card's row. */
const KNAB = `
Betalen en overboeken
Betalen en opname van contant geld buiten eurolanden — Mastercard wisselkoers + 1,4% koersopslag.
Geld overboeken buiten de EER — € 15 + 0,1% koersopslag.
Rente op je betaalrekening 0%.

Knab Creditcard
Betalingen in vreemde valuta — 2% koersopslag.
Contant geld opnemen — 4% van het opgenomen bedrag.
`;

function req(product: string, text: string): ExtractRequest {
  return { product, sourceUrl: "https://example.test/tarieven", text };
}

describe("buildExtractPrompt", () => {
  it("names the product being asked about and carries the page as data", () => {
    const { system, user } = buildExtractPrompt(req("Knab creditcard", KNAB));
    expect(system).toContain(EXTRACT_TOOL.name);
    expect(user).toContain("Product: Knab creditcard");
    expect(user).toContain("2% koersopslag");
    expect(user).toContain("https://example.test/tarieven");
  });

  it("tells the model that failing to establish the conditions is a correct answer", () => {
    const { system } = buildExtractPrompt(req("ASN betaalpas", ASN));
    expect(system).toContain("conditionsKnown");
    expect(system).toMatch(/do NOT call the tool/);
  });
});

describe("EXTRACT_TOOL", () => {
  it("requires the four things plus the section that attributes them", () => {
    const schema = EXTRACT_TOOL.input_schema as {
      required: string[];
      properties: Record<string, { description: string }>;
    };
    expect(schema.required).toEqual(["fxFeePct", "conditions", "conditionsKnown", "quote", "section"]);
    // Each field carries its reason, because a schema without one gets filled in
    // carelessly — the descriptions are part of the extractor, not decoration.
    for (const key of schema.required) {
      expect(schema.properties[key].description.length).toBeGreaterThan(60);
    }
  });
});

describe("parseExtractReply", () => {
  it("takes an unconditional rate the page positively states as unconditional", () => {
    const r = req("ASN betaalpas", ASN);
    const got = parseExtractReply(
      {
        fxFeePct: 1.4,
        conditions: null,
        conditionsKnown: true,
        quote:
          "Betaal je buiten de eurolanden? Dan brengen we 1,4% koersopslag in rekening over het betaalde bedrag, ongeacht het bedrag en het pakket.",
        section: "Betalen in het buitenland",
      },
      r,
      SWEEP,
    );
    expect(got).toEqual({
      value: 1.4,
      conditions: null,
      conditionsKnown: true,
      quote:
        "Betaal je buiten de eurolanden? Dan brengen we 1,4% koersopslag in rekening over het betaalde bedrag, ongeacht het bedrag en het pakket.",
    });
  });

  it("keeps the cap, and the value is the rate INSIDE the allowance (Revolut)", () => {
    const r = req("Revolut Standard betaalpas", REVOLUT);
    const got = parseExtractReply(
      {
        fxFeePct: 0,
        conditions: "0% geldt tot € 1.000 wisselen per maand; daarboven 1% fair-usage opslag",
        conditionsKnown: true,
        quote:
          "Wisselen tot € 1.000 per maand tegen de interbancaire koers, 0% wisselkoersopslag; daarboven geldt een fair-usage opslag van 1%.",
        section: "Standard",
      },
      r,
      SWEEP,
    );
    expect(got?.value).toBe(0);
    expect(got?.conditionsKnown).toBe(true);
    expect(got?.conditions).toContain("€ 1.000");
    expect(got?.conditions).toContain("1%");
  });

  it("carries conditionsKnown FALSE through when the page settles nothing", () => {
    const r = req("Triodos betaalpas", TRIODOS);
    const got = parseExtractReply(
      {
        fxFeePct: 1.0,
        conditions: null,
        conditionsKnown: false,
        quote: "Buiten de eurozone rekenen wij een koersopslag van 1,0% over het bedrag van de transactie.",
        section: "Betaalpas in het buitenland",
      },
      r,
      SWEEP,
    );
    expect(got?.value).toBe(1);
    expect(got?.conditionsKnown).toBe(false);
  });

  it("never defaults conditionsKnown to true when the model omits it", () => {
    const r = req("Triodos betaalpas", TRIODOS);
    const got = parseExtractReply(
      {
        fxFeePct: 1.0,
        conditions: null,
        quote: "Buiten de eurozone rekenen wij een koersopslag van 1,0% over het bedrag van de transactie.",
        section: "Betaalpas in het buitenland",
      },
      r,
      SWEEP,
    );
    expect(got?.conditionsKnown).toBe(false);
  });

  it("REJECTS a reply whose quote is not in the supplied text", () => {
    const r = req("Triodos betaalpas", TRIODOS);
    const got = parseExtractReply(
      {
        fxFeePct: 2,
        conditions: null,
        conditionsKnown: true,
        // Plausible, well-formed Dutch, and nowhere on the page.
        quote: "Voor betalingen in vreemde valuta rekenen wij 2% koersopslag.",
        section: "Betaalpas in het buitenland",
      },
      r,
      SWEEP,
    );
    expect(got).toBeNull();
  });

  it("tolerates rewrapped whitespace, since HTML and pdftotext both introduce it", () => {
    const r = req("ASN betaalpas", ASN);
    const got = parseExtractReply(
      {
        fxFeePct: 1.4,
        conditions: null,
        conditionsKnown: true,
        quote: "Dan brengen we 1,4%   koersopslag\n in rekening over het betaalde bedrag",
        section: "Betalen in het buitenland",
      },
      r,
      SWEEP,
    );
    expect(got?.value).toBe(1.4);
  });

  describe("a multi-product page", () => {
    it("reads the credit card's own row when asked about the credit card", () => {
      const got = parseExtractReply(
        {
          fxFeePct: 2,
          conditions: null,
          conditionsKnown: false,
          quote: "Betalingen in vreemde valuta — 2% koersopslag.",
          section: "Knab Creditcard",
        },
        req("Knab creditcard", KNAB),
        SWEEP,
      );
      expect(got?.value).toBe(2);
    });

    it("refuses the DEBIT card's row filed under the credit card's heading", () => {
      const got = parseExtractReply(
        {
          fxFeePct: 1.4,
          conditions: null,
          conditionsKnown: true,
          // Really on the page — but 19 lines ABOVE the heading claimed for it.
          quote: "Betalen en opname van contant geld buiten eurolanden — Mastercard wisselkoers + 1,4% koersopslag.",
          section: "Knab Creditcard",
        },
        req("Knab creditcard", KNAB),
        SWEEP,
      );
      expect(got).toBeNull();
    });

    it("refuses the credit card's NUMBER imported onto the debit card's quote", () => {
      const got = parseExtractReply(
        {
          fxFeePct: 2,
          conditions: null,
          conditionsKnown: true,
          quote: "Betalen en opname van contant geld buiten eurolanden — Mastercard wisselkoers + 1,4% koersopslag.",
          section: "Betalen en overboeken",
        },
        req("Knab betaalpas", KNAB),
        SWEEP,
      );
      expect(got).toBeNull();
    });
  });

  it("refuses a figure the page itself says has expired", () => {
    const r = req("ASN betaalpas", ASN);
    const got = parseExtractReply(
      {
        fxFeePct: 1.4,
        conditions: "actietarief",
        conditionsKnown: true,
        quote: "Dan brengen we 1,4% koersopslag in rekening over het betaalde bedrag",
        section: "Betalen in het buitenland",
        validUntil: "2026-07-01",
      },
      r,
      SWEEP,
    );
    expect(got).toBeNull();
  });

  it("unwraps a tool_use block, and refuses anything that is not a reply", () => {
    const r = req("ASN betaalpas", ASN);
    const block = {
      type: "tool_use",
      id: "toolu_x",
      name: EXTRACT_TOOL.name,
      input: {
        fxFeePct: 1.4,
        conditions: null,
        conditionsKnown: true,
        quote: "Dan brengen we 1,4% koersopslag in rekening over het betaalde bedrag",
        section: "Betalen in het buitenland",
      },
    };
    expect(parseExtractReply(block, r, SWEEP)?.value).toBe(1.4);
    for (const junk of [null, undefined, "1,4%", 1.4, [], {}]) {
      expect(parseExtractReply(junk, r, SWEEP)).toBeNull();
    }
  });

  it("refuses a value that is not a percentage", () => {
    const r = req("ASN betaalpas", ASN);
    const base = {
      conditions: null,
      conditionsKnown: true,
      quote: "Dan brengen we 1,4% koersopslag in rekening over het betaalde bedrag",
      section: "Betalen in het buitenland",
    };
    expect(parseExtractReply({ ...base, fxFeePct: "1,4" }, r, SWEEP)).toBeNull();
    expect(parseExtractReply({ ...base, fxFeePct: -1 }, r, SWEEP)).toBeNull();
    expect(parseExtractReply({ ...base, fxFeePct: 350 }, r, SWEEP)).toBeNull();
  });
});
