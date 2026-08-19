import { describe, expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { bestRate, keptRate, detectInterestRate, resolveAccountRate, analyzeInterest, NL_SAVINGS_RATES, mergeRateSources, benchmarkFromCatalogue, type RateBenchmark } from "./interest.js";

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
