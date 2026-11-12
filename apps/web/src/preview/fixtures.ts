/* Synthetic data for the midnight preview harness. Every person, company, IBAN
 * and amount below is invented. Dates are relative to "today" so the forecast,
 * the deadlines and the "this month" cards always have something to say. */
import {
  AdvisorProfile,
  RISK_SCALE,
  categorize,
  emptyProfileStore,
  makeRewardsBalance,
  makeScheduledFlow,
  type Account,
  type AdvisorProfileStore,
  type Goal,
  type RewardsBalance,
  type ScheduledFlow,
  type BudgetPeriod,
  type CategoryGroup,
  type Tx,
  type Bill,
  type BillOccurrence,
  type Valuation,
  type ImportSession,
  assignTxIds,
  ownAccounts,
  generateBillOccurrences,
  resolveBillAmountCents,
  valuationId,
} from "@lavega/core";
import { createFileImport } from "@lavega/adapters";
import {
  applyBuffer,
  applyChildren,
  applyGoals,
  applyHousehold,
  applyRiskAnswers,
  applyStatedCards,
  applyStatedDebitCards,
  applyStatedHousing,
  applyStatedRange,
  applyStatedSavings,
  applyWork,
} from "../intake/state.js";
import { markDone, type ScreenId } from "../intake/wizard/screens.js";

export const CHECKING_IBAN = "NL44INGB0100000001";
export const SAVINGS_IBAN = "NL55INGB0100000002";
export const CARD_IBAN = "NL66ABNA0100000003";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const compact = (d: Date) => iso(d).replaceAll("-", "");
const nl = (n: number) => n.toFixed(2).replace(".", ",");

type Row = {
  date: Date;
  name: string;
  account: string;
  counter: string;
  out: boolean;
  amount: number;
  kind: string;
  note: string;
};

/** Six months of a fictional household: salary, rent, groceries, a few
 *  subscriptions, a monthly transfer to savings and a credit card. */
function rows(today: Date): Row[] {
  const out: Row[] = [];
  const add = (r: Row) => out.push(r);
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  for (let m = 0; m < 6; m++) {
    const y = first.getUTCFullYear();
    const mo = first.getUTCMonth() + m;
    const day = (n: number) => new Date(Date.UTC(y, mo, n));
    const push = (
      d: Date,
      name: string,
      amount: number,
      o: boolean,
      kind = "Betaalautomaat",
      account = CHECKING_IBAN,
      counter = "",
      note = "",
    ) => {
      if (d <= today) add({ date: d, name, account, counter, out: o, amount, kind, note });
    };
    push(
      day(25),
      "Brightwave Studio B.V.",
      3480 + (m % 2) * 40,
      false,
      "Overschrijving",
      CHECKING_IBAN,
      "NL12RABO0300000001",
      "Salaris",
    );
    push(
      day(1),
      "Woonstad Verhuur",
      1195,
      true,
      "Incasso",
      CHECKING_IBAN,
      "NL22RABO0300000002",
      "Huur",
    );
    push(day(3), "Vattenfall Energie", 118.4 - m * 3, true, "Incasso");
    push(day(5), "Delta Zorgverzekering", 142.5, true, "Incasso");
    push(day(7), "Netflix", 13.99, true, "Incasso");
    push(day(9), "Spotify", 11.99, true, "Incasso");
    push(day(11), "Basic-Fit", 29.99, true, "Incasso");
    push(
      day(15),
      "Eigen overboeking",
      350,
      true,
      "Overschrijving",
      CHECKING_IBAN,
      SAVINGS_IBAN,
      "Naar spaarrekening",
    );
    push(
      day(15),
      "Eigen overboeking",
      350,
      false,
      "Overschrijving",
      SAVINGS_IBAN,
      CHECKING_IBAN,
      "Van betaalrekening",
    );
    push(day(28), "Rente", 6.12 + m, false, "Rente", SAVINGS_IBAN);
    const shops: [string, number][] = [
      ["Albert Heijn", 64.2],
      ["Jumbo", 41.75],
      ["Albert Heijn", 52.9],
      ["Lidl", 33.4],
      ["Albert Heijn", 71.15],
      ["Thuisbezorgd", 28.6],
      ["NS Reizigers", 19.8],
      ["Bol.com", 36.99],
      ["Albert Heijn", 47.3],
      ["HEMA", 22.45],
    ];
    shops.forEach(([n, a], i) => push(day(2 + i * 2 + (m % 3)), n, a + m, true));
    push(
      day(12),
      "American Express",
      186.4 + m * 9,
      true,
      "Overschrijving",
      CHECKING_IBAN,
      CARD_IBAN,
      "Creditcard",
    );
    push(
      day(12),
      "Betaling ontvangen",
      186.4 + m * 9,
      false,
      "Overschrijving",
      CARD_IBAN,
      CHECKING_IBAN,
    );
    push(day(8), "Restaurant De Gouden Lepel", 58.5, true, "Betaalautomaat", CARD_IBAN);
    push(day(19), "Booking.com", 214 + m * 12, true, "Betaalautomaat", CARD_IBAN);
  }
  return out;
}

export function ingCsv(today: Date): string {
  const head =
    '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"';
  const lines = rows(today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(
      (r) =>
        `"${compact(r.date)}";"${r.name}";"${r.account}";"${r.counter}";"GT";"${r.out ? "Af" : "Bij"}";"${nl(r.amount)}";"${r.kind}";"${r.note}"`,
    );
  return [head, ...lines].join("\n");
}

export type VaultSeed = {
  accounts: Account[];
  txs: Tx[];
  rewards: RewardsBalance[];
  flows: ScheduledFlow[];
  bills: Bill[];
  billOccurrences: BillOccurrence[];
  valuations: Valuation[];
  /** One earlier import in a DIFFERENT format, so the generic session's
   *  cross-format warning is visible in the preview (WS3.6). */
  importSessions: ImportSession[];
};

/** A bills screen that has something to say: rent, energy, two subscriptions,
 *  a paused gym, a yearly insurance, a salary series as the payday, and a finite
 *  instalment plan. Most past rows are already closed so the "paid" section is
 *  not empty; the most recent Netflix and Basic-Fit rows stay open on purpose,
 *  so the real transactions beside them are shown as #287 match suggestions
 *  (confirm / reject), and an open Huur row demonstrates mark-paid. */
function billSeed(today: Date): { bills: Bill[]; billOccurrences: BillOccurrence[] } {
  const asOf = iso(today);
  const day = (n: number) => dayOf(today, n);
  const month = today.getUTCMonth() + 1;
  const firstOfLastMonth = iso(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)),
  );
  const base: Omit<Bill, "id" | "name" | "amountCents" | "rules" | "anchorDate"> = {
    type: "bill",
    status: "active",
    direction: "out",
    amountStrategy: "fixed",
    currency: "EUR",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
  };
  const bills: Bill[] = [
    {
      ...base,
      id: "b-huur",
      name: "Huur",
      amountCents: 125_000,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
      anchorDate: firstOfLastMonth,
      category: "Wonen",
    },
    {
      ...base,
      id: "b-energie",
      name: "Energie",
      amountCents: 9_200,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 8 }],
      anchorDate: firstOfLastMonth,
      category: "Wonen",
    },
    {
      ...base,
      id: "b-spotify",
      name: "Spotify",
      type: "subscription",
      amountCents: 1_099,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 15 }],
      anchorDate: firstOfLastMonth,
      merchant: "Spotify",
      category: "Abonnementen",
    },
    {
      ...base,
      id: "b-gym",
      name: "Sportschool",
      type: "subscription",
      status: "paused",
      amountCents: 3_495,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 5 }],
      anchorDate: firstOfLastMonth,
    },
    {
      ...base,
      id: "b-verzekering",
      name: "Inboedelverzekering",
      amountCents: 48_000,
      rules: [{ frequency: "yearly", interval: 1, monthOfYear: month, dayOfMonth: day(20) }],
      anchorDate: asOf,
    },
    {
      ...base,
      id: "b-studie",
      name: "Studieschuld",
      type: "installment",
      amountCents: 14_500,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
      anchorDate: firstOfLastMonth,
      endMode: "after_count",
      endAfterCount: 24,
    },
    {
      ...base,
      id: "b-netflix",
      name: "Netflix",
      type: "subscription",
      amountCents: 1_329,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 7 }],
      anchorDate: firstOfLastMonth,
      category: "Abonnementen",
    },
    {
      ...base,
      id: "b-sportschool",
      name: "Basic-Fit",
      type: "subscription",
      amountCents: 2_929,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 12 }],
      anchorDate: firstOfLastMonth,
      category: "Sport",
    },
    {
      ...base,
      id: "b-salaris",
      name: "Salaris",
      type: "income",
      direction: "in",
      amountCents: 380_000,
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
      anchorDate: firstOfLastMonth,
    },
  ];
  const generated = generateBillOccurrences(bills, [], asOf);
  // Every cycle before today is closed, the way real history would be: an open
  // past row with no matcher behind it would read as debt the owner already paid.
  // The latest past Netflix / Basic-Fit row is the exception: those are the two
  // rows the fixture transactions in `rows(today)` are meant to pay, so the
  // matcher has something real to suggest.
  const byId = new Map(bills.map((b) => [b.id, b]));
  const latestOpen = new Map<string, string>();
  for (const billId of ["b-netflix", "b-sportschool"]) {
    const past = generated.occurrences.filter((o) => o.billId === billId && o.dueOn < asOf);
    const latest = past
      .map((o) => o.dueOn)
      .sort()
      .pop();
    if (latest != null) latestOpen.set(billId, latest);
  }
  const occurrences: BillOccurrence[] = generated.occurrences.map((o) => {
    if (o.dueOn >= asOf) return o;
    if (o.billId === "b-gym") {
      return { ...o, status: "skipped", closedAt: o.dueOn, closedSource: "user" };
    }
    if (latestOpen.get(o.billId) === o.dueOn) return o;
    const bill = byId.get(o.billId);
    return {
      ...o,
      status: "paid",
      paidOn: o.dueOn,
      paidAmountCents: bill == null ? 0 : resolveBillAmountCents(bill),
      closedAt: o.dueOn,
      closedSource: "auto",
    };
  });
  return { bills, billOccurrences: occurrences };
}

/** The day-of-month of `today + n` days, for a yearly fixture anchored near today. */
function dayOf(today: Date, n: number): number {
  return new Date(today.getTime() + n * 86_400_000).getUTCDate();
}

export async function buildVaultSeed(today: Date, entity: string): Promise<VaultSeed> {
  const result = await createFileImport().load({
    filename: "preview-ing.csv",
    text: ingCsv(today),
    entity,
  });
  const asOf = iso(today);
  const patch: Record<string, Partial<Account>> = {
    [CHECKING_IBAN]: {
      name: "Betaalrekening",
      bank: "ING",
      balance: 4218.36,
      type: "Betaalrekening",
    },
    [SAVINGS_IBAN]: {
      name: "Oranje Spaarrekening",
      bank: "ING",
      balance: 18450.0,
      type: "Spaarrekening",
      interestRate: 1.6,
    },
    [CARD_IBAN]: {
      name: "Platinum Card",
      bank: "American Express",
      balance: -842.17,
      type: "Creditcard",
    },
  };
  // WS3.1 asset/liability accounts that no statement imports: a house with one
  // dated valuation (so the series has a hard reset and a stale label), a
  // mortgage with an opening anchor (forward replay), and a car with NO
  // valuation at all, which is the visible unknown/gap case.
  const manualAccounts: Account[] = [
    {
      key: "preview-woning",
      iban: "",
      name: "Woning",
      bank: "",
      entity,
      currency: "EUR",
      balance: null,
      type: "Woning",
    },
    {
      key: "preview-lening",
      iban: "",
      name: "Hypotheek",
      bank: "ING",
      entity,
      currency: "EUR",
      balance: null,
      type: "Lening",
      openingBalanceCents: -18_000_000,
      openingDate: iso(addDays(today, -120)),
    },
    {
      key: "preview-auto",
      iban: "",
      name: "Auto",
      bank: "",
      entity,
      currency: "EUR",
      balance: null,
      type: "Voertuig",
    },
  ];
  const valuations: Valuation[] = [
    {
      id: valuationId("preview-woning", iso(addDays(today, -60))),
      accountKey: "preview-woning",
      date: iso(addDays(today, -60)),
      amountCents: 42_000_000,
      currency: "EUR",
      kind: "reconciliation",
      source: "manual",
      createdAt: asOf,
    },
  ];
  const accounts = [
    ...result.accounts.map((a) => {
      const p = patch[a.iban] ?? patch[a.key];
      return p ? { ...a, ...p, balanceDate: asOf } : a;
    }),
    ...manualAccounts,
  ];
  const flows = [
    makeScheduledFlow({
      entity,
      label: "Factuur Acme",
      labelParts: { kind: "invoice", counterparty: "Acme Studio", invoiceNumber: "2026-041" },
      sign: 1,
      amountCents: 245_000,
      dueDate: iso(addDays(today, 12)),
      source: "manual",
    } as Omit<ScheduledFlow, "id">),
    makeScheduledFlow({
      entity,
      label: "Belasting voorschot",
      sign: -1,
      amountCents: 61_500,
      dueDate: iso(addDays(today, 21)),
      source: "manual",
    } as Omit<ScheduledFlow, "id">),
  ];
  const rewards = [
    makeRewardsBalance({ program: "Flying Blue", points: 41_250, updatedAt: asOf }),
    makeRewardsBalance({ program: "Amex Membership Rewards", points: 18_900, updatedAt: asOf }),
    makeRewardsBalance({
      program: "Hotels.com Rewards",
      points: 7_400,
      updatedAt: asOf,
      note: "10 nights = 1 free",
    }),
  ];
  const bills = billSeed(today);
  return {
    accounts,
    txs: assignTxIds(result.txs),
    rewards,
    flows,
    bills: bills.bills,
    billOccurrences: bills.billOccurrences,
    valuations,
    importSessions: [
      {
        id: "preview-mt940",
        documentId: null,
        filename: "ing-afschrift-2026-09.sta",
        // The savings account: importing its generic CSV is the second format.
        accountKey: SAVINGS_IBAN,
        format: "mt940",
        importedAt: iso(addDays(today, -30)),
        txIds: [],
        rowsRead: 12,
        rowsImported: 12,
        duplicatesSkipped: 0,
        rowsRejected: 0,
      },
    ],
  };
}

/** Two stored budget envelopes for the fixture vault (issue #289): the last
 *  full month and the month in progress, with one line per real category and a
 *  deliberate 200 EUR surplus per line so the carry is visible. Categories come
 *  from the same categorizer the app uses, so a line always matches a row. */
export function budgetSeed(
  accounts: readonly Account[],
  txs: readonly Tx[],
  today: Date,
): { periods: BudgetPeriod[]; groups: CategoryGroup[] } {
  const own = ownAccounts([...accounts]);
  const current = iso(today).slice(0, 7);
  const previous = iso(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)),
  ).slice(0, 7);
  const spent = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const month = t.date.slice(0, 7);
    if (month !== current && month !== previous) continue;
    const category = categorize(t, [], own);
    if (category === "") continue;
    const per = spent.get(category) ?? new Map<string, number>();
    per.set(month, (per.get(month) ?? 0) + Math.round(-t.amount * 100));
    spent.set(category, per);
  }
  const lines = [...spent]
    .filter(([, per]) => (per.get(previous) ?? 0) > 0)
    .sort((a, b) => (b[1].get(previous) ?? 0) - (a[1].get(previous) ?? 0))
    .slice(0, 4)
    .map(([category, per]) => ({
      category,
      allocationCents: (per.get(previous) ?? 0) + 20_000,
      rollover: true,
    }));
  if (lines.length === 0) return { periods: [], groups: [] };
  const budgetedSpendingCents = lines.reduce((sum, l) => sum + l.allocationCents, 0);
  const period = (month: string): BudgetPeriod => ({
    month,
    currency: "EUR",
    budgetedSpendingCents,
    rollover: true,
    lines,
    billsReservedCents: null,
  });
  const groups: CategoryGroup[] =
    lines.length >= 2
      ? [{ name: "Huishouden", categories: lines.slice(0, 2).map((l) => l.category) }]
      : [];
  return { periods: [period(previous), period(current)], groups };
}

const GOALS = (today: Date): Goal[] =>
  [
    {
      id: "g-buffer",
      purpose: "Emergency fund",
      kind: "general",
      targetCents: 1_800_000,
      targetDate: iso(addDays(today, 540)),
      priority: "must",
      plannedMonthlyCents: 35_000,
      startingBalanceCents: 1_200_000,
      accountRefs: [],
    },
    {
      id: "g-trip",
      purpose: "Japan trip",
      kind: "general",
      targetCents: 450_000,
      targetDate: iso(addDays(today, 300)),
      priority: "flexible",
      plannedMonthlyCents: 20_000,
      accountRefs: [],
    },
  ] as Goal[];

/** A finished profile, so Your plan and About you have something to show. */
export function completeProfile(today: Date): AdvisorProfileStore {
  const asOf = iso(today);
  let p = new AdvisorProfile({
    removed: [],
    intake: { blocksDone: 3, step0: "none", lastScreen: "upload" },
  });
  p = applyHousehold(p, { kind: "together", partnerIncomeInScope: false }, asOf);
  p = applyWork(p, ["employed"], asOf);
  p = applyChildren(p, [], asOf);
  p = applyStatedRange(p, "income", { lowCents: 330_000, highCents: 370_000 }, asOf);
  p = applyStatedRange(p, "spend", { lowCents: 260_000, highCents: 300_000 }, asOf);
  p = applyStatedHousing(p, "rent", 119_500, asOf);
  p = applyStatedSavings(p, 1_845_000, asOf);
  p = applyStatedDebitCards(p, ["ing"], asOf);
  p = applyStatedCards(p, [], asOf);
  p = applyGoals(p, GOALS(today), asOf);
  p = applyBuffer(p, 6, asOf);
  const answers = Object.fromEntries(RISK_SCALE.items.map((it) => [it.id, it.options[1]!.id]));
  p = applyRiskAnswers(p, answers, asOf);
  return { ...emptyProfileStore(asOf), current: p };
}

/** A half-filled profile whose NEXT wizard screen is `screen`. */
export type WizardStop =
  | "start"
  | "work"
  | "spend"
  | "debit-cards"
  | "cards"
  | "goal"
  | "debts"
  | "risk-first"
  | "upload";

export function profileResumingAt(screen: WizardStop, today: Date): AdvisorProfileStore {
  const asOf = iso(today);
  const base = new AdvisorProfile({ removed: [], intake: { blocksDone: 0, step0: "none" } });
  const order: Record<WizardStop, { last?: ScreenId; blocks?: number }> = {
    start: {},
    work: { last: "birth-year" },
    spend: { last: "income" },
    "debit-cards": { last: "banks", blocks: 1 },
    cards: { last: "debit-cards" },
    goal: { last: "foreign-spend", blocks: 1 },
    debts: { last: "goal", blocks: 1 },
    "risk-first": { last: "buffer", blocks: 2 },
    upload: { last: "summary", blocks: 3 },
  };
  const o = order[screen];
  let p = base;
  if (o.last) p = markDone(p, o.last);
  if (o.blocks) p = new AdvisorProfile({ ...p, intake: { ...p.intake, blocksDone: o.blocks } });
  if (o.last && o.last !== "household") p = applyHousehold(p, { kind: "alone" }, asOf);
  return { ...emptyProfileStore(asOf), current: p };
}
