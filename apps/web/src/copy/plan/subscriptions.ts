import type { SubRow, SubsCalcId, SubsFigures } from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  PLAN_NUMBERS,
  planFmt,
  type PlanFmt,
  type SectionCopy,
  type SubsMissingKind,
  type SubsReasonKey,
} from "./shared.js";

/** Section 5: Subscriptions. An evidence list. The labels Keep, Review and
 *  Cancel are set by the user only; no row is pre-selected or highlighted. */
export type SubsCopy = SectionCopy<SubsFigures, SubsReasonKey, SubsMissingKind, SubsCalcId> & {
  labels: {
    perMonth: string;
    perYear: string;
    monthsActive: string;
    usage: string;
    total: string;
  };
  decisions: Record<NonNullable<SubRow["decision"]>, string>;
  /** Row facts, as statements. */
  priceUp: (row: SubRow, fmt: PlanFmt) => string | null;
  /** `functionLabel` arrives already translated. */
  overlap: (count: number, functionLabel: string, combined: string) => string;
  noUseLogged: (yearly: string) => string;
  missedPayment: (cycles: number) => string;
  usageLine: (row: SubRow, fmt: PlanFmt) => string;
  whatIf: (monthly: string, yearly: string) => string;
  manualAdd: string;
  usageUnknown: string;
};

const fmtNl = planFmt("nl");
const fmtEn = planFmt("en");

const nl: SubsCopy = {
  reasons: {
    clean:
      "Er is geen prijsverhoging gezien in de laatste twaalf maanden en geen twee abonnementen zijn in dezelfde categorie ingedeeld.",
    "price-increase": "Minstens één abonnement is duurder geworden.",
    overlap:
      "Minstens twee abonnementen zijn in dezelfde categorie ingedeeld en lopen naast elkaar.",
    "none-short-history": `Er zijn geen abonnementen herkend en er zijn minder dan ${PLAN_NUMBERS.subsDays} dagen aan gegevens.`,
  },
  labels: {
    perMonth: "Per maand",
    perYear: "Per jaar",
    monthsActive: "Maanden actief",
    usage: "Vastgelegd gebruik",
    total: "Totaal",
  },
  decisions: { keep: "Houden", review: "Bekijken", cancel: "Opzeggen" },
  priceUp: (row, fmt) =>
    row.priceChange === null
      ? null
      : `Prijs ${fmt.pct(row.priceChange.changePct)} hoger sinds ${fmt.date(row.priceChange.changeDate)}, van ${fmt.eurExact(row.priceChange.fromCents)} naar ${fmt.eurExact(row.priceChange.toCents)}.`,
  overlap: (count, functionLabel, combined) =>
    `${count} abonnementen voor ${functionLabel}: samen ${combined} per maand.`,
  noUseLogged: (yearly) => `Geen gebruik vastgelegd; ${yearly} per jaar.`,
  missedPayment: (cycles) =>
    cycles === 1 ? "Eén betaling is overgeslagen." : `${cycles} betalingen zijn overgeslagen.`,
  usageLine: (row, fmt) =>
    row.usage === "unknown"
      ? "Gebruik onbekend."
      : `Gebruik vastgelegd in ${row.usage.loggedMonths} maand${row.usage.loggedMonths === 1 ? "" : "en"}; ${fmt.eurExact(row.usage.costPerUseCents)} per keer.`,
  whatIf: (monthly, yearly) =>
    `Als je abonnementen als opzeggen markeert, scheelt dat ${monthly} per maand en ${yearly} per jaar. Er wordt niets opgezegd.`,
  manualAdd: "Een abonnement wordt herkend na meerdere betalingen met hetzelfde bedrag en ritme.",
  usageUnknown: "Onbekend gebruik",
  headline: (f, fmt) => (f.rows.length === 0 ? DASH : `${fmt.eur(f.totalMonthlyCents)} per maand`),
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.rows.length > 0)
        out.push(
          `${f.rows.length} abonnementen herkend: samen ${fmt.eur(f.totalMonthlyCents)} per maand, ${fmt.eur(f.totalYearlyCents)} per jaar.`,
        );
      for (const r of f.rows) {
        const p = nl.priceUp(r, fmt);
        if (p !== null) out.push(`${r.name}: ${p}`);
      }
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.rows.length > 0)
        out.push(
          `${f.rows.length} abonnementen herkend: samen ${fmt.eur(f.totalMonthlyCents)} per maand, ${fmt.eur(f.totalYearlyCents)} per jaar.`,
        );
      for (const r of f.rows) {
        const p = nl.priceUp(r, fmt);
        if (p !== null) out.push(`${r.name}: ${p}`);
        if (r.overlapGroup !== null && r.overlapCombinedMonthlyCents !== null)
          out.push(
            `${r.name}: loopt naast een ander abonnement; samen ${fmt.eur(r.overlapCombinedMonthlyCents)} per maand.`,
          );
        if (r.facts.includes("no-use-logged"))
          out.push(`${r.name}: ${nl.noUseLogged(fmt.eur(r.yearlyCents))}`);
        if (r.facts.includes("missed-payment"))
          out.push(`${r.name}: ${nl.missedPayment(r.skippedCycles)}`);
        if (r.usage !== "unknown") out.push(`${r.name}: ${nl.usageLine(r, fmt)}`);
      }
      if (f.whatIfCancelYearlyCents > 0)
        out.push(
          nl.whatIf(fmt.eur(f.whatIfCancelMonthlyCents), fmt.eur(f.whatIfCancelYearlyCents)),
        );
      out.push(`Gegevens over ${f.coverageDays} dagen.`);
      if (f.excludedForeignCount > 0)
        out.push(
          `${f.excludedForeignCount} terugkerende betalingen in een andere valuta zijn niet meegeteld.`,
        );
      return out;
    },
  },
  empty: {
    "history-90d": `Er zijn minder dan ${PLAN_NUMBERS.subsDays} dagen aan transacties. Een abonnement wordt pas herkend na meerdere betalingen met hetzelfde bedrag en ritme, dus er is niets herkend. Er is niets geschat.`,
  },
  howCalculated: {
    "sub-detect":
      "We zoeken terugkerende betalingen met hetzelfde bedrag en ritme in je persoonlijke rekeningen. Regels in een andere valuta en afbetalingen aan een geldverstrekker tellen niet mee.",
    "sub-totals": "Het bedrag per maand maal twaalf is het bedrag per jaar.",
    "price-change": `De prijsverandering is de laatste stap in het bedrag: de datum van de eerste betaling tegen de nieuwe prijs, de prijs ervoor en erna. Alleen verhogingen van minstens ${fmtNl.pct(PLAN_NUMBERS.priceIncreasePct)} en ${fmtNl.eurExact(PLAN_NUMBERS.priceIncreaseCents)} tellen.`,
    overlap:
      "Abonnementen in dezelfde categorie worden samen geteld; het totaal is hun bedragen per maand bij elkaar. De categorie is een indeling van LaVega; ze zegt niet dat de abonnementen hetzelfde doen.",
    "cost-per-use":
      "Kosten per keer is het bedrag per jaar gedeeld door het aantal maanden met vastgelegd gebruik.",
    "what-if-cancel":
      "Het bedrag dat je zou schelen als de abonnementen die jij als opzeggen hebt gemarkeerd stoppen. Er wordt niets opgezegd.",
  },
  education: [
    {
      conceptId: "recurring-payments",
      title: "Hoe worden abonnementen herkend?",
      body: "Een betaling met hetzelfde bedrag en dezelfde tussenpoos telt als terugkerend zodra ze meerdere keren is gezien.",
    },
  ],
};

const en: SubsCopy = {
  reasons: {
    clean:
      "No price increase was seen in the last twelve months and no two subscriptions are in the same category.",
    "price-increase": "At least one subscription became more expensive.",
    overlap: "At least two subscriptions are in the same category and run side by side.",
    "none-short-history": `No subscriptions were recognised and there are fewer than ${PLAN_NUMBERS.subsDays} days of data.`,
  },
  labels: {
    perMonth: "Per month",
    perYear: "Per year",
    monthsActive: "Months active",
    usage: "Usage",
    total: "Total",
  },
  decisions: { keep: "Keep", review: "Review", cancel: "Cancel" },
  priceUp: (row, fmt) =>
    row.priceChange === null
      ? null
      : `Price up ${fmt.pct(row.priceChange.changePct)} since ${fmt.date(row.priceChange.changeDate)}, from ${fmt.eurExact(row.priceChange.fromCents)} to ${fmt.eurExact(row.priceChange.toCents)}.`,
  overlap: (count, functionLabel, combined) =>
    `${count} ${functionLabel} subscriptions: together ${combined} a month.`,
  noUseLogged: (yearly) => `No use logged; ${yearly} a year.`,
  missedPayment: (cycles) =>
    cycles === 1 ? "One payment was skipped." : `${cycles} payments were skipped.`,
  usageLine: (row, fmt) =>
    row.usage === "unknown"
      ? "Use unknown."
      : `Use logged in ${row.usage.loggedMonths} month${row.usage.loggedMonths === 1 ? "" : "s"}; ${fmt.eurExact(row.usage.costPerUseCents)} per use.`,
  whatIf: (monthly, yearly) =>
    `If the subscriptions you marked as cancel stopped, that would be ${monthly} a month and ${yearly} a year less. Nothing is cancelled.`,
  manualAdd: "A subscription is recognised after several payments with the same amount and rhythm.",
  usageUnknown: "Usage unknown",
  headline: (f, fmt) => (f.rows.length === 0 ? DASH : `${fmt.eur(f.totalMonthlyCents)} a month`),
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.rows.length > 0)
        out.push(
          `${f.rows.length} subscriptions recognised: together ${fmt.eur(f.totalMonthlyCents)} a month, ${fmt.eur(f.totalYearlyCents)} a year.`,
        );
      for (const r of f.rows) {
        const p = en.priceUp(r, fmt);
        if (p !== null) out.push(`${r.name}: ${p}`);
      }
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.rows.length > 0)
        out.push(
          `${f.rows.length} subscriptions recognised: together ${fmt.eur(f.totalMonthlyCents)} a month, ${fmt.eur(f.totalYearlyCents)} a year.`,
        );
      for (const r of f.rows) {
        const p = en.priceUp(r, fmt);
        if (p !== null) out.push(`${r.name}: ${p}`);
        if (r.overlapGroup !== null && r.overlapCombinedMonthlyCents !== null)
          out.push(
            `${r.name}: runs beside another subscription; together ${fmt.eur(r.overlapCombinedMonthlyCents)} a month.`,
          );
        if (r.facts.includes("no-use-logged"))
          out.push(`${r.name}: ${en.noUseLogged(fmt.eur(r.yearlyCents))}`);
        if (r.facts.includes("missed-payment"))
          out.push(`${r.name}: ${en.missedPayment(r.skippedCycles)}`);
        if (r.usage !== "unknown") out.push(`${r.name}: ${en.usageLine(r, fmt)}`);
      }
      if (f.whatIfCancelYearlyCents > 0)
        out.push(
          en.whatIf(fmt.eur(f.whatIfCancelMonthlyCents), fmt.eur(f.whatIfCancelYearlyCents)),
        );
      out.push(`Data covers ${f.coverageDays} days.`);
      if (f.excludedForeignCount > 0)
        out.push(
          `${f.excludedForeignCount} recurring payments in another currency are not counted.`,
        );
      return out;
    },
  },
  empty: {
    "history-90d": `There are fewer than ${PLAN_NUMBERS.subsDays} days of transactions. A subscription is only recognised after several payments with the same amount and rhythm, so none has been recognised. Nothing has been estimated.`,
  },
  howCalculated: {
    "sub-detect":
      "We look for recurring payments with the same amount and rhythm in your personal accounts. Lines in another currency and repayments to a lender are left out.",
    "sub-totals": "The amount per month times twelve is the amount per year.",
    "price-change": `The price change is the last step in the amount: the date of the first payment at the new price, and the price before and after. Only increases of at least ${fmtEn.pct(PLAN_NUMBERS.priceIncreasePct)} and ${fmtEn.eurExact(PLAN_NUMBERS.priceIncreaseCents)} count.`,
    overlap:
      "Subscriptions in the same category are counted together; the total is their monthly amounts added up. The category is LaVega's own grouping; it does not say the subscriptions do the same thing.",
    "cost-per-use":
      "Cost per use is the amount per year divided by the number of months with logged use.",
    "what-if-cancel":
      "The amount that would be saved if the subscriptions you marked as cancel stopped. Nothing is cancelled.",
  },
  education: [
    {
      conceptId: "recurring-payments",
      title: "How are subscriptions recognised?",
      body: "A payment with the same amount and the same gap counts as recurring once it has been seen several times.",
    },
  ],
};

export const subscriptionsCopy: Record<Locale, SubsCopy> = { nl, en };
