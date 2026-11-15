import { describe, expect, test } from "vitest";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import { computeBuffer } from "./buffer.js";
import { computeMonth } from "./month.js";
import { emptyPlanPreferences } from "./preferences.js";
import { planInput } from "./testkit.js";
import type { PlanInput } from "./types.js";

const MONTHS = ["2026-07", "2026-08", "2026-09"] as const;
const euro = (e: number) => Math.round(e * 100);
const CUR = (balance: number, o = {}) =>
  mkAccount("A1", { iban: "NL01INGB0000000001", balance, balanceDate: "2026-10-20", ...o });
const SAV = (balance: number, o = {}) =>
  mkAccount("S1", {
    iban: "NL02INGB0000000002",
    type: "Spaarrekening",
    balance,
    balanceDate: "2026-10-20",
    ...o,
  });

const roomTxs = (net: number, income = 3000) =>
  MONTHS.flatMap((m) => [
    mkTx("Employer", `${m}-01`, income, { category: "Salaris" }),
    mkTx("Shops", `${m}-15`, -(income - net), { category: "Boodschappen" }),
  ]);

const run = (i: PlanInput) => computeBuffer(i, computeMonth(i));

const base = (over: Parameters<typeof planInput>[0] = {}) =>
  planInput({
    accounts: [CUR(0), SAV(4100)],
    txs: roomTxs(500),
    ...over,
    profile: { fixedCostsMonthlyCents: euro(1700), bufferTargetMonths: 4, ...over.profile },
  });

describe("income buffer", () => {
  test("liquid 4100 / fixed 1700 = 2.41 months (2 dp), target 4 -> gap months 1.59, gap 270000 cents", () => {
    const r = run(base());
    expect(r.figures.liquidSavingsCents).toBe(410000);
    expect(r.figures.incomeBufferMonths).toBe(2.41);
    expect(r.figures.gapCents).toBe(270000);
    expect(r.figures.gapMonths).toBe(1.59);
    expect(r.status).toBe("attention");
    expect(r.statusReason.key).toBe("below-target");
    expect(r.flat["buffer_gap_cents"]).toEqual({ unit: "cents", value: 270000 });
    expect(r.headline).toEqual({ unit: "months", value: 2.41 });
  });

  test("at or above target -> on-track, gap 0", () => {
    const r = run(base({ accounts: [CUR(0), SAV(6800)] }));
    expect(r.status).toBe("on-track");
    expect(r.statusReason.key).toBe("at-target");
    expect(r.figures.gapCents).toBe(0);
    expect(r.figures.closeMonths).toBeNull();
    expect(r.figures.closeRoom).toBeNull();
  });

  test("above target: gap is clamped to 0 cents and 0 months, never negative", () => {
    const r = run(base({ accounts: [CUR(0), SAV(7000)] }));
    expect(r.figures.gapCents).toBe(0);
    expect(r.figures.gapMonths).toBe(0);
    expect(r.flat["buffer_gap_cents"]).toEqual({ unit: "cents", value: 0 });
  });

  test("current accounts count as liquid; credit and investment do not", () => {
    const r = run(
      base({
        accounts: [
          CUR(1000),
          SAV(2000),
          mkAccount("C9", {
            iban: "NL09INGB0000000009",
            type: "Creditcard",
            balance: 777,
            balanceDate: "2026-10-20",
          }),
          mkAccount("I9", {
            iban: "NL08INGB0000000008",
            type: "Beleggingsrekening",
            balance: 888,
            balanceDate: "2026-10-20",
          }),
        ],
      }),
    );
    expect(r.figures.liquidSavingsCents).toBe(300000);
  });

  test("balance is rolled forward with transactions after balanceDate", () => {
    const r = run(
      base({
        accounts: [CUR(0), SAV(4100)],
        txs: [
          ...roomTxs(500),
          mkTx("Gift", "2026-10-22", 100, { accountKey: "S1", category: "Cadeau" }),
        ],
      }),
    );
    expect(r.figures.liquidSavingsCents).toBe(420000);
  });

  test("goal-linked account balance is excluded and reported; non-EUR savings excluded and counted", () => {
    const GOAL = mkAccount("S2", {
      iban: "NL05INGB0000000005",
      type: "Spaarrekening",
      balance: 1000,
      balanceDate: "2026-10-20",
    });
    const FX = mkAccount("S3", {
      iban: "HU05INGB0000000006",
      type: "Spaarrekening",
      currency: "HUF",
      balance: 380000,
      balanceDate: "2026-10-20",
    });
    const goal = {
      goal: {
        id: "g1",
        purpose: "Car",
        kind: "general" as const,
        targetCents: 500000,
        targetDate: "2028-01-01",
        priority: "important" as const,
        accountRefs: [
          { kind: "bank" as const, id: "S2" },
          { kind: "bank" as const, id: "S3" },
        ],
      },
      since: "2026-01-01",
    };
    const r = run(base({ accounts: [CUR(0), SAV(4100), GOAL, FX], profile: { goals: [goal] } }));
    expect(r.figures.liquidSavingsCents).toBe(410000);
    expect(r.figures.goalLinkedExcludedCents).toBe(100000);
    expect(r.figures.excludedForeignCount).toBe(1);
  });

  test("a goal-linked account with an unknown balance leaves out only that account, not the whole buffer", () => {
    const UNK = mkAccount("S2", { iban: "NL05INGB0000000005", type: "Spaarrekening" });
    const goal = {
      goal: {
        id: "g1",
        purpose: "Car",
        kind: "general" as const,
        targetCents: 500000,
        targetDate: "2028-01-01",
        priority: "important" as const,
        accountRefs: [{ kind: "bank" as const, id: "S2" }],
      },
      since: "2026-01-01",
    };
    const r = run(base({ accounts: [CUR(0), SAV(4100), UNK], profile: { goals: [goal] } }));
    expect(r.figures.liquidSavingsCents).toBe(410000);
    expect(r.statusReason.key).not.toBe("no-savings");
    // an unlinked unknown balance still blocks it
    const blocked = run(base({ accounts: [CUR(0), SAV(4100), UNK] }));
    expect(blocked.figures.liquidSavingsCents).toBeNull();
    expect(blocked.missing).toContainEqual({
      kind: "savings-balance",
      action: "import",
      ref: "S2",
    });
  });

  test("no buffer target -> missing buffer-target, gap null, not-enough-data, no default used", () => {
    const r = run(base({ profile: { bufferTargetMonths: null } }));
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("no-target");
    expect(r.missing.map((m) => m.kind)).toContain("buffer-target");
    expect(r.figures.targetMonths).toBeNull();
    expect(r.figures.gapCents).toBeNull();
    expect(r.figures.gapMonths).toBeNull();
    expect(r.figures.incomeBufferMonths).toBe(2.41);
  });

  test("no fixed costs -> no-fixed-costs; no savings accounts -> no-savings", () => {
    const a = run(base({ profile: { fixedCostsMonthlyCents: null } }));
    expect(a.status).toBe("not-enough-data");
    expect(a.statusReason.key).toBe("no-fixed-costs");
    expect(a.missing.map((m) => m.kind)).toContain("fixed-costs");
    const b = run(base({ accounts: [], txs: [] }));
    expect(b.status).toBe("not-enough-data");
    expect(b.statusReason.key).toBe("no-savings");
    expect(b.missing.map((m) => m.kind)).toContain("savings-balance");
    expect(JSON.stringify(b)).not.toMatch(/NaN|Infinity/);
  });

  test("business-entity balances excluded; no entities -> all counted", () => {
    const BIZ = mkAccount("B1", {
      iban: "NL06INGB0000000006",
      entity: "Acme BV",
      type: "Spaarrekening",
      balance: 9000,
      balanceDate: "2026-10-20",
    });
    const scoped = run(
      base({
        accounts: [CUR(0), SAV(4100), BIZ],
        entityProfiles: [{ entity: "Acme BV", scope: "business" }],
      }),
    );
    expect(scoped.figures.liquidSavingsCents).toBe(410000);
    const all = run(base({ accounts: [CUR(0), SAV(4100), BIZ] }));
    expect(all.figures.liquidSavingsCents).toBe(1310000);
  });
});

describe("time to close and object buffer", () => {
  test("room low <= 0 -> not-reachable; no date anywhere", () => {
    const txs = [-100, 300, 500].flatMap((net, k) => [
      mkTx("Employer", `${MONTHS[k]}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${MONTHS[k]}-15`, -(3000 - net), { category: "Boodschappen" }),
    ]);
    const i = base({ txs });
    const r = run(i);
    expect(r.figures.closeMonths).toBe("not-reachable");
  });

  test("room 300..600 and gap 2700 -> {low: 5, high: 9}", () => {
    const txs = [300, 450, 600].flatMap((net, k) => [
      mkTx("Employer", `${MONTHS[k]}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${MONTHS[k]}-15`, -(3000 - net), { category: "Boodschappen" }),
    ]);
    const r = run(base({ txs, accounts: [CUR(0), SAV(4100)] }));
    expect(r.figures.gapCents).toBe(270000);
    expect(r.figures.closeMonths).toEqual({ low: 5, high: 9 });
    expect(r.figures.closeRoom).toEqual({ lowCents: 30000, highCents: 60000 });
  });

  test("exactly maxCloseMonths (120) is still reachable; 121 is not-reachable", () => {
    const txs = [300, 300, 300].flatMap((net, k) => [
      mkTx("Employer", `${MONTHS[k]}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${MONTHS[k]}-15`, -(3000 - net), { category: "Boodschappen" }),
    ]);
    // fixed 1700 x 25 = 42500 target; savings 6500 -> gap 36000 = 120 x room 300
    const at = run(
      base({ txs, accounts: [CUR(0), SAV(6500)], profile: { bufferTargetMonths: 25 } }),
    );
    expect(at.figures.gapCents).toBe(3_600_000);
    expect(at.figures.closeMonths).toEqual({ low: 120, high: 120 });
    const over = run(
      base({ txs, accounts: [CUR(0), SAV(6499)], profile: { bufferTargetMonths: 25 } }),
    );
    expect(over.figures.closeMonths).toBe("not-reachable");
  });

  test("no room figure at all -> closeMonths null", () => {
    expect(run(base({ txs: [] })).figures.closeMonths).toBeNull();
  });

  test("object buffer: typed 5000 against savings 10000 = 0.5; absent -> null", () => {
    const prefs = {
      ...emptyPlanPreferences(),
      nibudBufferResult: { cents: euro(5000), at: "2026-10-01" },
    };
    const r = run(base({ accounts: [CUR(0), SAV(10000)], preferences: prefs }));
    expect(r.figures.objectBufferCents).toBe(500000);
    expect(r.figures.objectShareOfSavings).toBe(0.5);
    const none = run(base({ accounts: [CUR(0), SAV(10000)] }));
    expect(none.figures.objectBufferCents).toBeNull();
    expect(none.figures.objectShareOfSavings).toBeNull();
  });
});

describe("facts and flags", () => {
  test("facts: buffer_months, buffer_gap negative, buffer_gap_months; unique ids", () => {
    const r = run(base());
    const by = Object.fromEntries(r.facts.map((f) => [f.factId, f]));
    expect(by["buffer_months"]).toMatchObject({ exact: 2.41, unit: "months" });
    expect(by["buffer_gap"]).toMatchObject({ exact: 270000, polarity: "negative", unit: "cents" });
    expect(by["buffer_gap_months"]).toMatchObject({ exact: 1.59, unit: "months" });
    expect(new Set(r.facts.map((f) => f.factId)).size).toBe(r.facts.length);
  });

  test("irregular income adds a flag fact only; status and calc unchanged", () => {
    const plain = run(base());
    const irregular = run(
      base({
        profile: {
          incomeStreams: [{ id: "i1", label: "x", monthlyCents: 100000, regular: false }],
        },
      }),
    );
    expect(irregular.status).toBe(plain.status);
    expect(irregular.calc).toEqual(plain.calc);
    expect(irregular.facts.map((f) => f.factId)).toContain("buffer_irregular_income");
    expect(plain.facts.map((f) => f.factId)).not.toContain("buffer_irregular_income");
  });
});

describe("fix round 1", () => {
  test("I1: an EUR liquid account with unknown balance -> liquid null and savings-balance missing naming it", () => {
    const UNK = mkAccount("S7", {
      iban: "NL07INGB0000000007",
      type: "Spaarrekening",
      balance: null,
    });
    const r = run(base({ accounts: [CUR(0), SAV(3000), UNK] }));
    expect(r.figures.liquidSavingsCents).toBeNull();
    expect(r.status).toBe("not-enough-data");
    expect(r.missing).toContainEqual({ kind: "savings-balance", action: "import", ref: "S7" });
  });

  test("P15: no bank balance and a stated savings figure -> liquid = stated, source marked, nothing subtracted", () => {
    const r = run(base({ accounts: [], txs: [], profile: { savingsStatedCents: euro(4100) } }));
    expect(r.figures.liquidSavingsCents).toBe(410000);
    expect(r.figures.goalLinkedExcludedCents).toBe(0);
    expect(r.calc.find((c) => c.id === "liquid-savings")!.inputs["source"]).toEqual({
      unit: "count",
      value: "stated",
    });
    expect(r.status).toBe("attention");
  });

  test("C2: a stated savings total and a goal with a typed amount may overlap; bank balances or linked goals do not", () => {
    const g = (over: object) => ({
      goal: {
        id: "g1",
        purpose: "Car",
        kind: "general" as const,
        targetCents: 1_000_000,
        targetDate: "2036-10-24",
        priority: "important" as const,
        accountRefs: [] as { kind: "bank" | "broker"; id: string }[],
        ...over,
      },
      since: "2026-01-01",
    });
    const stated = (goals: ReturnType<typeof g>[]) =>
      run(base({ accounts: [], txs: [], profile: { savingsStatedCents: euro(4100), goals } }));
    expect(stated([g({ startingBalanceCents: 200_000 })]).figures.statedOverlapGoalCount).toBe(1);
    expect(stated([g({})]).figures.statedOverlapGoalCount).toBe(0);
    expect(
      stated([g({ startingBalanceCents: 200_000, accountRefs: [{ kind: "bank", id: "S1" }] })])
        .figures.statedOverlapGoalCount,
    ).toBe(0);
    const bank = run(
      base({
        accounts: [CUR(0), SAV(2000)],
        profile: { savingsStatedCents: euro(4100), goals: [g({ startingBalanceCents: 200_000 })] },
      }),
    );
    expect(bank.figures.statedOverlapGoalCount).toBe(0);
  });

  test("P15: bank balances win over the stated figure", () => {
    const r = run(
      base({ accounts: [CUR(0), SAV(2000)], profile: { savingsStatedCents: euro(9999) } }),
    );
    expect(r.figures.liquidSavingsCents).toBe(200000);
    expect(r.calc.find((c) => c.id === "liquid-savings")!.inputs["source"]).toBeUndefined();
  });

  test("M2: 3.996 months displays below the target 4 and status is attention", () => {
    const r = run(base({ accounts: [CUR(0), SAV(6793.2)] }));
    expect(r.figures.incomeBufferMonths).toBe(3.99);
    expect(r.status).toBe("attention");
  });

  test("M3: fixed costs of 0 name fixed-costs as missing", () => {
    const r = run(base({ profile: { fixedCostsMonthlyCents: 0 } }));
    expect(r.statusReason.key).toBe("no-fixed-costs");
    expect(r.missing.map((m) => m.kind)).toContain("fixed-costs");
  });

  test("M4: more than 120 months to close -> not-reachable", () => {
    const txs = [1, 1, 1].flatMap((net, k) => [
      mkTx("Employer", `${MONTHS[k]}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${MONTHS[k]}-15`, -(3000 - net), { category: "Boodschappen" }),
    ]);
    expect(run(base({ txs })).figures.closeMonths).toBe("not-reachable");
  });
});

describe("income buffer on a stale room", () => {
  test("no close-time example when the month section is data-stale", () => {
    const OLD = ["2026-03", "2026-04", "2026-05", "2026-06"];
    const txs = OLD.flatMap((m) => [
      mkTx("Employer", `${m}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${m}-30`, -2000, { category: "Boodschappen" }),
    ]);
    const i = planInput({
      accounts: [CUR(0, { balanceDate: "2026-06-30" }), SAV(1000, { balanceDate: "2026-06-30" })],
      txs,
      profile: { fixedCostsMonthlyCents: euro(1000), bufferTargetMonths: 4 },
    });
    expect(computeMonth(i).statusReason.key).toBe("data-stale");
    const r = run(i);
    expect(r.figures.gapCents).toBeGreaterThan(0);
    expect(r.figures.closeMonths).toBeNull();
    expect(r.figures.closeRoom).toBeNull();
  });
});
