/* Synthetic data for the midnight preview harness. Every person, company, IBAN
 * and amount below is invented. Dates are relative to "today" so the forecast,
 * the deadlines and the "this month" cards always have something to say. */
import {
  AdvisorProfile,
  RISK_SCALE,
  emptyProfileStore,
  makeRewardsBalance,
  makeScheduledFlow,
  type Account,
  type AdvisorProfileStore,
  type Goal,
  type RewardsBalance,
  type ScheduledFlow,
  type Tx,
  assignTxIds,
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
};

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
  const accounts = result.accounts.map((a) => {
    const p = patch[a.iban] ?? patch[a.key];
    return p ? { ...a, ...p, balanceDate: asOf } : a;
  });
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
  return { accounts, txs: assignTxIds(result.txs), rewards, flows };
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
