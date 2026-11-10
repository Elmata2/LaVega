import type { CalcStep, CashflowCalcId, CashflowFigures, CashflowWarning } from "@lavega/core";
import type { Locale } from "../../locale.js";
import type { PlanFmt } from "./shared.js";

/** The cash-flow card for irregular income. Every sentence that carries a
 *  figure takes it already formatted; the calculation lines read the engine's
 *  own steps, so the numbers shown are the numbers used. */
export type CashflowCopy = {
  title: string;
  headline: (f: CashflowFigures, fmt: PlanFmt) => string;
  parts: { figures: string; advice: string; assumptions: string; howCalculated: string; sources: string };
  why: string;
  notEnough: string;
  importLink: string;
  labels: {
    clientMean: string;
    clientRange: string;
    emptyMonths: string;
    longestGap: string;
    variability: string;
    startStated: string;
    payments: string;
    steady: string;
    spend: string;
    quietMonth: string;
    quietCover: string;
    lowestTypical: string;
    lowestQuiet: string;
  };
  clientRange: (min: string, median: string, max: string) => string;
  emptyMonths: (empty: number, total: number) => string;
  days: (n: number) => string;
  variability: (cv: number) => string;
  quietCover: (months: number) => string;
  noDeficit: string;
  lowest: (balance: string, month: string) => string;
  warning: (w: CashflowWarning, fmt: PlanFmt, quietMonths: number) => string;
  noWarning: (quietMonths: number, points: number) => string;
  advice: {
    /** `gap` null = the savings are at or above the target (or unknown). */
    buffer: (months: string, target: string | null, gap: string | null, own: string | null) => string;
    bufferNoFixed: (months: string) => string;
    tax: (amount: string, pct: string, exVat: boolean) => string;
    taxNeedsPct: string;
    noClient: string;
    vat: (amount: string, deadline: string, period: string | null) => string;
    vatUnknown: string;
    left: (amount: string) => string;
    fixedHint: string;
  };
  inputs: {
    taxLabel: string;
    taxHint: string;
    vatLabel: string;
    yes: string;
    no: string;
    vatSaveFailed: string;
  };
  payment: (date: string, name: string, amount: string) => string;
  howCalculated: Record<CashflowCalcId, (s: CalcStep, fmt: PlanFmt) => string>;
  sources: {
    bufferRule: (base: number, max: number) => string;
    vat: (rate: number, asOf: string, frequency: string) => string;
    tax: string;
    notAdvice: string;
  };
  frequency: Record<string, string>;
};

const v = (s: CalcStep, k: string): number => {
  const x = s.inputs[k]?.value;
  return typeof x === "number" ? x : 0;
};
const o = (s: CalcStep): number => (typeof s.output.value === "number" ? s.output.value : 0);
const has = (s: CalcStep, k: string): boolean => typeof s.inputs[k]?.value === "number";

const nl: CashflowCopy = {
  title: "Kasstroom bij wisselend inkomen",
  headline: (f, fmt) =>
    f.forward === null
      ? "Te weinig gegevens"
      : `Laagste saldo in een rustige periode: ${fmt.eur(f.forward.quiet.lowest.cents)}`,
  parts: {
    figures: "Cijfers",
    advice: "Wat we aanraden",
    assumptions: "Jouw aannames",
    howCalculated: "Zo is het berekend",
    sources: "Bronnen",
  },
  why: "Je gaf aan dat je freelance werkt of een eigen bedrijf hebt. Dan komt je geld in brokken binnen en moet je zelf belasting apart zetten.",
  notEnough:
    "Er zijn minder dan drie volle maanden aan gegevens, te weinig om te meten hoe wisselend je inkomen is.",
  importLink: "Importeer meer afschriften",
  labels: {
    clientMean: "Klantinkomen per maand (gemiddeld)",
    clientRange: "Laagste, middelste en hoogste maand",
    emptyMonths: "Maanden zonder klantinkomen",
    longestGap: "Langste tijd tussen twee betalingen",
    variability: "Hoe sterk je klantinkomen wisselt",
    startStated: "Startbedrag: het spaargeld dat je zelf opgaf, want je rekeningen hebben geen bekend saldo.",
    payments: "Dit telden we mee als klantinkomen (controleer of het klopt)",
    steady: "Ander inkomen per maand (loon, uitkering, partner)",
    spend: "Uitgaven per maand (gemiddelde, incl. periodieke kosten)",
    quietMonth: "Een maand zonder klantinkomen",
    quietCover: "Zo lang dekt je spaargeld dat",
    lowestTypical: "Laagste stand van je geld, typisch verloop",
    lowestQuiet: "Laagste stand van je geld, rustige periode",
  },
  clientRange: (a, b, c) => `${a} / ${b} / ${c}`,
  emptyMonths: (e, t) => `${e} van de ${t}`,
  days: (n) => `${n} dagen`,
  variability: (cv) =>
    cv >= 1 ? "Zeer sterk" : cv >= 0.5 ? "Sterk" : cv >= 0.25 ? "Matig" : "Gering",
  quietCover: (m) => (m === 1 ? "1 maand" : `${m} maanden`),
  noDeficit: "Je vaste inkomen dekt je uitgaven al, zonder klantinkomen.",
  lowest: (b, m) => `${b} (${m})`,
  warning: (w, fmt, q) =>
    w.kind === "typical-below-zero"
      ? `Waarschuwing: ook in een gewoon verloop kom je in ${fmt.monthLabel(w.month)} onder nul (${fmt.eur(w.cents)}).`
      : `Waarschuwing: als je ${q === 1 ? "1 maand" : `${q} maanden`} geen klantinkomen hebt, kom je in ${fmt.monthLabel(w.month)} onder nul (${fmt.eur(w.cents)}).`,
  noWarning: (q, n) =>
    `Geen waarschuwing: ook als je ${q === 1 ? "1 maand" : `${q} maanden`} geen klantinkomen hebt, blijf je de komende ${n} maanden boven nul.`,
  advice: {
    buffer: (months, target, gap, own) =>
      `Buffer: ${months} maanden vaste lasten${target === null ? "" : `, dat is ${target}`}.${
        gap === null ? "" : ` Er ontbreekt nog ${gap}.`
      }${own === null ? "" : ` Jouw eigen streefwaarde is ${own}; die laten we staan.`}`,
    bufferNoFixed: (months) =>
      `Buffer: ${months} maanden vaste lasten. Vul je vaste lasten in om er een bedrag van te maken.`,
    tax: (amount, pct, exVat) =>
      `Zet per maand ${amount} apart voor inkomstenbelasting (${pct} van je klantinkomen ${exVat ? "zonder btw" : "inclusief eventuele btw; beantwoord de btw-vraag voor een scherper bedrag"}).`,
    noClient:
      "We herkennen nog geen betalingen van klanten in je rekeningen. Btw en inkomstenbelasting zijn daarom niet berekend.",
    taxNeedsPct:
      "Inkomstenbelasting: vul hieronder het percentage in dat je zelf wilt aanhouden. LaVega kent geen gecontroleerd tarief en kiest er daarom geen.",
    vat: (amount, deadline, period) =>
      `Zet per maand ${amount} apart voor btw. De eerstvolgende aangifte moet uiterlijk ${deadline} binnen zijn${period === null ? "" : `; over de ontvangsten in die periode is dat ${period}`}.`,
    vatUnknown: "Btw: je hebt niet aangegeven of je btw rekent. Kies hieronder Ja of Nee.",
    left: (amount) => `Na deze reserveringen houd je gemiddeld ${amount} per maand over van je klantinkomen.`,
    fixedHint: "Vaste lasten ontbreken.",
  },
  inputs: {
    taxLabel: "Percentage voor inkomstenbelasting dat je apart zet",
    taxHint:
      "Je eigen percentage, van 0 tot 60. Het hangt af van je winst, aftrekposten en situatie, dus LaVega vult niets voor je in.",
    vatLabel: "Reken je btw aan je klanten?",
    yes: "Ja",
    no: "Nee",
    vatSaveFailed: "Opslaan lukte niet.",
  },
  payment: (d, n, a) => `${d}: ${n}, ${a}`,
  howCalculated: {
    "client-income": (s) =>
      `Klantinkomen: ${v(s, "payments")} betalingen van bedrijven (naam of omschrijving met BV, VOF, factuur en dergelijke) die niet als loon, uitkering, terugbetaling of overboeking tussen personen bekend zijn, in ${v(s, "months")} volle maanden, gedeeld door ${v(s, "months")}. Onbekend geld zonder zo'n kenmerk tellen we niet mee. In ${v(s, "empty")} maanden kwam er niets binnen.`,
    "quiet-month": (s, fmt) =>
      `Maand zonder klantinkomen: ander inkomen ${fmt.eur(v(s, "steady"))} min gemiddelde uitgaven ${fmt.eur(v(s, "spend"))} (periodieke kosten zoals verzekeringen en belasting zitten erin) = ${fmt.eur(o(s))}.`,
    "forward-typical": (s, fmt) =>
      `Typisch verloop: begin met ${v(s, "stated") === 1 ? `het spaargeld dat je opgaf (${fmt.eur(v(s, "start"))})` : `${fmt.eur(v(s, "start"))} op je rekeningen`}, elke maand ${fmt.eur(v(s, "per_month"))} erbij (ander inkomen + gemiddeld klantinkomen - gemiddelde uitgaven${v(s, "reserved") > 0 ? ` - ${fmt.eur(v(s, "reserved"))} die je voor belasting apart zet` : ""}). Laagste punt: ${fmt.eur(o(s))}.`,
    "forward-quiet": (s, fmt) =>
      `Rustige periode: begin met ${v(s, "stated") === 1 ? `het spaargeld dat je opgaf (${fmt.eur(v(s, "start"))})` : fmt.eur(v(s, "start"))}. De eerste ${v(s, "quiet_months")} maanden valt het klantinkomen weg (${fmt.eur(v(s, "per_quiet_month"))} per maand), daarna weer het typische verloop. Laagste punt in ${v(s, "points")} maanden: ${fmt.eur(o(s))}.`,
    "buffer-target": (s, fmt) =>
      `Buffer: ${v(s, "base_months")} maanden basis + ${v(s, "dry_months")} maanden zonder klantinkomen (de langste periode die we zagen), hoogstens ${v(s, "max_months")} = ${fmt.months(o(s))} maanden${
        has(s, "fixed") ? `, keer je vaste lasten van ${fmt.eur(v(s, "fixed"))} per maand.` : "."
      }`,
    "income-tax": (s, fmt) =>
      s.inputs["pct"]?.value === null || s.inputs["pct"]?.value === undefined
        ? `Inkomstenbelasting: klantinkomen zonder btw (${fmt.eur(v(s, "base"))} per maand) keer jouw percentage. Je hebt nog geen percentage ingevuld.`
        : `Inkomstenbelasting: klantinkomen zonder btw ${fmt.eur(v(s, "base"))} per maand x jouw ${fmt.plain(v(s, "pct"))}% = ${fmt.eur(o(s))}. Kosten van je bedrijf trekken we niet af, dus dit is aan de ruime kant.`,
    vat: (s, fmt) =>
      `Btw: gemiddeld klantinkomen ${fmt.eur(v(s, "client"))} x ${v(s, "rate")} / (100 + ${v(s, "rate")}) = ${fmt.eur(o(s))} per maand. Bedragen op je rekening zijn inclusief btw. Btw op je eigen kosten trekken we niet af, dus dit is aan de ruime kant.`,
  },
  sources: {
    bufferRule: (base, max) =>
      `Bufferregel: ${base} maanden basis plus de langste periode zonder klantinkomen die in je gegevens staat, hoogstens ${max} maanden. Dit is een regel van LaVega, geen officiële norm.`,
    vat: (rate, asOf, freq) =>
      `Btw-tarief ${rate}% en aangiftetermijn uit het Nederlandse regelpakket van LaVega, gecontroleerd op ${asOf}, aangifte ${freq}. Controleer bij de Belastingdienst.`,
    tax: "Inkomstenbelasting: het percentage is dat van jou. LaVega heeft hier geen gecontroleerde bron voor.",
    notAdvice: "Alles hier is een schatting uit je bankgegevens. Kosten, aftrekposten en btw op inkoop zijn niet bekend.",
  },
  frequency: { quarterly: "per kwartaal", monthly: "per maand", yearly: "per jaar" },
};

const en: CashflowCopy = {
  title: "Cash flow with irregular income",
  headline: (f, fmt) =>
    f.forward === null
      ? "Not enough data"
      : `Lowest balance in a quiet spell: ${fmt.eur(f.forward.quiet.lowest.cents)}`,
  parts: {
    figures: "Figures",
    advice: "What we recommend",
    assumptions: "Your assumptions",
    howCalculated: "How we calculated this",
    sources: "Sources",
  },
  why: "You said you freelance or run your own business. Then money arrives in lumps and you set tax aside yourself.",
  notEnough: "There are fewer than three full months of data, too little to measure how much your income varies.",
  importLink: "Import more statements",
  labels: {
    clientMean: "Client income per month (average)",
    clientRange: "Lowest, middle and highest month",
    emptyMonths: "Months without client income",
    longestGap: "Longest time between two payments",
    variability: "How much your client income varies",
    startStated: "Starting amount: the savings you typed in, because your accounts have no known balance.",
    payments: "What we counted as client income (check that it is right)",
    steady: "Other income per month (pay, benefits, partner)",
    spend: "Spending per month (average, incl. periodic costs)",
    quietMonth: "A month without client income",
    quietCover: "How long your savings cover that",
    lowestTypical: "Lowest level of your money, typical course",
    lowestQuiet: "Lowest level of your money, quiet spell",
  },
  clientRange: (a, b, c) => `${a} / ${b} / ${c}`,
  emptyMonths: (e, t) => `${e} of ${t}`,
  days: (n) => `${n} days`,
  variability: (cv) => (cv >= 1 ? "Very high" : cv >= 0.5 ? "High" : cv >= 0.25 ? "Moderate" : "Low"),
  quietCover: (m) => (m === 1 ? "1 month" : `${m} months`),
  noDeficit: "Your steady income already covers your spending, without client income.",
  lowest: (b, m) => `${b} (${m})`,
  warning: (w, fmt, q) =>
    w.kind === "typical-below-zero"
      ? `Warning: even on a normal course you drop below zero in ${fmt.monthLabel(w.month)} (${fmt.eur(w.cents)}).`
      : `Warning: if you get no client income for ${q === 1 ? "1 month" : `${q} months`}, you drop below zero in ${fmt.monthLabel(w.month)} (${fmt.eur(w.cents)}).`,
  noWarning: (q, n) =>
    `No warning: even if you get no client income for ${q === 1 ? "1 month" : `${q} months`}, you stay above zero for the coming ${n} months.`,
  advice: {
    buffer: (months, target, gap, own) =>
      `Buffer: ${months} months of fixed costs${target === null ? "" : `, that is ${target}`}.${
        gap === null ? "" : ` ${gap} is still missing.`
      }${own === null ? "" : ` Your own target is ${own}; we leave it as it is.`}`,
    bufferNoFixed: (months) =>
      `Buffer: ${months} months of fixed costs. Fill in your fixed costs to turn it into an amount.`,
    tax: (amount, pct, exVat) =>
      `Set aside ${amount} per month for income tax (${pct} of your client income ${exVat ? "without VAT" : "including any VAT; answer the VAT question for a sharper amount"}).`,
    noClient:
      "We do not recognise any client payments in your accounts yet. VAT and income tax are therefore not calculated.",
    taxNeedsPct:
      "Income tax: fill in below the percentage you want to keep aside. LaVega has no checked rate and so does not pick one.",
    vat: (amount, deadline, period) =>
      `Set aside ${amount} per month for VAT. The next return is due on or before ${deadline}${period === null ? "" : `; on the receipts in that period that is ${period}`}.`,
    vatUnknown: "VAT: you have not said whether you charge VAT. Choose Yes or No below.",
    left: (amount) => `After these reserves you keep about ${amount} per month of your client income.`,
    fixedHint: "Fixed costs are missing.",
  },
  inputs: {
    taxLabel: "Percentage you set aside for income tax",
    taxHint:
      "Your own percentage, from 0 to 60. It depends on your profit, deductions and situation, so LaVega fills in nothing for you.",
    vatLabel: "Do you charge your clients VAT?",
    yes: "Yes",
    no: "No",
    vatSaveFailed: "Saving did not work.",
  },
  payment: (d, n, a) => `${d}: ${n}, ${a}`,
  howCalculated: {
    "client-income": (s) =>
      `Client income: ${v(s, "payments")} payments from companies (name or description with BV, VOF, invoice and the like) that are not known as pay, a benefit, a refund or a transfer between people, over ${v(s, "months")} full months, divided by ${v(s, "months")}. Unknown money without such a mark is not counted. In ${v(s, "empty")} months nothing came in.`,
    "quiet-month": (s, fmt) =>
      `Month without client income: other income ${fmt.eur(v(s, "steady"))} minus average spending ${fmt.eur(v(s, "spend"))} (periodic costs such as insurance and tax are included) = ${fmt.eur(o(s))}.`,
    "forward-typical": (s, fmt) =>
      `Typical course: start with ${v(s, "stated") === 1 ? `the savings you typed in (${fmt.eur(v(s, "start"))})` : `${fmt.eur(v(s, "start"))} in your accounts`}, add ${fmt.eur(v(s, "per_month"))} each month (other income + average client income - average spending${v(s, "reserved") > 0 ? ` - ${fmt.eur(v(s, "reserved"))} you set aside for tax` : ""}). Lowest point: ${fmt.eur(o(s))}.`,
    "forward-quiet": (s, fmt) =>
      `Quiet spell: start with ${v(s, "stated") === 1 ? `the savings you typed in (${fmt.eur(v(s, "start"))})` : fmt.eur(v(s, "start"))}. For the first ${v(s, "quiet_months")} months client income stops (${fmt.eur(v(s, "per_quiet_month"))} per month), then the typical course again. Lowest point in ${v(s, "points")} months: ${fmt.eur(o(s))}.`,
    "buffer-target": (s, fmt) =>
      `Buffer: ${v(s, "base_months")} months base + ${v(s, "dry_months")} months without client income (the longest stretch we saw), at most ${v(s, "max_months")} = ${fmt.months(o(s))} months${
        has(s, "fixed") ? `, times your fixed costs of ${fmt.eur(v(s, "fixed"))} per month.` : "."
      }`,
    "income-tax": (s, fmt) =>
      s.inputs["pct"]?.value === null || s.inputs["pct"]?.value === undefined
        ? `Income tax: client income without VAT (${fmt.eur(v(s, "base"))} per month) times your percentage. You have not filled in a percentage yet.`
        : `Income tax: client income without VAT ${fmt.eur(v(s, "base"))} per month x your ${fmt.plain(v(s, "pct"))}% = ${fmt.eur(o(s))}. Business costs are not deducted, so this is on the high side.`,
    vat: (s, fmt) =>
      `VAT: average client income ${fmt.eur(v(s, "client"))} x ${v(s, "rate")} / (100 + ${v(s, "rate")}) = ${fmt.eur(o(s))} per month. Amounts in your account include VAT. VAT on your own costs is not deducted, so this is on the high side.`,
  },
  sources: {
    bufferRule: (base, max) =>
      `Buffer rule: ${base} months base plus the longest stretch without client income in your data, at most ${max} months. This is a LaVega rule, not an official norm.`,
    vat: (rate, asOf, freq) =>
      `VAT rate ${rate}% and filing period from LaVega's Dutch rule pack, checked on ${asOf}, filed ${freq}. Check with the Belastingdienst.`,
    tax: "Income tax: the percentage is yours. LaVega has no checked source for it.",
    notAdvice: "Everything here is an estimate from your bank data. Costs, deductions and VAT on purchases are not known.",
  },
  frequency: { quarterly: "quarterly", monthly: "monthly", yearly: "yearly" },
};

export const cashflowCopy: Record<Locale, CashflowCopy> = { nl, en };
