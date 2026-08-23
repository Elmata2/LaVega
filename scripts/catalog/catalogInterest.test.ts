import { describe, expect, it } from "vitest";
import { INTEREST_TOOL, buildInterestPrompt, parseInterestReply } from "./catalogInterest.js";

/** Written the way the sweep sees these documents: an FID header, then rows. */
const ABN = [
  "Informatiedocument betreffende de vergoedingen",
  "Naam van de rekening: ABN AMRO Direct Sparen",
  "Datum: 1 mei 2025",
  "Rente op jaarbasis",
  "€ 0 t/m € 500.000                1,25%",
  "€ 500.000 t/m € 1.000.000        1,45%",
  "vanaf € 1.000.000                0,00%",
  "De rentes gelden vanaf 1 mei 2025. Alle genoemde rentes zijn op jaarbasis.",
].join("\n");

const BUNQ = [
  "Tarieven sparen",
  "Actierente 3,01% tot en met 01-01-2027, daarna geldt de standaardrente van 1,50%.",
  "Je kunt altijd zonder opzegtermijn geld opnemen.",
].join("\n");

const FLAT = "Internet Sparen: 1,15% rente op jaarbasis over je hele saldo, altijd vrij opneembaar.";

const req = (text: string, product = "ABN AMRO Direct Sparen") => ({
  product, sourceUrl: "https://assets.abnamro.com/x.pdf", text,
});

const reply = (over: Record<string, unknown>) => ({
  standardPct: 1.25, promoPct: null, promoUntil: null,
  conditions: "1,25% op € 0 t/m € 500.000; 1,45% op € 500.000 t/m € 1.000.000; 0,00% vanaf € 1.000.000.",
  conditionsKnown: true, freeWithdrawal: true,
  quote: "€ 0 t/m € 500.000                1,25%",
  documentScope: "ABN AMRO Direct Sparen",
  ...over,
});

describe("INTEREST_TOOL", () => {
  it("forces the split between the standard rate and the promo", () => {
    const schema = INTEREST_TOOL.input_schema as { required: string[] };
    expect(schema.required).toEqual([
      "standardPct", "promoPct", "promoUntil", "conditions",
      "conditionsKnown", "freeWithdrawal", "quote", "documentScope",
    ]);
  });

  it("tells the model in the prompt which number ranks accounts wrongly", () => {
    const { system } = buildInterestPrompt(req(BUNQ, "bunq Spaarrekening"));
    expect(system).toContain("1,50%");
    expect(system).toMatch(/teaser|promo/i);
  });
});

describe("parseInterestReply", () => {
  it("takes the FIRST band as the standard rate, with the bands written out", () => {
    const got = parseInterestReply(reply({}), req(ABN));
    expect(got).not.toBeNull();
    expect(got!.standardPct).toBe(1.25);
    expect(got!.conditionsKnown).toBe(true);
    expect(got!.conditions).toContain("500.000");
  });

  it("REFUSES a band that only applies above a threshold as the standard rate", () => {
    // 1,45% is real and is in the document, but it is not what a saver keeps.
    // The parser cannot know intent, so this is the quote check doing the work:
    // the 1,45% row is a different row, and claiming it with the 1,25% quote fails.
    const got = parseInterestReply(reply({ standardPct: 1.45 }), req(ABN));
    expect(got).toBeNull();
  });

  it("REFUSES a rate whose quote is not in the document", () => {
    expect(parseInterestReply(reply({ quote: "€ 0 t/m € 500.000   2,95%" }), req(ABN))).toBeNull();
  });

  it("carries a promo without letting it become the standard rate", () => {
    const got = parseInterestReply({
      standardPct: 1.5, promoPct: 3.01, promoUntil: "t/m 01-01-2027",
      conditions: "Actierente 3,01% tot en met 01-01-2027, daarna standaardrente 1,50%. Vrij opneembaar.",
      conditionsKnown: true, freeWithdrawal: true,
      quote: "Actierente 3,01% tot en met 01-01-2027, daarna geldt de standaardrente van 1,50%.",
      documentScope: null,
    }, req(BUNQ, "bunq Spaarrekening"));
    expect(got).not.toBeNull();
    expect(got!.standardPct).toBe(1.5);
    expect(got!.promoPct).toBe(3.01);
    expect(got!.conditionsKnown).toBe(true);
  });

  it("REFUSES a promo reported with no conditions text — the saver must be told it changes", () => {
    const got = parseInterestReply({
      standardPct: 1.5, promoPct: 3.01, promoUntil: null, conditions: null, conditionsKnown: true,
      freeWithdrawal: true,
      quote: "Actierente 3,01% tot en met 01-01-2027, daarna geldt de standaardrente van 1,50%.",
      documentScope: null,
    }, req(BUNQ, "bunq Spaarrekening"));
    expect(got!.conditionsKnown).toBe(false);
  });

  it("REFUSES null conditions from a document scoped to one account", () => {
    expect(parseInterestReply(reply({ conditions: null }), req(ABN))!.conditionsKnown).toBe(false);
  });

  it("ACCEPTS a genuinely flat rate from an unscoped document", () => {
    const got = parseInterestReply({
      standardPct: 1.15, promoPct: null, promoUntil: null, conditions: null, conditionsKnown: true,
      freeWithdrawal: true, quote: FLAT, documentScope: null,
    }, req(FLAT, "Triodos Internet Sparen"));
    expect(got!.conditionsKnown).toBe(true);
    expect(got!.conditions).toBeNull();
  });

  it("treats silence about withdrawal as unknown, never as free", () => {
    const got = parseInterestReply(reply({ freeWithdrawal: undefined }), req(ABN));
    expect(got!.freeWithdrawal).toBeNull();
  });

  it("refuses a rate outside any plausible savings range", () => {
    for (const bad of [-1, 40, 500000]) {
      expect(parseInterestReply(reply({ standardPct: bad }), req(ABN))).toBeNull();
    }
  });

  it("never promotes conditionsKnown the reply itself reported false", () => {
    expect(parseInterestReply(reply({ conditionsKnown: false }), req(ABN))!.conditionsKnown).toBe(false);
  });
});
