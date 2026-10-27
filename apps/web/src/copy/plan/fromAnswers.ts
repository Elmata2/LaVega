import type { Locale } from "../../locale.js";

/**
 * "From your answers": what the person told the intake, set beside what their
 * accounts show, plus the two notes about how work type changes a reading.
 * Two values are shown side by side with explicit labels and no sentence
 * compares them: a stated figure may cover a household while the imported
 * accounts cover one person.
 */
export type FromAnswersCopy = {
  title: string;
  household: { alone: string; together: string };
  children: (n: number, years: string) => string;
  noChildren: string;
  workLabel: string;
  rows: { income: string; spend: string };
  statedAlone: string;
  statedTogether: string;
  measured: { income: string; spend: string };
  /** With a household of two: the accounts imported may not be all of theirs. */
  togetherPartial: string;
  measuredIn: (month: string) => string;
  measuredOne: (month: string) => string;
  shortHistory: string;
  measuredMean: (months: string) => string;
  notStated: string;
  noBankData: string;
  importLink: string;
  change: string;
  notes: { month: string; buffer: string };
};

const nl: FromAnswersCopy = {
  title: "Uit je antwoorden",
  household: { alone: "Alleen", together: "Samen" },
  children: (n, years) =>
    n === 1 ? `1 kind (geboortejaar ${years})` : `${n} kinderen (geboortejaren ${years})`,
  noChildren: "Geen kinderen",
  workLabel: "Werk",
  rows: { income: "Netto inkomen per maand", spend: "Uitgaven per maand" },
  statedAlone: "opgegeven",
  statedTogether: "opgegeven, voor jullie samen",
  measured: {
    income: "binnengekomen op je gekoppelde rekeningen",
    spend: "uitgegeven op je gekoppelde rekeningen",
  },
  togetherPartial: "Staan niet al jullie rekeningen in LaVega, dan is dit bedrag lager.",
  measuredIn: (month) => `middelste maand: ${month}`,
  measuredOne: (month) => `maand: ${month}`,
  shortHistory: "Te weinig historie: nog geen drie volle maanden",
  measuredMean: (months) => `gemiddelde van ${months}`,
  notStated: "niet opgegeven",
  noBankData: "Nog geen rekeningen gekoppeld of geïmporteerd",
  importLink: "Importeren in Profiel",
  change: "Wijzig",
  notes: {
    month:
      "Je gaf aan dat je (ook) als zzp'er of ondernemer werkt. Inkomstenbelasting en btw die je zelf afdraagt, zitten niet apart in deze cijfers.",
    buffer:
      "Je gaf aan dat een deel van je inkomen kan wisselen. Je buffer is hier gemeten in maanden vaste lasten.",
  },
};

const en: FromAnswersCopy = {
  title: "From your answers",
  household: { alone: "Alone", together: "Together" },
  children: (n, years) => (n === 1 ? `1 child (born ${years})` : `${n} children (born ${years})`),
  noChildren: "No children",
  workLabel: "Work",
  rows: { income: "Net income per month", spend: "Spending per month" },
  statedAlone: "stated",
  statedTogether: "stated, for the two of you together",
  measured: {
    income: "received on your linked accounts",
    spend: "spent on your linked accounts",
  },
  togetherPartial: "If not all your accounts are in LaVega, this amount is lower.",
  measuredIn: (month) => `middle month: ${month}`,
  measuredOne: (month) => `month: ${month}`,
  shortHistory: "Not enough history yet: fewer than three full months",
  measuredMean: (months) => `average of ${months}`,
  notStated: "not stated",
  noBankData: "No accounts connected or imported yet",
  importLink: "Import in Profile",
  change: "Change",
  notes: {
    month:
      "You said you also work as a freelancer or business owner. Income tax and VAT you pay yourself are not shown separately in these figures.",
    buffer:
      "You said part of your income can vary. Your buffer here is measured in months of fixed costs.",
  },
};

export const fromAnswersCopy: Record<Locale, FromAnswersCopy> = { nl, en };
