import type { Invoice, ScheduledFlow, Tx, VatSettings } from "./model.js";
import { invoiceVatInWindow, type InvoiceVatWindow } from "./invoices.js";
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

/* ── THE BTW POSITION ───────────────────────────────────────────────────────
 *
 * One figure per entity that is honest about WHICH period it describes, WHAT it
 * was built from, and WHICH WAY the money goes. It exists because the old
 * single-number answer got all three of those wrong at once:
 *
 *   - halfway through a quarter it summed a two-thirds-finished window and
 *     emitted it as `confirmed` — a label the data cannot carry;
 *   - a quarter with more voorbelasting than afdracht came back as `null`, so a
 *     refund was rendered as an absence;
 *   - the owner's own bookkeeping and his own invoices could not reach it.
 *
 * `computeVatSetAside` is now a thin wrapper over this, so the forecast, the
 * available-balance netting and the DE path keep working unchanged.
 */

/** Where the figure came from. Never blended — see `vatPosition`. */
export type VatBasis = "manual" | "sheet" | "invoices" | "proxy";

/** Is the filing window over? Decides the wording AND the flow's status. */
export type VatStage = "loopt" | "afgesloten";

export type VatDirection = "betalen" | "terugvragen" | "onbekend";

/**
 * Why the ladder stopped where it did, when a better basis existed but could
 * not be used. The UI turns this into one sentence naming the real cause; it is
 * a code rather than a sentence so the engine stays language-free and the
 * reason cannot drift from the arithmetic.
 *
 * `null` = the best basis available was used, and there is nothing to report.
 */
export type VatNote =
  | "gemengde-tarieven"
  | "stelsel-onbekend"
  | "kasstelsel"
  | "btw-onbekend-op-facturen"
  | "omzetfacturen-onbekend"
  | "voorbelasting-onbekend"
  | "boekhouding-andere-periode"
  | "geen-banktransacties";

/**
 * The BTW position of one entity for the period it must file next.
 *
 * `basis`, `coverage` and `rulesAsOf` are NOT optional: a figure that cannot say
 * where it came from cannot be rendered, because the type cannot express one.
 * Amounts are integer cents; `null` means unknown and never 0. `netCents > 0`
 * is money owed to the tax office, `< 0` money to be reclaimed.
 */
export type VatPosition = {
  period: TaxPeriod;
  stage: VatStage;
  basis: VatBasis;
  /** BTW over the turnover of the period (af te dragen). */
  chargedCents: number | null;
  /** BTW over the costs of the period (voorbelasting). */
  paidCents: number | null;
  netCents: number | null;
  direction: VatDirection;
  /** Invoices in the window that state a BTW amount, out of how many there are. */
  coverage: { withVat: number; total: number };
  note: VatNote | null;
  /** The date the rule pack itself states — provenance, not the day we looked. */
  rulesAsOf: string;
  /** What this country calls the tax: "BTW", "USt". */
  vatLabel: string;
};

export type VatPositionInput = {
  txs: readonly Tx[];
  settings: VatSettings;
  asOf: string;
  /** The owner's own spreadsheet figures, when he connected one. */
  figures?: TaxFigures;
  /** All invoices; the position filters to this entity and this window itself. */
  invoices?: readonly Invoice[];
};

/**
 * The basis ladder, in order of trust — and the bases are NEVER summed.
 *
 *   1. `manual`   — the owner said so, and a fact from him outranks every
 *                   calculation;
 *   2. `sheet`    — his own bookkeeping, when it covers exactly this window and
 *                   states both sides;
 *   3. `invoices` — his own invoices, but only under the factuurstelsel and only
 *                   when every invoice in the window states its BTW and both
 *                   sides are present;
 *   4. `proxy`    — the margin over bank movements at the entity's rate.
 *
 * Adding invoice BTW to proxy BTW would double-count the same euros: a
 * reconciled invoice IS a bank movement. That is why the ladder picks one basis
 * whole, and why there is a test that fails if anyone ever sums them.
 */
export function vatPosition({ txs, settings, asOf, figures, invoices }: VatPositionInput): VatPosition {
  const pack = taxPack(settings.country);
  const period = nextVatPeriod(settings.frequency, asOf, settings.country);
  const { periodStart, periodEnd } = period;
  // The last day of the period is still IN it — that day is not over yet.
  const stage: VatStage = asOf <= periodEnd ? "loopt" : "afgesloten";

  const fromInvoices = invoiceVatInWindow(invoices ?? [], settings.entity, periodStart, periodEnd);
  const coverage = fromInvoices.coverage;

  const base = { period, stage, coverage, rulesAsOf: pack.rulesAsOf, vatLabel: pack.vat.label };
  const finish = (
    basis: VatBasis,
    chargedCents: number | null,
    paidCents: number | null,
    netCents: number | null,
    note: VatNote | null,
  ): VatPosition => ({
    ...base, basis, chargedCents, paidCents, netCents, note,
    direction: netCents === null ? "onbekend" : netCents < 0 ? "terugvragen" : "betalen",
  });

  // 1. His own amount. Not clamped at 0: if he says it is money back, it is.
  if (typeof settings.manualCents === "number") {
    return finish("manual", null, null, Math.round(settings.manualCents), null);
  }

  // 2. His own bookkeeping.
  const sheet = vatFromSheet(figures, periodStart, periodEnd);
  if (sheet !== null) {
    return finish("sheet", sheet.chargedCents, sheet.paidCents, sheet.chargedCents - sheet.paidCents, null);
  }

  // 3. His own invoices — the only basis that sees an unpaid invoice's debt.
  const invoiceNote = invoiceBasisRefusal(settings, fromInvoices);
  if (invoiceNote === null && fromInvoices.chargedCents !== null && fromInvoices.paidCents !== null) {
    const charged = fromInvoices.chargedCents;
    const paid = fromInvoices.paidCents;
    return finish("invoices", charged, paid, charged - paid, null);
  }

  // 4. The margin proxy, or nothing at all when the rates are mixed.
  const sheetNote: VatNote | null = figures && figures.rowCount > 0 ? "boekhouding-andere-periode" : null;
  if (settings.mixedRates) {
    return finish("proxy", null, null, null, "gemengde-tarieven");
  }
  // An empty window sums to 0, and "niets te betalen" drawn from no movements at
  // all is a conclusion an absence cannot carry. So it stays unknown.
  const inWindow = txs.filter((t) => t.date >= periodStart && t.date <= periodEnd).length;
  if (inWindow === 0) return finish("proxy", null, null, null, "geen-banktransacties");

  const margin = marginCents(txs, periodStart, periodEnd);
  const r = settings.defaultRatePct;
  // Symmetric on purpose: a quarter whose bank movements are net negative is the
  // proxy's way of saying "money back", and refusing only that direction would
  // bias every estimate towards "you owe" and hide the refunds.
  const net = Math.round((margin * r) / (100 + r));
  return finish("proxy", null, null, net, invoiceNote ?? sheetNote);
}

/** Why his invoices may NOT be used as the basis, or `null` when they may.
 *
 *  Every branch here is a thing the owner can act on, which is the point: the
 *  screen says the real cause instead of silently showing a weaker number. */
function invoiceBasisRefusal(settings: VatSettings, w: InvoiceVatWindow): VatNote | null {
  if (w.coverage.total === 0) return null; // no invoices at all: nothing to report
  if (settings.vatBasis === undefined) return "stelsel-onbekend";
  if (settings.vatBasis === "kasstelsel") return "kasstelsel";
  if (w.coverage.withVat < w.coverage.total) return "btw-onbekend-op-facturen";
  // Both sides have to be present. An invoice list with only sales invoices does
  // not mean there was no voorbelasting — it means LaVega cannot see it, and
  // treating that absence as 0 would state a debt as a certainty.
  if (w.chargedCents === null) return "omzetfacturen-onbekend";
  if (w.paidCents === null) return "voorbelasting-onbekend";
  return null;
}

/**
 * The VAT to set aside for the current filing period, as an outflow
 * `ScheduledFlow` due on that country's deadline — a thin wrapper over
 * `vatPosition`.
 *
 * Two things it deliberately does NOT do:
 *
 *  - a refund does not become a flow. LaVega does not know when the tax office
 *    pays, and an inflow on an invented date is worse than no inflow; the refund
 *    is shown on the Belasting screen instead.
 *  - an in-progress period is `expected`, never `confirmed`. Only a closed
 *    window — or the owner's own amount, which is his word — is confirmed.
 */
export function computeVatSetAside(
  txs: Tx[],
  settings: VatSettings,
  asOf: string,
  figures?: TaxFigures,
  invoices?: readonly Invoice[],
): ScheduledFlow | null {
  const p = vatPosition({ txs, settings, asOf, figures, invoices });
  if (p.netCents === null || p.netCents <= 0) return null;
  return makeScheduledFlow({
    entity: settings.entity,
    label: `${p.vatLabel} ${p.period.periodLabel}`,
    sign: -1,
    amountCents: p.netCents,
    dueDate: p.period.deadline,
    source: "vat",
    status: p.basis === "manual" || p.stage === "afgesloten" ? "confirmed" : "expected",
  });
}

/** Both BTW sides from the owner's sheet, but only when the sheet actually
 *  covers this filing period and states both of them. Anything less falls
 *  through rather than half-using his numbers.
 *
 *  The net is NOT clamped at zero any more: a quarter with more voorbelasting
 *  than afdracht is money back, and clamping it turned a refund into a nothing. */
function vatFromSheet(
  figures: TaxFigures | undefined,
  periodStart: string,
  periodEnd: string,
): { chargedCents: number; paidCents: number } | null {
  if (!figures || figures.rowCount === 0) return null;
  if (figures.from !== periodStart || figures.to !== periodEnd) return null;
  if (figures.vatChargedCents === null || figures.vatPaidCents === null) return null;
  return { chargedCents: figures.vatChargedCents, paidCents: figures.vatPaidCents };
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
  /** All invoices. The BTW figure uses them under the factuurstelsel; see
   *  `vatPosition`. Absent = the invoice basis simply isn't available. */
  invoices?: readonly Invoice[];
};

/** Everything one entity must set aside under its country's rules: the VAT
 *  set-aside plus any profit-tax prepayments. One call per entity, so a view
 *  never has to know which countries prepay. */
export function computeTaxReservations({ txs, settings, asOf, figures, invoices }: TaxReservationInput): ScheduledFlow[] {
  const vat = computeVatSetAside(txs, settings, asOf, figures, invoices);
  return [...(vat ? [vat] : []), ...computeProfitTaxPrepayments(txs, settings, asOf, figures)];
}
