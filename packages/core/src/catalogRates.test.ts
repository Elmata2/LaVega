import { describe, expect, test } from "vitest";
import { fxSwitchGain, issuerConsensus, issuerToBank, marketFxOptions, marketSavingsOptions, productWithoutBank, savingsBenchmarks } from "./catalogRates.js";
import { bestRate, keptRate } from "./interest.js";

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

  /* WHAT CHANGED HERE, AND WHY IT IS NOT A REVERT (app review, 20 Aug, item 9).
   *
   * This test used to assert `ratePct === 1.5`: the promo was kept out of the rate
   * entirely. That hid it — "for a user who doesn't have bunq, if they can use the
   * promo for a month it's still a month of 3,01% over the 2,5% of Scalable
   * Capital", and a row that never carries 3,01 cannot say so.
   *
   * It also contradicted the field's own contract: RateBenchmark documents
   * `ratePct` as "the headline rate shown to the saver — the action rate when
   * there is a promo" and `standardRatePct` as what is left afterwards, which is
   * exactly what `benchmarkFromCatalogue` produces. So the split below is the
   * shape the rest of the module already expects; the ranking is unaffected
   * because it ranks `keptRate`, which is still 1,50%.
   */
  test("a promo the source states is SPLIT: headline now, standard kept", () => {
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 1.5, conditions: "Vrij opneembaar. Actierente 3,01% t/m 01-01-2027, daarna 1,50%." }) },
    })]);
    expect(b.ratePct).toBe(3.01); // what you could get now
    expect(b.standardRatePct).toBe(1.5); // what you keep
    expect(keptRate(b)).toBe(1.5); // …and therefore what the ranking rests on
    expect(b.promo).toBe(true);
    expect(b.promoNote).toContain("3,01");
  });

  test("the split only happens when 'daarna' agrees with the figure we hold", () => {
    // If the sentence's standing rate is not the value in the field, the two
    // disagree about the same product and nobody has resolved which is right.
    // Splitting on a guess would move the ranking; leaving it alone does not.
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 1.5, conditions: "Actierente 3,01% t/m 01-01-2027, daarna 2,20%." }) },
    })]);
    expect(b.ratePct).toBe(1.5);
    expect(b.standardRatePct).toBeUndefined();
    expect(b.promo).toBeUndefined();
  });

  test("an actierente sentence that says it belongs to ANOTHER product is not a promo here", () => {
    // Nexent's own words. The old note regex printed this sentence as this
    // product's promo, which is a promo the saver cannot have on this account.
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 1.25, conditions: "Saldoband 1 tot 1.000.000 EUR tegen 1,25 % p.j. De actierente van 2,75% p.j. gedurende 3 maanden geldt volgens de tabel voor de Welkom Spaarrekening, niet voor de Nexent Bank Spaarrekening." }) },
    })]);
    expect(b.ratePct).toBe(1.25);
    expect(b.promoNote).toBeUndefined();
  });

  test("a figure the source itself calls 'not the standing rate' is a teaser with an UNKNOWN standard", () => {
    // Trade Republic, in the catalogue's own words: "THIS IS A NEW-CUSTOMER
    // PROMOTIONAL RATE, NOT THE STANDING RATE — do not serve 3% bare". Served bare
    // is exactly what happened: it ranked first of all 48 rows and priced the
    // yearly gain at 3%.
    const [b] = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 3, conditions: "THIS IS A NEW-CUSTOMER PROMOTIONAL RATE, NOT THE STANDING RATE — do not serve 3% bare. Dagelijks opneembaar." }) },
    })]);
    expect(b.ratePct).toBe(3);
    expect(b.promo).toBe(true);
    expect(b.standardRatePct).toBeUndefined();
    expect(keptRate(b)).toBeNull(); // unknown — never 3, never 0
    expect(bestRate([b])).toBeNull(); // so it cannot win a comparison
  });

  test("FLAGS a figure the source says is not a savings rate, rather than dropping it", () => {
    // Wise Rente and N26's cash fund are money-market funds with capital risk,
    // flagged as such by the extractor. This test used to assert they were dropped
    // entirely. He asked for them shown "but with an asterisk", and that is the
    // better contract: a 2,32% fund is a real option someone may want, and hiding
    // it is its own kind of dishonesty. The original INTENT — that such a figure
    // must never be ranked as savings — is still asserted, now through bestRate
    // refusing it rather than through the row being absent.
    const wise = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 2.02, conditions: "NOT A SAVINGS RATE — it is 7-day fund performance, net of fee, on a money-market fund." }) },
    })]);
    expect(wise).toHaveLength(1);
    expect(wise[0].capitalAtRisk).toBe(true);
    expect(bestRate(wise)).toBeNull();

    const n26 = savingsBenchmarks([entry({
      fields: { interestPct: covered({ value: 2.32, conditions: "NOT A SAVINGS RATE AND NOT A DEPOSIT — an investment that carries a risk of capital loss." }) },
    })]);
    expect(n26).toHaveLength(1);
    expect(n26[0].capitalAtRisk).toBe(true);
    expect(bestRate(n26)).toBeNull();
  });

  test("a plain savings row is NOT flagged, so the asterisk means something", () => {
    const plain = savingsBenchmarks([entry({ fields: { interestPct: covered({ value: 1.25 }) } })]);
    expect(plain[0].capitalAtRisk).toBeUndefined();
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

describe("issuerConsensus", () => {
  const card = (id: string, issuer: string, value: number, date = "2026-01-01", known = true) => ({
    id, product: id, issuer, kind: "creditcard",
    fields: { fxFeePct: { value, route: "agent" as const, sourceUrl: `https://${id}`, checkedAt: date, conditions: "x", conditionsKnown: known } },
  });

  test("answers when every candidate agrees — the real Amex case", () => {
    // Thirteen Amex products, all 2,5%, from three different agreements. Asking
    // which card he holds cannot change the number, so asking is worse than
    // answering.
    const got = issuerConsensus([card("a", "American Express", 2.5), card("b", "American Express", 2.5), card("c", "American Express", 2.5)], "american express", "fxFeePct");
    expect(got!.value).toBe(2.5);
    expect(got!.from).toBe(3);
  });

  test("REFUSES when they differ, because then the question is the right thing to ask", () => {
    expect(issuerConsensus([card("a", "ICS", 2), card("b", "ICS", 2.5)], "ics", "fxFeePct")).toBeNull();
  });

  test("REFUSES a single product — one figure is not a consensus", () => {
    expect(issuerConsensus([card("a", "American Express", 2.5)], "american express", "fxFeePct")).toBeNull();
  });

  test("ignores uncovered candidates rather than counting them as agreement", () => {
    expect(issuerConsensus([card("a", "Amex", 2.5), card("b", "Amex", 2.5, "2026-01-01", false)], "amex", "fxFeePct")).toBeNull();
  });

  test("reports the OLDEST date among the agreeing figures", () => {
    // They agree on the number, not on how recently anyone looked. The weakest
    // link is what the reader needs.
    const got = issuerConsensus([card("a", "Amex", 2.5, "2026-08-01"), card("b", "Amex", 2.5, "2023-03-15")], "amex", "fxFeePct");
    expect(got!.asOf).toBe("2023-03-15");
  });
});
