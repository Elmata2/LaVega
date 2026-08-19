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

/** THE ING CASE, reproduced. An exhaustive tariff sheet: the debit row is priced
 *  with no qualifier, and the sheet PROVES it writes a cap when one exists by
 *  printing the creditcard's EUR 500 tier two rows down. Silence on the debit row
 *  is therefore a finding about that row. */
const TARIFF_CAPPED = `Tarievenwijzer betaalrekening en creditcard — versie 1 juli 2026

Betaalpas
Betalen in vreemde valuta                                     1,20% koersopslag
Geld opnemen in vreemde valuta                                1,20% koersopslag + € 3,50 per opname

Creditcard
Betalen in vreemde valuta tot EUR 500 per creditcardperiode   0,00%
Betalen in vreemde valuta boven EUR 500                       2,00%
Overboeking binnen Nederland                                  € 0,00`;

/** THE SAME SHEET with the two capped rows deleted and nothing else changed. Now
 *  nothing in the document shows that it expresses caps at all, so its silence
 *  about the debit row proves nothing. This is the fixture that keeps the rule
 *  honest — derived from the text above rather than retyped, so it cannot drift
 *  apart from it. */
const TARIFF_FLAT = TARIFF_CAPPED.split("\n")
  .filter((l) => !l.includes("EUR 500"))
  .join("\n");

const DEBIT_ROW = "Betalen in vreemde valuta 1,20% koersopslag";

/** A page that is SELLING. It even states a cap — on the withdrawal row — so it
 *  passes every text-level test the tariff sheet passes. It is excluded by what
 *  it IS: a marketing page is not trying to be complete, so its omissions are not
 *  disclosures. Revolut's page looked exactly this reasonable. */
const MARKETING = `Wereldpas — betaal overal, zonder verrassingen

Betaal in 150 valuta met 0,5% koersopslag.
Gratis geld opnemen tot € 500 per maand, daarna 2%.
Vraag de kaart vandaag aan en ontvang de eerste 3 maanden gratis.`;

/** Revolut's shape, stated as a tariff row: the rate and its ceiling on one line.
 *  The 0% is real and it is not unconditional, and no claim about the document can
 *  make it so, because the row itself says otherwise. */
const REVOLUT_TARIFF = `Revolut Standard — Tarieven

Wisselkoersopslag: 0% tot EUR 1.000 per maand, daarna 1%.
Geldopname: 5 opnames per maand tot EUR 200 kosteloos.`;

/** Terms that answer the question outright. Note that the sentence contains the
 *  words 'maximum' and 'pakket' — in order to RULE THEM OUT. That is why basis
 *  "stated" is judged on what the sentence says and not on whether it mentions
 *  limits. */
const TERMS_STATED = `Productvoorwaarden Wereldpas

Artikel 7 Koersopslag
Wij brengen 1,50% koersopslag in rekening op alle transacties in vreemde valuta, zonder maximum en ongeacht het gekozen pakket.`;

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

  it("teaches what silence about a cap is worth, and that marketing silence is worth nothing", () => {
    const { system } = buildExtractPrompt(req("ING betaalpas", TARIFF_CAPPED));
    // The three fields the rule turns on are named and explained, not just listed.
    for (const field of ["documentKind", "capsExpressedElsewhere", "unconditionalBasis"]) {
      expect(system).toContain(field);
    }
    expect(system).toContain("tariff-schedule");
    expect(system).toContain("exhaustive-document");
    // The exclusion has to be stated as an exclusion, since a model that thinks
    // "this marketing page is thorough enough" is the bug that shipped.
    expect(system).toMatch(/may NOT use 'exhaustive-document' on a marketing page/);
    // And the reply must know that guessing here is not rewarded.
    expect(system).toMatch(/comes back as conditionsKnown false/);
  });
});

describe("EXTRACT_TOOL", () => {
  it("requires the figure, the section that attributes it, and the three fields that read its silence", () => {
    const schema = EXTRACT_TOOL.input_schema as {
      required: string[];
      properties: Record<string, { description: string; enum?: unknown[] }>;
    };
    expect(schema.required).toEqual([
      "fxFeePct",
      "conditions",
      "conditionsKnown",
      "quote",
      "section",
      "documentKind",
      "capsExpressedElsewhere",
      "unconditionalBasis",
    ]);
    // Each field carries its reason, because a schema without one gets filled in
    // carelessly — the descriptions are part of the extractor, not decoration.
    for (const key of schema.required) {
      expect(schema.properties[key].description.length).toBeGreaterThan(60);
    }
    // Closed sets, so "probably a tariff page" cannot arrive as a free string the
    // parser then has to interpret.
    expect(schema.properties.documentKind.enum).toEqual(["tariff-schedule", "terms", "marketing", "other"]);
    expect(schema.properties.unconditionalBasis.enum).toEqual(["stated", "exhaustive-document", null]);
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
        documentKind: "marketing",
        capsExpressedElsewhere: false,
        unconditionalBasis: "stated",
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
      // "ongeacht het bedrag en het pakket" is the page settling the question, so
      // this survives on a MARKETING page with no cap anywhere in it. Basis
      // "stated" was always allowed and is not narrowed by the new rule.
      documentKind: "marketing",
      capsExpressedElsewhere: false,
      unconditionalBasis: "stated",
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
        documentKind: "marketing",
        capsExpressedElsewhere: true,
        // Contradictory: a figure with named conditions concluded nothing about
        // their absence. It is dropped rather than carried into the artifact.
        unconditionalBasis: "stated",
      },
      r,
      SWEEP,
    );
    expect(got?.value).toBe(0);
    expect(got?.conditionsKnown).toBe(true);
    expect(got?.conditions).toContain("€ 1.000");
    expect(got?.conditions).toContain("1%");
    expect(got?.unconditionalBasis).toBeNull();
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
        documentKind: "marketing",
        capsExpressedElsewhere: false,
        unconditionalBasis: "stated",
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

  /** THE SILENCE RULE.
   *
   *  Nineteen figures were refused for one reason: the source priced the rate and
   *  never mentioned a cap. That refusal is right on a page that is selling and
   *  wrong on a document written to enumerate every charge. These tests are the
   *  boundary between the two, and most of them are the failing side of it — a
   *  rule that only ever says yes is not a rule. */
  describe("silence about a cap", () => {
    /** The reply an honest model gives on the ING sheet. Individual tests bend one
     *  field at a time so the failure is attributable to that field. */
    const ING_REPLY = {
      fxFeePct: 1.2,
      conditions: null,
      conditionsKnown: true,
      quote: DEBIT_ROW,
      section: "Betaalpas",
      documentKind: "tariff-schedule",
      capsExpressedElsewhere: true,
      unconditionalBasis: "exhaustive-document",
    };

    it("EARNS null conditions on a tariff schedule that prices a cap elsewhere (the ING case)", () => {
      const got = parseExtractReply(ING_REPLY, req("ING betaalpas", TARIFF_CAPPED), SWEEP);
      expect(got).toEqual({
        value: 1.2,
        conditions: null,
        conditionsKnown: true,
        quote: DEBIT_ROW,
        documentKind: "tariff-schedule",
        capsExpressedElsewhere: true,
        unconditionalBasis: "exhaustive-document",
      });
    });

    it("REFUSES the same claim on the same sheet with the capped row removed", () => {
      // The document no longer demonstrates that it writes caps down, so the
      // unqualified debit row demonstrates nothing either. This is the test that
      // keeps the rule from collapsing into "silence means no cap".
      const got = parseExtractReply(
        { ...ING_REPLY, capsExpressedElsewhere: false },
        req("ING betaalpas", TARIFF_FLAT),
        SWEEP,
      );
      expect(got?.value).toBe(1.2);
      expect(got?.conditionsKnown).toBe(false);
      expect(got?.unconditionalBasis).toBeNull();
    });

    it("REFUSES exhaustiveness the reply itself did not claim caps for", () => {
      // The sheet does print caps, but this reply says it saw none. The rule runs on
      // what the reply reports, not on what the parser can find for it: a model that
      // did not notice the EUR 500 tier did not do the reading the rule assumes.
      const got = parseExtractReply(
        { ...ING_REPLY, capsExpressedElsewhere: false },
        req("ING betaalpas", TARIFF_CAPPED),
        SWEEP,
      );
      expect(got?.value).toBe(1.2);
      expect(got?.conditionsKnown).toBe(false);
    });

    it("REFUSES a capsExpressedElsewhere the document does not back up", () => {
      // Same flat sheet, but the reply asserts the caps are there. The assertion is
      // about this text, so it is checked against this text — otherwise the field
      // that carries the whole rule is a field the model can simply set to true.
      const got = parseExtractReply(ING_REPLY, req("ING betaalpas", TARIFF_FLAT), SWEEP);
      expect(got?.value).toBe(1.2);
      expect(got?.conditionsKnown).toBe(false);
      expect(got?.capsExpressedElsewhere).toBe(true); // reported faithfully, just not believed
    });

    it("does not read a validity date as a cap", () => {
      // "geldig vanaf 1 juli 2026" is on nearly every tariff sheet and bounds
      // nothing. A corroboration that accepted it would corroborate everything.
      const dated = TARIFF_FLAT.replace("versie 1 juli 2026", "geldig vanaf 1 juli 2026");
      expect(dated).toContain("geldig vanaf");
      const got = parseExtractReply(ING_REPLY, req("ING betaalpas", dated), SWEEP);
      expect(got?.value).toBe(1.2);
      expect(got?.conditionsKnown).toBe(false);
    });

    it("REFUSES exhaustiveness on a marketing page, whatever else the page contains", () => {
      // This page states a cap on its withdrawal row, so it passes every text-level
      // test the tariff sheet passes. Marketing is excluded by KIND: a page that is
      // selling is not attempting to be complete, so its omissions disclose nothing.
      const got = parseExtractReply(
        {
          fxFeePct: 0.5,
          conditions: null,
          conditionsKnown: true,
          quote: "Betaal in 150 valuta met 0,5% koersopslag.",
          section: "Wereldpas — betaal overal, zonder verrassingen",
          documentKind: "marketing",
          capsExpressedElsewhere: true,
          unconditionalBasis: "exhaustive-document",
        },
        req("Wereldpas", MARKETING),
        SWEEP,
      );
      expect(got?.value).toBe(0.5);
      expect(got?.conditionsKnown).toBe(false);
      expect(got?.unconditionalBasis).toBeNull();
    });

    it("REFUSES exhaustiveness on the ING sheet itself once the kind is marketing or other", () => {
      // The mirror of the case above: identical text, identical caps, and the rule
      // still turns on the kind. Nothing about the text can promote a selling page.
      for (const documentKind of ["marketing", "other"]) {
        const got = parseExtractReply({ ...ING_REPLY, documentKind }, req("ING betaalpas", TARIFF_CAPPED), SWEEP);
        expect(got?.conditionsKnown, documentKind).toBe(false);
      }
    });

    it("accepts terms as an exhaustive document, since voorwaarden are written to be complete", () => {
      const got = parseExtractReply(
        { ...ING_REPLY, documentKind: "terms" },
        req("ING betaalpas", TARIFF_CAPPED),
        SWEEP,
      );
      expect(got?.conditionsKnown).toBe(true);
      expect(got?.unconditionalBasis).toBe("exhaustive-document");
    });

    it("REFUSES exhaustiveness when the kind is missing or unrecognised", () => {
      for (const documentKind of [undefined, "", "tariff", "TARIFF-SCHEDULE", 3, null]) {
        const got = parseExtractReply({ ...ING_REPLY, documentKind }, req("ING betaalpas", TARIFF_CAPPED), SWEEP);
        expect(got?.conditionsKnown, String(documentKind)).toBe(false);
        expect(got?.documentKind, String(documentKind)).toBeNull();
      }
    });

    it("REFUSES a basis it does not recognise, including a truthy one", () => {
      for (const unconditionalBasis of [undefined, null, "", "assumed", "exhaustive", true, 1]) {
        const got = parseExtractReply(
          { ...ING_REPLY, unconditionalBasis },
          req("ING betaalpas", TARIFF_CAPPED),
          SWEEP,
        );
        expect(got?.conditionsKnown, String(unconditionalBasis)).toBe(false);
      }
    });

    it("keeps the Revolut headline out: a row that carries its own ceiling is not unqualified", () => {
      const r = req("Revolut Standard", REVOLUT_TARIFF);
      const quote = "Wisselkoersopslag: 0% tot EUR 1.000 per maand, daarna 1%.";

      // Written up properly, the cap goes in conditions and the figure is covered.
      const honest = parseExtractReply(
        {
          fxFeePct: 0,
          conditions: "0% tot EUR 1.000 per maand, daarna 1%",
          conditionsKnown: true,
          quote,
          section: "Revolut Standard — Tarieven",
          documentKind: "tariff-schedule",
          capsExpressedElsewhere: true,
          unconditionalBasis: null,
        },
        r,
        SWEEP,
      );
      expect(honest?.value).toBe(0);
      expect(honest?.conditionsKnown).toBe(true);
      expect(honest?.conditions).toContain("EUR 1.000");

      // The shipped bug, dressed in the new field: a real tariff row, caps really
      // expressed elsewhere on the page, and the 0% claimed as unconditional. The
      // premise of exhaustiveness is that THIS row carries no qualifier, and this
      // row plainly does.
      const bug = parseExtractReply(
        {
          fxFeePct: 0,
          conditions: null,
          conditionsKnown: true,
          quote,
          section: "Revolut Standard — Tarieven",
          documentKind: "tariff-schedule",
          capsExpressedElsewhere: true,
          unconditionalBasis: "exhaustive-document",
        },
        r,
        SWEEP,
      );
      expect(bug?.value).toBe(0);
      expect(bug?.conditionsKnown).toBe(false);
      expect(bug?.unconditionalBasis).toBeNull();
    });

    it("takes 'stated' when the document says it outright, with no cap anywhere in it", () => {
      const got = parseExtractReply(
        {
          fxFeePct: 1.5,
          conditions: null,
          conditionsKnown: true,
          quote:
            "Wij brengen 1,50% koersopslag in rekening op alle transacties in vreemde valuta, zonder maximum en ongeacht het gekozen pakket.",
          section: "Artikel 7 Koersopslag",
          documentKind: "terms",
          capsExpressedElsewhere: false,
          unconditionalBasis: "stated",
        },
        req("Wereldpas", TERMS_STATED),
        SWEEP,
      );
      expect(got?.value).toBe(1.5);
      expect(got?.conditionsKnown).toBe(true);
      expect(got?.unconditionalBasis).toBe("stated");
    });

    it("still refuses null conditions asserted with no basis at all — the old bar, unmoved", () => {
      const got = parseExtractReply(
        {
          fxFeePct: 1,
          conditions: null,
          conditionsKnown: true,
          quote: "Buiten de eurozone rekenen wij een koersopslag van 1,0% over het bedrag van de transactie.",
          section: "Betaalpas in het buitenland",
          documentKind: "other",
          capsExpressedElsewhere: false,
          unconditionalBasis: null,
        },
        req("Triodos betaalpas", TRIODOS),
        SWEEP,
      );
      expect(got?.value).toBe(1);
      expect(got?.conditionsKnown).toBe(false);
    });

    it("never promotes conditionsKnown: a reply that says false stays false however well justified", () => {
      const got = parseExtractReply(
        { ...ING_REPLY, conditionsKnown: false },
        req("ING betaalpas", TARIFF_CAPPED),
        SWEEP,
      );
      expect(got?.value).toBe(1.2);
      expect(got?.conditionsKnown).toBe(false);
      expect(got?.unconditionalBasis).toBeNull();
    });
  });
});

/* THE AMEX REGRESSION, 2026-08-19.
 *
 * Adding the exhaustive-document rule gave the model a prominent path to CLAIM
 * unconditionality, and it started reaching for `conditions: null` on rows whose
 * scope it had previously written out. A null claim must clear a much higher bar,
 * so it failed it, and six Amex cards that were covered at 2,5% went to refused —
 * the safe direction, but a real loss of coverage caused by a prompt change.
 *
 * The prompt now says describing the scope is almost always the better answer.
 * These tests pin the PARSER behaviour either way, since the parser is what can
 * be tested without spending on a model.
 */
describe("scope is a condition, not an absence of one", () => {
  const AMEX = [
    "OVEREENKOMST VOOR DE AMERICAN EXPRESS KAARTHOUDERS – PER MAART 2022",
    "2.7 Transactie in vreemde valuta",
    "Wisselkoersopslag op het omgewisselde bedrag in euro. 2,5%",
    "6.14 Als een derde partij het bedrag al in euro's heeft omgezet, brengen wij geen wisselkoersopslag in rekening.",
  ].join("\n");

  it("a reply that WRITES THE SCOPE is covered, with no basis needed at all", () => {
    const got = parseExtractReply({
      fxFeePct: 2.5,
      conditions: "Geldt voor transacties die niet in euro zijn uitgevoerd; als een derde partij al naar euro's heeft omgezet brengt Amex geen opslag in rekening.",
      conditionsKnown: true,
      quote: "Wisselkoersopslag op het omgewisselde bedrag in euro. 2,5%",
      section: "2.7 Transactie in vreemde valuta",
      documentKind: "terms",
      capsExpressedElsewhere: false,
      unconditionalBasis: null,
    }, { product: "American Express Gold Card", sourceUrl: "https://x/y.pdf", text: AMEX }, "2026-08-19");
    expect(got).not.toBeNull();
    expect(got!.conditionsKnown).toBe(true);
    expect(got!.conditions).toContain("niet in euro");
  });

  it("the same reply claiming null instead is REFUSED — this is the regression, pinned", () => {
    const got = parseExtractReply({
      fxFeePct: 2.5, conditions: null, conditionsKnown: true,
      quote: "Wisselkoersopslag op het omgewisselde bedrag in euro. 2,5%",
      section: "2.7 Transactie in vreemde valuta",
      documentKind: "terms", capsExpressedElsewhere: false,
      unconditionalBasis: "exhaustive-document",
    }, { product: "American Express Gold Card", sourceUrl: "https://x/y.pdf", text: AMEX }, "2026-08-19");
    // capsExpressedElsewhere is false, so exhaustiveness proves nothing here.
    expect(got === null || got.conditionsKnown === false).toBe(true);
  });
});
