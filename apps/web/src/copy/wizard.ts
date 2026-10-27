import type { WorkKind } from "@lavega/core";
import type { Locale } from "../locale.js";
import type { Section } from "../intake/wizard/screens.js";

/**
 * Every word the intake wizard adds on top of `intakeCopy`. Risk prompts and
 * the "invested" question are not repeated here: the wizard reuses
 * `intakeCopy[locale].block3.risk.items` and `.knowledge.invested`.
 * Info, not advice: `findAdviceLanguage` runs over all of it in wizard.test.ts.
 */
export type WizardCopy = {
  sections: Record<Section, string>;
  next: string;
  back: string;
  close: string;
  counter: (n: number, of: number) => string;
  saveFailed: string;
  estimateHint: string;
  noGoal: string;
  addChild: string;
  childYear: (n: number) => string;
  removeChild: (n: number) => string;
  questions: {
    household: string;
    children: string;
    childYears: string;
    income: (together: boolean) => string;
    spend: (together: boolean) => string;
    housing: (together: boolean) => string;
    savings: (together: boolean) => string;
    goal: string;
    debts: string;
    debtDetails: string;
    buffer: string;
    work: string;
    hasCards: (together: boolean) => string;
    cards: (together: boolean) => string;
    upload: string;
  };
  workKinds: Record<WorkKind, string>;
  spendUnknown: string;
  spendExact: string;
  spendBands: [string, string, string, string, string];
  cardSearch: string;
  cardNotFound: string;
  otherCard: string;
  /** Group name for brands the list does not know. */
  otherBrand: string;
  /** Badge on a brand tile: how many of its cards are picked. */
  cardsPicked: (n: number) => string;
  upload: {
    button: string;
    later: string;
    toPlan: string;
    imported: (n: number) => string;
    nothingNew: string;
    failed: string;
  };
  alone: string;
  together: string;
  yes: string;
  no: string;
  housingKinds: { rent: string; mortgage: string; other: string };
  bufferOption: (months: number) => string;
  purpose: string;
  target: string;
  date: string;
  lender: string;
  monthly: string;
  amountRequired: string;
  incomePositive: string;
  dateFuture: string;
};

export const wizardCopy: Record<Locale, WizardCopy> = {
  nl: {
    sections: { about: "Over jou", goals: "Doelen", risk: "Risico" },
    next: "Verder",
    back: "Terug",
    close: "Sluiten",
    counter: (n, of) => `${n} / ${of}`,
    saveFailed: "Opslaan lukte niet. Probeer het nog eens.",
    estimateHint: "Een schatting is goed",
    noGoal: "Nog geen doel",
    addChild: "Nog een kind",
    childYear: (n) => `Geboortejaar kind ${n}`,
    removeChild: (n) => `Verwijder kind ${n}`,
    questions: {
      household: "Woon je alleen of samen?",
      children: "Heb je kinderen?",
      childYears: "In welk jaar zijn ze geboren?",
      income: (t) =>
        t
          ? "Wat verdienen jullie samen netto per maand?"
          : "Wat verdien je netto per maand?",
      spend: (t) =>
        t
          ? "Hoeveel geven jullie samen ongeveer uit per maand?"
          : "Hoeveel geef je ongeveer uit per maand?",
      housing: (t) =>
        t
          ? "Huren of kopen jullie, en wat kost het per maand?"
          : "Huur of koop je, en wat kost het per maand?",
      savings: (t) =>
        t
          ? "Hoeveel spaargeld hebben jullie samen ongeveer?"
          : "Hoeveel spaargeld heb je ongeveer?",
      goal: "Waar spaar je voor?",
      debts: "Heb je schulden die we niet zien?",
      debtDetails: "Bij wie, en hoeveel los je per maand af?",
      buffer: "Hoeveel maanden buffer wil je achter de hand?",
      work: "Wat voor werk doe je?",
      hasCards: (t) => (t ? "Hebben jullie een creditcard?" : "Heb je een creditcard?"),
      cards: (t) => (t ? "Welke creditcards hebben jullie?" : "Welke creditcards heb je?"),
      upload: "Wil je je bankafschrift toevoegen?",
    },
    workKinds: {
      employed: "Loondienst",
      freelance: "Freelance / zzp",
      business: "Eigen bedrijf",
      student: "Student",
      jobseeking: "Werkzoekend",
      retired: "Met pensioen",
      other: "Anders",
    },
    spendUnknown: "Weet ik niet",
    spendExact: "Toch een bedrag invullen",
    spendBands: [
      "Minder dan €1.500",
      "€1.500 – €2.500",
      "€2.500 – €3.500",
      "€3.500 – €5.000",
      "Meer dan €5.000",
    ],
    cardSearch: "Zoek je kaart",
    cardNotFound: "Geen kaart gevonden",
    otherCard: "Een andere kaart",
    otherBrand: "Overige",
    cardsPicked: (n) => `${n} gekozen`,
    upload: {
      button: "Bankafschrift uploaden",
      later: "Later",
      toPlan: "Naar je plan",
      imported: (n) => `${n} transacties toegevoegd`,
      nothingNew: "Deze transacties stonden er al in.",
      failed: "Dit bestand konden we niet lezen.",
    },
    alone: "Alleen",
    together: "Samen",
    yes: "Ja",
    no: "Nee",
    housingKinds: { rent: "Huur", mortgage: "Hypotheek", other: "Anders" },
    bufferOption: (m) => (m === 1 ? "1 maand" : `${m} maanden`),
    purpose: "Waarvoor",
    target: "Streefbedrag",
    date: "Uiterlijk wanneer",
    lender: "Bij wie",
    monthly: "Aflossing per maand",
    amountRequired: "Vul een bedrag in.",
    incomePositive: "Vul een bedrag boven 0 in.",
    dateFuture: "Kies een datum in de toekomst.",
  },
  en: {
    sections: { about: "About you", goals: "Goals", risk: "Risk" },
    next: "Next",
    back: "Back",
    close: "Close",
    counter: (n, of) => `${n} / ${of}`,
    saveFailed: "Saving did not work. Please try again.",
    estimateHint: "An estimate is fine",
    noGoal: "No goal yet",
    addChild: "Add another child",
    childYear: (n) => `Birth year of child ${n}`,
    removeChild: (n) => `Remove child ${n}`,
    questions: {
      household: "Do you live alone or together?",
      children: "Do you have children?",
      childYears: "What year were they born?",
      income: (t) =>
        t
          ? "What do you earn together, net per month?"
          : "What do you earn, net per month?",
      spend: (t) =>
        t
          ? "About how much do you spend together per month?"
          : "About how much do you spend per month?",
      housing: (t) =>
        t
          ? "Do you rent or own, and what does it cost per month?"
          : "Do you rent or own, and what does it cost per month?",
      savings: (t) =>
        t
          ? "About how much savings do you have together?"
          : "About how much savings do you have?",
      goal: "What are you saving for?",
      debts: "Do you have debts we cannot see?",
      debtDetails: "Owed to whom, and how much do you pay off per month?",
      buffer: "How many months of buffer do you want in reserve?",
      work: "What kind of work do you do?",
      hasCards: (t) => (t ? "Do you have a credit card?" : "Do you have a credit card?"),
      cards: (t) => (t ? "Which credit cards do you have?" : "Which credit cards do you have?"),
      upload: "Do you want to add your bank statement?",
    },
    workKinds: {
      employed: "Employed",
      freelance: "Freelance / self-employed",
      business: "Own business",
      student: "Student",
      jobseeking: "Job seeking",
      retired: "Retired",
      other: "Other",
    },
    spendUnknown: "I don't know",
    spendExact: "Enter an amount instead",
    spendBands: [
      "Less than €1,500",
      "€1,500 – €2,500",
      "€2,500 – €3,500",
      "€3,500 – €5,000",
      "More than €5,000",
    ],
    cardSearch: "Search for your card",
    cardNotFound: "No card found",
    otherCard: "Another card",
    otherBrand: "Other",
    cardsPicked: (n) => `${n} selected`,
    upload: {
      button: "Upload bank statement",
      later: "Later",
      toPlan: "Go to your plan",
      imported: (n) => `${n} transactions added`,
      nothingNew: "These transactions were already in.",
      failed: "We could not read this file.",
    },
    alone: "Alone",
    together: "Together",
    yes: "Yes",
    no: "No",
    housingKinds: { rent: "Rent", mortgage: "Mortgage", other: "Other" },
    bufferOption: (m) => (m === 1 ? "1 month" : `${m} months`),
    purpose: "What for",
    target: "Target amount",
    date: "By when",
    lender: "Owed to",
    monthly: "Repayment per month",
    amountRequired: "Enter an amount.",
    incomePositive: "Enter an amount above 0.",
    dateFuture: "Pick a date in the future.",
  },
};
