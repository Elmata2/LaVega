import type { SpendHistoryRow, SpendingCalcId, SpendingFigures } from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  PLAN_NUMBERS,
  type FactSlot,
  type PlanFmt,
  type SectionCopy,
  type SpendingMissingKind,
  type SpendingReasonKey,
} from "./shared.js";

/** Section 4: Spending per category. Only ever compared with the user's own
 *  history. No category is called too high, and no other household is named. */
export type SpendingCopy = SectionCopy<
  SpendingFigures,
  SpendingReasonKey,
  SpendingMissingKind,
  SpendingCalcId
> & {
  labels: {
    category: string;
    lastMonth: string;
    average3: string;
    median: string;
    trend: string;
    limit: string;
    percentile: string;
  };
  /** `category` arrives already translated by the caller. */
  rowLine: (category: string, row: SpendHistoryRow, fmt: PlanFmt) => string;
  trendLine: (cents: number[], fmt: PlanFmt) => string;
  percentileLine: (ratio: number, fmt: PlanFmt) => string;
  percentileReason: Record<NonNullable<SpendHistoryRow["percentileReason"]>, string>;
  limitLine: (category: string, limit: string, months: number) => string;
  /** Shown while there are too few months for a comparison. */
  needsSixMonths: string;
  /** Outside figures render only from a verified public fact. */
  facts: { referenceBudget: FactSlot };
};

const nl: SpendingCopy = {
  reasons: {
    "within-limits": "Elke categorie bleef binnen je eigen grens.",
    "no-limits": "Je hebt geen eigen grenzen ingesteld.",
    "over-limit": "Een categorie lag twee of meer maanden achter elkaar boven je eigen grens.",
    "history-short-6m": `Er zijn minder dan ${PLAN_NUMBERS.spendingMonths} volle maanden aan gegevens: ${PLAN_NUMBERS.earlierMonths} eerdere maanden plus de laatste.`,
    "data-stale": "Een rekening heeft geen gegevens over de laatste volle maand.",
  },
  labels: {
    category: "Categorie",
    lastMonth: "Vorige maand",
    average3: "Gemiddelde van drie maanden",
    median: "Gewone maand (mediaan)",
    trend: "Verloop per maand",
    limit: "Jouw grens",
    percentile: "Plaats binnen je eigen maanden",
  },
  rowLine: (category, row, fmt) =>
    row.median12Cents === null
      ? `Bij ${category} gaf je vorige maand ${fmt.eur(row.lastMonthCents)} uit.`
      : `Bij ${category} gaf je vorige maand ${fmt.eur(row.lastMonthCents)} uit; je gewone maand is ${fmt.eur(row.median12Cents)}.`,
  trendLine: (cents, fmt) =>
    `Laatste ${cents.length} maanden: ${cents.map((c) => fmt.eur(c)).join(", ")}.`,
  percentileLine: (ratio, fmt) =>
    `Vorige maand lag hoger dan ${fmt.pct(ratio)} van je eerdere maanden in deze categorie.`,
  percentileReason: {
    "geen-gegevens": "Er zijn geen gegevens voor deze categorie.",
    "te-weinig-geschiedenis": `Voor een vergelijking met je eigen maanden zijn ${PLAN_NUMBERS.spendingMonths} volle maanden nodig.`,
    "nieuwe-categorie":
      "Deze categorie is nieuw; er zijn geen eerdere maanden om mee te vergelijken.",
    "te-kort-bekend": "Deze categorie bestaat nog te kort voor een vergelijking.",
    "geen-verschil": "Alle eerdere maanden waren even hoog, dus er is geen plaats te bepalen.",
  },
  limitLine: (category, limit, months) =>
    `Bij ${category} lag je uitgave ${months} maand${months === 1 ? "" : "en"} achter elkaar boven je eigen grens van ${limit}.`,
  needsSixMonths: `Voor een vergelijking met je eigen geschiedenis zijn ${PLAN_NUMBERS.spendingMonths} volle maanden nodig. Tot dan staan hier alleen de maandtotalen.`,
  facts: { referenceBudget: (value, source) => `Referentiebudget: ${value} (${source})` },
  headline: (f, fmt) => {
    if (f.rows.length === 0 || f.lastMonth === null) return DASH;
    const total = f.rows.reduce((s, r) => s + r.lastMonthCents, 0);
    return `${fmt.monthLabel(f.lastMonth)}: ${fmt.eur(total)}`;
  },
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.months < PLAN_NUMBERS.spendingMonths) out.push(nl.needsSixMonths);
      for (const r of f.rows.slice(0, 3)) out.push(nl.rowLine(r.category, r, fmt));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.firstMonth !== null && f.lastMonth !== null)
        out.push(
          `De cijfers rusten op ${f.months} volle maanden, van ${fmt.monthLabel(f.firstMonth)} tot ${fmt.monthLabel(f.lastMonth)}.`,
        );
      if (f.months < PLAN_NUMBERS.spendingMonths) out.push(nl.needsSixMonths);
      for (const r of f.rows) {
        out.push(nl.rowLine(r.category, r, fmt));
        out.push(nl.trendLine(r.trend6, fmt));
        if (r.percentile !== null) out.push(nl.percentileLine(r.percentile, fmt));
        else if (r.percentileReason !== null) out.push(nl.percentileReason[r.percentileReason]);
        if (r.limitCents !== null && r.overLimitMonths > 0)
          out.push(nl.limitLine(r.category, fmt.eur(r.limitCents), r.overLimitMonths));
      }
      if (f.excludedForeignCount > 0)
        out.push(`${f.excludedForeignCount} regels in een andere valuta zijn niet meegeteld.`);
      return out;
    },
  },
  empty: {
    "account-stale":
      "Een rekening heeft geen gegevens over de laatste volle maand. Zolang dat zo is, zijn de uitgaven per categorie niet berekend. Er is niets geschat.",
    "history-6m": `Er zijn minder dan ${PLAN_NUMBERS.spendingMonths} volle maanden aan transacties. Een vergelijking met je eigen geschiedenis is dan niet te maken en er is geen plaats berekend. Er is niets geschat.`,
  },
  howCalculated: {
    "spend-months":
      "We tellen per categorie de uitgaven van je persoonlijke rekeningen per volle kalendermaand, zonder overboekingen tussen eigen rekeningen en zonder regels in een andere valuta.",
    "spend-median":
      "De gewone maand is de middelste waarde van de volle maanden in de laatste twaalf. Maanden zonder gegevens tellen niet mee.",
    "spend-percentile": `De plaats van vorige maand binnen je eigen eerdere maanden in dezelfde categorie. Het wordt pas berekend met minstens ${PLAN_NUMBERS.earlierMonths} eerdere maanden en de laatste volle maand.`,
    "over-limit":
      "Het aantal maanden achter elkaar, tot en met de laatste volle maand, waarin de uitgave boven je eigen grens lag.",
  },
  education: [
    {
      conceptId: "own-history",
      title: "Je eigen maanden als maatstaf",
      body: "Een percentage bij een categorie laat zien hoeveel van je eigen eerdere maanden in die categorie lager lagen dan vorige maand.",
    },
  ],
};

const en: SpendingCopy = {
  reasons: {
    "within-limits": "Every category stayed within your own limit.",
    "no-limits": "You have not set any limits of your own.",
    "over-limit": "A category was above your own limit for two or more months in a row.",
    "history-short-6m": `There are fewer than ${PLAN_NUMBERS.spendingMonths} full months of data: ${PLAN_NUMBERS.earlierMonths} earlier months plus the latest.`,
    "data-stale": "An account has no data for the last full month.",
  },
  labels: {
    category: "Category",
    lastMonth: "Last month",
    average3: "Three-month average",
    median: "Usual month (median)",
    trend: "Month by month",
    limit: "Your limit",
    percentile: "Position within your own months",
  },
  rowLine: (category, row, fmt) =>
    row.median12Cents === null
      ? `In ${category} you spent ${fmt.eur(row.lastMonthCents)} last month.`
      : `In ${category} you spent ${fmt.eur(row.lastMonthCents)} last month; your usual month is ${fmt.eur(row.median12Cents)}.`,
  trendLine: (cents, fmt) =>
    `Last ${cents.length} months: ${cents.map((c) => fmt.eur(c)).join(", ")}.`,
  percentileLine: (ratio, fmt) =>
    `Last month was higher than ${fmt.pct(ratio)} of your earlier months in this category.`,
  percentileReason: {
    "geen-gegevens": "There is no data for this category.",
    "te-weinig-geschiedenis": `A comparison with your own months needs ${PLAN_NUMBERS.spendingMonths} full months.`,
    "nieuwe-categorie": "This category is new; there are no earlier months to compare with.",
    "te-kort-bekend": "This category has existed too briefly for a comparison.",
    "geen-verschil": "All earlier months were equal, so no position can be given.",
  },
  limitLine: (category, limit, months) =>
    `In ${category}, spending was above your own limit of ${limit} for ${months} month${months === 1 ? "" : "s"} in a row.`,
  needsSixMonths: `A comparison with your own history needs ${PLAN_NUMBERS.spendingMonths} full months. Until then only the monthly totals are shown.`,
  facts: { referenceBudget: (value, source) => `Reference budget: ${value} (${source})` },
  headline: (f, fmt) => {
    if (f.rows.length === 0 || f.lastMonth === null) return DASH;
    const total = f.rows.reduce((s, r) => s + r.lastMonthCents, 0);
    return `${fmt.monthLabel(f.lastMonth)}: ${fmt.eur(total)}`;
  },
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.months < PLAN_NUMBERS.spendingMonths) out.push(en.needsSixMonths);
      for (const r of f.rows.slice(0, 3)) out.push(en.rowLine(r.category, r, fmt));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.firstMonth !== null && f.lastMonth !== null)
        out.push(
          `The figures rest on ${f.months} full months, from ${fmt.monthLabel(f.firstMonth)} to ${fmt.monthLabel(f.lastMonth)}.`,
        );
      if (f.months < PLAN_NUMBERS.spendingMonths) out.push(en.needsSixMonths);
      for (const r of f.rows) {
        out.push(en.rowLine(r.category, r, fmt));
        out.push(en.trendLine(r.trend6, fmt));
        if (r.percentile !== null) out.push(en.percentileLine(r.percentile, fmt));
        else if (r.percentileReason !== null) out.push(en.percentileReason[r.percentileReason]);
        if (r.limitCents !== null && r.overLimitMonths > 0)
          out.push(en.limitLine(r.category, fmt.eur(r.limitCents), r.overLimitMonths));
      }
      if (f.excludedForeignCount > 0)
        out.push(`${f.excludedForeignCount} lines in another currency are not counted.`);
      return out;
    },
  },
  empty: {
    "account-stale":
      "An account has no data for the last full month. While that is so, spending per category has not been calculated. Nothing has been estimated.",
    "history-6m": `There are fewer than ${PLAN_NUMBERS.spendingMonths} full months of transactions. A comparison with your own history cannot be made and no position has been calculated. Nothing has been estimated.`,
  },
  howCalculated: {
    "spend-months":
      "For each category we add up the spending of your personal accounts per full calendar month, leaving out transfers between your own accounts and lines in another currency.",
    "spend-median":
      "The usual month is the middle value of the full months in the last twelve. Months without data do not count.",
    "spend-percentile": `The position of last month within your own earlier months in the same category. It is only calculated with at least ${PLAN_NUMBERS.earlierMonths} earlier months and the latest full month.`,
    "over-limit":
      "The number of months in a row, up to the latest full month, in which spending was above your own limit.",
  },
  education: [
    {
      conceptId: "own-history",
      title: "Your own months as the yardstick",
      body: "A percentage on a category shows how many of your own earlier months in that category were lower than last month.",
    },
  ],
};

export const spendingCopy: Record<Locale, SpendingCopy> = { nl, en };
