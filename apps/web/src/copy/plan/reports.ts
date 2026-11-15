import type { Locale } from "../../locale.js";
import type { PlanFmt } from "./shared.js";

/** The reports card: the balance sheet and the income statements (WS3.3,
 *  issue #292). Every sentence that carries a figure takes it already
 *  formatted; the "how calculated" lines read the engine's own steps, so the
 *  numbers shown are the numbers used. */
export type ReportsCopy = {
  title: string;
  intro: string;
  howCalculated: string;
  balanceSheet: {
    title: string;
    intro: string;
    assets: string;
    liabilities: string;
    equity: string;
    /** The sheet is a gap: named accounts could not be valued. */
    gap: (count: number, names: string) => string;
    /** Side label when every account on that side is known. */
    unknownValue: string;
    stale: string;
    rowUnknown: string;
    weight: (pct: string) => string;
  };
  income: {
    title: string;
    intro: string;
    partial: string;
    incomeTotal: string;
    spendTotal: string;
    netSavings: string;
    savingsRate: string;
    unknownRate: string;
    incomeSide: string;
    spendSide: string;
    noIncome: string;
    noSpend: string;
    excludedForeign: (n: number) => string;
    cleanedRows: (n: number) => string;
  };
  /** One plain sentence per report calc step. */
  calc: Record<string, string>;
};

const nl: ReportsCopy = {
  title: "Balans en resultaat",
  intro:
    "Wat je bezit en wat je schuldig bent op deze dag, en wat er in de laatste periodes binnenkwam en uitging.",
  howCalculated: "Zo is dit berekend",
  balanceSheet: {
    title: "Balans",
    intro: "Bezittingen en schulden op de dagstand, met het vermogen als verschil.",
    assets: "Bezittingen",
    liabilities: "Schulden",
    equity: "Vermogen",
    gap: (count, names) =>
      `Onbekend: ${count === 1 ? "deze rekening heeft" : `${count} rekeningen hebben`} geen waardering (${names}). Zonder dat bedrag is het vermogen onbekend, niet nul.`,
    unknownValue: "onbekend",
    stale: "bedrag is meegenomen, niet opnieuw vastgesteld",
    rowUnknown: "onbekend",
    weight: (pct) => `${pct} van de kant`,
  },
  income: {
    title: "Resultaat per periode",
    intro:
      "Inkomen en uitgaven per categorie, met de netto besparing en het spaarquote. Terugbetalingen worden eerst per categorie verrekend.",
    partial: "maand loopt nog",
    incomeTotal: "Inkomen",
    spendTotal: "Uitgaven",
    netSavings: "Netto besparing",
    savingsRate: "Spaarquote",
    unknownRate: "onbekend (geen inkomen)",
    incomeSide: "Inkomsten",
    spendSide: "Uitgaven",
    noIncome: "Geen inkomen in deze periode.",
    noSpend: "Geen uitgaven in deze periode.",
    excludedForeign: (n) =>
      `${n} rij${n === 1 ? "" : "en"} in een vreemde valuta ${n === 1 ? "is" : "zijn"} niet meegerekend: zonder koers geen eerlijk bedrag.`,
    cleanedRows: (n) =>
      `${n} rij${n === 1 ? "" : "en"} overgeslagen: overboeking tussen eigen rekeningen of kaartafwikkeling.`,
  },
  calc: {
    "report-assets-total": "Bezittingen: de som van de bekende rekeningstanden aan de bezitskant.",
    "report-liabilities-total": "Schulden: de som van de openstaande bedragen aan de schuldkant.",
    "report-equity":
      "Vermogen: bezittingen min schulden. Ontbreekt een waardering, dan is dit onbekend.",
    "report-net-worth-series":
      "Dezelfde waarde als de vermogensreeks van de dagstanden, hier apart berekend als kruiscontrole.",
    "report-income-total":
      "Inkomen: de categorieën die per saldo inkomen zijn, na verrekening van terugbetalingen.",
    "report-spend-total":
      "Uitgaven: de categorieën die per saldo uitgave zijn, volgens dezelfde verrekening.",
    "report-net-savings":
      "Netto besparing: inkomen min uitgaven. Dit is de kruiscontrole van het resultaat.",
    "report-savings-rate":
      "Spaarquote: netto besparing gedeeld door inkomen. Zonder inkomen is de quote onbekend, niet nul.",
  },
};

const en: ReportsCopy = {
  title: "Balance sheet and income",
  intro: "What you own and owe on this day, and what came in and went out over the recent periods.",
  howCalculated: "How this is calculated",
  balanceSheet: {
    title: "Balance sheet",
    intro: "Assets and liabilities at the day's position, with equity as the difference.",
    assets: "Assets",
    liabilities: "Liabilities",
    equity: "Equity",
    gap: (count, names) =>
      `Unknown: ${count === 1 ? "this account has" : `${count} accounts have`} no valuation (${names}). Without that amount equity is unknown, not zero.`,
    unknownValue: "unknown",
    stale: "amount is carried, not re-established",
    rowUnknown: "unknown",
    weight: (pct) => `${pct} of the side`,
  },
  income: {
    title: "Income per period",
    intro:
      "Income and spending by category, with net savings and the savings rate. Refunds are netted per category first.",
    partial: "month in progress",
    incomeTotal: "Income",
    spendTotal: "Spending",
    netSavings: "Net savings",
    savingsRate: "Savings rate",
    unknownRate: "unknown (no income)",
    incomeSide: "Income",
    spendSide: "Spending",
    noIncome: "No income in this period.",
    noSpend: "No spending in this period.",
    excludedForeign: (n) =>
      `${n} row${n === 1 ? "" : "s"} in a foreign currency ${n === 1 ? "is" : "are"} not counted: without a rate there is no honest amount.`,
    cleanedRows: (n) =>
      `${n} row${n === 1 ? "" : "s"} skipped: a transfer between your own accounts or a card settlement.`,
  },
  calc: {
    "report-assets-total": "Assets: the sum of the known account balances on the asset side.",
    "report-liabilities-total": "Liabilities: the sum of the amounts owed on the liability side.",
    "report-equity": "Equity: assets minus liabilities. Without a valuation this is unknown.",
    "report-net-worth-series":
      "The same figure as the daily net-worth series, computed separately here as a cross-check.",
    "report-income-total": "Income: the categories that net to income, after refunds are netted.",
    "report-spend-total": "Spending: the categories that net to spending, with the same netting.",
    "report-net-savings": "Net savings: income minus spending. This is the statement's cross-foot.",
    "report-savings-rate":
      "Savings rate: net savings divided by income. Without income the rate is unknown, not zero.",
  },
};

export const reportsCopy: Record<Locale, ReportsCopy> = { nl, en };

/** Re-exported so a caller can type a formatted figure, keeping this module's
 *  imports in one place. */
export type { PlanFmt };
