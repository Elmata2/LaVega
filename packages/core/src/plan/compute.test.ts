import { describe, expect, test } from "vitest";
import type { Debt } from "../advisor/profile.js";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import type { Tx } from "../model.js";
import { ownAccounts } from "../views.js";
import { computePlan, snapshotOf, uniqueFactIds } from "./compute.js";
import { PLAN_ENGINE_VERSION } from "./factsheet.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import { AS_OF, planInput } from "./testkit.js";
import { SECTION_IDS, type PlanInput } from "./types.js";
import type { PlanGoal } from "./profileView.js";

const IBAN = "NL91ABNA0417164300";
const MERCHANTS = ["Netflix", "Employer BV", "Santander Consumer", "Albert Heijn"];

const flatValues = (r: ReturnType<typeof computePlan>) =>
  SECTION_IDS.flatMap((s) => Object.values(r.sections[s].flat));

/** Salary + groceries for 9 months, a Netflix stream with a price rise, a
 *  debt, a goal behind its schedule within 12 months, a child. */
function rich(over: Partial<PlanInput> = {}): PlanInput {
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
  const txs: Tx[] = [
    ...months.flatMap((m) => [
      mkTx("Employer BV", `2026-${m}-01`, 3000, { category: "Salaris" }),
      mkTx("Albert Heijn", `2026-${m}-15`, -900, { category: "Boodschappen" }),
      mkTx("Landlord", `2026-${m}-02`, -1000, { category: "Wonen" }),
    ]),
    ...["04", "05", "06", "07"].map((m) => mkTx("Netflix", `2026-${m}-05`, -9.99, { category: "Abonnementen" })),
    ...["08", "09", "10"].map((m) => mkTx("Netflix", `2026-${m}-05`, -11.79, { category: "Abonnementen" })),
  ];
  const debt: Debt = {
    id: "d1", lender: "Santander Consumer", monthlyCents: 30000, balanceCents: 900000,
    ratePct: 9.5, source: "confirmed", at: "2026-10-01",
  } as Debt;
  const goal: PlanGoal = {
    goal: {
      id: "g1", purpose: "Car", kind: "general", targetCents: 1_000_000,
      targetDate: "2027-03-01", priority: "important", accountRefs: [],
    } as PlanGoal["goal"],
    since: "2026-01-01",
  };
  return planInput({
    accounts: [mkAccount("A1", { iban: IBAN, balance: 2000, balanceDate: "2026-10-20" })],
    txs,
    profile: {
      debts: [debt], goals: [goal], children: [{ id: "c1", birthYear: 2020 }],
      bufferTargetMonths: 3, fixedCostsMonthlyCents: 150000,
      incomeStreams: [{ id: "s1", label: "Job", monthlyCents: 300000, regular: true }],
    },
    heldCards: [],
    ...over,
  });
}

describe("computePlan", () => {
  test("empty input: seven sections not-enough-data with typed missing, factSheet builds, no NaN", () => {
    const r = computePlan(planInput());
    expect(SECTION_IDS.map((s) => r.sections[s].section)).toEqual([...SECTION_IDS]);
    for (const s of SECTION_IDS) {
      const sec = r.sections[s];
      expect(sec.status, s).toBe("not-enough-data");
      expect(sec.statusReason.key, s).toBeTruthy();
    }
    expect(r.sections.debts.statusReason.key).toBe("debts-not-asked");
    expect(r.factSheet("nl").facts.length).toBe(r.facts.length);
    for (const f of flatValues(r)) {
      expect(typeof f.value === "number" ? Number.isFinite(f.value) : true).toBe(true);
    }
    expect(JSON.stringify(r.factSheet("en"))).not.toMatch(/NaN|Infinity/);
    expect(r.freshness).toEqual({ bankDataTo: null, profileConfirmedAt: null });
    expect(r.thresholdsVersion).toBe(PLAN_THRESHOLDS.version);
  });

  test("personal scope: accounts on a business entity change nothing", () => {
    const base = rich();
    const bizTxs = [
      mkTx("Customer", "2026-09-03", 9000, { accountKey: "B1", category: "Omzet" }),
      mkTx("Supplier", "2026-09-04", -4000, { accountKey: "B1", category: "Inkoop" }),
      mkTx("Netflix", "2026-09-05", -50, { accountKey: "B1" }),
    ];
    const withBiz = {
      ...base,
      accounts: [...base.accounts, mkAccount("B1", { entity: "BV1", balance: 50000, balanceDate: "2026-10-20" })],
      txs: [...base.txs, ...bizTxs],
      entityProfiles: [{ entity: "BV1", scope: "business" as const }],
    } as PlanInput;
    withBiz.own = ownAccounts(withBiz.accounts);
    const a = computePlan(base);
    const b = computePlan(withBiz);
    for (const s of SECTION_IDS) {
      expect(b.sections[s].flat).toEqual(a.sections[s].flat);
      expect(b.sections[s].status).toBe(a.sections[s].status);
    }
    expect(b.factSheet("nl").hash).toBe(a.factSheet("nl").hash);
  });

  test("pure: same input twice deep-equals on data; a different day in the month leaves non-date figures alone", () => {
    const data = (r: ReturnType<typeof computePlan>) => ({
      ...r,
      factSheet: r.factSheet("nl"),
    });
    const strip = (r: ReturnType<typeof computePlan>) => {
      const { factSheet: _f, ...rest } = data(r);
      return { ...rest, fs: data(r).factSheet };
    };
    expect(strip(computePlan(rich()))).toEqual(strip(computePlan(rich())));
    const a = computePlan(rich({ asOf: "2026-10-10" }));
    const b = computePlan(rich({ asOf: "2026-10-24" }));
    for (const s of ["month", "buffer", "debts", "subscriptions"] as const) {
      expect(b.sections[s].flat).toEqual(a.sections[s].flat);
    }
  });

  test("backbone has exactly four keys and no ordering or next field", () => {
    const r = computePlan(rich());
    expect(Object.keys(r.backbone).sort()).toEqual(
      ["buffer", "debtInterestPerYear", "goalsGap", "investingUnallocated"],
    );
    expect(r.backbone.debtInterestPerYear?.unit).toBe("cents");
    expect(r.backbone.goalsGap).toEqual({ unit: "cents", value: 1_000_000 });
    expect(computePlan(planInput()).backbone).toEqual({
      buffer: null, debtInterestPerYear: null, goalsGap: null, investingUnallocated: null,
    });
  });

  test("factSheet: hash differs by locale, stable across recompute, no duplicate ids, no merchant or IBAN strings (P5)", () => {
    const r = computePlan(rich());
    const r2 = computePlan(rich());
    expect(r.factSheet("nl").hash).not.toBe(r.factSheet("en").hash);
    expect(r.factSheet("nl").hash).toBe(r2.factSheet("nl").hash);
    expect(r.factSheet("nl", "digest").hash).not.toBe(r.factSheet("nl").hash);
    expect(new Set(r.facts.map((f) => f.factId)).size).toBe(r.facts.length);
    const sections = new Set(r.facts.map((f) => f.section));
    for (const s of ["month", "buffer", "debts", "subscriptions", "goals"] as const) {
      expect(sections.has(s)).toBe(true);
    }
    const blob = JSON.stringify(r.factSheet("nl").facts.map((f) => [f.factId, f.exact])).toLowerCase();
    for (const bad of [...MERCHANTS, IBAN, "nl91", "netflix", "employer", "santander", "landlord"]) {
      expect(blob).not.toContain(bad.toLowerCase());
    }
    for (const f of r.factSheet("nl").facts) {
      expect(typeof f.exact === "string" ? /^\d{4}-\d{2}-\d{2}$/.test(f.exact) : true).toBe(true);
    }
  });

  test("mustMention: negative room, goal behind, missed payment yes; a positive buffer gap no", () => {
    const neg = computePlan(
      rich({
        txs: [-1, -2, -3].map((k) => mkTx("Shops", `2026-0${6 + k + 3}-15`, -3500 * 1, {})).concat(
          ["07", "08", "09"].map((m) => mkTx("Employer BV", `2026-${m}-01`, 3000, { category: "Salaris" })),
        ),
      }),
    );
    expect(neg.facts.some((f) => f.section === "month" && f.mustMention)).toBe(true);
    const r = computePlan(rich());
    expect(r.facts.some((f) => f.section === "goals" && f.mustMention)).toBe(true);
    const gap = r.facts.find((f) => f.factId === "buffer_gap");
    expect(gap).toBeDefined();
    expect(gap!.exact).toBeGreaterThan(0);
    expect(gap!.mustMention).toBe(false);
    const missed = computePlan(
      rich({
        txs: [
          ...["01", "02", "03", "04"].map((m) => mkTx("Gym", `2026-${m}-05`, -30, { category: "Sport" })),
          ...["07", "08", "09", "10"].map((m) => mkTx("Gym", `2026-${m}-05`, -30, { category: "Sport" })),
          ...rich().txs,
        ],
      }),
    );
    expect(missed.sections.subscriptions.figures.rows.some((x) => x.facts.includes("missed-payment"))).toBe(true);
    expect(missed.facts.some((f) => f.section === "subscriptions" && f.mustMention)).toBe(true);
  });

  test("markers: income median, ids, flagged increase from the section, goal within 12m (floored), child, bufferBelowWish", () => {
    const r = computePlan(rich());
    expect(r.markers.incomeStreamIds).toEqual(["s1"]);
    expect(r.markers.debtIds).toEqual(["d1"]);
    expect(r.markers.childCount).toBe(1);
    expect(r.markers.goalsWithin12m).toEqual(["g1"]);
    expect(r.markers.flaggedIncreaseKeys).toEqual(
      r.sections.subscriptions.figures.rows.filter((x) => x.facts.includes("price-up")).map((x) => x.key).sort(),
    );
    expect(r.markers.flaggedIncreaseKeys.length).toBe(1);
    expect(r.markers.bufferBelowWish).toBe(r.sections.buffer.statusReason.key === "below-target");
    // exactly 12 months away counts; 13 does not; a past date does not
    const at = (d: string) =>
      computePlan(rich({ profile: { ...rich().profile, goals: [{ ...rich().profile.goals[0]!, goal: { ...rich().profile.goals[0]!.goal, targetDate: d } }] } })).markers.goalsWithin12m;
    expect(at("2027-10-24")).toEqual(["g1"]);
    expect(at("2027-11-24")).toEqual([]);
    expect(at("2026-10-01")).toEqual([]);
  });

  test("snapshotOf carries versions, trigger, profile hash and the sections' status and flat", () => {
    const r = computePlan(rich());
    const s = snapshotOf(r, "manual", "h1");
    expect(s).toMatchObject({
      asOf: AS_OF, thresholdsVersion: PLAN_THRESHOLDS.version, engineVersion: PLAN_ENGINE_VERSION,
      profileHash: "h1", trigger: "manual", markers: r.markers,
    });
    for (const id of SECTION_IDS) {
      expect(s.sections[id]).toEqual({
        status: r.sections[id].status,
        statusReason: r.sections[id].statusReason,
        flat: r.sections[id].flat,
      });
    }
  });

  test("freshness: bankDataTo is the newest personal-scope date up to asOf; profileConfirmedAt is the store's updatedAt", () => {
    expect(computePlan(rich()).freshness.bankDataTo).toBe("2026-10-05");
    const base = rich();
    const biz = {
      ...base,
      accounts: [...base.accounts, mkAccount("B1", { entity: "BV1" })],
      txs: [
        ...base.txs,
        mkTx("X", "2026-10-20", -5, { accountKey: "B1" }),
        mkTx("Future", "2026-12-01", -5, {}),
      ],
      entityProfiles: [{ entity: "BV1", scope: "business" as const }],
    } as PlanInput;
    expect(computePlan(biz).freshness.bankDataTo).toBe("2026-10-05");
    const withStore = { ...base, profile: { ...base.profile, profileUpdatedAt: "2026-10-23T09:00:00Z" } };
    expect(computePlan(withStore).freshness.profileConfirmedAt).toBe("2026-10-23T09:00:00Z");
  });

  test("fact ids stay unique when two categories or goal ids hash alike (Ab / BA)", () => {
    const base = rich();
    const extra = ["01", "02", "03", "04", "05", "06", "07", "08", "09"].flatMap((m) => [
      mkTx("Shop1", `2026-${m}-16`, -50, { category: "Ab" }),
      mkTx("Shop2", `2026-${m}-17`, -60, { category: "BA" }),
    ]);
    const g0 = base.profile.goals[0]!;
    const goals = ["Ab", "BA"].map((id) => ({ ...g0, goal: { ...g0.goal, id } }));
    const r = computePlan({ ...base, txs: [...base.txs, ...extra], profile: { ...base.profile, goals } });
    const ids = r.facts.map((f) => f.factId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((x) => x.startsWith("spend_last_month:")).length).toBeGreaterThanOrEqual(2);
    expect(() => r.factSheet("nl")).not.toThrow();
    expect(r.factSheet("nl").facts.length).toBe(ids.length);
    expect(computePlan({ ...base, txs: [...base.txs, ...extra], profile: { ...base.profile, goals } }).facts.map((f) => f.factId)).toEqual(ids);
  });

  test("uniqueFactIds suffixes repeats -3, -4 ... skipping ids already in use", () => {
    const f = (factId: string) => ({ factId, section: "month", exact: 1, unit: "count", polarity: "neutral", mustMention: false }) as never;
    expect(uniqueFactIds([f("a"), f("a"), f("b"), f("a"), f("a-2")]).map((x) => x.factId)).toEqual(["a", "a-3", "b", "a-4", "a-2"]);
  });
});
