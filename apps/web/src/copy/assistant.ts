import type { Locale } from "../locale.js";

/**
 * Everything the personal assistant panel says, in both languages (WS5.8,
 * issue #301). Typed `Record<Locale, AssistantCopy>`: a string added to Dutch
 * and forgotten in English is a type error, and `copy/parity.test.ts` re-proves
 * it from the values.
 *
 * What this file deliberately does NOT own: the category keys and account names
 * the answers quote. Those are the owner's data, rendered as-is; a category
 * label is not copy. The closed memory vocabulary IS copy: its value ids map to
 * words here, so no free text is ever stored or shown as a preference.
 */
export type AssistantCopy = {
  title: string;
  intro: string;
  placeholder: string;
  ask: string;
  close: string;
  /** Sample questions shown while the log is empty. Each routes to a tool. */
  chips: readonly [string, string, string];
  chipsLabel: string;
  history: string;
  readError: string;
  saveError: string;
  unknown: string;
  privacy: string;
  spending: {
    title: (month: string) => string;
    total: (amount: string) => string;
    categories: (list: string) => string;
    empty: string;
    partial: (count: number) => string;
  };
  balances: {
    title: string;
    row: (name: string, amount: string) => string;
    unknownRow: (name: string) => string;
    empty: string;
  };
  approval: {
    title: string;
    body: (preference: string) => string;
    approve: string;
    reject: string;
    approved: string;
    rejected: string;
    decidedAt: (date: string) => string;
    stored: (preference: string) => string;
  };
  /** The daily Instinct messages above the chat. */
  instinct: {
    title: string;
    off: string;
    turnOn: string;
    empty: string;
    failed: string;
    retry: string;
    all: string;
  };
  /** The chat: a real conversation answered by Mistral from tools that run in this browser. */
  chat: {
    intro: string;
    privacy: string;
    /** The one short "not financial advice" line of the panel. */
    notice: string;
    optIn: { title: string; body: string; on: string; notNow: string };
    /** Sent as an assistant line after "Niet nu". */
    declined: string;
    turnOff: string;
    /** Device vault, or no AI service on the server. */
    needsAccount: string;
    /** Announced once to a screen reader while the model works. */
    working: string;
    /** Shown while a round runs, from the tool name only. */
    steps: Record<string, string>;
    stepFallback: string;
    error: {
      unavailable: string;
      rate: string;
      budget: string;
      signedOut: string;
      timeout: string;
      retry: string;
    };
    factsHeader: string;
    adviceRefusal: string;
    /** Shown when no usable answer came within the caps, for any reason. */
    noAnswer: string;
    placeholder: string;
  };
  decisions: string;
  memory: {
    title: string;
    empty: string;
    row: (preference: string) => string;
  };
  preference: (subject: string, valueId: string) => string;
};

const PREFERENCE_LABELS: Record<Locale, Record<string, Record<string, string>>> = {
  nl: {
    lengte: {
      kort: "korte antwoorden",
      normaal: "normale antwoorden",
      uitgebreid: "uitgebreide antwoorden",
    },
    toon: { zakelijk: "een zakelijke toon", informeel: "een informele toon" },
    detail: { "alleen-conclusie": "alleen de conclusie", "met-uitleg": "uitleg erbij" },
    taal: { nl: "Nederlands", en: "Engels" },
    voorbeelden: { met: "met voorbeelden", zonder: "zonder voorbeelden" },
  },
  en: {
    lengte: {
      kort: "short answers",
      normaal: "normal-length answers",
      uitgebreid: "detailed answers",
    },
    toon: { zakelijk: "a formal tone", informeel: "a casual tone" },
    detail: { "alleen-conclusie": "the conclusion only", "met-uitleg": "explanations included" },
    taal: { nl: "Dutch", en: "English" },
    voorbeelden: { met: "with examples", zonder: "without examples" },
  },
};

const preference = (locale: Locale) => (subject: string, valueId: string) =>
  PREFERENCE_LABELS[locale][subject]?.[valueId] ?? `${subject}: ${valueId}`;

export const assistantCopy: Record<Locale, AssistantCopy> = {
  nl: {
    title: "Assistent",
    intro:
      "Vraag naar je eigen cijfers. De assistent werkt alleen in je browser, op je ontgrendelde kluis.",
    placeholder: "Bijvoorbeeld: wat heb ik deze maand uitgegeven?",
    ask: "Vraag",
    close: "Assistent sluiten",
    chips: [
      "Wat heb ik deze maand uitgegeven?",
      "Wat zijn mijn saldo's?",
      "Onthoud dat ik korte antwoorden wil",
    ],
    chipsLabel: "Probeer een vraag",
    history: "Beslissingen en geheugen",
    readError: "Ik kon je kluis nu niet lezen. Probeer het nog eens.",
    saveError: "Je beslissing kon niet worden opgeslagen. Probeer het nog eens.",
    unknown:
      "Dat kan ik in deze versie niet beantwoorden. Ik ken drie dingen: je uitgaven van deze maand, je saldo's, en een voorkeur onthouden.",
    privacy:
      "Alles blijft in je browser: de vraag, het antwoord en je beslissingen. Er gaat niets naar de server.",
    spending: {
      title: (month) => `Uitgaven in ${month}`,
      total: (amount) => `Je gaf ${amount} uit.`,
      categories: (list) => `Grootste posten: ${list}.`,
      empty: "Ik heb voor deze maand geen uitgaven in je kluis gevonden.",
      partial: (count) =>
        `${count} transactie${count === 1 ? " is" : "'s zijn"} nog niet verwerkt en telt niet mee.`,
    },
    balances: {
      title: "Saldo's",
      row: (name, amount) => `${name}: ${amount}`,
      unknownRow: (name) => `${name}: saldo onbekend`,
      empty: "Ik heb geen rekeningen met een saldo in je kluis gevonden.",
    },
    approval: {
      title: "Mag ik dit onthouden?",
      body: (pref) => `Voortaan ${pref}.`,
      approve: "Onthoud",
      reject: "Nee",
      approved: "Onthouden",
      rejected: "Niet onthouden",
      decidedAt: (date) => `Beslist op ${date}`,
      stored: (pref) => `Ik onthoud nu: ${pref}.`,
    },
    instinct: {
      title: "Meldingen",
      off: "Je dagelijkse bericht staat uit.",
      turnOn: "Aanzetten in Profiel",
      empty: "Nog geen berichten. Je krijgt er hooguit één per dag.",
      failed: "Berichten laden lukte niet.",
      retry: "Opnieuw",
      all: "Alle meldingen",
    },
    chat: {
      intro:
        "Vraag naar je eigen geld. De berekeningen gebeuren in je browser; voor het antwoord gaat een deel naar Mistral (EU).",
      privacy:
        "LaVega bewaart je gesprek niet. Rekeningnummers halen we eruit voordat er iets verstuurd wordt.",
      notice: "De assistent geeft informatie over je eigen cijfers, geen financieel advies.",
      optIn: {
        title: "Slim antwoorden aanzetten?",
        body: "Om je vraag te beantwoorden stuurt LaVega je vraag en de cijfers die daarvoor nodig zijn naar Mistral (EU): bedragen, datums, categorieën en namen van tegenpartijen (winkels, maar ook personen en bedrijven waaraan je betaalt of van wie je geld krijgt), van je rekeningen en van rekeningen die je zelf invoerde, en de namen van je vaste lasten, facturen en abonnementen. Een rekeningnaam kan de naam van een persoon bevatten. Rekeningnummers halen we eruit voordat er iets verstuurd wordt. Eerdere regels van dit gesprek gaan mee, zodat een vervolgvraag klopt. LaVega bewaart het gesprek niet; het verdwijnt als je de pagina herlaadt. Je kunt dit altijd uitzetten.",
        on: "Aanzetten",
        notNow: "Niet nu",
      },
      declined:
        "Goed. Zonder slim antwoorden laat ik alleen je saldo's en je uitgaven van deze maand zien, en onthoud ik een voorkeur.",
      turnOff: "Slim antwoorden uitzetten",
      needsAccount: "Slim antwoorden heeft een LaVega-account en een ingestelde AI-dienst nodig.",
      working: "Ik zoek het uit.",
      steps: {
        spending_on_day: "Uitgaven opzoeken…",
        spending_in_range: "Uitgaven opzoeken…",
        compare_weekday: "Dagen vergelijken…",
        top_categories: "Categorieën bekijken…",
        upcoming_charges: "Komende afschrijvingen zoeken…",
        balances: "Saldo's bekijken…",
        transactions: "Betalingen zoeken…",
        subscriptions: "Abonnementen bekijken…",
        monthly_totals: "Maanden vergelijken…",
        plan_summary: "Je plan bekijken…",
        upcoming_bills: "Komende rekeningen zoeken…",
      },
      stepFallback: "Even kijken…",
      error: {
        unavailable: "Ik kan nu niet antwoorden. Balans en voorkeuren werken nog.",
        rate: "Je stelde veel vragen kort achter elkaar. Probeer het over een paar minuten opnieuw.",
        budget: "Ik kan nu even niet antwoorden. Probeer het later opnieuw.",
        signedOut: "Log opnieuw in om slim te antwoorden.",
        timeout: "Het antwoord duurde te lang. Probeer het opnieuw.",
        retry: "Opnieuw",
      },
      factsHeader: "Ik kon mijn antwoord niet controleren. Dit zijn de cijfers:",
      adviceRefusal:
        "Daar geef ik geen advies over. Ik kan je uitgaven, saldo's, abonnementen en komende rekeningen laten zien.",
      noAnswer:
        "Dat lukte me niet in één keer. Stel je vraag iets specifieker, bijvoorbeeld met een periode.",
      placeholder: "Vraag naar je geld",
    },
    decisions: "Je beslissingen",
    memory: {
      title: "Wat ik van je onthouden heb",
      empty: "Nog niets onthouden.",
      row: (pref) => `Voortaan ${pref}.`,
    },
    preference: preference("nl"),
  },
  en: {
    title: "Assistant",
    intro:
      "Ask about your own figures. The assistant runs only in your browser, on your unlocked vault.",
    placeholder: "For example: what did I spend this month?",
    ask: "Ask",
    close: "Close assistant",
    chips: [
      "What did I spend this month?",
      "What are my balances?",
      "Remember that I prefer short answers",
    ],
    chipsLabel: "Try a question",
    history: "Decisions and memory",
    readError: "I could not read your vault just now. Try again.",
    saveError: "Your decision could not be saved. Try again.",
    unknown:
      "I cannot answer that in this version. I know three things: this month's spending, your balances, and remembering one preference.",
    privacy:
      "Everything stays in your browser: the question, the answer and your decisions. Nothing is sent to the server.",
    spending: {
      title: (month) => `Spending in ${month}`,
      total: (amount) => `You spent ${amount}.`,
      categories: (list) => `Largest categories: ${list}.`,
      empty: "I found no spending for this month in your vault.",
      partial: (count) =>
        `${count} transaction${count === 1 ? " is" : "s are"} still pending and not counted.`,
    },
    balances: {
      title: "Balances",
      row: (name, amount) => `${name}: ${amount}`,
      unknownRow: (name) => `${name}: balance unknown`,
      empty: "I found no accounts with a balance in your vault.",
    },
    approval: {
      title: "May I remember this?",
      body: (pref) => `From now on, ${pref}.`,
      approve: "Remember",
      reject: "No",
      approved: "Remembered",
      rejected: "Not remembered",
      decidedAt: (date) => `Decided on ${date}`,
      stored: (pref) => `I now remember: ${pref}.`,
    },
    instinct: {
      title: "Alerts",
      off: "Your daily message is off.",
      turnOn: "Turn on in Profile",
      empty: "No alerts yet. You get at most one a day.",
      failed: "Could not load alerts.",
      retry: "Try again",
      all: "All alerts",
    },
    chat: {
      intro:
        "Ask about your own money. Calculations run in your browser; part goes to Mistral (EU) for the answer.",
      privacy:
        "LaVega does not keep your conversation. We remove account numbers before anything is sent.",
      notice: "The assistant gives information about your own figures, not financial advice.",
      optIn: {
        title: "Turn on smart answers?",
        body: "To answer your question LaVega sends your question and the figures needed for it to Mistral (EU): amounts, dates, categories and the names of counterparties (shops, but also people and companies you pay or receive money from), of your accounts and of accounts you entered yourself, and the names of the fixed costs, invoices and subscriptions you have in the app. An account name can contain a person's name. We remove account numbers before anything is sent. Earlier lines of this conversation go along so a follow-up question makes sense. LaVega does not keep the conversation; it is gone when you reload. You can turn this off at any time.",
        on: "Turn on",
        notNow: "Not now",
      },
      declined:
        "Fine. Without smart answers I only show your balances and this month's spending, and remember a preference.",
      turnOff: "Turn off smart answers",
      needsAccount: "Smart answers need a LaVega account and a configured AI service.",
      working: "Looking into it.",
      steps: {
        spending_on_day: "Looking up spending…",
        spending_in_range: "Looking up spending…",
        compare_weekday: "Comparing days…",
        top_categories: "Checking categories…",
        upcoming_charges: "Finding upcoming charges…",
        balances: "Checking balances…",
        transactions: "Searching payments…",
        subscriptions: "Checking subscriptions…",
        monthly_totals: "Comparing months…",
        plan_summary: "Checking your plan…",
        upcoming_bills: "Finding upcoming bills…",
      },
      stepFallback: "One moment…",
      error: {
        unavailable: "I cannot answer right now. Balances and preferences still work.",
        rate: "You asked a lot of questions in a short time. Try again in a few minutes.",
        budget: "I cannot answer right now. Try again later.",
        signedOut: "Sign in again to get smart answers.",
        timeout: "The answer took too long. Try again.",
        retry: "Try again",
      },
      factsHeader: "I could not check my answer. These are the figures:",
      adviceRefusal:
        "I do not give advice on that. I can show your spending, balances, subscriptions and upcoming bills.",
      noAnswer:
        "I could not do that in one go. Ask a little more specifically, for example with a period.",
      placeholder: "Ask about your money",
    },
    decisions: "Your decisions",
    memory: {
      title: "What I remember about you",
      empty: "Nothing remembered yet.",
      row: (pref) => `From now on, ${pref}.`,
    },
    preference: preference("en"),
  },
};
