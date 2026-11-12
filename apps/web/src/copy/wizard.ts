import type {
  CardRepayment,
  CheckInCadence,
  CutTarget,
  FlightsPerYear,
  ForeignSpend,
  IncomeRegularity,
  MoneySharing,
  PointsGoal,
  Priority,
  SpendArea,
  WorkKind,
} from "@lavega/core";
import type { Locale } from "../locale.js";
import type { Section } from "../intake/wizard/screens.js";
import { BRAND_LABELS } from "../intake/wizard/cardOptions.js";
import type { DebitBrand } from "../intake/wizard/cardOptions.js";

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
  birthYearPlaceholder: string;
  /** Summary line label for the invested-before answer. */
  investedLabel: string;
  housingHint: string;
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
    vat: string;
    hasCards: (together: boolean) => string;
    cards: (together: boolean) => string;
    cardDetails: (together: boolean) => string;
    debitCards: (together: boolean) => string;
    upload: string;
    moneySharing: string;
    birthYear: string;
    incomeRegularity: string;
    banks: string;
    cardRepayment: string;
    spendMix: string;
    foreignSpend: string;
    priorities: string;
    summary: string;
    cutTargets: string;
    checkInCadence: string;
    confidence: string;
    programs: string;
    pointsGoal: string;
    flights: string;
  };
  moneySharing: Record<MoneySharing, string>;
  incomeRegularity: Record<IncomeRegularity, string>;
  cardRepayment: Record<CardRepayment, string>;
  spendAreas: Record<SpendArea, string>;
  foreignSpend: Record<ForeignSpend, string>;
  priorities: Record<Priority, string>;
  cutTargets: Record<CutTarget, string>;
  checkInCadence: Record<CheckInCadence, string>;
  confidence: Record<1 | 2 | 3 | 4, string>;
  pointsGoal: Record<PointsGoal, string>;
  flights: Record<FlightsPerYear, string>;
  /** Brand id (see cardOptions) to display name, plus `other`. */
  bankNames: Record<string, string>;
  noneCard: string;
  summaryEdit: string;
  spendMixHint: string;
  workKinds: Record<WorkKind, string>;
  spendUnknown: string;
  spendExact: string;
  spendBands: [string, string, string, string, string];
  cardSearch: string;
  cardNotFound: string;
  otherCard: string;
  otherDebitCard: string;
  /** Debit brand tile names (credit brand names are fixed in cardOptions). */
  debitBrands: Record<Exclude<DebitBrand, "other-brand">, string>;
  /** Group name for brands the list does not know. */
  otherBrand: string;
  /** Badge on a brand tile: how many of its cards are picked. */
  cardsPicked: (n: number) => string;
  /** The balance, paid-in-full, rate and points row per credit card. */
  cardDetails: {
    balance: string;
    paysInFull: string;
    payYes: string;
    payNo: string;
    rate: string;
    rateHint: string;
    points: (program: string) => string;
    pointsHint: string;
    skipHint: string;
    skip: string;
    unknownCard: string;
    errors: { balance: string; paysInFull: string; rate: string; points: string };
  };
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

/** Brand names, the same in both languages except the crypto group. */
const DEBIT_BRANDS: WizardCopy["debitBrands"] = {
  ing: "ING",
  abn: "ABN AMRO",
  rabo: "Rabobank",
  "sns-asn-regio": "SNS / ASN / RegioBank",
  triodos: "Triodos",
  knab: "Knab",
  bunq: "bunq",
  revolut: "Revolut",
  n26: "N26",
  wise: "Wise",
  openbank: "Openbank",
  "trade-republic": "Trade Republic",
  crypto: "Crypto (Bybit, Kraken, Plutus)",
};

const bankNames = (other: string, crypto: string): Record<string, string> => ({
  ...BRAND_LABELS,
  ...DEBIT_BRANDS,
  crypto,
  "other-brand": other,
  other,
});

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
    birthYearPlaceholder: "bijv. 1990",
    investedLabel: "Eerder belegd",
    housingHint: "Huur of hypotheek, met servicekosten",
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
          ? "Wat kost wonen jullie per maand?"
          : "Wat kost wonen je per maand?",
      savings: (t) =>
        t
          ? "Hoeveel spaargeld hebben jullie samen ongeveer?"
          : "Hoeveel spaargeld heb je ongeveer?",
      goal: "Waar spaar je voor?",
      debts: "Heb je schulden die we niet zien?",
      debtDetails: "Bij wie, en hoeveel los je per maand af?",
      buffer: "Hoeveel maanden buffer wil je achter de hand?",
      work: "Wat voor werk doe je?",
      vat: "Reken je btw aan je klanten?",
      hasCards: (t) => (t ? "Hebben jullie een creditcard?" : "Heb je een creditcard?"),
      cards: (t) => (t ? "Welke creditcards hebben jullie?" : "Welke creditcards heb je?"),
      cardDetails: (t) =>
        t ? "Wat staat er nu op jullie creditcards?" : "Wat staat er nu op je creditcards?",
      debitCards: (t) =>
        t ? "Welke betaalpassen hebben jullie?" : "Welke betaalpassen heb je?",
      upload: "Wil je je bankafschrift toevoegen?",
      moneySharing: "Delen jullie je geld?",
      birthYear: "In welk jaar ben je geboren?",
      incomeRegularity: "Is je inkomen elke maand gelijk?",
      banks: "Bij welke banken zit je?",
      cardRepayment: "Betaal je je creditcard elke maand helemaal af?",
      spendMix: "Waar gaat het meeste geld naartoe?",
      foreignSpend: "Betaal je weleens in het buitenland of in een andere valuta?",
      priorities: "Waar wil je dat LaVega je mee helpt?",
      summary: "Dit weet LaVega nu over je",
      cutTargets: "Waar wil je als eerste minder aan uitgeven?",
      checkInCadence: "Hoe vaak wil je dat LaVega je bijpraat?",
      confidence: "Hoeveel overzicht heb je nu over je geld?",
      programs: "Voor welke puntenprogramma's spaar je?",
      pointsGoal: "Waar spaar je je punten voor?",
      flights: "Hoeveel vliegreizen maak je per jaar?",
    },
    moneySharing: {
      shared: "Alles samen",
      separate: "Allebei apart",
      mixed: "Een deel samen",
    },
    incomeRegularity: { fixed: "Ja, elke maand hetzelfde", varies: "Nee, het wisselt" },
    cardRepayment: {
      full: "Ja, altijd helemaal",
      sometimes: "Soms niet helemaal",
      rarely: "Meestal niet helemaal",
    },
    spendAreas: {
      groceries: "Boodschappen",
      travel: "Reizen",
      online: "Online winkelen",
      fuel: "Brandstof en vervoer",
      "eating-out": "Uit eten",
      other: "Iets anders",
    },
    foreignSpend: { often: "Vaak", sometimes: "Soms", never: "Nooit" },
    priorities: {
      "spend-less": "Minder uitgeven",
      "save-more": "Meer sparen",
      "pay-off-debt": "Schulden aflossen",
      "cards-points": "Meer halen uit mijn kaarten en punten",
      subscriptions: "Abonnementen opruimen",
      children: "Geld voor mijn kinderen",
      "start-investing": "Uitleg over beleggen",
    },
    cutTargets: {
      groceries: "Boodschappen",
      travel: "Reizen",
      online: "Online winkelen",
      fuel: "Brandstof en vervoer",
      "eating-out": "Uit eten",
      other: "Iets anders",
      subscriptions: "Abonnementen",
    },
    checkInCadence: {
      daily: "Elke dag",
      weekly: "Elke week",
      "when-it-matters": "Alleen als er iets speelt",
    },
    confidence: {
      1: "Ik heb geen overzicht",
      2: "Ik heb weinig overzicht",
      3: "Ik heb redelijk overzicht",
      4: "Ik heb alles onder controle",
    },
    pointsGoal: {
      flights: "Vluchten",
      upgrades: "Upgrades",
      shopping: "Winkelen",
      cashback: "Geld terug",
      "no-preference": "Geen voorkeur",
    },
    flights: { "0": "Geen", "1-2": "1 tot 2", "3-5": "3 tot 5", "6+": "6 of meer" },
    bankNames: bankNames("Overige", "Bybit, Kraken of Plutus"),
    noneCard: "Ik heb er geen",
    summaryEdit: "Wijzig",
    spendMixHint: "Kies er maximaal 3",
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
    otherDebitCard: "Een andere pas",
    debitBrands: DEBIT_BRANDS,
    otherBrand: "Overige",
    cardsPicked: (n) => `${n} gekozen`,
    cardDetails: {
      balance: "Openstaand saldo",
      paysInFull: "Betaal je het saldo elke maand helemaal af?",
      payYes: "Ja, elke maand",
      payNo: "Nee, een deel blijft staan",
      rate: "Rente op het openstaande saldo (% per jaar)",
      rateHint: "Weet je de rente niet? Laat dit leeg. Er wordt dan niets geschat.",
      points: (program) => `Puntensaldo ${program}`,
      pointsHint: "Het saldo uit je Amex-app of online account.",
      skipHint: "Laat een kaart leeg om die over te slaan.",
      skip: "Overslaan",
      unknownCard: "Onbekende kaart",
      errors: {
        balance: "Vul een bedrag in, bijvoorbeeld 1500.",
        paysInFull: "Kies of je het saldo elke maand helemaal afbetaalt.",
        rate: "Vul een percentage in, bijvoorbeeld 14,9.",
        points: "Vul een aantal punten in, bijvoorbeeld 12500.",
      },
    },
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
    birthYearPlaceholder: "e.g. 1990",
    investedLabel: "Invested before",
    housingHint: "Rent or mortgage, including service costs",
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
          ? "What does housing cost the two of you per month?"
          : "What does housing cost you per month?",
      savings: (t) =>
        t
          ? "About how much savings do you have together?"
          : "About how much savings do you have?",
      goal: "What are you saving for?",
      debts: "Do you have debts we cannot see?",
      debtDetails: "Owed to whom, and how much do you pay off per month?",
      buffer: "How many months of buffer do you want in reserve?",
      work: "What kind of work do you do?",
      vat: "Do you charge your clients VAT?",
      hasCards: (t) => (t ? "Do you have a credit card?" : "Do you have a credit card?"),
      cards: (t) => (t ? "Which credit cards do you have?" : "Which credit cards do you have?"),
      cardDetails: (t) =>
        t ? "What is on your credit cards right now?" : "What is on your credit cards right now?",
      debitCards: (t) => (t ? "Which debit cards do you have?" : "Which debit cards do you have?"),
      upload: "Do you want to add your bank statement?",
      moneySharing: "Do you share your money?",
      birthYear: "What year were you born?",
      incomeRegularity: "Is your income the same every month?",
      banks: "Which banks are you with?",
      cardRepayment: "Do you pay off your credit card in full every month?",
      spendMix: "Where does most of your money go?",
      foreignSpend: "Do you ever pay abroad or in another currency?",
      priorities: "What do you want LaVega to help you with?",
      summary: "This is what LaVega knows about you now",
      cutTargets: "Where do you want to spend less first?",
      checkInCadence: "How often do you want LaVega to check in with you?",
      confidence: "How much of an overview do you have of your money right now?",
      programs: "Which points programmes do you collect in?",
      pointsGoal: "What are you collecting points for?",
      flights: "How many flights do you take per year?",
    },
    moneySharing: {
      shared: "Shared",
      separate: "Separate",
      mixed: "Partly shared",
    },
    incomeRegularity: { fixed: "Yes, the same every month", varies: "No, it varies" },
    cardRepayment: {
      full: "Yes, always in full",
      sometimes: "Sometimes not in full",
      rarely: "Usually not in full",
    },
    spendAreas: {
      groceries: "Groceries",
      travel: "Travel",
      online: "Online shopping",
      fuel: "Fuel and transport",
      "eating-out": "Eating out",
      other: "Something else",
    },
    foreignSpend: { often: "Often", sometimes: "Sometimes", never: "Never" },
    priorities: {
      "spend-less": "Spend less",
      "save-more": "Save more",
      "pay-off-debt": "Pay off debt",
      "cards-points": "Get more from my cards and points",
      subscriptions: "Clear out subscriptions",
      children: "Money for my children",
      "start-investing": "Learn how investing works",
    },
    cutTargets: {
      groceries: "Groceries",
      travel: "Travel",
      online: "Online shopping",
      fuel: "Fuel and transport",
      "eating-out": "Eating out",
      other: "Something else",
      subscriptions: "Subscriptions",
    },
    checkInCadence: {
      daily: "Every day",
      weekly: "Every week",
      "when-it-matters": "Only when something comes up",
    },
    confidence: {
      1: "I have no overview",
      2: "I have a bit of an overview",
      3: "I have a fair overview",
      4: "I have everything under control",
    },
    pointsGoal: {
      flights: "Flights",
      upgrades: "Upgrades",
      shopping: "Shopping",
      cashback: "Cashback",
      "no-preference": "No preference",
    },
    flights: { "0": "None", "1-2": "1 to 2", "3-5": "3 to 5", "6+": "6 or more" },
    bankNames: bankNames("Other", "Bybit, Kraken or Plutus"),
    noneCard: "I have none",
    summaryEdit: "Change",
    spendMixHint: "Pick up to 3",
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
    otherDebitCard: "Another card",
    debitBrands: DEBIT_BRANDS,
    otherBrand: "Other",
    cardsPicked: (n) => `${n} selected`,
    cardDetails: {
      balance: "Outstanding balance",
      paysInFull: "Do you pay the balance in full every month?",
      payYes: "Yes, every month",
      payNo: "No, part of it stays",
      rate: "Interest on the outstanding balance (% a year)",
      rateHint: "Do not know the rate? Leave it empty. Nothing will be estimated.",
      points: (program) => `Points balance ${program}`,
      pointsHint: "The balance from your Amex app or online account.",
      skipHint: "Leave a card empty to skip it.",
      skip: "Skip",
      unknownCard: "Unknown card",
      errors: {
        balance: "Enter an amount, for example 1500.",
        paysInFull: "Choose whether you pay the balance in full every month.",
        rate: "Enter a percentage, for example 14.9.",
        points: "Enter a number of points, for example 12500.",
      },
    },
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
