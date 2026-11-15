import type { MonthCalcId, MonthFigures } from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  PLAN_NUMBERS,
  planFmt,
  type FactSlot,
  type MonthMissingKind,
  type MonthReasonKey,
  type PlanFmt,
  type SectionCopy,
} from "./shared.js";

/** Section 1: Your month. Facts about the user's own last months; nothing says
 *  what the numbers should be. */
export type MonthCopy = SectionCopy<MonthFigures, MonthReasonKey, MonthMissingKind, MonthCalcId> & {
  labels: {
    room: string;
    middleMonth: string;
    lowMonth: string;
    highMonth: string;
    fixed: string;
    variable: string;
    savingsRate: string;
    savingsMoved: string;
  };
  /** Filled only from a verified Nibud fact. */
  facts: { nibudGuidance: FactSlot };
};

const roomSentence = {
  nl: (f: MonthFigures, fmt: PlanFmt): string | null => {
    const r = f.room;
    if (r.kind === "computed") {
      if (r.middleCents < 0)
        return `In de middelste van de afgelopen ${r.months.length} maanden ging er ${fmt.eur(-r.middleCents)} meer uit dan er binnenkwam. Over de maanden lag het verschil tussen inkomsten en uitgaven tussen ${fmt.eur(r.lowCents)} en ${fmt.eur(r.highCents)}.`;
      if (r.lowCents < 0)
        return `In de afgelopen ${r.months.length} maanden was het verschil tussen inkomsten en uitgaven per maand tussen ${fmt.eur(r.lowCents)} en ${fmt.eur(r.highCents)}; de middelste maand was ${fmt.eur(r.middleCents)}. Een negatief bedrag betekent dat er meer uitging dan er binnenkwam.`;
      return `In de afgelopen ${r.months.length} maanden bleef er per maand tussen ${fmt.eur(r.lowCents)} en ${fmt.eur(r.highCents)} over; de middelste maand was ${fmt.eur(r.middleCents)}.`;
    }
    if (r.kind === "stated")
      return `Volgens je eigen opgave is het verschil tussen inkomsten en uitgaven per maand tussen ${fmt.eur(r.lowCents)} en ${fmt.eur(r.highCents)}. Dit komt uit je antwoorden, niet uit bankgegevens.`;
    return null;
  },
  en: (f: MonthFigures, fmt: PlanFmt): string | null => {
    const r = f.room;
    if (r.kind === "computed") {
      if (r.middleCents < 0)
        return `In the middle of the last ${r.months.length} months, ${fmt.eur(-r.middleCents)} more went out than came in. Across the months, the difference between income and spending was between ${fmt.eur(r.lowCents)} and ${fmt.eur(r.highCents)}.`;
      if (r.lowCents < 0)
        return `Over the last ${r.months.length} months the difference between income and spending was between ${fmt.eur(r.lowCents)} and ${fmt.eur(r.highCents)} a month; the middle month was ${fmt.eur(r.middleCents)}. A negative amount means more went out than came in.`;
      return `Over the last ${r.months.length} months you had between ${fmt.eur(r.lowCents)} and ${fmt.eur(r.highCents)} left each month; the middle month was ${fmt.eur(r.middleCents)}.`;
    }
    if (r.kind === "stated")
      return `By your own answers, the difference between income and spending is between ${fmt.eur(r.lowCents)} and ${fmt.eur(r.highCents)} a month. This comes from your answers, not from bank data.`;
    return null;
  },
};

const fNl = planFmt("nl");
const fEn = planFmt("en");

const nl: MonthCopy = {
  reasons: {
    "room-ok": `In de middelste maand was de ruimte minstens ${fNl.pct(PLAN_NUMBERS.roomShare)} van je inkomen en geen maand was negatief. Dat percentage is een markering van LaVega zelf, geen regel.`,
    "room-low": `In de middelste maand was de ruimte lager dan ${fNl.pct(PLAN_NUMBERS.roomShare)} van je inkomen. Dat percentage is een markering van LaVega zelf, geen regel.`,
    "month-negative": "In minstens één van de drie maanden ging er meer uit dan er binnenkwam.",
    "history-short": `Er zijn minder dan ${PLAN_NUMBERS.historyDays} dagen aan gegevens en geen opgegeven bereik.`,
    "data-stale":
      "Een rekening heeft geen gegevens over de laatste volle maand, dus de cijfers rusten op oudere maanden.",
  },
  labels: {
    room: "Wat er per maand overblijft",
    middleMonth: "Middelste maand",
    lowMonth: "Laagste maand",
    highMonth: "Hoogste maand",
    fixed: "Vaste lasten",
    variable: "Overige uitgaven",
    savingsRate: "Spaarquote",
    savingsMoved: "Waarvan naar eigen spaarrekeningen verplaatst",
  },
  facts: {
    nibudGuidance: (value, source) =>
      `Het Nibud noemt ongeveer ${value} van het netto-inkomen (${source}).`,
  },
  headline: (f, fmt) => {
    const r = f.room;
    if (r.kind === "computed")
      return r.middleCents < 0
        ? `Middelste maand: ${fmt.eur(-r.middleCents)} meer uit dan in`
        : `Middelste maand ${fmt.eur(r.middleCents)}`;
    if (r.kind === "stated") return `${fmt.eurRange(r.lowCents, r.highCents)} per maand`;
    return DASH;
  },
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      const room = roomSentence.nl(f, fmt);
      if (room !== null) out.push(room);
      if (f.fixedShare !== null && f.variableShare !== null)
        out.push(
          `Vaste lasten zijn ${fmt.pct(f.fixedShare)} van je inkomen; de rest is ${fmt.pct(f.variableShare)}.`,
        );
      if (f.savingsRate !== null) out.push(`Je spaarquote was ${fmt.pct(f.savingsRate)}.`);
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      const room = roomSentence.nl(f, fmt);
      if (room !== null) out.push(room);
      if (f.room.kind === "computed") {
        if (f.room.partial)
          out.push("Er waren minder dan drie volle maanden beschikbaar; alleen die zijn gebruikt.");
        if (f.room.excludedForeignCount > 0)
          out.push(
            `${f.room.excludedForeignCount} regels in een andere valuta zijn niet meegeteld.`,
          );
        if (f.room.blockingAccounts.length > 0)
          out.push(
            `${f.room.blockingAccounts.length} rekening(en) hebben geen gegevens over elk van de laatste drie maanden.`,
          );
      }
      if (f.fixedCents !== null)
        out.push(
          `Vaste lasten zijn ${fmt.eur(f.fixedCents)} per maand: je woonlasten en de vaste lasten die je hebt bevestigd.`,
        );
      if (f.variableCents !== null)
        out.push(
          `Overige uitgaven zijn ${fmt.eur(f.variableCents)} per maand. Dit is een indeling op herkenning van terugkerende betalingen, niet op categorie.`,
        );
      if (f.fixedShare !== null && f.variableShare !== null)
        out.push(
          `Vaste lasten zijn ${fmt.pct(f.fixedShare)} van je inkomen; de rest is ${fmt.pct(f.variableShare)}.`,
        );
      if (f.savingsMovedCents !== null)
        out.push(
          `Naar je eigen spaarrekeningen ging gemiddeld ${fmt.eur(f.savingsMovedCents)} per maand.`,
        );
      if (f.savingsRate !== null)
        out.push(
          `Je spaarquote was ${fmt.pct(f.savingsRate)}: wat er per maand overbleef na alle uitgaven, gedeeld door je netto-inkomen, gemiddeld over de maanden. Wat naar je eigen spaarrekeningen ging, zit daar al in.`,
        );
      return out;
    },
  },
  empty: {
    "bank-data":
      "Banktransacties ontbreken. Zonder transacties zijn vaste en overige uitgaven en de spaarquote niet te berekenen. Er is niets geschat.",
    "history-60d": `Er zijn minder dan ${PLAN_NUMBERS.historyDays} dagen aan transacties. Daarmee is geen volle maand te berekenen. Er is niets geschat.`,
    "fixed-costs":
      "Je vaste lasten ontbreken. Zonder dat cijfer is het aandeel vaste lasten niet te berekenen. Er is niets geschat.",
    "stated-range":
      "Je inkomen als bereik ontbreekt. Zonder bankgegevens is er dan geen bereik voor het verschil tussen inkomsten en uitgaven. Er is niets geschat.",
    "account-stale":
      "Een rekening heeft geen gegevens over de laatste volle maand. Zolang dat zo is, rusten de cijfers voor je maand op oudere maanden en zijn ze niet berekend. Er is niets geschat.",
  },
  howCalculated: {
    "room-median":
      "We nemen de drie meest recente volle maanden van je persoonlijke rekeningen, laten overboekingen tussen eigen rekeningen weg en tellen per maand inkomsten min uitgaven. De middelste van de drie is de middelste maand.",
    "fixed-costs":
      "De vaste lasten zijn het bedrag uit je profiel: woonlasten plus de vaste lasten die je hebt bevestigd. Het is hetzelfde cijfer als bij Wat LaVega weet.",
    "variable-split":
      "Overige uitgaven zijn de uitgaven van de middelste maand min de vaste lasten.",
    "variable-floor":
      "De vaste lasten waren hoger dan de uitgaven van de middelste maand. Het verschil is niet negatief weergegeven; overige uitgaven staan op nul.",
    "savings-moved":
      "Het bedrag dat naar je eigen spaarrekeningen ging, gemiddeld over de gebruikte maanden.",
    "savings-rate":
      "Per maand: wat er overbleef (inkomsten min uitgaven; overboekingen naar je eigen rekeningen tellen niet als uitgave), gedeeld door het inkomen van die maand. De spaarquote is het gemiddelde van die maanden. Het bedrag dat naar je eigen spaarrekeningen ging, staat ernaast en wordt er niet nog eens bij opgeteld.",
  },
  education: [
    {
      conceptId: "room",
      title: "Wat betekent ruimte per maand?",
      body: "Ruimte is wat er in een maand overblijft nadat alles is betaald. Ze kan per maand verschillen, daarom staat hier een bereik.",
    },
    {
      conceptId: "fixed-vs-variable",
      title: "Vaste en overige uitgaven",
      body: "Vaste lasten komen elke maand terug, zoals huur of een verzekering. Overige uitgaven wisselen van maand tot maand.",
    },
    {
      conceptId: "paying-yourself-first",
      title: "Wat betekent 'eerst jezelf betalen'?",
      body: "Een term voor geld naar sparen verplaatsen zodra het inkomen binnen is, nog voor de rest van de uitgaven.",
    },
    {
      conceptId: "automatic-transfer",
      title: "Wat is een automatische overboeking?",
      body: "Een overboeking die de bank op een vaste dag en voor een vast bedrag zelf uitvoert.",
    },
    {
      conceptId: "annual-review",
      title: "Wat is een jaarlijkse controle?",
      body: "Een vast moment per jaar waarop iemand de eigen cijfers bekijkt.",
    },
  ],
};

const en: MonthCopy = {
  reasons: {
    "room-ok": `In the middle month the room was at least ${fEn.pct(PLAN_NUMBERS.roomShare)} of your income and no month was negative. That percentage is a marker LaVega uses itself, not a rule.`,
    "room-low": `In the middle month the room was below ${fEn.pct(PLAN_NUMBERS.roomShare)} of your income. That percentage is a marker LaVega uses itself, not a rule.`,
    "month-negative": "In at least one of the three months more went out than came in.",
    "history-short": `There are fewer than ${PLAN_NUMBERS.historyDays} days of data and no stated range.`,
    "data-stale":
      "An account has no data for the latest full month, so the figures rest on older months.",
  },
  labels: {
    room: "What is left each month",
    middleMonth: "Middle month",
    lowMonth: "Lowest month",
    highMonth: "Highest month",
    fixed: "Fixed costs",
    variable: "Other spending",
    savingsRate: "Savings rate",
    savingsMoved: "Of which moved to your own savings accounts",
  },
  facts: {
    nibudGuidance: (value, source) =>
      `Nibud's guidance mentions about ${value} of net income (${source}).`,
  },
  headline: (f, fmt) => {
    const r = f.room;
    if (r.kind === "computed")
      return r.middleCents < 0
        ? `Middle month: ${fmt.eur(-r.middleCents)} more out than in`
        : `Middle month ${fmt.eur(r.middleCents)}`;
    if (r.kind === "stated") return `${fmt.eurRange(r.lowCents, r.highCents)} a month`;
    return DASH;
  },
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      const room = roomSentence.en(f, fmt);
      if (room !== null) out.push(room);
      if (f.fixedShare !== null && f.variableShare !== null)
        out.push(
          `Fixed costs are ${fmt.pct(f.fixedShare)} of your income; the rest is ${fmt.pct(f.variableShare)}.`,
        );
      if (f.savingsRate !== null) out.push(`Your savings rate was ${fmt.pct(f.savingsRate)}.`);
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      const room = roomSentence.en(f, fmt);
      if (room !== null) out.push(room);
      if (f.room.kind === "computed") {
        if (f.room.partial)
          out.push("Fewer than three full months were available; only those were used.");
        if (f.room.excludedForeignCount > 0)
          out.push(`${f.room.excludedForeignCount} lines in another currency are not counted.`);
        if (f.room.blockingAccounts.length > 0)
          out.push(
            `${f.room.blockingAccounts.length} account(s) have no data for one of the last three months.`,
          );
      }
      if (f.fixedCents !== null)
        out.push(
          `Fixed costs are ${fmt.eur(f.fixedCents)} a month: your housing costs and the fixed costs you confirmed.`,
        );
      if (f.variableCents !== null)
        out.push(
          `Other spending is ${fmt.eur(f.variableCents)} a month. This is a split by recognising recurring payments, not by category.`,
        );
      if (f.fixedShare !== null && f.variableShare !== null)
        out.push(
          `Fixed costs are ${fmt.pct(f.fixedShare)} of your income; the rest is ${fmt.pct(f.variableShare)}.`,
        );
      if (f.savingsMovedCents !== null)
        out.push(
          `On average ${fmt.eur(f.savingsMovedCents)} a month went to your own savings accounts.`,
        );
      if (f.savingsRate !== null)
        out.push(
          `Your savings rate was ${fmt.pct(f.savingsRate)}: what was left each month after all spending, divided by your net income, averaged over the months. What went to your own savings accounts is already in it.`,
        );
      return out;
    },
  },
  empty: {
    "bank-data":
      "Bank transactions are missing. Without them, fixed and other spending and the savings rate cannot be calculated. Nothing has been estimated.",
    "history-60d": `There are fewer than ${PLAN_NUMBERS.historyDays} days of transactions. That is not enough for one full month. Nothing has been estimated.`,
    "fixed-costs":
      "Your fixed costs are missing. Without that figure the share of fixed costs cannot be calculated. Nothing has been estimated.",
    "stated-range":
      "Your income as a range is missing. Without bank data there is then no range for the difference between income and spending. Nothing has been estimated.",
    "account-stale":
      "An account has no data for the latest full month. While that is so, the figures for your month would rest on older months and have not been calculated. Nothing has been estimated.",
  },
  howCalculated: {
    "room-median":
      "We take the three most recent full months of your personal accounts, leave out transfers between your own accounts, and work out income minus spending for each month. The middle of the three is the middle month.",
    "fixed-costs":
      "Fixed costs are the amount in your profile: housing costs plus the fixed costs you confirmed. It is the same figure as in What LaVega knows.",
    "variable-split": "Other spending is the spending of the middle month minus the fixed costs.",
    "variable-floor":
      "Fixed costs were higher than the spending of the middle month. The difference is not shown as a negative; other spending is set to zero.",
    "savings-moved":
      "The amount that went to your own savings accounts, averaged over the months used.",
    "savings-rate":
      "For each month: what was left (income minus spending; transfers to your own accounts do not count as spending), divided by that month's income. The savings rate is the average of those months. The amount that went to your own savings accounts is shown beside it and not added again.",
  },
  education: [
    {
      conceptId: "room",
      title: "What does room per month mean?",
      body: "Room is what is left in a month after everything is paid. It can differ from month to month, so a range is shown here.",
    },
    {
      conceptId: "fixed-vs-variable",
      title: "Fixed and other spending",
      body: "Fixed costs come back every month, such as rent or an insurance policy. Other spending changes from month to month.",
    },
    {
      conceptId: "paying-yourself-first",
      title: "What does 'pay yourself first' mean?",
      body: "A term for moving money to savings as soon as income arrives, before the rest is spent.",
    },
    {
      conceptId: "automatic-transfer",
      title: "What is an automatic transfer?",
      body: "A transfer the bank carries out by itself on a fixed day and for a fixed amount.",
    },
    {
      conceptId: "annual-review",
      title: "What is an annual review?",
      body: "A set moment each year when someone looks at their own figures.",
    },
  ],
};

export const monthCopy: Record<Locale, MonthCopy> = { nl, en };
