import type { ScheduledFlow, Tx, VatSettings } from "./model.js";
import { makeScheduledFlow } from "./scheduledFlows.js";
import { taxPack } from "./taxpacks/index.js";
import type { DeadlineRule, TaxPeriod, TaxPack, VatFrequency } from "./taxpacks/types.js";
import type { TaxFigures } from "./taxSheet.js";

/* ── THE COUNTRY-AGNOSTIC TAX ENGINE ───────────────────────────────────────
 *
 * All the arithmetic lives here; all the rules live in `taxpacks/`. Nothing in
 * this file names a country, so a third country is a new pack and nothing else.
 *
 * Two things come out of it, and both are `ScheduledFlow`s so the forecast and
 * the available-balance netting pick them up without knowing anything about
 * tax:
 *
 *   1. the VAT set-aside (`source: "vat"`), as before;
 *   2. profit-tax prepayments and the settlement that follows them
 *      (`source: "prepayment"`) — the German case that money in the account was
 *      never the owner's.
 */

export * from "./taxpacks/index.js";

/** Kept for the callers that predate the packs. The NL pack is the source. */
export const BTW_RULES_AS_OF = taxPack("NL").rulesAsOf;
export const NL_VAT_RATES = taxPack("NL").vat.rates;

/** ISO last day of month (y, m1..12). */
function lastDayOfMonth(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of month m
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const Q_LABEL = ["Q1", "Q2", "Q3", "Q4"];
const NL_MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Where a filing deadline lands, per the pack's rule: N months after the
 *  period end, on that month's `day` ("last" = its last day). */
function deadlineFrom(periodEnd: string, rule: DeadlineRule): string {
  const [y, m] = periodEnd.split("-").map(Number);
  const total = m + rule.monthsAfterEnd;
  const year = y + Math.floor((total - 1) / 12);
  const month = ((total - 1) % 12) + 1;
  return rule.day === "last" ? lastDayOfMonth(year, month) : `${year}-${String(month).padStart(2, "0")}-${String(rule.day).padStart(2, "0")}`;
}

function quarterPeriod(y: number, q: number, pack: TaxPack): TaxPeriod {
  const startMonth = q * 3 + 1; // 1,4,7,10
  const endMonth = (q + 1) * 3; // 3,6,9,12
  const periodEnd = lastDayOfMonth(y, endMonth);
  return {
    periodLabel: `${Q_LABEL[q]} ${y}`,
    periodStart: `${y}-${String(startMonth).padStart(2, "0")}-01`,
    periodEnd,
    deadline: deadlineFrom(periodEnd, pack.vat.periodic),
  };
}

function monthPeriod(y: number, m: number, pack: TaxPack): TaxPeriod {
  const periodEnd = lastDayOfMonth(y, m);
  return {
    periodLabel: `${NL_MONTHS[m - 1]} ${y}`,
    periodStart: `${y}-${String(m).padStart(2, "0")}-01`,
    periodEnd,
    deadline: deadlineFrom(periodEnd, pack.vat.periodic),
  };
}

function yearPeriod(y: number, pack: TaxPack): TaxPeriod {
  return {
    periodLabel: `${y}`,
    periodStart: `${y}-01-01`,
    periodEnd: `${y}-12-31`,
    deadline: deadlineFrom(`${y}-12-31`, pack.vat.annual),
  };
}

/** The nearest VAT deadline that has NOT yet passed (the earliest deadline
 *  ≥ asOf), relative to asOf. On 15 Apr a Dutch owner still has to file the
 *  just-ended Q1 (due 30 Apr), so we return the PREVIOUS period whenever its
 *  deadline hasn't passed yet, otherwise the current (in-progress) period.
 *  Which date that deadline is comes from the country's pack — the last day of
 *  the following month in NL, the 10th of it in DE. */
export function nextVatPeriod(frequency: VatFrequency, asOf: string, country?: string): TaxPeriod {
  const pack = taxPack(country);
  const [y, m] = asOf.split("-").map(Number); // m: 1..12
  let current: TaxPeriod;
  let previous: TaxPeriod;
  if (frequency === "yearly") {
    current = yearPeriod(y, pack);
    previous = yearPeriod(y - 1, pack);
  } else if (frequency === "monthly") {
    current = monthPeriod(y, m, pack);
    previous = m === 1 ? monthPeriod(y - 1, 12, pack) : monthPeriod(y, m - 1, pack);
  } else {
    const q = Math.floor((m - 1) / 3); // 0..3
    current = quarterPeriod(y, q, pack);
    previous = q === 0 ? quarterPeriod(y - 1, 3, pack) : quarterPeriod(y, q - 1, pack);
  }
  // ISO dates compare lexicographically. If last period's deadline is still
  // open, that's the nearest unfiled one; otherwise it's the current period's.
  return previous.deadline >= asOf ? previous : current;
}

/** The name this had when NL was the only country. */
export const nextBtwDeadline = nextVatPeriod;

/** Income minus expenses over an inclusive ISO window, in cents. A crude proxy
 *  for the real figure — it reads bank movements, so it is VAT-inclusive and
 *  knows nothing about accruals. The owner's own spreadsheet (`taxSheet.ts`)
 *  replaces it wherever it is connected. */
function marginCents(txs: readonly Tx[], from: string, to: string): number {
  let sum = 0;
  for (const t of txs) {
    if (t.date < from || t.date > to) continue;
    sum += Math.round(t.amount * 100);
  }
  return sum;
}

/**
 * Estimate the VAT to set aside for the current filing period, as a confirmed
 * outflow `ScheduledFlow` due on that country's deadline.
 *
 * In order of trust:
 *   1. `settings.manualCents` — the owner said so;
 *   2. the owner's own spreadsheet, when it has both VAT columns for this
 *      period (`vatCharged − vatPaid`): real bookkeeping, and the one thing
 *      that also answers a mixed-rate entity;
 *   3. `mixedRates` ⇒ no estimate at all;
 *   4. the margin proxy at the entity's default rate.
 */
export function computeVatSetAside(
  txs: Tx[],
  settings: VatSettings,
  asOf: string,
  figures?: TaxFigures,
): ScheduledFlow | null {
  const pack = taxPack(settings.country);
  const { periodLabel, periodStart, periodEnd, deadline } = nextVatPeriod(settings.frequency, asOf, settings.country);

  const sheetVat = vatFromSheet(figures, periodStart, periodEnd);
  let amountCents: number;
  if (typeof settings.manualCents === "number") {
    amountCents = Math.max(0, Math.round(settings.manualCents));
  } else if (sheetVat !== null) {
    amountCents = sheetVat;
  } else if (settings.mixedRates) {
    return null; // can't safely auto-estimate mixed rates
  } else {
    const margin = marginCents(txs, periodStart, periodEnd);
    const r = settings.defaultRatePct;
    amountCents = margin > 0 ? Math.round((margin * r) / (100 + r)) : 0;
  }
  if (amountCents <= 0) return null;
  return makeScheduledFlow({
    entity: settings.entity,
    label: `${pack.vat.label} ${periodLabel}`,
    sign: -1,
    amountCents,
    dueDate: deadline,
    source: "vat",
    status: "confirmed",
  });
}

/** Net VAT from the owner's sheet, but only when the sheet actually covers this
 *  filing period and states both sides. Anything less falls through to the
 *  proxy rather than half-using his numbers. */
function vatFromSheet(figures: TaxFigures | undefined, periodStart: string, periodEnd: string): number | null {
  if (!figures || figures.rowCount === 0) return null;
  if (figures.from !== periodStart || figures.to !== periodEnd) return null;
  if (figures.vatChargedCents === null || figures.vatPaidCents === null) return null;
  return Math.max(0, figures.vatChargedCents - figures.vatPaidCents);
}

/**
 * The profit tax a country makes you PREPAY, as flows on its statutory dates.
 *
 * This is the German pain in code. A year's profit tax is sized once, then cut
 * into the country's prepayment dates. Instalments still ahead of `asOf` become
 * dated flows; everything the passed dates were supposed to carry rolls into
 * ONE settlement flow on the first prepayment date of next year — the
 * Nachzahlung that arrives after the money has already been spent. Both are
 * reserved out of the available balance and both show up in the forecast, so
 * the owner sees it coming instead of hearing about it from the tax office.
 *
 * The base, in order of trust: an assessed amount (`profitTaxManualCents`), the
 * owner's own spreadsheet, then profit realised so far this year from bank
 * movements. Profit is never annualised — LaVega reserves for money already
 * earned, not for a forecast of what the year might do.
 *
 * Empty for a country whose pack has no `profitTax` (NL today).
 */
export function computeProfitTaxPrepayments(
  txs: Tx[],
  settings: VatSettings,
  asOf: string,
  figures?: TaxFigures,
): ScheduledFlow[] {
  const pack = taxPack(settings.country);
  const rules = pack.profitTax;
  if (!rules) return [];

  const year = Number(asOf.slice(0, 4));
  const manual = settings.profitTaxManualCents;
  const assessed = typeof manual === "number";
  let totalCents: number;
  if (typeof manual === "number") {
    totalCents = Math.max(0, Math.round(manual));
  } else {
    const profitCents = profitFromSheet(figures, year) ?? marginCents(txs, `${year}-01-01`, asOf);
    if (profitCents <= 0) return [];
    const ratePct = settings.profitTaxRatePct ?? rules.defaultRatePct;
    totalCents = Math.round((profitCents * ratePct) / 100);
  }
  if (totalCents <= 0) return [];

  const n = rules.prepayDates.length;
  const share = Math.floor(totalCents / n);
  const flows: ScheduledFlow[] = [];
  let carryCents = 0;
  for (let i = 0; i < n; i++) {
    // The last instalment carries the rounding remainder, so the instalments
    // always add up to exactly the total.
    const amountCents = i === n - 1 ? totalCents - share * (n - 1) : share;
    const dueDate = `${year}-${rules.prepayDates[i]}`;
    if (dueDate < asOf) {
      carryCents += amountCents;
      continue;
    }
    flows.push(makeScheduledFlow({
      entity: settings.entity,
      label: `${rules.label} ${i + 1}/${n} ${year}`,
      sign: -1,
      amountCents,
      dueDate,
      source: "prepayment",
      status: assessed ? "confirmed" : "expected",
    }));
  }
  if (carryCents > 0) {
    flows.push(makeScheduledFlow({
      entity: settings.entity,
      label: `${rules.settlementLabel} ${year}`,
      sign: -1,
      amountCents: carryCents,
      dueDate: `${year + 1}-${rules.prepayDates[0]}`,
      source: "prepayment",
      status: assessed ? "confirmed" : "expected",
    }));
  }
  return flows;
}

/** The profit for the tax YEAR out of the owner's sheet. Profit tax is annual,
 *  so figures that start somewhere mid-year are not his year's profit and are
 *  refused rather than silently understating the reservation. */
function profitFromSheet(figures: TaxFigures | undefined, year: number): number | null {
  if (!figures || figures.rowCount === 0) return null;
  if (figures.from !== `${year}-01-01`) return null;
  return figures.profitCents;
}

export type TaxReservationInput = {
  txs: Tx[];
  settings: VatSettings;
  asOf: string;
  /** The owner's own spreadsheet figures for the period, when he connected one. */
  figures?: TaxFigures;
};

/** Everything one entity must set aside under its country's rules: the VAT
 *  set-aside plus any profit-tax prepayments. One call per entity, so a view
 *  never has to know which countries prepay. */
export function computeTaxReservations({ txs, settings, asOf, figures }: TaxReservationInput): ScheduledFlow[] {
  const vat = computeVatSetAside(txs, settings, asOf, figures);
  return [...(vat ? [vat] : []), ...computeProfitTaxPrepayments(txs, settings, asOf, figures)];
}
