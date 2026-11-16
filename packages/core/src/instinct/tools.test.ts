import { describe, expect, it } from "vitest";
import type { Account, Tx } from "../model.js";
import { spendingCandidate } from "./candidates.js";
import { parseToolCall, runTool, type ToolCall } from "./tools.js";
import type { DailyInput } from "./types.js";

let n = 0;
const tx = (date: string, amount: number, cp = "Albert Heijn", over: Partial<Tx> = {}): Tx => ({
  id: `t${n++}`,
  accountKey: "NL01INGB0000000001",
  date,
  amount,
  currency: "EUR",
  counterparty: cp,
  description: "",
  category: "",
  manual: false,
  ...over,
});
const acc = (over: Partial<Account> = {}): Account => ({
  key: "NL01INGB0000000001",
  iban: "NL01INGB0000000001",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 1000,
  ...over,
});
const input = (over: Partial<DailyInput> = {}): DailyInput => ({
  today: "2026-11-11", // Wednesday
  txs: [],
  accounts: [acc()],
  rules: [],
  mirror: { rules: [], dueDates: [], cardOffer: null },
  balances: [],
  rates: [],
  answers: {},
  state: { sentKeys: [], lastTipDate: null },
  ...over,
});

const DUTCH =
  /\b(je|jouw|gaf|uit|meer|minder|dan|vorige|aan|van|tot|en|met|geen|voor|het|een|de|op|samen|komende|dagen|gegevens|beschikbaar)\b/i;

describe("spending_on_day", () => {
  it("equals the manual sum of that day (EUR out only)", () => {
    const i = input({
      txs: [
        tx("2026-11-10", -12.34),
        tx("2026-11-10", -0.66),
        tx("2026-11-10", 50, "Salaris"),
        tx("2026-11-10", -9999, "HUF shop", { currency: "HUF" }),
        tx("2026-11-09", -5),
      ],
    });
    const r = runTool({ tool: "spending_on_day", date: "2026-11-10" }, i, "en");
    expect(r.figures).toMatchObject({ date: "2026-11-10", totalCents: 1300 });
    expect(r.facts.join(" ")).toContain("€13");
  });

  it("excludes own transfers, card payoffs and Overboekingen", () => {
    const i = input({
      accounts: [acc(), acc({ key: "NL02INGB0000000002", iban: "NL02INGB0000000002" })],
      txs: [
        tx("2026-11-10", -100, "NL02INGB0000000002"),
        tx("2026-11-10", -200, "x", { category: "Creditcard afbetaald" }),
        tx("2026-11-10", -300, "x", { category: "Overboekingen" }),
        tx("2026-11-10", -7, "Albert Heijn"),
      ],
    });
    const r = runTool({ tool: "spending_on_day", date: "2026-11-10" }, i, "nl");
    expect(r.figures).toMatchObject({ totalCents: 700 });
  });

  it("a day outside the 90-day window reports no coverage and no amount", () => {
    const i = input({ txs: [tx("2026-01-01", -50)] });
    const r = runTool({ tool: "spending_on_day", date: "2026-01-01" }, i, "en");
    expect(r.figures).toMatchObject({
      covered: 0,
      coveredFrom: "2026-08-14",
      coveredTo: "2026-11-11",
    });
    expect(r.figures.totalCents).toBeUndefined();
  });
});

describe("spending_in_range", () => {
  const txs = [
    tx("2026-11-01", -10, "Albert Heijn", { category: "Boodschappen" }),
    tx("2026-11-02", -20, "Shell", { category: "Transport" }),
    tx("2026-11-03", -5, "Albert Heijn", { category: "Boodschappen" }),
  ];
  it("sums the range and filters by category", () => {
    const i = input({ txs });
    const all = runTool(
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-03" },
      i,
      "en",
    );
    expect(all.figures).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-03",
      totalCents: 3500,
      coveredFrom: "2026-11-01",
      coveredTo: "2026-11-03",
    });
    const cat = runTool(
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-03", category: "Boodschappen" },
      i,
      "en",
    );
    expect(cat.figures).toMatchObject({ totalCents: 1500, category: "Boodschappen" });
  });

  it("clamps a range that starts before the window and reports coveredFrom", () => {
    const i = input({
      txs: [tx("2026-01-05", -999), tx("2026-08-14", -10), tx("2026-11-11", -5)],
    });
    const r = runTool({ tool: "spending_in_range", from: "2026-01-01", to: "2026-12-31" }, i, "en");
    expect(r.figures).toMatchObject({
      totalCents: 1500,
      coveredFrom: "2026-08-14",
      coveredTo: "2026-11-11",
    });
    expect(r.facts.length).toBeGreaterThan(1);
  });

  it("a range wholly outside the window reports no coverage", () => {
    const r = runTool(
      { tool: "spending_in_range", from: "2025-01-01", to: "2025-02-01" },
      input(),
      "en",
    );
    expect(r.figures).toMatchObject({ covered: 0 });
    expect(r.figures.totalCents).toBeUndefined();
  });
});

describe("compare_weekday", () => {
  it("matches the Task 5 spending candidate", () => {
    const i = input({ txs: [tx("2026-11-10", -84), tx("2026-11-03", -44)] });
    const c = spendingCandidate(i);
    if (c?.kind !== "spending") throw new Error("expected candidate");
    const r = runTool({ tool: "compare_weekday", date: "2026-11-10" }, i, "en");
    expect(r.figures).toMatchObject({
      date: "2026-11-10",
      lastWeekDate: "2026-11-03",
      dateCents: c.figures.yesterdayCents,
      lastWeekCents: c.figures.lastWeekdayCents,
      diffCents: c.figures.diffCents,
      weekday: c.figures.weekday,
    });
    expect(r.facts[0]).toContain("more");
  });

  it("says same when equal and less when lower, in NL too", () => {
    const i = input({ txs: [tx("2026-11-10", -10), tx("2026-11-03", -30)] });
    const en = runTool({ tool: "compare_weekday", date: "2026-11-10" }, i, "en");
    expect(en.facts[0]).toContain("less");
    expect(en.figures.diffCents).toBe(-2000);
    const nl = runTool({ tool: "compare_weekday", date: "2026-11-10" }, i, "nl");
    expect(nl.facts[0]).toContain("minder");
    const same = runTool(
      { tool: "compare_weekday", date: "2026-11-10" },
      input({ txs: [tx("2026-11-10", -10), tx("2026-11-03", -10)] }),
      "en",
    );
    expect(same.facts[0]).toContain("same");
  });
});

describe("upcoming_charges", () => {
  const netflix = [
    tx("2026-08-13", -15.99, "Netflix"),
    tx("2026-09-13", -15.99, "Netflix"),
    tx("2026-10-13", -15.99, "Netflix"),
  ];
  it("lists detected subscriptions due within the days", () => {
    const i = input({ txs: netflix, today: "2026-11-08" });
    const r = runTool({ tool: "upcoming_charges", days: 7 }, i, "en");
    expect(r.figures).toMatchObject({
      days: 7,
      count: 1,
      totalCents: 1599,
      charge1Name: "Netflix",
      charge1Date: "2026-11-12",
      charge1Cents: 1599,
    });
    expect(r.facts.join(" ")).toContain("Netflix");
    const none = runTool({ tool: "upcoming_charges", days: 2 }, i, "en");
    expect(none.figures).toMatchObject({ count: 0, totalCents: 0 });
    expect(r.containsBankText).toBe(true);
    expect(none.containsBankText).toBe(false);
  });
  it("marks every other tool as free of bank text", () => {
    const i = input({ txs: [tx("2026-11-10", -5, "Secret Shop")] });
    for (const call of [
      { tool: "spending_on_day", date: "2026-11-10" },
      { tool: "spending_in_range", from: "2026-01-01", to: "2026-11-10" },
      { tool: "compare_weekday", date: "2026-11-10" },
      { tool: "top_categories", from: "2026-11-01", to: "2026-11-10" },
      { tool: "unknown" },
    ] satisfies ToolCall[]) {
      const r = runTool(call, i, "nl");
      expect(r.containsBankText, call.tool).toBe(false);
      expect(r.facts.join(" ")).not.toContain("Secret Shop");
    }
  });
});

describe("top_categories", () => {
  it("ranks spend categories, largest first, max 5", () => {
    const txs = [
      tx("2026-11-01", -10, "a", { category: "Boodschappen" }),
      tx("2026-11-01", -50, "b", { category: "Transport" }),
      tx("2026-11-02", -5, "c", { category: "Boodschappen" }),
      tx("2026-11-02", -1, "d", { category: "Overboekingen" }),
    ];
    const r = runTool(
      { tool: "top_categories", from: "2026-11-01", to: "2026-11-05" },
      input({ txs }),
      "en",
    );
    expect(r.figures).toMatchObject({
      count: 2,
      category1: "Transport",
      category1Cents: 5000,
      category2: "Boodschappen",
      category2Cents: 1500,
    });
  });
});

describe("unknown and exhaustiveness", () => {
  it("unknown gives no figures and no facts", () => {
    expect(runTool({ tool: "unknown" }, input(), "en")).toEqual({
      figures: {},
      facts: [],
      containsBankText: false,
      empty: true,
    });
  });
});

describe("empty: nothing was found or the period is not covered", () => {
  it("is true outside the window, with no upcoming charges, with no categories, for unknown", () => {
    const i = input({ txs: [tx("2026-01-01", -50)] });
    expect(runTool({ tool: "spending_on_day", date: "2026-01-01" }, i, "nl").empty).toBe(true);
    expect(
      runTool({ tool: "spending_in_range", from: "2025-01-01", to: "2025-02-01" }, i, "nl").empty,
    ).toBe(true);
    expect(runTool({ tool: "compare_weekday", date: "2026-01-01" }, i, "nl").empty).toBe(true);
    expect(runTool({ tool: "upcoming_charges", days: 7 }, input(), "nl").empty).toBe(true);
    expect(
      runTool({ tool: "top_categories", from: "2026-11-01", to: "2026-11-10" }, input(), "nl")
        .empty,
    ).toBe(true);
    expect(
      runTool({ tool: "top_categories", from: "2025-01-01", to: "2025-02-01" }, i, "nl").empty,
    ).toBe(true);
  });

  it("is false when there is something to report", () => {
    const i = input({ txs: [tx("2026-11-10", -50, "Albert Heijn", { category: "Boodschappen" })] });
    expect(runTool({ tool: "spending_on_day", date: "2026-11-10" }, i, "nl").empty).toBe(false);
    expect(
      runTool({ tool: "spending_in_range", from: "2026-11-01", to: "2026-11-10" }, i, "nl").empty,
    ).toBe(false);
    expect(
      runTool({ tool: "top_categories", from: "2026-11-01", to: "2026-11-10" }, i, "nl").empty,
    ).toBe(false);
  });
});

describe("locale", () => {
  it("every fact renders in both locales and EN has no Dutch", () => {
    const i = input({
      txs: [tx("2026-11-10", -84, "a", { category: "Transport" }), tx("2026-11-03", -44)],
    });
    const calls: ToolCall[] = [
      { tool: "spending_on_day", date: "2026-11-10" },
      { tool: "spending_on_day", date: "2020-01-01" },
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-10", category: "Transport" },
      { tool: "spending_in_range", from: "2026-01-01", to: "2026-11-10" },
      { tool: "compare_weekday", date: "2026-11-10" },
      { tool: "upcoming_charges", days: 5 },
      { tool: "top_categories", from: "2026-11-01", to: "2026-11-10" },
    ];
    for (const c of calls) {
      const en = runTool(c, i, "en");
      const nl = runTool(c, i, "nl");
      expect(en.facts.length).toBeGreaterThan(0);
      expect(nl.facts.length).toBe(en.facts.length);
      expect(nl.facts).not.toEqual(en.facts);
      for (const f of en.facts) expect(f.replace(/Transport/g, "")).not.toMatch(DUTCH);
    }
  });
});

describe("number discipline", () => {
  it("every number in a fact is derivable from the figures", () => {
    const i = input({
      txs: [
        tx("2026-11-10", -84.5, "a", { category: "Transport" }),
        tx("2026-11-03", -44),
        tx("2026-08-13", -15.99, "Netflix"),
        tx("2026-09-13", -15.99, "Netflix"),
        tx("2026-10-13", -15.99, "Netflix"),
      ],
      today: "2026-11-11",
    });
    const calls: ToolCall[] = [
      { tool: "spending_on_day", date: "2026-11-10" },
      { tool: "spending_in_range", from: "2026-01-01", to: "2026-11-10" },
      { tool: "compare_weekday", date: "2026-11-10" },
      { tool: "upcoming_charges", days: 31 },
      { tool: "top_categories", from: "2026-11-01", to: "2026-11-10" },
    ];
    for (const c of calls) {
      const r = runTool(c, i, "en");
      const allowed = new Set<string>();
      for (const v of Object.values(r.figures)) {
        if (typeof v === "number") {
          allowed.add(String(v));
          allowed.add(String(v / 100));
          allowed.add((v / 100).toFixed(2));
        } else for (const m of v.match(/\d+/g) ?? []) allowed.add(String(Number(m)));
      }
      for (const f of r.facts)
        for (const m of f.replace(/,/g, ".").match(/\d+(\.\d+)?/g) ?? [])
          expect(allowed.has(m) || allowed.has(String(Number(m)))).toBe(true);
    }
  });
});

describe("purity", () => {
  it("same input same output, input not mutated", () => {
    const i = input({ txs: [tx("2026-11-10", -84), tx("2026-11-03", -44)] });
    const snap = JSON.stringify(i);
    const a = runTool({ tool: "top_categories", from: "2026-11-01", to: "2026-11-10" }, i, "en");
    const b = runTool({ tool: "top_categories", from: "2026-11-01", to: "2026-11-10" }, i, "en");
    expect(a).toEqual(b);
    expect(JSON.stringify(i)).toBe(snap);
  });
});

describe("parseToolCall", () => {
  const U = { tool: "unknown" };
  it("accepts every valid shape", () => {
    expect(parseToolCall({ tool: "spending_on_day", date: "2026-11-10" })).toEqual({
      tool: "spending_on_day",
      date: "2026-11-10",
    });
    expect(
      parseToolCall({
        tool: "spending_in_range",
        from: "2026-11-01",
        to: "2026-11-10",
        category: "Transport",
      }),
    ).toEqual({
      tool: "spending_in_range",
      from: "2026-11-01",
      to: "2026-11-10",
      category: "Transport",
    });
    expect(
      parseToolCall({ tool: "spending_in_range", from: "2026-11-01", to: "2026-11-01" }),
    ).toEqual({ tool: "spending_in_range", from: "2026-11-01", to: "2026-11-01" });
    expect(parseToolCall({ tool: "compare_weekday", date: "2026-11-10" })).toEqual({
      tool: "compare_weekday",
      date: "2026-11-10",
    });
    expect(parseToolCall({ tool: "upcoming_charges", days: 31 })).toEqual({
      tool: "upcoming_charges",
      days: 31,
    });
    expect(parseToolCall({ tool: "top_categories", from: "2026-11-01", to: "2026-11-10" })).toEqual(
      { tool: "top_categories", from: "2026-11-01", to: "2026-11-10" },
    );
    expect(parseToolCall({ tool: "unknown" })).toEqual(U);
  });

  it("rejects injected and malformed input as unknown", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "spending_on_day",
      42,
      [],
      [{ tool: "spending_on_day", date: "2026-11-10" }],
      {},
      { tool: "drop" },
      { tool: "drop table users" },
      { tool: "spending_on_day; DROP TABLE tx" },
      { tool: 5 },
      { tool: "spending_on_day" },
      { tool: "spending_on_day", date: "2026-11-10", extra: 1 },
      { tool: "spending_on_day", date: "2026-11-10'; DROP TABLE tx;--" },
      { tool: "spending_on_day", date: "2026-02-30" },
      { tool: "spending_on_day", date: "2026-13-01" },
      { tool: "spending_on_day", date: "2026-1-5" },
      { tool: "spending_on_day", date: "2026-11-10T00:00:00Z" },
      { tool: "spending_on_day", date: 20261110 },
      { tool: "spending_on_day", date: null },
      { tool: "spending_in_range", from: "2026-11-10", to: "2026-11-01" },
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-10", category: "NotACategory" },
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-10", category: "x'; DROP" },
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-10", category: 5 },
      { tool: "spending_in_range", from: "2026-11-01", to: "2026-11-10", category: undefined },
      { tool: "compare_weekday", date: "2026-02-29" },
      { tool: "upcoming_charges", days: 0 },
      { tool: "upcoming_charges", days: 32 },
      { tool: "upcoming_charges", days: -1 },
      { tool: "upcoming_charges", days: 1.5 },
      { tool: "upcoming_charges", days: "7" },
      { tool: "upcoming_charges", days: Number.NaN },
      { tool: "upcoming_charges", days: Infinity },
      { tool: "upcoming_charges" },
      { tool: "top_categories", from: "2026-11-01" },
      { tool: "top_categories", from: "2026-11-01", to: "2026-11-10", category: "Transport" },
      { tool: "unknown", extra: 1 },
    ];
    for (const b of bad) expect(parseToolCall(b)).toEqual(U);
  });

  it("rejects a __proto__ own key", () => {
    const o = JSON.parse('{"tool":"spending_on_day","date":"2026-11-10","__proto__":{"x":1}}');
    expect(parseToolCall(o)).toEqual(U);
  });

  it("accepts a leap day and rejects a non-leap one", () => {
    expect(parseToolCall({ tool: "compare_weekday", date: "2028-02-29" }).tool).toBe(
      "compare_weekday",
    );
    expect(parseToolCall({ tool: "compare_weekday", date: "2026-02-29" }).tool).toBe("unknown");
  });

  it("does not trust inherited keys", () => {
    const o = Object.create({ tool: "spending_on_day", date: "2026-11-10" });
    expect(parseToolCall(o)).toEqual(U);
  });
});

describe("upcoming_charges truncation", () => {
  const many = Array.from({ length: 12 }, (_, n) =>
    ["2026-08-13", "2026-09-13", "2026-10-13"].map((d) =>
      tx(d, -(10 + n), `Dienst${String.fromCharCode(65 + n)}`),
    ),
  ).flat();

  it("counts and totals ALL renewals, lists 10, says how many more", () => {
    const i = input({ txs: many, today: "2026-11-08" });
    for (const locale of ["en", "nl"] as const) {
      const r = runTool({ tool: "upcoming_charges", days: 7 }, i, locale);
      // sum 10..21 = 186 euro
      expect(r.figures).toMatchObject({ count: 12, listed: 10, more: 2, totalCents: 18600 });
      expect(r.figures.charge10Name).toBeDefined();
      expect(r.figures.charge11Name).toBeUndefined();
      expect(r.facts.length).toBe(10 + 2);
      expect(r.facts.join(" ")).toContain("2");
      expect(r.facts.join(" ")).toContain("186");
    }
  });
});

describe("parseToolCall prototype names", () => {
  it("constructor and toString are unknown", () => {
    expect(parseToolCall({ tool: "constructor" })).toEqual({ tool: "unknown" });
    expect(parseToolCall({ tool: "toString" })).toEqual({ tool: "unknown" });
  });
});
