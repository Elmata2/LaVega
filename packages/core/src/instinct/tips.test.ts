import { describe, expect, it } from "vitest";
import { TIPS, TIP_COOLDOWN_DAYS, REPEAT_WINDOW_DAYS, type Tip } from "./tips.js";
import { INSTINCT_COPY } from "./copy.js";
import { addDays } from "./candidates.js";
import type { Account, Tx } from "../model.js";
import type { DailyInput } from "./types.js";

describe("TIPS", () => {
  it("has 5 to 8 tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(5);
    expect(TIPS.length).toBeLessThanOrEqual(8);
  });
  it("each tip has id, review metadata and a source", () => {
    for (const t of TIPS as readonly Tip[]) {
      expect(t.id).not.toBe("");
      expect(t.reviewedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(t.reviewedAt)).toBe(true);
      expect(t.reviewedBy === null || t.reviewedBy !== "").toBe(true);
      expect(t.source).not.toBe("");
    }
  });
  it("all five tips carry the owner review of 2026-11-11", () => {
    for (const t of TIPS) {
      expect(t.reviewedAt).toBe("2026-11-11");
      expect(t.reviewedBy).toBe("alexander");
    }
  });
  it("ids are unique", () => {
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
  });
  it("every tip has NL and EN text", () => {
    for (const loc of ["nl", "en"] as const)
      for (const t of TIPS) {
        const x = INSTINCT_COPY[loc].tips[t.id];
        expect(x.title && x.short && x.long).toBeTruthy();
      }
  });
  it("constants", () => {
    expect(TIP_COOLDOWN_DAYS).toBe(3);
    expect(REPEAT_WINDOW_DAYS).toBe(30);
  });
});

describe("idle-balance tip", () => {
  const TODAY = "2026-11-11";
  const KEY = "NL01INGB0000000001";
  let n = 0;
  const tx = (date: string, amount: number, over: Partial<Tx> = {}): Tx => ({
    id: `t${n++}`,
    accountKey: KEY,
    date,
    amount,
    currency: "EUR",
    counterparty: "X",
    description: "",
    category: "",
    manual: false,
    ...over,
  });
  const acc = (over: Partial<Account> = {}): Account => ({
    key: KEY,
    iban: KEY,
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 0,
    ...over,
  });
  const input = (over: Partial<DailyInput> = {}): DailyInput => ({
    today: TODAY,
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
  const idle = TIPS.find((t) => t.id === "idle-balance")!;
  const fires = (i: DailyInput) => idle.when({}, i);
  const bal = (cents: number, key = KEY) => ({ accountKey: key, cents });
  const D = (n: number) => addDays(TODAY, -n);
  /** Income lands and leaves the same day, so end-of-day balances stay flat. */
  const flow = (monthly: number, key = KEY) =>
    [85, 55, 25].flatMap((d) => [
      tx(D(d), monthly, { accountKey: key, counterparty: "Werkgever" }),
      tx(D(d), -monthly, { accountKey: key, counterparty: "Huisbaas" }),
    ]);

  it("owner example: three payments of 2000, floor exactly 1000 fires", () => {
    expect(fires(input({ txs: flow(2000), balances: [bal(100_000)] }))).toBe(true);
  });
  it("a dip to EUR 100 once in the 60 days does not fire", () => {
    const txs = [...flow(2000), tx(D(30), -900), tx(D(20), 900)];
    expect(fires(input({ txs, balances: [bal(100_000)] }))).toBe(false);
  });
  it("a dip older than 60 days does not count", () => {
    const txs = [...flow(2000), tx(D(80), -1000), tx(D(70), 1000)];
    expect(fires(input({ txs, balances: [bal(130_000)] }))).toBe(true);
  });
  it("income 6000 with floor 1000 does not fire (below half)", () => {
    expect(fires(input({ txs: flow(6000), balances: [bal(100_000)] }))).toBe(false);
  });
  it("floor EUR 200 with income 300 does not fire (below EUR 250 minimum)", () => {
    expect(fires(input({ txs: flow(300), balances: [bal(20_000)] }))).toBe(false);
  });
  it("floor EUR 250 with income 300 fires (at the minimum)", () => {
    expect(fires(input({ txs: flow(300), balances: [bal(25_000)] }))).toBe(true);
  });
  it("two current accounts whose floors sum to the threshold fire", () => {
    const K2 = "NL02INGB0000000002";
    const accounts = [acc(), acc({ key: K2, iban: K2 })];
    const txs = [...flow(2000), ...flow(0, K2)];
    expect(fires(input({ txs, accounts, balances: [bal(70_000), bal(40_000, K2)] }))).toBe(true);
    expect(fires(input({ txs, accounts, balances: [bal(50_000), bal(40_000, K2)] }))).toBe(false);
  });
  it("a savings account balance is ignored", () => {
    const K2 = "NL03SAVE0000000003";
    const accounts = [acc(), acc({ key: K2, iban: K2, type: "Spaarrekening" })];
    const txs = flow(2000);
    expect(fires(input({ txs, accounts, balances: [bal(50_000), bal(900_000, K2)] }))).toBe(false);
  });
  it("own transfers between the user's accounts do not count as income", () => {
    const K2 = "NL03SAVE0000000003";
    const accounts = [acc(), acc({ key: K2, iban: K2, type: "Spaarrekening" })];
    const txs = [85, 55, 25].flatMap((d) => [
      tx(D(d), 4000, { counterparty: "Oranje spaarrekening", description: K2 }),
      tx(D(d), -4000, { counterparty: "Oranje spaarrekening", description: K2 }),
    ]);
    // counted as income the transfers would lift it to 5000+/month and silence the tip
    const real = flow(1000);
    expect(
      fires(input({ txs: [...real, ...txs], accounts, balances: [bal(110_000), bal(0, K2)] })),
    ).toBe(true);
  });
  it("less than 30 days of data does not fire", () => {
    const txs = [tx(D(20), 2000), tx(D(20), -2000)];
    expect(fires(input({ txs, balances: [bal(100_000)] }))).toBe(false);
  });
  it("no inflows falls back to spending", () => {
    const txs = [85, 55, 25].map((d) => tx(D(d), -2000));
    expect(fires(input({ txs, balances: [bal(120_000)] }))).toBe(true);
    expect(fires(input({ txs, balances: [bal(90_000)] }))).toBe(false);
    expect(fires(input({ txs, balances: [bal(20_000)] }))).toBe(false);
  });
  it("no inflows and no spending does not fire", () => {
    expect(fires(input({ txs: [tx(D(80), 0)], balances: [bal(900_000)] }))).toBe(false);
  });
  it("a non-EUR account is ignored", () => {
    const accounts = [acc({ currency: "HUF" })];
    const txs = flow(2000).map((t) => ({ ...t, currency: "HUF" }));
    expect(fires(input({ txs, accounts, balances: [bal(100_000)] }))).toBe(false);
  });
  it("an account without a balance entry is skipped", () => {
    expect(fires(input({ txs: flow(2000), balances: [] }))).toBe(false);
  });
  it("noBankData never fires", () => {
    expect(fires(input({ txs: flow(2000), balances: [bal(100_000)], noBankData: true }))).toBe(
      false,
    );
  });
  it("does not mutate its input", () => {
    const i = input({ txs: flow(2000), balances: [bal(100_000)] });
    const before = structuredClone(i);
    fires(i);
    expect(i).toEqual(before);
  });
});
