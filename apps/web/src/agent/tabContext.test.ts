import { expect, test } from "vitest";
import { buildTabContext } from "./tabContext.js";

test("overview context carries only aggregates, not raw txs", () => {
  const { tab, context } = buildTabContext("overview", {
    accounts: [{ entity: "BV1", balance: 100 } as any], txs: [{} as any], alertCount: 3, bufferCents: 5000,
    shortfall: false, categories: [{ name: "Boodschappen", out: 200 }],
  } as any);
  expect(tab).toBe("overview");
  expect((context as any).txs).toBeUndefined();
  expect((context as any).alertCount).toBe(3);
});

test("unknown tab yields empty context", () => {
  expect(buildTabContext("zzz", {} as any).context).toEqual({});
});

test("facturen context carries capped invoices only, never raw txs", () => {
  const { tab, context } = buildTabContext("facturen", {
    invoices: Array.from({ length: 200 }, (_, i) => ({
      counterparty: "X" + i, amount: 1, issueDate: "2026-01-01", dueDate: "2026-01-31", status: "expected",
    })),
    txs: [{ id: "t1", amount: 999 }],
  } as any);
  expect(tab).toBe("facturen");
  expect(Array.isArray((context as any).invoices)).toBe(true);
  expect((context as any).invoices.length).toBeLessThanOrEqual(100);
  expect((context as any).txs).toBeUndefined();
});

test("valuta context has rate + holdings, no personal amounts", () => {
  const { tab, context } = buildTabContext("valuta", {
    fxRate: { base: "EUR", date: "2026-08-04", rates: { USD: 1.15 } },
    accounts: [{ currency: "USD" }, { currency: "EUR" }, { currency: "USD" }],
    invoices: [{ amount: 500 }],
  } as any);
  expect(tab).toBe("valuta");
  expect((context as any).rate).toBeTruthy();
  expect((context as any).holdings).toContain("USD");
  expect((context as any).holdings).not.toContain("EUR");
  expect((context as any).invoices).toBeUndefined();
});

test("valuta omits rate when App has no fxRate (agent web-searches it)", () => {
  const { context } = buildTabContext("valuta", { accounts: [{ currency: "GBP" }] } as any);
  expect((context as any).rate).toBeUndefined();
  expect((context as any).holdings).toContain("GBP");
});

test("punten context carries reward balances", () => {
  const { tab, context } = buildTabContext("punten", {
    rewards: [
      { id: "amex", program: "American Express Membership Rewards", points: 50000, updatedAt: "2026-07-01" },
      { id: "fb", program: "Flying Blue (KLM/Air France)", points: 12000, updatedAt: "2026-06-15" },
    ],
  } as any);
  expect(tab).toBe("punten");
  expect(Array.isArray((context as any).balances)).toBe(true);
  expect((context as any).balances.length).toBe(2);
  expect((context as any).balances[0].program).toContain("Express");
});

test("rekeningen (view 'accounts') maps to server tab and carries minimal accounts", () => {
  const { tab, context } = buildTabContext("accounts", {
    accounts: [{ bank: "ING", type: "Betaalrekening", entity: "BV1", balance: 1234, iban: "NL00INGB0001", key: "k1" }],
    txs: [{ id: "t1", amount: 5 }],
  } as any);
  expect(tab).toBe("rekeningen");
  expect(Array.isArray((context as any).accounts)).toBe(true);
  expect((context as any).accounts[0]).toEqual({ bank: "ING", type: "Betaalrekening", entity: "BV1", balance: 1234 });
  expect((context as any).accounts[0].iban).toBeUndefined();
  expect((context as any).txs).toBeUndefined();
});

test("regels (view 'rules') carries rules", () => {
  const { tab, context } = buildTabContext("rules", {
    rules: [{ id: "r1", match: "albert heijn", category: "Boodschappen" }],
  } as any);
  expect(tab).toBe("regels");
  expect(Array.isArray((context as any).rules)).toBe(true);
  expect((context as any).rules[0].category).toBe("Boodschappen");
});

test("forecast context carries a compact summary, never raw txs", () => {
  const { tab, context } = buildTabContext("forecast", {
    accounts: [{ key: "k1", entity: "BV1", balance: 5000, bank: "ING", currency: "EUR" }],
    txs: [
      { id: "t1", accountKey: "k1", date: "2026-05-01", amount: -100, counterparty: "Netflix", description: "", currency: "EUR", category: "", manual: false },
      { id: "t2", accountKey: "k1", date: "2026-05-31", amount: -100, counterparty: "Netflix", description: "", currency: "EUR", category: "", manual: false },
    ],
    scheduledFlows: [],
    bufferCents: 0,
    asOf: "2026-08-05",
  } as any);
  expect(tab).toBe("forecast");
  expect((context as any).summary).toBeTruthy();
  expect(typeof (context as any).summary).toBe("object");
  expect((context as any).txs).toBeUndefined();
  expect(JSON.stringify(context)).not.toContain('"accountKey"');
});

test("belasting context carries vat/deadlines/settings, never raw txs", () => {
  const { tab, context } = buildTabContext("belasting", {
    accounts: [{ key: "k1", entity: "BV1", balance: 5000, bank: "ING", currency: "EUR" }],
    txs: [
      { id: "t1", accountKey: "k1", date: "2026-07-10", amount: 12100, counterparty: "Klant", description: "", currency: "EUR", category: "", manual: false },
    ],
    vatSettings: [{ entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false }],
    asOf: "2026-08-05",
  } as any);
  expect(tab).toBe("belasting");
  expect((context as any).settings).toBeTruthy();
  expect(Array.isArray((context as any).deadlines)).toBe(true);
  expect((context as any).vat).toBeTruthy();
  expect((context as any).txs).toBeUndefined();
  expect(JSON.stringify(context)).not.toContain('"accountKey"');
});

test("optimalisatie context carries subscriptions + rates, omits live bestBenchmark", () => {
  const { tab, context } = buildTabContext("optimalisatie", {
    accounts: [{ key: "k1", entity: "BV1", balance: 5000, bank: "ING", currency: "EUR" }],
    txs: [
      { id: "t1", accountKey: "k1", date: "2026-05-01", amount: -1000, counterparty: "Netflix", description: "", currency: "EUR", category: "", manual: false },
      { id: "t2", accountKey: "k1", date: "2026-05-31", amount: -1000, counterparty: "Netflix", description: "", currency: "EUR", category: "", manual: false },
      { id: "t3", accountKey: "k1", date: "2026-06-30", amount: -1000, counterparty: "Netflix", description: "", currency: "EUR", category: "", manual: false },
    ],
    asOf: "2026-08-05",
  } as any);
  expect(tab).toBe("optimalisatie");
  expect(Array.isArray((context as any).subscriptions)).toBe(true);
  expect(Array.isArray((context as any).rates)).toBe(true);
  expect((context as any).bestBenchmark).toBeUndefined();
  expect((context as any).txs).toBeUndefined();
});

test("backup context is empty", () => {
  expect(buildTabContext("backup", {} as any).context).toEqual({});
});
