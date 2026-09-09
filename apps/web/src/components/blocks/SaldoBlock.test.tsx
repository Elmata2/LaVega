import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { formatEuro } from "../../format.js";
import SaldoBlock, { changePct, POSITION_WINDOW_DAYS, positionSeries } from "./SaldoBlock";
import { accounts, ASOF, freshAccounts, freshTxs, scheduledFlows, txs } from "./fixtures";

/** Today's default and every existing test's mode: a non-EUR balance is
 *  left out exactly as it always was, never converted. */
const SEPARATE = { fxHistory: {}, mode: "separate" as const };

// A freshly EB-linked Revolut: one EUR pocket plus one HUF pocket. Enable
// Banking hands back a separate account per currency pocket, and until now
// positionSeries summed every account's `balance` regardless of `currency` —
// so the HUF pocket's face value (380.000, worth roughly 950 EUR) landed in
// the EUR total unconverted, on top of the real 4.500.
const revolutAccounts: Account[] = [
  {
    key: "R1",
    iban: "LT123456789012345678",
    name: "Current",
    bank: "Revolut",
    entity: "Prive",
    currency: "EUR",
    balance: 4_500,
  },
  {
    key: "R2",
    iban: "LT987654321098765432",
    name: "Current (HUF)",
    bank: "Revolut",
    entity: "Prive",
    currency: "HUF",
    balance: 380_000,
  },
];

const KNOWN_SUM = 182_310 + 21_900;

test("SaldoBlock renders the summed known balances and what the number covers", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={accounts}
      txs={txs}
      scheduledFlows={scheduledFlows}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  // A3 has no saldo, so the title is flagged "(deels)" and the figure is the
  // sum of the two known balances.
  expect(html).toContain("Totale positie (deels)");
  expect(html).toContain(formatEuro(KNOWN_SUM));
  expect(html).toContain("1 rekening nog zonder saldo");
  expect(html).toContain("Rekeningen");
  expect(html).toContain("3 rekeningen · 3 entiteiten");
  // Two unpaid VAT outflows are reserved, so "beschikbaar" is the net figure.
  expect(html).toContain("beschikbaar na BTW-reservering");
  expect(html).toContain(formatEuro(KNOWN_SUM - (412_500 + 380_000) / 100));
});

test("SaldoBlock draws the position graph and both comparisons when history allows", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={accounts}
      txs={txs}
      scheduledFlows={scheduledFlows}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  expect(html).toContain("lv-chart-svg");
  expect(html).toContain("Totale positie per dag");
  expect(html).toContain("Vorige week");
  expect(html).toContain("Vorige maand");
  // A week ago the only later movement was t6 (-1.100 on 11 aug), so the
  // position then was higher by exactly that.
  expect(html).toContain(formatEuro(KNOWN_SUM + 1_100));
  // A month ago, t5 (-250) and t6 (-1.100) had not landed yet.
  expect(html).toContain(formatEuro(KNOWN_SUM + 1_350));
  expect(html).not.toContain("Nog geen week geschiedenis");
});

test("the percentage beside the big number says what it is measured against", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={accounts}
      txs={txs}
      scheduledFlows={scheduledFlows}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  // "▲ 1%" on its own is unreadable — one percent since when? The pill is the
  // move against the position one week ago, and the card now says so.
  expect(html).toContain("delta-pill");
  expect(html).toContain("t.o.v. vorige week");
});

test("with no week of history there is neither a pill nor a claim about one", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={freshAccounts}
      txs={freshTxs}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  expect(html).not.toContain("delta-pill");
  expect(html).not.toContain("t.o.v. vorige week");
});

test("SaldoBlock refuses to draw a line it cannot back with history", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={freshAccounts}
      txs={freshTxs}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  // Two days of history: no chart, and the card says why rather than drawing a
  // flat line that would read as "your position did not move".
  expect(html).not.toContain("lv-chart-svg");
  expect(html).toContain("2 dagen transactiegeschiedenis");
  expect(html).toContain("Nog geen week geschiedenis");
  expect(html).toContain("Nog geen maand geschiedenis");
  // And no 0% pill anywhere.
  expect(html).not.toContain("delta-flat");
});

test("SaldoBlock shows a dash and an instruction with no accounts at all", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={[]}
      txs={[]}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  expect(html).toContain("—");
  expect(html).toContain("Importeer een bestand of vul saldo"); // apostrophe is HTML-escaped
  expect(html).not.toContain("beschikbaar na BTW-reservering");
  expect(html).toContain("Nog geen transacties op de rekeningen met een saldo");
});

test("positionSeries walks today's position back through the transactions", () => {
  const s = positionSeries(accounts, txs, ASOF, POSITION_WINDOW_DAYS, SEPARATE);
  expect(s.current).toBe(KNOWN_SUM);
  expect(s.excluded).toBe(1); // A3 has no saldo and is left out of both sides
  // 30-day window, so 31 daily points ending on asOf.
  expect(s.points).toHaveLength(31);
  expect(s.points[s.points.length - 1]).toEqual({ date: ASOF, value: KNOWN_SUM });
  expect(s.points[0].date).toBe("2026-07-17");
  expect(s.weekAgo).toBe(KNOWN_SUM + 1_100);
  expect(s.monthAgo).toBe(KNOWN_SUM + 1_350);
  // The step down happens on the day t6 landed, not before it.
  const at = (d: string) => s.points.find((p) => p.date === d)?.value;
  expect(at("2026-08-10")).toBe(KNOWN_SUM + 1_100);
  expect(at("2026-08-11")).toBe(KNOWN_SUM);
});

test("positionSeries excludes a foreign-currency balance instead of adding its face value to the EUR total", () => {
  const s = positionSeries(revolutAccounts, [], ASOF, POSITION_WINDOW_DAYS, SEPARATE);
  expect(s.current).toBe(4_500); // the HUF pocket does not get added at face value
  expect(s.excluded).toBe(1);
  expect(s.excludedCurrencyKeys).toEqual(["R2"]);
});

test("SaldoBlock names the foreign-currency account it left out, separately from a missing saldo", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={revolutAccounts}
      txs={[]}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
      {...SEPARATE}
    />,
  );
  expect(html).toContain(formatEuro(4_500));
  expect(html).not.toContain(formatEuro(384_500));
  expect(html).toContain("vreemde valuta");
  expect(html).toContain("Revolut");
});

test("positionSeries stops at the oldest transaction and reports no comparison", () => {
  const s = positionSeries(freshAccounts, freshTxs, ASOF, POSITION_WINDOW_DAYS, SEPARATE);
  expect(s.coverageDays).toBe(2);
  expect(s.points[0].date).toBe("2026-08-14");
  expect(s.weekAgo).toBeNull();
  expect(s.monthAgo).toBeNull();
});

test("positionSeries returns no history at all when nothing is imported", () => {
  const s = positionSeries([], [], ASOF, POSITION_WINDOW_DAYS, SEPARATE);
  expect(s.points).toEqual([]);
  expect(s.coverageDays).toBe(0);
  expect(s.weekAgo).toBeNull();
});

test("changePct is null rather than 0% when there is nothing to compare against", () => {
  expect(changePct(100, null)).toBeNull();
  expect(changePct(100, 0)).toBeNull();
  expect(changePct(110, 100)).toBeCloseTo(10, 6);
  // A negative starting position still moves in the direction the money did.
  expect(changePct(-50, -100)).toBeCloseTo(50, 6);
});

test("coverage is the SHORTEST-covered account, so one fresh import cannot unlock a month's comparison", () => {
  // One account with a long history, one imported yesterday. The union reaches
  // back far enough; the newcomer does not. Rolling 30 days back would treat
  // the new account's balance as if it had been constant all month.
  const old = {
    key: "abn",
    iban: "",
    name: "ABN",
    bank: "ABN AMRO",
    entity: "BV1",
    currency: "EUR",
    balance: 1_000,
  } as never;
  const fresh = {
    key: "amex",
    iban: "",
    name: "Amex",
    bank: "American Express",
    entity: "BV1",
    currency: "EUR",
    balance: 500,
  } as never;
  const history = [
    {
      id: "a1",
      accountKey: "abn",
      date: "2026-07-01",
      amount: -10,
      currency: "EUR",
      counterparty: "X",
      description: "",
      category: "",
      manual: false,
    },
    {
      id: "a2",
      accountKey: "abn",
      date: "2026-08-10",
      amount: -10,
      currency: "EUR",
      counterparty: "X",
      description: "",
      category: "",
      manual: false,
    },
    {
      id: "b1",
      accountKey: "amex",
      date: "2026-08-15",
      amount: -10,
      currency: "EUR",
      counterparty: "Y",
      description: "",
      category: "",
      manual: false,
    },
  ] as never[];

  const s = positionSeries([old, fresh], history, "2026-08-16", POSITION_WINDOW_DAYS, SEPARATE);

  expect(s.coverageDays).toBe(1); // Amex, not ABN's six weeks
  expect(s.limitedBy).toEqual(["amex"]);
  expect(s.weekAgo).toBeNull(); // never a number the data cannot support
  expect(s.monthAgo).toBeNull();
});

test("an account with a saldo but no transactions blocks the comparison rather than being assumed flat", () => {
  const typed = {
    key: "amex",
    iban: "",
    name: "Amex",
    bank: "American Express",
    entity: "BV1",
    currency: "EUR",
    balance: 500,
  } as never;
  const banked = {
    key: "abn",
    iban: "",
    name: "ABN",
    bank: "ABN AMRO",
    entity: "BV1",
    currency: "EUR",
    balance: 1_000,
  } as never;
  const history = [
    {
      id: "a1",
      accountKey: "abn",
      date: "2026-06-01",
      amount: -10,
      currency: "EUR",
      counterparty: "X",
      description: "",
      category: "",
      manual: false,
    },
    {
      id: "a2",
      accountKey: "abn",
      date: "2026-08-10",
      amount: -10,
      currency: "EUR",
      counterparty: "X",
      description: "",
      category: "",
      manual: false,
    },
  ] as never[];

  // "No movements" and "not imported" are indistinguishable from here, so the
  // typed balance is not treated as having been constant for a month.
  const s = positionSeries([typed, banked], history, "2026-08-16", POSITION_WINDOW_DAYS, SEPARATE);
  expect(s.coverageDays).toBe(0);
  expect(s.limitedBy).toEqual(["amex"]);
  expect(s.monthAgo).toBeNull();
});

/* ───────────────────────── FX-omrekening: convert versus separate */

const HUF_RATE = { HUF: { [ASOF]: 400 } };
const CONVERT = { fxHistory: HUF_RATE, mode: "convert" as const };

test("positionSeries: convert mode turns 300.000 HUF at 400 HUF/EUR into € 750 in the current total, and drops it out of excludedCurrencyKeys", () => {
  const revolutHuf: Account[] = [
    ...revolutAccounts.slice(0, 1),
    { ...revolutAccounts[1], balance: 300_000 },
  ];
  const converted = positionSeries(revolutHuf, [], ASOF, POSITION_WINDOW_DAYS, CONVERT);
  expect(converted.current).toBe(4_500 + 750);
  expect(converted.excluded).toBe(0);
  expect(converted.excludedCurrencyKeys).toEqual([]);
});

test("positionSeries: convert mode with no rate for the balance's date keeps the row excluded, same as separate", () => {
  const revolutHuf: Account[] = [
    ...revolutAccounts.slice(0, 1),
    { ...revolutAccounts[1], balance: 300_000 },
  ];
  const noRate = positionSeries(revolutHuf, [], "2025-01-01", POSITION_WINDOW_DAYS, CONVERT);
  expect(noRate.current).toBe(4_500);
  expect(noRate.excludedCurrencyKeys).toEqual(["R2"]);

  const separate = positionSeries(revolutHuf, [], ASOF, POSITION_WINDOW_DAYS, SEPARATE);
  expect(separate.current).toBe(4_500);
  expect(separate.excludedCurrencyKeys).toEqual(["R2"]);
});

test("SaldoBlock: convert mode folds a converted HUF balance into the figure and shows the one-time ECB note", () => {
  const revolutHuf: Account[] = [
    ...revolutAccounts.slice(0, 1),
    { ...revolutAccounts[1], balance: 300_000 },
  ];
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={revolutHuf}
      txs={[]}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
      {...CONVERT}
    />,
  );
  expect(html).toContain(formatEuro(5_250));
  expect(html).not.toContain("vreemde valuta");
  expect(html).toContain("Omgerekend via ECB.");
});

test("SaldoBlock: convert mode with no rate keeps the account out, worded 'nog geen koers' rather than the separate-mode wording", () => {
  const revolutHuf: Account[] = [
    ...revolutAccounts.slice(0, 1),
    { ...revolutAccounts[1], balance: 300_000 },
  ];
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={revolutHuf}
      txs={[]}
      scheduledFlows={[]}
      asOf="2025-01-01"
      onNavigate={() => {}}
      {...CONVERT}
    />,
  );
  expect(html).toContain(formatEuro(4_500));
  expect(html).toContain("vreemde valuta");
  expect(html).toContain("nog geen koers.");
  expect(html).not.toContain("LaVega rekent nog niet om naar euro");
  expect(html).not.toContain("Omgerekend via ECB.");
});

// A lone HUF account, always converting (rate at asOf). `known` is a single
// account and its own transactions decide `coverageDays` — the shape a bare
// R1+R2 pairing did not give: R1 has no transactions of its own and, without
// one of its own, "no movements" reads as "no history" (see the
// coverage-is-the-shortest-covered-account tests above), which would have
// clamped the window to only the newest transaction and hidden the days
// these two tests need to inspect. A padding transaction far outside the
// window establishes real 30-day coverage without moving any figure in it.
const soloHuf: Account[] = [{ ...revolutAccounts[1], balance: 300_000 }];
const paddingTx: Tx = {
  id: "pad",
  accountKey: "R2",
  date: "2026-01-01",
  amount: 0,
  currency: "HUF",
  counterparty: "Opening",
  description: "",
  category: "",
  manual: false,
};

test("positionSeries: convert mode moves the historical line by a converted transaction, on the day it landed", () => {
  // -40.000 HUF at 400 HUF/EUR is -100 EUR.
  const hufSpend: Tx = {
    id: "hufSpend",
    accountKey: "R2",
    date: "2026-08-10",
    amount: -40_000,
    currency: "HUF",
    counterparty: "Bolt Budapest",
    description: "Taxi",
    category: "",
    manual: false,
  };
  const rate = { HUF: { "2026-08-10": 400, [ASOF]: 400 } };
  const s = positionSeries(soloHuf, [paddingTx, hufSpend], ASOF, POSITION_WINDOW_DAYS, {
    fxHistory: rate,
    mode: "convert",
  });
  const at = (d: string) => s.points.find((p) => p.date === d)?.value;
  expect(s.current).toBe(750); // 300.000 / 400, unaffected by the transaction walk
  // Same step-down shape as the EUR case above: before the 10th the € 100
  // had not left yet, on and after the 10th it has.
  expect(at("2026-08-09")).toBe(850);
  expect(at("2026-08-10")).toBe(750);
});

test("positionSeries: convert mode, no rate for a transaction's date — the line stays flat rather than showing a phantom movement", () => {
  // Same shape as the previous test, but on a date more than 10 days from any
  // known rate: toEur returns null, so this row falls back to 0 rather than
  // breaking the walk — it must not appear as a movement on either side of it.
  const hufSpendNoRate: Tx = {
    id: "hufNoRate",
    accountKey: "R2",
    date: "2026-07-20",
    amount: -40_000,
    currency: "HUF",
    counterparty: "Bolt Budapest",
    description: "Taxi",
    category: "",
    manual: false,
  };
  const rate = { HUF: { [ASOF]: 400 } };
  const s = positionSeries(soloHuf, [paddingTx, hufSpendNoRate], ASOF, POSITION_WINDOW_DAYS, {
    fxHistory: rate,
    mode: "convert",
  });
  const at = (d: string) => s.points.find((p) => p.date === d)?.value;
  expect(at("2026-07-19")).toBe(750);
  expect(at("2026-07-20")).toBe(750);
  expect(at("2026-07-21")).toBe(750);
});
