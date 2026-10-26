import { describe, expect, test } from "vitest";
import { computeRoom } from "../advisor/room.js";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import type { Tx } from "../model.js";
import { fixedCostsMonthlyCentsOf, computeMonth } from "./month.js";
import { planInput } from "./testkit.js";

const MONTHS = ["2026-07", "2026-08", "2026-09"] as const;
const CHECKING = mkAccount("A1", { iban: "NL01INGB0000000001", balanceDate: "2026-10-20" });

/** Three full months: salary on day 01, spending on day 15 so that the net of
 *  each month is `nets[i]` (euros) on an income of `income` (euros). */
function threeMonths(nets: [number, number, number], income: number, extra: Tx[] = []): Tx[] {
  return [
    ...MONTHS.flatMap((m, i) => [
      mkTx("Employer", `${m}-01`, income, { category: "Salaris" }),
      mkTx("Shops", `${m}-15`, -(income - nets[i]!), { category: "Boodschappen" }),
    ]),
    ...extra,
  ];
}

describe("room", () => {
  test("room is the intake RoomResult unchanged; median-by-net month is the headline", () => {
    const i = planInput({ accounts: [CHECKING], txs: threeMonths([300, 700, 500], 3000) });
    const direct = computeRoom({
      txs: i.txs, accounts: i.accounts, profiles: i.entityProfiles, rules: i.rules,
      own: i.own, asOf: i.asOf, mode: i.mode, fxHistory: i.fxHistory,
    });
    const r = computeMonth(i);
    expect(r.figures.room).toEqual(direct);
    expect(r.headline).toEqual({ unit: "cents", value: 50000 });
    expect(r.flat["room_low"]).toEqual({ unit: "cents", value: 30000 });
    expect(r.flat["room_high"]).toEqual({ unit: "cents", value: 70000 });
  });

  test("status edges: share 0.10 exactly -> on-track; 0.0999 -> attention; one negative month -> attention", () => {
    const at = (nets: [number, number, number], income: number) =>
      computeMonth(planInput({ accounts: [CHECKING], txs: threeMonths(nets, income) }));
    expect(at([300, 300, 300], 3000).status).toBe("on-track");
    expect(at([300, 300, 300], 3000).statusReason.key).toBe("room-ok");
    expect(at([299.7, 299.7, 299.7], 3000).status).toBe("attention");
    expect(at([299.7, 299.7, 299.7], 3000).statusReason.key).toBe("room-low");
    const neg = at([-50, 400, 500], 3000);
    expect(neg.status).toBe("attention");
    expect(neg.statusReason.key).toBe("month-negative");
  });

  test("stale bank data: the newest full month is not the month before asOf -> not-enough-data data-stale, one account-stale per stale account", () => {
    const OLD = ["2026-03", "2026-04", "2026-05", "2026-06"];
    const txs = OLD.flatMap((m) => [
      mkTx("Employer", `${m}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${m}-30`, -2000, { category: "Boodschappen" }),
    ]);
    const stale = mkAccount("A1", { iban: "NL01INGB0000000001", balanceDate: "2026-06-30" });
    const r = computeMonth(planInput({ accounts: [stale], txs, profile: { fixedCostsMonthlyCents: 100000 } }));
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("data-stale");
    expect(r.missing).toContainEqual({ kind: "account-stale", action: "connect-bank", ref: "A1" });
    // the figures it rests on stay readable
    expect(r.figures.room).toMatchObject({ kind: "computed" });
  });

  test("fresh data is not stale: the same shape ending last month stays on-track", () => {
    const r = computeMonth(planInput({ accounts: [CHECKING], txs: threeMonths([300, 300, 300], 3000) }));
    expect(r.statusReason.key).toBe("room-ok");
  });

  test("no transactions and no stated ranges -> not-enough-data with bank-data", () => {
    const r = computeMonth(planInput());
    expect(r.status).toBe("not-enough-data");
    expect(r.missing.map((m) => m.kind)).toContain("bank-data");
    expect(r.headline).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  test("txs but no full month -> not-enough-data with history-60d", () => {
    const r = computeMonth(
      planInput({ accounts: [CHECKING], txs: [mkTx("Employer", "2026-10-01", 3000)] }),
    );
    expect(r.status).toBe("not-enough-data");
    expect(r.missing.map((m) => m.kind)).toContain("history-60d");
  });

  test("under 60 days with a computed room and no stated ranges -> not-enough-data", () => {
    const txs = [
      mkTx("Employer", "2026-09-01", 3000, { category: "Salaris" }),
      mkTx("Shops", "2026-09-15", -2000, { category: "Boodschappen" }),
      mkTx("Shops", "2026-09-30", -10, { category: "Boodschappen" }),
    ];
    const r = computeMonth(planInput({ accounts: [CHECKING], txs }));
    expect(r.figures.room.kind).toBe("computed");
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("history-short");
    expect(r.missing.map((m) => m.kind)).toContain("history-60d");
  });

  test("stated ranges without transactions: room from roomFromStated, status from the share", () => {
    const r = computeMonth(
      planInput({
        profile: {
          incomeStatedRange: { lowCents: 280000, highCents: 320000 },
          spendStatedRange: { lowCents: 180000, highCents: 220000 },
        },
      }),
    );
    expect(r.figures.room.kind).toBe("stated");
    expect(r.figures.room).toMatchObject({ lowCents: 60000, highCents: 140000 });
    expect(r.flat["room_middle"]).toEqual({ unit: "cents", value: 100000 });
    expect(r.figures.incomeMiddleCents).toBe(300000);
    expect(r.status).toBe("on-track");
    expect(r.figures.savingsRate).toBeNull();
  });
});

describe("fixed and variable", () => {
  test("fixed 1500 + variable 1000 over income 3200: shares as ratios; calc carries the detection note", () => {
    const i = planInput({
      accounts: [CHECKING],
      txs: threeMonths([700, 700, 700], 3200),
      profile: { housingMonthlyCents: 100000, fixedCostsMonthlyCents: 150000 },
    });
    const r = computeMonth(i);
    expect(r.figures.fixedCents).toBe(150000);
    expect(r.figures.variableCents).toBe(100000);
    expect(r.figures.fixedShare).toBeCloseTo(0.46875, 10);
    expect(r.figures.variableShare).toBeCloseTo(0.3125, 10);
    expect(r.calc.map((c) => c.id)).toContain("variable-split");
    expect(r.calc.find((c) => c.id === "variable-split")!.output).toEqual({
      unit: "cents",
      value: 100000,
    });
  });

  test("variable is floored at 0 when fixed exceeds the outgoing; the floor is a calc step", () => {
    const r = computeMonth(
      planInput({
        accounts: [CHECKING],
        txs: threeMonths([2000, 2000, 2000], 3000),
        profile: { fixedCostsMonthlyCents: 150000 },
      }),
    );
    expect(r.figures.variableCents).toBe(0);
    expect(r.calc.map((c) => c.id)).toContain("variable-floor");
  });

  test("no fixed costs -> fixed, variable and shares null, fixed-costs missing, status unchanged", () => {
    const r = computeMonth(planInput({ accounts: [CHECKING], txs: threeMonths([700, 700, 700], 3200) }));
    expect(r.figures.fixedCents).toBeNull();
    expect(r.figures.variableCents).toBeNull();
    expect(r.figures.fixedShare).toBeNull();
    expect(r.missing.map((m) => m.kind)).toContain("fixed-costs");
    expect(r.status).toBe("on-track");
  });

  test("income 0: shares null, no NaN/Infinity anywhere in flat", () => {
    const txs = MONTHS.flatMap((m) => [
      mkTx("Shops", `${m}-01`, -100, { category: "Boodschappen" }),
      mkTx("Shops", `${m}-28`, -100, { category: "Boodschappen" }),
    ]);
    const r = computeMonth(
      planInput({ accounts: [CHECKING], txs, profile: { fixedCostsMonthlyCents: 10000 } }),
    );
    expect(r.figures.fixedShare).toBeNull();
    expect(r.figures.variableShare).toBeNull();
    expect(r.figures.savingsRate).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
    for (const f of r.facts) expect(Number.isFinite(f.exact as number)).toBe(true);
  });

  test("fixedCostsMonthlyCentsOf is the profile figure (the About-you number) and its lines", () => {
    const none = fixedCostsMonthlyCentsOf(planInput());
    expect(none).toEqual({ cents: null, lines: [] });
    const some = fixedCostsMonthlyCentsOf(
      planInput({ profile: { housingMonthlyCents: 100000, fixedCostsMonthlyCents: 130000 } }),
    );
    expect(some.cents).toBe(130000);
    expect(some.lines.reduce((s, l) => s + l.cents, 0)).toBe(130000);
  });
});

describe("savings rate", () => {
  const SAVINGS = mkAccount("S1", {
    iban: "NL02INGB0000000002",
    type: "Spaarrekening",
    balanceDate: "2026-10-20",
  });
  const move = (to: string, m: string) =>
    mkTx("Own transfer", `${m}-20`, -200, { description: `to ${to}`, category: "" });

  test("200 moved to an own savings account is already inside room 400: rate = 400 / 3000, not 600 / 3000", () => {
    const txs = threeMonths([400, 400, 400], 3000).concat(
      MONTHS.map((m) => move(SAVINGS.iban, m)),
    );
    const r = computeMonth(planInput({ accounts: [CHECKING, SAVINGS], txs }));
    expect(r.figures.room).toMatchObject({ kind: "computed", middleCents: 40000 });
    expect(r.figures.savingsMovedCents).toBe(20000);
    expect(r.figures.savingsRate).toBeCloseTo(400 / 3000, 10);
    expect(r.flat["savings_rate"]).toEqual({ unit: "ratio", value: r.figures.savingsRate });
  });

  test("moved to a business account's savings is excluded", () => {
    const BIZ = mkAccount("S2", {
      iban: "NL03INGB0000000003",
      type: "Spaarrekening",
      entity: "Acme BV",
      balanceDate: "2026-10-20",
    });
    const txs = threeMonths([400, 400, 400], 3000).concat(
      MONTHS.map((m) => move(BIZ.iban, m)),
    );
    const r = computeMonth(
      planInput({
        accounts: [CHECKING, BIZ],
        txs,
        entityProfiles: [{ entity: "Acme BV", scope: "business" }],
      }),
    );
    expect(r.figures.savingsMovedCents).toBe(0);
  });

  test("a transfer to an own current account is not savings", () => {
    const CUR2 = mkAccount("C2", { iban: "NL04INGB0000000004", balanceDate: "2026-10-20" });
    const txs = threeMonths([400, 400, 400], 3000).concat(MONTHS.map((m) => move(CUR2.iban, m)));
    const r = computeMonth(planInput({ accounts: [CHECKING, CUR2], txs }));
    expect(r.figures.savingsMovedCents).toBe(0);
  });

  test("no shortfall or 'could invest' figure exists in figures, flat or facts (key scan)", () => {
    const r = computeMonth(
      planInput({ accounts: [CHECKING], txs: threeMonths([100, 100, 100], 3000) }),
    );
    const keys = JSON.stringify([
      Object.keys(r.figures),
      Object.keys(r.flat),
      r.facts.map((f) => f.factId),
      r.calc.map((c) => c.id),
    ]);
    expect(keys).not.toMatch(/shortfall|invest|could|should|missing_rate/i);
    expect(r.figures.nibudGuidanceFactId).toBe("nibud-save-10pct");
  });
});

describe("scope and facts", () => {
  test("business-entity account txs excluded; no entities -> all counted", () => {
    const BIZ = mkAccount("B1", { entity: "Acme BV", balanceDate: "2026-10-20" });
    const bizTxs = MONTHS.flatMap((m) => [
      mkTx("Client", `${m}-01`, 9000, { accountKey: "B1", category: "Omzet" }),
      mkTx("Supplier", `${m}-15`, -1000, { accountKey: "B1", category: "Inkoop" }),
    ]);
    const txs = [...threeMonths([500, 500, 500], 3000), ...bizTxs];
    const scoped = computeMonth(
      planInput({
        accounts: [CHECKING, BIZ],
        txs,
        entityProfiles: [{ entity: "Acme BV", scope: "business" }],
      }),
    );
    expect(scoped.figures.incomeMiddleCents).toBe(300000);
    const all = computeMonth(planInput({ accounts: [CHECKING, BIZ], txs }));
    expect(all.figures.incomeMiddleCents).toBe(1200000);
  });

  test("negative middle room: room_month polarity negative and mustMention true", () => {
    const r = computeMonth(
      planInput({ accounts: [CHECKING], txs: threeMonths([-100, -200, -300], 3000) }),
    );
    const f = r.facts.find((x) => x.factId === "room_month")!;
    expect(f.exact).toBe(-20000);
    expect(f.polarity).toBe("negative");
    expect(f.mustMention).toBe(true);
    expect(r.facts.find((x) => x.factId === "room_year")).toMatchObject({
      exact: -240000,
      derivedFrom: ["room_month"],
    });
  });

  test("positive room: neutral polarity, ratio facts are fractions", () => {
    const r = computeMonth(
      planInput({
        accounts: [CHECKING],
        txs: threeMonths([500, 500, 500], 3000),
        profile: { fixedCostsMonthlyCents: 150000 },
      }),
    );
    const room = r.facts.find((x) => x.factId === "room_month")!;
    expect(room.polarity).toBe("neutral");
    expect(room.mustMention).toBe(false);
    expect(r.facts.find((x) => x.factId === "fixed_share")).toMatchObject({
      unit: "ratio",
      exact: 0.5,
    });
    expect(new Set(r.facts.map((f) => f.factId)).size).toBe(r.facts.length);
  });
});

describe("fix round 1", () => {
  const short = [
    mkTx("Employer", "2026-09-01", 3000, { category: "Salaris" }),
    mkTx("Shops", "2026-09-15", -2000, { category: "Boodschappen" }),
    mkTx("Shops", "2026-09-30", -10, { category: "Boodschappen" }),
  ];
  test("I2: computed room under 60 days WITH stated ranges -> stated room, status from its share", () => {
    const r = computeMonth(
      planInput({
        accounts: [CHECKING],
        txs: short,
        profile: {
          incomeStatedRange: { lowCents: 280000, highCents: 320000 },
          spendStatedRange: { lowCents: 180000, highCents: 220000 },
        },
      }),
    );
    expect(r.figures.room.kind).toBe("stated");
    expect(r.status).toBe("on-track");
  });
  test("I2: the same history WITHOUT stated ranges stays not-enough-data", () => {
    const r = computeMonth(planInput({ accounts: [CHECKING], txs: short }));
    expect(r.status).toBe("not-enough-data");
  });
  test("M1: 0.1 boundary is exact in cents on a large income", () => {
    const at = (net: number) =>
      computeMonth(planInput({ accounts: [CHECKING], txs: threeMonths([net, net, net], 3_000_000) })).status;
    expect(at(300_000)).toBe("on-track");
    expect(at(299_999.99)).toBe("attention");
  });
  test("M5: the savings-rate calc lists the per-month rates", () => {
    const r = computeMonth(planInput({ accounts: [CHECKING], txs: threeMonths([400, 400, 400], 3000) }));
    expect(Object.keys(r.calc.find((c) => c.id === "savings-rate")!.inputs).sort()).toEqual([
      "rate_2026_07", "rate_2026_08", "rate_2026_09",
    ]);
  });
  test("M6: a savings-to-savings own transfer is not 'moved to savings'", () => {
    const S1 = mkAccount("S1", { iban: "NL02INGB0000000002", type: "Spaarrekening", balanceDate: "2026-10-20" });
    const S2 = mkAccount("S2", { iban: "NL08INGB0000000008", type: "Spaarrekening", balanceDate: "2026-10-20" });
    const txs = threeMonths([400, 400, 400], 3000).concat(
      MONTHS.map((m) => mkTx("Own", `${m}-20`, -200, { accountKey: "S2", description: `to ${S1.iban}`, category: "" })),
    );
    const r = computeMonth(planInput({ accounts: [CHECKING, S1, S2], txs }));
    expect(r.figures.savingsMovedCents).toBe(0);
  });
  test("M7: fig and roomMiddleCents are not in the plan barrel", async () => {
    const barrel = (await import("./index.js")) as Record<string, unknown>;
    expect(barrel["fig"]).toBeUndefined();
    expect(barrel["roomMiddleCents"]).toBeUndefined();
  });
});
