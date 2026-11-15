import { describe, expect, test } from "vitest";
import * as scenarios from "./scenarios.js";
import {
  futureValueCents,
  goalScenarioRows,
  lossIllustration,
  publicScenarioTable,
  requiredMonthlyCents,
} from "./scenarios.js";

describe("futureValueCents", () => {
  test("closed formula: 100/month, 216 months, 0%: 2_160_000", () => {
    expect(futureValueCents({ monthlyCents: 10000, months: 216, annualRate: 0 })).toBe(2160000);
  });
  test("stays a finite integer up to 1200 months", () => {
    for (const annualRate of [0, 0.06]) {
      const v = futureValueCents({ monthlyCents: 10000, months: 1200, annualRate });
      expect(Number.isFinite(v) && Number.isInteger(v)).toBe(true);
    }
  });
  test("zero or negative months and zero contribution give 0, never NaN", () => {
    expect(futureValueCents({ monthlyCents: 10000, months: 0, annualRate: 0.04 })).toBe(0);
    expect(futureValueCents({ monthlyCents: 10000, months: -3, annualRate: 0.04 })).toBe(0);
    expect(futureValueCents({ monthlyCents: 0, months: 12, annualRate: 0.04 })).toBe(0);
  });
});

describe("publicScenarioTable", () => {
  test("cells equal the closed formula P*((1+i)^n-1)/i, i=(g-c)/12, half-up", () => {
    // Literals re-derived independently with a one-off `node -e` annuity formula
    // (P=10000, n=216, i=(g-c)/12, Math.round), not copied from the brief.
    const want: Record<string, number> = {
      "0.02/0.002": 2548745, "0.02/0.015": 2259691, "0.04/0.002": 3093627,
      "0.04/0.015": 2724376, "0.06/0.002": 3793286, "0.06/0.015": 3318680,
    };
    const t = publicScenarioTable();
    expect(t.cells).toHaveLength(6);
    for (const c of t.cells) {
      expect(c.endCents).toBe(want[`${c.grossRate}/${c.costRate}`]);
      expect(Number.isInteger(c.endCents)).toBe(true);
    }
  });
  test("hand-checked cell: 4% gross, 0.2% cost = 3.8% net -> 30_936.27 euro", () => {
    expect(publicScenarioTable().cells.find((c) => c.grossRate === 0.04 && c.costRate === 0.002)!.endCents).toBe(3093627);
  });
  test("fixed inputs and the research's 5% example is not a column", () => {
    const t = publicScenarioTable();
    expect(t.monthlyCents).toBe(10000);
    expect(t.years).toBe(18);
    expect(t.paidInCents).toBe(2160000);
    expect(t.grossRates).not.toContain(0.05);
  });
  test("takes no parameters", () => {
    expect(publicScenarioTable.length).toBe(0);
  });
});

describe("requiredMonthlyCents", () => {
  test("target 1_000_000, 0 saved, 120 months: 0% -> 8334, 4% -> 6792", () => {
    // 1e6/120 = 8333.33; 1e6 / (((1+.04/12)^120-1)/(.04/12)) = 6791.18 (node -e)
    expect(requiredMonthlyCents({ targetCents: 1000000, savedCents: 0, months: 120, annualRate: 0 })).toBe(8334);
    expect(requiredMonthlyCents({ targetCents: 1000000, savedCents: 0, months: 120, annualRate: 0.04 })).toBe(6792);
  });
  test("round trip: reaches the target and one cent less does not", () => {
    for (const annualRate of [0, 0.02, 0.04, 0.06]) {
      for (const [targetCents, months] of [[1000000, 120], [2500050, 37], [123457, 1]] as const) {
        const m = requiredMonthlyCents({ targetCents, savedCents: 0, months, annualRate })!;
        expect(futureValueCents({ monthlyCents: m, months, annualRate })).toBeGreaterThanOrEqual(targetCents);
        expect(futureValueCents({ monthlyCents: m - 1, months, annualRate })).toBeLessThan(targetCents);
      }
    }
  });
  test("already funded -> 0; months 0 or negative -> null, never Infinity", () => {
    expect(requiredMonthlyCents({ targetCents: 100, savedCents: 500, months: 12, annualRate: 0.04 })).toBe(0);
    expect(requiredMonthlyCents({ targetCents: 100, savedCents: 100, months: 12, annualRate: 0 })).toBe(0);
    expect(requiredMonthlyCents({ targetCents: 100, savedCents: 0, months: 0, annualRate: 0.04 })).toBeNull();
    expect(requiredMonthlyCents({ targetCents: 100, savedCents: 0, months: -5, annualRate: 0 })).toBeNull();
  });
  test("saved grows at the stated rate", () => {
    // 100_000 saved at 6% for 12 months grows to 106_167.78; shortfall 893_832.22
    const withSaved = requiredMonthlyCents({ targetCents: 1000000, savedCents: 100000, months: 12, annualRate: 0.06 })!;
    const ignoringGrowth = requiredMonthlyCents({ targetCents: 900000, savedCents: 0, months: 12, annualRate: 0.06 })!;
    expect(withSaved).toBeLessThan(ignoringGrowth);
    const grown = 100000 * (1 + 0.06 / 12) ** 12;
    expect(futureValueCents({ monthlyCents: withSaved, months: 12, annualRate: 0.06 }) + grown).toBeGreaterThanOrEqual(1000000);
  });
  test("saved > 0: exact literal and round trip", () => {
    // node -e: ceil((500000 - 100000*(1+.04/12)^60) / (((1+.04/12)^60-1)/(.04/12))) = 5700
    expect(requiredMonthlyCents({ targetCents: 500000, savedCents: 100000, months: 60, annualRate: 0.04 })).toBe(5700);
    for (const annualRate of [0, 0.04]) {
      const m = requiredMonthlyCents({ targetCents: 500000, savedCents: 100000, months: 60, annualRate })!;
      const total = futureValueCents({ monthlyCents: m, months: 60, annualRate }) + 100000 * (1 + annualRate / 12) ** 60;
      expect(total).toBeGreaterThanOrEqual(500000 - 0.5);
    }
  });
  test("non-finite input or result -> null", () => {
    expect(requiredMonthlyCents({ targetCents: 1000000, savedCents: 0, months: 1e9, annualRate: 0.04 })).toBeNull();
    expect(requiredMonthlyCents({ targetCents: 1000000, savedCents: 100, months: 1e9, annualRate: 0.04 })).toBeNull();
    expect(requiredMonthlyCents({ targetCents: NaN, savedCents: 0, months: 12, annualRate: 0.04 })).toBeNull();
    expect(requiredMonthlyCents({ targetCents: 1000000, savedCents: 0, months: NaN, annualRate: 0.04 })).toBeNull();
  });
  test("outputs are integers", () => {
    expect(Number.isInteger(requiredMonthlyCents({ targetCents: 777777, savedCents: 1234, months: 53, annualRate: 0.02 })!)).toBe(true);
  });
});

describe("goalScenarioRows", () => {
  test("rows for 0, 2, 4, 6 percent, each equal to requiredMonthlyCents", () => {
    const rows = goalScenarioRows({ targetCents: 1000000, savedCents: 0, months: 120 });
    expect(rows.map((r) => r.annualRate)).toEqual([0, 0.02, 0.04, 0.06]);
    expect(rows[2]!.requiredMonthlyCents).toBe(6792);
  });
  test("past goal: every row null", () => {
    const rows = goalScenarioRows({ targetCents: 1000000, savedCents: 0, months: 0 });
    expect(rows.every((r) => r.requiredMonthlyCents === null)).toBe(true);
  });
});

describe("lossIllustration", () => {
  test("30% of 1_000_000 = 300_000 = 4.7 months of 64_000 room", () => {
    expect(lossIllustration({ amountCents: 1000000, fallPct: 30, roomMiddleCents: 64000 })).toEqual({ lossCents: 300000, monthsOfRoom: 4.7 });
  });
  test("room <= 0 or null -> monthsOfRoom null", () => {
    expect(lossIllustration({ amountCents: 1000000, fallPct: 30, roomMiddleCents: 0 }).monthsOfRoom).toBeNull();
    expect(lossIllustration({ amountCents: 1000000, fallPct: 30, roomMiddleCents: -5 }).monthsOfRoom).toBeNull();
    expect(lossIllustration({ amountCents: 1000000, fallPct: 30, roomMiddleCents: null }).monthsOfRoom).toBeNull();
  });
  test("negative amount gives 0 loss", () => {
    expect(lossIllustration({ amountCents: -5, fallPct: 30, roomMiddleCents: 100 }).lossCents).toBe(0);
  });
});

test("module has no tax or inflation parameter or export", () => {
  expect(Object.keys(scenarios).filter((k) => /tax|inflation/i.test(k) && k !== "SCENARIO_ASSUMPTIONS")).toEqual([]);
  expect(scenarios.SCENARIO_ASSUMPTIONS).toEqual({ compounding: "monthly", contributions: "month-end", return: "constant", tax: "none", inflation: "none" });
});
