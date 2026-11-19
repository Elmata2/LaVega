import { afterEach, expect, test, vi } from "vitest";
import {
  applyTransferDecisions,
  ownAccounts,
  type Account,
  type Tx,
  type TransferPair,
} from "@lavega/core";
import { accountsInScope } from "@lavega/core";
import { flowsForScope, txsForAccounts } from "../scope.js";
import { windowTotals } from "../components/blocks/statistics.js";
import type { VaultStorage } from "@lavega/adapters";
import {
  FIXTURE_AMEX_KEY,
  FIXTURE_COUNTERPARTY_IBAN,
  FIXTURE_ING_IBAN,
  fixtureForbiddenStrings,
  syntheticChatVault,
  type ChatStep,
} from "@lavega/core";
import { createAssistantStep } from "./chatClient.js";
import { chatToday, runAssistantQuestion } from "./chatSession.js";

afterEach(() => vi.unstubAllGlobals());

const vault = syntheticChatVault();
const storage = {
  getAccounts: async () => vault.accounts,
  getTxs: async () => vault.txs,
  getRules: async () => vault.rules,
  getBills: async () => vault.bills,
  getBillOccurrences: async () => vault.occurrences,
  getScheduledFlows: async () => vault.flows,
} as unknown as VaultStorage;

const lists = {
  accounts: vault.accounts,
  txs: vault.txs,
  flows: vault.flows,
  bills: vault.bills,
  occurrences: vault.occurrences,
  scope: "persoonlijk",
};
const deps = (step: ChatStep, onRound?: (names: string[]) => void) => ({
  storage,
  asOf: vault.asOf,
  plan: null,
  language: "nl" as const,
  step,
  ...lists,
  ...(onRound ? { onRound } : {}),
});

test("reads the vault now, runs the tool in the browser and returns the checked answer", async () => {
  const seen: string[][] = [];
  const step: ChatStep = vi
    .fn<ChatStep>()
    .mockResolvedValueOnce({
      type: "tool_calls",
      calls: [{ id: "c1", name: "spending_on_day", args: { date: "2026-11-17" } }],
    })
    .mockResolvedValueOnce({ type: "answer", text: "Gisteren gaf je € 32,35 uit." });
  const out = await runAssistantQuestion(
    deps(step, (n) => seen.push(n)),
    "Wat gaf ik gisteren uit?",
    [],
  );
  expect(out).toEqual({ kind: "answer", text: "Gisteren gaf je € 32,35 uit." });
  expect(seen).toEqual([["spending_on_day"]]);
});

test("the plan and the invoice flows from the app reach the tools", async () => {
  const step: ChatStep = vi
    .fn<ChatStep>()
    .mockResolvedValueOnce({
      type: "tool_calls",
      calls: [{ id: "c1", name: "plan_summary", args: {} }],
    })
    .mockResolvedValueOnce({ type: "answer", text: "Er is geen plan." });
  await runAssistantQuestion(
    { ...deps(step), plan: syntheticChatVault({ withPlan: true }).plan },
    "Plan?",
    [],
  );
  const second = (step as ReturnType<typeof vi.fn>).mock.calls[1]![0] as {
    messages: { role: string; content: string }[];
  };
  const tool = second.messages.find((m) => m.role === "tool")!;
  expect(JSON.parse(tool.content).data.available).toBe(true);
});

test("everything posted over the wire holds no IBAN, account key, id, description, note or tag", async () => {
  const bodies: string[] = [];
  let round = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      round += 1;
      const reply =
        round === 1
          ? {
              type: "tool_calls",
              calls: [
                { id: "a1b2c3d4e", name: "balances", args: {} },
                {
                  id: "f5g6h7i8j",
                  name: "transactions",
                  args: { from: "2026-08-01", to: "2026-11-18", sort: "date_desc", limit: 25 },
                },
              ],
            }
          : { type: "answer", text: "Je hebt € 11.950,50 aan tegoeden." };
      return new Response(JSON.stringify(reply), { status: 200 });
    }),
  );
  const out = await runAssistantQuestion(
    deps(createAssistantStep("nl", { today: "2026-11-18", enabled: () => true })),
    `Wat staat er op ${FIXTURE_ING_IBAN} en wat gaf mail jan@example.nl uit?`,
    [],
  );
  expect(out.kind).toBe("answer");
  expect(bodies).toHaveLength(2);
  const wire = bodies.join("\n");
  for (const secret of [...fixtureForbiddenStrings(vault), FIXTURE_AMEX_KEY, "jan@example.nl"])
    expect(wire, `leaked ${secret}`).not.toContain(secret);
  expect(wire).not.toContain(FIXTURE_COUNTERPARTY_IBAN);
  expect(wire).not.toMatch(/\bNL\d{2}[A-Z]{4}\d{10}\b/);
  // what does go: the scrubbed question, and tool results with names and amounts
  expect(wire).toContain("[IBAN]");
  expect(wire).toContain("American Express");
  expect(wire).toContain("cents");
});

test("a vault read that fails is reported as an error, not sent", async () => {
  const broken = {
    ...storage,
    getRules: async () => Promise.reject(new Error("vault locked")),
  } as unknown as VaultStorage;
  const step = vi.fn<ChatStep>();
  await expect(runAssistantQuestion({ ...deps(step), storage: broken }, "Hoi", [])).rejects.toThrow(
    "vault locked",
  );
  expect(step).not.toHaveBeenCalled();
});

/* --- B1 / B2: the chat answers about the scope the user is looking at, with the numbers the app shows --- */

const business: Account = {
  key: "NL55BIZB0000000001",
  iban: "NL55BIZB0000000001",
  name: "Zakelijke rekening",
  bank: "Bunq",
  entity: "Zakelijk",
  currency: "EUR",
  balance: 5000,
  type: "Betaalrekening",
};
const mk = (
  id: string,
  accountKey: string,
  date: string,
  amount: number,
  counterparty: string,
  category = "",
): Tx => ({
  id,
  accountKey,
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category,
  manual: false,
});

function scoped() {
  const allAccounts = [...vault.accounts, business];
  const out = mk("biz-out", vault.accounts[0]!.key, "2026-11-04", -1000, "Bunq overboeking");
  const inn = mk("biz-in", business.key, "2026-11-04", 1000, "Overboeking ING");
  const bizSpend = mk("biz-spend", business.key, "2026-11-05", -500, "Leverancier BV", "Kantoor");
  const allTxs = [...vault.txs, out, inn, bizSpend];
  const pairs = [
    { status: "confirmed", outflowTxId: out.id, inflowTxId: inn.id } as unknown as TransferPair,
  ];
  const ledger = applyTransferDecisions(allTxs, pairs);
  const personalAccounts = allAccounts.filter((a) => a.entity !== "Zakelijk");
  return {
    allAccounts,
    allTxs,
    ledger,
    personalAccounts,
    personalTxs: txsForAccounts(personalAccounts, ledger),
  };
}

async function chatMonthly(accounts: Account[], txs: Tx[], scope: string) {
  const bodies: { role: string; content: string }[][] = [];
  const step: ChatStep = async (req) => {
    bodies.push(req.messages as never);
    return bodies.length === 1
      ? { type: "tool_calls", calls: [{ id: "m1", name: "monthly_totals", args: { months: 3 } }] }
      : { type: "answer", text: "Klaar." };
  };
  await runAssistantQuestion({ ...deps(step), accounts, txs, scope }, "Inkomen en uitgaven?", []);
  const tool = bodies[1]!.find((m) => m.role === "tool")!;
  return JSON.parse(tool.content) as {
    scope: string | null;
    data: { months: { month: string; income: { cents: number }; spent: { cents: number } }[] };
  };
}

test("B1/B2: for each month the chat's spend and income equal Statistiek's windowTotals on the scoped, transfer-projected lists", async () => {
  const s = scoped();
  const chat = await chatMonthly(s.personalAccounts, s.personalTxs, "persoonlijk");
  expect(chat.scope).toBe("persoonlijk");
  const own = ownAccounts(s.personalAccounts);
  const table: string[] = ["month | chat spent | app out | chat income | app in"];
  for (const m of chat.data.months) {
    const end = `${m.month}-31`;
    const app = windowTotals(
      s.personalTxs,
      [],
      own,
      { start: `${m.month}-01`, end },
      { mode: "separate", fxHistory: {} },
    );
    table.push(
      `${m.month} | ${m.spent.cents / 100} | ${app.outTotal.toFixed(2)} | ${m.income.cents / 100} | ${app.inTotal.toFixed(2)}`,
    );
    expect(m.spent.cents / 100, `spent ${m.month}`).toBeCloseTo(app.outTotal, 2);
    expect(m.income.cents / 100, `income ${m.month}`).toBeCloseTo(app.inTotal, 2);
  }
  console.log(table.join("\n"));
  expect(chat.data.months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
});

test("B1: reading everything (no scope, no transfer decisions) would give other numbers, which is what the old code did", async () => {
  const s = scoped();
  const scopedChat = await chatMonthly(s.personalAccounts, s.personalTxs, "persoonlijk");
  const naive = await chatMonthly(s.allAccounts, s.allTxs, "persoonlijk");
  const nov = (c: typeof scopedChat) =>
    c.data.months.find((m) => m.month === "2026-11")!.spent.cents;
  expect(nov(naive)).not.toBe(nov(scopedChat));
});

test("B1: a business scope is answered from the business accounts and says so", async () => {
  const s = scoped();
  const bizAccounts = s.allAccounts.filter((a) => a.entity === "Zakelijk");
  const chat = await chatMonthly(bizAccounts, txsForAccounts(bizAccounts, s.ledger), "zakelijk");
  expect(chat.scope).toBe("zakelijk");
  const nov = chat.data.months.find((m) => m.month === "2026-11")!;
  expect(nov.spent.cents).toBe(50000);
  expect(nov.income.cents).toBe(0);
});

test("B3: the day is the Amsterdam day, also at 23:30 UTC on the last day of a month", () => {
  expect(chatToday(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01");
  expect(chatToday(new Date("2026-11-30T12:00:00Z"))).toBe("2026-11-30");
  expect(chatToday(new Date("2026-07-31T22:30:00Z"))).toBe("2026-08-01");
});

/* --- scope: nothing of the other half reaches any tool result --- */

const acme: Account = { ...business, name: "Acme BV rekening", entity: "Acme BV" };
const profiles = [{ entity: "Acme BV", scope: "business" }] as never;

async function everything(scope: "personal" | "business") {
  const accounts = accountsInScope([...vault.accounts, acme], scope, profiles);
  const flows = flowsForScope(
    [
      ...vault.flows,
      {
        ...vault.flows[0]!,
        id: "inv-acme",
        entity: "Acme BV",
        label: "Factuur Klant Acme BV 2026-014",
        source: "invoice" as const,
      },
    ],
    scope,
    profiles,
  );
  const bills = [
    ...vault.bills.map((b) => ({ ...b, accountKey: vault.accounts[0]!.key })),
    { ...vault.bills[0]!, id: "b-acme", name: "Huur kantoor Acme", accountKey: acme.key },
    {
      ...vault.bills[0]!,
      id: "b-free",
      name: "Losse rekening zonder account",
      accountKey: undefined,
    },
  ];
  const occurrences = [...vault.occurrences, "b-acme", "b-free"].map((o) =>
    typeof o === "string"
      ? {
          id: `${o}|2026-11-28`,
          billId: o,
          originalDueOn: "2026-11-28",
          dueOn: "2026-11-28",
          currency: "EUR",
          expectedAmountCents: null,
          status: "scheduled" as const,
        }
      : o,
  );
  const txs = txsForAccounts(accounts, [
    ...vault.txs,
    mk("acme-1", acme.key, "2026-11-05", -77, "Acme Leverancier"),
  ]);
  const seen: string[] = [];
  const step: ChatStep = async (req) => {
    seen.push(
      ...req.messages
        .filter((m) => m.role === "tool")
        .map((m) => (m as { content: string }).content),
    );
    return req.messages.some((m) => m.role === "tool")
      ? { type: "answer", text: "Klaar." }
      : {
          type: "tool_calls",
          calls: [
            { id: "c1", name: "upcoming_bills", args: { days: 60 } },
            { id: "c2", name: "balances", args: {} },
            {
              id: "c3",
              name: "transactions",
              args: { from: "2026-01-01", to: "2026-11-30", sort: "date_desc", limit: 25 },
            },
            { id: "c4", name: "plan_summary", args: {} },
          ],
        };
  };
  await runAssistantQuestion(
    {
      ...deps(step),
      accounts,
      txs,
      flows,
      bills,
      occurrences,
      scope: scope === "business" ? "zakelijk" : "persoonlijk",
      plan: syntheticChatVault({ withPlan: true }).plan,
    },
    "Alles?",
    [],
  );
  return seen.join("\n");
}

test("scope persoonlijk: no business invoice, bill, account or transaction, no bill without an account", async () => {
  const wire = await everything("personal");
  for (const other of ["Acme", "Factuur Klant", "Losse rekening zonder account"])
    expect(wire).not.toContain(other);
  expect(wire).toContain("Zorgverzekering");
});

test("scope zakelijk: nothing personal (no personal bill, flow or account), no personal plan", async () => {
  const wire = await everything("business");
  for (const other of [
    "Zorgverzekering",
    "Belastingdienst",
    "Oranje Spaarrekening",
    "Albert Heijn",
    "Losse rekening zonder account",
  ])
    expect(wire, other).not.toContain(other);
  expect(wire).toContain("Acme");
  expect(wire).toContain("not-calculated-yet");
});
