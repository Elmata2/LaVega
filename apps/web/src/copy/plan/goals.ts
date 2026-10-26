import { publicScenarioTable } from "@lavega/core";
import type {
  GoalRow,
  GoalsCalcId,
  GoalsFigures,
  PendingPublicFactId,
  PublicFact,
  UnallocatedLine,
} from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  PLAN_NUMBERS,
  planFmt,
  factLine,
  type Education,
  type FactSlot,
  type GoalsMissingKind,
  type GoalsReasonKey,
  type PlanFmt,
  type SectionCopy,
} from "./shared.js";

/** Section 7: Goals. The money left over is "not allocated";
 *  nothing says what to do with it. A goal card never says where money needed
 *  soon should be kept: that sits in one general card, the same for everyone,
 *  and only once its source is verified. */
export type GoalsFactId = Extract<
  PendingPublicFactId,
  | "gift-tax-annual-2026"
  | "gift-tax-one-time-18-40"
  | "box3-minors"
  | "afm-costs"
  | "spiva-europe"
  | "hist-fall-2008"
  | "hist-fall-2020"
  | "duo-rules"
>;

export type GoalsCopy = SectionCopy<GoalsFigures, GoalsReasonKey, GoalsMissingKind, GoalsCalcId> & {
  labels: {
    unallocated: string;
    capacity: string;
    tolerance: string;
    target: string;
    saved: string;
    funded: string;
    gap: string;
    required: string;
    yearsLeft: string;
  };
  /** Computed: both ends use the same deductions. */
  unallocatedLine: (line: Extract<UnallocatedLine, { kind: "computed" }>, fmt: PlanFmt) => string;
  /** The short form of the same line, for the card's headline. */
  unallocatedHeadline: (
    line: Extract<UnallocatedLine, { kind: "computed" }>,
    fmt: PlanFmt,
  ) => string;
  unallocatedStopped: (missing: Extract<UnallocatedLine, { kind: "stopped" }>["missing"]) => string;
  stoppedPart: Record<Extract<UnallocatedLine, { kind: "stopped" }>["missing"][number], string>;
  capacityLine: (capacity: number | null, tolerance: number | null) => string;
  disagreement: Record<GoalsFigures["disagreement"], string>;
  lossLine: (loss: NonNullable<GoalsFigures["loss"]>, amountLabel: string, fmt: PlanFmt) => string;
  goal: {
    savedLine: (row: GoalRow, fmt: PlanFmt) => string;
    savedSource: Record<GoalRow["savedSource"], string>;
    /** A figure the person typed is as of the day it was typed: the schedule's start. */
    statedAsOf: (date: string, fmt: PlanFmt) => string;
    /** Where the straight line starts and ends. */
    scheduleSpan: (row: GoalRow, fmt: PlanFmt) => string | null;
    gapLine: (row: GoalRow, fmt: PlanFmt) => string;
    scheduleLine: (row: GoalRow, fmt: PlanFmt) => string | null;
    requiredLine: (row: GoalRow, fmt: PlanFmt) => string[];
    sharedLine: (n: number, balanceCents: number, fmt: PlanFmt) => string | null;
    excludedLine: (n: number) => string | null;
    brokerLine: (n: number) => string | null;
    undated: string;
  };
  studyLine: (s: NonNullable<GoalsFigures["study"]>, fmt: PlanFmt) => string;
  scenario: {
    title: string;
    caption: string;
    assumptions: (t: ScenarioTable, fmt: PlanFmt) => string;
    cell: (gross: string, cost: string, end: string) => string;
    grossLabel: string;
    costLabel: string;
  };
  /** The single general card about short horizons. Text only from the
   *  verified AFM fact; null while it is not showable. */
  learnShortHorizon: { title: string; body: FactSlot };
  facts: Record<GoalsFactId, FactSlot>;
};

/** The short-horizon card text, or null while the AFM fact is not showable. */
export function learnShortHorizonText(
  locale: Locale,
  facts?: readonly PublicFact[],
): string | null {
  return factLine("afm-long-term", goalsCopy[locale].learnShortHorizon.body, facts);
}

type ScenarioTable = ReturnType<typeof publicScenarioTable>;
/** "€100" when both ends are the same, else "€100 to €300". */
const spanOf = (low: number, high: number, fmt: PlanFmt): string =>
  low === high ? fmt.eur(low) : fmt.eurRange(low, high);
const listNl = (xs: string[]): string =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} en ${xs[xs.length - 1]}`;
const listEn = (xs: string[]): string =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const educationNl: Education[] = [
  {
    conceptId: "index-fund",
    title: "Wat is een indexfonds?",
    body: "Een indexfonds volgt een lijst van bedrijven of obligaties, de index, in plaats van daaruit te kiezen. Wat het bevat en wat het kost staat in de documenten van het fonds.",
  },
  {
    conceptId: "costs-over-time",
    title: "Kosten over de tijd",
    body: "Kosten worden elk jaar als percentage berekend. Over een lange tijd tellen kleine verschillen per jaar op, zoals de tabel hieronder laat zien.",
  },
  {
    conceptId: "diversification",
    title: "Spreiden",
    body: "Geld over veel bedrijven, sectoren en landen verdelen betekent dat één tegenvaller minder zwaar weegt in het geheel. Het sluit niet uit dat de waarde daalt.",
  },
  {
    conceptId: "instrument-differences",
    title: "Verschillen tussen sparen, deposito's, obligaties, fondsen en aandelen",
    body: "Deze vormen verschillen in kosten, risico, hoe snel het geld beschikbaar is en hoe ze belast worden. Die verschillen zijn te vergelijken zonder dat één vorm als de juiste wordt aangewezen.",
  },
];

const educationEn: Education[] = [
  {
    conceptId: "index-fund",
    title: "What is an index fund?",
    body: "An index fund follows a list of companies or bonds, the index, instead of choosing among them. What it holds and what it costs is in the fund's documents.",
  },
  {
    conceptId: "costs-over-time",
    title: "Costs over time",
    body: "Costs are charged each year as a percentage. Over a long time, small differences per year add up, as the table below shows.",
  },
  {
    conceptId: "diversification",
    title: "Spreading",
    body: "Spreading money over many companies, sectors and countries means one setback weighs less in the whole. It does not rule out a fall in value.",
  },
  {
    conceptId: "instrument-differences",
    title: "How savings, deposits, bonds, funds and shares differ",
    body: "These forms differ in cost, risk, how fast the money is available and how they are taxed. The differences can be compared without pointing to one form as the right one.",
  },
];

const nl: GoalsCopy = {
  reasons: {
    "on-schedule":
      "Bij elk doel met een einddatum is het gespaarde bedrag gelijk aan of hoger dan het schema in een rechte lijn.",
    "behind-schedule":
      "Bij minstens één doel ligt het gespaarde bedrag onder het schema in een rechte lijn.",
    "no-goals": "Er zijn nog geen doelen ingevuld.",
    "no-room": "Er is geen cijfer voor je ruimte per maand.",
    "no-goal-dates":
      "Bij geen enkel doel is een einddatum bekend, dus er is geen schema om mee te vergelijken.",
  },
  labels: {
    unallocated: "Niet toegewezen per maand",
    capacity: "Draagkracht",
    tolerance: "Risicotolerantie",
    target: "Doelbedrag",
    saved: "Tot nu toe gespaard",
    funded: "Gedekt",
    gap: "Verschil met het doel",
    required: "Maandbedrag in deze rekensom",
    yearsLeft: "Jaren te gaan",
  },
  unallocatedLine: (l, fmt) => {
    const d = l.deductions;
    const goals =
      d.goalsPlannedCents > 0 && d.goalsRequiredCents > 0
        ? ` en min wat je zelf voor je doelen hebt gepland (${fmt.eur(d.goalsPlannedCents)}) en, voor doelen waarvoor je niets hebt gepland, wat elk doel bij ${fmt.pct(PLAN_NUMBERS.requirementRate)} rendement nodig heeft (${fmt.eur(d.goalsRequiredCents)}, een rekensom van LaVega zelf)`
        : d.goalsRequiredCents > 0
          ? ` en min wat je doelen bij ${fmt.pct(PLAN_NUMBERS.requirementRate)} rendement nodig hebben (${fmt.eur(d.goalsRequiredCents)}, een rekensom van LaVega zelf; je hebt zelf niets gepland)`
          : d.goalsPlannedCents > 0
            ? ` en min wat je zelf voor je doelen hebt gepland (${fmt.eur(d.goalsPlannedCents)})`
            : ` en min het maandelijkse sparen voor je doelen (${fmt.eur(0)})`;
    const base = `Je ruimte van ${spanOf(l.roomLowCents, l.roomHighCents, fmt)} per maand, min de maandelijkse aanvulling van je buffer (${fmt.eur(d.bufferTopUpMonthlyCents)})${goals}.`;
    if (l.lowCents >= 0)
      return `${base} Per maand is ${spanOf(l.lowCents, l.highCents, fmt)} niet toegewezen.`;
    if (l.highCents < 0)
      return `${base} Na deze aftrekposten gaat er per maand ${spanOf(-l.highCents, -l.lowCents, fmt)} meer uit dan er binnenkomt.`;
    return `${base} Na deze aftrekposten loopt de uitkomst van ${fmt.eur(-l.lowCents)} per maand meer uit dan erin, tot ${fmt.eur(l.highCents)} per maand die niet is toegewezen.`;
  },
  unallocatedHeadline: (l, fmt) =>
    l.lowCents >= 0
      ? `${spanOf(l.lowCents, l.highCents, fmt)} per maand niet toegewezen`
      : l.highCents < 0
        ? `${spanOf(-l.highCents, -l.lowCents, fmt)} per maand meer uit dan erin, na aftrekposten`
        : `Van ${fmt.eur(-l.lowCents)} meer uit tot ${fmt.eur(l.highCents)} niet toegewezen per maand`,
  unallocatedStopped: (missing) =>
    `De regel voor wat niet is toegewezen stopt, omdat dit ontbreekt: ${missing.map((m) => nl.stoppedPart[m]).join(", ")}.`,
  stoppedPart: {
    room: "je ruimte per maand",
    "room-stale": "recente bankgegevens: je ruimte per maand rust op oudere maanden",
    "buffer-top-up": "het aantal maanden waarover je buffer wordt aangevuld",
    "goal-monthly": "het maandbedrag van een doel",
  },
  capacityLine: (c, t) =>
    `Draagkracht uit je cijfers (schaal 1 tot 5): ${c === null ? DASH : c}. Risicotolerantie uit je antwoorden (schaal 1 tot 5): ${t === null ? DASH : t}.`,
  disagreement: {
    disagree:
      "Deze twee wijken van elkaar af. Ze meten iets anders: draagkracht gaat over je financiën, tolerantie over hoe een daling voor je voelt.",
    agree: "Deze twee liggen dicht bij elkaar.",
    unknown: "Er is niet genoeg bekend om de twee te vergelijken.",
  },
  lossLine: (loss, amountLabel, fmt) =>
    loss.monthsOfRoom === null
      ? `Als ${amountLabel} met ${fmt.points(PLAN_NUMBERS.lossFallPct)} zou dalen, is dat ${fmt.eur(loss.lossCents)}. Dit is een rekenvoorbeeld, geen verwachting.`
      : `Als ${amountLabel} met ${fmt.points(PLAN_NUMBERS.lossFallPct)} zou dalen, is dat ${fmt.eur(loss.lossCents)}, gelijk aan ${fmt.monthsLabel(loss.monthsOfRoom)} van je middelste ruimte. Dit is een rekenvoorbeeld, geen verwachting.`,
  goal: {
    savedLine: (r, fmt) =>
      r.allocatedSavedCents < 0
        ? `${r.purpose}: het meegetelde saldo staat op ${fmt.eur(r.allocatedSavedCents)}, dus rood. Er is niets gespaard voor het doel van ${fmt.eur(r.targetCents)}.`
        : `${r.purpose}: ${fmt.eur(r.allocatedSavedCents)} van ${fmt.eur(r.targetCents)} gespaard${r.fundedRatio === null ? "" : ` (${fmt.pct(r.fundedRatio)})`}.`,
    savedSource: {
      linked: "uit gekoppelde rekeningen",
      stated: "door jou ingevuld",
    },
    statedAsOf: (date, fmt) =>
      `Het ingevulde bedrag geldt per ${fmt.date(date)}. Het wordt niet bijgewerkt tot je het opnieuw invult.`,
    scheduleSpan: (r, fmt) =>
      r.scheduleFrom === null || r.toTargetByDate === null
        ? null
        : `Het schema loopt in een rechte lijn van de stand op ${fmt.date(r.scheduleFrom)} naar het doelbedrag op ${fmt.date(r.toTargetByDate)}.`,
    gapLine: (r, fmt) =>
      r.gapCents >= 0
        ? `Het verschil met het doel is ${fmt.eur(r.gapCents)}.`
        : `Het doel is met ${fmt.eur(-r.gapCents)} overschreden.`,
    scheduleLine: (r, fmt) =>
      r.scheduleCents === null || r.behind === null
        ? null
        : r.behind
          ? `Het gespaarde bedrag ligt onder het schema in een rechte lijn van ${fmt.eur(r.scheduleCents)} voor vandaag.`
          : `Het gespaarde bedrag is gelijk aan of hoger dan het schema in een rechte lijn van ${fmt.eur(r.scheduleCents)} voor vandaag.`,
    requiredLine: (r, fmt) =>
      r.requiredMonthly.map((x) =>
        x.cents === null || r.toTargetByDate === null
          ? `Bij ${fmt.pct(x.rate)} rendement is het maandbedrag niet te berekenen.`
          : `Voor dit doel haalt ${fmt.eur(x.cents)} per maand bij ${fmt.pct(x.rate)} het doel op ${fmt.date(r.toTargetByDate)}.`,
      ),
    sharedLine: (n, balance, fmt) =>
      n > 0
        ? `Een deel van deze rekeningen is ook gekoppeld aan ${n} ander${n === 1 ? "" : "e"} doel${n === 1 ? "" : "en"}. Het gedeelde saldo is ${fmt.eur(balance)}; voor dit doel telt een gelijk deel mee, omdat het saldo gelijk wordt verdeeld over de ${n + 1} doelen die het delen. In de totalen telt het één keer.`
        : null,
    excludedLine: (n) =>
      n > 0
        ? `${n} gekoppelde rekening(en) tellen niet mee: een andere valuta, geen bekend saldo of niet gevonden.`
        : null,
    brokerLine: (n) => (n > 0 ? `${n} koppeling(en) met een broker tellen niet mee.` : null),
    undated: "Dit doel heeft geen einddatum; er is geen schema berekend.",
  },
  studyLine: (s, fmt) =>
    `Studieplan tegen prijzen van nu: ${fmt.eur(s.totalCents)} (${fmt.eur(s.monthlyCostCents)} per maand gedurende ${s.months} maanden plus ${fmt.eur(s.tuitionCents)} collegegeld). Je hebt een prijsstijging van ${fmt.points(s.inflationPct)} per jaar ingevuld; die zit niet in dit bedrag.`,
  scenario: {
    title: "Een voorbeeld met vaste aannames",
    caption: "Een illustratie met vermelde aannames, geen voorspelling en geen keuze voor jou.",
    assumptions: (t, fmt) =>
      `${fmt.eur(t.monthlyCents)} per maand gedurende ${t.years} jaar (${fmt.eur(t.paidInCents)} ingelegd). Rendement vóór kosten ${listNl(t.grossRates.map((r) => fmt.pct(r)))}; kosten ${listNl(t.costs.map((r) => fmt.pct(r)))} per jaar. Maandelijkse rente-op-rente, inleg aan het einde van de maand, vast rendement, geen belasting, geen inflatie.`,
    cell: (gross, cost, end) =>
      `Bij ${gross} rendement en ${cost} kosten per jaar is het eindbedrag ${end}.`,
    grossLabel: "Rendement vóór kosten",
    costLabel: "Kosten per jaar",
  },
  learnShortHorizon: {
    title: "Geld dat je binnenkort nodig hebt",
    body: (value, source) => `${value} (${source})`,
  },
  facts: {
    "gift-tax-annual-2026": (value, source) => `${value} (${source})`,
    "gift-tax-one-time-18-40": (value, source) => `${value} (${source})`,
    "box3-minors": (value, source) => `${value} (${source})`,
    "afm-costs": (value, source) => `${value} (${source})`,
    "spiva-europe": (value, source) => `${value} (${source})`,
    "hist-fall-2008": (value, source) => `${value} (${source})`,
    "hist-fall-2020": (value, source) => `${value} (${source})`,
    "duo-rules": (value, source) => `${value} (${source})`,
  },
  headline: (f, fmt) => {
    if (f.unallocated.kind === "computed") return nl.unallocatedHeadline(f.unallocated, fmt);
    return f.rows.length > 0 ? `${f.rows.length} doel${f.rows.length === 1 ? "" : "en"}` : DASH;
  },
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.unallocated.kind === "computed") out.push(nl.unallocatedLine(f.unallocated, fmt));
      else if (f.rows.length > 0) out.push(nl.unallocatedStopped(f.unallocated.missing));
      for (const r of f.rows) out.push(nl.goal.savedLine(r, fmt));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.unallocated.kind === "computed") out.push(nl.unallocatedLine(f.unallocated, fmt));
      else if (f.rows.length > 0) out.push(nl.unallocatedStopped(f.unallocated.missing));
      for (const r of f.rows) {
        out.push(nl.goal.savedLine(r, fmt));
        out.push(`Het gespaarde bedrag is ${nl.goal.savedSource[r.savedSource]}.`);
        if (r.savedSource === "stated" && r.scheduleFrom !== null)
          out.push(nl.goal.statedAsOf(r.scheduleFrom, fmt));
        out.push(nl.goal.gapLine(r, fmt));
        const sch = nl.goal.scheduleLine(r, fmt);
        out.push(sch ?? nl.goal.undated);
        const span = nl.goal.scheduleSpan(r, fmt);
        if (span !== null) out.push(span);
        out.push(...nl.goal.requiredLine(r, fmt));
        for (const x of [
          nl.goal.sharedLine(r.sharedWithGoals, r.savedCents, fmt),
          nl.goal.excludedLine(r.linkedExcludedCount),
          nl.goal.brokerLine(r.brokerRefsNotCounted),
        ])
          if (x !== null) out.push(x);
      }
      out.push(nl.capacityLine(f.capacity.score, f.toleranceScore));
      out.push(nl.disagreement[f.disagreement]);
      if (f.loss !== null)
        out.push(nl.lossLine(f.loss, "het bedrag dat je in beleggingen hebt", fmt));
      if (f.study !== null) out.push(nl.studyLine(f.study, fmt));
      return out;
    },
  },
  empty: {
    goals:
      "Er is nog geen doel ingevuld. Zonder doel is er geen schema, geen maandbedrag en geen regel voor wat niet is toegewezen. De vaste voorbeeldtabel hieronder heeft niets van jou nodig. Er is niets geschat.",
    "goal-date":
      "Bij een doel ontbreekt de einddatum. Zonder datum is er geen schema en geen maandbedrag. Er is niets geschat.",
    room: "Je ruimte per maand ontbreekt. Zonder dat cijfer is er geen regel voor wat niet is toegewezen. De berekeningen per doel staan er wel. Er is niets geschat.",
  },
  howCalculated: {
    "goal-saved":
      "Het gespaarde bedrag is de som van de gekoppelde rekeningen in euro. Zonder gekoppelde rekening is het het bedrag dat jij hebt ingevuld. Een rekening die aan meer doelen hangt, staat bij elk doel; de totalen tellen haar één keer.",
    "goal-required-monthly":
      "Het maandbedrag waarmee het gespaarde bedrag het doel bereikt in de resterende maanden: bij 0% is dat het verschil gedeeld door de maanden, bij de andere rendementen met maandelijkse rente-op-rente en inleg aan het einde van de maand.",
    "goal-schedule":
      "Het schema in een rechte lijn loopt van de stand op de startdatum, het gespaarde bedrag op de dag dat het voor het eerst of voor het laatst is vastgelegd, naar het doelbedrag op de einddatum. Het gespaarde bedrag wordt vergeleken met het punt van vandaag op die lijn.",
    unallocated: `De ruimte per maand (laagste en hoogste) min de maandelijkse aanvulling van de buffer min het maandbedrag van alle doelen. Voor een doel is dat het bedrag dat jij zelf hebt gepland; heb je niets gepland, dan is het wat het doel bij ${planFmt("nl").pct(PLAN_NUMBERS.requirementRate)} rendement nodig heeft, een rekensom van LaVega zelf. Dezelfde aftrekposten gaan van beide uiteinden af. Kan een aftrekpost niet worden berekend, dan stopt de regel en staat erbij welke.`,
    "loss-illustration": `Een daling van ${planFmt("nl").points(PLAN_NUMBERS.lossFallPct)} van het bedrag dat je in beleggingen hebt, in euro, en hoeveel maanden van je middelste ruimte dat is. Het wordt alleen berekend als dat bedrag bekend is.`,
  },
  education: educationNl,
};

const en: GoalsCopy = {
  reasons: {
    "on-schedule":
      "For every goal that has an end date, the amount saved is equal to or above the straight-line schedule.",
    "behind-schedule":
      "For at least one goal, the amount saved is below the straight-line schedule.",
    "no-goals": "No goals have been entered yet.",
    "no-room": "There is no figure for your room each month.",
    "no-goal-dates": "No goal has an end date, so there is no schedule to compare with.",
  },
  labels: {
    unallocated: "Not allocated each month",
    capacity: "Capacity",
    tolerance: "Risk tolerance",
    target: "Target amount",
    saved: "Saved so far",
    funded: "Funded",
    gap: "Difference from the goal",
    required: "Monthly amount in this calculation",
    yearsLeft: "Years left",
  },
  unallocatedLine: (l, fmt) => {
    const d = l.deductions;
    const goals =
      d.goalsPlannedCents > 0 && d.goalsRequiredCents > 0
        ? ` and minus what you planned for your goals (${fmt.eur(d.goalsPlannedCents)}) and, for goals where you planned nothing, what each goal needs at a ${fmt.pct(PLAN_NUMBERS.requirementRate)} return (${fmt.eur(d.goalsRequiredCents)}, a calculation by LaVega itself)`
        : d.goalsRequiredCents > 0
          ? ` and minus what your goals need at a ${fmt.pct(PLAN_NUMBERS.requirementRate)} return (${fmt.eur(d.goalsRequiredCents)}, a calculation by LaVega itself; you planned nothing yourself)`
          : d.goalsPlannedCents > 0
            ? ` and minus what you planned for your goals (${fmt.eur(d.goalsPlannedCents)})`
            : ` and minus the monthly saving for your goals (${fmt.eur(0)})`;
    const base = `Your room of ${spanOf(l.roomLowCents, l.roomHighCents, fmt)} a month, minus the monthly top-up of your buffer (${fmt.eur(d.bufferTopUpMonthlyCents)})${goals}.`;
    if (l.lowCents >= 0)
      return `${base} ${spanOf(l.lowCents, l.highCents, fmt)} a month is not allocated.`;
    if (l.highCents < 0)
      return `${base} After these deductions, ${spanOf(-l.highCents, -l.lowCents, fmt)} a month more goes out than comes in.`;
    return `${base} After these deductions the result runs from ${fmt.eur(-l.lowCents)} a month more going out than coming in to ${fmt.eur(l.highCents)} a month not allocated.`;
  },
  unallocatedHeadline: (l, fmt) =>
    l.lowCents >= 0
      ? `${spanOf(l.lowCents, l.highCents, fmt)} a month not allocated`
      : l.highCents < 0
        ? `${spanOf(-l.highCents, -l.lowCents, fmt)} a month more out than in, after deductions`
        : `From ${fmt.eur(-l.lowCents)} more out to ${fmt.eur(l.highCents)} not allocated a month`,
  unallocatedStopped: (missing) =>
    `The line for what is not allocated stops, because this is missing: ${missing.map((m) => en.stoppedPart[m]).join(", ")}.`,
  stoppedPart: {
    room: "your room each month",
    "room-stale": "recent bank data: your room each month rests on older months",
    "buffer-top-up": "the number of months over which your buffer is topped up",
    "goal-monthly": "the monthly amount of a goal",
  },
  capacityLine: (c, t) =>
    `Capacity from your figures (scale 1 to 5): ${c === null ? DASH : c}. Risk tolerance from your answers (scale 1 to 5): ${t === null ? DASH : t}.`,
  disagreement: {
    disagree:
      "These two differ. They measure different things: capacity is about your finances, tolerance is about how a fall feels to you.",
    agree: "These two are close to each other.",
    unknown: "Not enough is known to compare the two.",
  },
  lossLine: (loss, amountLabel, fmt) =>
    loss.monthsOfRoom === null
      ? `If ${amountLabel} fell ${fmt.points(PLAN_NUMBERS.lossFallPct)}, that would be ${fmt.eur(loss.lossCents)}. This is a worked example, not an expectation.`
      : `If ${amountLabel} fell ${fmt.points(PLAN_NUMBERS.lossFallPct)}, that would be ${fmt.eur(loss.lossCents)}, equal to ${fmt.monthsLabel(loss.monthsOfRoom)} of your middle room. This is a worked example, not an expectation.`,
  goal: {
    savedLine: (r, fmt) =>
      r.allocatedSavedCents < 0
        ? `${r.purpose}: the balance counted for this goal is ${fmt.eur(r.allocatedSavedCents)}, so overdrawn. Nothing is saved toward the goal of ${fmt.eur(r.targetCents)}.`
        : `${r.purpose}: ${fmt.eur(r.allocatedSavedCents)} of ${fmt.eur(r.targetCents)} saved${r.fundedRatio === null ? "" : ` (${fmt.pct(r.fundedRatio)})`}.`,
    savedSource: {
      linked: "from linked accounts",
      stated: "entered by you",
    },
    statedAsOf: (date, fmt) =>
      `The entered amount is as of ${fmt.date(date)}. It is not updated until you enter it again.`,
    scheduleSpan: (r, fmt) =>
      r.scheduleFrom === null || r.toTargetByDate === null
        ? null
        : `The schedule is a straight line from the amount on ${fmt.date(r.scheduleFrom)} to the target amount on ${fmt.date(r.toTargetByDate)}.`,
    gapLine: (r, fmt) =>
      r.gapCents >= 0
        ? `The difference from the goal is ${fmt.eur(r.gapCents)}.`
        : `The goal is exceeded by ${fmt.eur(-r.gapCents)}.`,
    scheduleLine: (r, fmt) =>
      r.scheduleCents === null || r.behind === null
        ? null
        : r.behind
          ? `The amount saved is below the straight-line schedule of ${fmt.eur(r.scheduleCents)} for today.`
          : `The amount saved is equal to or above the straight-line schedule of ${fmt.eur(r.scheduleCents)} for today.`,
    requiredLine: (r, fmt) =>
      r.requiredMonthly.map((x) =>
        x.cents === null || r.toTargetByDate === null
          ? `At a ${fmt.pct(x.rate)} return, the monthly amount cannot be calculated.`
          : `For this goal, ${fmt.eur(x.cents)} a month at ${fmt.pct(x.rate)} reaches the target by ${fmt.date(r.toTargetByDate)}.`,
      ),
    sharedLine: (n, balance, fmt) =>
      n > 0
        ? `Some of these accounts are also linked to ${n} other goal${n === 1 ? "" : "s"}. The shared balance is ${fmt.eur(balance)}; an equal part counts for this goal, because the balance is split equally across the ${n + 1} goals that share it. The totals count it once.`
        : null,
    excludedLine: (n) =>
      n > 0
        ? `${n} linked account(s) are not counted: another currency, no known balance or not found.`
        : null,
    brokerLine: (n) => (n > 0 ? `${n} broker link(s) are not counted.` : null),
    undated: "This goal has no end date; no schedule has been calculated.",
  },
  studyLine: (s, fmt) =>
    `Study plan at today's prices: ${fmt.eur(s.totalCents)} (${fmt.eur(s.monthlyCostCents)} a month for ${s.months} months plus ${fmt.eur(s.tuitionCents)} tuition). You entered a price rise of ${fmt.points(s.inflationPct)} a year; it is not in this amount.`,
  scenario: {
    title: "An example with fixed assumptions",
    caption: "An illustration with stated assumptions, not a forecast and not a choice for you.",
    assumptions: (t, fmt) =>
      `${fmt.eur(t.monthlyCents)} a month for ${t.years} years (${fmt.eur(t.paidInCents)} paid in). Gross returns of ${listEn(t.grossRates.map((r) => fmt.pct(r)))}; costs of ${listEn(t.costs.map((r) => fmt.pct(r)))} a year. Monthly compounding, contributions at month end, constant return, no tax, no inflation.`,
    cell: (gross, cost, end) =>
      `At a ${gross} return and ${cost} costs a year, the end amount is ${end}.`,
    grossLabel: "Gross return",
    costLabel: "Costs per year",
  },
  learnShortHorizon: {
    title: "Money needed soon",
    body: (value, source) => `${value} (${source})`,
  },
  facts: {
    "gift-tax-annual-2026": (value, source) => `${value} (${source})`,
    "gift-tax-one-time-18-40": (value, source) => `${value} (${source})`,
    "box3-minors": (value, source) => `${value} (${source})`,
    "afm-costs": (value, source) => `${value} (${source})`,
    "spiva-europe": (value, source) => `${value} (${source})`,
    "hist-fall-2008": (value, source) => `${value} (${source})`,
    "hist-fall-2020": (value, source) => `${value} (${source})`,
    "duo-rules": (value, source) => `${value} (${source})`,
  },
  headline: (f, fmt) => {
    if (f.unallocated.kind === "computed") return en.unallocatedHeadline(f.unallocated, fmt);
    return f.rows.length > 0 ? `${f.rows.length} goal${f.rows.length === 1 ? "" : "s"}` : DASH;
  },
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.unallocated.kind === "computed") out.push(en.unallocatedLine(f.unallocated, fmt));
      else if (f.rows.length > 0) out.push(en.unallocatedStopped(f.unallocated.missing));
      for (const r of f.rows) out.push(en.goal.savedLine(r, fmt));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.unallocated.kind === "computed") out.push(en.unallocatedLine(f.unallocated, fmt));
      else if (f.rows.length > 0) out.push(en.unallocatedStopped(f.unallocated.missing));
      for (const r of f.rows) {
        out.push(en.goal.savedLine(r, fmt));
        out.push(`The amount saved is ${en.goal.savedSource[r.savedSource]}.`);
        if (r.savedSource === "stated" && r.scheduleFrom !== null)
          out.push(en.goal.statedAsOf(r.scheduleFrom, fmt));
        out.push(en.goal.gapLine(r, fmt));
        const sch = en.goal.scheduleLine(r, fmt);
        out.push(sch ?? en.goal.undated);
        const span = en.goal.scheduleSpan(r, fmt);
        if (span !== null) out.push(span);
        out.push(...en.goal.requiredLine(r, fmt));
        for (const x of [
          en.goal.sharedLine(r.sharedWithGoals, r.savedCents, fmt),
          en.goal.excludedLine(r.linkedExcludedCount),
          en.goal.brokerLine(r.brokerRefsNotCounted),
        ])
          if (x !== null) out.push(x);
      }
      out.push(en.capacityLine(f.capacity.score, f.toleranceScore));
      out.push(en.disagreement[f.disagreement]);
      if (f.loss !== null) out.push(en.lossLine(f.loss, "the amount you have in investments", fmt));
      if (f.study !== null) out.push(en.studyLine(f.study, fmt));
      return out;
    },
  },
  empty: {
    goals:
      "No goal has been entered yet. Without a goal there is no schedule, no monthly amount and no line for what is not allocated. The fixed example table below needs nothing from you. Nothing has been estimated.",
    "goal-date":
      "A goal has no end date. Without a date there is no schedule and no monthly amount. Nothing has been estimated.",
    room: "Your room each month is missing. Without that figure there is no line for what is not allocated. The working for each goal is still shown. Nothing has been estimated.",
  },
  howCalculated: {
    "goal-saved":
      "The amount saved is the sum of the linked accounts in euros. With no linked account it is the amount you entered. An account linked to several goals shows on each goal; the totals count it once.",
    "goal-required-monthly":
      "The monthly amount with which the amount saved reaches the goal in the months left: at 0% it is the difference divided by the months, at the other returns with monthly compounding and contributions at month end.",
    "goal-schedule":
      "The straight-line schedule runs from the amount on the start date, the amount saved on the day it was first or last recorded, to the target amount on the end date. The amount saved is compared with today's point on that line.",
    unallocated: `The room each month (lowest and highest) minus the monthly top-up of the buffer minus the monthly amount of all goals. For a goal that amount is the one you planned; with none planned, it is what the goal needs at a ${planFmt("en").pct(PLAN_NUMBERS.requirementRate)} return, a calculation by LaVega itself. The same deductions come off both ends. If a deduction cannot be calculated, the line stops and says which one.`,
    "loss-illustration": `A ${planFmt("en").points(PLAN_NUMBERS.lossFallPct)} fall in the amount you have in investments, in euros, and how many months of your middle room that is. It is only calculated when that amount is known.`,
  },
  education: educationEn,
};

export const goalsCopy: Record<Locale, GoalsCopy> = { nl, en };
