import { describe, expect, test } from "vitest";
import type { CatalogueEntryLike } from "../catalogRates.js";
import type { RateBenchmark } from "../interest.js";
import { makeRewardsBalance } from "../rewards.js";
import {
  CARD_ADVICE_MIN_GAIN_CENTS,
  computeCardAdvice,
  programForCard,
  type CardAdviceInput,
} from "./cardAdvice.js";
import { emptyPlanPreferences } from "./preferences.js";
import catalog from "../../../../docs/catalog/catalog.json";
import { FEE_CONDITIONS } from "./cardAdvice.js";

const cv = (value: number, extra: Record<string, unknown> = {}) => ({
  value,
  route: "provider-page" as const,
  sourceUrl: "https://example.test/src",
  checkedAt: "2026-08-20",
  conditions: null,
  conditionsKnown: true,
  ...extra,
});
const entry = (
  id: string,
  o: {
    fee?: [number, "maand" | "jaar"];
    fx?: number;
    ppe?: number;
    cb?: number;
    uncoveredFx?: boolean;
  },
): CatalogueEntryLike => ({
  id,
  product: id.toUpperCase(),
  kind: "creditcard",
  fields: {
    ...(o.fee === undefined ? {} : { accountFee: cv(o.fee[0], { period: o.fee[1] }) }),
    ...(o.fx === undefined
      ? {}
      : { fxFeePct: cv(o.fx, o.uncoveredFx ? { conditionsKnown: false } : {}) }),
    ...(o.ppe === undefined ? {} : { pointsPerEuro: cv(o.ppe) }),
    ...(o.cb === undefined ? {} : { cashbackPct: cv(o.cb) }),
  } as CatalogueEntryLike["fields"],
});

// 6 months, EUR 6.000 cardable (= EUR 12.000 a year), EUR 600 of it foreign (= EUR 1.200 a year)
const SPEND = { windowCents: 600_000, months: 6, foreignCents: 60_000, excludedForeignCount: 0 };

const CAT: CatalogueEntryLike[] = [
  entry("free-card", { fee: [0, "jaar"], fx: 2, ppe: 0 }), // net = -24
  entry("cheap-card", { fee: [30, "jaar"], fx: 0, ppe: 0 }), // net = -30
  entry("american-express-gold-card", { fee: [20, "maand"], fx: 2.5, ppe: 1 }), // fee 240, fx 30, points 12000
  entry("cashback-card", { fee: [0, "jaar"], fx: 2, ppe: 0, cb: 1 }), // cashback 120, fx 24 => +96
  entry("no-fee-field", { fx: 2, ppe: 0 }),
  entry("no-fx", { fee: [0, "jaar"], ppe: 0 }),
  entry("shaky-fx", { fee: [0, "jaar"], fx: 1, ppe: 0, uncoveredFx: true }),
  entry("no-points", { fee: [0, "jaar"], fx: 0 }),
  entry("ics-visa-world-card-business", { fee: [0, "jaar"], fx: 0, ppe: 0, cb: 9 }),
  { id: "ing-betaalpas", product: "ING betaalpas", kind: "betaalpas", fields: {} },
];

const input = (o: Partial<CardAdviceInput> = {}): CardAdviceInput => ({
  spend: SPEND,
  catalogue: CAT,
  heldIds: [],
  hasOtherCard: false,
  cardBalances: [],
  rewards: [],
  preferences: emptyPlanPreferences(),
  rates: [],
  buffer: null,
  asOf: "2026-10-27",
  ...o,
});
const find = (a: ReturnType<typeof computeCardAdvice>, id: string) =>
  [...a.options, ...a.notComparable].find((x) => x.cardId === id);

describe("net yearly value per catalogue card", () => {
  test("annualises the window, then net = points + cashback - fee - fx cost", () => {
    const a = computeCardAdvice(input());
    expect(a.state).toBe("ok");
    expect(a.spend.annualCents).toBe(1_200_000);
    expect(a.spend.annualForeignCents).toBe(120_000);
    expect(find(a, "free-card")).toMatchObject({ feeCents: 0, fxCostCents: 2_400, netCents: -2_400 });
    expect(find(a, "cheap-card")).toMatchObject({
      feeCents: 3_000,
      fxCostCents: 0,
      netCents: -3_000,
    });
    expect(find(a, "cashback-card")).toMatchObject({
      cashbackCents: 12_000,
      netCents: 12_000 - 2_400,
    });
  });

  test("a monthly fee is multiplied to a year", () => {
    const o = find(computeCardAdvice(input()), "american-express-gold-card")!;
    expect(o.feeCents).toBe(24_000);
    expect(o.fxCostCents).toBe(3_000);
  });

  test("points use the published reference value only for a programme that has one", () => {
    const o = find(computeCardAdvice(input()), "american-express-gold-card")!;
    expect(o.pointsEarned).toBe(12_000);
    expect(o.pointsValueCents).toBe(3_600); // 12.000 x 0,3 cent
    expect(o.pointsUnvalued).toBe(false);
    expect(o.netCents).toBe(3_600 - 24_000 - 3_000);
    expect(o.sources.map((s) => s.field).sort()).toEqual(["fee", "fx", "pointValue", "points"]);
    expect(o.sources.every((s) => s.sourceUrl !== null && s.asOf !== null)).toBe(true);
  });

  test("the user's own redemption examples outrank the reference value", () => {
    const preferences = {
      ...emptyPlanPreferences(),
      redemptionExamples: [
        {
          id: "e1",
          programId: "american express membership rewards",
          pointsSpent: 10_000,
          cashPriceSavedCents: 8_000,
          at: "2026-10-01",
        },
      ],
    };
    const o = find(computeCardAdvice(input({ preferences })), "american-express-gold-card")!;
    expect(o.pointsValueCents).toBe(9_600); // 0,8 cent per point
  });

  test("points without any known value stay comparable but are not valued", () => {
    const cat = [
      entry("flying-blue-american-express-gold-card", { fee: [10, "jaar"], fx: 0, ppe: 1 }),
    ];
    const o = computeCardAdvice(input({ catalogue: cat })).options[0]!;
    expect(o.pointsUnvalued).toBe(true);
    expect(o.pointsValueCents).toBeNull();
    expect(o.netCents).toBe(-1_000);
  });

  test("unknown catalogue values are never guessed: the card is listed with the reason", () => {
    const a = computeCardAdvice(input());
    expect(find(a, "no-fee-field")).toMatchObject({
      comparable: false,
      reasons: ["fee-unknown"],
      netCents: null,
    });
    expect(find(a, "no-fx")).toMatchObject({ comparable: false, reasons: ["fx-unknown"] });
    expect(find(a, "shaky-fx")).toMatchObject({ comparable: false, reasons: ["fx-unknown"] });
    expect(find(a, "no-points")).toMatchObject({ comparable: false, reasons: ["points-unknown"] });
    expect(a.options.map((o) => o.cardId)).not.toContain("no-fee-field");
  });

  test("the fx surcharge is only needed when the user has foreign spend", () => {
    const a = computeCardAdvice(input({ spend: { ...SPEND, foreignCents: 0 } }));
    expect(find(a, "no-fx")).toMatchObject({ comparable: true, fxCostCents: null, netCents: 0 });
  });

  test("business cards and non-credit rows are not in the universe", () => {
    const a = computeCardAdvice(input());
    expect(find(a, "ics-visa-world-card-business")).toBeUndefined();
    expect(find(a, "ing-betaalpas")).toBeUndefined();
  });

  test("ranked by net, best first; ties by name", () => {
    const a = computeCardAdvice(input());
    expect(a.options.map((o) => o.cardId)).toEqual([
      "cashback-card",
      "free-card",
      "cheap-card",
      "american-express-gold-card",
    ]);
  });

  test("under three full months or without spend nothing is computed", () => {
    expect(computeCardAdvice(input({ spend: { ...SPEND, months: 2 } })).state).toBe(
      "short-history",
    );
    expect(
      computeCardAdvice(input({ spend: { ...SPEND, windowCents: 0, foreignCents: 0 } })).state,
    ).toBe("no-spend");
    expect(computeCardAdvice(input({ spend: { ...SPEND, months: 2 } })).options).toEqual([]);
  });
});

describe("verdict against the current cards", () => {
  test("a held card that is not the best: recommend the best with the euro gain", () => {
    const a = computeCardAdvice(input({ heldIds: ["american-express-gold-card"] }));
    expect(a.baseline).toMatchObject({ kind: "best-held", cardId: "american-express-gold-card" });
    expect(a.verdict).toMatchObject({
      kind: "switch",
      gainCents: 12_000 - 2_400 - (3_600 - 24_000 - 3_000),
    });
    expect(a.verdict.kind === "switch" && a.verdict.best.cardId).toBe("cashback-card");
  });

  test("keep when the held card is the best", () => {
    const a = computeCardAdvice(input({ heldIds: ["cashback-card"] }));
    expect(a.verdict).toMatchObject({ kind: "keep", gainCents: 0 });
  });

  test("keep when the gain is below the threshold", () => {
    const cat = [
      entry("held", { fee: [100, "jaar"], fx: 0, ppe: 0 }),
      entry("other", {
        fee: [100 - (CARD_ADVICE_MIN_GAIN_CENTS - 1) / 100, "jaar"],
        fx: 0,
        ppe: 0,
      }),
    ];
    const a = computeCardAdvice(input({ catalogue: cat, heldIds: ["held"] }));
    expect(a.verdict.kind).toBe("keep");
  });

  test("no card held: the baseline is zero; recommend only when a card nets enough", () => {
    expect(computeCardAdvice(input()).baseline).toEqual({ kind: "no-card", netCents: 0 });
    expect(computeCardAdvice(input()).verdict).toMatchObject({ kind: "switch", gainCents: 9_600 });
    const none = computeCardAdvice(input({ catalogue: CAT.filter((e) => e.id !== "cashback-card") }));
    expect(none.verdict).toEqual({ kind: "no-card-worth-it" });
  });

  test("held cards that cannot be compared leave the baseline unknown, with the options still ranked", () => {
    const a = computeCardAdvice(input({ heldIds: ["no-fee-field"] }));
    expect(a.baseline).toEqual({
      kind: "unknown",
      blockers: [{ name: "NO-FEE-FIELD", reasons: ["fee-unknown"] }],
    });
    expect(a.verdict).toEqual({ kind: "unknown-baseline" });
    expect(a.options.length).toBeGreaterThan(0);
    expect(computeCardAdvice(input({ hasOtherCard: true })).baseline).toEqual({
      kind: "unknown",
      blockers: [{ name: null, reasons: ["not-in-catalogue"] }],
    });
  });

  test("a debit card found in the bank data is not a held credit card", () => {
    const a = computeCardAdvice(input({ heldIds: ["ing-betaalpas"] }));
    expect(a.baseline).toEqual({ kind: "no-card", netCents: 0 });
  });

  test("held flag is set on the held row", () => {
    const a = computeCardAdvice(input({ heldIds: ["cheap-card"] }));
    expect(a.options.find((o) => o.cardId === "cheap-card")!.held).toBe(true);
  });
});

const RATE: RateBenchmark = {
  bank: "Testbank",
  product: "Spaar",
  ratePct: 2,
  freeWithdrawal: true,
  asOf: "2026-10-01",
  sourceUrl: "https://example.test/rate",
};
const BUF = { liquidSavingsCents: 1_000_000, fixedCostsMonthlyCents: 200_000, targetMonths: 3 }; // surplus 400.000

describe("interest on a revolving balance", () => {
  const bal = (balanceCents: number, ratePct?: number, paysInFull = false) => [
    {
      cardId: "american-express-gold-card",
      balanceCents,
      paysInFull,
      ...(ratePct === undefined ? {} : { ratePct }),
    },
  ];

  test("paid in full or empty: no interest advice", () => {
    expect(computeCardAdvice(input({ cardBalances: bal(100_000, 15, true) })).interest).toEqual([]);
    expect(computeCardAdvice(input({ cardBalances: bal(0, 15) })).interest).toEqual([]);
  });

  test("surplus covers the balance: pay off all, net of the savings interest given up", () => {
    const [x] = computeCardAdvice(
      input({ cardBalances: bal(300_000, 15), buffer: BUF, rates: [RATE] }),
    ).interest;
    expect(x).toMatchObject({
      yearlyInterestCents: 45_000,
      surplusCents: 400_000,
      payoffCents: 300_000,
      remainingCents: 0,
      interestSavedCents: 45_000,
      forgoneSavingsCents: 6_000,
      netSavingCents: 39_000,
      recommendation: "payoff-all",
    });
    expect(x!.savingsRate).toMatchObject({
      ratePct: 2,
      bank: "Testbank",
      sourceUrl: "https://example.test/rate",
    });
  });

  test("surplus smaller than the balance: pay off part, move the rest", () => {
    const [x] = computeCardAdvice(
      input({ cardBalances: bal(500_000, 15), buffer: BUF, rates: [RATE] }),
    ).interest;
    expect(x).toMatchObject({
      payoffCents: 400_000,
      remainingCents: 100_000,
      recommendation: "payoff-partial",
    });
  });

  test("no room above the buffer: move to cheaper credit", () => {
    const poor = { ...BUF, liquidSavingsCents: 500_000 };
    const [x] = computeCardAdvice(
      input({ cardBalances: bal(300_000, 15), buffer: poor, rates: [RATE] }),
    ).interest;
    expect(x).toMatchObject({
      surplusCents: -100_000,
      payoffCents: 0,
      recommendation: "move-credit",
    });
  });

  test("unknown buffer: no payoff is invented", () => {
    const [x] = computeCardAdvice(input({ cardBalances: bal(300_000, 15), buffer: null })).interest;
    expect(x).toMatchObject({ surplusCents: null, payoffCents: 0, recommendation: "unknown-buffer" });
  });

  test("no rate: never guessed; the cost of one percentage point is shown", () => {
    const [x] = computeCardAdvice(input({ cardBalances: bal(300_000), buffer: BUF })).interest;
    expect(x).toMatchObject({
      ratePct: null,
      yearlyInterestCents: null,
      perPointCents: 3_000,
      recommendation: "enter-rate",
    });
  });

  test("a rate at or below the savings rate keeps the balance", () => {
    const [x] = computeCardAdvice(
      input({ cardBalances: bal(300_000, 1.5), buffer: BUF, rates: [RATE] }),
    ).interest;
    expect(x!.recommendation).toBe("keep-balance");
  });

  test("a rate equal to the savings rate gains nothing: keep the balance, but just above it pays off", () => {
    const at = (r: number) =>
      computeCardAdvice(input({ cardBalances: bal(300_000, r), buffer: BUF, rates: [RATE] }))
        .interest[0]!.recommendation;
    expect(at(2)).toBe("keep-balance");
    expect(at(2.1)).toBe("payoff-all");
  });

  test("the card name comes from the catalogue when it is there", () => {
    const [x] = computeCardAdvice(input({ cardBalances: bal(1_000, 10) })).interest;
    expect(x!.name).toBe("AMERICAN-EXPRESS-GOLD-CARD");
    const other = computeCardAdvice(
      input({ cardBalances: [{ cardId: "other", balanceCents: 1_000, paysInFull: false }] }),
    ).interest[0]!;
    expect(other.name).toBeNull();
  });
});

describe("points balances", () => {
  const rw = (points: number) =>
    makeRewardsBalance({
      program: "American Express Membership Rewards",
      points,
      updatedAt: "2026-10-20",
    });

  test("value from the published reference; expiry only from the user's own date", () => {
    const preferences = {
      ...emptyPlanPreferences(),
      pointsExpiry: { "american express membership rewards": "2026-12-01" },
    };
    const [p] = computeCardAdvice(input({ rewards: [rw(50_000)], preferences })).points;
    expect(p).toMatchObject({ points: 50_000, expiresOn: "2026-12-01", expiresSoon: true });
    expect(p!.valueCents).toEqual({ lowCents: 15_000, medianCents: 15_000, highCents: 15_000 });
    expect(p!.valuation).toMatchObject({ basis: "reference", asOf: "2026-08-21" });
  });

  test("a programme without any known value has no value, not zero; no expiry is null", () => {
    const r = makeRewardsBalance({
      program: "Miles & More (Lufthansa)",
      points: 9_000,
      updatedAt: "2026-10-20",
    });
    const [p] = computeCardAdvice(input({ rewards: [r] })).points;
    expect(p).toMatchObject({ valuation: null, valueCents: null, expiresOn: null, expiresSoon: false });
  });

  test("own examples give a low-median-high range", () => {
    const preferences = {
      ...emptyPlanPreferences(),
      redemptionExamples: [
        {
          id: "a",
          programId: "american express membership rewards",
          pointsSpent: 1_000,
          cashPriceSavedCents: 200,
          at: "2026-10-01",
        },
        {
          id: "b",
          programId: "american express membership rewards",
          pointsSpent: 1_000,
          cashPriceSavedCents: 600,
          at: "2026-10-01",
        },
      ],
    };
    const [p] = computeCardAdvice(input({ rewards: [rw(10_000)], preferences })).points;
    expect(p!.valueCents).toEqual({ lowCents: 2_000, medianCents: 4_000, highCents: 6_000 });
    expect(p!.valuation).toMatchObject({ basis: "own-examples", examples: 2 });
  });
});

test("programForCard knows consumer Amex programmes only", () => {
  expect(programForCard("american-express-gold-card")).toBe("American Express Membership Rewards");
  expect(programForCard("flying-blue-american-express-gold-card")).toBe(
    "Flying Blue (KLM/Air France)",
  );
  expect(programForCard("american-express-business-gold-card")).toBeNull();
  expect(programForCard("abn-amro-creditcard")).toBeNull();
});

describe("review fixes", () => {
  const bal = (cardId: string, balanceCents: number, ratePct: number) => ({
    cardId,
    balanceCents,
    paysInFull: false,
    ratePct,
  });

  test("M1: the savings above the buffer are spent once, highest rate first", () => {
    const buffer = { liquidSavingsCents: 1_000_000, fixedCostsMonthlyCents: 100_000, targetMonths: 3 }; // surplus 700.000
    const a = computeCardAdvice(
      input({
        cardBalances: [bal("cheap-card", 500_000, 14), bal("free-card", 500_000, 15)],
        buffer,
        rates: [RATE],
      }),
    );
    const byId = Object.fromEntries(a.interest.map((x) => [x.cardId, x]));
    expect(byId["free-card"]).toMatchObject({
      availableCents: 700_000,
      payoffCents: 500_000,
      remainingCents: 0,
      recommendation: "payoff-all",
    });
    expect(byId["cheap-card"]).toMatchObject({
      availableCents: 200_000,
      payoffCents: 200_000,
      remainingCents: 300_000,
      recommendation: "payoff-partial",
    });
    expect(a.interest.reduce((n, x) => n + x.payoffCents, 0)).toBeLessThanOrEqual(700_000);
    expect(a.interest.map((x) => x.cardId)).toEqual(["free-card", "cheap-card"]);
  });

  test("M1: a card at or below the savings rate and a card without a rate take none of the pot", () => {
    const buffer = { liquidSavingsCents: 1_000_000, fixedCostsMonthlyCents: 100_000, targetMonths: 3 };
    const a = computeCardAdvice(
      input({
        cardBalances: [
          bal("cheap-card", 500_000, 1),
          { cardId: "free-card", balanceCents: 500_000, paysInFull: false },
          bal("american-express-gold-card", 600_000, 15),
        ],
        buffer,
        rates: [RATE],
      }),
    );
    const byId = Object.fromEntries(a.interest.map((x) => [x.cardId, x]));
    expect(byId["american-express-gold-card"]!.payoffCents).toBe(600_000);
    expect(byId["cheap-card"]).toMatchObject({ payoffCents: 0, recommendation: "keep-balance" });
    expect(byId["free-card"]).toMatchObject({ payoffCents: 0, recommendation: "enter-rate" });
  });

  test("M2: fixed costs of zero or missing mean the buffer is unknown: no pay-off advice", () => {
    for (const fixed of [0, null]) {
      const [x] = computeCardAdvice(
        input({
          cardBalances: [bal("free-card", 300_000, 15)],
          buffer: { liquidSavingsCents: 300_000, fixedCostsMonthlyCents: fixed, targetMonths: 6 },
          rates: [RATE],
        }),
      ).interest;
      expect(x).toMatchObject({ surplusCents: null, payoffCents: 0, recommendation: "unknown-buffer" });
    }
  });

  test("M3: a held card whose points cannot be valued is not compared, and nothing is recommended against it", () => {
    const cat = [
      entry("flying-blue-american-express-gold-card", { fee: [198, "jaar"], fx: 0, ppe: 1 }),
      entry("free-card", { fee: [0, "jaar"], fx: 0, ppe: 0 }),
    ];
    const a = computeCardAdvice(
      input({ catalogue: cat, heldIds: ["flying-blue-american-express-gold-card"] }),
    );
    const held = a.notComparable.find((o) => o.cardId === "flying-blue-american-express-gold-card");
    expect(held).toMatchObject({ comparable: false, reasons: ["points-unvalued"], netCents: null });
    expect(a.baseline).toEqual({
      kind: "unknown",
      blockers: [
        { name: "FLYING-BLUE-AMERICAN-EXPRESS-GOLD-CARD", reasons: ["points-unvalued"] },
      ],
    });
    expect(a.verdict).toEqual({ kind: "unknown-baseline" });
  });

  test("M3: with one held card comparable and another not, there is still no baseline", () => {
    const a = computeCardAdvice(input({ heldIds: ["cheap-card", "no-fee-field"] }));
    expect(a.baseline.kind).toBe("unknown");
    expect(a.verdict.kind).toBe("unknown-baseline");
  });

  test("M4: a minimum-spend fee is applied from the user's own spend", () => {
    const cat = [
      { ...entry("american-express-blue-card", { fee: [0, "jaar"], fx: 0, ppe: 0 }) },
      entry("knab-like", { fee: [28, "jaar"], fx: 0, ppe: 0 }),
    ];
    const low = computeCardAdvice(
      input({ catalogue: cat, spend: { ...SPEND, windowCents: 120_000, foreignCents: 0 } }),
    ); // EUR 2.400 a year, under EUR 3.000
    const blue = low.options.find((o) => o.cardId === "american-express-blue-card")!;
    expect(blue.feeCents).toBe(3_500);
    expect(blue.feeNote).toEqual({ kind: "min-spend", thresholdCents: 300_000, otherwiseCents: 3_500, met: false });
    expect(low.options[0]!.cardId).toBe("knab-like"); // EUR 28 beats EUR 35
    const high = computeCardAdvice(
      input({ catalogue: cat, spend: { ...SPEND, windowCents: 150_000, foreignCents: 0 } }),
    ); // EUR 3.000 a year exactly
    expect(high.options.find((o) => o.cardId === "american-express-blue-card")).toMatchObject({
      feeCents: 0,
      feeNote: { met: true },
    });
  });

  test("M4: a package the card needs is added for a card the user does not hold, not for one he holds", () => {
    const cat = [entry("rabobank-creditcard", { fee: [2, "maand"], fx: 0, ppe: 0 })];
    const notHeld = computeCardAdvice(input({ catalogue: cat })).options[0]!;
    expect(notHeld.feeCents).toBe(2_400 + 4_140);
    expect(notHeld.feeNote).toEqual({ kind: "package", name: "Rabo Standaard", yearlyCents: 4_140, applied: true });
    const held = computeCardAdvice(input({ catalogue: cat, heldIds: ["rabobank-creditcard"] })).options[0]!;
    expect(held.feeCents).toBe(2_400);
    expect(held.feeNote).toMatchObject({ applied: false });
  });

  test("M4: a fee that depends on something the catalogue does not price is not comparable", () => {
    const cat = [entry("anwb-visa-gold-card", { fee: [52, "jaar"], fx: 0, ppe: 0 })];
    const a = computeCardAdvice(input({ catalogue: cat }));
    expect(a.options).toEqual([]);
    expect(a.notComparable[0]).toMatchObject({
      reasons: ["fee-condition-unknown"],
      feeNote: { kind: "unknown", why: "anwb-membership" },
    });
  });

  test("S3: carrying a balance is flagged so the screen can say the comparison ignores card interest", () => {
    expect(computeCardAdvice(input()).ignoresInterest).toBe(false);
    expect(
      computeCardAdvice(input({ cardBalances: [bal("free-card", 100_000, 10)] })).ignoresInterest,
    ).toBe(true);
  });
});

describe("real catalogue", () => {
  type Raw = { id: string; kind: string; fields?: { accountFee?: { conditions?: string | null } } };
  const entries = (catalog as unknown as { entries: CatalogueEntryLike[] }).entries;

  test("golden: the evidence example (Amex Blue +41,08, Gold -157,84) and the switch verdict", () => {
    // EUR 13.692,40 over 6 full months, all in euro: EUR 27.384,80 a year.
    const a = computeCardAdvice(
      input({
        catalogue: entries,
        spend: { windowCents: 1_369_240, months: 6, foreignCents: 0, excludedForeignCount: 0 },
        heldIds: ["american-express-gold-card"],
      }),
    );
    const blue = a.options.find((o) => o.cardId === "american-express-blue-card")!;
    const gold = a.options.find((o) => o.cardId === "american-express-gold-card")!;
    expect(blue.netCents).toBe(4_108);
    expect(gold.netCents).toBe(-15_784);
    expect(blue.feeNote).toMatchObject({ kind: "min-spend", met: true });
    expect(a.verdict).toMatchObject({ kind: "switch", gainCents: 19_892 });
    expect(a.verdict.kind === "switch" && a.verdict.best.cardId).toBe("american-express-blue-card");
  });

  test("golden: the same user spending EUR 2.400 a year no longer gets Blue for free", () => {
    const a = computeCardAdvice(
      input({
        catalogue: entries,
        spend: { windowCents: 120_000, months: 6, foreignCents: 0, excludedForeignCount: 0 },
      }),
    );
    expect(a.options.find((o) => o.cardId === "american-express-blue-card")!.feeCents).toBe(3_500);
  });

  test("every consumer card whose fee text carries a condition is in FEE_CONDITIONS", () => {
    const CLAUSE =
      /minimale besteding|bovenop de|alleen binnen|alleen aan te vragen|prijs geldt bij|exclusief de kosten|tarief bij/i;
    const missing = (entries as unknown as Raw[])
      .filter((e) => e.kind === "creditcard" && !/business|corporate/.test(e.id))
      .filter((e) => CLAUSE.test(e.fields?.accountFee?.conditions ?? ""))
      .map((e) => e.id)
      .filter((id) => FEE_CONDITIONS[id] === undefined);
    expect(missing).toEqual([]);
  });

  test("every FEE_CONDITIONS id exists in the catalogue", () => {
    const ids = new Set(entries.map((e) => e.id));
    expect(Object.keys(FEE_CONDITIONS).filter((id) => !ids.has(id))).toEqual([]);
  });
});
