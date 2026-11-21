import { describe, expect, it } from "vitest";
import {
  CHAT_FIXTURE_TODAY,
  FIXTURE_COUNTERPARTY_IBAN,
  FIXTURE_ING_IBAN,
  FIXTURE_INJECTION,
  FIXTURE_LONG_NAME,
  fixtureForbiddenStrings,
  syntheticChatVault,
} from "./fixture.js";
import {
  CHAT_TOOL_NAMES,
  CHAT_TOOL_SPECS,
  CHAT_RESULT_MAX_BYTES,
  CHAT_RESULT_MAX_ROWS,
  createChatTools,
  runChatTool,
} from "./tools.js";
import type { VaultView } from "./view.js";

const run = async (view: VaultView, name: string, args: Record<string, unknown> = {}) =>
  runChatTool(createChatTools(view), name, args);

type Money = { cents: number; text: string };
type Envelope = {
  asOf: string;
  scope: string | null;
  coverage: { from: string; to: string } | null;
  data: Record<string, any>;
  truncated: boolean;
  totalRows: number;
};
const env = (r: { result: unknown }) => r.result as Envelope;

const aliasOf = async (view: VaultView, name: string): Promise<string> => {
  const r = await run(view, "balances");
  const row = env(r).data.accounts.find((a: { name: string }) => a.name === name);
  return row.alias as string;
};

describe("the registry", () => {
  it("has the eleven read tools, all read scope, no write tool", () => {
    expect([...CHAT_TOOL_NAMES].sort()).toEqual(
      [
        "balances",
        "compare_weekday",
        "monthly_totals",
        "plan_summary",
        "spending_in_range",
        "spending_on_day",
        "subscriptions",
        "top_categories",
        "transactions",
        "upcoming_bills",
        "upcoming_charges",
      ].sort(),
    );
    const tools = createChatTools(syntheticChatVault());
    expect(tools.map((t) => t.name).sort()).toEqual([...CHAT_TOOL_NAMES].sort());
    for (const t of tools) expect(t.scope).toBe("read");
    for (const s of CHAT_TOOL_SPECS) expect(s.schema.type).toBe("object");
  });

  it("refuses an unknown name and bad arguments with a safe error, not an exception", async () => {
    const view = syntheticChatVault();
    const unknown = await run(view, "delete_everything");
    expect(unknown.ok).toBe(false);
    expect(JSON.parse(unknown.content)).toMatchObject({ error: "unknown_tool" });
    const bad = await run(view, "spending_on_day", { date: "gisteren" });
    expect(bad.ok).toBe(false);
    expect(JSON.parse(bad.content)).toMatchObject({ error: "invalid_arguments" });
    const extra = await run(view, "spending_on_day", { date: "2026-11-17", sql: "drop" });
    expect(extra.ok).toBe(false);
    const badAccount = await run(view, "spending_in_range", {
      from: "2026-11-01",
      to: "2026-11-10",
      account: "NL91ABNA0417164300",
    });
    expect(badAccount.ok).toBe(false);
    expect(badAccount.content).not.toContain("NL91");
  });
});

describe("spending tools wrap the Instinct tools", () => {
  it("spending_on_day: yesterday is the sum of that day, money as {cents, text}", async () => {
    const r = await run(syntheticChatVault(), "spending_on_day", { date: "2026-11-17" });
    expect(r.ok).toBe(true);
    const e = env(r);
    expect(e.asOf).toBe(CHAT_FIXTURE_TODAY);
    expect(e.data.date).toBe("2026-11-17");
    expect(e.data.total).toEqual({ cents: 3235, text: "€ 32,35" });
    expect(e.data.dataCovers).toBe("full");
    expect(e.coverage?.to).toBe("2026-11-17");
  });

  it("spending_in_range: the month so far counts like Statistiek: no transfers, no broker deposit, excluded and Tikkie rows count, foreign rows are counted apart", async () => {
    const e = env(
      await run(syntheticChatVault(), "spending_in_range", {
        from: "2026-11-01",
        to: "2026-11-18",
      }),
    );
    expect(e.data.total).toEqual({ cents: 139750, text: "€ 1.397,50" });
    expect(e.data.foreignExcluded).toBe(1);
  });

  it("spending_in_range with an account scopes to that card and says where its data ends", async () => {
    const view = syntheticChatVault();
    const amex = await aliasOf(view, "American Express");
    const oct = env(
      await run(view, "spending_in_range", { from: "2026-10-01", to: "2026-10-31", account: amex }),
    );
    expect(oct.data.total.cents).toBe(53335);
    expect(oct.coverage).toEqual({ from: "2026-09-15", to: "2026-10-28" });
    expect(oct.data.dataCovers).toBe("partial");
    const nov = env(
      await run(view, "spending_in_range", { from: "2026-11-01", to: "2026-11-18", account: amex }),
    );
    expect(nov.data.total.cents).toBe(0);
    expect(nov.data.dataCovers).toBe("none");
  });

  it("an account can be named by its name as well as its alias", async () => {
    const view = syntheticChatVault();
    const byName = env(
      await run(view, "spending_in_range", {
        from: "2026-10-01",
        to: "2026-10-31",
        account: "american express",
      }),
    );
    expect(byName.data.total.cents).toBe(53335);
    const bad = await run(view, "spending_in_range", {
      from: "2026-10-01",
      to: "2026-10-31",
      account: "Bunq",
    });
    expect(bad.ok).toBe(false);
    expect(JSON.parse(bad.content).hint).toContain("balances");
  });

  it("a bad argument comes back with a hint that says what to fix", async () => {
    const view = syntheticChatVault();
    const date = JSON.parse((await run(view, "spending_on_day", { date: "gisteren" })).content);
    expect(date.hint).toContain("YYYY-MM-DD");
    const days = JSON.parse((await run(view, "upcoming_charges", { days: 90 })).content);
    expect(days.hint).toContain("1 and 31");
  });

  it("a period before the data says so instead of answering zero", async () => {
    const e = env(
      await run(syntheticChatVault(), "spending_in_range", {
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    );
    expect(e.data.dataCovers).toBe("none");
  });

  it("a period beyond the 366-day window has no total", async () => {
    const e = env(
      await run(syntheticChatVault(), "spending_in_range", {
        from: "2024-01-01",
        to: "2024-01-31",
      }),
    );
    expect(e.data.total).toBeNull();
    expect(e.data.outsideWindow).toBe(true);
  });

  it("an older period inside 366 days is reachable (windowDays)", async () => {
    const view = syntheticChatVault();
    view.txs.push({ ...view.txs[0]!, id: "tx-old", date: "2026-03-05", amount: -40, category: "" });
    const e = env(await run(view, "spending_in_range", { from: "2026-03-01", to: "2026-03-31" }));
    expect(e.data.total.cents).toBe(4000);
  });

  it("compare_weekday returns this day, last week and the signed difference", async () => {
    const e = env(await run(syntheticChatVault(), "compare_weekday", { date: "2026-11-17" }));
    expect(e.data).toMatchObject({
      date: "2026-11-17",
      lastWeekDate: "2026-11-10",
      total: { cents: 3235 },
      lastWeekTotal: { cents: 3120 },
      diff: { cents: 115 },
    });
  });

  it("top_categories lists at most five, biggest first, as money", async () => {
    const e = env(
      await run(syntheticChatVault(), "top_categories", { from: "2026-11-01", to: "2026-11-18" }),
    );
    expect(e.data.categories.length).toBeLessThanOrEqual(5);
    expect(e.data.categories[0]).toMatchObject({ category: "Wonen", total: { cents: 110000 } });
  });

  it("upcoming_charges lists coming subscription charges with a total", async () => {
    const e = env(await run(syntheticChatVault(), "upcoming_charges", { days: 31 }));
    const names = e.data.charges.map((c: { name: string }) => c.name.toLowerCase());
    expect(names.some((n: string) => n.includes("netflix"))).toBe(true);
    expect(e.data.total.cents).toBe(
      e.data.charges.reduce((s: number, c: { amount: Money }) => s + c.amount.cents, 0),
    );
  });

  it("a category outside the built-in list is refused, with the allowed list in the schema", async () => {
    const r = await run(syntheticChatVault(), "spending_in_range", {
      from: "2026-11-01",
      to: "2026-11-18",
      category: "Bitcoin",
    });
    expect(r.ok).toBe(false);
    const spec = CHAT_TOOL_SPECS.find((s) => s.name === "spending_in_range")!;
    expect(JSON.stringify(spec.schema)).toContain("Boodschappen");
  });
});

describe("balances", () => {
  it("lists accounts by alias with type and bank, the card as a liability, and EUR totals", async () => {
    const e = env(await run(syntheticChatVault(), "balances"));
    const rows = e.data.accounts as Array<Record<string, any>>;
    expect(rows.map((a) => a.alias)).toEqual(rows.map((_, i) => `a${i + 1}`));
    const amex = rows.find((a) => a.name === "American Express")!;
    expect(amex).toMatchObject({
      bank: "American Express",
      type: "Creditcard",
      classification: "liability",
      currency: "EUR",
      balance: { cents: -31240 },
      balanceDate: "2026-10-28",
    });
    expect(e.data.assets.cents).toBe(1195050);
    expect(e.data.liabilities.cents).toBe(31240);
    expect(e.data.net.cents).toBe(1163810);
  });

  it("an unknown balance stays null and is left out of the totals", async () => {
    const view = syntheticChatVault();
    view.accounts[0]!.balance = null;
    const e = env(await run(view, "balances"));
    const ing = e.data.accounts.find((a: { name: string }) => a.name === "Betaalrekening");
    expect(ing.balance).toBeNull();
    expect(e.data.unknownBalances).toBe(1);
    expect(e.data.assets.cents).toBe(950000);
  });

  it("a foreign-currency account is listed, never summed", async () => {
    const view = syntheticChatVault();
    view.accounts.push({
      ...view.accounts[1]!,
      key: "USD-ACCOUNT-1",
      iban: "USD-ACCOUNT-1",
      name: "Dollarrekening",
      currency: "USD",
      balance: 100,
    });
    const e = env(await run(view, "balances"));
    const usd = e.data.accounts.find((a: { name: string }) => a.name === "Dollarrekening");
    expect(usd.currency).toBe("USD");
    expect(usd.balance.text).toMatch(/US\$|USD/);
    expect(e.data.assets.cents).toBe(1195050);
    expect(e.data.foreignAccounts).toBe(1);
  });

  it("an account named after its IBAN is shown under its alias, not the number", async () => {
    const view = syntheticChatVault();
    view.accounts[0]!.name = FIXTURE_ING_IBAN;
    const r = await run(view, "balances");
    expect(r.content).not.toContain(FIXTURE_ING_IBAN);
  });
});

describe("transactions", () => {
  it("searches, caps the rows, and reports how many matched and their sum", async () => {
    const e = env(
      await run(syntheticChatVault(), "transactions", {
        search: "albert heijn",
        from: "2026-10-01",
        to: "2026-10-31",
        sort: "date_desc",
        limit: 25,
      }),
    );
    expect(e.data.rows).toHaveLength(25);
    expect(e.data.matched).toBe(30);
    expect(e.data.sum.cents).toBe(-34650);
    expect(e.truncated).toBe(true);
    expect(e.data.rows[0]).toMatchObject({ date: "2026-10-30", counterparty: "Albert Heijn" });
    expect(Object.keys(e.data.rows[0]).sort()).toEqual(
      ["account", "amount", "category", "counterparty", "date"].sort(),
    );
  });

  it("filters by amount on the size of the payment and by category", async () => {
    const big = env(
      await run(syntheticChatVault(), "transactions", {
        from: "2026-11-01",
        to: "2026-11-18",
        minCents: 100000,
        maxCents: 200000,
        sort: "amount_desc",
        limit: 5,
      }),
    );
    expect(big.data.rows).toHaveLength(1);
    expect(big.data.rows[0].counterparty).toBe("Verhuurder Jansen");
    const cat = env(
      await run(syntheticChatVault(), "transactions", {
        from: "2026-11-01",
        to: "2026-11-30",
        category: "Wonen",
        sort: "date_asc",
        limit: 5,
      }),
    );
    expect(cat.data.matched).toBe(1);
  });

  it("lists excluded rows too (the app shows them) and clips and cleans names", async () => {
    const view = syntheticChatVault();
    view.txs.push({
      ...view.txs[0]!,
      id: "tx-ctl",
      date: "2026-11-16",
      amount: -1,
      counterparty: "Cafe\u0007\u0000 Bar\nTwee",
      category: "",
    });
    const e = env(
      await run(view, "transactions", {
        from: "2026-11-01",
        to: "2026-11-18",
        sort: "date_desc",
        limit: 25,
      }),
    );
    const names = e.data.rows.map((r: { counterparty: string }) => r.counterparty);
    expect(names.some((n: string) => n.includes("Terugbetaald"))).toBe(true);
    expect(names).toContain("Cafe Bar Twee");
    const long = names.find((n: string) => n.startsWith("Stichting"));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).not.toBe(FIXTURE_LONG_NAME);
    for (const n of names) expect([...n].some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
  });

  it("shows the merchant text as data, unchanged by what it says", async () => {
    const e = env(
      await run(syntheticChatVault(), "transactions", {
        search: "ignore previous",
        from: "2026-11-01",
        to: "2026-11-18",
        sort: "date_desc",
        limit: 5,
      }),
    );
    expect(e.data.rows[0].counterparty.startsWith(FIXTURE_INJECTION.slice(0, 40))).toBe(true);
  });
});

describe("subscriptions, monthly_totals, upcoming_bills, plan_summary", () => {
  it("subscriptions: monthly price, cadence and a total consistent with the rows", async () => {
    const e = env(await run(syntheticChatVault(), "subscriptions"));
    const rows = e.data.subscriptions as Array<Record<string, any>>;
    const netflix = rows.find((r) => String(r.name).toLowerCase().includes("netflix"))!;
    expect(netflix.monthly).toEqual({ cents: 1599, text: "€ 15,99" });
    expect(netflix.changePct).toBeGreaterThan(0.1);
    const spotify = rows.find((r) => String(r.name).toLowerCase().includes("spotify"))!;
    expect(spotify.monthly.cents).toBe(1099);
    expect(e.data.monthlyTotal.cents).toBe(rows.reduce((s, r) => s + r.monthly.cents, 0));
  });

  it("monthly_totals: the Statistiek rule: moved money out of both sides, a card payment received is inflow", async () => {
    const e = env(await run(syntheticChatVault(), "monthly_totals", { months: 3 }));
    const months = e.data.months as Array<{ month: string; income: Money; spent: Money }>;
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(months[1]!.income.cents).toBe(370000);
    expect(months[2]!.spent.cents).toBe(139750);
    expect(months[2]!.income.cents).toBe(0);
  });

  it("upcoming_bills: bills and expected flows in the window, amount magnitude with direction", async () => {
    const e = env(await run(syntheticChatVault(), "upcoming_bills", { days: 14 }));
    expect(e.data.items).toEqual([
      expect.objectContaining({
        name: "Zorgverzekering",
        dueDate: "2026-11-28",
        direction: "out",
        amount: { cents: 13250, text: "€ 132,50" },
        source: "bill",
      }),
      expect.objectContaining({
        name: "Belastingdienst voorlopige aanslag",
        dueDate: "2026-11-30",
        direction: "out",
        amount: { cents: 21000, text: "€ 210" },
        source: "manual",
      }),
    ]);
    const none = env(await run(syntheticChatVault(), "upcoming_bills", { days: 3 }));
    expect(none.data.items).toEqual([]);
  });

  it("plan_summary says there is no plan instead of inventing one", async () => {
    const e = env(await run(syntheticChatVault(), "plan_summary"));
    expect(e.data).toMatchObject({ available: false, status: "not-calculated-yet" });
    expect(String(e.data.note)).toContain("Je plan is nog niet berekend");
  });

  it("plan_summary reads the computed sections (room range, buffer, card offer)", async () => {
    const view = syntheticChatVault();
    const net = (cardKey: string, name: string, netCents: number) => ({ cardKey, name, netCents });
    view.plan = {
      sections: {
        month: {
          status: "on-track",
          statusReason: { key: "room-ok" },
          figures: {
            room: { kind: "computed", lowCents: 20000, highCents: 60000, middleCents: 40000 },
            incomeMiddleCents: 320000,
            fixedCents: 140000,
            savingsRate: 0.125,
          },
        },
        buffer: {
          status: "attention",
          statusReason: { key: "below-target" },
          figures: { incomeBufferMonths: 2.5, targetMonths: 3, gapCents: 70000, gapMonths: 0.5 },
        },
        cards: {
          figures: {
            cardInUseKey: "k1",
            months: 12,
            cardableSpendCents: 100000,
            nets: [net("k1", "Mijn kaart", 1000), net("k2", "Kaart B", 9000)],
            advice: {
              basis: "history",
              ignoresInterest: false,
              baseline: { kind: "best-held", cardId: "k1", name: "Mijn kaart", netCents: 1000 },
              verdict: { kind: "switch", best: { name: "Kaart B" }, gainCents: 8000 },
            },
          },
        },
      },
    } as unknown as VaultView["plan"];
    const e = env(await run(view, "plan_summary"));
    expect(e.data).toMatchObject({
      available: true,
      month: {
        status: "on-track",
        roomLow: { cents: 20000 },
        roomHigh: { cents: 60000 },
        income: { cents: 320000 },
        fixedCosts: { cents: 140000 },
        savingsRatePct: 12.5,
      },
      buffer: { status: "attention", months: 2.5, targetMonths: 3, gap: { cents: 70000 } },
      cards: {
        inUse: "Mijn kaart",
        betterCard: "Kaart B",
        yearlyGain: { cents: 8000 },
        yearlyGainBasis: "estimate-incl-points-value",
      },
    });
  });

  it("plan_summary: the card in use is the verdict's baseline; none when the baseline is unknown", async () => {
    const view = syntheticChatVault();
    const base = view;
    base.plan = {
      sections: {
        month: {
          status: "on-track",
          statusReason: { key: "room-ok" },
          figures: { room: { kind: "unknown" }, incomeMiddleCents: null, fixedCents: null, savingsRate: null },
        },
        buffer: {
          status: "attention",
          statusReason: { key: "below-target" },
          figures: { incomeBufferMonths: null, targetMonths: 3, gapCents: null, gapMonths: null },
        },
        cards: {
          figures: {
            cardInUseKey: "k1",
            nets: [{ cardKey: "k1", name: "Legacy kaart", netCents: 1000 }],
            advice: {
              basis: "history",
              ignoresInterest: false,
              baseline: { kind: "unknown", blockers: [] },
              verdict: { kind: "unknown-baseline" },
            },
          },
        },
      },
    } as unknown as VaultView["plan"];
    const e = env(await run(base, "plan_summary"));
    expect(e.data).toMatchObject({
      cards: { inUse: null, betterCard: null, yearlyGain: null, yearlyGainBasis: null },
    });
  });
});

describe("what leaves the browser: every tool, on a vault full of identifiers", () => {
  const IBAN_SHAPE = /\b[A-Z]{2}\d{2}\s?[A-Z0-9]{4}[\s\d]{6,}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b/;
  const calls: Array<[string, Record<string, unknown>]> = [
    ["spending_on_day", { date: "2026-11-17" }],
    ["spending_in_range", { from: "2026-10-01", to: "2026-11-18" }],
    ["compare_weekday", { date: "2026-11-17" }],
    ["top_categories", { from: "2026-10-01", to: "2026-11-18" }],
    ["upcoming_charges", { days: 31 }],
    ["balances", {}],
    ["transactions", { from: "2026-08-01", to: "2026-11-18", sort: "date_desc", limit: 25 }],
    [
      "transactions",
      { search: "albert", from: "2026-08-01", to: "2026-11-18", sort: "amount_desc", limit: 25 },
    ],
    ["subscriptions", {}],
    ["monthly_totals", { months: 12 }],
    ["plan_summary", {}],
    ["upcoming_bills", { days: 60 }],
  ];

  for (const [name, args] of calls) {
    it(`${name} ${JSON.stringify(args).slice(0, 40)}: no IBAN, key, id, description, note or tag; within the caps`, async () => {
      const view = syntheticChatVault();
      const r = await run(view, name, args);
      expect(r.ok).toBe(true);
      for (const secret of fixtureForbiddenStrings(view)) expect(r.content).not.toContain(secret);
      expect(r.content).not.toMatch(IBAN_SHAPE);
      expect(r.content).not.toContain(FIXTURE_COUNTERPARTY_IBAN);
      expect(r.content).not.toMatch(/\bNL\d{2}[A-Z]{4}\d{10}\b/);
      expect(new TextEncoder().encode(r.content).length).toBeLessThanOrEqual(CHAT_RESULT_MAX_BYTES);
      let rows = 0;
      const walk = (v: unknown) => {
        if (Array.isArray(v)) {
          rows += v.length;
          v.forEach(walk);
        } else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(env(r).data);
      expect(rows).toBeLessThanOrEqual(CHAT_RESULT_MAX_ROWS);
    });
  }

  it("a counterparty carrying an IBAN or a long digit run is cleaned, not passed on", async () => {
    const view = syntheticChatVault();
    view.txs.push({
      ...view.txs[0]!,
      id: "tx-digits",
      date: "2026-11-16",
      amount: -2,
      counterparty: "Rek 0123456789 NL02INGB0000000002 mail jan@example.nl",
      category: "",
    });
    const r = await run(view, "transactions", {
      from: "2026-11-16",
      to: "2026-11-16",
      sort: "date_desc",
      limit: 5,
    });
    expect(r.content).not.toMatch(/0123456789|NL02INGB|jan@example/);
  });
});

describe("A2: an account whose name is really a key, a card number or a file name", () => {
  const cases: [string, (v: VaultView) => void][] = [
    ["its own key", (v) => (v.accounts[0]!.name = v.accounts[0]!.key)],
    ["its IBAN with spaces", (v) => (v.accounts[0]!.name = "NL91 ABNA 0417 1643 00")],
    ["card digits", (v) => (v.accounts[2]!.name = "AMEX-41007")],
    ["a file name", (v) => (v.accounts[0]!.name = "Rekeningoverzicht_J_de_Vries")],
    ["a file name with extension", (v) => (v.accounts[0]!.name = "export 2026.csv")],
    ["a from_to name", (v) => (v.accounts[0]!.name = "from_2026-10-01_to_2026-10-31")],
  ];
  for (const [label, mutate] of cases)
    it(`${label} is shown as a neutral label, bank and type stay`, async () => {
      const view = syntheticChatVault();
      mutate(view);
      const r = await run(view, "balances");
      const rows = env(r).data.accounts as Array<Record<string, any>>;
      expect(rows.some((a) => /^Rekening a\d$/.test(a.name))).toBe(true);
      for (const secret of [view.accounts[0]!.key, "41007", "Vries", "from_2026", ".csv"])
        expect(r.content).not.toContain(secret);
      const neutral = rows.find((a) => /^Rekening a\d$/.test(a.name))!;
      expect(neutral.bank).not.toBe("");
      expect(neutral.type).not.toBe("");
    });

  it("English labels in English; the account argument matches alias or label, never a raw key", async () => {
    const view = { ...syntheticChatVault(), locale: "en" as const };
    view.accounts[2]!.name = "AMEX-41007";
    const rows = env(await run(view, "balances")).data.accounts as Array<Record<string, any>>;
    const amex = rows.find((a) => a.bank === "American Express")!;
    expect(amex.name).toBe(`Account ${amex.alias}`);
    const ok = await run(view, "spending_in_range", {
      from: "2026-10-01",
      to: "2026-10-31",
      account: amex.name,
    });
    expect(ok.ok).toBe(true);
    const raw = await run(view, "spending_in_range", {
      from: "2026-10-01",
      to: "2026-10-31",
      account: view.accounts[2]!.key,
    });
    expect(raw.ok).toBe(false);
  });
});

describe("A4: the search never reaches the hidden description", () => {
  it("a string that occurs only in a description matches nothing; counterparty and category do", async () => {
    const view = syntheticChatVault();
    const byDesc = env(
      await run(view, "transactions", {
        search: "DESCRIPTION-SECRET",
        from: "2026-01-01",
        to: "2026-11-18",
        sort: "date_desc",
      }),
    );
    expect(byDesc.data.matched).toBe(0);
    const byName = env(
      await run(view, "transactions", {
        search: "spotify",
        from: "2026-01-01",
        to: "2026-11-18",
        sort: "date_desc",
      }),
    );
    expect(byName.data.matched).toBe(6);
    const byCategory = env(
      await run(view, "transactions", {
        search: "wonen",
        from: "2026-01-01",
        to: "2026-11-18",
        sort: "date_desc",
      }),
    );
    expect(byCategory.data.matched).toBe(4);
  });
});

describe("B2: one definition of spent and income", () => {
  it("a broker deposit is not spending; a Tikkie is; the transfer pair and card payoff are not", async () => {
    const view = syntheticChatVault();
    const cats = env(await run(view, "top_categories", { from: "2026-11-01", to: "2026-11-18" }))
      .data.categories as Array<{ category: string }>;
    expect(cats.map((c) => c.category)).not.toContain("Sparen & beleggen");
    expect(cats.map((c) => c.category)).toContain("Overboekingen aan anderen");
  });

  it("an excluded row still counts, like Statistiek", async () => {
    const view = syntheticChatVault();
    const day = env(await run(view, "spending_on_day", { date: "2026-11-12" }));
    expect(day.data.total.cents).toBe(9099); // 80,00 excluded + 10,99 Spotify
  });

  it("foreign rows are counted apart in every spend result and in monthly_totals", async () => {
    const view = syntheticChatVault();
    expect(
      env(await run(view, "spending_on_day", { date: "2026-11-05" })).data.foreignExcluded,
    ).toBe(1);
    expect(
      env(await run(view, "top_categories", { from: "2026-11-01", to: "2026-11-30" })).data
        .foreignExcluded,
    ).toBe(1);
    expect(env(await run(view, "monthly_totals", { months: 3 })).data.foreignExcluded).toBe(1);
  });
});

describe("the scope travels with every result", () => {
  it("echoes the scope the lists were taken from", async () => {
    const view = { ...syntheticChatVault(), scope: "zakelijk" };
    expect(env(await run(view, "balances")).scope).toBe("zakelijk");
    expect(env(await run(syntheticChatVault(), "balances")).scope).toBeNull();
  });
});

describe("one call for 'spend at a merchant in a period'", () => {
  it("spending_in_range takes a counterparty filter (counterparty and category only)", async () => {
    const view = syntheticChatVault();
    const e = env(
      await run(view, "spending_in_range", {
        from: "2026-11-01",
        to: "2026-11-18",
        counterparty: "albert heijn",
      }),
    );
    expect(e.data.total.cents).toBe(9975);
    expect(e.data.counterparty).toBe("albert heijn");
    const none = env(
      await run(view, "spending_in_range", {
        from: "2026-11-01",
        to: "2026-11-18",
        counterparty: "DESCRIPTION-SECRET",
      }),
    );
    expect(none.data.total.cents).toBe(0);
  });

  it("a `search` argument comes back with a hint that names the right argument and tool", async () => {
    const r = await run(syntheticChatVault(), "spending_in_range", {
      from: "2026-11-01",
      to: "2026-11-18",
      search: "Albert Heijn",
    });
    expect(r.ok).toBe(false);
    const hint = JSON.parse(r.content).hint as string;
    expect(hint).toContain("counterparty");
    expect(hint).toContain("transactions");
    expect(hint).not.toContain("Albert");
  });

  it("the schema tells the model what to use, and not to add filters nobody asked for", () => {
    const range = CHAT_TOOL_SPECS.find((s) => s.name === "spending_in_range")!;
    const props = range.schema.properties as Record<string, { description?: string }>;
    expect(range.description).toContain("merchant");
    expect(props.category!.description).toContain("Leave out");
    expect(props.counterparty!.description).toContain("merchant");
    const tx = CHAT_TOOL_SPECS.find((s) => s.name === "transactions")!;
    expect(tx.description).toContain("sum");
    expect(tx.description).toContain("did a payment count as spending");
  });
});

describe("optional arguments the model fills with an empty string", () => {
  it("an empty optional argument counts as absent", async () => {
    const view = syntheticChatVault();
    const a = env(
      await run(view, "spending_in_range", {
        from: "2026-11-01",
        to: "2026-11-18",
        account: "",
        category: "",
        counterparty: "",
      }),
    );
    expect(a.data.total.cents).toBe(139750);
    const t = env(
      await run(view, "transactions", {
        from: "2026-11-16",
        to: "2026-11-16",
        sort: "date_desc",
        search: "",
        category: "",
      }),
    );
    expect(t.data.matched).toBeGreaterThan(0);
  });

  it("the spend tools say what is NOT counted, and that counterparty is a merchant not an account", () => {
    const range = CHAT_TOOL_SPECS.find((s) => s.name === "spending_in_range")!;
    expect(range.description).toContain("savings");
    expect(range.description).toContain("not counted");
    const props = range.schema.properties as Record<string, { description?: string }>;
    expect(props.counterparty!.description).toContain("not an account");
  });
});

describe("a counterparty that is really an account name", () => {
  it("comes back with a hint to use `account`, and the model can then answer", async () => {
    const view = syntheticChatVault();
    for (const name of ["American Express", "american express", "Trading 212"]) {
      const r = await run(view, "spending_in_range", {
        from: "2026-10-01",
        to: "2026-10-31",
        counterparty: name,
      });
      expect(r.ok, name).toBe(false);
      const hint = JSON.parse(r.content).hint as string;
      expect(hint).toContain("`account`");
      expect(hint).not.toContain(name);
    }
    const ok = await run(view, "spending_in_range", {
      from: "2026-10-01",
      to: "2026-10-31",
      account: "American Express",
    });
    expect(env(ok).data.total.cents).toBe(53335);
  });
});

describe("search matches the cleaned name only; the schema says so", () => {
  it("the spend filter matches the cleaned name too: hidden digits give no total", async () => {
    const view = syntheticChatVault();
    view.txs.push({
      ...view.txs[0]!,
      id: "tx-probe-spend",
      date: "2026-11-16",
      amount: -11,
      counterparty: "NL91ABNA0417164300 Hidden Merchant",
      category: "",
    });
    const range = { from: "2026-11-16", to: "2026-11-16" };
    const cents = async (counterparty: string) =>
      env(await run(view, "spending_in_range", { ...range, counterparty })).data.total.cents;
    expect(await cents("0417164300")).toBe(0);
    expect(await cents("NL91ABNA0417164300")).toBe(0);
    // What the results show is still findable.
    expect(await cents("hidden merchant")).toBe(1100);
  });

  it("the spend filter folds accents: cafe finds Café", async () => {
    const view = syntheticChatVault();
    view.txs.push({
      ...view.txs[0]!,
      id: "tx-cafe",
      date: "2026-11-16",
      amount: -7,
      counterparty: "Café De Zwaan",
      category: "",
    });
    const e = env(
      await run(view, "spending_in_range", {
        from: "2026-11-16",
        to: "2026-11-16",
        counterparty: "cafe de zwaan",
      }),
    );
    expect(e.data.total.cents).toBe(700);
  });

  it("a hidden digit run in a raw counterparty cannot be probed through `matched`", async () => {
    const view = syntheticChatVault();
    view.txs.push({
      ...view.txs[0]!,
      id: "tx-probe",
      date: "2026-11-16",
      amount: -2,
      counterparty: "Rek 0123456789 Foo",
      category: "",
    });
    const probe = env(
      await run(view, "transactions", {
        search: "0123456789",
        from: "2026-11-01",
        to: "2026-11-30",
        sort: "date_desc",
      }),
    );
    expect(probe.data.matched).toBe(0);
    const visible = env(
      await run(view, "transactions", {
        search: "foo",
        from: "2026-11-01",
        to: "2026-11-30",
        sort: "date_desc",
      }),
    );
    expect(visible.data.matched).toBe(1);
  });

  it("the transactions schema no longer claims to search descriptions", () => {
    const tx = CHAT_TOOL_SPECS.find((s) => s.name === "transactions")!;
    const search = (tx.schema.properties as Record<string, { description?: string }>).search!
      .description!;
    expect(search).not.toMatch(/description/i);
    expect(search).toContain("counterparty");
    expect(search).toContain("category");
  });
});

describe("upcoming_bills: a bill of an account outside the view never shows", () => {
  it("drops bills whose account is not in the view, and bills with no account when a scope is set", async () => {
    const view = { ...syntheticChatVault(), scope: "persoonlijk" };
    view.bills = [
      { ...view.bills[0]!, id: "b-own", name: "Eigen bill", accountKey: view.accounts[0]!.key },
      {
        ...view.bills[0]!,
        id: "b-other",
        name: "Zakelijk bill Acme",
        accountKey: "NL55BIZB0000000001",
      },
      { ...view.bills[0]!, id: "b-none", name: "Zonder rekening", accountKey: undefined },
    ];
    view.occurrences = ["b-own", "b-other", "b-none"].map((id) => ({
      id: `${id}|2026-11-28`,
      billId: id,
      originalDueOn: "2026-11-28",
      dueOn: "2026-11-28",
      currency: "EUR",
      expectedAmountCents: null,
      status: "scheduled" as const,
    }));
    const r = await run(view, "upcoming_bills", { days: 30 });
    expect(r.content).toContain("Eigen bill");
    expect(r.content).not.toContain("Acme");
    expect(r.content).not.toContain("Zonder rekening");
  });
});
