import type { PendingPublicFactId, SectionId } from "@lavega/core";
import type { Locale } from "../../locale.js";

/**
 * The allowed and forbidden example sentences from spec sections 6 to 12, as
 * data. Today they feed the template tests; later they fill one static slot of
 * the AI prompt. The forbidden lists are examples of what must never be said:
 * they are not shown to anyone and are not checked for advice language (they
 * are made of it). The allowed lists must pass `findAdviceLanguage`.
 *
 * One spec example is reworded: "...and save 380 in interest" trips the shared
 * list (the "save an amount" rule), so it reads "...and cost 380 less in
 * interest" here.
 */
export type WordingTable = {
  allowed: Record<Locale, string[]>;
  forbidden: Record<Locale, string[]>;
};

/** Example sentences that quote a public fact. They are NOT in `allowed`: until
 *  the fact is verified (PUBLIC_FACTS) they must not reach the AI prompt slot.
 *  Filter by `factById(factId)` before use. */
export const FACT_GATED_EXAMPLES: {
  factId: PendingPublicFactId;
  section: SectionId;
  en: string;
  nl: string;
}[] = [
  {
    factId: "nibud-save-10pct",
    section: "month",
    en: "Nibud's guidance mentions about 10%.",
    nl: "Het Nibud noemt ongeveer 10%.",
  },
  {
    factId: "nibud-buffer-purpose",
    section: "buffer",
    en: "Nibud's buffer is meant for unexpected large costs, not a drop in income.",
    nl: "De buffer van het Nibud is bedoeld voor onverwachte grote kosten, niet voor een daling van je inkomen.",
  },
  {
    factId: "gift-tax-annual-2026",
    section: "goals",
    en: "Parents together can give each child 6,908 tax-free in 2026.",
    nl: "Ouders samen kunnen elk kind in 2026 6.908 belastingvrij geven.",
  },
  {
    factId: "afm-costs",
    section: "goals",
    en: "AFM notes that costs weigh more the longer the horizon.",
    nl: "De AFM merkt op dat kosten zwaarder wegen naarmate de looptijd langer is.",
  },
];

export const WORDING_TABLES: Record<SectionId, WordingTable> = {
  month: {
    allowed: {
      en: [
        "Over the last three months you had between 420 and 810 left each month; the middle month was 640.",
        "Fixed costs are 58% of your income; the rest is 31%.",
        "Your savings rate was 7%.",
      ],
      nl: [
        "In de afgelopen drie maanden bleef er per maand tussen 420 en 810 over; de middelste maand was 640.",
        "Vaste lasten zijn 58% van je inkomen; de rest is 31%.",
        "Je spaarquote was 7%.",
      ],
    },
    forbidden: {
      en: ["Your fixed costs are too high.", "You should save 10%.", "You could invest 150 more."],
      nl: [
        "Je vaste lasten zijn te hoog.",
        "Je moet 10% sparen.",
        "Je zou 150 meer kunnen beleggen.",
      ],
    },
  },
  buffer: {
    allowed: {
      en: [
        "You have 2.4 months of fixed costs saved; your target is 4, so 1.6 months (4,100) remain.",
      ],
      nl: [
        "Je hebt 2,4 maanden aan vaste lasten gespaard; je streefwaarde is 4, dus 1,6 maanden (4.100) ontbreken.",
      ],
    },
    forbidden: {
      en: ["You need six months.", "Your buffer is dangerously low.", "Build your buffer first."],
      nl: [
        "Je hebt zes maanden nodig.",
        "Je buffer is gevaarlijk laag.",
        "Bouw eerst je buffer op.",
      ],
    },
  },
  debts: {
    allowed: {
      en: [
        "Your loan costs 9.5% a year, about 1,140 in interest. Your savings account pays 2.1%.",
        "50 more per month would end the loan 14 months earlier and cost 380 less in interest.",
      ],
      nl: [
        "Je lening kost 9,5% per jaar, ongeveer 1.140 aan rente. Je spaarrekening geeft 2,1%.",
        "50 extra per maand zou de lening 14 maanden eerder beëindigen en 380 minder aan rente kosten.",
      ],
    },
    forbidden: {
      en: [
        "Pay off your loan before saving.",
        "This is a bad loan.",
        "Move your savings to repay it.",
      ],
      nl: [
        "Los je lening af voordat je spaart.",
        "Dit is een slechte lening.",
        "Zet je spaargeld in om hem af te lossen.",
      ],
    },
  },
  spending: {
    allowed: {
      en: [
        "In groceries you spent 410 last month; your usual month is 380 (your last 12 months ranged 340 to 450).",
        "Restaurants went up three months running.",
      ],
      nl: [
        "Bij boodschappen gaf je vorige maand 410 uit; je gewone maand is 380 (de laatste 12 maanden lagen tussen 340 en 450).",
        "Restaurants gingen drie maanden achter elkaar omhoog.",
      ],
    },
    forbidden: {
      en: ["You spend too much on takeaway.", "Reduce this.", "Households like yours spend less."],
      nl: [
        "Je geeft te veel uit aan afhaal.",
        "Beperk dit.",
        "Huishoudens zoals het jouwe geven minder uit.",
      ],
    },
  },
  subscriptions: {
    allowed: {
      en: [
        "Price up 18% since March, from 9.99 to 11.79.",
        "Two video streaming services: together 24.98 a month.",
        "No use logged in 3 months; 141 a year.",
      ],
      nl: [
        "Prijs 18% hoger sinds maart, van 9,99 naar 11,79.",
        "Twee videostreamingdiensten: samen 24,98 per maand.",
        "Geen gebruik vastgelegd in 3 maanden; 141 per jaar.",
      ],
    },
    forbidden: {
      en: ["Cancel this one.", "You don't need this.", "A waste of money."],
      nl: ["Zeg dit op.", "Je hebt dit niet nodig.", "Zonde van het geld."],
    },
  },
  cards: {
    allowed: {
      en: [
        "At your own spend, card A earns 310 points a year and card B 240; after fees 48 and 12 at your lowest redemption (0.4 cent).",
        "These points expire on 31 March.",
      ],
      nl: [
        "Bij jouw eigen uitgaven levert kaart A 310 punten per jaar op en kaart B 240; na kosten 48 en 12 bij je laagste inwisseling (0,4 cent).",
        "Deze punten verlopen op 31 maart.",
      ],
    },
    forbidden: {
      en: ["Use card A.", "Card A is the best for you.", "Your points are worth 1 cent each."],
      nl: [
        "Gebruik kaart A.",
        "Kaart A is de beste voor jou.",
        "Je punten zijn 1 cent per stuk waard.",
      ],
    },
  },
  goals: {
    allowed: {
      en: [
        "After fixed costs, your buffer top-up and your goals' monthly saving, 410 to 740 a month is not allocated.",
        "For this goal, 180 a month at 0% reaches the target by 2036.",
      ],
      nl: [
        "Na vaste lasten, de aanvulling van je buffer en het maandelijkse sparen voor je doelen is 410 tot 740 per maand niet toegewezen.",
        "Voor dit doel haalt 180 per maand bij 0% het doel in 2036.",
      ],
    },
    forbidden: {
      en: [
        "Invest 400 a month.",
        "Put 60% in a world index fund.",
        "Meesman is the cheapest for you.",
        "A safe way to invest for your child.",
        "Money you need soon belongs in savings.",
        "People like you choose index funds.",
      ],
      nl: [
        "Beleg 400 per maand.",
        "Zet 60% in een wereldwijd indexfonds.",
        "Meesman is het goedkoopst voor jou.",
        "Een veilige manier om voor je kind te beleggen.",
        "Geld dat je snel nodig hebt hoort op een spaarrekening.",
        "Mensen zoals jij kiezen indexfondsen.",
      ],
    },
  },
};
