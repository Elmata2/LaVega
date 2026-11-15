import type { Locale } from "./locale.js";

/**
 * Every word on the landing page, in both languages.
 *
 * One shape, two values, so a string added to Dutch and forgotten in English is
 * a type error rather than a blank on the page. The English is the approved
 * mockup's wording; the Dutch is written for a Dutch reader, not translated
 * word for word.
 */
/** A heading whose last words are set in italics. */
type Title = { lead: string; em: string };
type TalkRow = [label: string, value: string, status: string];

export type Talk = {
  /** What the person asks, after "Hey LaVega,". */
  q: string;
  a: string;
  label: string;
  rows: [TalkRow, TalkRow, TalkRow];
};

export type LandingCopy = {
  meta: { title: string; description: string };
  skip: string;
  nav: {
    label: string;
    how: string;
    faq: string;
    login: string;
    cta: string;
    menu: string;
    menuLanguage: string;
  };
  login: {
    intro: string;
    close: string;
    signUpTitle: string;
    signUpIntro: string;
    toSignUp: string;
    toSignIn: string;
    linkInvalid: string;
  };
  langSwitch: { label: string; to: string };
  hero: {
    eyebrow: string;
    lineOne: string;
    lineTwo: string;
    em: string;
    sub: string;
    shot: {
      label: string;
      tabs: [string, string, string, string, string];
      title: string;
      asOf: string;
      source: string;
      links: [string, string];
      ok: string;
      warn: string;
      cards: Array<{ title: string; value: string; attention: boolean }>;
    };
  };
  view: { title: Title; lead: string };
  problem: { title: Title; stat: string; note: string };
  reveal: string;
  does: {
    title: Title;
    stand: {
      label: string;
      total: string;
      totalLabel: string;
      accounts: [
        { name: string; amount: string },
        { name: string; amount: string },
        { name: string; amount: string },
      ];
      title: string;
      text: string;
    };
    move: {
      gainLabel: string;
      unit: string;
      moves: [
        { label: string; gain: number },
        { label: string; gain: number },
        { label: string; gain: number },
      ];
      title: string;
      text: string;
    };
    watch: {
      notes: [
        { title: string; text: string },
        { title: string; text: string },
        { title: string; text: string },
        { title: string; text: string },
        { title: string; text: string },
      ];
      title: string;
      text: string;
      next: string;
    };
  };
  quote: { text: string; cite: string };
  acts: {
    title: string;
    hey: string;
    who: string;
    talks: [Talk, Talk];
    soon: string;
  };
  faq: { title: Title; items: Array<{ q: string; a: string }> };
  end: { title: Title };
  footer: { note: string; privacy: string; terms: string; contact: string };
};

const nl: LandingCopy = {
  meta: {
    title: "LaVega: je financieel adviseur met AI",
    description:
      "Zie al je geld in één beeld en vind je beste zet. Jij beslist, LaVega doet de rest.",
  },
  skip: "Naar de inhoud",
  nav: {
    label: "Hoofdmenu",
    how: "Hoe het werkt",
    faq: "FAQ",
    login: "Inloggen",
    cta: "Vraag vroege toegang aan",
    menu: "Menu",
    menuLanguage: "English",
  },
  login: {
    intro: "Log in met je LaVega-account.",
    close: "Sluiten",
    signUpTitle: "Vraag vroege toegang aan",
    signUpIntro:
      "Maak een LaVega-account aan. We sturen je een link om je e-mailadres te bevestigen.",
    toSignUp: "Nog geen account? Vraag vroege toegang aan",
    toSignIn: "Al een account? Inloggen",
    linkInvalid:
      "Deze bevestigingslink is ongeldig of verlopen. Log in met je e-mailadres en wachtwoord: we sturen dan een nieuwe link.",
  },
  langSwitch: { label: "EN", to: "Switch to English" },
  hero: {
    eyebrow: "Je financieel adviseur met AI",
    lineOne: "Haal het meeste",
    lineTwo: "uit je",
    em: "geld.",
    sub: "Jij beslist, LaVega doet de rest.",
    shot: {
      label:
        "Het scherm Jouw plan in LaVega, met je maand, buffer, schulden, uitgaven en abonnementen en bij elk een status",
      tabs: ["Overzicht", "Jouw plan", "Rekeningen", "Forecast", "Optimalisatie"],
      title: "Jouw plan",
      asOf: "Plan per 2 november 2026",
      source: "bankgegevens tot 1 november 2026; profiel bevestigd op 27 oktober 2026",
      links: ["Wat LaVega weet", "Aannames"],
      ok: "✓ Op koers",
      warn: "! Aandacht",
      cards: [
        { title: "Jouw maand", value: "Doorsnee maand €842", attention: false },
        { title: "Buffer", value: "2,4 maanden vaste lasten", attention: true },
        { title: "Schulden", value: "€312 rente per jaar", attention: false },
        { title: "Uitgaven per categorie", value: "Oktober: €1.946", attention: false },
        { title: "Abonnementen", value: "€47 per maand", attention: true },
        {
          title: "Kaarten en punten",
          value: "€1.420 aan uitgaven die op een kaart passen",
          attention: false,
        },
      ],
    },
  },
  view: {
    title: { lead: "Al je geld in", em: "beeld." },
    lead: "Elke rekening, kaart en belegging in één beeld.",
  },
  problem: {
    title: { lead: "De meeste mensen hebben hun financiën niet", em: "op orde." },
    stat: "28%",
    note: "van de Nederlanders scoort hoog op financiële geletterdheid. Flash Eurobarometer 525.",
  },
  reveal:
    "De meeste geldapps laten één deel van je geld zien. LaVega kijkt naar alles en vindt je beste zet.",
  does: {
    title: { lead: "Je copiloot voor elke", em: "geldbeslissing" },
    stand: {
      label: "Toon de volgende rekening",
      total: "€48.883,27",
      totalLabel: "Alle rekeningen",
      accounts: [
        { name: "Betaalrekening", amount: "€4.218,40" },
        { name: "Spaarrekening", amount: "€12.760,15" },
        { name: "Beleggingen", amount: "€31.904,72" },
      ],
      title: "Waar sta ik?",
      text: "Alles wat je bezit, op één scherm.",
    },
    move: {
      gainLabel: "Beter af met",
      unit: "per maand",
      moves: [
        { label: "3 abonnementen opzeggen", gain: 47 },
        { label: "Meer rente op je spaargeld", gain: 18 },
        { label: "Overstappen op een betere kaart", gain: 12 },
      ],
      title: "Wat is mijn beste zet?",
      text: "Een plan rond jouw geld. Vink af wat je wilt.",
    },
    watch: {
      notes: [
        { title: "Wekelijkse check", text: "Je gaf €62 minder uit dan gewoonlijk" },
        { title: "Salaris is binnen", text: "€400 naar je spaargeld verplaatsen?" },
        { title: "Proefperiode loopt af", text: "Een gratis proef wordt over 3 dagen betaald" },
        { title: "Huur is gestegen", text: "€35 meer dan vorige maand" },
        { title: "Betere rente", text: "Je spaargeld kan meer opleveren" },
      ],
      title: "LaVega blijft opletten.",
      text: "Een wekelijkse check en een seintje als er iets verandert.",
      next: "Komt als volgende.",
    },
  },
  quote: {
    text: "“Het is een black box. Pas aan het einde van het kwartaal weet ik waar ik sta.”",
    cite: "Nederlandse start-upondernemer",
  },
  acts: {
    title: "Maak kennis met je AI financieel adviseur. Die geeft niet alleen advies. Die handelt",
    hey: "Hey LaVega,",
    who: "LaVega",
    talks: [
      {
        q: "betaal ik voor dingen die ik niet gebruik, en kun je dat regelen?",
        a: "Ik ben er al mee bezig. Je zei ja, dus ik heb drie abonnementen opgezegd en je overtollige geld naar je spaargeld verplaatst. Dit is het overzicht.",
        label: "Overzicht",
        rows: [
          ["Abonnementen", "€47 per maand", "Opgezegd"],
          ["Overtollig geld", "€3.200", "Verplaatst"],
          ["Volgende check", "Maandag", "Gepland"],
        ],
      },
      {
        q: "verplaats elke maand €200 naar mijn spaargeld.",
        a: "Gedaan. Ik verplaats het op de 1e, direct nadat je salaris binnen is, en laat je buffer intact. Dit is het plan.",
        label: "Plan",
        rows: [
          ["Bedrag", "€200 per maand", "Ingesteld"],
          ["Eerste keer", "1 december", "Gepland"],
          ["Je buffer", "€1.500", "Intact"],
        ],
      },
    ],
    soon: "Goedgekeurde acties komen als volgende.",
  },
  faq: {
    title: { lead: "Vragen,", em: "beantwoord" },
    items: [
      {
        q: "Zijn mijn gegevens veilig?",
        a: "Je transacties worden in je browser versleuteld. Wij bewaren de sleutels, dus technisch kunnen wij erbij. Bank- en brokerkoppelingen zijn alleen-lezen.",
      },
      {
        q: "Kan LaVega geld verplaatsen?",
        a: "Nu nog niet. LaVega leest alleen mee en heeft geen functie om betalingen te doen. Goedgekeurde acties komen als volgende, en er gebeurt niets voordat jij het goedkeurt.",
      },
      {
        q: "Moet ik mijn bank koppelen?",
        a: "Nee. Je kunt in plaats daarvan je bankexports importeren.",
      },
      {
        q: "Wat kost het?",
        a: "€30 per maand na een gratis proefperiode van 30 dagen. Je hebt geen kaart nodig om te beginnen en je kunt altijd opzeggen.",
      },
      {
        q: "Geeft LaVega beleggingsadvies?",
        a: "Nee. LaVega toont en verklaart je beleggingen. Het beveelt ze nooit aan en koopt ze nooit.",
      },
      {
        q: "Kan ik mijn gegevens verwijderen?",
        a: "Ja. De gegevens op onze server verwijder je zelf, onder Back-up in de app. Je inlogaccount zelf kun je in de app nog niet verwijderen.",
      },
    ],
  },
  end: { title: { lead: "Je hebt je geld", em: "onder controle." } },
  footer: {
    note: "LaVega toont en verklaart je beleggingen. Het beveelt ze nooit aan en koopt ze nooit.",
    privacy: "Privacy",
    terms: "Voorwaarden",
    contact: "Contact",
  },
};

const en: LandingCopy = {
  meta: {
    title: "LaVega: your AI financial adviser",
    description:
      "See all your money in one picture and find your best move. You decide, LaVega does the rest.",
  },
  skip: "Skip to content",
  nav: {
    label: "Main",
    how: "How it works",
    faq: "FAQ",
    login: "Log in",
    cta: "Get early access",
    menu: "Menu",
    menuLanguage: "Nederlands",
  },
  login: {
    intro: "Log in with your LaVega account.",
    close: "Close",
    signUpTitle: "Get early access",
    signUpIntro: "Create a LaVega account. We will email you a link to confirm your address.",
    toSignUp: "No account yet? Get early access",
    toSignIn: "Already have an account? Log in",
    linkInvalid:
      "This confirmation link is invalid or has expired. Log in with your email and password and we will send you a new one.",
  },
  langSwitch: { label: "NL", to: "Bekijk deze pagina in het Nederlands" },
  hero: {
    eyebrow: "Your AI financial adviser",
    lineOne: "Get the most",
    lineTwo: "from your",
    em: "money.",
    sub: "You decide, LaVega does the rest.",
    shot: {
      label:
        "The Your plan screen in LaVega, listing your month, buffer, debts, spending and subscriptions with a status for each",
      tabs: ["Overview", "Your plan", "Accounts", "Forecast", "Optimise"],
      title: "Your plan",
      asOf: "Plan as of 2 November 2026",
      source: "bank data to 1 November 2026; profile confirmed 27 October 2026",
      links: ["What LaVega knows", "Assumptions"],
      ok: "✓ On track",
      warn: "! Attention",
      cards: [
        { title: "Your month", value: "Middle month €842", attention: false },
        { title: "Buffer", value: "2.4 months of fixed costs", attention: true },
        { title: "Debts", value: "€312 interest a year", attention: false },
        { title: "Spending per category", value: "October: €1,946", attention: false },
        { title: "Subscriptions", value: "€47 a month", attention: true },
        {
          title: "Cards and points",
          value: "€1,420 of spending that fits on a card",
          attention: false,
        },
      ],
    },
  },
  view: {
    title: { lead: "All your money in", em: "view." },
    lead: "Every account, card and investment in one picture.",
  },
  problem: {
    title: { lead: "Most people don't have their finances", em: "together." },
    stat: "28%",
    note: "of Dutch people score high on financial literacy. Flash Eurobarometer 525.",
  },
  reveal:
    "Most money apps show one part of your money. LaVega looks at all of it and finds your best move.",
  does: {
    title: { lead: "Your copilot for every money", em: "decision" },
    stand: {
      label: "Show the next account",
      total: "€48,883.27",
      totalLabel: "All accounts",
      accounts: [
        { name: "Current account", amount: "€4,218.40" },
        { name: "Savings", amount: "€12,760.15" },
        { name: "Investments", amount: "€31,904.72" },
      ],
      title: "Where do I stand?",
      text: "Everything you own, on one screen.",
    },
    move: {
      gainLabel: "Better off by",
      unit: "a month",
      moves: [
        { label: "Cancel 3 subscriptions", gain: 47 },
        { label: "Earn more on savings", gain: 18 },
        { label: "Switch to a better card", gain: 12 },
      ],
      title: "What's my best move?",
      text: "A plan built around your money. Tick what you want.",
    },
    watch: {
      notes: [
        { title: "Weekly check", text: "You spent €62 less than usual" },
        { title: "Salary is in", text: "Put €400 towards savings?" },
        { title: "Trial ending", text: "A free trial turns paid in 3 days" },
        { title: "Rent went up", text: "€35 more than last month" },
        { title: "Better rate", text: "Your savings could earn more" },
      ],
      title: "LaVega keeps watching.",
      text: "A weekly check, and a nudge when something changes.",
      next: "Ships next.",
    },
  },
  quote: {
    text: "“It’s a black box. Only at the end of the quarter do I know where I am standing.”",
    cite: "NL start-up owner",
  },
  acts: {
    title: "Meet your AI financial adviser. It doesn't just advise. It acts",
    hey: "Hey LaVega,",
    who: "LaVega",
    talks: [
      {
        q: "am I paying for things I don't use, and can you sort it out?",
        a: "Already on it. You said yes, so I cancelled three subscriptions and moved your spare cash to savings. Here's the breakdown.",
        label: "Breakdown",
        rows: [
          ["Subscriptions", "€47 a month", "Cancelled"],
          ["Spare cash", "€3,200", "Moved"],
          ["Next check", "Monday", "Planned"],
        ],
      },
      {
        q: "move €200 to savings every month.",
        a: "Done. I'll move it on the 1st, right after your salary lands, and keep your buffer intact. Here's the plan.",
        label: "Plan",
        rows: [
          ["Amount", "€200 a month", "Set"],
          ["First move", "1 December", "Planned"],
          ["Your buffer", "€1,500", "Kept"],
        ],
      },
    ],
    soon: "Approved actions ship next.",
  },
  faq: {
    title: { lead: "Questions,", em: "answered" },
    items: [
      {
        q: "Is my data safe?",
        a: "Your transactions are encrypted in your browser. We hold the keys, so technically we can access your data. Bank and broker connections are read only.",
      },
      {
        q: "Can LaVega move money?",
        a: "Not today. LaVega only reads, and it has no function to make payments. Approved actions ship next, and nothing happens until you approve it.",
      },
      {
        q: "Do I have to connect my bank?",
        a: "No. You can import your bank exports instead.",
      },
      {
        q: "What does it cost?",
        a: "€30 a month after a free 30 day trial. No card needed to start, and you can cancel any time.",
      },
      {
        q: "Does LaVega give investment advice?",
        a: "No. LaVega shows and explains your investments. It never recommends or buys them.",
      },
      {
        q: "Can I delete my data?",
        a: "Yes. You delete the data on our server yourself, under Backup in the app. You cannot yet delete the sign-in account itself from within the app.",
      },
    ],
  },
  end: { title: { lead: "You've got your money", em: "handled." } },
  footer: {
    note: "LaVega shows and explains your investments. It never recommends or buys them.",
    /* The policy and terms themselves stay Dutch: they are legal documents for a
     * Dutch company and the Dutch text is the operative one. Translating them
     * would invite someone to rely on a version that is not. */
    privacy: "Privacy",
    terms: "Terms",
    contact: "Contact",
  },
};

export const LANDING_COPY: Record<Locale, LandingCopy> = { nl, en };

export function landingCopy(locale: Locale): LandingCopy {
  return LANDING_COPY[locale];
}
