import { describe, expect, test } from "vitest";
import type { ProductFee } from "../accountCosts.js";
import type { HeldCashback } from "../assumedCashback.js";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import type { Account, Tx } from "../model.js";
import { makeRewardsBalance } from "../rewards.js";
import cardCases from "./__fixtures__/cardCases.json";
import { CARDS_CALC_IDS, computeCards, netForCard } from "./cards.js";
import { buildFactSheet } from "./factsheet.js";
import { emptyPlanPreferences } from "./preferences.js";
import { AS_OF, planInput } from "./testkit.js";
import type { PlanProfile } from "./profileView.js";
import type { HeldCardInput, PlanInput } from "./types.js";

const MONTHS = [
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
];
const acct = (key: string, o: Partial<Account> = {}) =>
  mkAccount(key, { balance: 0, balanceDate: "2026-10-20", ...o });

/** One spend per month on the account, `perMonthCents` each, 12 full months. */
const spendOn = (
  key: string,
  perMonthCents: number,
  o: Partial<Tx> = {},
): Tx[] =>
  MONTHS.flatMap((m) => [
    mkTx("Start", `${m}-01`, 1, { accountKey: key, category: "Salaris" }),
    mkTx("Shop", `${m}-15`, -perMonthCents / 100, {
      accountKey: key,
      category: "Boodschappen",
      ...o,
    }),
  ]);

const fee = (
  centsPerYear: number,
  billedPer: "jaar" | "maand" = "jaar",
): ProductFee =>
  ({
    productId: "p",
    product: "Kaart",
    issuer: "Bank",
    kind: "creditcard",
    group: "creditcard",
    amount:
      billedPer === "jaar"
        ? {
            cents: centsPerYear,
            period: "jaar",
            perYearCents: centsPerYear,
            perYearDerived: false,
          }
        : {
            cents: centsPerYear / 12,
            period: "maand",
            perYearCents: centsPerYear,
            perYearDerived: true,
          },
    conditions: null,
    openToNewCustomers: true,
    pricedOnItsOwn: true,
    route: null,
    sourceUrl: "https://example.test/tarieven",
    asOf: "2026-01-15",
  }) as ProductFee;

const PROV = {
  fxFeePct: { asOf: "2026-08-01", sourceUrl: "https://example.test/fx" },
  pointsPerEuro: { asOf: "2026-08-02", sourceUrl: null },
};

const measured = (pct: number): HeldCashback => ({
  tier: "gemeten",
  pct,
  source: "user",
  updatedAt: "2026-09-01",
});
const unknownCb: HeldCashback = { tier: "onbekend", reason: "soort-onbekend" };
const assumed0: HeldCashback = {
  tier: "aangenomen",
  pct: 0,
  issuerFamily: "ING",
  kind: "betaalpas" as never,
  lastCheckedAt: null,
};

const card = (key: string, o: Partial<HeldCardInput> = {}): HeldCardInput => ({
  accountKey: key,
  label: key,
  cashback: measured(1),
  fee: fee(0),
  fxFeePct: null,
  pointsPerEuro: null,
  programId: null,
  ...o,
});

const run = (over: Partial<PlanInput> & { cards?: HeldCardInput[] } = {}) => {
  const { cards = [], ...rest } = over;
  const accounts = rest.accounts ?? cards.map((c) => acct(c.accountKey));
  return computeCards(planInput({ accounts, heldCards: cards, ...rest }));
};

describe("netForCard", () => {
  test("net = spend*pct - fee over 12 months: 600_000 at 1% fee 0 -> 6000; fee 5000/yr -> 1000", () => {
    const free = netForCard(card("A", { cashback: measured(1) }), 600_000, 12);
    expect(free.earnedCents).toBe(6000);
    expect(free.net).toMatchObject({ kind: "net", netCents: 6000 });
    const paid = netForCard(card("A", { fee: fee(5000) }), 600_000, 12);
    expect(paid.net).toMatchObject({ kind: "net", netCents: 1000 });
    expect(paid.feeShareCents).toBe(5000);
    expect(paid.netCents).toBe(1000);
  });

  test("cashback unknown -> net unknown (no netCents), never 0; assumed 0% -> shown as assumed, net = minus the fee", () => {
    const u = netForCard(
      card("A", { cashback: unknownCb, fee: fee(5000) }),
      600_000,
      12,
    );
    expect(u.net).toBeNull();
    expect(u.netCents).toBeNull();
    expect(u.earnedCents).toBeNull();
    expect(u.cashbackTier).toBe("unknown");
    const a = netForCard(
      card("A", { cashback: assumed0, fee: fee(5000) }),
      600_000,
      12,
    );
    expect(a.cashbackTier).toBe("assumed");
    expect(a.earnedCents).toBe(0);
    expect(a.net).toMatchObject({ kind: "no-recommendation", netCents: -5000 });
    const off = netForCard(
      card("A", { cashback: { tier: "uitgezet" } }),
      600_000,
      12,
    );
    expect(off.cashbackTier).toBe("unknown");
    expect(off.netCents).toBeNull();
  });

  test("under a year the fee is prorated round(perYear * months / 12): 1100 x 7/12 = 641.67 -> 642", () => {
    const n = netForCard(card("A", { fee: fee(1100) }), 100_000, 7);
    expect(n.earnedCents).toBe(1000);
    expect(n.feeShareCents).toBe(642);
    expect(n.netCents).toBe(1000 - 642);
    const full = netForCard(card("A", { fee: fee(1100) }), 100_000, 12);
    expect(full.feeShareCents).toBe(1100);
  });

  test("unknown fee: gross only, no netCents, never a free card", () => {
    const n = netForCard(card("A", { fee: null }), 600_000, 12);
    expect(n.net).toMatchObject({
      kind: "gross-cost-unknown",
      grossCents: 6000,
    });
    expect(n.earnedCents).toBe(6000);
    expect(n.feeShareCents).toBeNull();
    expect(n.netCents).toBeNull();
  });

  test("shared fixture: netForCard agrees with the fixture's expected value for each case", () => {
    for (const c of cardCases.cases) {
      const n = netForCard(
        card("A", {
          cashback: measured(c.cashbackPct),
          fee: fee(
            c.feeCentsPerYear,
            (c as { feeBilledPer?: "maand" | "jaar" }).feeBilledPer,
          ),
        }),
        c.amountCents,
        c.horizonMonths,
      );
      expect(n.netCents, c.name).toBe(c.expectedNetCents);
    }
  });
});

describe("computeCards", () => {
  test("no card data -> not-enough-data cards; no cardable spend -> not-enough-data cardable-spend", () => {
    const none = run();
    expect(none.status).toBe("not-enough-data");
    expect(none.statusReason.key).toBe("no-card-data");
    expect(none.missing).toContainEqual(
      expect.objectContaining({ kind: "cards" }),
    );
    const noSpend = run({ cards: [card("A")] });
    expect(noSpend.status).toBe("not-enough-data");
    expect(noSpend.statusReason.key).toBe("no-cardable-spend");
    expect(noSpend.missing).toContainEqual(
      expect.objectContaining({ kind: "cardable-spend" }),
    );
    expect(noSpend.figures.cardableSpendCents).toBe(0);
    expect(noSpend.figures.criteria).toHaveLength(1);
  });

  test("cardable spend sums the card accounts over the covered months; other accounts do not count", () => {
    const r = run({
      cards: [card("A")],
      accounts: [acct("A"), acct("Z")],
      txs: [...spendOn("A", 10_000), ...spendOn("Z", 99_999)],
    });
    expect(r.figures.cardableSpendCents).toBe(120_000);
    expect(r.figures.cardInUseKey).toBe("A");
    expect(r.figures.nets[0]!.spendCents).toBe(120_000);
    expect(r.figures.nets[0]!.earnedCents).toBe(1200);
    expect(r.flat["cards_cardable_spend"]).toEqual({
      unit: "cents",
      value: 120_000,
    });
  });

  test("attention edge: other net 1100 vs in-use 1000 -> on-track; 1101 -> attention; in-use 0 and other 1 -> attention", () => {
    // spend on A (in use) 10_000/month => 120_000; B has no spend.
    // Net = 120_000 * pct/100 - fee; pick pct so earned and fee give the targets.
    const mk = (inUse: number, other: number) => {
      const fa = 12_000; // fee for A
      const fb = 12_000;
      const pctA = ((inUse + fa) / 120_000) * 100;
      const pctB = ((other + fb) / 120_000) * 100;
      return run({
        cards: [
          card("A", { cashback: measured(pctA), fee: fee(fa) }),
          card("B", { cashback: measured(pctB), fee: fee(fb) }),
        ],
        txs: spendOn("A", 10_000),
      });
    };
    // Another held card netting more is shown as a fact, never as attention.
    expect(mk(1000, 1100).status).toBe("on-track");
    expect(mk(1000, 1101).status).toBe("on-track");
    expect(mk(1000, 1101).statusReason.key).toBe("other-card-nets-more");
    expect(mk(0, 1).status).toBe("on-track");
    expect(mk(0, 1).statusReason.key).toBe("other-card-nets-more");
    expect(mk(1000, 1000).status).toBe("on-track");
    expect(mk(1000, 1100).statusReason.key).toBe("no-better-card");
  });

  test("the criteria table lists the cards the user holds, not the catalogue", () => {
    const r = run({
      cards: [card("A")],
      txs: spendOn("A", 10_000),
      catalogue: [
        {
          id: "other", product: "Other card", bank: "X",
          fields: { cashbackPct: { value: 2, checkedAt: "2026-10-01", sourceUrl: "https://x.example" } },
        } as never,
      ],
    });
    expect(r.figures.criteria.map((c) => c.cardKey)).toEqual(["A"]);
    expect(r.figures.criteria.every((c) => c.held)).toBe(true);
  });

  test("rent, tax, insurance, own transfers, loan repayments and cash are not cardable spend", () => {
    const CUR = acct("C1");
    const CC = acct("CC");
    const txs = [
      ...spendOn("CC", 45_000),
      ...MONTHS.flatMap((m) => [
        mkTx("Landlord", `${m}-02`, -1500, { accountKey: "C1", category: "Wonen & energie" }),
        mkTx("Belastingdienst", `${m}-03`, -300, { accountKey: "C1", category: "Belastingen & overheid" }),
        mkTx("Zorg", `${m}-04`, -120, { accountKey: "C1", category: "Verzekeringen" }),
        mkTx("Own", `${m}-05`, -200, { accountKey: "C1", category: "Sparen & beleggen" }),
        mkTx("ATM", `${m}-06`, -50, { accountKey: "C1", category: "Geldopname" }),
        mkTx("Santander Consumer Finance", `${m}-07`, -250, { accountKey: "C1", category: "Boodschappen" }),
      ]),
    ];
    const r = run({
      accounts: [CUR, CC],
      cards: [card("CC", { cashback: measured(1) }), card("C1", { cashback: measured(0.5) })],
      txs,
    });
    expect(r.figures.cardableSpendCents).toBe(45_000 * 12);
    expect(r.figures.notCardableSpendCents).toBe((1500 + 300 + 120 + 200 + 50 + 250) * 100 * 12);
    expect(r.calc.find((c) => c.id === "cardable-spend")!.inputs["not_cardable"]).toEqual({
      unit: "cents",
      value: r.figures.notCardableSpendCents,
    });
  });

  test("shared fixture rent case: only the card-payable spend earns cashback", () => {
    const c = cardCases.cases.find((x) => "notCardablePerMonthCents" in x) as unknown as {
      amountCents: number;
      cashbackPct: number;
      notCardablePerMonthCents: number;
      expectedNetCents: number;
    };
    const CUR = acct("C1");
    const CC = acct("CC");
    const txs = [
      ...spendOn("CC", c.amountCents / 12),
      ...MONTHS.map((m) => mkTx("Landlord", `${m}-02`, -c.notCardablePerMonthCents / 100, { accountKey: "C1", category: "Wonen & energie" })),
    ];
    const r = run({ accounts: [CUR, CC], cards: [card("CC", { cashback: measured(c.cashbackPct) })], txs });
    expect(r.figures.cardableSpendCents).toBe(c.amountCents);
    expect(r.figures.nets[0]!.netCents).toBe(c.expectedNetCents);
  });

  test("unknown net of another card never triggers attention; unknown in-use net -> not-enough-data", () => {
    const r = run({
      cards: [
        card("A", { cashback: measured(1) }),
        card("B", { cashback: unknownCb }),
      ],
      txs: spendOn("A", 10_000),
    });
    expect(r.status).toBe("on-track");
    const u = run({
      cards: [
        card("A", { cashback: unknownCb }),
        card("B", { cashback: measured(5) }),
      ],
      txs: spendOn("A", 10_000),
    });
    expect(u.status).toBe("not-enough-data");
    expect(u.figures.nets.find((n) => n.cardKey === "A")!.netCents).toBeNull();
  });

  test("criteria sort by name; reversing input order gives identical output; no figure key named rank|score|best|recommended|highlight", () => {
    const cards = [
      card("C", { label: "Zeta" }),
      card("A", { label: "Alfa" }),
      card("B", { label: "Mid" }),
    ];
    const txs = [
      ...spendOn("A", 5000),
      ...spendOn("B", 5000),
      ...spendOn("C", 5000),
    ];
    const a = run({ cards, txs });
    const b = run({ cards: [...cards].reverse(), txs: [...txs].reverse() });
    expect(a.figures.criteria.map((c) => c.name)).toEqual([
      "Alfa",
      "Mid",
      "Zeta",
    ]);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(a);
    expect(
      [...keys].filter((k) => /rank|score|best|recommend|highlight/i.test(k)),
    ).toEqual([]);
  });

  test("criteria rows: unknown columns are typed placeholders, tiers mapped, annual fee unknown is null", () => {
    const r = run({
      cards: [
        card("A", {
          cashback: assumed0,
          fee: fee(5000),
          fxFeePct: 2,
          pointsPerEuro: 1,
          provenance: PROV,
        }),
        card("C", { fxFeePct: 2, pointsPerEuro: 1 }),
        card("B", { cashback: unknownCb, fee: null }),
      ],
    });
    const [a, b, c] = r.figures.criteria;
    expect(a!.cashbackPct).toMatchObject({ value: 0, tier: "assumed" });
    expect(a!.annualFee).toMatchObject({
      cents: 5000,
      known: true,
      asOf: "2026-01-15",
    });
    expect(a!.fxFeePct).toEqual({
      value: 2,
      tier: "measured",
      asOf: "2026-08-01",
      sourceUrl: "https://example.test/fx",
    });
    expect(c!.fxFeePct).toEqual({
      value: null,
      tier: "unknown",
      asOf: null,
      sourceUrl: null,
    });
    expect(c!.pointsPerEuro).toEqual({
      value: null,
      tier: "unknown",
      asOf: null,
      sourceUrl: null,
    });
    expect(a!.earnByCategory).toBe("unknown");
    expect(a!.transferRatio).toBe("unknown");
    expect(a!.insurance).toBe("unknown");
    expect(b!.cashbackPct).toMatchObject({ value: null, tier: "unknown" });
    expect(b!.annualFee).toMatchObject({ cents: null, known: false });
    expect(b!.pointsPerEuro.value).toBeNull();
  });

  test("redemption examples 0.4, 1.0, 0.7 cent/point -> low 0.4, median 0.7, high 1.0; none -> valueRange null", () => {
    const ex = (id: string, spent: number, saved: number) => ({
      id,
      programId: "avios",
      pointsSpent: spent,
      cashPriceSavedCents: saved,
      at: "2026-09-01",
    });
    const prefs = {
      ...emptyPlanPreferences(),
      redemptionExamples: [
        ex("1", 10_000, 4000),
        ex("2", 10_000, 10_000),
        ex("3", 10_000, 7000),
      ],
    };
    const r = run({
      cards: [
        card("A", { programId: "avios", pointsPerEuro: 1, provenance: PROV }),
      ],
      txs: spendOn("A", 10_000),
      rewards: [
        makeRewardsBalance({
          program: "Avios",
          points: 5000,
          updatedAt: "2026-09-01",
        }),
      ],
      preferences: prefs,
    });
    expect(r.figures.balances[0]!.valueRange).toEqual({
      lowCentsPerPoint: 0.4,
      medianCentsPerPoint: 0.7,
      highCentsPerPoint: 1,
      examples: 3,
    });
    // 1200 euro spend at 1 point/euro = 1200 points
    expect(r.figures.nets[0]!.pointsEarned).toBe(1200);
    expect(r.figures.nets[0]!.pointsValueRange).toEqual({
      lowCents: 480,
      medianCents: 840,
      highCents: 1200,
    });
    const none = run({
      cards: [
        card("A", { programId: "avios", pointsPerEuro: 1, provenance: PROV }),
      ],
      txs: spendOn("A", 10_000),
      rewards: [
        makeRewardsBalance({
          program: "Avios",
          points: 5000,
          updatedAt: "2026-09-01",
        }),
      ],
    });
    expect(none.figures.balances[0]!.valueRange).toBeNull();
    expect(none.figures.nets[0]!.pointsValueRange).toBeNull();
    expect(JSON.stringify(none.figures)).not.toMatch(/centsPerPoint/);
    expect(none.figures.nets[0]!.pointsEarned).toBe(1200);
  });

  test("break-even: fee 12000, 1.5% cashback -> 800_000; cashback 0 or unknown -> null", () => {
    const r = run({
      cards: [
        card("A", { cashback: measured(1.5), fee: fee(12_000) }),
        card("B", { cashback: assumed0, fee: fee(12_000) }),
        card("C", { cashback: unknownCb, fee: fee(12_000) }),
        card("D", { cashback: measured(1.5), fee: null }),
      ],
      txs: spendOn("A", 10_000),
    });
    const be = Object.fromEntries(
      r.figures.breakEven.map((b) => [b.cardKey, b.annualSpendCents]),
    );
    expect(be).toEqual({ A: 800_000, B: null, C: null, D: null });
  });

  test("expiry within 90 days -> mustMention; far -> not; stale balance flagged", () => {
    const prefs = {
      ...emptyPlanPreferences(),
      pointsExpiry: { avios: "2026-12-01", flying: "2027-08-01" },
    };
    const r = run({
      cards: [card("A")],
      txs: spendOn("A", 10_000),
      rewards: [
        makeRewardsBalance({
          program: "Avios",
          points: 100,
          updatedAt: "2026-01-01",
        }),
        makeRewardsBalance({
          program: "Flying",
          points: 100,
          updatedAt: "2026-10-01",
        }),
      ],
      preferences: prefs,
    });
    const soon = r.facts.find((f) => f.factId === "points_expiry:avios")!;
    expect(soon).toMatchObject({
      mustMention: true,
      polarity: "negative",
      exact: "2026-12-01",
      unit: "date",
    });
    const far = r.facts.find((f) => f.factId === "points_expiry:flying")!;
    expect(far.mustMention).toBe(false);
    expect(r.figures.balances.find((b) => b.programId === "avios")!.stale).toBe(
      true,
    );
    expect(
      r.figures.balances.find((b) => b.programId === "flying")!.stale,
    ).toBe(false);
    expect(
      r.figures.balances.find((b) => b.programId === "avios")!.expiresOn,
    ).toBe("2026-12-01");
  });

  test("foreign-currency card spend excluded and counted; business-entity card excluded", () => {
    const biz = acct("BZ", { entity: "BV1" });
    const r = run({
      cards: [card("A"), card("BZ")],
      accounts: [acct("A"), biz],
      txs: [
        ...spendOn("A", 10_000),
        mkTx("Hotel", "2026-09-20", -50, {
          accountKey: "A",
          currency: "USD",
          category: "Reizen",
        }),
        ...spendOn("BZ", 77_777),
      ],
      entityProfiles: [{ entity: "BV1", scope: "business" }],
    });
    expect(r.figures.excludedForeignCount).toBe(1);
    expect(r.flat["cards_foreign_excluded"]).toEqual({
      unit: "count",
      value: 1,
    });
    expect(r.figures.cardableSpendCents).toBe(120_000);
    expect(r.figures.criteria.map((c) => c.cardKey)).toEqual(["A"]);
    expect(
      r.calc.find((c) => c.id === "cardable-spend")!.inputs["foreign_excluded"],
    ).toEqual({ unit: "count", value: 1 });
  });

  test("facts: ids hash the card key (IBAN), no raw key; calc ids are all declared; integer cents", () => {
    const iban = "NL91ABNA0417164300";
    const r = run({
      cards: [
        card(iban, {
          programId: "Flying Blue (KLM)",
          pointsPerEuro: 1,
          provenance: PROV,
          fee: fee(12_000),
          cashback: measured(1.5),
        }),
      ],
      txs: spendOn(iban, 10_000),
      rewards: [
        makeRewardsBalance({
          program: "Flying Blue (KLM)",
          points: 100,
          updatedAt: "2026-10-01",
        }),
      ],
    });
    expect(r.facts.length).toBeGreaterThan(0);
    for (const f of r.facts) {
      expect(f.factId).toMatch(/^[a-z0-9_:-]+$/);
      expect(f.factId).not.toContain(iban.toLowerCase());
    }
    expect(r.facts.some((f) => f.factId.startsWith("card_net:"))).toBe(true);
    expect(r.facts.some((f) => f.factId.startsWith("card_break_even:"))).toBe(
      true,
    );
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
    for (const s of r.calc)
      expect((CARDS_CALC_IDS as readonly string[]).includes(s.id)).toBe(true);
    for (const f of Object.values(r.flat))
      if (f.unit === "cents" && f.value !== null)
        expect(Number.isInteger(f.value)).toBe(true);
    const sheet = buildFactSheet(r.facts, { locale: "nl", asOf: AS_OF });
    expect(JSON.stringify(sheet)).not.toContain(iban);
  });

  test("I1: in-use card is chosen on the shared window (A 12 months at 50, B 3 months at 150 -> B)", () => {
    const recent = MONTHS.slice(-3);
    const bTxs = recent.flatMap((m) => [
      mkTx("Start", `${m}-01`, 1, { accountKey: "B", category: "Salaris" }),
      mkTx("Shop", `${m}-15`, -150, {
        accountKey: "B",
        category: "Boodschappen",
      }),
    ]);
    const r = run({
      cards: [card("A"), card("B")],
      txs: [...spendOn("A", 5000), ...bTxs],
    });
    expect(r.figures.months).toBe(3);
    expect(r.figures.cardInUseKey).toBe("B");
  });

  test("I2: 7 months, yearly fee 6000 and monthly fee 500 give the same fee share (3500) and no floor", () => {
    const y = netForCard(card("A", { fee: fee(6000, "jaar") }), 100_000, 7);
    const m = netForCard(card("A", { fee: fee(6000, "maand") }), 100_000, 7);
    expect(y.feeShareCents).toBe(3500);
    expect(m.feeShareCents).toBe(3500);
    expect(y.netCents).toBe(1000 - 3500);
    expect(m.netCents).toBe(y.netCents);
    expect(JSON.stringify(y.net)).not.toContain('flooredToMinimum":true');
  });

  test("I2: calc labels the pro-rating", () => {
    const r = run({
      cards: [card("A", { fee: fee(6000) })],
      txs: spendOn("A", 10_000),
    });
    const step = r.calc.find((c) => c.id === "card-fee")!;
    expect(step.inputs["months"]).toEqual({ unit: "months", value: 12 });
    expect(step.inputs["fee_year"]).toEqual({ unit: "cents", value: 6000 });
  });

  test("I3: points earned and the points fact need provenance", () => {
    const iban = "NL01X";
    const mk = (prov: boolean) =>
      run({
        cards: [
          card(iban, {
            programId: "avios",
            pointsPerEuro: 1,
            ...(prov ? { provenance: PROV } : {}),
          }),
        ],
        txs: spendOn(iban, 10_000),
      });
    const without = mk(false);
    expect(without.figures.nets[0]!.pointsEarned).toBeNull();
    expect(
      without.facts.some((f) => f.factId.startsWith("card_points_year")),
    ).toBe(false);
    const withP = mk(true);
    expect(withP.figures.nets[0]!.pointsEarned).toBe(1200);
    expect(
      withP.facts.some((f) => f.factId.startsWith("card_points_year")),
    ).toBe(true);
  });

  test("I4: unknown in-use net uses in-use-card-unknown", () => {
    const r = run({
      cards: [card("A", { cashback: unknownCb })],
      txs: spendOn("A", 10_000),
    });
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("in-use-card-unknown");
  });

  test("M2: negative or non-finite cashback is unknown", () => {
    for (const pct of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const n = netForCard(card("A", { cashback: measured(pct) }), 600_000, 12);
      expect(n.cashbackTier).toBe("unknown");
      expect(n.earnedCents).toBeNull();
      expect(n.netCents).toBeNull();
    }
  });

  test("M3: card_points_year suffix follows the sorted card key, not the name", () => {
    const mk = (labelA: string, labelB: string) =>
      run({
        cards: [
          card("A", {
            label: labelA,
            programId: "avios",
            pointsPerEuro: 1,
            provenance: PROV,
          }),
          card("B", {
            label: labelB,
            programId: "avios",
            pointsPerEuro: 2,
            provenance: PROV,
          }),
        ],
        txs: [...spendOn("A", 5000), ...spendOn("B", 5000)],
      });
    const exact = (r: ReturnType<typeof mk>, id: string) =>
      r.facts.find((f) => f.factId === id)!.exact;
    const one = mk("Alfa", "Zeta");
    const two = mk("Zeta", "Alfa");
    expect(exact(one, "card_points_year:avios")).toBe(
      exact(two, "card_points_year:avios"),
    );
    expect(exact(one, "card_points_year:avios-2")).toBe(
      exact(two, "card_points_year:avios-2"),
    );
  });

  test("AS_OF is the clock: nothing reads the real date", () => {
    expect(AS_OF).toBe("2026-10-24");
  });
});

describe("computeCards: advice", () => {
  const cv = (value: number, extra: Record<string, unknown> = {}) => ({
    value,
    route: "provider-page" as const,
    sourceUrl: "https://example.test/src",
    checkedAt: "2026-08-20",
    conditions: null,
    conditionsKnown: true,
    ...extra,
  });
  const CAT = [
    {
      id: "gold",
      product: "Gold",
      kind: "creditcard",
      fields: { accountFee: cv(20, { period: "maand" }), fxFeePct: cv(2.5), pointsPerEuro: cv(0) },
    },
    {
      id: "free",
      product: "Free",
      kind: "creditcard",
      fields: { accountFee: cv(0, { period: "jaar" }), fxFeePct: cv(2), pointsPerEuro: cv(0) },
    },
  ] as never;
  const cur = acct("CUR");
  const adviceRun = (
    over: Omit<Partial<PlanInput>, "profile"> & { profile?: Partial<PlanProfile> } = {},
  ) =>
    computeCards(
      planInput({
        accounts: [cur],
        txs: spendOn("CUR", 100_000),
        catalogue: CAT,
        ...over,
        profile: {
          statedCardIds: ["gold"],
          cardBalances: [{ cardId: "gold", balanceCents: 200_000, paysInFull: false, ratePct: 15 }],
          ...over.profile,
        },
      }),
      {
        liquidSavingsCents: 1_000_000,
        fixedCostsMonthlyCents: 100_000,
        targetMonths: 3,
      },
    ).figures.advice;

  test("a user who only stated a card gets advice from the spend of all personal accounts", () => {
    const a = adviceRun();
    expect(a.state).toBe("ok");
    expect(a.spend.months).toBe(12);
    expect(a.spend.annualCents).toBe(1_200_000);
    expect(a.baseline).toMatchObject({ kind: "best-held", cardId: "gold", netCents: -24_000 });
    expect(a.verdict).toMatchObject({ kind: "switch", gainCents: 24_000 });
  });

  test("the interest block uses the stated balance and the buffer surplus", () => {
    const [x] = adviceRun().interest;
    expect(x).toMatchObject({
      yearlyInterestCents: 30_000,
      surplusCents: 700_000,
      payoffCents: 200_000,
      recommendation: "payoff-all",
    });
  });

  test("a bank-data card with a catalogue match counts as held", () => {
    const a = adviceRun({
      heldCards: [card("CUR", { catalogueId: "free" })],
      profile: { statedCardIds: [], cardBalances: [] },
    });
    expect(a.baseline).toMatchObject({ kind: "best-held", cardId: "free" });
  });

  test("rent and other non-cardable spend stay out of the advice base", () => {
    const rent = spendOn("CUR", 50_000, { category: "Wonen & energie" });
    const a = adviceRun({ txs: [...spendOn("CUR", 100_000), ...rent] });
    expect(a.spend.annualCents).toBe(1_200_000);
  });

  test("the status follows the advice when the card accounts alone cannot be judged", () => {
    const r = computeCards(
      planInput({
        accounts: [cur],
        txs: spendOn("CUR", 100_000),
        catalogue: CAT,
        profile: { statedCardIds: ["gold"] },
      }),
    );
    expect(r.status).toBe("on-track");
    expect(r.statusReason.key).toBe("card-advice");
    expect(r.missing).toEqual([]);
  });

  test("no data: advice is present and says so; the section statuses are unchanged", () => {
    const r = computeCards(planInput({ catalogue: CAT }));
    expect(r.status).toBe("not-enough-data");
    expect(r.figures.advice.state).toBe("short-history");
  });
});
