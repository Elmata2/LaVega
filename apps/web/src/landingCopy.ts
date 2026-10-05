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
  strengths: { title: string; sub: string; cta: string; tiles: [string, string, string, string] };
  agents: {
    eyebrow: string;
    title: string;
    prev: string;
    next: string;
    cards: Array<{ t: string; d: string }>;
  };
  privacy: { title: string; sub: string; ticks: [string, string, string] };
  how: { eyebrow: string; title: string; steps: Array<{ t: string; d: string }> };
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
      "Bundel al je rekeningen bij elke bank in één overzicht, reserveer je belasting en haal het meeste uit je punten — lokaal-first en versleuteld.",
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
    sub: "LaVega bundelt al je rekeningen — bij elke bank — in één overzicht. Weet op elk moment precies hoeveel je hebt en waar je geld heen gaat, reserveer je belasting, en haal het meeste uit je punten. Lokaal-first: je cijfers blijven op je eigen apparaat.",
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
    lockChip: "Lokaal & versleuteld",
  },
  spiral: {
    ariaLabel: "Slimmer met je geld",
    tagline: "Niet méér uitgeven — slimmer met je geld.",
  },
  strengths: {
    title: "Al je geldzaken, samen op één plek",
    sub: "We doen er alles aan om je een naadloze ervaring te geven — snel, veilig en compleet. Eén helder beeld van al je rekeningen, waar je ook bankiert.",
    cta: "Ontdek meer",
    tiles: [
      "Snel & soepel",
      "Al je rekeningen gekoppeld",
      "Sterke versleuteling",
      "Eén compleet overzicht",
    ],
  },
  agents: {
    eyebrow: "De agents",
    title: "Slimme agents die het werk doen",
    prev: "Vorige",
    next: "Volgende",
    cards: [
      {
        t: "Facturen-agent",
        d: "Sleep een PDF-factuur erin en de agent leest de bedragen en vervaldata automatisch uit — meteen zichtbaar in je cashflow, jij bevestigt.",
      },
      {
        t: "Belasting-agent",
        d: "Reserveert automatisch je btw en bewaakt elke aangifte-deadline, zodat je nooit voor verrassingen komt te staan.",
      },
      {
        t: "Koersen-agent",
        d: "Moet je wisselen of overmaken in vreemde valuta? De agent zoekt realtime de goedkoopste route (Wise, Revolut, je bank).",
      },
      {
        t: "Punten-agent",
        d: "Houdt je punten bij en zoekt live op wat ze écht waard zijn en hoe je ze het slimst inwisselt, bijvoorbeeld voor reizen.",
      },
    ],
  },
  privacy: {
    title: "Jouw data blijft van jou.",
    sub: "Alles staat versleuteld op je eigen apparaat. Bankkoppelingen zijn alleen-lezen. Geen cloud, geen meekijken — tenzij jij een agent expliciet aanzet. Zo simpel is het.",
    ticks: [
      "Lokaal-first: geen server bewaart je transacties",
      "Alleen-lezen bankkoppeling (geen betalingen)",
      "Versleutelde kluis met je eigen wachtwoord",
    ],
  },
  how: {
    eyebrow: "Hoe het werkt",
    title: "In een paar minuten opgezet",
    steps: [
      { t: "Importeer of koppel", d: "Sleep je bankexports erin of koppel je bank alleen-lezen." },
      { t: "LaVega rekent", d: "Categoriseert automatisch en voorspelt je kaspositie vooruit." },
    ],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Veelgestelde vragen",
    items: [
      {
        q: "Is mijn data veilig?",
        a: "Ja. Alles staat versleuteld op je eigen apparaat — er is geen cloud die je transacties bewaart. Bankkoppelingen zijn altijd alleen-lezen.",
      },
      {
        q: "Moet ik mijn bank koppelen?",
        a: "Nee. Je kunt ook simpelweg je bankexports importeren. Koppelen kan wél en is dan alleen-lezen (nooit betalingen).",
      },
      {
        q: "Voor wie is LaVega?",
        a: "Van studenten die grip willen op hun budget tot werkenden en ondernemers die hun rekeningen, cashflow en btw willen beheren.",
      },
      {
        q: "Werkt het met meerdere rekeningen en BV's?",
        a: "Ja — LaVega bundelt al je rekeningen, privé én zakelijk, in één helder overzicht per entiteit en geconsolideerd.",
      },
    ],
  },
  footer: {
    ctaTitle: "Klaar om grip te krijgen op je geld?",
    cta: "Account aanmaken",
    note: "Lokaal-first personal finance — van student tot ondernemer.",
    product: "Product",
    legal: "Juridisch",
    privacy: "Privacy",
    terms: "Voorwaarden",
    rights: "© 2026 LaVega · lokaal-first",
  },
};

const en: LandingCopy = {
  meta: {
    title: "LaVega – Every account, one clear number.",
    description:
      "See every account, at any bank, in one clear view — set aside your tax and get the most from your points, local-first and encrypted.",
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
    sub: "LaVega brings every account you hold — at any bank — into a single view. Know exactly what you have and where it is going, set aside your tax, and get the most out of your points. Local-first: your figures stay on your own device.",
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
    lockChip: "Local & encrypted",
  },
  spiral: {
    ariaLabel: "Smarter with your money",
    tagline: "Not spending more — being smarter with your money.",
  },
  strengths: {
    title: "Your whole financial life, in one place",
    sub: "Fast, secure and complete — one clear picture of every account, whoever you bank with.",
    cta: "See the agents",
    tiles: [
      "Fast & fluid",
      "Every account connected",
      "Strong encryption",
      "One complete overview",
    ],
  },
  agents: {
    eyebrow: "The agents",
    title: "Agents that do the work",
    prev: "Previous",
    next: "Next",
    cards: [
      {
        t: "Invoice agent",
        d: "Drop in a PDF invoice and the agent reads out the amounts and due dates — visible in your cash flow straight away, and you confirm it.",
      },
      {
        t: "Tax agent",
        d: "Sets aside your VAT automatically and watches every filing deadline, so an assessment never arrives as a surprise.",
      },
      {
        t: "Currency agent",
        d: "Converting or sending money abroad? The agent finds the cheapest route in real time (Wise, Revolut, your own bank).",
      },
      {
        t: "Points agent",
        d: "Tracks your reward balances and looks up what they are actually worth, and the smartest way to spend them — on travel, for instance.",
      },
    ],
  },
  privacy: {
    title: "Your data stays yours.",
    sub: "Everything is encrypted on your own device. Bank connections are read-only. No cloud, nobody looking over your shoulder — unless you switch an agent on yourself. That is the whole of it.",
    ticks: [
      "Local-first: no server keeps your transactions",
      "Read-only bank access (never payments)",
      "An encrypted vault, with a password only you hold",
    ],
  },
  how: {
    eyebrow: "How it works",
    title: "Set up in a few minutes",
    steps: [
      { t: "Import or connect", d: "Drop in your bank exports, or connect your bank read-only." },
      {
        t: "LaVega does the maths",
        d: "Categorises automatically and forecasts your cash position ahead.",
      },
    ],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Frequently asked questions",
    items: [
      {
        q: "Is my data safe?",
        a: "Yes. Everything is encrypted on your own device — there is no cloud holding your transactions. Bank connections are always read-only.",
      },
      {
        q: "Do I have to connect my bank?",
        a: "No. You can simply import your bank exports. Connecting is available, and when you do it is read-only — never payments.",
      },
      {
        q: "Who is LaVega for?",
        a: "People whose money does not arrive neatly: freelancers, owner-directors and anyone running personal and business finances side by side.",
      },
      {
        q: "Does it handle multiple accounts and entities?",
        a: "Yes — LaVega brings every account together, personal and business, both per entity and consolidated.",
      },
    ],
  },
  footer: {
    ctaTitle: "Ready to get a grip on your money?",
    cta: "Create account",
    note: "Local-first personal finance, for people whose income does not arrive neatly.",
    /* The policy and terms themselves stay Dutch: they are legal documents for a
     * Dutch company and the Dutch text is the operative one. Translating them
     * would invite someone to rely on a version that is not. */
    product: "Product",
    legal: "Legal",
    privacy: "Privacy",
    terms: "Terms",
    rights: "© 2026 LaVega · local-first",
  },
};

export const LANDING_COPY: Record<Locale, LandingCopy> = { nl, en };

export function landingCopy(locale: Locale): LandingCopy {
  return LANDING_COPY[locale];
}
