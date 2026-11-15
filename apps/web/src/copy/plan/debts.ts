import type { DebtFigures, DebtRow, DebtsCalcId } from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  factLine,
  type DebtsMissingKind,
  type DebtsReasonKey,
  type FactSlot,
  type PlanFmt,
  type SectionCopy,
} from "./shared.js";

/** Section 3: Debts. A debt is shown with its cost, never labelled good or
 *  bad. A debt without a rate is listed without a cost and never given one. */
export type DebtsCopy = SectionCopy<DebtFigures, DebtsReasonKey, DebtsMissingKind, DebtsCalcId> & {
  labels: {
    balance: string;
    rate: string;
    payment: string;
    interestPerYear: string;
    payoff: string;
  };
  /** The notice shown every time, including with no debt found. */
  invisibleDebt: string;
  rowCost: (row: DebtRow, fmt: PlanFmt) => string;
  rowPayoff: (row: DebtRow, fmt: PlanFmt) => string;
  rowExtra: (row: DebtRow, fmt: PlanFmt) => string | null;
  payoffReason: Record<NonNullable<DebtRow["payoffReason"]>, string>;
  kindLabel: Record<DebtRow["kind"], string>;
  rateSource: Record<NonNullable<DebtRow["rateSource"]>, string>;
  savingsRateLine: (pct: string) => string;
  /** Filled only from a verified DUO fact. */
  facts: { duoRules: FactSlot };
};

const nl: DebtsCopy = {
  reasons: {
    "no-debt": "Er zijn geen schulden in je profiel.",
    "debt-no-payments": "Er staan schulden in je profiel, maar zonder maandelijkse betaling.",
    "debt-payments": "Er is minstens één schuld met een maandelijkse betaling.",
    "debt-payment-below-interest":
      "Bij minstens één schuld is de maandelijkse betaling lager dan de rente over die schuld.",
    "debt-rate-missing":
      "Bij minstens één schuld ontbreekt de rente, dus de kosten zijn niet te berekenen.",
    "debts-not-asked": "De vraag naar schulden is nog niet beantwoord.",
  },
  labels: {
    balance: "Openstaand bedrag",
    rate: "Rente per jaar",
    payment: "Betaling per maand",
    interestPerYear: "Rente per jaar in euro",
    payoff: "Einde van de schuld",
  },
  invisibleDebt:
    "Schulden bij andere banken of privéleningen zijn voor LaVega niet zichtbaar. Geen schuld te zien betekent dus niet dat er geen schuld is.",
  rowCost: (row, fmt) =>
    row.ratePct === null
      ? `${row.lender}: de rente ontbreekt, dus de kosten zijn niet berekend.`
      : row.interestPerYearCents === null
        ? `${row.lender}: de rente is ${fmt.points(row.ratePct)} per jaar; het openstaande bedrag ontbreekt, dus de kosten zijn niet berekend.`
        : `${row.lender} kost ${fmt.points(row.ratePct)} per jaar, ongeveer ${fmt.eur(row.interestPerYearCents)} aan rente.`,
  rowPayoff: (row, fmt) =>
    row.payoffMonths !== null && row.payoffDate !== null
      ? `Bij de huidige betaling van ${fmt.eur(row.monthlyCents)} per maand is de schuld over ${fmt.monthsLabel(row.payoffMonths)} afbetaald, rond ${fmt.date(row.payoffDate)}.`
      : DASH,
  rowExtra: (row, fmt) => {
    const w = row.withExtra;
    if (w === null) return null;
    if (w.payoffMonths === null || w.monthsEarlier === null || w.interestSavedCents === null)
      return `Met ${fmt.eurExact(w.extraCents)} extra per maand is de einddatum niet te berekenen.`;
    return `Met ${fmt.eurExact(w.extraCents)} extra per maand is de schuld ${fmt.monthsLabel(w.monthsEarlier)} eerder afbetaald en kost ze ${fmt.eur(w.interestSavedCents)} minder aan rente.`;
  },
  payoffReason: {
    "payment-below-interest":
      "Met deze maandelijkse betaling daalt het openstaande bedrag niet binnen de grens van de berekening, dus er is geen einddatum.",
    "no-balance": "Het openstaande bedrag ontbreekt, dus er is geen einddatum berekend.",
    "no-rate": "De rente ontbreekt, dus er is geen einddatum berekend.",
  },
  kindLabel: { consumer: "lening", duo: "studielening (DUO)", other: "andere schuld" },
  rateSource: {
    stated: "door jou ingevuld",
    detected: "herkend uit je transacties",
  },
  savingsRateLine: (pct) => `Je spaarrekening geeft nu ${pct} per jaar.`,
  facts: { duoRules: (value, source) => `${value} (${source})` },
  headline: (f, fmt) =>
    f.totalInterestPerYearCents === null
      ? DASH
      : `${fmt.eur(f.totalInterestPerYearCents)} rente per jaar`,
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.totalInterestPerYearCents !== null && f.rows.length > 0)
        out.push(
          `Je schulden kosten samen ongeveer ${fmt.eur(f.totalInterestPerYearCents)} per jaar aan rente.`,
        );
      for (const r of f.rows) out.push(nl.rowCost(r, fmt));
      if (f.savingsRatePct !== null) out.push(nl.savingsRateLine(fmt.points(f.savingsRatePct)));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.totalInterestPerYearCents !== null && f.rows.length > 0)
        out.push(
          `Je schulden kosten samen ongeveer ${fmt.eur(f.totalInterestPerYearCents)} per jaar aan rente.`,
        );
      for (const r of f.rows) {
        out.push(nl.rowCost(r, fmt));
        if (r.balanceCents !== null) out.push(`Openstaand: ${fmt.eur(r.balanceCents)}.`);
        if (r.rateSource !== null) out.push(`De rente is ${nl.rateSource[r.rateSource]}.`);
        out.push(r.payoffReason === null ? nl.rowPayoff(r, fmt) : nl.payoffReason[r.payoffReason]);
        const extra = nl.rowExtra(r, fmt);
        if (extra !== null) out.push(extra);
        out.push(`Soort: ${nl.kindLabel[r.kind]}.`);
        if (r.kind === "duo") {
          const duo = factLine("duo-rules", nl.facts.duoRules);
          if (duo !== null) out.push(duo);
        }
      }
      if (f.savingsRatePct !== null) out.push(nl.savingsRateLine(fmt.points(f.savingsRatePct)));
      out.push(nl.invisibleDebt);
      return out;
    },
  },
  empty: {
    "debt-rate":
      "De rente van een schuld ontbreekt. De schuld staat in de lijst, maar haar kosten zijn niet berekend en er is geen rente aangenomen. Er is niets geschat.",
    "debt-balance":
      "Het openstaande bedrag van een schuld ontbreekt. Rente per jaar en einddatum zijn dan niet te berekenen. Er is niets geschat.",
    debts:
      "De vraag naar schulden staat nog open. Schulden bij andere banken of privéleningen zijn voor LaVega niet zichtbaar. Er is niets geschat.",
  },
  howCalculated: {
    "interest-per-year": "Rente per jaar is het openstaande bedrag maal de rente per jaar.",
    payoff:
      "We rekenen maand voor maand: rente over het openstaande bedrag (rente per jaar gedeeld door 12), dan je betaling aan het einde van de maand, afgerond op hele centen. Daalt het bedrag niet binnen de grens van de berekening, dan is er geen einddatum.",
    "extra-payment":
      "Hetzelfde maandelijkse rekenwerk, met het extra bedrag dat jij hebt ingevuld bij je betaling. Het verschil in maanden en in rente is het resultaat.",
    "savings-rate":
      "De rente van je eigen spaarrekening, uit een door jou ingevulde rente of herkend uit je transacties.",
  },
  education: [
    {
      conceptId: "apr",
      title: "Wat is een jaarlijks rentepercentage?",
      body: "Het rentepercentage per jaar laat zien wat lenen over een jaar kost, als percentage van het bedrag dat openstaat.",
    },
    {
      conceptId: "revolving-credit",
      title: "Doorlopend krediet en rood staan",
      body: "Rood staan en doorlopend krediet zijn vormen van lenen waarbij je binnen een limiet opneemt en aflost. Het rentepercentage staat in de voorwaarden.",
    },
  ],
};

const en: DebtsCopy = {
  reasons: {
    "no-debt": "There are no debts in your profile.",
    "debt-no-payments": "There are debts in your profile, but with no monthly payment.",
    "debt-payments": "At least one debt has a monthly payment.",
    "debt-payment-below-interest":
      "For at least one debt, the monthly payment is lower than the interest on that debt.",
    "debt-rate-missing": "At least one debt has no rate, so its cost cannot be calculated.",
    "debts-not-asked": "The question about debts has not been answered yet.",
  },
  labels: {
    balance: "Balance",
    rate: "Rate per year",
    payment: "Payment per month",
    interestPerYear: "Interest per year in euros",
    payoff: "End of the debt",
  },
  invisibleDebt:
    "Debts at other banks or private loans are not visible to LaVega. Seeing no debt here does not mean there is none.",
  rowCost: (row, fmt) =>
    row.ratePct === null
      ? `${row.lender}: the rate is missing, so the cost has not been calculated.`
      : row.interestPerYearCents === null
        ? `${row.lender}: the rate is ${fmt.points(row.ratePct)} a year; the balance is missing, so the cost has not been calculated.`
        : `${row.lender} costs ${fmt.points(row.ratePct)} a year, about ${fmt.eur(row.interestPerYearCents)} in interest.`,
  rowPayoff: (row, fmt) =>
    row.payoffMonths !== null && row.payoffDate !== null
      ? `At the current payment of ${fmt.eur(row.monthlyCents)} a month, the debt is paid off in ${fmt.monthsLabel(row.payoffMonths)}, around ${fmt.date(row.payoffDate)}.`
      : DASH,
  rowExtra: (row, fmt) => {
    const w = row.withExtra;
    if (w === null) return null;
    if (w.payoffMonths === null || w.monthsEarlier === null || w.interestSavedCents === null)
      return `With ${fmt.eurExact(w.extraCents)} more a month, the end date cannot be calculated.`;
    return `With ${fmt.eurExact(w.extraCents)} more a month, the debt would be paid off ${fmt.monthsLabel(w.monthsEarlier)} earlier and cost ${fmt.eur(w.interestSavedCents)} less in interest.`;
  },
  payoffReason: {
    "payment-below-interest":
      "At this monthly payment the balance does not fall within the limit of the calculation, so there is no end date.",
    "no-balance": "The balance is missing, so no end date has been calculated.",
    "no-rate": "The rate is missing, so no end date has been calculated.",
  },
  kindLabel: { consumer: "loan", duo: "student loan (DUO)", other: "other debt" },
  rateSource: {
    stated: "entered by you",
    detected: "recognised from your transactions",
  },
  savingsRateLine: (pct) => `Your savings account pays ${pct} a year now.`,
  facts: { duoRules: (value, source) => `${value} (${source})` },
  headline: (f, fmt) =>
    f.totalInterestPerYearCents === null
      ? DASH
      : `${fmt.eur(f.totalInterestPerYearCents)} interest a year`,
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.totalInterestPerYearCents !== null && f.rows.length > 0)
        out.push(
          `Your debts together cost about ${fmt.eur(f.totalInterestPerYearCents)} a year in interest.`,
        );
      for (const r of f.rows) out.push(en.rowCost(r, fmt));
      if (f.savingsRatePct !== null) out.push(en.savingsRateLine(fmt.points(f.savingsRatePct)));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.totalInterestPerYearCents !== null && f.rows.length > 0)
        out.push(
          `Your debts together cost about ${fmt.eur(f.totalInterestPerYearCents)} a year in interest.`,
        );
      for (const r of f.rows) {
        out.push(en.rowCost(r, fmt));
        if (r.balanceCents !== null) out.push(`Balance: ${fmt.eur(r.balanceCents)}.`);
        if (r.rateSource !== null) out.push(`The rate is ${en.rateSource[r.rateSource]}.`);
        out.push(r.payoffReason === null ? en.rowPayoff(r, fmt) : en.payoffReason[r.payoffReason]);
        const extra = en.rowExtra(r, fmt);
        if (extra !== null) out.push(extra);
        out.push(`Kind: ${en.kindLabel[r.kind]}.`);
        if (r.kind === "duo") {
          const duo = factLine("duo-rules", en.facts.duoRules);
          if (duo !== null) out.push(duo);
        }
      }
      if (f.savingsRatePct !== null) out.push(en.savingsRateLine(fmt.points(f.savingsRatePct)));
      out.push(en.invisibleDebt);
      return out;
    },
  },
  empty: {
    "debt-rate":
      "The rate of a debt is missing. The debt is in the list, but its cost has not been calculated and no rate was assumed. Nothing has been estimated.",
    "debt-balance":
      "The balance of a debt is missing. Interest per year and the end date cannot be calculated without it. Nothing has been estimated.",
    debts:
      "The question about debts is still open. Debts at other banks or private loans are not visible to LaVega. Nothing has been estimated.",
  },
  howCalculated: {
    "interest-per-year": "Interest per year is the balance times the rate per year.",
    payoff:
      "We work month by month: interest on the balance (rate per year divided by 12), then your payment at the end of the month, rounded to whole cents. If the balance does not fall within the limit of the calculation, there is no end date.",
    "extra-payment":
      "The same month-by-month working, with the extra amount you entered added to your payment. The difference in months and in interest is the result.",
    "savings-rate":
      "The rate on your own savings account, from a rate you entered or recognised from your transactions.",
  },
  education: [
    {
      conceptId: "apr",
      title: "What is an annual percentage rate?",
      body: "The rate per year shows what borrowing costs over a year, as a percentage of the amount owed.",
    },
    {
      conceptId: "revolving-credit",
      title: "Revolving credit and overdrafts",
      body: "Overdrafts and revolving credit are forms of borrowing where you draw and repay within a limit. The rate is in the terms.",
    },
  ],
};

export const debtsCopy: Record<Locale, DebtsCopy> = { nl, en };
