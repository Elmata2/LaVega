import { describe, expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { bestRate, bestPromoRate, keptRate, matchBankBenchmark, detectInterestRate, resolveAccountRate, analyzeInterest, NL_SAVINGS_RATES, mergeRateSources, benchmarkFromCatalogue, type RateBenchmark } from "./interest.js";

const acc = (over: Partial<Account>): Account =>
  ({ key: "A1", iban: "A1", name: "x", bank: "ING", entity: "BV1", currency: "EUR", balance: 10000, ...over });
const rente = (date: string, amount: number): Tx =>
  ({ id: date, accountKey: "A1", date, amount, currency: "EUR", counterparty: "Rente", description: "Rente spaarrekening", category: "", manual: false });

test("bestRate ranks on what the saver KEEPS, not on the actierente", () => {
  // Was 3,1% (Bigbank's six-month teaser). Ranking on a promo sends a saver to an
  // account that pays 2,1% from month seven while a permanently better one exists.
  const best = bestRate(NL_SAVINGS_RATES)!;
  expect(keptRate(best)).toBe(2.5);
  expect(best.bank).toBe("Scalable Capital");
});

test("the winner still carries its promo, so the UI can show both", () => {
  const withPromo: RateBenchmark[] = [
    { bank: "A", product: "P", ratePct: 9, standardRatePct: 1, promoNote: "6 mnd", freeWithdrawal: true },
    { bank: "B", product: "P", ratePct: 2, freeWithdrawal: true },
  ];
  expect(bestRate(withPromo)!.bank).toBe("B");
});

test("detectInterestRate: implied % from trailing-year rente credits vs balance", () => {
  const a = acc({ balance: 10000 });
  expect(detectInterestRate(a, [rente("2026-06-01", 150)], "2026-08-01")).toBe(1.5);
  expect(detectInterestRate(a, [rente("2024-01-01", 150)], "2026-08-01")).toBeNull(); // too old
  expect(detectInterestRate(acc({ balance: 0 }), [rente("2026-06-01", 150)], "2026-08-01")).toBeNull();
});

test("resolveAccountRate: manual > detected > assumed(0 for betaal) > unknown", () => {
  expect(resolveAccountRate(acc({ interestRate: 0.8 }), [], "2026-08-01")).toEqual({ ratePct: 0.8, source: "manual" });
  expect(resolveAccountRate(acc({ type: "Betaalrekening" }), [], "2026-08-01")).toEqual({ ratePct: 0, source: "assumed" });
  expect(resolveAccountRate(acc({ type: "Spaarrekening" }), [], "2026-08-01")).toEqual({ ratePct: null, source: "unknown" });
  expect(resolveAccountRate(acc({ type: "Spaarrekening" }), [rente("2026-06-01", 150)], "2026-08-01")).toEqual({ ratePct: 1.5, source: "detected" });
});

test("analyzeInterest: idle cash on 0% betaalrekening quantifies yearly gain vs best", () => {
  const accounts = [acc({ key: "B", type: "Betaalrekening", balance: 20000 })];
  const r = analyzeInterest(accounts, [], NL_SAVINGS_RATES, "2026-08-01");
  expect(r.best!.ratePct).toBe(2.5);
  expect(r.suggestions).toHaveLength(1);
  // 20000 * 2,5% = €500, measured against what the winning account KEEPS. It used
  // to read €620, computed from Bigbank's 3,1% actierente — a gain that stops in
  // month seven, and the most believable wrong number the app could print.
  expect(r.suggestions[0].extraPerYearCents).toBe(50000);
  expect(r.totalExtraPerYearCents).toBe(50000);
});

test("resolveAccountRate: savings at a known bank estimates the current rate from that bank's standard tariff", () => {
  const ing = acc({ type: "Spaarrekening", bank: "ING", balance: 5000 });
  expect(resolveAccountRate(ing, [], "2026-08-01", NL_SAVINGS_RATES)).toEqual({ ratePct: 1.25, source: "benchmark" });
  // unknown bank -> still unknown
  expect(resolveAccountRate(acc({ type: "Spaarrekening", bank: "Onbekende Bank" }), [], "2026-08-01", NL_SAVINGS_RATES).source).toBe("unknown");
});

test("analyzeInterest: an existing savings saldo is compared to its OWN bank rate, not to 0%", () => {
  const accounts = [acc({ key: "S", type: "Spaarrekening", bank: "ING", balance: 10000 })];
  const r = analyzeInterest(accounts, [], NL_SAVINGS_RATES, "2026-08-01");
  expect(r.suggestions[0].ratePct).toBe(1.25); // ING standard, not 0
  expect(r.suggestions[0].extraPerYearCents).toBe(12500); // 10000 * (3.10-1.25)% = €185
});

test("detectInterestRate: implausible rate (tiny balance vs normal interest) is discarded -> benchmark", () => {
  const tiny = acc({ balance: 2, bank: "ING", type: "Spaarrekening" });
  expect(detectInterestRate(tiny, [rente("2026-06-01", 16.5)], "2026-08-01")).toBeNull(); // ~825% -> null
  expect(resolveAccountRate(tiny, [rente("2026-06-01", 16.5)], "2026-08-01", NL_SAVINGS_RATES)).toEqual({ ratePct: 1.25, source: "benchmark" });
});

/* RATES FROM THREE SOURCES, each rate keeping its own date and provenance.
 *
 * The bundled table shares one RATES_AS_OF across nineteen rows, which was fine
 * while they all came from one scrape. Once a rate can come from a bank's own
 * document — ABN's ladder is stated "vanaf 1 mei 2025", fifteen months old — one
 * shared date presents a stale figure as freshly checked, and the stale one is
 * exactly what a saver should be warned about.
 */
describe("mergeRateSources", () => {
  const cat: RateBenchmark = { bank: "ABN AMRO", product: "Direct Sparen", ratePct: 1.25, freeWithdrawal: true, sourceUrl: "https://abn/fid.pdf", asOf: "2025-05-01" };
  const cmp: RateBenchmark = { bank: "ABN AMRO", product: "Direct Sparen", ratePct: 1.3, freeWithdrawal: true };
  const bun: RateBenchmark = { bank: "ABN AMRO", product: "Direct Sparen", ratePct: 1.25, freeWithdrawal: true };

  test("the bank's own document beats the comparison site", () => {
    const out = mergeRateSources({ rates: [cat], provenance: "catalogue" }, { rates: [cmp], provenance: "comparison" });
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrl).toBe("https://abn/fid.pdf");
    expect(out[0].asOf).toBe("2025-05-01");
  });

  test("the comparison site beats the compiled-in fallback", () => {
    const out = mergeRateSources({ rates: [cmp], provenance: "comparison" }, { rates: [bun], provenance: "bundled" });
    expect(out[0].ratePct).toBe(1.3);
  });

  test("a product only one source knows is KEPT, not dropped", () => {
    // This is why it merges instead of replacing: the catalogue and the scrape
    // cover different ranges, so either replacing the other loses banks.
    const only: RateBenchmark = { bank: "Klarna", product: "Flex rekening", ratePct: 1.95, freeWithdrawal: true };
    const out = mergeRateSources({ rates: [cat], provenance: "catalogue" }, { rates: [cmp, only], provenance: "comparison" });
    expect(out.map((r) => r.bank).sort()).toEqual(["ABN AMRO", "Klarna"]);
  });

  test("two products of the SAME bank are not merged into one", () => {
    // A bank's flexible and fixed accounts pay differently; collapsing them would
    // recommend a rate the saver cannot get on the account they hold.
    const fixed: RateBenchmark = { bank: "ABN AMRO", product: "Depositosparen", ratePct: 2.4, freeWithdrawal: false };
    const out = mergeRateSources({ rates: [cat, fixed], provenance: "catalogue" });
    expect(out).toHaveLength(2);
  });

  test("differently-punctuated names of the same product still merge", () => {
    const messy: RateBenchmark = { bank: "ABN-AMRO", product: "direct sparen", ratePct: 9, freeWithdrawal: true };
    const out = mergeRateSources({ rates: [cat], provenance: "catalogue" }, { rates: [messy], provenance: "comparison" });
    expect(out).toHaveLength(1);
    expect(out[0].ratePct).toBe(1.25);
  });
});

describe("benchmarkFromCatalogue", () => {
  test("the promo is the headline, the standard rate is what ranking rests on", () => {
    const b = benchmarkFromCatalogue({
      bank: "bunq", product: "Spaarrekening", standardPct: 1.5, promoPct: 3.01,
      promoNote: "Actierente t/m 01-01-2027, daarna 1,50%", freeWithdrawal: true,
      sourceUrl: "https://bunq/tarieven", asOf: "2026-08-01",
    });
    expect(b.ratePct).toBe(3.01);
    expect(b.standardRatePct).toBe(1.5);
    expect(b.asOf).toBe("2026-08-01");
  });

  test("with no promo, the headline IS the standard rate and no promo fields appear", () => {
    const b = benchmarkFromCatalogue({ bank: "Triodos", product: "Internet Sparen", standardPct: 1.15, freeWithdrawal: true, sourceUrl: "https://t/x", asOf: "2026-05-01" });
    expect(b.ratePct).toBe(1.15);
    expect(b.standardRatePct).toBeUndefined();
    expect(b.promoNote).toBeUndefined();
  });

  test("UNKNOWN withdrawal is not free — it stays out of bestRate's default pool", () => {
    const b = benchmarkFromCatalogue({ bank: "X", product: "Y", standardPct: 4, freeWithdrawal: null, sourceUrl: "https://x", asOf: "2026-08-01" });
    expect(b.freeWithdrawal).toBe(false);
    expect(bestRate([b])).toBeNull();
  });
});

/* ── ITEM 1: "That ING is 0% that's bullshit, we need to have those." ────────
 *
 * Two separate wires were cut, and only fixing both puts ING's own rate on the
 * screen. Measured against the real strings, not invented ones: the catalogue
 * keys ING as "ING Bank" (issuer "ING Bank N.V."), his import keys the account
 * as bank "ING" with the IBAN as its name.
 */
describe("matching an account to its own bank's rate", () => {
  const cat: RateBenchmark[] = [
    { bank: "ING Bank", product: "Oranje Spaarrekening", ratePct: 1.25, freeWithdrawal: true, sourceUrl: "https://ing/x.pdf", asOf: "2026-01-01" },
    { bank: "ABN AMRO Bank", product: "Direct Sparen", ratePct: 1.25, freeWithdrawal: false, sourceUrl: "https://abn/x.pdf", asOf: "2025-05-01" },
    { bank: "Open Bank", product: "Open Spaarrekening", ratePct: 1.8, freeWithdrawal: true, sourceUrl: "https://ob/x", asOf: "2026-08-01" },
  ];
  const savings = (over: Partial<Account>) => acc({ type: "Spaarrekening", ...over });

  test("bank 'ING' finds the catalogue's 'ING Bank' — the miss behind the 0%", () => {
    // The old guard skipped every name shorter than four characters, so "ING"
    // could only ever match a row spelled exactly "ING". The catalogue spells it
    // "ING Bank", so the only rate we hold for his bank was unreachable.
    const r = resolveAccountRate(savings({ bank: "ING", name: "NL95INGB0674843703" }), [], "2026-08-20", cat);
    expect(r).toEqual({ ratePct: 1.25, source: "benchmark" });
    // The row that answered, so a screen can name the product, its source and its
    // date instead of the bare word "banktarief".
    expect(matchBankBenchmark("ING", cat)?.product).toBe("Oranje Spaarrekening");
  });

  test("a WRONG bank match is worse than the 0% — 'Trading 212' never gets ING's rate", () => {
    // "trading 212" CONTAINS "ing". The containment test it replaces would have
    // paid his Trading 212 balance ING's 1,25%, which is a number about a
    // different bank presented as his.
    expect(resolveAccountRate(savings({ bank: "Trading 212" }), [], "2026-08-20", cat).source).toBe("unknown");
    expect(resolveAccountRate(savings({ bank: "Bigbank" }), [], "2026-08-20", cat).source).toBe("unknown");
  });

  test("matches both directions and ignores punctuation, spacing and accents", () => {
    expect(resolveAccountRate(savings({ bank: "ABN AMRO" }), [], "2026-08-20", cat).ratePct).toBe(1.25);
    expect(resolveAccountRate(savings({ bank: "ABN-Amro Bank N.V." }), [], "2026-08-20", cat).ratePct).toBe(1.25);
    // "Openbank" and "Open Bank" are the same bank written two ways.
    expect(resolveAccountRate(savings({ bank: "Openbank" }), [], "2026-08-20", cat).ratePct).toBe(1.8);
  });

  test("the account's own name picks the product when a bank has several", () => {
    const two: RateBenchmark[] = [
      { bank: "NIBC Bank", product: "Kwartaalspaarrekening", ratePct: 1.6, freeWithdrawal: true },
      { bank: "NIBC Bank", product: "Spaarrekening", ratePct: 1.55, freeWithdrawal: true },
    ];
    expect(matchBankBenchmark("NIBC", two, "NIBC Spaarrekening")?.product).toBe("Spaarrekening");
    expect(resolveAccountRate(savings({ bank: "NIBC", name: "NIBC Spaarrekening" }), [], "2026-08-20", two).ratePct).toBe(1.55);
    // Without a name to go on, the first (best-sourced) row of that bank answers.
    expect(matchBankBenchmark("NIBC", two)?.product).toBe("Kwartaalspaarrekening");
  });

  test("an account we only GUESSED is a betaalrekening still names what its bank pays on savings", () => {
    // His ING savings account arrives from the CSV with the IBAN as its name, so
    // the type heuristic reads it as a payment account and 0% is asserted before
    // any rate is looked up. 0% may be right — but the row has to say that ING
    // pays 1,25% on its savings account and let him decide which one this is,
    // instead of printing a measurement it never made.
    const r = resolveAccountRate(acc({ bank: "ING", name: "NL88INGB0793113504", type: "Betaalrekening" }), [], "2026-08-20", cat);
    expect(r).toEqual({ ratePct: 0, source: "assumed" });
    const savingsAtIng = matchBankBenchmark("ING", cat)!;
    expect(savingsAtIng.product).toBe("Oranje Spaarrekening");
    expect(savingsAtIng.ratePct).toBe(1.25);
    expect(savingsAtIng.asOf).toBe("2026-01-01");
  });

  test("a teaser with no known standard rate is not used as an existing customer's rate", () => {
    const promoOnly: RateBenchmark[] = [
      { bank: "Trade Republic Bank", product: "Kassaldo", ratePct: 3, promo: true, freeWithdrawal: true },
    ];
    // What he keeps at Trade Republic is not established, and 3% is for new
    // customers only. Unknown, not 3%.
    expect(resolveAccountRate(savings({ bank: "Trade Republic" }), [], "2026-08-20", promoOnly).source).toBe("unknown");
    expect(matchBankBenchmark("Trade Republic", promoOnly)).toBeNull();
  });
});

/* ── ITEM 9: promos — rank on what you keep, SHOW what you can get now ─────── */
describe("promos are shown as well as ranked past", () => {
  const pool: RateBenchmark[] = [
    { bank: "Bigbank", product: "Flexibel Sparen", ratePct: 3.1, standardRatePct: 2.1, promo: true, promoNote: "Actierente 6 mnd, daarna 2,10%", freeWithdrawal: true },
    { bank: "Scalable Capital", product: "Cash", ratePct: 2.5, freeWithdrawal: true },
    { bank: "Trade Republic", product: "Kassaldo", ratePct: 3, promo: true, freeWithdrawal: true },
  ];

  test("what you KEEP is unknown for a teaser whose standard rate nobody stated", () => {
    expect(keptRate(pool[1])).toBe(2.5);
    expect(keptRate(pool[0])).toBe(2.1);
    expect(keptRate(pool[2])).toBeNull(); // not 3, and not 0
  });

  test("a promo whose standard rate is unknown cannot win the ranking", () => {
    expect(bestRate(pool)!.bank).toBe("Scalable Capital");
  });

  test("bestPromoRate names what you could get NOW, when it beats what you'd keep", () => {
    const promo = bestPromoRate(pool)!;
    expect(promo.bank).toBe("Bigbank");
    expect(promo.ratePct).toBe(3.1);
    // Nothing to show when no headline beats the best kept rate.
    expect(bestPromoRate([pool[1]])).toBeNull();
  });

  test("analyzeInterest prices the promo per MONTH and keeps the yearly figure on what you keep", () => {
    // "for a user who doesn't have bunq, if they can use the promo for a month
    // it's still a month of 3,01% over the 2,5% of Scalable Capital."
    const accounts = [acc({ key: "B", type: "Betaalrekening", balance: 50000 })];
    const r = analyzeInterest(accounts, [], pool, "2026-08-20");
    expect(r.best!.bank).toBe("Scalable Capital");
    expect(r.suggestions[0].extraPerYearCents).toBe(125000); // € 50.000 × 2,5% = € 1.250 — the rate he keeps
    expect(r.bestPromo!.bank).toBe("Bigbank");
    // € 50.000 × (3,10 − 2,50)% ÷ 12 = € 25,00 for the month the action runs.
    expect(r.promoExtraPerMonthCents).toBe(2500);
  });

  test("no promo anywhere means no promo figure — not a zero-euro promise", () => {
    const r = analyzeInterest([acc({ type: "Betaalrekening", balance: 50000 })], [], [pool[1]], "2026-08-20");
    expect(r.bestPromo).toBeNull();
    expect(r.promoExtraPerMonthCents).toBe(0);
  });
});

/* SHOWN, FLAGGED, NEVER RANKED.
 *
 * Wise Rente and N26's flexible cash fund are money-market funds quoted as
 * "rates": investments that can lose capital, net of a management fee, settling in
 * up to two days. They were skipped entirely. He asked for them shown "but with an
 * asterisk" — which is better, because a 2,32% fund is a real option and hiding it
 * is its own dishonesty. What it must never be is the automatic recommendation.
 */
describe("capitalAtRisk", () => {
  const fund: RateBenchmark = { bank: "N26", product: "flexible cash fund", ratePct: 2.32, freeWithdrawal: true, capitalAtRisk: true };
  const deposit: RateBenchmark = { bank: "Scalable Capital", product: "Overnight", ratePct: 2.5, freeWithdrawal: true };

  test("a fund never wins bestRate, even paying more than every deposit", () => {
    const rich: RateBenchmark = { ...fund, ratePct: 9 };
    expect(bestRate([rich, deposit])!.bank).toBe("Scalable Capital");
  });

  test("a fund never wins the promo line either", () => {
    // A promo on a capital-at-risk fund is still "move your cash somewhere it can
    // be lost", which is not what the promo line is for.
    const promoFund: RateBenchmark = { ...fund, ratePct: 9, standardRatePct: 1, promoNote: "6 mnd" };
    // bestPromoRate takes (rates, freeOnly) and compares against the best KEPT
    // rate itself; with the fund excluded, the only promo left is none.
    expect(bestPromoRate([promoFund, deposit])).toBeNull();
  });

  test("but it is still in the list, so the UI can show it with its asterisk", () => {
    const rows = mergeRateSources({ rates: [fund, deposit], provenance: "catalogue" });
    expect(rows.map((r) => r.bank).sort()).toEqual(["N26", "Scalable Capital"]);
    expect(rows.find((r) => r.bank === "N26")!.capitalAtRisk).toBe(true);
  });

  test("analyzeInterest does not quantify a gain against a fund", () => {
    const accounts = [acc({ key: "B", type: "Betaalrekening", balance: 20000 })];
    const r = analyzeInterest(accounts, [], [{ ...fund, ratePct: 9 }], "2026-08-01");
    expect(r.best).toBeNull();
    expect(r.suggestions).toHaveLength(0);
  });
});
