import type { Locale } from "../../locale.js";
import type { ParseError } from "../../plan/sections/parse.js";

/**
 * The words around the figures a person types into the plan: labels, hints,
 * button names and the inline errors. Every input is the person's own figure;
 * nothing here suggests a value, and no input is filled in beforehand.
 * Neutral wording: what the field is, what it changes, nothing about what it
 * should be.
 */
export type AssumptionsCopy = {
  save: string;
  clear: string;
  remove: string;
  add: string;
  /** Plain line when the figure could not be stored. */
  saveFailed: string;
  errors: Record<ParseError, string>;
  /** Names the section shows for the group of its own figures. */
  groups: { yourFigures: string };
  buffer: {
    targetLabel: string;
    targetHint: string;
    topUpLabel: string;
    topUpHint: string;
    calcLabel: string;
    calcHint: string;
  };
  debts: {
    extraLabel: (lender: string) => string;
    extraHint: string;
    rateLabel: (lender: string) => string;
    rateHint: string;
    balanceLabel: (lender: string) => string;
    balanceHint: string;
  };
  spending: {
    limitLabel: (category: string) => string;
    limitHint: string;
    columns: { lastMonth: string; avg3: string; median: string; limit: string };
  };
  subs: {
    decisionGroup: (name: string) => string;
    usedThisMonth: string;
    usedLogged: string;
    foreignExcluded: (n: number) => string;
    /** Subscription function names as stored (Dutch) -> the reader's language. */
    functions: Record<string, string>;
    /** For a function name the table does not know. */
    otherFunction: string;
  };
  cards: {
    tableLabel: string;
    sortBy: (column: string) => string;
    held: string;
    asOf: (date: string) => string;
    noCards: string;
    redemption: {
      title: string;
      hint: string;
      program: string;
      points: string;
      cash: string;
      entry: (program: string, points: string, cash: string) => string;
      none: string;
    };
    expiry: { label: (program: string) => string; hint: string };
    program: (id: string) => string;
  };
  goals: {
    noRows: string;
    editTitle: (purpose: string) => string;
    linkLegend: string;
    linkAccount: (name: string, bank: string, currency: string) => string;
    unknownAccount: (key: string) => string;
    foreignNote: string;
    savedLabel: (purpose: string) => string;
    savedHint: string;
    monthlyLabel: (purpose: string) => string;
    monthlyHint: string;
    study: {
      title: string;
      hint: string;
      monthlyCost: string;
      months: string;
      tuition: string;
      inflation: string;
    };
  };
};

const errorsNl: Record<ParseError, string> = {
  required: "Vul een getal in.",
  number: "Dit is geen getal. Gebruik cijfers, eventueel met een komma of punt.",
  negative: "Een negatief getal is hier niet mogelijk.",
  zero: "Nul is hier geen invulling. Gebruik Wissen om een ingevulde waarde te verwijderen.",
  decimals: "Gebruik hooguit twee cijfers achter de komma.",
  tooLarge: "Dit bedrag is groter dan de grens van tien miljoen euro.",
  integer: "Gebruik een heel getal.",
  range: "Dit getal valt buiten het bereik dat hier kan.",
  date: "Gebruik een bestaande datum als jaar-maand-dag, bijvoorbeeld 2027-03-01.",
};
const errorsEn: Record<ParseError, string> = {
  required: "Enter a number.",
  number: "This is not a number. Use digits, with a comma or a point if needed.",
  negative: "A negative number is not possible here.",
  zero: "Zero is not an entry. Use Clear to remove a stored value.",
  decimals: "Use at most two digits after the decimal mark.",
  tooLarge: "This amount is above the limit of ten million euros.",
  integer: "Use a whole number.",
  range: "This number is outside the range that works here.",
  date: "Use a real date as year-month-day, for example 2027-03-01.",
};

const nl: AssumptionsCopy = {
  save: "Opslaan",
  clear: "Wissen",
  remove: "Verwijderen",
  add: "Toevoegen",
  saveFailed: "Het opslaan is niet gelukt. De waarde is niet bewaard.",
  errors: errorsNl,
  groups: { yourFigures: "Jouw cijfers" },
  buffer: {
    targetLabel: "Jouw streefwaarde voor de buffer, in maanden vaste lasten",
    targetHint: "Een getal van 0 tot en met 60, met hooguit één cijfer achter de komma.",
    topUpLabel: "Aantal maanden waarover je de buffer aanvult",
    topUpHint: "Een heel getal van 1 tot en met 120. Het telt mee in wat niet is toegewezen.",
    calcLabel: "Uitkomst van een rekenhulp voor een buffer voor grote kosten, in euro",
    calcHint: "Het bedrag dat een rekenhulp je gaf. LaVega rekent dit niet zelf uit.",
  },
  debts: {
    extraLabel: (lender) => `Extra per maand bij ${lender}, in euro`,
    extraHint: "Een bedrag bovenop je huidige betaling. Het laat zien wat dat verandert.",
    rateLabel: (lender) => `Rente per jaar bij ${lender}, in procent`,
    rateHint: "Het percentage uit de voorwaarden van de schuld, bijvoorbeeld 4,5.",
    balanceLabel: (lender) => `Openstaand bedrag bij ${lender}, in euro`,
    balanceHint: "Het bedrag dat nu nog openstaat.",
  },
  spending: {
    limitLabel: (category) => `Jouw grens voor ${category} per maand, in euro`,
    limitHint:
      "Je eigen bedrag per maand. Het wordt vergeleken met de uitgaven van de laatste maanden.",
    columns: {
      lastMonth: "Vorige maand",
      avg3: "Gem. 3 maanden",
      median: "Mediaan",
      limit: "Grens",
    },
  },
  subs: {
    decisionGroup: (name) => `Je eigen notitie bij ${name}`,
    usedThisMonth: "Deze maand gebruikt",
    usedLogged: "Deze maand vastgelegd",
    foreignExcluded: (n) => `${n} abonnement(en) in een andere valuta zijn niet meegeteld.`,
    functions: {
      Videostreaming: "videostreaming",
      Muziekstreaming: "muziekstreaming",
      Software: "software",
      "Mobiel abonnement": "een mobiel abonnement",
      Cloudopslag: "cloudopslag",
      Nieuws: "nieuws",
      Sportschool: "sportschool",
      Overig: "overige diensten",
    },
    otherFunction: "overige diensten",
  },
  cards: {
    tableLabel: "Kenmerken van kaarten uit de catalogus",
    sortBy: (column) => `Sorteer op ${column}`,
    held: "jouw kaart",
    asOf: (date) => `per ${date}`,
    noCards: "Er zijn geen kaarten om te tonen.",
    redemption: {
      title: "Je eigen inwisselvoorbeelden",
      hint: "Een keer dat je punten inwisselde: hoeveel punten en welk bedrag aan kosten het je scheelde. LaVega neemt zelf geen waarde per punt aan.",
      program: "Programma",
      points: "Punten ingewisseld",
      cash: "Prijs in euro die je daardoor niet betaalde",
      entry: (program, points, cash) => `${program}: ${points} punten voor ${cash}`,
      none: "Er zijn nog geen voorbeelden ingevuld.",
    },
    expiry: {
      label: (program) => `Datum waarop de punten van ${program} verlopen`,
      hint: "Als jaar-maand-dag.",
    },
    program: (id) => id,
  },
  goals: {
    noRows: "Er is nog geen doel ingevuld.",
    editTitle: (purpose) => `Je gegevens bij ${purpose}`,
    linkLegend: "Rekeningen die bij dit doel horen",
    linkAccount: (name, bank, currency) => `${name} (${bank}, ${currency})`,
    unknownAccount: (key) => `Een gekoppelde rekening die hier niet te tellen is (${key})`,
    foreignNote: "Rekeningen in een andere valuta tellen niet mee in het gespaarde bedrag.",
    savedLabel: (purpose) => `Gespaard voor ${purpose} tot nu toe, in euro`,
    savedHint: "Wordt gebruikt zolang er geen rekening aan dit doel is gekoppeld.",
    monthlyLabel: (purpose) => `Wat je per maand voor ${purpose} opzij wilt zetten, in euro`,
    monthlyHint: "Jouw eigen bedrag. Het telt mee in wat per maand niet is toegewezen.",
    study: {
      title: "Studiekosten van een kind, met jouw cijfers",
      hint: "Alle vier de velden zijn jouw eigen aannames over prijzen van nu. LaVega vult niets in.",
      monthlyCost: "Kosten per maand, in euro",
      months: "Aantal maanden",
      tuition: "Collegegeld in totaal, in euro",
      inflation: "Prijsstijging per jaar, in procent",
    },
  },
};

const en: AssumptionsCopy = {
  save: "Save",
  clear: "Clear",
  remove: "Remove",
  add: "Add",
  saveFailed: "Saving did not work. The value was not kept.",
  errors: errorsEn,
  groups: { yourFigures: "Your figures" },
  buffer: {
    targetLabel: "Your target for the buffer, in months of fixed costs",
    targetHint: "A number from 0 to 60, with at most one decimal.",
    topUpLabel: "Number of months over which you top up the buffer",
    topUpHint: "A whole number from 1 to 120. It counts in what is not allocated.",
    calcLabel: "Result from a calculator for a buffer for large costs, in euros",
    calcHint: "The amount a calculator gave you. LaVega does not work this out itself.",
  },
  debts: {
    extraLabel: (lender) => `Extra a month on ${lender}, in euros`,
    extraHint: "An amount on top of your current payment. It shows what that changes.",
    rateLabel: (lender) => `Rate per year on ${lender}, in percent`,
    rateHint: "The percentage from the terms of the debt, for example 4.5.",
    balanceLabel: (lender) => `Balance on ${lender}, in euros`,
    balanceHint: "The amount that is still owed now.",
  },
  spending: {
    limitLabel: (category) => `Your limit for ${category} a month, in euros`,
    limitHint: "Your own amount per month. It is compared with spending in the last months.",
    columns: { lastMonth: "Last month", avg3: "3-month avg.", median: "Median", limit: "Limit" },
  },
  subs: {
    decisionGroup: (name) => `Your own note on ${name}`,
    usedThisMonth: "Used this month",
    usedLogged: "Logged this month",
    foreignExcluded: (n) => `${n} subscription(s) in another currency are not counted.`,
    functions: {
      Videostreaming: "video streaming",
      Muziekstreaming: "music streaming",
      Software: "software",
      "Mobiel abonnement": "a mobile plan",
      Cloudopslag: "cloud storage",
      Nieuws: "news",
      Sportschool: "a gym",
      Overig: "other services",
    },
    otherFunction: "other services",
  },
  cards: {
    tableLabel: "Features of cards in the catalogue",
    sortBy: (column) => `Sort by ${column}`,
    held: "your card",
    asOf: (date) => `as of ${date}`,
    noCards: "There are no cards to show.",
    redemption: {
      title: "Your own redemption examples",
      hint: "A time you redeemed points: how many points, and the price you did not pay because of it. LaVega assumes no value per point itself.",
      program: "Program",
      points: "Points redeemed",
      cash: "Price in euros you did not pay because of it",
      entry: (program, points, cash) => `${program}: ${points} points for ${cash}`,
      none: "No examples have been entered yet.",
    },
    expiry: {
      label: (program) => `Date on which the points of ${program} expire`,
      hint: "As year-month-day.",
    },
    program: (id) => id,
  },
  goals: {
    noRows: "No goal has been entered yet.",
    editTitle: (purpose) => `Your details for ${purpose}`,
    linkLegend: "Accounts that belong to this goal",
    linkAccount: (name, bank, currency) => `${name} (${bank}, ${currency})`,
    unknownAccount: (key) => `A linked account that cannot be counted here (${key})`,
    foreignNote: "Accounts in another currency are not counted in the amount saved.",
    savedLabel: (purpose) => `Saved for ${purpose} so far, in euros`,
    savedHint: "Used as long as no account is linked to this goal.",
    monthlyLabel: (purpose) => `What you plan to set aside each month for ${purpose}, in euros`,
    monthlyHint: "Your own amount. It counts in what is not allocated each month.",
    study: {
      title: "A child's study costs, with your figures",
      hint: "All four fields are your own assumptions about today's prices. LaVega fills in nothing.",
      monthlyCost: "Cost per month, in euros",
      months: "Number of months",
      tuition: "Tuition in total, in euros",
      inflation: "Price rise per year, in percent",
    },
  },
};

export const assumptionsCopy: Record<Locale, AssumptionsCopy> = { nl, en };
