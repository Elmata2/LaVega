import { describe, expect, test } from "vitest";
import { fxSwitchGain, issuerToBank, marketFxOptions, marketSavingsOptions, productWithoutBank, savingsBenchmarks } from "./catalogRates.js";

const covered = (over: Record<string, unknown> = {}) => ({
  value: 1.25, route: "agent" as const, sourceUrl: "https://abn/fid.pdf",
  checkedAt: "2025-05-01", conditions: "1,25% op € 0 t/m € 500.000; 1,45% daarboven.",
  conditionsKnown: true, ...over,
});

describe("issuerToBank", () => {
  test("strips the legal form and the DGS note a saver never sees", () => {
    // "Bank" is deliberately KEPT: Triodos Bank and DHB Bank are named that way in
    // the comparison table and by savers, so removing it would break more matches
    // than it fixes.
    expect(issuerToBank("ABN AMRO Bank N.V. — Dutch DGS")).toBe("ABN AMRO Bank");
    expect(issuerToBank("Triodos Bank N.V.")).toBe("Triodos Bank");
    expect(issuerToBank("Knab (Aegon Bank N.V.)")).toBe("Knab");
    expect(issuerToBank("bunq B.V.; Mastercard")).toBe("bunq");
  });
});

describe("productWithoutBank", () => {
  test("pairs 'ABN AMRO Direct Sparen' as bank + product, the shape the table uses", () => {
    expect(productWithoutBank("ABN AMRO Direct Sparen", "ABN AMRO")).toBe("Direct Sparen");
  });
  test("leaves a product that does not repeat its bank alone", () => {
    expect(productWithoutBank("Internet Sparen", "Triodos Bank")).toBe("Internet Sparen");
  });
  test("never returns an empty product name", () => {
    expect(productWithoutBank("bunq", "bunq")).toBe("bunq");
  });
});

describe("savingsBenchmarks", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: "abn-amro-direct-sparen", product: "ABN AMRO Direct Sparen",
    issuer: "ABN AMRO Bank N.V.", kind: "spaarrekening",
    fields: { interestPct: covered() }, ...over,
  });

  test("carries the rate with ITS OWN source and date", () => {
    const [b] = savingsBenchmarks([entry()]);
    expect(b.bank).toBe("ABN AMRO Bank");
    expect(b.product).toBe("Direct Sparen");
    expect(b.ratePct).toBe(1.25);
    expect(b.asOf).toBe("2025-05-01");
    expect(b.sourceUrl).toBe("https://abn/fid.pdf");
  });

  test("REFUSES a figure whose conditions were never settled", () => {
    // An uncovered rate would rank a bank on a number nobody could qualify — the
    // exact failure the catalogue exists to prevent.
    expect(savingsBenchmarks([entry({ fields: { interestPct: covered({ conditionsKnown: false }) } })])).toEqual([]);
  });

  test("REFUSES an entry with no issuer, which could not be reconciled by bank", () => {
    expect(savingsBenchmarks([entry({ issuer: undefined })])).toEqual([]);
  });

  test("unstated withdrawal terms are NOT free", () => {
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ conditions: "1,25% op het hele saldo. Opnamevoorwaarden niet vermeld." }) },
    })]);
    expect(b.freeWithdrawal).toBe(false);
  });

  test("a stated notice period is not free either", () => {
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ conditions: "1,25%. Niet vrij opneembaar; opzegtermijn 33 dagen." }) },
    })]);
    expect(b.freeWithdrawal).toBe(false);
  });

  test("a promo becomes a note without becoming the rate", () => {
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 1.5, conditions: "Vrij opneembaar. Actierente 3,01% t/m 01-01-2027, daarna 1,50%." }) },
    })]);
    expect(b.ratePct).toBe(1.5);
    expect(b.promoNote).toContain("3,01");
  });

  test("ignores card products entirely", () => {
    expect(savingsBenchmarks([{ id: "x", product: "ING betaalpas", issuer: "ING Bank N.V.", fields: { fxFeePct: covered() } }])).toEqual([]);
  });
});

describe("names a saver would recognise", () => {
  test("the bank prefix must end on a word boundary", () => {
    // "Open Bank" once ate the "Open" out of "Openbank Welkom Spaarrekening" and
    // the row read "Open Bank — bank Welkom Spaarrekening".
    expect(productWithoutBank("Openbank Welkom Spaarrekening", "Open Bank")).toBe("Openbank Welkom Spaarrekening");
  });
  test("strips a foreign legal form too", () => {
    expect(issuerToBank("Bigbank AS")).toBe("Bigbank");
  });
  test("keeps a bank whose name really is two words", () => {
    expect(productWithoutBank("Trade Republic Cash", "Trade Republic")).toBe("Cash");
  });
});

describe("what the whole market offers", () => {
  const card = (id: string, product: string, issuer: string, value: number, known = true) => ({
    id, product, issuer, kind: "creditcard",
    fields: { fxFeePct: { value, route: "agent" as const, sourceUrl: `https://${id}`, checkedAt: "2026-01-01", conditions: "x", conditionsKnown: known } },
  });

  test("ranks covered surcharges cheapest first", () => {
    const out = marketFxOptions([card("a", "A", "Bank A N.V.", 2), card("b", "B", "Bank B N.V.", 0.2)]);
    expect(out.map((o) => o.product)).toEqual(["B", "A"]);
    expect(out[0].bank).toBe("Bank B");
  });

  test("REFUSES a product whose conditions were never settled", () => {
    // Recommending a switch on a rate nobody qualified is the advice this whole
    // project exists to not give.
    expect(marketFxOptions([card("a", "A", "Bank A", 0, false)])).toEqual([]);
  });

  test("savings ranks the other way — highest rate first", () => {
    const sav = (id: string, v: number) => ({
      id, product: id, issuer: "B N.V.", kind: "spaarrekening",
      fields: { interestPct: { value: v, route: "agent" as const, sourceUrl: "https://x", checkedAt: "2026-01-01", conditions: "x", conditionsKnown: true } },
    });
    expect(marketSavingsOptions([sav("low", 1), sav("high", 3)]).map((o) => o.product)).toEqual(["high", "low"]);
  });

  test("carries the source's own date, so an old figure can say so", () => {
    expect(marketFxOptions([card("a", "A", "Bank A", 1)])[0].asOf).toBe("2026-01-01");
  });
});

describe("fxSwitchGain", () => {
  const best = { productId: "x", product: "X", bank: "X", value: 0, conditions: null, sourceUrl: "https://x", asOf: "2026-01-01" };

  test("quantifies what not switching costs on a given spend", () => {
    // € 1.000 abroad at 1,4% instead of 0% is € 14.
    expect(fxSwitchGain(1.4, best, 100_000)!.savingCents).toBe(1400);
  });

  test("returns nothing when the user's own card is already as good", () => {
    expect(fxSwitchGain(0, best, 100_000)).toBeNull();
  });

  test("returns nothing when the user's own rate is UNKNOWN", () => {
    // A saving computed against an unknown is a guess wearing a number's clothes.
    expect(fxSwitchGain(null, best, 100_000)).toBeNull();
  });

  test("returns nothing when the market has no covered option at all", () => {
    expect(fxSwitchGain(1.4, undefined, 100_000)).toBeNull();
  });
});
