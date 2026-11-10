import { describe, expect, test } from "vitest";
import { findAdviceLanguage } from "../advice/language.js";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import { computeBuffer } from "./buffer.js";
import { computeDebts } from "./debts.js";
import { computeGoals, studyCost, GOALS_CALC_IDS, type GoalsFigures } from "./goals.js";
import { computeMonth } from "./month.js";
import { emptyPlanPreferences } from "./preferences.js";
import { goalRequiredMonthly0, planInput } from "./testkit.js";
import type { PlanInput, SectionResult } from "./types.js";
import type { PlanGoal } from "./profileView.js";
import { lossIllustration } from "./scenarios.js";

const STATED = {
  incomeStatedRange: { lowCents: 100_000, highCents: 124_000 },
  spendStatedRange: { lowCents: 50_000, highCents: 60_000 },
}; // room 40_000 .. 74_000

const goal = (over: Partial<PlanGoal["goal"]> = {}, since = "2026-01-01"): PlanGoal => ({
  goal: {
    id: "g1",
    purpose: "Car",
    kind: "general",
    targetCents: 10_000_00,
    targetDate: "2036-10-24",
    priority: "important",
    accountRefs: [],
    ...over,
  } as PlanGoal["goal"],
  since,
});

const run = (i: PlanInput): SectionResult<GoalsFigures> => {
  const m = computeMonth(i);
  return computeGoals(i, m, computeBuffer(i, m), computeDebts(i));
};
const withGoals = (goals: PlanGoal[], over: Parameters<typeof planInput>[0] = {}) =>
  planInput({ ...over, profile: { ...STATED, goals, ...over.profile } });

describe("required monthly", () => {
  test("10_000 in 10 years, saved 0: 0% is ceil(1_000_000/120), 4% lower, rates 0,2,4,6", () => {
    const r = run(withGoals([goal()]));
    const row = r.figures.rows[0]!;
    expect(row.requiredMonthly.map((x) => x.rate)).toEqual([0, 0.02, 0.04, 0.06]);
    expect(row.requiredMonthly[0]!.cents).toBe(Math.ceil(1_000_000 / 120));
    expect(row.requiredMonthly[2]!.cents!).toBeLessThan(row.requiredMonthly[0]!.cents!);
    expect(row.yearsLeft).toBe(10);
    expect(row.toTargetByDate).toBe("2036-10-24");
  });
  test("past date: yearsLeft null, requiredMonthly null cents, behind against target, no Infinity", () => {
    const r = run(withGoals([goal({ targetDate: "2026-10-01" })]));
    const row = r.figures.rows[0]!;
    expect(row.yearsLeft).toBeNull();
    expect(row.requiredMonthly.every((x) => x.cents === null)).toBe(true);
    expect(row.behind).toBe(true);
    expect(row.scheduleCents).toBe(row.targetCents);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
  test("target today is not past: months floor to 1 (P7)", () => {
    const row = run(withGoals([goal({ targetDate: "2026-10-24" })])).figures.rows[0]!;
    expect(row.yearsLeft).toBeCloseTo(1 / 12, 10);
    expect(row.requiredMonthly[0]!.cents).toBe(10_000_00);
  });
  test("child goal without a date: years to 18 from birthYear", () => {
    const g = goal({ kind: "child", childId: "c1", targetDate: "" });
    const r = run(
      withGoals([g], {
        profile: { ...STATED, goals: [g], children: [{ id: "c1", birthYear: 2020 }] },
      }),
    );
    const row = r.figures.rows[0]!;
    expect(row.toTargetByDate).toBe("2038-12-31");
    expect(row.kind).toBe("child");
    expect(row.childId).toBe("c1");
    expect(row.yearsLeft).toBeGreaterThan(11);
  });
  test("undated goal without a child: no yearsLeft, null cents", () => {
    const row = run(withGoals([goal({ targetDate: "" })])).figures.rows[0]!;
    expect(row.yearsLeft).toBeNull();
    expect(row.toTargetByDate).toBeNull();
    expect(row.behind).toBeNull();
  });
});

describe("schedule", () => {
  test("behind when saved < straight-line schedule from since; equal is not behind", () => {
    // since 2026-04-24, target 2027-04-24 -> 12 months, 6 elapsed; start 0 -> schedule 500_000
    const g = (start: number) =>
      goal(
        { targetCents: 1_000_000, targetDate: "2027-04-24", startingBalanceCents: start },
        "2026-04-24",
      );
    const a = run(withGoals([g(500_000)])).figures.rows[0]!;
    expect(a.scheduleCents).toBe(750_000); // start 500_000 + 500_000*6/12
    expect(a.savedCents).toBe(500_000);
    expect(a.behind).toBe(true);
    const b = run(withGoals([g(750_000)])).figures.rows[0]!;
    expect(b.scheduleCents).toBe(875_000);
    expect(b.behind).toBe(true);
    // saved exactly equals schedule: start 0 gives schedule 500_000, saved linked 500_000
    const acc = mkAccount("S9", {
      iban: "NL09INGB0000000009",
      type: "Spaarrekening",
      balance: 5000,
      balanceDate: "2026-10-20",
    });
    const c = run(
      withGoals(
        [
          goal(
            {
              targetCents: 1_000_000,
              targetDate: "2027-04-24",
              accountRefs: [{ kind: "bank", id: "S9" }],
            },
            "2026-04-24",
          ),
        ],
        { accounts: [acc] },
      ),
    ).figures.rows[0]!;
    expect(c.scheduleCents).toBe(500_000);
    expect(c.savedCents).toBe(500_000);
    expect(c.behind).toBe(false);
  });
  test("gap and funded pct are numbers", () => {
    const row = run(withGoals([goal({ startingBalanceCents: 250_000 })])).figures.rows[0]!;
    expect(row.gapCents).toBe(750_000);
    expect(row.fundedRatio).toBe(0.25);
  });
});

describe("goal anchor (date, amount)", () => {
  // 12000 from 2026-01-01 to 2027-01-01; asOf 2026-10-24 = 9 months elapsed, line = 9000.
  const withAnchor = (anchor: { at: string; startCents: number } | null, typed: number) => {
    const g = goal({
      targetCents: 1_200_000,
      targetDate: "2027-01-01",
      startingBalanceCents: typed,
    });
    return run(
      withGoals([{ ...g, ...(anchor ? { since: anchor.at, startCents: anchor.startCents } : {}) }]),
    );
  };
  test("editing saved-so-far to the true figure does not put an on-track goal behind", () => {
    // The user typed 9000 today; the anchor moves to (today, 9000) with it.
    const r = withAnchor({ at: "2026-10-24", startCents: 900_000 }, 900_000);
    const row = r.figures.rows[0]!;
    expect(row.scheduleCents).toBe(900_000);
    expect(row.behind).toBe(false);
    expect(r.status).toBe("on-track");
  });
  test("an old anchor keeps the original line (0 on 2026-01-01): typed 9000 sits exactly on it", () => {
    const row = withAnchor({ at: "2026-01-01", startCents: 0 }, 900_000).figures.rows[0]!;
    expect(row.scheduleCents).toBe(900_000);
    expect(row.behind).toBe(false);
  });
  test("without an anchor the goal's own typed balance and first-seen date are used (as before)", () => {
    const row = withAnchor(null, 900_000).figures.rows[0]!;
    expect(row.scheduleCents).toBe(1_125_000);
  });
  test("the row names the date its schedule starts from", () => {
    expect(
      withAnchor({ at: "2026-10-24", startCents: 900_000 }, 900_000).figures.rows[0]!.scheduleFrom,
    ).toBe("2026-10-24");
  });
});

describe("saved", () => {
  const SAV = (key: string, balance: number, o = {}) =>
    mkAccount(key, {
      iban: `NL0${key}INGB000000000${key}`,
      type: "Spaarrekening",
      balance,
      balanceDate: "2026-10-20",
      ...o,
    });
  test("linked EUR account is saved and is exactly what the buffer excluded", () => {
    const accounts = [SAV("2", 1000), SAV("3", 4100)];
    const i = withGoals([goal({ accountRefs: [{ kind: "bank", id: "2" }] })], {
      accounts,
      profile: {
        ...STATED,
        goals: [goal({ accountRefs: [{ kind: "bank", id: "2" }] })],
        fixedCostsMonthlyCents: 170_000,
        bufferTargetMonths: 4,
      },
    });
    const m = computeMonth(i);
    const buf = computeBuffer(i, m);
    const row = computeGoals(i, m, buf, computeDebts(i)).figures.rows[0]!;
    expect(row.savedCents).toBe(100_000);
    expect(row.savedSource).toBe("linked");
    expect(row.linkedAccountCount).toBe(1);
    expect(row.savedCents).toBe(buf.figures.goalLinkedExcludedCents);
    expect(buf.figures.liquidSavingsCents).toBe(410_000);
  });
  test("no linked account: startingBalanceCents, savedSource stated; foreign linked excluded", () => {
    const fx = SAV("4", 380000, { currency: "HUF" });
    const row = run(
      withGoals([goal({ startingBalanceCents: 7_000, accountRefs: [{ kind: "bank", id: "4" }] })], {
        accounts: [fx],
      }),
    ).figures.rows[0]!;
    expect(row.savedCents).toBe(7_000);
    expect(row.savedSource).toBe("stated");
    expect(row.linkedAccountCount).toBe(0);
  });
  test("broker ref not counted and reported; orphan bank ref ignored", () => {
    const row = run(
      withGoals([
        goal({
          startingBalanceCents: 100,
          accountRefs: [
            { kind: "broker", id: "B1" },
            { kind: "bank", id: "gone" },
          ],
        }),
      ]),
    ).figures.rows[0]!;
    expect(row.brokerRefsNotCounted).toBe(1);
    expect(row.savedCents).toBe(100);
    expect(row.savedSource).toBe("stated");
  });
});

describe("fix round 1", () => {
  const S9 = mkAccount("S9", {
    iban: "NL09INGB0000000009",
    type: "Spaarrekening",
    balance: 5000,
    balanceDate: "2026-10-20",
  });
  const ref = (id: string) => ({ kind: "bank" as const, id });
  test("repeated ref deduped; shared account counted once in loss and buffer reconciliation", () => {
    const a = goal({ id: "a", accountRefs: [ref("S9")] });
    const b = goal({ id: "b", accountRefs: [ref("S9"), ref("S9")] });
    const i = withGoals([a, b], {
      accounts: [S9],
      profile: { ...STATED, goals: [a, b], fixedCostsMonthlyCents: 170_000, bufferTargetMonths: 4 },
    });
    const m = computeMonth(i);
    const buf = computeBuffer(i, m);
    const r = computeGoals(i, m, buf, computeDebts(i));
    expect(r.figures.rows.map((x) => x.savedCents)).toEqual([500_000, 500_000]);
    expect(r.figures.rows.map((x) => x.linkedAccountCount)).toEqual([1, 1]);
    expect(r.figures.rows.map((x) => x.sharedWithGoals)).toEqual([1, 1]);
    expect(buf.figures.goalLinkedExcludedCents).toBe(500_000);
    // 2 x 10_000 target, one 5_000 account: 15_000 still to save, not 10_000.
    expect(r.figures.totalGapCents).toBe(1_500_000);
    expect(r.figures.rows.map((x) => x.allocatedSavedCents)).toEqual([250_000, 250_000]);
    expect(r.figures.loss).toBeNull();
  });
  test("distinct accounts plus stated balances of unlinked goals form the total", () => {
    const a = goal({ id: "a", accountRefs: [ref("S9")] });
    const c = goal({ id: "c", startingBalanceCents: 100_000 });
    const r = run(withGoals([a, c], { accounts: [S9] }));
    expect(r.figures.rows.map((x) => x.allocatedSavedCents)).toEqual([500_000, 100_000]);
    expect(r.figures.totalGapCents).toBe(1_400_000);
    expect(r.figures.rows[1]!.sharedWithGoals).toBe(0);
  });
  test("unknown-balance and foreign linked accounts are counted per row", () => {
    const unk = mkAccount("U1", { iban: "NL01INGB0000000011", type: "Spaarrekening" });
    const fx = mkAccount("F1", {
      iban: "HU01INGB0000000012",
      type: "Spaarrekening",
      currency: "HUF",
      balance: 9,
      balanceDate: "2026-10-20",
    });
    const g = goal({ accountRefs: [ref("S9"), ref("U1"), ref("F1")] });
    const row = run(withGoals([g], { accounts: [S9, unk, fx] })).figures.rows[0]!;
    expect(row.linkedAccountCount).toBe(1);
    expect(row.linkedExcludedCount).toBe(2);
    expect(row.savedCents).toBe(500_000);
  });
  test("undated goals only: not-enough-data no-goal-dates with goal-date missing", () => {
    const r = run(withGoals([goal({ targetDate: "", plannedMonthlyCents: 100 })]));
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("no-goal-dates");
    expect(r.missing).toContainEqual({ kind: "goal-date", action: "enter-figure", ref: "g1" });
  });
  test("one dated goal not behind -> on-track", () => {
    expect(run(withGoals([goal({ startingBalanceCents: 1_000_000 })])).status).toBe("on-track");
  });
  test("undated child goal targets year-end of the 18th year", () => {
    const g = goal({ kind: "child", childId: "c1", targetDate: "" });
    const row = run(
      withGoals([g], {
        profile: { ...STATED, goals: [g], children: [{ id: "c1", birthYear: 2008 }] },
      }),
    ).figures.rows[0]!;
    expect(row.toTargetByDate).toBe("2026-12-31");
    expect(row.yearsLeft).not.toBeNull();
  });
  test("since after asOf clamps elapsed to 0", () => {
    const row = run(withGoals([goal({ startingBalanceCents: 100_000 }, "2027-01-01")])).figures
      .rows[0]!;
    expect(row.scheduleCents).toBe(100_000);
  });
});

describe("unallocated", () => {
  const buffered = (extra: Partial<PlanInput["profile"]> = {}, prefs = emptyPlanPreferences()) => {
    const acc = [
      mkAccount("S1", {
        iban: "NL02INGB0000000002",
        type: "Spaarrekening",
        balance: 1000,
        balanceDate: "2026-10-20",
      }),
    ];
    return planInput({
      accounts: acc,
      preferences: prefs,
      profile: {
        ...STATED,
        fixedCostsMonthlyCents: 100_000,
        bufferTargetMonths: 3,
        goals: [goal({ plannedMonthlyCents: 12_000 })],
        ...extra,
      },
    });
  };
  test("room 40_000..74_000, top-up 5_000, goals 12_000 -> 23_000 / 57_000", () => {
    // liquid 100_000, target 3*100_000 -> gap 200_000; 40 months -> 5_000
    const i = buffered(
      {},
      { ...emptyPlanPreferences(), bufferTopUpMonths: { months: 40, at: "2026-10-01" } },
    );
    const u = run(i).figures.unallocated;
    expect(u).toEqual({
      kind: "computed",
      lowCents: 23_000,
      highCents: 57_000,
      deductions: {
        bufferTopUpMonthlyCents: 5_000,
        goalsMonthlyCents: 12_000,
        goalsPlannedCents: 12_000,
        goalsRequiredCents: 0,
      },
      roomLowCents: 40_000,
      roomHighCents: 74_000,
    });
  });
  test("a wished buffer whose gap cannot be computed stops the line instead of assuming a full buffer", () => {
    // Fixed costs known and a target, but no savings figure at all -> gap null.
    const i = planInput({
      accounts: [],
      profile: {
        ...STATED,
        goals: [goal({ plannedMonthlyCents: 12_000 })],
        fixedCostsMonthlyCents: 100_000,
        bufferTargetMonths: 3,
      },
    });
    const r = run(i);
    expect(r.figures.unallocated).toEqual({ kind: "stopped", missing: ["buffer-top-up"] });
  });
  test("stale room (month section data-stale): the line stops and names the stale data", () => {
    const OLD = ["2026-03", "2026-04", "2026-05", "2026-06"];
    const txs = OLD.flatMap((m) => [
      mkTx("Employer", `${m}-01`, 3000, { category: "Salaris" }),
      mkTx("Shops", `${m}-30`, -2000, { category: "Boodschappen" }),
    ]);
    const i = planInput({
      accounts: [mkAccount("A1", { iban: "NL01INGB0000000001", balanceDate: "2026-06-30" })],
      txs,
      profile: { fixedCostsMonthlyCents: 100_000, goals: [goal({ plannedMonthlyCents: 12_000 })] },
    });
    expect(computeMonth(i).statusReason.key).toBe("data-stale");
    expect(run(i).figures.unallocated).toEqual({ kind: "stopped", missing: ["room-stale"] });
  });
  test("no buffer target: no top-up is implied and the line computes", () => {
    const i = planInput({
      accounts: [],
      profile: { ...STATED, goals: [goal({ plannedMonthlyCents: 12_000 })] },
    });
    expect(run(i).figures.unallocated.kind).toBe("computed");
  });
  test("the deduction names which goals used the user's planned amount and which LaVega's 0% requirement", () => {
    const planned = goal({ id: "p", plannedMonthlyCents: 20_000 });
    const needed = goal({ id: "n", targetCents: 1_200_000, targetDate: "2027-10-24" });
    const r = run(withGoals([planned, needed]));
    expect(r.figures.rows.map((x) => x.deduction.source)).toEqual(["planned", "required"]);
    const u = r.figures.unallocated;
    expect(u.kind).toBe("computed");
    if (u.kind === "computed") {
      expect(u.deductions.goalsPlannedCents).toBe(20_000);
      expect(u.deductions.goalsRequiredCents).toBe(100_000);
      expect(u.deductions.goalsMonthlyCents).toBe(120_000);
    }
  });
  test("shared account: the deduction splits the balance between the goals that link it", () => {
    const S = mkAccount("S9", {
      iban: "NL09INGB0000000009",
      type: "Spaarrekening",
      balance: 8000,
      balanceDate: "2026-10-20",
    });
    const mk = (id: string) =>
      goal({
        id,
        targetCents: 1_000_000,
        targetDate: "2027-10-24",
        accountRefs: [{ kind: "bank", id: "S9" }],
      });
    const r = run(withGoals([mk("car"), mk("trip")], { accounts: [S] }));
    // each goal is charged 4_000 of the 8_000: (10_000 - 4_000) / 12 months
    expect(r.figures.rows.map((x) => x.deduction.cents)).toEqual([50_000, 50_000]);
    expect(r.figures.totalGapCents).toBe(1_200_000);
  });
  test("shared account: behind, gap and funded use the equal split, not the full balance", () => {
    const S = mkAccount("S9", {
      iban: "NL09INGB0000000009",
      type: "Spaarrekening",
      balance: 8000,
      balanceDate: "2026-10-20",
    });
    const mk = (id: string) =>
      goal({
        id,
        targetCents: 1_000_000,
        targetDate: "2027-01-01",
        accountRefs: [{ kind: "bank", id: "S9" }],
      });
    const r = run(withGoals([mk("car"), mk("trip")], { accounts: [S] }));
    for (const row of r.figures.rows) {
      expect(row.savedCents).toBe(800_000); // the row still shows the whole balance
      expect(row.allocatedSavedCents).toBe(400_000);
      expect(row.fundedRatio).toBe(0.4);
      expect(row.gapCents).toBe(600_000);
      expect(row.behind).toBe(true); // 4_000 allocated is below the schedule line
    }
    expect(r.status).toBe("attention");
  });
  test("buffer gap but no top-up months -> stopped buffer-top-up", () => {
    expect(run(buffered()).figures.unallocated).toEqual({
      kind: "stopped",
      missing: ["buffer-top-up"],
    });
  });
  test("buffer exactly at target (gap 0) needs no top-up months and is not stopped", () => {
    const u = run(buffered({ bufferTargetMonths: 1 })).figures.unallocated;
    expect(u).toEqual({
      kind: "computed",
      lowCents: 28_000,
      highCents: 62_000,
      deductions: {
        bufferTopUpMonthlyCents: 0,
        goalsMonthlyCents: 12_000,
        goalsPlannedCents: 12_000,
        goalsRequiredCents: 0,
      },
      roomLowCents: 40_000,
      roomHighCents: 74_000,
    });
  });

  test("room not computed -> stopped room", () => {
    const i = planInput({ profile: { goals: [goal({ plannedMonthlyCents: 1 })] } });
    const r = run(i);
    expect(r.figures.unallocated).toEqual({ kind: "stopped", missing: ["room"] });
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("no-room");
  });
  test("goal with neither planned nor required monthly (undated) stops with goal-monthly", () => {
    const i = withGoals([goal({ targetDate: "" })]);
    expect(run(i).figures.unallocated).toEqual({ kind: "stopped", missing: ["goal-monthly"] });
  });
  test("negative room low gives a negative number, not clamped", () => {
    const i = planInput({
      profile: {
        incomeStatedRange: { lowCents: 100_000, highCents: 150_000 },
        spendStatedRange: { lowCents: 90_000, highCents: 130_000 },
        goals: [goal({ plannedMonthlyCents: 10_000 })],
      },
    });
    const u = run(i).figures.unallocated;
    expect(u.kind).toBe("computed");
    if (u.kind === "computed") {
      expect(u.lowCents).toBe(-30_000 - 10_000);
      expect(u.highCents).toBe(60_000 - 10_000);
    }
  });
  test("uses requiredMonthly at 0% when no planned amount", () => {
    const u = run(withGoals([goal()])).figures.unallocated;
    expect(u.kind).toBe("computed");
    if (u.kind === "computed")
      expect(u.deductions.goalsMonthlyCents).toBe(goalRequiredMonthly0(1_000_000, 120));
  });
});

describe("capacity, loss, study, status, facts", () => {
  test("capacity vs tolerance disagreement and unknown", () => {
    const base = withGoals([goal()]);
    const r = run({ ...base, profile: { ...base.profile, tolerance: null } });
    expect(r.figures.disagreement).toBe("unknown");
    expect(r.figures.toleranceScore).toBeNull();
    const cap = r.figures.capacity.score;
    if (cap !== null) {
      const t = (cap >= 3 ? 1 : 5) as 1 | 5;
      const r2 = run({ ...base, profile: { ...base.profile, tolerance: t } });
      expect(r2.figures.disagreement).toBe(Math.abs(cap - t) >= 2 ? "disagree" : "agree");
    }
    const none = run(planInput({ profile: { goals: [], tolerance: 3 } }));
    expect(none.figures.capacity.score).toBeNull();
    expect(none.figures.disagreement).toBe("unknown");
  });
  test("capacity equals the moved core capacityFor figure", async () => {
    const { capacityForParts } = await import("../advisor/resolve.js");
    const i = withGoals([goal()], {
      profile: {
        ...STATED,
        goals: [goal()],
        savingsStatedCents: 500_000,
        fixedCostsMonthlyCents: 100_000,
        tolerance: 3,
      },
    });
    const m = computeMonth(i);
    const want = capacityForParts(
      {
        savingsCents: 500_000,
        fixedCostsMonthlyCents: 100_000,
        debtMonthlyCents: [],
        goals: [{ targetDate: "2036-10-24" }],
      },
      m.figures.room,
      i.asOf,
    );
    expect(run(i).figures.capacity).toEqual(want);
  });
  test("loss illustration is hidden while no invested amount is in the inputs (never applied to bank savings)", () => {
    const g = goal({ startingBalanceCents: 200_000 });
    const g2 = goal({ id: "g2", startingBalanceCents: 100_000 });
    const r = run(withGoals([g, g2]));
    expect(r.figures.loss).toBeNull();
    expect(r.calc.map((c) => c.id)).not.toContain("loss-illustration");
    expect(run(withGoals([])).figures.loss).toBeNull();
    // The maths itself stays tested in scenarios.test.ts.
    expect(
      lossIllustration({ amountCents: 300_000, fallPct: 30, roomMiddleCents: 57_000 }).lossCents,
    ).toBe(90_000);
  });
  test("study template is null until entered; studyCost inflates integer cents", () => {
    expect(run(withGoals([goal()])).figures.study).toBeNull();
    const a = {
      monthlyCostCents: 100_000,
      months: 40,
      tuitionCents: 220_000,
      inflationPct: 2,
      at: "2026-10-01",
    };
    const prefs = { ...emptyPlanPreferences(), studyCostAssumptions: a };
    const s = run(withGoals([goal()], { preferences: prefs })).figures.study;
    expect(s).toEqual({
      totalCents: 4_220_000,
      monthlyCostCents: 100_000,
      months: 40,
      tuitionCents: 220_000,
      inflationPct: 2,
    });
    expect(studyCost(a, 0)).toBe(4_220_000);
    expect(studyCost(a, 10)).toBe(Math.round(4_220_000 * 1.02 ** 10));
    expect(Number.isInteger(studyCost(a, 7))).toBe(true);
  });
  test("status: no goals / no room / behind / on-track", () => {
    const none = run(withGoals([]));
    expect(none.status).toBe("not-enough-data");
    expect(none.statusReason.key).toBe("no-goals");
    expect(none.missing.map((m) => m.kind)).toContain("goals");
    expect(run(withGoals([goal({ targetDate: "2026-10-01" })])).status).toBe("attention");
    expect(run(withGoals([goal({ targetDate: "2026-10-01" })])).statusReason.key).toBe(
      "behind-schedule",
    );
    const ok = run(withGoals([goal({ startingBalanceCents: 1_000_000 })]));
    expect(ok.status).toBe("on-track");
    expect(ok.statusReason.key).toBe("on-schedule");
  });
  test("facts: goal_gap negative+mustMention when behind; ids charset; hashed odd ids", () => {
    const r = run(withGoals([goal({ targetDate: "2026-10-01" }), goal({ id: "Goal One!" })]));
    const gap = r.facts.find((f) => f.factId === "goal_gap:g1")!;
    expect(gap.exact).toBe(0 - 1_000_000);
    expect(gap.polarity).toBe("negative");
    expect(gap.mustMention).toBe(true);
    for (const f of r.facts) expect(f.factId).toMatch(/^[a-z0-9_:-]+$/);
    expect(r.facts.some((f) => f.factId.includes("Goal"))).toBe(false);
    expect(r.facts.map((f) => f.factId)).toEqual(
      expect.arrayContaining(["goal_funded_ratio:g1", "unallocated_low", "unallocated_high"]),
    );
    expect(
      r.facts.some(
        (f) => f.factId.startsWith("goal_required_monthly:") && !f.factId.endsWith(":g1"),
      ),
    ).toBe(true);
    expect(r.facts.find((f) => f.factId === "goal_funded_ratio:g1")!.unit).toBe("ratio");
  });
  test("tolerance and capacity facts are emitted when known", () => {
    const i = withGoals([goal()], {
      profile: {
        ...STATED,
        goals: [goal()],
        tolerance: 3,
        savingsStatedCents: 500_000,
        fixedCostsMonthlyCents: 100_000,
      },
    });
    const ids = run(i).facts.map((f) => f.factId);
    expect(ids).toContain("tolerance_score");
  });
  test("no computed gift / box3 / allowance keys; pendingFacts lists the pending ids", () => {
    const r = run(withGoals([goal()]));
    expect(JSON.stringify(Object.keys(r.figures)).toLowerCase()).not.toMatch(/box3|gift|allowance/);
    expect(r.figures.pendingFacts).toContain("gift-tax-annual-2026");
    expect(r.figures.pendingFacts).toHaveLength(16);
  });
  test("calc ids are within GOALS_CALC_IDS and no output has banned words", () => {
    const r = run(withGoals([goal()]));
    for (const c of r.calc) expect(GOALS_CALC_IDS).toContain(c.id);
    const text = JSON.stringify([
      r.calc,
      r.facts.map((f) => f.factId),
      r.statusReason,
      Object.keys(r.flat),
    ]);
    expect(findAdviceLanguage(text, "en")).toEqual([]);
    expect(text).not.toMatch(/invest|recommend|best/i);
  });
  test("scenario table is the public one", () => {
    expect(run(withGoals([goal()])).figures.scenarioTable.cells).toHaveLength(6);
  });
});
