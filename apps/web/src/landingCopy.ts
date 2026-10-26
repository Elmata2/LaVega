import type { Locale } from "./locale.js";

/**
 * Every word on the landing page, in both languages.
 *
 * One shape, two values, so a string added to Dutch and forgotten in English is
 * a type error rather than a blank on the page. The English is written for a
 * different reader — investors and partners who arrive by link — so it is not a
 * literal translation of the Dutch: "van student tot ondernemer" is a Dutch
 * market segment, not an English one.
 */
type HowStep = { t: string; d: string };

export type LandingCopy = {
  meta: { title: string; description: string };
  nav: {
    agents: string;
    how: string;
    signUp: string;
    investing: string;
    login: string;
  };
  beta: { lead: string; link: string };
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
    titleTop: string;
    titleBottom: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  device: {
    eyebrow: string;
    total: string;
    delta: string;
    rows: [{ label: string; value: string }, { label: string; value: string }];
    returnLabel: string;
    returnValue: string;
    forecastLabel: string;
    forecastValue: string;
    lockChip: string;
  };
  spiral: { ariaLabel: string; tagline: string };
  agents: {
    eyebrow: string;
    title: string;
    cards: Array<{ t: string; d: string }>;
  };
  how: { eyebrow: string; title: string; steps: [HowStep, HowStep, HowStep] };
  faq: { eyebrow: string; title: string; items: Array<{ q: string; a: string }> };
  footer: {
    cta: string;
    note: string;
    product: string;
    legal: string;
    privacy: string;
    terms: string;
    rights: string;
  };
};

const nl: LandingCopy = {
  meta: {
    title: "LaVega – Al je rekeningen, één helder getal.",
    description:
      "Al je rekeningen en beleggingen in één overzicht: forecast, abonnementen en rentes vergeleken. Alleen-lezen en versleuteld.",
  },
  nav: {
    agents: "Agents",
    how: "Hoe het werkt",
    signUp: "Account aanmaken",
    investing: "Investing",
    login: "Inloggen",
  },
  beta: {
    lead: "LaVega is in testfase. Iets onduidelijk of klopt er iets niet?",
    link: "Laat het ons weten.",
  },
  login: {
    intro: "Log in met je LaVega-account.",
    close: "Sluiten",
    signUpTitle: "Account aanmaken",
    signUpIntro:
      "Maak een LaVega-account aan. We sturen je een link om je e-mailadres te bevestigen.",
    toSignUp: "Nog geen account? Account aanmaken",
    toSignIn: "Al een account? Inloggen",
    linkInvalid:
      "Deze bevestigingslink is ongeldig of verlopen. Log in met je e-mailadres en wachtwoord: we sturen dan een nieuwe link.",
  },
  langSwitch: { label: "EN", to: "Switch to English" },
  hero: {
    titleTop: "Al je rekeningen,",
    titleBottom: "één helder getal.",
    sub: "LaVega bundelt al je rekeningen, bij elke bank, in één overzicht. Met LaVega Investing volg je ook je beleggingen.",
    ctaPrimary: "Account aanmaken",
    ctaSecondary: "Bekijk hoe het werkt",
  },
  device: {
    eyebrow: "Totaalpositie",
    total: "€12.480",
    delta: "▲ 4,6% deze maand",
    rows: [
      { label: "Bankrekeningen", value: "€8.130" },
      { label: "Beleggingen", value: "€4.350" },
    ],
    returnLabel: "Rendement · 1 jaar",
    returnValue: "+15,4%",
    forecastLabel: "Forecast · 13 weken",
    forecastValue: "geen tekort",
    lockChip: "Versleuteld & alleen-lezen",
  },
  spiral: {
    ariaLabel: "Al je geld in beeld",
    tagline: "Al je geld in beeld, ook wat het laat liggen.",
  },
  agents: {
    eyebrow: "Wat LaVega doet",
    title: "Wat LaVega voor je doet",
    cards: [
      {
        t: "Punten",
        d: "Houdt de saldi bij die jij invult, van spaarpunten tot reisprogramma's, op één plek.",
      },
      {
        t: "LaVega Investing",
        d: "Koppel Trading 212 en Interactive Brokers alleen-lezen en zie je echte rendement en risico.",
      },
      {
        t: "Optimalisatie",
        d: "Vindt abonnementen en betere spaarrentes in je transacties.",
      },
    ],
  },
  how: {
    eyebrow: "Hoe het werkt",
    title: "In een paar minuten opgezet",
    steps: [
      {
        t: "Importeer of koppel",
        d: "Sleep je bankexports erin, of koppel je bank of broker alleen-lezen.",
      },
      { t: "LaVega rekent", d: "Categoriseert automatisch en voorspelt je kaspositie vooruit." },
      {
        t: "Blijf vooruit",
        d: "Een seintje als je buffer krap wordt, en je beleggingen met je echte rendement in beeld.",
      },
    ],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Veelgestelde vragen",
    items: [
      {
        q: "Is mijn data veilig?",
        a: "Ja, met een kanttekening: wij bewaren de sleutels, dus technisch kunnen wij erbij. Je transacties staan versleuteld in je browser. Je beleggingsdata staat versleuteld op onze server, per account afgeschermd. Je bank loopt via onze server, maar transacties slaan we daar niet op. Bank en broker zijn alleen-lezen.",
      },
      {
        q: "Kan LaVega geld verplaatsen?",
        a: "Nee. LaVega leest alleen mee. De app heeft geen functie om betalingen te doen of orders te plaatsen.",
      },
      {
        q: "Moet ik mijn bank koppelen?",
        a: "Nee. Je kunt ook simpelweg je bankexports importeren. Koppelen kan wél en is dan alleen-lezen (nooit betalingen).",
      },
      {
        q: "Welke brokers kan ik koppelen in LaVega Investing?",
        a: "Trading 212 en Interactive Brokers (IBKR, via een Flex-query). De koppeling is alleen-lezen. Eén LaVega-account geeft je het persoonlijke deel én Investing.",
      },
      {
        q: "Werkt het met meerdere rekeningen?",
        a: "Ja. LaVega bundelt al je rekeningen, bij elke bank, in één helder overzicht.",
      },
      {
        q: "Wat doet het profiel?",
        a: "Na je eerste import stelt LaVega een paar vragen over je situatie en laat zien hoeveel ruimte je maandelijks overhoudt. Jij bevestigt wat het uit je transacties haalt. LaVega geeft informatie, geen financieel advies.",
      },
      {
        q: "Voor wie is LaVega?",
        a: "Voor iedereen die rekeningen bij meer dan één bank heeft of belegt bij Trading 212 of IBKR, en het overzicht kwijt is.",
      },
      {
        q: "Kan ik mijn account en gegevens verwijderen?",
        a: "Je gegevens op de server verwijder je zelf onder Back-up met de knop Servergegevens verwijderen: back-up, bank- en brokerkoppelingen, koersgeschiedenis, AI-runs en instellingen. Ook de kluissleutel gaat weg, dus de kluis in je browser en elke gedownloade back-up zijn daarna onleesbaar. Je inlogaccount zelf kun je in de app nog niet verwijderen.",
      },
    ],
  },
  footer: {
    cta: "Account aanmaken",
    note: "Personal finance en beleggen in één account, van student tot ondernemer.",
    product: "Product",
    legal: "Juridisch",
    privacy: "Privacy",
    terms: "Voorwaarden",
    rights: "© 2026 LaVega",
  },
};

const en: LandingCopy = {
  meta: {
    title: "LaVega – Every account, one clear number.",
    description:
      "Every account and investment in one view: forecast, subscriptions and savings rates compared. Read-only and encrypted.",
  },
  nav: {
    agents: "Agents",
    how: "How it works",
    signUp: "Create account",
    investing: "Investing",
    login: "Sign in",
  },
  beta: { lead: "LaVega is in beta. Something unclear or wrong?", link: "Let us know." },
  login: {
    intro: "Sign in with your LaVega account.",
    close: "Close",
    signUpTitle: "Create account",
    signUpIntro: "Create a LaVega account. We will email you a link to confirm your address.",
    toSignUp: "No account yet? Create account",
    toSignIn: "Already have an account? Sign in",
    linkInvalid:
      "This confirmation link is invalid or has expired. Sign in with your email and password and we will send you a new one.",
  },
  langSwitch: { label: "NL", to: "Bekijk deze pagina in het Nederlands" },
  hero: {
    titleTop: "Every account,",
    titleBottom: "one clear number.",
    sub: "LaVega brings every account you hold, at any bank, into a single view. With LaVega Investing you follow your investments too.",
    ctaPrimary: "Create account",
    ctaSecondary: "See how it works",
  },
  device: {
    eyebrow: "Total position",
    total: "€12,480",
    delta: "▲ 4.6% this month",
    rows: [
      { label: "Bank accounts", value: "€8,130" },
      { label: "Investments", value: "€4,350" },
    ],
    returnLabel: "Return · 1 year",
    returnValue: "+15.4%",
    forecastLabel: "Forecast · 13 weeks",
    forecastValue: "no shortfall",
    lockChip: "Encrypted & read-only",
  },
  spiral: {
    ariaLabel: "All your money in view",
    tagline: "All your money in view, including what it leaves on the table.",
  },
  agents: {
    eyebrow: "What LaVega does",
    title: "What LaVega does for you",
    cards: [
      {
        t: "Points",
        d: "Keeps the reward and travel balances you enter in one place.",
      },
      {
        t: "LaVega Investing",
        d: "Connect Trading 212 and Interactive Brokers read-only and see your real return and risk.",
      },
      {
        t: "Optimise",
        d: "Finds subscriptions and better savings rates in your transactions.",
      },
    ],
  },
  how: {
    eyebrow: "How it works",
    title: "Set up in a few minutes",
    steps: [
      {
        t: "Import or connect",
        d: "Drop in your bank exports, or connect your bank or broker read-only.",
      },
      {
        t: "LaVega does the maths",
        d: "Categorises automatically and forecasts your cash position ahead.",
      },
      {
        t: "Stay ahead",
        d: "A heads-up when your buffer runs low, and your investments in view with your real return.",
      },
    ],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Frequently asked questions",
    items: [
      {
        q: "Is my data safe?",
        a: "Yes, with one caveat: we hold the keys, so technically we can access your data. Your transactions are encrypted in your browser. Your investing data is encrypted on our server, shielded per account. Your bank connection runs through our server, but we do not store transactions there. Bank and broker connections are read-only.",
      },
      {
        q: "Can LaVega move money?",
        a: "No. LaVega only reads. The app has no function to make payments or place orders.",
      },
      {
        q: "Do I have to connect my bank?",
        a: "No. You can simply import your bank exports. Connecting is available, and when you do it is read-only, never payments.",
      },
      {
        q: "Which brokers can I connect in LaVega Investing?",
        a: "Trading 212 and Interactive Brokers (IBKR, through a Flex query). The connection is read-only. One LaVega account gives you both Personal and Investing.",
      },
      {
        q: "Does it handle multiple accounts?",
        a: "Yes. LaVega brings every account together, at any bank, in one clear overview.",
      },
      {
        q: "What does the profile do?",
        a: "After your first import LaVega asks a few questions about your situation and shows how much room you have each month. You confirm what it reads from your transactions. LaVega gives information, not financial advice.",
      },
      {
        q: "Who is LaVega for?",
        a: "Anyone with accounts at more than one bank, or investing through Trading 212 or IBKR, who has lost the overview.",
      },
      {
        q: "Can I delete my account and data?",
        a: "You delete the data on the server yourself under Backup with the Delete server data button: backup, bank and broker connections, price history, AI runs and settings. The vault key goes too, so the vault in your browser and every downloaded backup are unreadable afterwards. You cannot yet delete the sign-in account itself from within the app.",
      },
    ],
  },
  footer: {
    cta: "Create account",
    note: "Personal finance and investing in one account, for people whose income does not arrive neatly.",
    /* The policy and terms themselves stay Dutch: they are legal documents for a
     * Dutch company and the Dutch text is the operative one. Translating them
     * would invite someone to rely on a version that is not. */
    product: "Product",
    legal: "Legal",
    privacy: "Privacy",
    terms: "Terms",
    rights: "© 2026 LaVega",
  },
};

export const LANDING_COPY: Record<Locale, LandingCopy> = { nl, en };

export function landingCopy(locale: Locale): LandingCopy {
  return LANDING_COPY[locale];
}
