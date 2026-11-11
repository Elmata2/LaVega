import type { Locale } from "../locale.js";
import type { BillFrequency, BillProblem, BillStatus, BillType } from "@lavega/core";

/* The bills screen's words, in both languages. Kept in its own module instead
 * of `copy/money.ts` so the (already large) money copy does not grow another
 * screen, and the nl/en shape is enforced by the shared `BillsCopy` type and
 * copy/parity.test.ts. */

export type BillsCopy = {
  title: string;
  intro: string;
  add: string;
  addTitle: string;
  editTitle: string;
  cancel: string;
  save: string;
  form: {
    name: string;
    namePlaceholder: string;
    amount: string;
    amountHint: string;
    cadence: string;
    firstDue: string;
    firstDueHint: string;
    account: string;
    accountNone: string;
    category: string;
    categoryNone: string;
    type: string;
    income: string;
    endMode: string;
    endNever: string;
    endOnDate: string;
    endAfterCount: string;
    endDate: string;
    endCount: string;
    notes: string;
    problems: Record<BillProblem, string>;
  };
  cadence: {
    weekly: (weekday: string) => string;
    everyWeeks: (n: number, weekday: string) => string;
    monthly: (day: string) => string;
    everyMonths: (n: number, day: string) => string;
    quarterly: (day: string) => string;
    twiceAYear: (day: string) => string;
    yearly: (day: string, month: string) => string;
    nthWeekday: (ordinal: string, weekday: string) => string;
    lastWeekday: (weekday: string) => string;
    lastDay: string;
  };
  summary: {
    toCover: string;
    toCoverHint: string;
    paid: string;
    paidHint: string;
    shortfall: string;
    shortfallAmount: (amount: string, payday: string) => string;
    enough: (amount: string, payday: string) => string;
    unknownCash: string;
    unknownPayday: string;
    due: string;
  };
  upcoming: {
    title: string;
    empty: string;
    emptyHint: string;
    horizon: (date: string) => string;
  };
  calendar: {
    title: string;
    previous: string;
    next: string;
    today: string;
    empty: string;
  };
  series: {
    title: string;
    empty: string;
    nextDue: (date: string) => string;
    paused: string;
    edit: string;
    pause: string;
    resume: string;
    end: string;
    ended: string;
  };
  history: {
    title: string;
    empty: string;
    emptyHint: string;
  };
  status: Record<BillStatus, string>;
  rowStatus: Record<"upcoming" | "due" | "overdue" | "paid" | "skipped" | "missed", string>;
  typeLabels: Record<BillType, string>;
  frequency: Record<BillFrequency, string>;
};

const nl: BillsCopy = {
  title: "Verplichtingen",
  intro:
    "Wat er de komende periode af moet, wat al betaald is, en wat er tekort is voor je volgende salaris.",
  add: "Nieuwe verplichting",
  addTitle: "Verplichting toevoegen",
  editTitle: "Verplichting aanpassen",
  cancel: "Annuleren",
  save: "Opslaan",
  form: {
    name: "Naam",
    namePlaceholder: "Huur, Spotify, sportschool…",
    amount: "Bedrag",
    amountHint: "Het bedrag dat je verwacht; latere betalingen kunnen afwijken.",
    cadence: "Hoe vaak",
    firstDue: "Eerste termijn",
    firstDueHint: "De eerstvolgende datum dat dit bedrag af moet.",
    account: "Rekening",
    accountNone: "Geen rekening",
    category: "Categorie",
    categoryNone: "Geen categorie",
    type: "Soort",
    income: "Dit is verwacht inkomen",
    endMode: "Einde",
    endNever: "Loopt door",
    endOnDate: "Tot een datum",
    endAfterCount: "Aantal termijnen",
    endDate: "Einddatum",
    endCount: "Aantal termijnen",
    notes: "Notitie",
    problems: {
      name: "Geef deze verplichting een naam.",
      amount: "Vul een bedrag in.",
      currency: "Kies een valuta.",
      anchor: "Kies een geldige eerste termijn.",
      rules: "Deze herhaling klopt niet.",
      interval: "Kies een geldige interval.",
      weekday: "Kies een geldige weekdag.",
      weekdayOrdinal: "Kies een geldige weekdag-positie.",
      monthOfYear: "Kies een geldige maand.",
      dayOfMonth: "Kies een geldige dag van de maand.",
      endOn: "Kies een geldige einddatum.",
      endAfterCount: "Vul een geldig aantal termijnen in.",
    },
  },
  cadence: {
    weekly: (weekday) => `Elke ${weekday}`,
    everyWeeks: (n, weekday) => `Elke ${n} weken op ${weekday}`,
    monthly: (day) => `Elke maand op de ${day}`,
    everyMonths: (n, day) => `Elke ${n} maanden op de ${day}`,
    quarterly: (day) => `Elk kwartaal op de ${day}`,
    twiceAYear: (day) => `Elke 6 maanden op de ${day}`,
    yearly: (day, month) => `Elk jaar op ${day} ${month}`,
    nthWeekday: (ordinal, weekday) => `Elke ${ordinal} ${weekday} van de maand`,
    lastWeekday: (weekday) => `Elke laatste ${weekday} van de maand`,
    lastDay: "laatste dag",
  },
  summary: {
    toCover: "Nog af te dekken",
    toCoverHint: "Openstaand en niet-betaald tot je volgende inkomst.",
    paid: "Betaald deze maand",
    paidHint: "Afgesloten termijnen in de laatste 31 dagen.",
    shortfall: "Voor je volgende inkomst",
    shortfallAmount: (amount, payday) => `Je komt ${amount} tekort voor ${payday}.`,
    enough: (amount, payday) => `Je saldo dekt het tot ${payday}; ${amount} over.`,
    unknownCash: "Geen saldo bekend, dus geen tekort te berekenen.",
    unknownPayday: "Geen inkomensreeks: voeg je salaris toe voor een tekort.",
    due: "Openstaand",
  },
  upcoming: {
    title: "Wat is er verschuldigd",
    empty: "Geen openstaande termijnen.",
    emptyHint: "Voeg je eerste verplichting toe; de termijnen verschijnen hier.",
    horizon: (date) => `Tot ${date}`,
  },
  calendar: {
    title: "Kalender",
    previous: "Vorige maand",
    next: "Volgende maand",
    today: "Vandaag",
    empty: "Geen termijnen deze maand.",
  },
  series: {
    title: "Reeksen",
    empty: "Nog geen verplichtingen.",
    nextDue: (date) => `Eerstvolgend: ${date}`,
    paused: "Gepauzeerd",
    edit: "Aanpassen",
    pause: "Pauzeren",
    resume: "Hervatten",
    end: "Beëindigen",
    ended: "Beëindigd",
  },
  history: {
    title: "Betaald",
    empty: "Nog geen afgesloten termijnen.",
    emptyHint: "Betaalmatchen komt met de betaalmatcher (#287).",
  },
  status: {
    suggested: "Voorgesteld",
    active: "Actief",
    paused: "Gepauzeerd",
    inactive: "Inactief",
    ended: "Beëindigd",
  },
  rowStatus: {
    upcoming: "Gepland",
    due: "Verschuldigd",
    overdue: "Te laat",
    paid: "Betaald",
    skipped: "Overgeslagen",
    missed: "Gemist",
  },
  typeLabels: {
    bill: "Rekening",
    subscription: "Abonnement",
    installment: "Termijnplan",
    income: "Inkomen",
    transfer: "Overboeking",
    other: "Overig",
  },
  frequency: {
    weekly: "Wekelijks",
    monthly: "Maandelijks",
    yearly: "Jaarlijks",
  },
};

const en: BillsCopy = {
  title: "Bills",
  intro: "What is due next, what is already paid, and what is short before your next payday.",
  add: "New bill",
  addTitle: "Add a bill",
  editTitle: "Edit bill",
  cancel: "Cancel",
  save: "Save",
  form: {
    name: "Name",
    namePlaceholder: "Rent, Spotify, gym…",
    amount: "Amount",
    amountHint: "The amount you expect; later payments can differ.",
    cadence: "How often",
    firstDue: "First payment",
    firstDueHint: "The next date this amount is due.",
    account: "Account",
    accountNone: "No account",
    category: "Category",
    categoryNone: "No category",
    type: "Kind",
    income: "This is expected income",
    endMode: "End",
    endNever: "Ongoing",
    endOnDate: "Until a date",
    endAfterCount: "Number of payments",
    endDate: "End date",
    endCount: "Payments",
    notes: "Note",
    problems: {
      name: "Give this bill a name.",
      amount: "Enter an amount.",
      currency: "Choose a currency.",
      anchor: "Choose a valid first payment date.",
      rules: "This recurrence is not valid.",
      interval: "Choose a valid interval.",
      weekday: "Choose a valid weekday.",
      weekdayOrdinal: "Choose a valid weekday position.",
      monthOfYear: "Choose a valid month.",
      dayOfMonth: "Choose a valid day of the month.",
      endOn: "Choose a valid end date.",
      endAfterCount: "Enter a valid number of payments.",
    },
  },
  cadence: {
    weekly: (weekday) => `Every ${weekday}`,
    everyWeeks: (n, weekday) => `Every ${n} weeks on ${weekday}`,
    monthly: (day) => `Every month on day ${day}`,
    everyMonths: (n, day) => `Every ${n} months on day ${day}`,
    quarterly: (day) => `Every quarter on day ${day}`,
    twiceAYear: (day) => `Every 6 months on day ${day}`,
    yearly: (day, month) => `Every year on ${day} ${month}`,
    nthWeekday: (ordinal, weekday) => `Every ${ordinal} ${weekday} of the month`,
    lastWeekday: (weekday) => `Every last ${weekday} of the month`,
    lastDay: "last day",
  },
  summary: {
    toCover: "Still to cover",
    toCoverHint: "Open and unpaid up to your next income.",
    paid: "Paid this month",
    paidHint: "Closed payments in the last 31 days.",
    shortfall: "Before your next income",
    shortfallAmount: (amount, payday) => `You are ${amount} short before ${payday}.`,
    enough: (amount, payday) => `Your balance covers it until ${payday}; ${amount} left.`,
    unknownCash: "No known balance, so no shortfall can be computed.",
    unknownPayday: "No income series: add your salary for a shortfall.",
    due: "Open",
  },
  upcoming: {
    title: "What is due",
    empty: "No open payments.",
    emptyHint: "Add your first bill; its payments appear here.",
    horizon: (date) => `Through ${date}`,
  },
  calendar: {
    title: "Calendar",
    previous: "Previous month",
    next: "Next month",
    today: "Today",
    empty: "No payments this month.",
  },
  series: {
    title: "Series",
    empty: "No bills yet.",
    nextDue: (date) => `Next: ${date}`,
    paused: "Paused",
    edit: "Edit",
    pause: "Pause",
    resume: "Resume",
    end: "End",
    ended: "Ended",
  },
  history: {
    title: "Paid",
    empty: "No closed payments yet.",
    emptyHint: "Payment matching lands with the matcher (#287).",
  },
  status: {
    suggested: "Suggested",
    active: "Active",
    paused: "Paused",
    inactive: "Inactive",
    ended: "Ended",
  },
  rowStatus: {
    upcoming: "Scheduled",
    due: "Due",
    overdue: "Late",
    paid: "Paid",
    skipped: "Skipped",
    missed: "Missed",
  },
  typeLabels: {
    bill: "Bill",
    subscription: "Subscription",
    installment: "Instalment plan",
    income: "Income",
    transfer: "Transfer",
    other: "Other",
  },
  frequency: {
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
  },
};

export const billsCopy: Record<Locale, BillsCopy> = { nl, en };
