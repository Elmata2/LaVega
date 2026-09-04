import { describe, expect, test } from "vitest";
import {
  assumptionDueForReview,
  cashbackKnowledgeOfEntry,
  cashbackSwitchGain,
  cashbackTierCounts,
  describeCashback,
  fxSwitchGain,
  issuerConsensus,
  marketCashbackOptions,
  mayAssumeNoCashback,
  issuerToBank,
  marketFxOptions,
  marketSavingsOptions,
  productWithoutBank,
  savingsBenchmarks,
} from "./catalogRates.js";
import { bestRate, keptRate } from "./interest.js";

const covered = (over: Record<string, unknown> = {}) => ({
  value: 1.25,
  route: "agent" as const,
  sourceUrl: "https://abn/fid.pdf",
  checkedAt: "2025-05-01",
  conditions: "1,25% op € 0 t/m € 500.000; 1,45% daarboven.",
  conditionsKnown: true,
  ...over,
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
    id: "abn-amro-direct-sparen",
    product: "ABN AMRO Direct Sparen",
    issuer: "ABN AMRO Bank N.V.",
    kind: "spaarrekening",
    fields: { interestPct: covered() },
    ...over,
  });

  test("carries the rate with ITS OWN source and date", () => {
    const [b] = savingsBenchmarks([entry()]);
    expect(b.bank).toBe("ABN AMRO Bank");
    expect(b.product).toBe("Direct Sparen");
    expect(b.ratePct).toBe(1.25);
    expect(b.asOf).toBe("2025-05-01");
    expect(b.sourceUrl).toBe("https://abn/fid.pdf");
  });

  test("carries the CATALOGUS-ID mee, want daar hangt de prijs van de rekening aan", () => {
    // Zonder dit veld had een renteadvies niets om de kosten aan op te hangen: een
    // benchmark is verder alleen bank + product, twee vrij geschreven strings die
    // drie bronnen op drie manieren spellen. Hier is de rij nog bekend, dus wordt
    // hij bewaard in plaats van straks teruggerekend — en een teruggerekende
    // koppeling kan de verkeerde rij pakken.
    const [b] = savingsBenchmarks([entry()]);
    expect(b.productId).toBe("abn-amro-direct-sparen");
  });

  test("REFUSES a figure whose conditions were never settled", () => {
    // An uncovered rate would rank a bank on a number nobody could qualify — the
    // exact failure the catalogue exists to prevent.
    expect(
      savingsBenchmarks([entry({ fields: { interestPct: covered({ conditionsKnown: false }) } })]),
    ).toEqual([]);
  });

  test("REFUSES an entry with no issuer, which could not be reconciled by bank", () => {
    expect(savingsBenchmarks([entry({ issuer: undefined })])).toEqual([]);
  });

  test("unstated withdrawal terms are NOT free", () => {
    const [b] = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            conditions: "1,25% op het hele saldo. Opnamevoorwaarden niet vermeld.",
          }),
        },
      }),
    ]);
    expect(b.freeWithdrawal).toBe(false);
  });

  test("a stated notice period is not free either", () => {
    const [b] = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            conditions: "1,25%. Niet vrij opneembaar; opzegtermijn 33 dagen.",
          }),
        },
      }),
    ]);
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
    const [b] = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            value: 1.5,
            conditions: "Vrij opneembaar. Actierente 3,01% t/m 01-01-2027, daarna 1,50%.",
          }),
        },
      }),
    ]);
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
    const [b] = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            value: 1.5,
            conditions: "Actierente 3,01% t/m 01-01-2027, daarna 2,20%.",
          }),
        },
      }),
    ]);
    expect(b.ratePct).toBe(1.5);
    expect(b.standardRatePct).toBeUndefined();
    expect(b.promo).toBeUndefined();
  });

  test("an actierente sentence that says it belongs to ANOTHER product is not a promo here", () => {
    // Nexent's own words. The old note regex printed this sentence as this
    // product's promo, which is a promo the saver cannot have on this account.
    const [b] = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            value: 1.25,
            conditions:
              "Saldoband 1 tot 1.000.000 EUR tegen 1,25 % p.j. De actierente van 2,75% p.j. gedurende 3 maanden geldt volgens de tabel voor de Welkom Spaarrekening, niet voor de Nexent Bank Spaarrekening.",
          }),
        },
      }),
    ]);
    expect(b.ratePct).toBe(1.25);
    expect(b.promoNote).toBeUndefined();
  });

  test("a figure the source itself calls 'not the standing rate' is a teaser with an UNKNOWN standard", () => {
    // Trade Republic, in the catalogue's own words: "THIS IS A NEW-CUSTOMER
    // PROMOTIONAL RATE, NOT THE STANDING RATE — do not serve 3% bare". Served bare
    // is exactly what happened: it ranked first of all 48 rows and priced the
    // yearly gain at 3%.
    const [b] = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            value: 3,
            conditions:
              "THIS IS A NEW-CUSTOMER PROMOTIONAL RATE, NOT THE STANDING RATE — do not serve 3% bare. Dagelijks opneembaar.",
          }),
        },
      }),
    ]);
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
    const wise = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            value: 2.02,
            conditions:
              "NOT A SAVINGS RATE — it is 7-day fund performance, net of fee, on a money-market fund.",
          }),
        },
      }),
    ]);
    expect(wise).toHaveLength(1);
    expect(wise[0].capitalAtRisk).toBe(true);
    expect(bestRate(wise)).toBeNull();

    const n26 = savingsBenchmarks([
      entry({
        fields: {
          interestPct: covered({
            value: 2.32,
            conditions:
              "NOT A SAVINGS RATE AND NOT A DEPOSIT — an investment that carries a risk of capital loss.",
          }),
        },
      }),
    ]);
    expect(n26).toHaveLength(1);
    expect(n26[0].capitalAtRisk).toBe(true);
    expect(bestRate(n26)).toBeNull();
  });

  test("a plain savings row is NOT flagged, so the asterisk means something", () => {
    const plain = savingsBenchmarks([entry({ fields: { interestPct: covered({ value: 1.25 }) } })]);
    expect(plain[0].capitalAtRisk).toBeUndefined();
  });

  test("ignores card products entirely", () => {
    expect(
      savingsBenchmarks([
        {
          id: "x",
          product: "ING betaalpas",
          issuer: "ING Bank N.V.",
          fields: { fxFeePct: covered() },
        },
      ]),
    ).toEqual([]);
  });
});

describe("names a saver would recognise", () => {
  test("the bank prefix must end on a word boundary", () => {
    // "Open Bank" once ate the "Open" out of "Openbank Welkom Spaarrekening" and
    // the row read "Open Bank — bank Welkom Spaarrekening".
    expect(productWithoutBank("Openbank Welkom Spaarrekening", "Open Bank")).toBe(
      "Openbank Welkom Spaarrekening",
    );
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
    id,
    product,
    issuer,
    kind: "creditcard",
    fields: {
      fxFeePct: {
        value,
        route: "agent" as const,
        sourceUrl: `https://${id}`,
        checkedAt: "2026-01-01",
        conditions: "x",
        conditionsKnown: known,
      },
    },
  });

  test("ranks covered surcharges cheapest first", () => {
    const out = marketFxOptions([
      card("a", "A", "Bank A N.V.", 2),
      card("b", "B", "Bank B N.V.", 0.2),
    ]);
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
      id,
      product: id,
      issuer: "B N.V.",
      kind: "spaarrekening",
      fields: {
        interestPct: {
          value: v,
          route: "agent" as const,
          sourceUrl: "https://x",
          checkedAt: "2026-01-01",
          conditions: "x",
          conditionsKnown: true,
        },
      },
    });
    expect(marketSavingsOptions([sav("low", 1), sav("high", 3)]).map((o) => o.product)).toEqual([
      "high",
      "low",
    ]);
  });

  test("carries the source's own date, so an old figure can say so", () => {
    expect(marketFxOptions([card("a", "A", "Bank A", 1)])[0].asOf).toBe("2026-01-01");
  });
});

describe("fxSwitchGain", () => {
  const best = {
    productId: "x",
    product: "X",
    bank: "X",
    value: 0,
    conditions: null,
    sourceUrl: "https://x",
    asOf: "2026-01-01",
  };

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
    id,
    product: id,
    issuer,
    kind: "creditcard",
    fields: {
      fxFeePct: {
        value,
        route: "agent" as const,
        sourceUrl: `https://${id}`,
        checkedAt: date,
        conditions: "x",
        conditionsKnown: known,
      },
    },
  });

  test("answers when every candidate agrees — the real Amex case", () => {
    // Thirteen Amex products, all 2,5%, from three different agreements. Asking
    // which card he holds cannot change the number, so asking is worse than
    // answering.
    const got = issuerConsensus(
      [
        card("a", "American Express", 2.5),
        card("b", "American Express", 2.5),
        card("c", "American Express", 2.5),
      ],
      "american express",
      "fxFeePct",
    );
    expect(got!.value).toBe(2.5);
    expect(got!.from).toBe(3);
  });

  test("REFUSES when they differ, because then the question is the right thing to ask", () => {
    expect(
      issuerConsensus([card("a", "ICS", 2), card("b", "ICS", 2.5)], "ics", "fxFeePct"),
    ).toBeNull();
  });

  test("REFUSES a single product — one figure is not a consensus", () => {
    expect(
      issuerConsensus([card("a", "American Express", 2.5)], "american express", "fxFeePct"),
    ).toBeNull();
  });

  test("ignores uncovered candidates rather than counting them as agreement", () => {
    expect(
      issuerConsensus(
        [card("a", "Amex", 2.5), card("b", "Amex", 2.5, "2026-01-01", false)],
        "amex",
        "fxFeePct",
      ),
    ).toBeNull();
  });

  test("reports the OLDEST date among the agreeing figures", () => {
    // They agree on the number, not on how recently anyone looked. The weakest
    // link is what the reader needs.
    const got = issuerConsensus(
      [card("a", "Amex", 2.5, "2026-08-01"), card("b", "Amex", 2.5, "2023-03-15")],
      "amex",
      "fxFeePct",
    );
    expect(got!.asOf).toBe("2023-03-15");
  });
});

describe("marketCashbackOptions", () => {
  const cb = (id: string, issuer: string, value: number, known = true) => ({
    id,
    product: id,
    issuer,
    kind: "creditcard",
    fields: {
      cashbackPct: {
        value,
        route: "agent" as const,
        sourceUrl: `https://${id}`,
        checkedAt: "2026-08-19",
        conditions: "1% tot € 100 per maand",
        conditionsKnown: known,
      },
    },
  });

  test("ranks the payers, best first", () => {
    expect(
      marketCashbackOptions([cb("a", "A Bank", 0.5), cb("b", "B Bank", 1.5)]).map((o) => o.product),
    ).toEqual(["b", "a"]);
  });

  test("a card that pays NOTHING is not an offer, though the fact is kept elsewhere", () => {
    expect(marketCashbackOptions([cb("zero", "Z Bank", 0)])).toEqual([]);
  });

  test("an unproven cashback is absent, never assumed to be zero", () => {
    // Assuming zero would rank a good card last, which is the expensive direction.
    expect(marketCashbackOptions([cb("a", "A", 2, false)])).toEqual([]);
  });

  test("carries the conditions, because 1% up to € 100 a month is not 1%", () => {
    expect(marketCashbackOptions([cb("a", "A", 1)])[0].conditions).toContain("€ 100");
  });
});

describe("cashbackSwitchGain", () => {
  const best = {
    productId: "x",
    product: "X",
    bank: "X",
    cashbackPct: 1.5,
    conditions: null,
    sourceUrl: "https://x",
    asOf: "2026-08-19",
  };

  test("quantifies a year of not switching", () => {
    // € 20.000 a year at 1,5% instead of 0% is € 300.
    expect(cashbackSwitchGain(0, best, 2_000_000)!.extraPerYearCents).toBe(30000);
  });

  test("says nothing when his own card already pays as much", () => {
    expect(cashbackSwitchGain(1.5, best, 2_000_000)).toBeNull();
  });

  test("says nothing when his own rate is UNKNOWN", () => {
    expect(cashbackSwitchGain(null, best, 2_000_000)).toBeNull();
  });
});

/* ══════ AANGENOMEN: GEEN CASHBACK ═══════════════════════════════════════════
 *
 * App review 4, punt 22. Zijn woorden: "for most cards — ING, ABN, most normal
 * ones — they don't have cashback… if there's no case then it's zero."
 *
 * Dit is de gevoeligste wijziging van de ronde, want hij bijt op "onbekend is
 * nooit nul". De uitvoering is daarom een EIGEN tier: geen `?? 0`, maar een
 * derde toestand die op het scherm ook zo heet. Deze suite bewaakt allebei de
 * kanten — dat de aanname er komt waar hij hoort, en dat hij nergens anders
 * komt.
 */

describe("cashbackKnowledgeOfEntry", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "ing-betaalpas",
    product: "ING betaalpas",
    issuer: "ING Bank N.V.",
    kind: "betaalpas",
    fields: {},
    ...over,
  });

  test("een gedekt cijfer is GEMETEN, met bron en peildatum", () => {
    const k = cashbackKnowledgeOfEntry(
      row({
        fields: {
          cashbackPct: {
            value: 2,
            route: "agent" as const,
            sourceUrl: "https://x",
            checkedAt: "2026-08-01",
            conditions: null,
            conditionsKnown: true,
          },
        },
      }),
    );
    expect(k.tier).toBe("gemeten");
    if (k.tier !== "gemeten") throw new Error("onbereikbaar");
    expect(k.pct).toBe(2);
    expect(k.asOf).toBe("2026-08-01");
  });

  test("een gedekte NUL is gemeten, niet aangenomen — de keerzijde van de regel", () => {
    // "Een uitgesproken 'gratis' IS een bekende nul." Zegt het tarievenblad het
    // zelf, dan is dat een feit met een bron, en het mag niet op één hoop met een
    // nul die wij invullen: dan is het verschil na één sweep niet meer te zien.
    const k = cashbackKnowledgeOfEntry(
      row({
        fields: {
          cashbackPct: {
            value: 0,
            route: "provider-pdf" as const,
            sourceUrl: "https://ing/tarieven.pdf",
            checkedAt: "2026-06-15",
            conditions: "Geen cashback op de betaalpas.",
            conditionsKnown: true,
          },
        },
      }),
    );
    expect(k.tier).toBe("gemeten");
    expect(describeCashback(k)).toContain("gemeten: geen cashback");
    expect(describeCashback(k)).toContain("2026-06-15");
  });

  test("een gewone ING-betaalpas zonder cijfer is AANGENOMEN nul", () => {
    const k = cashbackKnowledgeOfEntry(row());
    expect(k.tier).toBe("aangenomen");
    if (k.tier !== "aangenomen") throw new Error("onbereikbaar");
    expect(k.pct).toBe(0);
    expect(k.issuerFamily).toBe("ING");
    // En het staat er letterlijk zo op het scherm, met het woord erbij.
    expect(describeCashback(k)).toBe(
      "aangenomen: geen cashback — niet gevonden in de voorwaarden van dit product",
    );
  });

  test("een cijfer waarvan de voorwaarden niet vaststaan valt terug op de aanname, niet op het cijfer", () => {
    // Niet gedekt = geen gemeten cijfer. Dat het er staat maakt het niet bruikbaar,
    // en het mag hier zeker geen 2% worden zonder dat iemand de voorwaarden kent.
    const k = cashbackKnowledgeOfEntry(
      row({
        fields: {
          cashbackPct: {
            value: 2,
            route: "agent" as const,
            sourceUrl: "https://x",
            checkedAt: "2026-08-01",
            conditions: null,
            conditionsKnown: false,
          },
        },
      }),
    );
    expect(k.tier).toBe("aangenomen");
    expect(k).not.toHaveProperty("sourceUrl");
  });

  test("de peildatum van de aanname is de LAATSTE keer dat iemand dit product las", () => {
    const k = cashbackKnowledgeOfEntry(
      row({
        fields: {
          fxFeePct: {
            value: 1.4,
            route: "provider-pdf" as const,
            sourceUrl: "https://ing",
            checkedAt: "2025-01-10",
            conditions: "geen",
            conditionsKnown: true,
          },
          accountFee: {
            value: 0,
            route: "provider-pdf" as const,
            sourceUrl: "https://ing",
            checkedAt: "2026-06-15",
            conditions: "gratis",
            conditionsKnown: true,
          },
        },
      }),
    );
    if (k.tier !== "aangenomen") throw new Error("verwachtte een aanname");
    expect(k.lastCheckedAt).toBe("2026-06-15");
  });

  test("zonder één gedekt veld noemt de aanname geen datum in plaats van er een te kiezen", () => {
    const k = cashbackKnowledgeOfEntry(row());
    if (k.tier !== "aangenomen") throw new Error("verwachtte een aanname");
    expect(k.lastCheckedAt).toBeNull();
  });
});

describe("de afbakening van de aanname", () => {
  /* Dit is het deel dat de regel overeind houdt. Elke rij hieronder is een
     product waar nul aannemen ONJUIST zou zijn, en de reden staat erbij zodat een
     melding zijn eigen oorzaak kan noemen. */

  test("een cryptokaart nooit — daar is cashback het verkoopargument", () => {
    const k = cashbackKnowledgeOfEntry({
      id: "bleap-card",
      product: "Bleap Card",
      issuer: "Bleap SIA (Latvia)",
      kind: "crypto",
      fields: {},
    });
    expect(k).toEqual({ tier: "onbekend", reason: "verkoopargument" });
  });

  test("een prepaidkaart nooit — alle acht aantoonbare cijfers in de catalogus staan op zo'n kaart", () => {
    const k = cashbackKnowledgeOfEntry({
      id: "cdc",
      product: "Crypto.com Prepaid Card",
      issuer: "Crypto.com",
      kind: "prepaid",
      fields: {},
    });
    expect(k).toEqual({ tier: "onbekend", reason: "verkoopargument" });
  });

  test("American Express nooit — die kaarten worden verkocht op wat je ermee verdient", () => {
    const k = cashbackKnowledgeOfEntry({
      id: "amex-gold",
      product: "American Express Gold Card",
      issuer: "American Express (self-issued in NL; NOT ICS)",
      kind: "creditcard",
      fields: {},
    });
    expect(k).toEqual({ tier: "onbekend", reason: "beloningsuitgever" });
  });

  test("een co-brandkaart glipt niet binnen via de uitgever van iemand anders", () => {
    // De valstrik: "Flying Blue - American Express Entry Card" met een
    // uitgeversregel waar een naam van de lijst in voorkomt. De beloningskant
    // wint, altijd.
    const k = cashbackKnowledgeOfEntry({
      id: "fb-entry",
      product: "Flying Blue - American Express Entry Card",
      issuer: "International Card Services B.V. (ICS)",
      kind: "creditcard",
      fields: {},
    });
    expect(k).toEqual({ tier: "onbekend", reason: "beloningsuitgever" });
  });

  test("een neobank met betaalde niveaus nooit — die niveaus worden op hun extraatjes verkocht", () => {
    for (const [product, issuer] of [
      ["Revolut Metal betaalpas", "Revolut Bank UAB"],
      ["N26 Metal betaalpas", "N26 Bank AG; metal Mastercard Debit"],
      ["bunq Elite betaalpas", "bunq B.V.; Mastercard"],
      ["Wise betaalpas", "Wise Europe SA (Belgium)"],
      ["212 Card", "Paynetics (card issuer); NL customers under Trading 212"],
    ]) {
      const k = cashbackKnowledgeOfEntry({
        id: product,
        product,
        issuer,
        kind: "betaalpas",
        fields: {},
      });
      expect(k, product).toEqual({ tier: "onbekend", reason: "uitgever-buiten-de-aanname" });
    }
  });

  test("een spaarrekening nooit — daar hoort geen kaart bij, dus ook geen vraag", () => {
    const k = cashbackKnowledgeOfEntry({
      id: "abn-sparen",
      product: "ABN AMRO Direct Sparen",
      issuer: "ABN AMRO Bank N.V.",
      kind: "spaarrekening",
      fields: {},
    });
    expect(k).toEqual({ tier: "onbekend", reason: "geen-betaalproduct" });
  });

  test("zonder soort nooit — dan weten we niet of het een pas of een cryptokaart is", () => {
    const k = cashbackKnowledgeOfEntry({
      id: "x",
      product: "Iets",
      issuer: "ING Bank N.V.",
      fields: {},
    });
    expect(k).toEqual({ tier: "onbekend", reason: "soort-onbekend" });
  });

  test("de grootbanken en hun ICS-creditcards vallen er wél onder — dat is de hele vraag", () => {
    const rows: [string, string, string][] = [
      ["ING betaalpas", "ING Bank N.V.", "ING"],
      ["ABN AMRO betaalpas", "ABN AMRO Bank N.V.", "ABN AMRO"],
      ["Rabobank betaalpas", "Coöperatieve Rabobank U.A.", "Rabobank"],
      ["Triodos betaalpas", "Triodos Bank N.V.", "Triodos Bank"],
      ["Knab betaalpas", "Knab (Aegon Bank N.V.)", "Knab"],
      // De creditcards van ING, ABN, Rabo, SNS, ASN en RegioBank worden állemaal
      // door ICS uitgegeven. Zonder die regel valt de helft van zijn eigen kaarten
      // buiten de aanname die juist over hen gaat — en de melding noemt dan de
      // bank die op de kaart staat, niet de verwerker erachter.
      ["ING creditcard", "International Card Services (ICS)", "ING"],
      ["ABN AMRO Gold Card", "International Card Services (ICS)", "ABN AMRO"],
      // ICS' eigen kaart valt er ook onder. Dat hij hier als ABN AMRO uitkomt is
      // geen fout maar de uitgeversregel van de catalogus zelf, die ICS "an ABN
      // AMRO subsidiary" noemt — en het is de naam die de lezer herkent.
      [
        "ICS Visa World Card",
        "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
        "ABN AMRO",
      ],
    ];
    for (const [product, issuer, family] of rows) {
      const k = cashbackKnowledgeOfEntry({
        id: product,
        product,
        issuer,
        kind:
          product.includes("creditcard") || product.includes("Card") ? "creditcard" : "betaalpas",
        fields: {},
      });
      expect(k.tier, product).toBe("aangenomen");
      if (k.tier !== "aangenomen") throw new Error("onbereikbaar");
      expect(k.issuerFamily, product).toBe(family);
    }
  });

  test("de RegioBank-pas heet RegioBank, ook al staat ASN in zijn uitgeversregel", () => {
    // "ASN Bank N.V. (formerly RegioBank N.V.)" — specifieker eerst, anders noemt
    // de melding de verkeerde bank en is hij niet na te kijken.
    const k = cashbackKnowledgeOfEntry({
      id: "regiobank-betaalpas",
      product: "RegioBank betaalpas",
      issuer: "ASN Bank N.V. (formerly RegioBank N.V.)",
      kind: "betaalpas",
      fields: {},
    });
    if (k.tier !== "aangenomen") throw new Error("verwachtte een aanname");
    expect(k.issuerFamily).toBe("RegioBank");
  });

  test("'Trading' bevat de letters ing en is toch geen ING", () => {
    // Een woordgrens en geen substring: zonder die grens zou elke Trading
    // 212-rekening als ING doorgaan en de aanname van de verkeerde bank erven.
    expect(mayAssumeNoCashback("Trading 212", "betaalpas").ok).toBe(false);
  });
});

describe("cashbackTierCounts", () => {
  test("telt de drie hardheden apart, zodat het scherm er een controleerbare zin van kan maken", () => {
    const counts = cashbackTierCounts([
      { id: "a", product: "ING betaalpas", issuer: "ING Bank N.V.", kind: "betaalpas", fields: {} },
      {
        id: "b",
        product: "ABN AMRO betaalpas",
        issuer: "ABN AMRO Bank N.V.",
        kind: "betaalpas",
        fields: {},
      },
      {
        id: "c",
        product: "Bleap Card",
        issuer: "Bleap SIA",
        kind: "crypto",
        fields: {
          cashbackPct: {
            value: 1,
            route: "agent" as const,
            sourceUrl: "https://b",
            checkedAt: "2026-08-01",
            conditions: null,
            conditionsKnown: true,
          },
        },
      },
      { id: "d", product: "Wirex Card", issuer: "Wirex", kind: "crypto", fields: {} },
    ]);
    expect(counts).toEqual({ gemeten: 1, aangenomen: 2, onbekend: 1 });
  });
});

describe("assumptionDueForReview", () => {
  /* Zijn eigen vraag: een jaarlijkse sweep voor als er tóch cashback verschijnt.
     Die cadans staat in de code en niet alleen in een agenda, zodat het scherm
     kan zeggen dat een aanname oud is in plaats van hem stil te herhalen. */

  test("een aanname van elf maanden oud mag blijven staan", () => {
    expect(assumptionDueForReview("2025-10-01", "2026-08-21")).toBe(false);
  });

  test("twaalf maanden is toe aan een nieuwe blik", () => {
    expect(assumptionDueForReview("2025-08-15", "2026-08-21")).toBe(true);
  });

  test("zonder peildatum is hij per definitie toe — niemand weet wanneer er gekeken is", () => {
    expect(assumptionDueForReview(null, "2026-08-21")).toBe(true);
  });

  test("een peildatum op maandniveau werkt net zo goed als een hele datum", () => {
    // De catalogus schrijft sommige data als "2026-01". Een vergelijking die van
    // de schrijfwijze afhangt in plaats van van de tijd is geen vergelijking.
    expect(assumptionDueForReview("2026-01", "2026-08-21")).toBe(false);
    expect(assumptionDueForReview("2025-01", "2026-08-21")).toBe(true);
  });
});
