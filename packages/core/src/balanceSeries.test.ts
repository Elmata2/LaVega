import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import {
  accountAnchors,
  accountClassification,
  accountTypeKind,
  dropAccountValuations,
  mergeValuations,
  migrateAccountTypes,
  openingAnchor,
  valuationsHaveNoOrphans,
  valuationStatus,
  type Valuation,
} from "./balance.js";
import { mergeAccounts } from "./accounts.js";
import { accountBalanceSeries, accountSeriesStrategy, netWorthSeries } from "./balanceSeries.js";

/**
 * WS3.1/WS3.2 acceptance evidence (issue #291):
 *
 *  - the opening plus the daily series reconciles to the anchors on every day
 *    where a valuation exists;
 *  - an unknown valuation leaves a GAP, never a zero;
 *  - a merge or delete of an account leaves no orphan valuations;
 *  - a valuation is a hard reset, not an interpolation, and both Sure
 *    calculators (forward for an opening, reverse for a current anchor) agree at
 *    the anchor dates.
 *
 * The fixture is hand-worked: a household with a manual checking and savings
 * account (opening anchors), a mortgage (current anchor, reverse replay) and a
 * house (one dated valuation, so the days before it are unknown).
 */

type Fixture = {
  asOf: string;
  from: string;
  to: string;
  accounts: Account[];
  txs: Tx[];
  valuations: Valuation[];
  expected: {
    series: Record<string, Record<string, number | null>>;
    netWorth: Record<string, number | null>;
    unknownDays: Record<string, string[]>;
  };
};

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new NodeURL("./__fixtures__/net-worth-291.json", import.meta.url)),
    "utf8",
  ),
) as Fixture;

const dayMap = (points: ReturnType<typeof accountBalanceSeries>) =>
  Object.fromEntries(points.map((p) => [p.date, p.balanceCents]));

const account = (overrides: Partial<Account> = {}): Account => ({
  key: "A",
  iban: "NL01",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  ...overrides,
});

const tx = (date: string, amount: number, accountKey = "A"): Tx => ({
  id: `${accountKey}-${date}-${amount}`,
  accountKey,
  date,
  amount,
  currency: "EUR",
  counterparty: "",
  description: "",
  category: "",
  manual: false,
});

const valuation = (overrides: Partial<Valuation> = {}): Valuation => ({
  id: "A|2026-11-05",
  accountKey: "A",
  date: "2026-11-05",
  amountCents: 100000,
  currency: "EUR",
  kind: "reconciliation",
  source: "manual",
  createdAt: "2026-11-11",
  ...overrides,
});

const seriesFor = (key: string, extras: { txs?: Tx[]; accounts?: Account[] } = {}) => {
  const accounts = extras.accounts ?? fixture.accounts;
  const found = accounts.find((a) => a.key === key);
  if (found == null) throw new Error(`fixture account ${key} missing`);
  return accountBalanceSeries({
    account: found,
    txs: extras.txs ?? fixture.txs,
    valuations: fixture.valuations,
    from: fixture.from,
    to: fixture.to,
    asOf: fixture.asOf,
  });
};

describe("account kinds and classification", () => {
  test("every asset/liability kind maps to its classification", () => {
    expect(accountClassification(account({ type: "Betaalrekening" }))).toBe("asset");
    expect(accountClassification(account({ type: "Spaarrekening" }))).toBe("asset");
    expect(accountClassification(account({ type: "Beleggingsrekening" }))).toBe("asset");
    expect(accountClassification(account({ type: "Woning" }))).toBe("asset");
    expect(accountClassification(account({ type: "Voertuig" }))).toBe("asset");
    expect(accountClassification(account({ type: "Overig bezit" }))).toBe("asset");
    expect(accountClassification(account({ type: "Creditcard" }))).toBe("liability");
    expect(accountClassification(account({ type: "Lening" }))).toBe("liability");
    expect(accountClassification(account({ type: "Overige schuld" }))).toBe("liability");
    // An account that never chose a side stays an asset: a liability needs the
    // owner to say so, never a guess.
    expect(accountClassification(account({ type: "Overig" }))).toBe("asset");
    expect(accountClassification(account({ type: "iets onbekends" }))).toBe("asset");
  });

  test("the derived kind follows the canonical type strings", () => {
    expect(accountTypeKind(account({ type: "Lening" }))).toBe("loan");
    expect(accountTypeKind(account({ type: "Woning" }))).toBe("property");
    expect(accountTypeKind(account({ type: "Voertuig" }))).toBe("vehicle");
    expect(accountTypeKind(account({ type: "Overig bezit" }))).toBe("otherAsset");
    expect(accountTypeKind(account({ type: "Overige schuld" }))).toBe("otherLiability");
  });

  test("the stored-type migration rewrites known aliases and leaves the rest alone", () => {
    const migrated = migrateAccountTypes([
      account({ key: "a", type: "Savings" }),
      account({ key: "b", type: "credit card" }),
      account({ key: "c", type: "Hypotheek" }),
      account({ key: "d", type: "Betaalrekening" }),
      account({ key: "e", type: "Wat de bank ook zei" }),
      account({ key: "f" }),
    ]);
    expect(migrated.changed).toBe(true);
    expect(migrated.accounts.map((a) => a.type)).toEqual([
      "Spaarrekening",
      "Creditcard",
      "Lening",
      "Betaalrekening",
      "Wat de bank ook zei",
      undefined,
    ]);
    // A second pass is a no-op: the open-time migration costs ONE vault save.
    expect(migrateAccountTypes(migrated.accounts).changed).toBe(false);
  });
});

describe("the daily series (Sure forward and reverse replay)", () => {
  test("the fixture's forward accounts match the hand-worked replay", () => {
    expect(dayMap(seriesFor("betaal"))).toEqual(fixture.expected.series.betaal);
    expect(dayMap(seriesFor("spaar"))).toEqual(fixture.expected.series.spaar);
  });

  test("the reverse account replays backwards from its current anchor", () => {
    expect(dayMap(seriesFor("lening"))).toEqual(fixture.expected.series.lening);
  });

  test("strategy is selected by the anchor, not by a stored flag", () => {
    expect(
      accountSeriesStrategy(
        account({ openingDate: "2026-11-01", openingBalanceCents: 100 }),
        [],
        "2026-11-11",
      ),
    ).toBe("forward");
    expect(
      accountSeriesStrategy(account({ balance: 100, balanceDate: "2026-11-01" }), [], "2026-11-11"),
    ).toBe("reverse");
    expect(accountSeriesStrategy(account(), [], "2026-11-11")).toBe("unknown");
  });

  test("a valuation is a hard reset, not an interpolation", () => {
    const a = account({ openingBalanceCents: 100000, openingDate: "2026-11-01" });
    const points = accountBalanceSeries({
      account: a,
      txs: [tx("2026-11-03", 500)],
      valuations: [valuation({ date: "2026-11-05", amountCents: 400000 })],
      from: "2026-11-01",
      to: "2026-11-07",
      asOf: "2026-11-11",
    });
    expect(dayMap(points)).toEqual({
      "2026-11-01": 100000,
      "2026-11-02": 100000,
      "2026-11-03": 150000,
      "2026-11-04": 150000,
      // The valuation date takes the amount as-is; nothing blends it in.
      "2026-11-05": 400000,
      "2026-11-06": 400000,
      "2026-11-07": 400000,
    });
    expect(points.find((p) => p.date === "2026-11-05")?.anchor?.kind).toBe("reconciliation");
  });

  test("an earlier reconciliation resets the reverse replay on its own date", () => {
    const a = account({ balance: -8000, balanceDate: "2026-11-11", type: "Lening" });
    const points = accountBalanceSeries({
      account: a,
      txs: [],
      valuations: [valuation({ date: "2026-11-08", amountCents: -500000 })],
      from: "2026-11-06",
      to: "2026-11-11",
      asOf: "2026-11-11",
    });
    // Between the two anchors the LATER one wins (the replay walks back from
    // it); the earlier anchor resets its own day. Before the earliest anchor
    // there is no ledger evidence, so those days are a gap.
    expect(dayMap(points)).toEqual({
      "2026-11-06": null,
      "2026-11-07": null,
      "2026-11-08": -500000,
      "2026-11-09": -800000,
      "2026-11-10": -800000,
      "2026-11-11": -800000,
    });
    expect(points.find((p) => p.date === "2026-11-08")?.anchor?.kind).toBe("reconciliation");
  });

  test("liability flows are signed by the classification, not by the amount", () => {
    // A EUR 1.000 repayment leaves the bank and lowers the debt: the liability
    // value moves +100000 from -900000 to -800000.
    const before = accountBalanceSeries({
      account: account({ balance: -9000, balanceDate: "2026-11-10", type: "Lening" }),
      txs: [],
      from: "2026-11-10",
      to: "2026-11-10",
      asOf: "2026-11-11",
    });
    expect(before[0]?.flowsFactor).toBe(-1);
    expect(dayMap(seriesFor("lening"))["2026-11-11"]).toBe(-800000);
    expect(dayMap(seriesFor("lening"))["2026-11-10"]).toBe(-900000);
  });

  test("cash and non-cash are split by kind; an investment split stays unknown", () => {
    const betaal = seriesFor("betaal");
    expect(betaal[0]?.cashCents).toBe(100000);
    expect(betaal[0]?.nonCashCents).toBe(0);
    const lening = seriesFor("lening");
    expect(lening[0]?.cashCents).toBe(0);
    expect(lening[0]?.nonCashCents).toBe(-900000);
    const invest = accountBalanceSeries({
      account: account({
        key: "beleggen",
        type: "Beleggingsrekening",
        balance: 100000,
        balanceDate: "2026-11-11",
      }),
      txs: [],
      from: "2026-11-11",
      to: "2026-11-11",
      asOf: "2026-11-11",
    });
    expect(invest[0]?.balanceCents).toBe(10000000);
    // Holdings are not valued in this slice, so the split is UNKNOWN, not 0.
    expect(invest[0]?.cashCents).toBeNull();
    expect(invest[0]?.nonCashCents).toBeNull();
  });
});

describe("net worth: reconciliation and the unknown gap", () => {
  test("the daily total reconciles to the hand-worked household on every anchor day", () => {
    const series = netWorthSeries({
      accounts: fixture.accounts,
      txs: fixture.txs,
      valuations: fixture.valuations,
      from: fixture.from,
      to: fixture.to,
      asOf: fixture.asOf,
    });
    const totals = Object.fromEntries(series.days.map((d) => [d.date, d.totalCents]));
    expect(totals).toEqual(fixture.expected.netWorth);
    expect(series.excludedForeignCount).toBe(0);
  });

  test("on each anchor date the account's value IS the anchor, and every known total is their sum", () => {
    const series = netWorthSeries({
      accounts: fixture.accounts,
      txs: fixture.txs,
      valuations: fixture.valuations,
      from: fixture.from,
      to: fixture.to,
      asOf: fixture.asOf,
    });
    // 1. The anchor day itself takes the absolute amount, never a blend.
    for (const account of fixture.accounts) {
      for (const anchor of accountAnchors(account, fixture.valuations, fixture.asOf)) {
        const point = accountBalanceSeries({
          account,
          txs: fixture.txs,
          valuations: fixture.valuations,
          from: anchor.date,
          to: anchor.date,
          asOf: fixture.asOf,
        })[0];
        expect(point?.balanceCents).toBe(anchor.amountCents);
      }
    }
    // 2. Every day whose total is KNOWN reconciles to the independent replay.
    for (const day of series.days) {
      if (day.totalCents == null) continue;
      const expected = fixture.accounts.reduce((sum, account) => {
        const point = accountBalanceSeries({
          account,
          txs: fixture.txs,
          valuations: fixture.valuations,
          from: day.date,
          to: day.date,
          asOf: fixture.asOf,
        })[0];
        return sum + (point?.balanceCents ?? 0);
      }, 0);
      expect(day.totalCents).toBe(expected);
      expect(day.unknownAccounts).toEqual([]);
    }
  });

  test("an unknown valuation is a GAP, not a zero", () => {
    const series = netWorthSeries({
      accounts: fixture.accounts,
      txs: fixture.txs,
      valuations: fixture.valuations,
      from: fixture.from,
      to: fixture.to,
      asOf: fixture.asOf,
    });
    for (const [date, unknown] of Object.entries(fixture.expected.unknownDays)) {
      const day = series.days.find((d) => d.date === date);
      expect(day?.totalCents).toBeNull();
      expect(day?.unknownAccounts).toEqual(unknown);
      // The known sum still exists beside the gap: checking, savings and the
      // loan, without the unvalued house. It is never presented as the net
      // worth, and it is never a zero.
      const knownExpected =
        day?.unknownAccounts.length === 1 && day.date < "2026-11-03" ? -300000 : -325000;
      expect(day?.knownTotalCents).toBe(knownExpected);
      expect(day?.knownTotalCents).not.toBe(0);
    }
  });

  test("an account with no anchor at all makes every day unknown, never zero", () => {
    const unknown = account({ key: "geen", type: "Woning" });
    const series = netWorthSeries({
      accounts: [account({ balance: 1000, balanceDate: "2026-11-11" }), unknown],
      txs: [],
      from: "2026-11-11",
      to: "2026-11-11",
      asOf: "2026-11-11",
    });
    expect(series.days.every((d) => d.totalCents === null)).toBe(true);
    expect(series.days.every((d) => d.unknownAccounts.includes("geen"))).toBe(true);
    expect(series.days[0]?.knownTotalCents).toBe(100000);
  });

  test("a non-EUR account is excluded and counted, not converted at a made-up rate", () => {
    const series = netWorthSeries({
      accounts: [
        account({ balance: 1000, balanceDate: "2026-11-11" }),
        account({ key: "usd", currency: "USD", balance: 500, balanceDate: "2026-11-11" }),
      ],
      txs: [],
      from: "2026-11-11",
      to: "2026-11-11",
      asOf: "2026-11-11",
    });
    expect(series.excludedForeignCount).toBe(1);
    expect(series.days[0]?.totalCents).toBe(100000);
  });
});

describe("stale and carried valuations stay labelled", () => {
  test("a fresh anchor, a stale anchor and no anchor read differently", () => {
    const fresh = valuationStatus(
      account({ balance: 1000, balanceDate: "2026-11-01" }),
      [],
      "2026-11-11",
    );
    expect(fresh).toEqual({ kind: "fresh", lastAnchorDate: "2026-11-01", ageDays: 10 });
    const stale = valuationStatus(
      account({ balance: 1000, balanceDate: "2026-09-01" }),
      [],
      "2026-11-11",
    );
    expect(stale.kind).toBe("stale");
    expect(stale.ageDays).toBe(71);
    expect(valuationStatus(account(), [], "2026-11-11")).toEqual({
      kind: "unknown",
      lastAnchorDate: null,
      ageDays: null,
    });
  });

  test("a carried day reports how long its anchor has been carrying it", () => {
    const points = seriesFor("woning");
    expect(points[0]?.balanceCents).toBeNull();
    expect(points[4]?.carriedDays).toBe(0);
    expect(points[10]?.carriedDays).toBe(6);
    expect(points[10]?.anchor).toBeNull();
  });
});

describe("merge and delete keep valuations consistent", () => {
  const survivor = account({ key: "survivor", balance: null });
  const duplicate = account({ key: "duplicate", balance: null });

  test("a merged duplicate's valuations move to the survivor; a date clash is dropped, not doubled", () => {
    const valuations = [
      valuation({ accountKey: "survivor", date: "2026-11-05", amountCents: 111 }),
      valuation({ accountKey: "duplicate", date: "2026-11-05", amountCents: 222 }),
      valuation({ accountKey: "duplicate", date: "2026-11-07", amountCents: 333 }),
      valuation({ accountKey: "other", date: "2026-11-08", amountCents: 444 }),
    ];
    const merged = mergeValuations(valuations, "survivor", "duplicate");
    expect(merged.remapped).toBe(1);
    expect(merged.dropped).toBe(1);
    expect(merged.valuations.map((v) => [v.accountKey, v.date, v.amountCents])).toEqual([
      ["survivor", "2026-11-05", 111],
      ["survivor", "2026-11-07", 333],
      ["other", "2026-11-08", 444],
    ]);
    // The survivor's own row wins the clash; the moved row is re-keyed.
    expect(merged.valuations[1]?.id).toBe("survivor|2026-11-07");
    expect(valuationsHaveNoOrphans(merged.valuations, ["survivor", "other"])).toBe(true);
  });

  test("a delete drops exactly that account's valuations", () => {
    const valuations = [
      valuation({ accountKey: "gone", date: "2026-11-01" }),
      valuation({ accountKey: "stay", date: "2026-11-02" }),
    ];
    const dropped = dropAccountValuations(valuations, "gone");
    expect(dropped.dropped).toBe(1);
    expect(dropped.valuations.map((v) => v.accountKey)).toEqual(["stay"]);
    expect(valuationsHaveNoOrphans(dropped.valuations, ["stay"])).toBe(true);
  });

  test("the #282 account merge plus the valuation merge leaves no orphans", () => {
    const accounts = [survivor, duplicate];
    const mergedAccounts = mergeAccounts(accounts, [], "survivor", "duplicate");
    const mergedValuations = mergeValuations(
      [
        valuation({ accountKey: "duplicate", date: "2026-11-03", amountCents: 90000 }),
        valuation({ accountKey: "survivor", date: "2026-11-09", amountCents: 70000 }),
      ],
      "survivor",
      "duplicate",
    );
    expect(mergedValuations.valuations).toHaveLength(2);
    expect(
      valuationsHaveNoOrphans(
        mergedValuations.valuations,
        mergedAccounts.accounts.map((a) => a.key),
      ),
    ).toBe(true);
  });

  test("an opening anchor needs both halves; half an anchor is unknown, not zero", () => {
    expect(openingAnchor(account({ openingBalanceCents: 100 }))).toBeNull();
    expect(openingAnchor(account({ openingDate: "2026-11-01" }))).toBeNull();
    expect(openingAnchor(account({ openingBalanceCents: 0, openingDate: "2026-11-01" }))).toEqual({
      date: "2026-11-01",
      amountCents: 0,
      kind: "opening",
    });
  });
});
