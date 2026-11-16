import { describe, expect, it } from "vitest";
import type { Account, Tx } from "../model.js";
import type { RateBenchmark } from "../interest.js";
import {
  addDays,
  amsterdamDay,
  deadlineCandidates,
  offerCandidates,
  spendingCandidate,
} from "./candidates.js";
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
  today: "2026-11-11", // Wednesday; yesterday = Tuesday 2026-11-10
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

describe("dates", () => {
  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("amsterdamDay uses the local day, not UTC", () => {
    // 23:30 UTC on 10 Nov = 00:30 on 11 Nov in Amsterdam (CET, UTC+1).
    expect(amsterdamDay("2026-11-10T23:30:00Z")).toBe("2026-11-11");
    // Summer (CEST, UTC+2): 22:30 UTC on 30 Jun is already 1 Jul.
    expect(amsterdamDay("2026-06-30T22:30:00Z")).toBe("2026-07-01");
    expect(amsterdamDay("2026-06-30T21:30:00Z")).toBe("2026-06-30");
    // DST change night, 25 Oct 2026: 22:30 UTC (23:30 CET) is still the 25th.
    expect(amsterdamDay("2026-10-25T22:30:00Z")).toBe("2026-10-25");
    expect(amsterdamDay("2026-10-25T23:30:00Z")).toBe("2026-10-26");
  });
  it("rejects a malformed date without echoing it", () => {
    expect(() => amsterdamDay("not-a-date")).toThrow(/invalid/);
    try {
      addDays("2026-13-45", 1);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("2026-13-45");
    }
  });
});

describe("spendingCandidate", () => {
  it("Tuesday EUR 84 vs previous Tuesday EUR 44 gives diff 4000 cents", () => {
    const c = spendingCandidate(
      input({
        txs: [
          tx("2026-11-10", -50.5),
          tx("2026-11-10", -33.5),
          tx("2026-11-03", -44),
          tx("2026-11-09", -999), // Monday, irrelevant
        ],
      }),
    );
    expect(c).toEqual({
      kind: "spending",
      key: "spending:2026-11-10",
      figures: { yesterdayCents: 8400, lastWeekdayCents: 4400, diffCents: 4000, weekday: 2 },
    });
  });
  it("rounds float euros to exact cents (19.99 + 0.01 + 30 = 5000)", () => {
    const c = spendingCandidate(
      input({
        txs: [
          tx("2026-11-10", -19.99),
          tx("2026-11-10", -0.01),
          tx("2026-11-10", -30),
          tx("2026-11-03", -20),
        ],
      }),
    );
    expect(c?.kind === "spending" && c.figures.yesterdayCents).toBe(5000);
  });
  it("EUR 10 difference gives null", () => {
    expect(
      spendingCandidate(input({ txs: [tx("2026-11-10", -54), tx("2026-11-03", -44)] })),
    ).toBeNull();
  });
  it("EUR 20 difference but under 25 percent gives null", () => {
    expect(
      spendingCandidate(input({ txs: [tx("2026-11-10", -120), tx("2026-11-03", -100)] })),
    ).toBeNull();
  });
  it("exactly EUR 20 and exactly 25 percent is emitted (boundary inclusive)", () => {
    const c = spendingCandidate(input({ txs: [tx("2026-11-10", -100), tx("2026-11-03", -80)] }));
    expect(c?.kind === "spending" && c.figures.diffCents).toBe(2000);
  });
  it("a quieter day is reported with a negative diff", () => {
    const c = spendingCandidate(input({ txs: [tx("2026-11-10", -10), tx("2026-11-03", -90)] }));
    expect(c?.kind === "spending" && c.figures.diffCents).toBe(-8000);
  });
  it("last weekday 0: needs spend of at least 2x the minimum (EUR 40)", () => {
    expect(spendingCandidate(input({ txs: [tx("2026-11-10", -39.99)] }))).toBeNull();
    const c = spendingCandidate(input({ txs: [tx("2026-11-10", -40)] }));
    expect(c?.kind === "spending" && c.figures.lastWeekdayCents).toBe(0);
  });
  it("same weekday last week, not the day before", () => {
    // Monday is huge but must not be compared with.
    expect(
      spendingCandidate(
        input({ txs: [tx("2026-11-10", -60), tx("2026-11-03", -60), tx("2026-11-09", -900)] }),
      ),
    ).toBeNull();
  });
  it("excludes own transfers (via the other account's IBAN)", () => {
    const savings = acc({ key: "NL02INGB0000000002", iban: "NL02INGB0000000002", name: "Spaar" });
    const c = spendingCandidate(
      input({
        accounts: [acc(), savings],
        txs: [
          tx("2026-11-10", -500, "Oranje Spaarrekening", { description: "NL02INGB0000000002" }),
          tx("2026-11-10", -10),
          tx("2026-11-03", -10),
        ],
      }),
    );
    expect(c).toBeNull();
  });
  it("card payoff and top-up are not spend", () => {
    const c = spendingCandidate(
      input({
        txs: [
          tx("2026-11-10", -800, "ING", { description: "Aflossing creditcard" }),
          tx("2026-11-10", -300, "Tikkie", { description: "Tikkie" }),
          tx("2026-11-10", -10),
          tx("2026-11-03", -10),
        ],
      }),
    );
    expect(c).toBeNull();
  });
  it("ignores HUF spend and positive amounts", () => {
    expect(
      spendingCandidate(
        input({
          txs: [
            tx("2026-11-10", -50000, "Tesco", { currency: "HUF" }),
            tx("2026-11-10", 500, "Refund"),
          ],
        }),
      ),
    ).toBeNull();
  });
  it("a tx with no currency counts as EUR", () => {
    const c = spendingCandidate(input({ txs: [tx("2026-11-10", -60, "X", { currency: "" })] }));
    expect(c?.kind === "spending" && c.figures.yesterdayCents).toBe(6000);
  });
});

describe("deadlineCandidates", () => {
  // lastDate 2026-09-xx; cadence 30 -> next = lastDate + 30
  const subs = (last: string) => [
    tx(addDays(last, -60), -15.99, "Netflix"),
    tx(addDays(last, -30), -15.99, "Netflix"),
    tx(last, -15.99, "Netflix"),
  ];

  it("monthly charge due in 5 days gives a renewal with amount in cents", () => {
    const today = "2026-11-11";
    const out = deadlineCandidates(input({ today, txs: subs(addDays(today, 5 - 30)) }));
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.kind).toBe("deadline");
    if (c.kind !== "deadline") return;
    expect(c.figures).toMatchObject({
      what: "renewal",
      daysAway: 5,
      dueDate: "2026-11-16",
      amountCents: 1599,
    });
  });
  it("due today is daysAway 0; due in 7 included; due in 9 and overdue excluded", () => {
    const today = "2026-11-11";
    const days = (d: number) =>
      deadlineCandidates(input({ today, txs: subs(addDays(today, d - 30)) }));
    const first = days(0)[0];
    expect(first?.kind === "deadline" && first.figures.daysAway).toBe(0);
    expect(days(7)).toHaveLength(1);
    expect(days(8)).toHaveLength(0);
    expect(days(9)).toHaveLength(0);
  });
  it("VAT mirror date in 3 days gives a deadline with null amount", () => {
    const out = deadlineCandidates(
      input({
        mirror: {
          rules: [],
          cardOffer: null,
          dueDates: [{ kind: "vat", label: "BTW Q3", date: "2026-11-14" }],
        },
      }),
    );
    expect(out).toEqual([
      {
        kind: "deadline",
        key: expect.any(String),
        figures: {
          what: "vat",
          name: "BTW Q3",
          dueDate: "2026-11-14",
          daysAway: 3,
          amountCents: null,
        },
      },
    ]);
  });
  it("mirror dates outside 0..7 days are dropped", () => {
    const out = deadlineCandidates(
      input({
        mirror: {
          rules: [],
          cardOffer: null,
          dueDates: [
            { kind: "vat", label: "old", date: "2026-11-10" },
            { kind: "other", label: "far", date: "2026-11-19" },
            { kind: "other", label: "edge", date: "2026-11-18" },
          ],
        },
      }),
    );
    expect(out.map((c) => c.kind === "deadline" && c.figures.name)).toEqual(["edge"]);
  });
  it("sorts soonest first, keys are unique and carry no raw amounts", () => {
    const today = "2026-11-11";
    const out = deadlineCandidates(
      input({
        today,
        txs: subs(addDays(today, 6 - 30)),
        mirror: {
          rules: [],
          cardOffer: null,
          dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-13" }],
        },
      }),
    );
    expect(out.map((c) => c.kind === "deadline" && c.figures.daysAway)).toEqual([2, 6]);
    expect(new Set(out.map((c) => c.key)).size).toBe(2);
  });
  it("a HUF subscription is not turned into a euro renewal", () => {
    const today = "2026-11-11";
    const hs = subs(addDays(today, 5 - 30)).map((t) => ({ ...t, currency: "HUF" }));
    expect(deadlineCandidates(input({ today, txs: hs }))).toHaveLength(0);
  });
});

describe("offerCandidates", () => {
  const rate = (ratePct: number): RateBenchmark => ({
    bank: "Bank X",
    product: "Spaar",
    ratePct,
    freeWithdrawal: true,
  });
  const sav = acc({
    key: "NL09SAVE0000000009",
    iban: "NL09SAVE0000000009",
    name: "Oranje Spaarrekening",
    balance: 20000,
    interestRate: 1,
  });
  const bal = (cents: number) => [{ accountKey: sav.key, cents }];

  it("EUR 20,000 at 1.0% vs best 3.0% gives yearlyGainCents 40000", () => {
    const out = offerCandidates(
      input({ accounts: [acc(), sav], balances: bal(2_000_000), rates: [rate(3)] }),
    );
    expect(out).toEqual([
      {
        kind: "better-offer",
        key: expect.any(String),
        figures: { what: "rate", name: "Bank X", yearlyGainCents: 40000 },
      },
    ]);
  });
  it("detects the current rate from rente credits when none is set", () => {
    const s = { ...sav, interestRate: undefined };
    // EUR 200 interest in the last year on EUR 20,000 = 1.00%
    const out = offerCandidates(
      input({
        accounts: [s],
        balances: bal(2_000_000),
        rates: [rate(3)],
        txs: [tx("2026-06-30", 200, "ING", { accountKey: s.key, description: "Rente" })],
      }),
    );
    expect(out[0]?.kind === "better-offer" && out[0].figures.yearlyGainCents).toBe(40000);
  });
  it("EUR 100 at +1 point (EUR 1 a year) gives none", () => {
    const small = { ...sav, balance: 100 };
    expect(
      offerCandidates(input({ accounts: [small], balances: bal(10_000), rates: [rate(2)] })),
    ).toEqual([]);
  });
  it("boundary: gain of 4999 none, 5000 emitted", () => {
    // 1 point on EUR 4,999.00 = 4999 cents; on EUR 5,000.00 = 5000 cents
    expect(
      offerCandidates(input({ accounts: [sav], balances: bal(499_900), rates: [rate(2)] })),
    ).toEqual([]);
    expect(
      offerCandidates(input({ accounts: [sav], balances: bal(500_000), rates: [rate(2)] })),
    ).toHaveLength(1);
  });
  it("no offer when the current rate is unknown or already the best", () => {
    const unknown = { ...sav, interestRate: undefined };
    expect(
      offerCandidates(input({ accounts: [unknown], balances: bal(2_000_000), rates: [rate(3)] })),
    ).toEqual([]);
    expect(
      offerCandidates(input({ accounts: [sav], balances: bal(2_000_000), rates: [rate(1)] })),
    ).toEqual([]);
  });
  it("uses the largest EUR savings account only; a HUF pocket never wins", () => {
    const huf = {
      ...sav,
      key: "HUF000000000000001",
      iban: "HUF000000000000001",
      currency: "HUF",
      name: "Savings HUF",
    };
    const out = offerCandidates(
      input({
        accounts: [huf, sav],
        balances: [
          { accountKey: huf.key, cents: 9_000_000_000 },
          { accountKey: sav.key, cents: 2_000_000 },
        ],
        rates: [rate(3)],
      }),
    );
    expect(out[0]?.kind === "better-offer" && out[0].figures.yearlyGainCents).toBe(40000);
  });
  it("card snapshot EUR 49 none, EUR 50 emitted, stale (91 days) none", () => {
    const card = (cents: number, computedAt: string) =>
      input({
        mirror: {
          rules: [],
          dueDates: [],
          cardOffer: { name: "Card Y", yearlyGainCents: cents, computedAt },
        },
      });
    expect(offerCandidates(card(4999, "2026-11-01"))).toEqual([]);
    expect(offerCandidates(card(5000, "2026-11-01"))).toEqual([
      {
        kind: "better-offer",
        key: expect.any(String),
        figures: { what: "card", name: "Card Y", yearlyGainCents: 5000 },
      },
    ]);
    expect(offerCandidates(card(5000, "2026-08-12"))).toEqual([]); // 91 days
    expect(offerCandidates(card(5000, "2026-08-13"))).toHaveLength(1); // 90 days
  });
  it("errors never carry merchant names or amounts", () => {
    expect(() => spendingCandidate(input({ today: "garbage" }))).toThrow(/invalid/);
  });
});
