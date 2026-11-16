import { describe, expect, it } from "vitest";
import type { Account, Tx } from "../model.js";
import { addDays } from "./candidates.js";
import { dailyMessage } from "./dailyMessage.js";
import { TIPS, type Tip } from "./tips.js";
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
  today: "2026-11-11", // yesterday = Tuesday 2026-11-10
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

const reviewed: readonly Tip[] = TIPS.map((t) => ({
  ...t,
  reviewedAt: "2026-11-10",
  reviewedBy: "test",
}));

const spendTxs = [tx("2026-11-10", -84), tx("2026-11-03", -44)];
const vat = (date: string) => ({ kind: "vat" as const, label: "BTW Q3", date });
const withDeadline = (over: Partial<DailyInput> = {}) =>
  input({
    txs: spendTxs,
    mirror: { rules: [], dueDates: [vat("2026-11-13")], cardOffer: null },
    ...over,
  });

describe("dailyMessage", () => {
  it("a deadline beats spending", () => {
    expect(dailyMessage(withDeadline())?.kind).toBe("deadline");
  });

  it("the soonest deadline wins", () => {
    const mirror = {
      rules: [],
      dueDates: [
        vat("2026-11-15"),
        { kind: "other" as const, label: "Fiscus", date: "2026-11-12" },
      ],
      cardOffer: null,
    };
    expect(dailyMessage(input({ mirror }))?.key).toBe("deadline:other:Fiscus:2026-11-12");
  });

  it("a better offer beats spending, largest gain first", () => {
    const mirror = {
      rules: [],
      dueDates: [],
      cardOffer: { name: "Kaart", yearlyGainCents: 9000, computedAt: "2026-11-01" },
    };
    expect(dailyMessage(input({ txs: spendTxs, mirror }))?.key).toBe("offer:card:Kaart");
  });

  it("the same deadline sent yesterday gives the next candidate", () => {
    const sent = { key: "deadline:vat:BTW Q3:2026-11-13", date: "2026-11-10" };
    const out = dailyMessage(withDeadline({ state: { sentKeys: [sent], lastTipDate: null } }));
    expect(out?.kind).toBe("spending");
  });

  it("a key sent 30 days ago may repeat, 29 days ago may not", () => {
    const key = "deadline:vat:BTW Q3:2026-11-13";
    const at = (d: string) =>
      withDeadline({ state: { sentKeys: [{ key, date: d }], lastTipDate: null } });
    expect(dailyMessage(at(addDays("2026-11-11", -30)))?.kind).toBe("deadline");
    expect(dailyMessage(at(addDays("2026-11-11", -29)))?.kind).toBe("spending");
  });

  it("nothing worth saying returns null", () => {
    expect(dailyMessage(input())).toBeNull();
  });

  const feeTxs = [tx("2026-10-20", -30, "ING", { category: "Bankkosten" })];

  it("an unreviewed tip is never chosen", () => {
    const unreviewed: readonly Tip[] = TIPS.map((t) => ({
      ...t,
      reviewedAt: null,
      reviewedBy: null,
    }));
    expect(dailyMessage(input({ txs: feeTxs }), unreviewed)).toBeNull();
  });

  it("a tip appears when nothing else does and it is reviewed", () => {
    expect(dailyMessage(input({ txs: feeTxs }), reviewed)).toEqual({
      kind: "tip",
      key: "tip:fee-heavy-account",
      figures: { tipId: "fee-heavy-account" },
    });
  });

  it("a tip is suppressed inside the cooldown and allowed after it", () => {
    const st = (d: string) => ({ sentKeys: [], lastTipDate: d });
    expect(dailyMessage(input({ txs: feeTxs, state: st("2026-11-09") }), reviewed)).toBeNull();
    expect(dailyMessage(input({ txs: feeTxs, state: st("2026-11-08") }), reviewed)?.kind).toBe(
      "tip",
    );
  });

  it("a tip already sent in the window is not repeated", () => {
    const state = {
      sentKeys: [{ key: "tip:fee-heavy-account", date: "2026-11-01" }],
      lastTipDate: null,
    };
    expect(dailyMessage(input({ txs: feeTxs, state }), reviewed)).toBeNull();
  });

  it("is deterministic", () => {
    const i = withDeadline();
    expect(dailyMessage(i)).toEqual(dailyMessage(i));
  });
});

describe("tip conditions", () => {
  const tipId = (i: DailyInput) => {
    const c = dailyMessage(i, reviewed);
    return c?.kind === "tip" ? c.figures.tipId : null;
  };
  it("idle balance is relative to the user's own monthly income", () => {
    const flow = (monthly: number) =>
      // distinct counterparties per month so no recurring-payment detection fires
      [
        [85, "Alpha", "Bakker"],
        [55, "Gamma", "Slager"],
        [25, "Delta", "Notaris"],
      ].flatMap(([d, from, to]) => [
        tx(addDays("2026-11-11", -Number(d)), monthly, String(from)),
        tx(addDays("2026-11-11", -Number(d)), -monthly, String(to)),
      ]);
    const b = (cents: number) => [{ accountKey: "NL01INGB0000000001", cents }];
    const only = reviewed.filter((t) => t.id === "idle-balance");
    const pick = (i: DailyInput) => {
      const c = dailyMessage(i, only);
      return c?.kind === "tip" ? c.figures.tipId : null;
    };
    expect(pick(input({ txs: flow(2000), balances: b(110_000) }))).toBe("idle-balance");
    expect(pick(input({ txs: flow(6000), balances: b(100_000) }))).toBeNull();
  });
  it("a price rise on a running subscription gives the price tip", () => {
    const last = "2026-11-05";
    const txs = [
      tx(addDays(last, -90), -12.99, "Netflix"),
      tx(addDays(last, -60), -12.99, "Netflix"),
      tx(addDays(last, -30), -15.99, "Netflix"),
      tx(last, -15.99, "Netflix"),
    ];
    expect(tipId(input({ txs }))).toBe("price-increase");
  });
  it("bank fees under EUR 25 in 90 days give no tip", () => {
    const txs = [tx("2026-10-20", -24.99, "ING", { category: "Bankkosten" })];
    expect(tipId(input({ txs }))).toBeNull();
  });
});

describe("dailyMessage without bank data (W5)", () => {
  const card = {
    name: "Kaart X",
    yearlyGainCents: 7000,
    computedAt: "2026-11-10",
  };

  it("ignores spending even when transactions are present", () => {
    expect(dailyMessage(input({ txs: spendTxs, noBankData: true }))).toBeNull();
    expect(dailyMessage(input({ txs: spendTxs }))?.kind).toBe("spending");
  });

  it("still sends a mirrored due date within 7 days", () => {
    const c = dailyMessage(withDeadline({ noBankData: true }));
    expect(c).toMatchObject({ kind: "deadline", key: "deadline:vat:BTW Q3:2026-11-13" });
  });

  it("still sends the mirrored card offer", () => {
    const c = dailyMessage(
      input({ mirror: { rules: [], dueDates: [], cardOffer: card }, noBankData: true }),
    );
    expect(c?.kind).toBe("better-offer");
  });

  it("never produces a tip, even a reviewed one whose condition is true (A6)", () => {
    const always: readonly Tip[] = [
      {
        ...TIPS[0],
        id: "many-subscriptions",
        when: () => true,
        reviewedAt: "2026-11-10",
        reviewedBy: "t",
      },
    ];
    expect(dailyMessage(input(), always)?.kind).toBe("tip");
    expect(dailyMessage(input({ noBankData: true }), always)).toBeNull();
  });

  it("does not detect renewals from transactions", () => {
    const monthly = ["2026-08-12", "2026-09-12", "2026-10-12"].map((d) => tx(d, -9.99, "StreamCo"));
    expect(dailyMessage(input({ txs: monthly }))?.kind).toBe("deadline");
    expect(dailyMessage(input({ txs: monthly, noBankData: true }))).toBeNull();
  });
});
