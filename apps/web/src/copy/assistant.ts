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
    decisions: "Your decisions",
    memory: {
      title: "What I remember about you",
      empty: "Nothing remembered yet.",
      row: (pref) => `From now on, ${pref}.`,
    },
    preference: preference("en"),
  },
};
