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
    privacy: string;
    how: string;
    signUp: string;
    investing: string;
    login: string;
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
    titleTop: string;
    titleBottom: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  device: {
    eyebrow: string;
    delta: string;
    rows: [string, string, string];
    savedLabel: string;
    forecastLabel: string;
    forecastValue: string;
    lockChip: string;
  };
  spiral: { ariaLabel: string; tagline: string };
  agents: {
    eyebrow: string;
    title: string;
    prev: string;
    next: string;
    cards: Array<{ t: string; d: string }>;
  };
  how: { eyebrow: string; title: string; steps: [HowStep, HowStep, HowStep] };
  faq: { eyebrow: string; title: string; items: Array<{ q: string; a: string }> };
  footer: {
    ctaTitle: string;
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
      "Al je rekeningen en beleggingen in één overzicht: forecast, btw apart, abonnementen en rentes vergeleken. Alleen-lezen en versleuteld.",
  },
  nav: {
    agents: "Agents",
    privacy: "Privacy",
    how: "Hoe het werkt",
    signUp: "Account aanmaken",
    investing: "Investing",
    login: "Inloggen",
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
  langSwitch: { label: "English", to: "Switch to English" },
  hero: {
    titleTop: "Al je rekeningen,",
    titleBottom: "één helder getal.",
    sub: "LaVega bundelt al je rekeningen, bij elke bank, in één overzicht. Met LaVega Investing volg je ook je beleggingen.",
    ctaPrimary: "Account aanmaken",
    ctaSecondary: "Bekijk hoe het werkt",
  },
  device: {
    eyebrow: "Totaalpositie",
    delta: "▲ 4,6% deze maand",
    rows: ["Boodschappen", "Vaste lasten", "Sparen"],
    savedLabel: "Deze maand gespaard",
    forecastLabel: "Forecast · 13 weken",
    forecastValue: "geen tekort",
    lockChip: "Versleuteld & alleen-lezen",
  },
  spiral: {
    ariaLabel: "Al je geld in beeld",
    tagline: "Al je geld in beeld, ook wat het laat liggen.",
  },
  agents: {
    eyebrow: "De agents",
    title: "Slimme agents die het werk doen",
    prev: "Vorige",
    next: "Volgende",
    cards: [
      {
        t: "Facturen-agent",
        d: "Voeg facturen toe met een CSV, een UBL-bestand of een PDF. Zet je de AI-optie aan, dan leest de agent bedragen en vervaldata uit de PDF. Je ziet ze meteen in je cashflow en bevestigt ze eerst zelf.",
      },
      {
        t: "Belasting-agent",
        d: "Zet je btw apart en houdt elke aangifte-deadline in de gaten, zodat je niet voor verrassingen komt te staan.",
      },
      {
        t: "Koersen-agent",
        d: "Moet je wisselen of overmaken in vreemde valuta? De agent rangschikt banken op wat het wisselen echt kost, inclusief de kosten van de rekening, met de actuele ECB-koers als maatstaf.",
      },
      {
        t: "Punten-agent",
        d: "Houdt de saldi van je spaarpunten en reisprogramma's bij op één plek. Jij vult de saldi in. LaVega geeft er geen geldwaarde aan, behalve waar het saldo zelf in euro's is, zoals cashback.",
      },
      {
        t: "LaVega Investing",
        d: "Koppel Trading 212 en Interactive Brokers (via een Flex-query), alleen-lezen. Je ziet je posities, je tijdgewogen totaalrendement, je risico (volatiliteit en maximale daling) en een vergelijking met een benchmark.",
      },
      {
        t: "Optimalisatie",
        d: "Vindt abonnementen, prijsstijgingen en dubbele diensten in je transacties. Vergelijkt je spaarrente met actuele rentes en laat zien wat overstappen oplevert. In Zakelijk ook spaaraanbiedingen voor bedrijven, plus cashback per kaart.",
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
        d: "Een seintje als je buffer krap wordt, je btw al apart gezet en je volgende maanden in beeld.",
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
        q: "Moet ik mijn bank koppelen?",
        a: "Nee. Je kunt ook simpelweg je bankexports importeren. Koppelen kan wél en is dan alleen-lezen (nooit betalingen).",
      },
      {
        q: "Kan LaVega geld verplaatsen?",
        a: "Nee. LaVega leest alleen mee. De app heeft geen functie om betalingen te doen of orders te plaatsen.",
      },
      {
        q: "Is het gratis?",
        a: "Ja, op dit moment kost LaVega niets. Er zit geen betaalfunctie in de app.",
      },
      {
        q: "Voor wie is LaVega?",
        a: "Van studenten die grip willen op hun budget tot werkenden en ondernemers die hun rekeningen, cashflow en btw willen beheren.",
      },
      {
        q: "Werkt het met meerdere rekeningen en BV's?",
        a: "Ja. LaVega bundelt al je rekeningen, privé én zakelijk, in één helder overzicht per entiteit en geconsolideerd.",
      },
      {
        q: "Welke brokers kan ik koppelen in LaVega Investing?",
        a: "Trading 212 en Interactive Brokers (IBKR, via een Flex-query). De koppeling is alleen-lezen. Eén LaVega-account geeft je het persoonlijke deel én Investing.",
      },
      {
        q: "Kan ik mijn account en gegevens verwijderen?",
        a: "Je gegevens op de server verwijder je zelf onder Back-up met de knop Servergegevens verwijderen: back-up, bank- en brokerkoppelingen, koersgeschiedenis, AI-runs en instellingen. Ook de kluissleutel gaat weg, dus de kluis in je browser en elke gedownloade back-up zijn daarna onleesbaar. Je inlogaccount zelf kun je in de app nog niet verwijderen.",
      },
    ],
  },
  footer: {
    ctaTitle: "Klaar om grip te krijgen op je geld?",
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
      "Every account and investment in one view: forecast, VAT set aside, subscriptions and savings rates compared. Read-only and encrypted.",
  },
  nav: {
    agents: "Agents",
    privacy: "Privacy",
    how: "How it works",
    signUp: "Create account",
    investing: "Investing",
    login: "Sign in",
  },
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
  langSwitch: { label: "Nederlands", to: "Bekijk deze pagina in het Nederlands" },
  hero: {
    titleTop: "Every account,",
    titleBottom: "one clear number.",
    sub: "LaVega brings every account you hold, at any bank, into a single view. With LaVega Investing you follow your investments too.",
    ctaPrimary: "Create account",
    ctaSecondary: "See how it works",
  },
  device: {
    eyebrow: "Total position",
    delta: "▲ 4.6% this month",
    rows: ["Groceries", "Fixed costs", "Savings"],
    savedLabel: "Saved this month",
    forecastLabel: "Forecast · 13 weeks",
    forecastValue: "no shortfall",
    lockChip: "Encrypted & read-only",
  },
  spiral: {
    ariaLabel: "All your money in view",
    tagline: "All your money in view, including what it leaves on the table.",
  },
  agents: {
    eyebrow: "The agents",
    title: "Agents that do the work",
    prev: "Previous",
    next: "Next",
    cards: [
      {
        t: "Invoice agent",
        d: "Add invoices from a CSV, a UBL file or a PDF. Switch the AI option on and the agent reads amounts and due dates from the PDF. You see them in your cash flow straight away, and you confirm them first.",
      },
      {
        t: "Tax agent",
        d: "Sets your VAT aside and watches every filing deadline, so an assessment never arrives as a surprise.",
      },
      {
        t: "Currency agent",
        d: "Converting or sending money abroad? The agent ranks banks by what converting really costs, account costs included, with the current ECB rate as the yardstick.",
      },
      {
        t: "Points agent",
        d: "Keeps your reward and travel balances in one place. You enter the balances. LaVega puts no money value on them, except where the balance is itself in euros, such as cashback.",
      },
      {
        t: "LaVega Investing",
        d: "Connect Trading 212 and Interactive Brokers (through a Flex query), read-only. You see your positions, your time-weighted total return, your risk (volatility and maximum drawdown) and a comparison with a benchmark.",
      },
      {
        t: "Optimise",
        d: "Finds subscriptions, price increases and overlapping services in your transactions. Compares your savings rate with current rates and shows what switching would earn you. In Business mode it also lists business savings offers, plus cashback per card.",
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
        d: "A heads-up when your buffer runs low, your VAT already set aside, and the months ahead in view.",
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
        q: "Do I have to connect my bank?",
        a: "No. You can simply import your bank exports. Connecting is available, and when you do it is read-only, never payments.",
      },
      {
        q: "Can LaVega move money?",
        a: "No. LaVega only reads. The app has no function to make payments or place orders.",
      },
      {
        q: "Is it free?",
        a: "Yes, LaVega costs nothing at the moment. There is no payment feature in the app.",
      },
      {
        q: "Who is LaVega for?",
        a: "People whose money does not arrive neatly: freelancers, owner-directors and anyone running personal and business finances side by side.",
      },
      {
        q: "Does it handle multiple accounts and entities?",
        a: "Yes. LaVega brings every account together, personal and business, both per entity and consolidated.",
      },
      {
        q: "Which brokers can I connect in LaVega Investing?",
        a: "Trading 212 and Interactive Brokers (IBKR, through a Flex query). The connection is read-only. One LaVega account gives you both Personal and Investing.",
      },
      {
        q: "Can I delete my account and data?",
        a: "You delete the data on the server yourself under Backup with the Delete server data button: backup, bank and broker connections, price history, AI runs and settings. The vault key goes too, so the vault in your browser and every downloaded backup are unreadable afterwards. You cannot yet delete the sign-in account itself from within the app.",
      },
    ],
  },
  footer: {
    ctaTitle: "Ready to get a grip on your money?",
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
