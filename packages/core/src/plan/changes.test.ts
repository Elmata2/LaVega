import { describe, expect, test } from "vitest";
import { diffSnapshots, refreshDecision, topChanges } from "./changes.js";
import { PLAN_ENGINE_VERSION } from "./factsheet.js";
import type { PlanMarkers, PlanSnapshot } from "./preferences.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import { SECTION_IDS, type FigureMap, type PlanStatus, type SectionId } from "./types.js";

const markers = (o: Partial<PlanMarkers> = {}): PlanMarkers => ({
  incomeMedianCents: 310000,
  incomeStreamIds: ["s1"],
  flaggedIncreaseKeys: [],
  goalsWithin12m: [],
  debtIds: [],
  childCount: 0,
  cardKeys: [],
  pointsProgramIds: [],
  bufferBelowWish: false,
  ...o,
});

const snap = (
  o: {
    asOf?: string;
    flat?: Partial<Record<SectionId, FigureMap>>;
    status?: Partial<Record<SectionId, PlanStatus>>;
    markers?: Partial<PlanMarkers>;
    profileHash?: string;
    thresholdsVersion?: string;
    engineVersion?: string;
  } = {},
): PlanSnapshot => ({
  asOf: o.asOf ?? "2026-10-24",
  thresholdsVersion: o.thresholdsVersion ?? PLAN_THRESHOLDS.version,
  engineVersion: o.engineVersion ?? PLAN_ENGINE_VERSION,
  profileHash: o.profileHash ?? "h",
  trigger: "manual",
  markers: markers(o.markers),
  sections: Object.fromEntries(
    SECTION_IDS.map((s) => [
      s,
      {
        status: o.status?.[s] ?? "on-track",
        statusReason: { key: "room-ok" },
        flat: o.flat?.[s] ?? {},
      },
    ]),
  ) as PlanSnapshot["sections"],
});

const cents = (value: number | null) => ({ unit: "cents" as const, value });

describe("diffSnapshots", () => {
  test("income 3100 -> 3400 reports income-stream-changed; below noise omitted; nothing material -> false", () => {
    const prev = snap({
      flat: { month: { room_middle: cents(310000), small: cents(100) } },
      markers: { incomeMedianCents: 300000 },
    });
    const next = snap({
      flat: { month: { room_middle: cents(340000), small: cents(100 + 999) } },
      markers: { incomeMedianCents: 400000 },
    });
    const d = diffSnapshots(prev, next);
    expect(d.baseline).toBe(false);
    expect(d.changes).toEqual([
      {
        section: "month",
        figureId: "room_middle",
        unit: "cents",
        before: 310000,
        after: 340000,
        reason: { key: "income-stream-changed" },
      },
    ]);
    expect(d.material).toBe(true);
    const quiet = diffSnapshots(
      prev,
      snap({
        flat: { month: { room_middle: cents(310000), small: cents(1099) } },
        markers: { incomeMedianCents: 300000 },
      }),
    );
    expect(quiet.changes).toEqual([]);
    expect(quiet.material).toBe(false);
    // exactly the noise bound is kept
    const edge = diffSnapshots(
      prev,
      snap({
        flat: { month: { room_middle: cents(310000), small: cents(1100) } },
        markers: { incomeMedianCents: 300000 },
      }),
    );
    expect(edge.changes.map((c) => c.figureId)).toEqual(["small"]);
  });

  test("noise per unit: months 0.1, ratio 0.01 fraction, pct 0.1 points", () => {
    const f = (unit: "months" | "ratio" | "pct", v: number) => ({ x: { unit, value: v } });
    const run = (unit: "months" | "ratio" | "pct", a: number, b: number) =>
      diffSnapshots(snap({ flat: { buffer: f(unit, a) } }), snap({ flat: { buffer: f(unit, b) } }))
        .changes.length;
    expect(run("months", 2, 2.05)).toBe(0);
    expect(run("months", 2, 2.2)).toBe(1);
    expect(run("ratio", 0.2, 0.205)).toBe(0);
    expect(run("ratio", 0.2, 0.25)).toBe(1);
    expect(run("pct", 2, 2.05)).toBe(0);
    expect(run("pct", 2, 2.5)).toBe(1);
  });

  test("noise bound is on the absolute change: a large fall is reported; a float-short step of exactly the bound is too", () => {
    const f = (unit: "months" | "cents", v: number) => ({ x: { unit, value: v } });
    const n = (unit: "months" | "cents", a: number, b: number) =>
      diffSnapshots(snap({ flat: { buffer: f(unit, a) } }), snap({ flat: { buffer: f(unit, b) } }))
        .changes.length;
    expect(n("months", 3, 2)).toBe(1);
    expect(n("cents", 500_000, 100_000)).toBe(1);
    // 0.3 - 0.2 is 0.09999999999999998 in floats: still the 0.1 bound, so a change
    expect(n("months", 0.2, 0.3)).toBe(1);
    expect(n("months", 0.2, 0.25)).toBe(0);
  });

  test("null to a number is reported with before null; a figure that vanished has after null", () => {
    const d = diffSnapshots(
      snap({ flat: { debts: { gone: cents(500000) }, buffer: { x: cents(null) } } }),
      snap({ flat: { debts: {}, buffer: { x: cents(900000) } } }),
    );
    expect(d.changes).toEqual([
      {
        section: "buffer",
        figureId: "x",
        unit: "cents",
        before: null,
        after: 900000,
        reason: { key: "figure-changed" },
      },
      {
        section: "debts",
        figureId: "gone",
        unit: "cents",
        before: 500000,
        after: null,
        reason: { key: "figure-changed" },
      },
    ]);
  });

  test("reasons are scoped to the figures they explain, using the trigger predicates", () => {
    const one = (
      section: SectionId,
      figureId: string,
      m: Partial<PlanMarkers>,
      extra: { profileHash?: string } = {},
    ) =>
      diffSnapshots(
        snap({ flat: { [section]: { [figureId]: cents(100000) } } }),
        snap({ flat: { [section]: { [figureId]: cents(900000) } }, markers: m, ...extra }),
      ).changes[0]!.reason;
    expect(one("month", "income_middle", { incomeMedianCents: 400000 })).toEqual({
      key: "income-stream-changed",
    });
    expect(one("month", "income_middle", { incomeStreamIds: ["s1", "s2"] })).toEqual({
      key: "income-stream-changed",
    });
    // a 1-cent median move is not an income change, and fixed_share is not an income figure
    expect(one("month", "income_middle", { incomeMedianCents: 310001 })).toEqual({
      key: "figure-changed",
    });
    expect(one("month", "fixed_share", { incomeMedianCents: 400000 })).toEqual({
      key: "figure-changed",
    });
    expect(one("subscriptions", "sub_total_year", { flaggedIncreaseKeys: ["k"] })).toEqual({
      key: "price-increase-flagged",
    });
    expect(one("goals", "goals_within_12m", { goalsWithin12m: ["g"] })).toEqual({
      key: "goal-date-near",
    });
    expect(one("goals", "capacity_score", { goalsWithin12m: ["g"] })).toEqual({
      key: "figure-changed",
    });
    expect(one("buffer", "buffer_months", { bufferBelowWish: true })).toEqual({
      key: "buffer-below-wish",
    });
    expect(one("debts", "debt_count", { debtIds: ["d"] })).toEqual({ key: "debt-added" });
    expect(one("goals", "goals_count", { childCount: 1 })).toEqual({ key: "child-added" });
    expect(one("cards", "cards_held_count", { cardKeys: ["c"] })).toEqual({ key: "card-added" });
    expect(one("cards", "cards_held_count", { pointsProgramIds: ["p"] })).toEqual({
      key: "points-added",
    });
    expect(one("debts", "debt_interest_year_total", {}, { profileHash: "other" })).toEqual({
      key: "profile-edited",
    });
    // bank-driven figures are never blamed on a profile edit
    expect(one("spending", "spend_last_month_total", {}, { profileHash: "other" })).toEqual({
      key: "figure-changed",
    });
    expect(one("spending", "spend_last_month_total", {})).toEqual({ key: "figure-changed" });
  });

  test("one month later with the same behaviour: coverage, month counts, dates are not changes", () => {
    const a = snap({
      asOf: "2026-09-24",
      flat: {
        spending: {
          spend_months: { unit: "count", value: 8 },
          spend_last_month: { unit: "date", value: "2026-08-31" },
          spend_first_month: { unit: "date", value: "2026-01-01" },
          spend_foreign_excluded: { unit: "count", value: 0 },
        },
        subscriptions: {
          sub_coverage_days: { unit: "count", value: 226 },
          sub_foreign_excluded: { unit: "count", value: 0 },
        },
        cards: {
          cards_months: { unit: "count", value: 8 },
          cards_foreign_excluded: { unit: "count", value: 0 },
        },
      },
    });
    const b = snap({
      flat: {
        spending: {
          spend_months: { unit: "count", value: 9 },
          spend_last_month: { unit: "date", value: "2026-09-30" },
          spend_first_month: { unit: "date", value: "2025-12-01" },
          spend_foreign_excluded: { unit: "count", value: 1 },
        },
        subscriptions: {
          sub_coverage_days: { unit: "count", value: 257 },
          sub_foreign_excluded: { unit: "count", value: 1 },
        },
        cards: {
          cards_months: { unit: "count", value: 9 },
          cards_foreign_excluded: { unit: "count", value: 1 },
        },
      },
    });
    const d = diffSnapshots(a, b);
    expect(d.changes).toEqual([]);
    expect(d.material).toBe(false);
    expect(topChanges(d)).toEqual([]);
  });

  test("sub_fixed_excluded is bookkeeping: absent in the old snapshot, 0 or 2 in the new one, no change", () => {
    const a = snap({ flat: { subscriptions: { sub_count: { unit: "count", value: 3 } } } });
    for (const v of [0, 2]) {
      const b = snap({
        flat: {
          subscriptions: {
            sub_count: { unit: "count", value: 3 },
            sub_fixed_excluded: { unit: "count", value: v },
          },
        },
      });
      const d = diffSnapshots(a, b);
      expect(d.changes).toEqual([]);
      expect(d.material).toBe(false);
    }
  });

  test("a plan-1 snapshot (subscriptions once counted fixed costs) gives a baseline, not a subscriptions drop", () => {
    expect(PLAN_ENGINE_VERSION).toBe("plan-2");
    const old = snap({
      engineVersion: "plan-1",
      flat: {
        subscriptions: {
          sub_total_month: cents(123100),
          sub_total_year: cents(1477200),
          sub_count: { unit: "count", value: 9 },
        },
      },
    });
    const now = snap({
      flat: {
        subscriptions: {
          sub_total_month: cents(12100),
          sub_total_year: cents(145200),
          sub_count: { unit: "count", value: 4 },
        },
      },
    });
    expect(diffSnapshots(old, now)).toEqual({
      changes: [],
      statusChanges: [],
      material: false,
      baseline: true,
    });
  });

  test("across a thresholdsVersion or engineVersion bump, and with no previous: baseline, no figure changes", () => {
    const a = snap({ flat: { month: { x: cents(1) } } });
    const b = snap({
      flat: { month: { x: cents(99999999) } },
      thresholdsVersion: "plan-thresholds-0",
    });
    const d = diffSnapshots(a, b);
    expect(d).toEqual({ changes: [], statusChanges: [], material: false, baseline: true });
    expect(
      diffSnapshots(a, snap({ engineVersion: "plan-0", status: { month: "attention" } })).baseline,
    ).toBe(true);
    expect(diffSnapshots(null, a)).toEqual({
      changes: [],
      statusChanges: [],
      material: false,
      baseline: true,
    });
  });

  test("status changes list old and new in section order and count as material", () => {
    const d = diffSnapshots(
      snap(),
      snap({ status: { goals: "attention", buffer: "not-enough-data" } }),
    );
    expect(d.statusChanges).toEqual([
      { section: "buffer", before: "on-track", after: "not-enough-data" },
      { section: "goals", before: "on-track", after: "attention" },
    ]);
    expect(d.material).toBe(true);
  });
});

describe("refreshDecision", () => {
  const at = (asOf: string) => snap({ asOf });
  test("a month already stored asks for nothing; a new month or a stale open does", () => {
    expect(refreshDecision(at("2026-10-01"), "2026-10-31")).toBeNull();
    expect(refreshDecision(at("2026-10-05"), "2026-11-01")).toBe("new-month");
    expect(refreshDecision(at("2026-10-01"), "2026-11-01")).toBe("open-stale");
    expect(refreshDecision(at("2026-09-30"), "2026-10-31")).toBe("open-stale");
  });
  test("month rollovers: Jan 31 -> Feb 1, December -> January, leap Feb 29 -> Mar 1", () => {
    expect(refreshDecision(at("2026-01-31"), "2026-02-01")).toBe("new-month");
    expect(refreshDecision(at("2026-12-31"), "2027-01-01")).toBe("new-month");
    expect(refreshDecision(at("2028-02-29"), "2028-03-01")).toBe("new-month");
    expect(refreshDecision(at("2028-02-28"), "2028-02-29")).toBeNull();
  });
  test("a clock behind the newest snapshot stores nothing", () => {
    expect(refreshDecision(at("2026-10-16"), "2026-09-28")).toBeNull();
  });
  test("no previous snapshot stores one; a malformed stored asOf counts as none", () => {
    expect(refreshDecision(null, "2026-10-10")).toBe("new-month");
    expect(refreshDecision(snap({ asOf: "garbage" }), "2026-10-24")).toBe("new-month");
    expect(refreshDecision(snap({ asOf: "2026-13-45" }), "2026-10-24")).toBe("new-month");
  });
});

describe("topChanges", () => {
  test("at most 3, largest relative move first, ties by section order", () => {
    const d = diffSnapshots(
      snap({
        flat: {
          month: { a: cents(100000) },
          buffer: { b: cents(100000) },
          debts: { c: cents(100000) },
          spending: { d: cents(100000) },
          cards: { e: cents(100000) },
        },
      }),
      snap({
        flat: {
          month: { a: cents(110000) },
          buffer: { b: cents(300000) },
          debts: { c: cents(150000) },
          spending: { d: cents(150000) },
          cards: { e: cents(120000) },
        },
      }),
    );
    expect(topChanges(d).map((c) => c.figureId)).toEqual(["b", "c", "d"]);
    expect(topChanges(d, 3)).toHaveLength(3);
    expect(topChanges({ ...d, changes: [] })).toEqual([]);
  });
});
