import { describe, expect, it } from "vitest";
import { computeRoom, roomFromStated, type RoomResult } from "./room.js";
import { mkAccount, mkTx } from "./testkit.js";
import { ownAccounts } from "../views.js";
import type { Account, Tx } from "../model.js";
import { parseOwnName } from "../categories.js";

const cur = mkAccount("A1");
const base = (txs: Tx[], o: Partial<Parameters<typeof computeRoom>[0]> = {}) => {
  const accounts = o.accounts ?? [cur];
  return computeRoom({
    txs,
    accounts,
    profiles: [],
    rules: [],
    own: ownAccounts(accounts),
    asOf: "2026-10-15",
    mode: "convert",
    fxHistory: {},
    ...o,
  });
};
const LAST: Record<string, string> = {
  "2026-07": "31",
  "2026-08": "31",
  "2026-09": "30",
  "2026-10": "31",
  "2024-02": "29",
};
/** Income on the 1st and an expense on the last day: the account spans the month. */
const month = (m: string, inc: number, out: number, o: Partial<Tx> = {}): Tx[] => [
  mkTx("Employer", `${m}-01`, inc, o),
  mkTx("Shop", `${m}-${LAST[m]}`, -out, o),
];
const three = [
  ...month("2026-07", 3000, 2500),
  ...month("2026-08", 3000, 2000),
  ...month("2026-09", 3000, 2800),
];
const computed = (r: RoomResult) => {
  if (r.kind !== "computed") throw new Error(`not computed: ${JSON.stringify(r)}`);
  return r;
};

describe("computeRoom", () => {
  it("three full months: middle = median net, range = min and max", () => {
    const r = computed(base([...three, mkTx("x", "2026-10-02", -1)]));
    expect(r.months.map((m) => m.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(r.middleCents).toBe(50000);
    expect(r.lowCents).toBe(20000);
    expect(r.highCents).toBe(100000);
    expect(r.middleIncomeCents).toBe(300000);
    expect(r.partial).toBe(false);
  });

  it("current partial month is excluded (asOf mid-month)", () => {
    const r = computed(base([...three, ...month("2026-10", 9000, 0)], { asOf: "2026-10-15" }));
    expect(r.months.map((m) => m.month)).not.toContain("2026-10");
    expect(r.highCents).toBe(100000);
  });

  it("'Eigen overboeking' and txs naming another own account are excluded both ways", () => {
    const sav = mkAccount("S1", { iban: "NL91ABNA0417164300", balanceDate: "2026-09-30" });
    const a1 = mkAccount("A1", { iban: "NL02ABNA0123456789" });
    const txs = [
      ...three,
      mkTx("Move", "2026-09-10", -700, { category: "Eigen overboeking" }),
      mkTx("Sparen", "2026-09-11", -800, { description: "NL91ABNA0417164300" }),
      mkTx("Sparen", "2026-09-11", 800, { accountKey: "S1", description: "NL02ABNA0123456789" }),
      mkTx("Sparen", "2026-07-01", 1, { accountKey: "S1", category: "Eigen overboeking" }),
    ];
    const r = computed(base(txs, { accounts: [a1, sav] }));
    const sep = r.months.find((m) => m.month === "2026-09")!;
    expect(sep.outgoingCents).toBe(280000);
    expect(sep.incomingCents).toBe(300000);
  });

  it("debt repayment (DUO, loan) counts as spending", () => {
    const r = computed(base([...three, mkTx("DUO", "2026-09-15", -120)]));
    expect(r.months.find((m) => m.month === "2026-09")!.outgoingCents).toBe(292000);
  });

  it("one-off large inflow is included and widens the range", () => {
    const r = computed(base([...three, mkTx("Inheritance", "2026-08-10", 10000)]));
    expect(r.highCents).toBe(1100000);
    expect(r.lowCents).toBe(20000);
    expect(r.middleCents).toBe(50000);
  });

  it("two full months -> computed with partial=true, never extrapolated to three", () => {
    const r = computed(base([...month("2026-08", 3000, 2000), ...month("2026-09", 3000, 2800)]));
    expect(r.partial).toBe(true);
    expect(r.months).toHaveLength(2);
    expect(r.middleCents).toBe(60000);
    expect(Number.isInteger(r.middleCents)).toBe(true);
  });

  it("odd cents of the mean round to an integer", () => {
    const r = computed(base([...month("2026-08", 3000.01, 2000), ...month("2026-09", 3000, 2800)]));
    expect(Number.isInteger(r.middleCents)).toBe(true);
    expect(Number.isInteger(r.middleIncomeCents)).toBe(true);
  });

  it("zero full months -> no-full-month; no txs -> no-data", () => {
    expect(base([mkTx("x", "2026-10-02", -5)])).toEqual({
      kind: "none",
      reason: "no-full-month",
      blockingAccounts: [{ id: "A1", reason: "short", since: "2026-10" }],
    });
    expect(base([])).toEqual({ kind: "none", reason: "no-data" });
  });

  it("business-entity account txs are left out; no entity profiles -> all accounts count", () => {
    const bv = mkAccount("B1", { entity: "Acme BV" });
    const txs = [...three, ...month("2026-09", 50000, 0, { accountKey: "B1" })];
    const all = computed(base(txs, { accounts: [cur, bv] }));
    expect(all.highCents).toBe(5020000);
    const personal = computed(
      base(txs, { accounts: [cur, bv], profiles: [{ entity: "Acme BV", scope: "business" }] }),
    );
    expect(personal.highCents).toBe(100000);
  });

  it("mode 'convert': converts per tx on its date, rounded once; null rate -> excluded and counted", () => {
    const fx = { USD: { "2026-09-05": 1.1, "2026-09-06": 1.1 } };
    const txs = [
      ...three,
      mkTx("Us", "2026-09-05", 10, { currency: "USD" }),
      mkTx("Us", "2026-09-06", 10, { currency: "USD" }),
      mkTx("Chf", "2026-09-07", -10, { currency: "CHF" }),
    ];
    const r = computed(base(txs, { fxHistory: fx }));
    const sep = r.months.find((m) => m.month === "2026-09")!;
    expect(sep.incomingCents).toBe(300000 + 909 + 909);
    expect(r.excludedForeignCount).toBe(1);
    for (const m of r.months) {
      expect(Number.isInteger(m.incomingCents)).toBe(true);
      expect(Number.isInteger(m.netCents)).toBe(true);
    }
  });

  it("mode 'separate': every non-EUR tx excluded and counted", () => {
    const txs = [...three, mkTx("Us", "2026-09-05", 10, { currency: "USD" })];
    const r = computed(base(txs, { mode: "separate", fxHistory: { USD: { "2026-09-05": 1.1 } } }));
    expect(r.excludedForeignCount).toBe(1);
    expect(r.months.find((m) => m.month === "2026-09")!.incomingCents).toBe(300000);
  });

  it("account A covers 3 months, account B only 1: only fully covered months are used", () => {
    const b = mkAccount("B1");
    const txs = [...three, ...month("2026-09", 100, 50, { accountKey: "B1" })];
    const r = computed(base(txs, { accounts: [cur, b] }));
    expect(r.months.map((m) => m.month)).toEqual(["2026-09"]);
    expect(r.partial).toBe(true);
  });

  it("coverage: first tx must be on/before day 3, last tx or balanceDate on/after the last day", () => {
    const late = [mkTx("a", "2026-09-04", 100), mkTx("a", "2026-09-30", -50)];
    expect(base(late)).toEqual({
      kind: "none",
      reason: "no-full-month",
      blockingAccounts: [{ id: "A1", reason: "short", since: "2026-09" }],
    });
    const early = [mkTx("a", "2026-09-03", 100), mkTx("a", "2026-09-30", -50)];
    expect(computed(base(early)).months).toHaveLength(1);
    const short = [mkTx("a", "2026-09-01", 100), mkTx("a", "2026-09-29", -50)];
    expect(base(short)).toEqual({
      kind: "none",
      reason: "no-full-month",
      blockingAccounts: [{ id: "A1", reason: "stale" }],
    });
    const withBalance = mkAccount("A1", { balanceDate: "2026-09-30" });
    expect(computed(base(short, { accounts: [withBalance] })).months).toHaveLength(1);
  });

  it("blockingAccounts names the account that fails coverage, partial and none", () => {
    const b = mkAccount("B1");
    const partial = computed(
      base([...three, ...month("2026-09", 100, 50, { accountKey: "B1" })], { accounts: [cur, b] }),
    );
    expect(partial.blockingAccounts).toEqual([{ id: "B1", reason: "short", since: "2026-09" }]);
    const dormant = base([mkTx("a", "2026-05-01", 100, { accountKey: "B1" }), ...three], {
      accounts: [cur, b],
    });
    expect(dormant).toMatchObject({
      kind: "none",
      reason: "no-full-month",
      blockingAccounts: [{ id: "B1", reason: "stale" }],
    });
    expect(computed(base(three)).blockingAccounts).toEqual([]);
  });

  it("an account with no txs is ignored", () => {
    const empty = mkAccount("E1");
    expect(computed(base(three, { accounts: [cur, empty] })).months).toHaveLength(3);
  });

  it("leap-year February is a full month (29 days)", () => {
    const txs = [mkTx("a", "2024-02-01", 100), mkTx("a", "2024-02-29", -40)];
    const r = computed(base(txs, { asOf: "2024-03-10" }));
    expect(r.months[0]).toMatchObject({ month: "2024-02", netCents: 6000 });
  });

  it("all months negative is returned as is", () => {
    const r = computed(
      base([
        ...month("2026-07", 100, 500),
        ...month("2026-08", 100, 600),
        ...month("2026-09", 100, 700),
      ]),
    );
    expect(r.middleCents).toBe(-50000);
    expect(r.highCents).toBeLessThan(0);
  });

  describe("card settlement", () => {
    const card: Account = mkAccount("C1", { name: "Amex creditcard" });
    const settle = mkTx("ING", "2026-09-20", -300, { category: "Creditcard afbetaald" });
    const purchase = mkTx("Bol", "2026-09-10", -250, { accountKey: "C1" });
    const cardSpan = [
      mkTx("Bol", "2026-07-02", -10, { accountKey: "C1" }),
      mkTx("Bol", "2026-10-02", -10, { accountKey: "C1" }),
    ];
    it("card IN scope: settlement excluded, purchases counted", () => {
      const r = computed(
        base([...three, settle, purchase, ...cardSpan], { accounts: [cur, card] }),
      );
      expect(r.months.find((m) => m.month === "2026-09")!.outgoingCents).toBe(280000 + 25000);
    });
    it("card OUT of scope: the settlement counts as spending", () => {
      const r = computed(
        base([...three, settle, purchase, ...cardSpan], {
          accounts: [cur, { ...card, entity: "Acme BV" }],
          profiles: [{ entity: "Acme BV", scope: "business" }],
        }),
      );
      expect(r.months.find((m) => m.month === "2026-09")!.outgoingCents).toBe(280000 + 30000);
    });
  });
});

describe("card pair, own scope and bad dates (final review)", () => {
  const cur2 = mkAccount("A1", { iban: "NL01INGB0001234567" });
  const card: Account = mkAccount("C1", { name: "Amex creditcard" });
  const cardSpan = [
    mkTx("Bol", "2026-07-02", -10, { accountKey: "C1" }),
    mkTx("Bol", "2026-10-02", -10, { accountKey: "C1" }),
  ];
  const sep = (o: Partial<Tx> = {}) =>
    mkTx("ING", "2026-09-20", -300, { category: "Creditcard afbetaald", ...o });
  const sept = (r: RoomResult) => computed(r).months.find((m) => m.month === "2026-09")!;

  it("card in scope: the settlement AND the card's incoming leg both drop (pair)", () => {
    const leg = mkTx("", "2026-09-21", 300, {
      accountKey: "C1",
      description: "Betaling ontvangen",
    });
    const purchase = mkTx("Bol", "2026-09-10", -300, { accountKey: "C1" });
    const m = sept(base([...three, sep(), purchase, leg, ...cardSpan], { accounts: [cur2, card] }));
    expect(m.incomingCents).toBe(300000);
    expect(m.outgoingCents).toBe(280000 + 30000);
  });
  it("pair tolerates one cent and 7 days; a leg further away stays as income", () => {
    const near = mkTx("", "2026-09-27", 300.01, { accountKey: "C1" });
    const far = mkTx("", "2026-09-28", 300, { accountKey: "C1" });
    expect(
      sept(base([...three, sep(), near, ...cardSpan], { accounts: [cur2, card] })).incomingCents,
    ).toBe(300000);
    expect(
      sept(base([...three, sep(), far, ...cardSpan], { accounts: [cur2, card] })).incomingCents,
    ).toBe(330000);
  });
  it("no matching card leg: settlement still drops (today's behaviour)", () => {
    expect(
      sept(base([...three, sep(), ...cardSpan], { accounts: [cur2, card] })).outgoingCents,
    ).toBe(280000);
  });

  it("a business account's transfer to a personal account counts as income", () => {
    const bv = mkAccount("B1", { iban: "NL02RABO0007654321", entity: "Acme BV" });
    const accounts = [cur2, bv];
    const salary = mkTx("Acme BV", "2026-09-25", 4000, {
      description: "NL02RABO0007654321 salaris",
    });
    const r = base([...three, salary, mkTx("x", "2026-09-30", -1)], {
      accounts,
      profiles: [{ entity: "Acme BV", scope: "business" }],
      own: ownAccounts(accounts),
    });
    expect(sept(r).incomingCents).toBe(300000 + 400000);
  });
  it("a personal-to-personal transfer cancels", () => {
    const a2 = mkAccount("A2", { iban: "NL03ABNA0001112223" });
    const accounts = [cur2, a2];
    const move = mkTx("Spaar", "2026-09-12", -500, { description: "NL03ABNA0001112223 sparen" });
    const r = base([...three, move], { accounts, own: ownAccounts(accounts) });
    expect(sept(r).outgoingCents).toBe(280000);
  });
  it("the owner's NAME still cancels a transfer with no IBAN text", () => {
    const named = mkTx("A Steunenberg", "2026-09-12", -500);
    const own = { ...ownAccounts([cur2]), names: [parseOwnName("Alexander Steunenberg")!] };
    expect(sept(base([...three, named], { accounts: [cur2], own })).outgoingCents).toBe(280000);
    expect(sept(base([...three, named], { accounts: [cur2] })).outgoingCents).toBe(280000 + 50000);
  });

  it("a malformed date is ignored, not a crash", () => {
    const r = base([
      ...three,
      mkTx("x", "garbage", -5),
      mkTx("x", "05-09-2026", -5),
      mkTx("x", "2026-02-30", -5),
    ]);
    expect(sept(r).outgoingCents).toBe(280000);
  });
});

describe("roomFromStated", () => {
  it("income 2500-3000, spend 2000-2200 -> low 300, high 1000", () => {
    expect(
      roomFromStated(
        { lowCents: 250000, highCents: 300000 },
        { lowCents: 200000, highCents: 220000 },
      ),
    ).toEqual({ kind: "stated", lowCents: 30000, highCents: 100000, incomeMidCents: 275000 });
  });
});
