import type {
  BufferFlatId,
  CardsFlatId,
  DebtsFlatId,
  GoalsFlatId,
  MissingAction,
  MissingKind,
  PlanChangeReasonKey,
  MonthFlatId,
  PlanStatus,
  SectionId,
  SpendingFlatId,
  SubsFlatId,
} from "@lavega/core";
import type { Locale } from "../../locale.js";
import { PLAN_NUMBERS, type FactSlot } from "./shared.js";

export type { PlanFmt } from "./shared.js";

/** Every key a section puts in `flat`: the change log names each one. */
export type FlatId =
  | BufferFlatId
  | CardsFlatId
  | DebtsFlatId
  | GoalsFlatId
  | MonthFlatId
  | SpendingFlatId
  | SubsFlatId;

/**
 * The frame of the plan page: title, header, backbone strip, change log,
 * footer, status chips, the names of missing inputs and their actions.
 *
 * Information and education only. No sentence here tells the reader what to do
 * with their money, names a product, ranks, or calls anything best or safe.
 * The backbone sentence is general education shown identically to everyone;
 * its source line renders only when the AFM fact is verified.
 */
export type PlanShellCopy = {
  title: string;
  navLabel: string;
  header: {
    planDate: (date: string) => string;
    /** Both dates arrive formatted, or null when unknown. */
    freshness: (bankTo: string | null, profileAt: string | null) => string;
    knowsLink: string;
    assumptionsLink: string;
  };
  backbone: {
    /** Neutral while the AFM text is unverified: names the four parts only. */
    heading: string;
    neutral: string;
    sourceFactId: "afm-backbone";
    /** The whole sentence about the order comes from the verified AFM fact
     *  and from nowhere else. Null while the fact is not showable. */
    fromFact: FactSlot;
    steps: Record<
      "buffer" | "debt" | "goals" | "investing",
      { label: string; fact: (figure: string) => string; empty: string }
    >;
  };
  changes: {
    heading: string;
    /** The heading says which plan the live one is compared with. */
    headingSinceMonth: (monthLabel: string) => string;
    headingSinceFirst: string;
    none: string;
    firstPlan: string;
    statusChange: (old: string, next: string) => string;
    line: (label: string, before: string, after: string) => string;
    reasons: Record<PlanChangeReasonKey, (p: Record<string, string | number>) => string>;
  };
  footer: {
    notice: string;
    computedAt: (time: string) => string;
    recompute: string;
  };
  status: Record<PlanStatus, { word: string; symbol: string }>;
  /** What is missing, by name. The section copy adds the full empty state. */
  missing: Record<MissingKind, string>;
  /** The one action an empty state offers. */
  actions: Record<MissingAction, string>;
  invitation: { sentence: string; start: string };
  sectionTitles: Record<SectionId, string>;
  cardParts: {
    figures: string;
    assumptions: string;
    explanation: string;
    howCalculated: string;
    sources: string;
  };
  explainControls: {
    simpler: string;
    moreDetail: string;
    helped: string;
    notHelped: string;
  };
  /** Shown wherever a figure is missing. */
  noFigure: string;
  /** Plain error lines; no action, no blame. */
  errors: { write: string; state: string; recompute: string };
  /** Neutral names of the figures the change log compares. */
  figureLabels: Record<FlatId, string>;
};

const nl: PlanShellCopy = {
  title: "Jouw plan",
  navLabel: "Jouw plan",
  header: {
    planDate: (date) => `Plan per ${date}`,
    freshness: (bankTo, profileAt) => {
      const parts: string[] = [];
      parts.push(bankTo === null ? "geen bankgegevens" : `bankgegevens tot ${bankTo}`);
      parts.push(
        profileAt === null ? "profiel nog niet bevestigd" : `profiel bevestigd op ${profileAt}`,
      );
      return parts.join("; ");
    },
    knowsLink: "Wat LaVega weet",
    assumptionsLink: "Aannames",
  },
  backbone: {
    heading: "Vier onderdelen",
    neutral:
      "Deze pagina laat cijfers zien bij vier onderdelen: buffer, schulden, doelen en wat er niet is toegewezen.",
    sourceFactId: "afm-backbone",
    fromFact: (value, source) => `${value} (${source})`,
    steps: {
      buffer: {
        label: "Buffer",
        fact: (figure) => `Buffer: ${figure} aan vaste lasten`,
        empty: "Buffer: nog niet te berekenen",
      },
      debt: {
        label: "Schulden",
        fact: (figure) => `Rente op schulden: ${figure} per jaar`,
        empty: "Schulden: nog niet te berekenen",
      },
      goals: {
        label: "Doelen",
        fact: (figure) => `Doelen: ${figure}`,
        empty: "Doelen: nog niet te berekenen",
      },
      investing: {
        label: "Niet toegewezen",
        fact: (figure) => `Niet toegewezen per maand: ${figure}`,
        empty: "Niet toegewezen per maand: nog niet te berekenen",
      },
    },
  },
  changes: {
    heading: "Wat is er veranderd",
    headingSinceMonth: (m) => `Wat is er veranderd sinds ${m}`,
    headingSinceFirst: "Wat is er veranderd sinds je eerste plan van deze maand",
    none: "Er is niets veranderd.",
    firstPlan: "Dit is je eerste plan. Er is nog niets om mee te vergelijken.",
    statusChange: (old, next) => `De status ging van ${old} naar ${next}.`,
    line: (label, before, after) => `${label}: ${before} naar ${after}`,
    reasons: {
      "income-stream-changed": () => "Je inkomsten zijn veranderd.",
      "price-increase-flagged": () => "Er is een nieuwe prijsverhoging bij een abonnement gezien.",
      "goal-date-near": () => "De datum van een doel is binnen twaalf maanden gekomen.",
      "buffer-below-wish": () => "De buffer is onder je eigen streefwaarde gekomen.",
      "debt-added": () => "Er is een schuld bijgekomen.",
      "child-added": () => "Er is een kind bijgekomen in je profiel.",
      "card-added": () => "Er is een kaart bijgekomen.",
      "points-added": () => "Er is een puntenprogramma bijgekomen.",
      "profile-edited": () => "Je profiel is aangepast.",
      "figure-changed": () => "Het cijfer is anders dan de vorige keer.",
    },
  },
  footer: {
    notice:
      "Deze pagina geeft informatie en uitleg. Het is geen financieel advies en LaVega kiest geen producten voor je.",
    computedAt: (time) => `Laatst berekend op ${time}`,
    recompute: "Nu opnieuw berekenen",
  },
  status: {
    "on-track": { word: "Op schema", symbol: "✓" },
    attention: { word: "Aandacht", symbol: "!" },
    "not-enough-data": { word: "Te weinig gegevens", symbol: "?" },
  },
  missing: {
    "bank-data": "Banktransacties",
    "history-60d": `Minstens ${PLAN_NUMBERS.historyDays} dagen transacties`,
    "history-90d": `Minstens ${PLAN_NUMBERS.subsDays} dagen transacties`,
    "history-6m": `Minstens ${PLAN_NUMBERS.spendingMonths} volle maanden transacties`,
    "savings-balance": "Een spaarsaldo",
    "fixed-costs": "Vaste lasten",
    "buffer-target": "Je eigen streefbuffer",
    "debt-rate": "De rente van een schuld",
    "debt-balance": "Het openstaande bedrag van een schuld",
    debts: "Het antwoord op de vraag naar schulden",
    "account-stale": "Recente gegevens van een rekening",
    cards: "Een kaart",
    "cardable-spend": "Uitgaven die met een kaart te betalen zijn",
    goals: "Een doel",
    "goal-date": "De einddatum van een doel",
    room: "Je ruimte per maand",
    "stated-range": "Je inkomen als bereik",
  },
  actions: {
    "connect-bank": "Koppel een bank",
    import: "Importeer een afschrift",
    "intake-question": "Beantwoord de vraag bij Wat LaVega weet",
    "enter-figure": "Vul het cijfer in",
  },
  invitation: {
    sentence:
      "Je plan laat zeven onderdelen zien: je maand, buffer, schulden, uitgaven, abonnementen, kaarten en doelen. Het gebruikt wat je invult en je bankgegevens.",
    start: "Begin met de vragen",
  },
  sectionTitles: {
    month: "Je maand",
    buffer: "Buffer",
    debts: "Schulden",
    spending: "Uitgaven per categorie",
    subscriptions: "Abonnementen",
    cards: "Kaarten en punten",
    goals: "Doelen",
  },
  cardParts: {
    figures: "Cijfers",
    assumptions: "Jouw aannames",
    explanation: "Uitleg",
    howCalculated: "Zo is het berekend",
    sources: "Bronnen",
  },
  explainControls: {
    simpler: "Simpeler",
    moreDetail: "Meer detail",
    helped: "Dit hielp",
    notHelped: "Dit hielp niet",
  },
  noFigure: "–",
  errors: {
    write: "Opslaan lukte niet. Het plan is teruggezet naar wat is opgeslagen.",
    state:
      "Het opgeslagen plan kon niet worden gelezen. Het blijft ongewijzigd en er wordt niets nieuws in opgeslagen.",
    recompute: "Opnieuw berekenen lukte niet.",
  },
  figureLabels: {
    buffer_months: "Buffer in maanden aan vaste lasten",
    buffer_gap_cents: "Verschil met je streefbuffer",
    cards_held_count: "Aantal kaarten",
    cards_cardable_spend: "Uitgaven die met een kaart te betalen zijn",
    cards_months: "Maanden met kaartuitgaven",
    cards_foreign_excluded: "Kaartregels in een andere valuta, niet meegeteld",
    cards_in_use_net: "Netto van de kaart die je gebruikt",
    debt_count: "Aantal schulden",
    debt_interest_year_total: "Rente op schulden per jaar",
    savings_interest_pct: "Rente op je spaargeld",
    goals_count: "Aantal doelen",
    goals_within_12m: "Doelen binnen twaalf maanden",
    unallocated_low: "Niet toegewezen per maand, laag",
    unallocated_high: "Niet toegewezen per maand, hoog",
    capacity_score: "Draagkracht uit je cijfers (1-5)",
    tolerance_score: "Risicotolerantie uit je antwoorden (1-5)",
    room_middle: "Ruimte per maand, middelste maand",
    room_low: "Ruimte per maand, laagste maand",
    room_high: "Ruimte per maand, hoogste maand",
    income_middle: "Inkomen per maand, middelste maand",
    fixed_share: "Aandeel vaste lasten in je inkomen",
    savings_rate: "Spaarquote",
    spend_months: "Maanden met uitgaven",
    spend_first_month: "Eerste maand met uitgaven",
    spend_last_month: "Laatste maand met uitgaven",
    spend_foreign_excluded: "Uitgaven in een andere valuta, niet meegeteld",
    spend_last_month_total: "Uitgaven in de laatste maand",
    spend_categories_over_limit: "Categorieën boven je eigen grens",
    sub_count: "Aantal abonnementen",
    sub_total_month: "Abonnementen per maand",
    sub_total_year: "Abonnementen per jaar",
    sub_whatif_year: "Abonnementen per jaar zonder de gemarkeerde",
    sub_coverage_days: "Dagen aan transacties voor abonnementen",
    sub_foreign_excluded: "Abonnementen in een andere valuta, niet meegeteld",
    sub_fixed_excluded: "Vaste lasten die geen abonnement zijn, niet meegeteld",
  },
};

const en: PlanShellCopy = {
  title: "Your plan",
  navLabel: "Your plan",
  header: {
    planDate: (date) => `Plan as of ${date}`,
    freshness: (bankTo, profileAt) => {
      const parts: string[] = [];
      parts.push(bankTo === null ? "no bank data" : `bank data to ${bankTo}`);
      parts.push(
        profileAt === null ? "profile not confirmed yet" : `profile confirmed ${profileAt}`,
      );
      return parts.join("; ");
    },
    knowsLink: "What LaVega knows",
    assumptionsLink: "Assumptions",
  },
  backbone: {
    heading: "Four parts",
    neutral: "This page shows figures for four parts: buffer, debt, goals and what is left over.",
    sourceFactId: "afm-backbone",
    fromFact: (value, source) => `${value} (${source})`,
    steps: {
      buffer: {
        label: "Buffer",
        fact: (figure) => `Buffer: ${figure} of fixed costs`,
        empty: "Buffer: cannot be calculated yet",
      },
      debt: {
        label: "Debt",
        fact: (figure) => `Debt interest: ${figure} a year`,
        empty: "Debt interest: cannot be calculated yet",
      },
      goals: {
        label: "Goals",
        fact: (figure) => `Goals: ${figure}`,
        empty: "Goals: cannot be calculated yet",
      },
      investing: {
        label: "Left over",
        fact: (figure) => `Not allocated each month: ${figure}`,
        empty: "Not allocated each month: cannot be calculated yet",
      },
    },
  },
  changes: {
    heading: "What changed",
    headingSinceMonth: (m) => `What changed since ${m}`,
    headingSinceFirst: "What changed since your first plan this month",
    none: "Nothing has changed.",
    firstPlan: "This is your first plan. There is nothing to compare it with yet.",
    statusChange: (old, next) => `The status went from ${old} to ${next}.`,
    line: (label, before, after) => `${label}: ${before} to ${after}`,
    reasons: {
      "income-stream-changed": () => "Your income changed.",
      "price-increase-flagged": () => "A new price increase was seen on a subscription.",
      "goal-date-near": () => "A goal's date came within twelve months.",
      "buffer-below-wish": () => "The buffer dropped below your own target.",
      "debt-added": () => "A debt was added.",
      "child-added": () => "A child was added to your profile.",
      "card-added": () => "A card was added.",
      "points-added": () => "A points programme was added.",
      "profile-edited": () => "Your profile was edited.",
      "figure-changed": () => "The figure differs from last time.",
    },
  },
  footer: {
    notice:
      "This page gives information and education. It is not financial advice, and LaVega does not choose products for you.",
    computedAt: (time) => `Last calculated ${time}`,
    recompute: "Recalculate now",
  },
  status: {
    "on-track": { word: "On track", symbol: "✓" },
    attention: { word: "Attention", symbol: "!" },
    "not-enough-data": { word: "Not enough data", symbol: "?" },
  },
  missing: {
    "bank-data": "Bank transactions",
    "history-60d": `At least ${PLAN_NUMBERS.historyDays} days of transactions`,
    "history-90d": `At least ${PLAN_NUMBERS.subsDays} days of transactions`,
    "history-6m": `At least ${PLAN_NUMBERS.spendingMonths} full months of transactions`,
    "savings-balance": "A savings balance",
    "fixed-costs": "Fixed costs",
    "buffer-target": "Your own buffer target",
    "debt-rate": "The interest rate of a debt",
    "debt-balance": "The balance of a debt",
    debts: "The answer to the question about debts",
    "account-stale": "Recent data from an account",
    cards: "A card",
    "cardable-spend": "Spending that fits on a card",
    goals: "A goal",
    "goal-date": "The end date of a goal",
    room: "Your room each month",
    "stated-range": "Your income as a range",
  },
  actions: {
    "connect-bank": "Connect a bank",
    import: "Import a statement",
    "intake-question": "Answer the question in What LaVega knows",
    "enter-figure": "Enter the figure",
  },
  invitation: {
    sentence:
      "Your plan shows seven parts: your month, buffer, debts, spending, subscriptions, cards and goals. It uses what you enter and your bank data.",
    start: "Start with the questions",
  },
  sectionTitles: {
    month: "Your month",
    buffer: "Buffer",
    debts: "Debts",
    spending: "Spending per category",
    subscriptions: "Subscriptions",
    cards: "Cards and points",
    goals: "Goals",
  },
  cardParts: {
    figures: "Figures",
    assumptions: "Your assumptions",
    explanation: "Explanation",
    howCalculated: "How we calculated this",
    sources: "Sources",
  },
  explainControls: {
    simpler: "Simpler",
    moreDetail: "More detail",
    helped: "This helped",
    notHelped: "This did not help",
  },
  noFigure: "–",
  errors: {
    write: "Saving did not work. The plan was set back to what is stored.",
    state:
      "The stored plan could not be read. It is left unchanged and nothing new is saved to it.",
    recompute: "Recalculating did not work.",
  },
  figureLabels: {
    buffer_months: "Buffer in months of fixed costs",
    buffer_gap_cents: "Difference from your buffer target",
    cards_held_count: "Number of cards",
    cards_cardable_spend: "Spending that fits on a card",
    cards_months: "Months of card spending",
    cards_foreign_excluded: "Card lines in another currency, not counted",
    cards_in_use_net: "Net of the card you use",
    debt_count: "Number of debts",
    debt_interest_year_total: "Interest on debts per year",
    savings_interest_pct: "Interest on your savings",
    goals_count: "Number of goals",
    goals_within_12m: "Goals within twelve months",
    unallocated_low: "Not allocated each month, low",
    unallocated_high: "Not allocated each month, high",
    capacity_score: "Capacity from your figures (1-5)",
    tolerance_score: "Risk tolerance from your answers (1-5)",
    room_middle: "Room each month, middle month",
    room_low: "Room each month, lowest month",
    room_high: "Room each month, highest month",
    income_middle: "Income each month, middle month",
    fixed_share: "Share of income going to fixed costs",
    savings_rate: "Savings rate",
    spend_months: "Months of spending",
    spend_first_month: "First month of spending",
    spend_last_month: "Last month of spending",
    spend_foreign_excluded: "Spending in another currency, not counted",
    spend_last_month_total: "Spending in the last month",
    spend_categories_over_limit: "Categories over your own limit",
    sub_count: "Number of subscriptions",
    sub_total_month: "Subscriptions per month",
    sub_total_year: "Subscriptions per year",
    sub_whatif_year: "Subscriptions per year without the flagged ones",
    sub_coverage_days: "Days of transactions behind the subscriptions",
    sub_foreign_excluded: "Subscriptions in another currency, not counted",
    sub_fixed_excluded: "Fixed costs that are not subscriptions, not counted",
  },
};

export const planShellCopy: Record<Locale, PlanShellCopy> = { nl, en };
