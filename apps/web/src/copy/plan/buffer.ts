import type { BufferCalcId, BufferFigures } from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  type BufferMissingKind,
  type BufferReasonKey,
  type FactSlot,
  type PlanFmt,
  type SectionCopy,
} from "./shared.js";

/** Section 2: Buffer. Two lines that are never merged: the income buffer
 *  (months of fixed costs against the user's own target) and the object
 *  buffer (a typed result). */
export type BufferCopy = SectionCopy<
  BufferFigures,
  BufferReasonKey,
  BufferMissingKind,
  BufferCalcId
> & {
  labels: {
    incomeBuffer: string;
    objectBuffer: string;
    target: string;
    gap: string;
    liquid: string;
  };
  /** A worked example, not a plan: what the room each month would do to the
   *  difference if all of it went to the buffer. Null when it cannot be worked out. */
  closeExample: (f: BufferFigures, fmt: PlanFmt) => string | null;
  /** One line when the stated savings total and a goal's typed amount may be the same money. */
  statedOverlapNote: (goalCount: number) => string | null;
  /** Shown beside the target control when fixed costs are known. */
  targetInEuros: (months: string, amount: string) => string;
  irregularIncome: string;
  facts: { nibudPurpose: FactSlot };
};

const startNl = (months: number, fmt: PlanFmt): string =>
  months < 0
    ? "Je rekeningen staan samen onder nul, dus er is geen spaargeld dat vaste lasten dekt"
    : `Je hebt ${fmt.monthsLabel(months)} aan vaste lasten gespaard`;
const startEn = (months: number, fmt: PlanFmt): string =>
  months < 0
    ? "Your accounts together are below zero, so no savings cover fixed costs"
    : `You have ${fmt.monthsLabel(months)} of fixed costs saved`;

/** "4 months" when both ends are the same, else "2 to 4 months". */
const closeRange = (low: number, high: number, fmt: PlanFmt, to: string): string =>
  low === high ? fmt.monthsLabel(high) : `${fmt.months(low)} ${to} ${fmt.monthsLabel(high)}`;
const roomRange = (lowCents: number, highCents: number, fmt: PlanFmt): string =>
  lowCents === highCents ? fmt.eur(lowCents) : fmt.eurRange(lowCents, highCents);

const nl: BufferCopy = {
  reasons: {
    "at-target": "Je buffer is gelijk aan of groter dan je eigen streefwaarde.",
    "below-target": "Je buffer is kleiner dan je eigen streefwaarde.",
    "no-fixed-costs": "Zonder vaste lasten zijn de maanden aan buffer niet te berekenen.",
    "no-savings": "Zonder spaarsaldo is de buffer niet te berekenen.",
    "no-target": "Je hebt geen eigen streefwaarde ingevuld, dus er is niets om mee te vergelijken.",
  },
  labels: {
    incomeBuffer: "Buffer voor inkomen",
    objectBuffer: "Buffer voor grote kosten",
    target: "Jouw streefwaarde",
    gap: "Verschil met je streefwaarde",
    liquid: "Direct beschikbaar spaargeld",
  },
  closeExample: (f, fmt) =>
    f.closeMonths === null || f.closeMonths === "not-reachable" || f.closeRoom === null
      ? null
      : `Rekenvoorbeeld: als er elke maand ${roomRange(f.closeRoom.lowCents, f.closeRoom.highCents, fmt)} naar je buffer ging, zou het verschil in ${closeRange(f.closeMonths.low, f.closeMonths.high, fmt, "tot")} zijn gedicht. Er is geen datum beloofd en niets verplicht.`,
  statedOverlapNote: (n) =>
    n > 0
      ? `Je spaargeld is een bedrag dat je zelf hebt ingevuld, en bij ${n === 1 ? "een doel" : `${n} doelen`} staat ook een ingevuld gespaard bedrag. Dat kan hetzelfde geld zijn; dan telt het in de buffer en bij het doel allebei mee.`
      : null,
  targetInEuros: (months, amount) => `${months} maanden vaste lasten is ${amount}.`,
  irregularIncome:
    "Bij wisselend of zelfstandig inkomen werkt een buffer voor inkomen anders: de maanden met weinig inkomen zijn moeilijker te voorspellen.",
  facts: {
    nibudPurpose: (value, source) => `${value} (${source})`,
  },
  headline: (f, fmt) =>
    f.incomeBufferMonths === null
      ? DASH
      : f.incomeBufferMonths < 0
        ? "Onder nul"
        : `${fmt.monthsLabel(f.incomeBufferMonths)} aan vaste lasten`,
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.incomeBufferMonths !== null) {
        let s = startNl(f.incomeBufferMonths, fmt);
        if (f.targetMonths !== null && f.gapMonths !== null && f.gapCents !== null) {
          s +=
            f.gapMonths > 0
              ? `; je streefwaarde is ${fmt.months(f.targetMonths)}, dus ${fmt.monthsLabel(f.gapMonths)} (${fmt.eur(f.gapCents)}) ontbreken.`
              : `; je streefwaarde is ${fmt.months(f.targetMonths)}, die heb je bereikt.`;
        } else s += ".";
        out.push(s);
      }
      if (f.closeMonths === "not-reachable")
        out.push("Met de ruimte die er nu per maand overblijft, wordt het verschil niet kleiner.");
      else {
        const ex = nl.closeExample(f, fmt);
        if (ex !== null) out.push(ex);
      }
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.liquidSavingsCents !== null && f.fixedCostsMonthlyCents !== null)
        out.push(
          `Direct beschikbaar spaargeld is ${fmt.eur(f.liquidSavingsCents)}; je vaste lasten zijn ${fmt.eur(f.fixedCostsMonthlyCents)} per maand.`,
        );
      if (f.incomeBufferMonths !== null) {
        let s = startNl(f.incomeBufferMonths, fmt);
        if (f.targetMonths !== null && f.gapMonths !== null && f.gapCents !== null)
          s +=
            f.gapMonths > 0
              ? `; je streefwaarde is ${fmt.months(f.targetMonths)}, dus ${fmt.monthsLabel(f.gapMonths)} (${fmt.eur(f.gapCents)}) ontbreken.`
              : `; je streefwaarde is ${fmt.months(f.targetMonths)}, die heb je bereikt.`;
        else s += ".";
        out.push(s);
      }
      if (f.closeMonths === "not-reachable")
        out.push("Met de ruimte die er nu per maand overblijft, wordt het verschil niet kleiner.");
      else {
        const ex = nl.closeExample(f, fmt);
        if (ex !== null) out.push(ex);
      }
      if (f.objectBufferCents !== null) {
        out.push(
          `Je buffer voor grote kosten is ${fmt.eur(f.objectBufferCents)}, een uitkomst die je zelf hebt ingevuld.`,
        );
        if (f.objectShareOfSavings !== null)
          out.push(`Dat is ${fmt.pct(f.objectShareOfSavings)} van je spaargeld.`);
      }
      if (f.excludedForeignCount > 0)
        out.push(
          `${f.excludedForeignCount} spaarrekening(en) in een andere valuta zijn niet meegeteld.`,
        );
      if (f.goalLinkedExcludedCents > 0)
        out.push(
          `${fmt.eur(f.goalLinkedExcludedCents)} staat bij een doel en is hier niet meegeteld, zodat geld niet twee keer telt.`,
        );
      const overlap = nl.statedOverlapNote(f.statedOverlapGoalCount);
      if (overlap !== null) out.push(overlap);
      return out;
    },
  },
  empty: {
    "savings-balance":
      "Een spaarsaldo ontbreekt. Zonder saldo zijn de maanden aan buffer niet te berekenen. Er is niets geschat.",
    "fixed-costs":
      "Je vaste lasten ontbreken. Zonder dat cijfer is niet te zeggen hoeveel maanden je spaargeld dekt. Er is niets geschat.",
    "buffer-target":
      "Je eigen streefwaarde ontbreekt. Er is geen standaardwaarde gebruikt, dus er is niets om je buffer mee te vergelijken. Er is niets geschat.",
  },
  howCalculated: {
    "liquid-savings":
      "Direct beschikbaar spaargeld is de som van je persoonlijke spaar- en betaalrekeningen in euro, zonder rekeningen die aan een doel zijn gekoppeld. Als er geen saldo bekend is, gebruiken we het bedrag dat je zelf hebt ingevuld en markeren we dat als ingevuld.",
    "buffer-months": "Maanden aan buffer is het spaargeld gedeeld door je vaste lasten per maand.",
    "buffer-gap":
      "Het verschil is je streefwaarde min de maanden die je hebt, in maanden en in euro (maanden maal je vaste lasten).",
    "close-months":
      "Het verschil in euro gedeeld door de laagste en hoogste ruimte per maand. Is de ruimte nul of negatief, dan staat er dat het niet bereikbaar is.",
    "object-buffer":
      "Het bedrag dat je zelf hebt ingevuld, bijvoorbeeld uit een rekenhulp, en het aandeel dat dat is van je spaargeld.",
  },
  education: [
    {
      conceptId: "income-buffer",
      title: "Buffer voor inkomen",
      body: "Een buffer voor inkomen telt in maanden vaste lasten: hoeveel maanden de vaste lasten betaald kunnen worden zonder inkomen.",
    },
    {
      conceptId: "object-buffer",
      title: "Buffer voor grote kosten",
      body: "Een buffer voor grote kosten is bedoeld voor onverwachte uitgaven zoals een reparatie of een nieuw apparaat. Het is een andere vraag dan een buffer voor inkomen.",
    },
  ],
};

const en: BufferCopy = {
  reasons: {
    "at-target": "Your buffer is equal to or larger than your own target.",
    "below-target": "Your buffer is smaller than your own target.",
    "no-fixed-costs": "Without fixed costs, the months of buffer cannot be calculated.",
    "no-savings": "Without a savings balance, the buffer cannot be calculated.",
    "no-target": "You have not entered a target of your own, so there is nothing to compare with.",
  },
  labels: {
    incomeBuffer: "Buffer for income",
    objectBuffer: "Buffer for large costs",
    target: "Your target",
    gap: "Difference from your target",
    liquid: "Savings available now",
  },
  closeExample: (f, fmt) =>
    f.closeMonths === null || f.closeMonths === "not-reachable" || f.closeRoom === null
      ? null
      : `Worked example: if ${roomRange(f.closeRoom.lowCents, f.closeRoom.highCents, fmt)} each month went to your buffer, the difference would close in ${closeRange(f.closeMonths.low, f.closeMonths.high, fmt, "to")}. No date is promised and nothing is required.`,
  statedOverlapNote: (n) =>
    n > 0
      ? `Your savings figure is an amount you entered yourself, and ${n === 1 ? "one goal also has" : `${n} goals also have`} an entered saved amount. That can be the same money; if so, it counts in the buffer and in the goal both.`
      : null,
  targetInEuros: (months, amount) => `${months} months of fixed costs is ${amount}.`,
  irregularIncome:
    "With irregular or self-employed income a buffer for income works differently: the months with little income are harder to predict.",
  facts: {
    nibudPurpose: (value, source) => `${value} (${source})`,
  },
  headline: (f, fmt) =>
    f.incomeBufferMonths === null
      ? DASH
      : f.incomeBufferMonths < 0
        ? "Below zero"
        : `${fmt.monthsLabel(f.incomeBufferMonths)} of fixed costs`,
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.incomeBufferMonths !== null) {
        let s = startEn(f.incomeBufferMonths, fmt);
        if (f.targetMonths !== null && f.gapMonths !== null && f.gapCents !== null) {
          s +=
            f.gapMonths > 0
              ? `; your target is ${fmt.months(f.targetMonths)}, so ${fmt.monthsLabel(f.gapMonths)} (${fmt.eur(f.gapCents)}) remain.`
              : `; your target is ${fmt.months(f.targetMonths)}, which you have reached.`;
        } else s += ".";
        out.push(s);
      }
      if (f.closeMonths === "not-reachable")
        out.push("At the room left each month today, the difference does not get smaller.");
      else {
        const ex = en.closeExample(f, fmt);
        if (ex !== null) out.push(ex);
      }
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.liquidSavingsCents !== null && f.fixedCostsMonthlyCents !== null)
        out.push(
          `Savings available now are ${fmt.eur(f.liquidSavingsCents)}; your fixed costs are ${fmt.eur(f.fixedCostsMonthlyCents)} a month.`,
        );
      if (f.incomeBufferMonths !== null) {
        let s = startEn(f.incomeBufferMonths, fmt);
        if (f.targetMonths !== null && f.gapMonths !== null && f.gapCents !== null)
          s +=
            f.gapMonths > 0
              ? `; your target is ${fmt.months(f.targetMonths)}, so ${fmt.monthsLabel(f.gapMonths)} (${fmt.eur(f.gapCents)}) remain.`
              : `; your target is ${fmt.months(f.targetMonths)}, which you have reached.`;
        else s += ".";
        out.push(s);
      }
      if (f.closeMonths === "not-reachable")
        out.push("At the room left each month today, the difference does not get smaller.");
      else {
        const ex = en.closeExample(f, fmt);
        if (ex !== null) out.push(ex);
      }
      if (f.objectBufferCents !== null) {
        out.push(
          `Your buffer for large costs is ${fmt.eur(f.objectBufferCents)}, a result you entered yourself.`,
        );
        if (f.objectShareOfSavings !== null)
          out.push(`That is ${fmt.pct(f.objectShareOfSavings)} of your savings.`);
      }
      if (f.excludedForeignCount > 0)
        out.push(
          `${f.excludedForeignCount} savings account(s) in another currency are not counted.`,
        );
      if (f.goalLinkedExcludedCents > 0)
        out.push(
          `${fmt.eur(f.goalLinkedExcludedCents)} sits with a goal and is not counted here, so money is not counted twice.`,
        );
      const overlap = en.statedOverlapNote(f.statedOverlapGoalCount);
      if (overlap !== null) out.push(overlap);
      return out;
    },
  },
  empty: {
    "savings-balance":
      "A savings balance is missing. Without a balance, the months of buffer cannot be calculated. Nothing has been estimated.",
    "fixed-costs":
      "Your fixed costs are missing. Without that figure, how many months your savings cover cannot be stated. Nothing has been estimated.",
    "buffer-target":
      "Your own target is missing. No default was used, so there is nothing to compare your buffer with. Nothing has been estimated.",
  },
  howCalculated: {
    "liquid-savings":
      "Savings available now are the sum of your personal savings and current accounts in euros, leaving out accounts linked to a goal. If no balance is known, we use the amount you entered yourself and mark it as entered.",
    "buffer-months": "Months of buffer are the savings divided by your fixed costs per month.",
    "buffer-gap":
      "The difference is your target minus the months you have, in months and in euros (months times your fixed costs).",
    "close-months":
      "The difference in euros divided by the lowest and highest room per month. If the room is zero or negative, it says the difference is not reachable.",
    "object-buffer":
      "The amount you entered yourself, for example from a calculator, and the share it is of your savings.",
  },
  education: [
    {
      conceptId: "income-buffer",
      title: "Buffer for income",
      body: "A buffer for income is counted in months of fixed costs: how many months the fixed costs can be paid without income.",
    },
    {
      conceptId: "object-buffer",
      title: "Buffer for large costs",
      body: "A buffer for large costs is meant for unexpected expenses such as a repair or a new appliance. It answers a different question than a buffer for income.",
    },
  ],
};

export const bufferCopy: Record<Locale, BufferCopy> = { nl, en };
