import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import type { EntityProfile } from "./entities.js";
import type { OwnAccounts } from "./views.js";
import type { Valuation } from "./balance.js";
import {
  balanceSheet,
  computeReports,
  incomeStatement,
  reportMonthPeriod,
  type ReportInput,
} from "./reports.js";
import { netWorthSeries } from "./balanceSeries.js";

/**
 * WS3.3 acceptance evidence (issue #292):
 *
 *  - cross-foot: income − spend = net savings, on the netted ledger;
 *  - category totals match the ledger under sign normalization;
 *  - savings rate handles zero income as unknown (never 0, never Infinity);
 *  - the balance sheet balances (assets − liabilities = equity) on every asOf
 *    where valuations exist, and equals the #291 net-worth series there;
 *  - an unknown valuation leaves a gap in the balance sheet, not a zero.
 *
 * `reports-292.json` is a hand-worked household: one partial month (asOf's own,
 * cut at the 11th), two full months, a mixed category whose refunds net it down,
 * an owner-excluded row, a pending row, a row that cannot be converted, an own
 * transfer pair, and a balance sheet with a house valuation.
 */

type Fixture = {
  asOf: string;
  accounts: Account[];
  txs: Tx[];
  valuations: Valuation[];
  expected: {
    periods: Array<{
      month: string;
      partial: boolean;
      incomeCents: number;
      spendCents: number;
      netSavingsCents: number;
      savingsRate: number | null;
      transactionsCount: number;
      cleanedRows: number;
      excludedForeignCount: number;
      incomeCategories: Array<[string, number]>;
      spendCategories: Array<[string, number]>;
    }>;
    balanceSheet: {
      assetsCents: number;
      liabilitiesCents: number;
      equityCents: number;
      netWorthCents: number;
      knownAssetsCents: number;
      knownLiabilitiesCents: number;
      assetGroups: Array<[string, number]>;
      liabilityGroups: Array<[string, number]>;
    };
    gap: {
      unknownAccounts: string[];
      knownAssetsCents: number;
      knownLiabilitiesCents: number;
    };
  };
};

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new NodeURL("./__fixtures__/reports-292.json", import.meta.url)),
    "utf8",
  ),
) as Fixture;

const ENTITY_PROFILES: EntityProfile[] = [];
const OWN: OwnAccounts = { all: [], byKey: new Map() };

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    txs: fixture.txs,
    accounts: fixture.accounts,
    entityProfiles: ENTITY_PROFILES,
    rules: [],
    own: OWN,
    valuations: fixture.valuations,
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    asOf: fixture.asOf,
    ...overrides,
  };
}

const periodOf = (month: string) => reportMonthPeriod(month, fixture.asOf);

describe("income statement: periods and cross-foot", () => {
  test("every fixture period matches the hand-worked statement", () => {
    for (const expected of fixture.expected.periods) {
      const statement = incomeStatement(input(), periodOf(expected.month));
      expect(statement.period).toMatchObject({
        month: expected.month,
        partial: expected.partial,
      });
      if (expected.savingsRate == null) expect(statement.savingsRate).toBeNull();
      else expect(statement.savingsRate).toBeCloseTo(expected.savingsRate, 12);
      expect({
        incomeCents: statement.incomeCents,
        spendCents: statement.spendCents,
        netSavingsCents: statement.netSavingsCents,
        transactionsCount: statement.transactionsCount,
        cleanedRows: statement.cleanedRows,
        excludedForeignCount: statement.excludedForeignCount,
      }).toEqual({
        incomeCents: expected.incomeCents,
        spendCents: expected.spendCents,
        netSavingsCents: expected.netSavingsCents,
        transactionsCount: expected.transactionsCount,
        cleanedRows: expected.cleanedRows,
        excludedForeignCount: expected.excludedForeignCount,
      });
      expect(statement.incomeCategories.map((r) => [r.category, r.incomeCents])).toEqual(
        expected.incomeCategories,
      );
      expect(statement.spendCategories.map((r) => [r.category, r.spendCents])).toEqual(
        expected.spendCategories,
      );
    }
  });

  test("income − spend equals net savings, and the categories add up to both", () => {
    for (const expected of fixture.expected.periods) {
      const statement = incomeStatement(input(), periodOf(expected.month));
      // The cross-foot acceptance: a test, not a comment.
      expect(statement.incomeCents - statement.spendCents).toBe(statement.netSavingsCents);
      expect(statement.incomeCategories.reduce((s, r) => s + r.incomeCents, 0)).toBe(
        statement.incomeCents,
      );
      expect(statement.spendCategories.reduce((s, r) => s + r.spendCents, 0)).toBe(
        statement.spendCents,
      );
      // Every row sits on exactly one side and its net is signed for that side.
      for (const row of [...statement.incomeCategories, ...statement.spendCategories]) {
        expect(row.netCents).toBe(row.spendCents - row.incomeCents);
        expect(
          row.side === "income"
            ? row.incomeCents > 0 && row.spendCents === 0
            : row.spendCents > 0 && row.incomeCents === 0,
        ).toBe(true);
      }
    }
  });

  test("category totals match an independent ledger pass under sign normalization", () => {
    const statement = incomeStatement(input(), periodOf("2026-10"));
    // Independent ledger: same scope rules, no report helpers, sign-normalized
    // (positive = income, negative = spend), refunds netted per category.
    const ledger = new Map<string, number>();
    for (const tx of fixture.txs) {
      if (tx.date < "2026-10-01" || tx.date > "2026-10-31") continue;
      if (tx.excluded === true || tx.pending === true) continue;
      if (tx.category === "Eigen overboeking") continue;
      if (tx.currency !== "EUR") continue; // separate mode
      const cents = Math.round(tx.amount * 100);
      ledger.set(tx.category ?? "onbekend", (ledger.get(tx.category ?? "onbekend") ?? 0) + cents);
    }
    const rows = [...statement.incomeCategories, ...statement.spendCategories];
    const reported = new Map(rows.map((r) => [r.category, r.incomeCents - r.spendCents]));
    expect(reported).toEqual(ledger);
  });

  test("zero income makes the savings rate UNKNOWN, never 0 and never Infinity", () => {
    const statement = incomeStatement(input(), periodOf("2026-09"));
    expect(statement.incomeCents).toBe(0);
    expect(statement.savingsRate).toBeNull();
    expect(statement.savingsRate).not.toBe(0);
    expect(Number.isFinite(statement.savingsRate ?? Number.NaN)).toBe(false);
  });

  test("negative income also leaves the rate unknown instead of flipping the sign", () => {
    const statement = incomeStatement(input(), periodOf("2026-09"));
    expect(statement.netSavingsCents).toBeLessThan(0);
    expect(statement.savingsRate).toBeNull();
  });

  test("a month in progress is PARTIAL, a finished month is not", () => {
    const current = incomeStatement(input(), periodOf("2026-11"));
    expect(current.period).toMatchObject({ from: "2026-11-01", to: "2026-11-11", partial: true });
    const previous = incomeStatement(input(), periodOf("2026-10"));
    expect(previous.period).toMatchObject({ from: "2026-10-01", to: "2026-10-31", partial: false });
  });

  test("owner-excluded and pending rows never reach the statement; own transfers are counted", () => {
    const october = incomeStatement(input(), periodOf("2026-10"));
    // t12 (excluded) and t13 (pending) carry EUR -999 and -888; if either leaked
    // into Boodschappen the category would not be 45000.
    expect(october.spendCategories.find((r) => r.category === "Boodschappen")?.spendCents).toBe(
      45000,
    );
    const november = incomeStatement(input(), periodOf("2026-11"));
    expect(november.cleanedRows).toBeGreaterThanOrEqual(2);
    expect(
      november.spendCategories.find((r) => r.category === "Housing & energy")?.spendCents,
    ).toBe(25000);
  });

  test("moved categories are dropped from both sides", () => {
    const statement = incomeStatement(
      input({ movedCategories: new Set(["Housing & energy"]) }),
      periodOf("2026-11"),
    );
    expect(statement.spendCategories.map((r) => r.category)).toEqual(["Boodschappen"]);
    expect(statement.spendCents).toBe(12500);
  });
});

describe("balance sheet: assets, liabilities, equity", () => {
  test("the fixture's balance sheet matches the hand-worked statement", () => {
    const sheet = balanceSheet(input());
    const expected = fixture.expected.balanceSheet;
    expect({
      assetsCents: sheet.assetsCents,
      liabilitiesCents: sheet.liabilitiesCents,
      equityCents: sheet.equityCents,
      netWorthCents: sheet.netWorthCents,
      knownAssetsCents: sheet.knownAssetsCents,
      knownLiabilitiesCents: sheet.knownLiabilitiesCents,
    }).toEqual({
      assetsCents: expected.assetsCents,
      liabilitiesCents: expected.liabilitiesCents,
      equityCents: expected.equityCents,
      netWorthCents: expected.netWorthCents,
      knownAssetsCents: expected.knownAssetsCents,
      knownLiabilitiesCents: expected.knownLiabilitiesCents,
    });
    expect(sheet.assets.map((g) => [g.kind, g.totalCents])).toEqual(expected.assetGroups);
    expect(sheet.liabilities.map((g) => [g.kind, g.totalCents])).toEqual(expected.liabilityGroups);
  });

  test("it balances: assets − liabilities = equity, and equals the #291 series", () => {
    const sheet = balanceSheet(input());
    expect(sheet.assetsCents).not.toBeNull();
    expect(sheet.liabilitiesCents).not.toBeNull();
    expect(sheet.equityCents).not.toBeNull();
    expect((sheet.assetsCents ?? 0) - (sheet.liabilitiesCents ?? 0)).toBe(sheet.equityCents);
    expect(sheet.equityCents).toBe(sheet.netWorthCents);
    expect(sheet.balanced).toBe(true);
    // Independent recomputation through the #291 series' public API.
    const series = netWorthSeries({
      accounts: fixture.accounts,
      txs: fixture.txs,
      valuations: fixture.valuations,
      from: fixture.asOf,
      to: fixture.asOf,
      asOf: fixture.asOf,
    });
    expect(series.days[0]?.totalCents).toBe(sheet.equityCents);
  });

  test("an unknown valuation is a GAP in the sheet, not a zero", () => {
    const sheet = balanceSheet(input({ valuations: [] }));
    expect(sheet.unknownAccounts).toEqual(fixture.expected.gap.unknownAccounts);
    expect(sheet.equityCents).toBeNull();
    expect(sheet.assetsCents).toBeNull();
    expect(sheet.liabilitiesCents).toBeNull();
    expect(sheet.netWorthCents).toBeNull();
    expect(sheet.balanced).toBeNull();
    // The partial sums still exist beside the gap and are never the totals.
    expect(sheet.knownAssetsCents).toBe(fixture.expected.gap.knownAssetsCents);
    expect(sheet.knownLiabilitiesCents).toBe(fixture.expected.gap.knownLiabilitiesCents);
    // The unknown account is still listed on its side, with a null value.
    const house = sheet.assets.flatMap((g) => g.accounts).find((a) => a.accountKey === "woning");
    expect(house?.balanceCents).toBeNull();
    expect(house?.valuation).toBe("unknown");
  });

  test("a carried valuation stays labelled as stale", () => {
    const staleValuation: Valuation = {
      ...fixture.valuations[0]!,
      id: "woning|2026-09-01",
      date: "2026-09-01",
    };
    const sheet = balanceSheet(input({ valuations: [staleValuation] }));
    const house = sheet.assets.flatMap((g) => g.accounts).find((a) => a.accountKey === "woning");
    expect(house?.stale).toBe(true);
    expect(house?.valuation).toBe("stale");
    // Carried forward, still counted: it is a labelled value, not a gap.
    expect(sheet.equityCents).toBe(fixture.expected.balanceSheet.equityCents);
  });

  test("each row carries the anchor its value rests on (how calculated)", () => {
    const sheet = balanceSheet(input());
    const rente = sheet.assets.flatMap((g) => g.accounts).find((a) => a.accountKey === "betaal");
    expect(rente?.anchor).toMatchObject({ date: "2026-11-01", kind: "opening" });
    const house = sheet.assets.flatMap((g) => g.accounts).find((a) => a.accountKey === "woning");
    expect(house?.anchor).toMatchObject({ date: "2026-11-05", kind: "reconciliation" });
    // The calc steps carry the same numbers to the "how calculated" surface.
    const equity = sheet.calc.find((c) => c.id === "report-equity");
    expect(equity?.output).toEqual({ unit: "cents", value: sheet.equityCents });
    expect(equity?.inputs.assets).toEqual({ unit: "cents", value: sheet.assetsCents });
  });
});

describe("the pair the app shows", () => {
  test("computeReports returns the sheet plus asOf's month and the two before it, newest first", () => {
    const reports = computeReports(input());
    expect(reports.balanceSheet.asOf).toBe(fixture.asOf);
    expect(reports.incomeStatements.map((s) => s.period.month)).toEqual([
      "2026-11",
      "2026-10",
      "2026-09",
    ]);
    expect(reports.incomeStatements.map((s) => s.period.partial)).toEqual([true, false, false]);
    // The pair agrees with the standalone calls.
    expect(reports.balanceSheet.equityCents).toBe(balanceSheet(input()).equityCents);
    expect(reports.incomeStatements[1]?.netSavingsCents).toBe(
      incomeStatement(input(), periodOf("2026-10")).netSavingsCents,
    );
  });

  test("reports carry no clock: the same input twice is identical", () => {
    expect(JSON.stringify(computeReports(input()))).toBe(JSON.stringify(computeReports(input())));
  });
});
