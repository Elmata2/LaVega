import { addMonths, isIsoDate, isoMonth, lastDayOfMonth, previousMonths, daysBetween } from "../advisor/months.js";
import { cleanTxs, personalView } from "../advisor/scopePersonal.js";
import { scopedOwn } from "../advisor/room.js";
import { isEurCurrency } from "../model.js";
import { nextVatPeriod, resolveVatSettings } from "../tax.js";
import { taxPack } from "../taxpacks/index.js";
import { categorize } from "../views.js";
import { fig, liquidAccountBalances } from "./internal.js";
import { fixedCostsMonthlyCentsOf } from "./month.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type { CalcStep, PlanInput } from "./types.js";

export type ClientPayment = { date: string; counterparty: string; cents: number };

/* The cash-flow view for people whose income arrives in lumps (freelance,
 * business) or whose bank data shows it. NOT one of SECTION_IDS: it is
 * `PlanResult.cashflow`, null when it does not apply. Pure, no clock. */

export const CASHFLOW_CALC_IDS = [
  "client-income",
  "quiet-month",
  "forward-typical",
  "forward-quiet",
  "buffer-target",
  "income-tax",
  "vat",
] as const;
export type CashflowCalcId = (typeof CASHFLOW_CALC_IDS)[number];

export type ForwardPoint = { month: string; cents: number };
export type ForwardPath = { points: ForwardPoint[]; lowest: ForwardPoint };

export type CashflowFigures = {
  /** Full calendar months looked at, oldest first. */
  months: string[];
  /** Three or more full months: below that nothing is measured. */
  enough: boolean;
  client: {
    perMonthCents: number[];
    meanCents: number;
    medianCents: number;
    minCents: number;
    maxCents: number;
    emptyMonths: number;
    longestDryMonths: number;
    payments: number;
    /** The payments counted as client income, newest first, so the person can
     *  check them. At most CLIENT_LIST_MAX. */
    paymentList: ClientPayment[];
    /** Days between the two furthest apart consecutive client payments. */
    longestGapDays: number | null;
    /** std / mean of the client series; null when the mean is 0. */
    variability: number | null;
  };
  /** Median month of all other incoming money (salary, benefits, partner). */
  /** Enough history, yet no incoming payment qualifies as client income: no
   *  VAT or income-tax amount is given (a silent 0 would read as "nothing to set aside"). */
  noClientPayments: boolean;
  steadyMonthlyCents: number;
  /** Average month of outgoing money over the window, periodic costs included. */
  spendMonthlyCents: number;
  /** Payments to the tax office are left out of spending because the paths
   *  subtract the set-asides instead (VAT answered and a percentage typed). */
  taxPaymentsReplaced: boolean;
  /** steady income - spending, in a month without client income. */
  quietNetCents: number;
  startCents: number | null;
  /** Where the start money comes from: the accounts' balances, or the savings
   *  total the person typed when no account has a known balance. */
  startSource: "accounts" | "stated" | null;
  /** Whole months the money covers a quiet month; null when it does not cost. */
  quietCoverMonths: number | null;
  forward: {
    points: number;
    quietMonths: number;
    typical: ForwardPath;
    quiet: ForwardPath;
  } | null;
  buffer: {
    months: number;
    fixedCents: number | null;
    targetCents: number | null;
    liquidCents: number | null;
    gapCents: number | null;
    ownTargetMonths: number | null;
  };
  setAside: {
    incomeTax: { baseCents: number; pct: number | null; cents: number | null };
    vat: {
      chargesVat: boolean | null;
      ratePct: number;
      cents: number | null;
      /** VAT on client receipts dated inside the period that is filed next. */
      periodCents: number | null;
      deadline: string | null;
      frequency: string;
      rulesAsOf: string;
    };
    /** Average client income per month after both set-asides; null without a percentage. */
    leftCents: number | null;
  };
};

export const CLIENT_LIST_MAX = 12;

export type CashflowWarning =
  | { kind: "typical-below-zero"; month: string; cents: number }
  | { kind: "quiet-below-zero"; month: string; cents: number };

export type CashflowResult = {
  figures: CashflowFigures;
  warnings: CashflowWarning[];
  calc: CalcStep[];
};

/** LaVega's own rule, not an official norm: bridge the longest dry stretch
 *  seen, on top of a base of three months. */
export function bufferMonthsFor(longestDryMonths: number): number {
  const t = PLAN_THRESHOLDS.cashflow;
  return Math.min(t.bufferMaxMonths, Math.max(t.bufferBaseMonths, t.bufferBaseMonths + longestDryMonths));
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : Math.round(sum(xs) / xs.length));
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}
function cv(xs: readonly number[]): number | null {
  const m = sum(xs) / (xs.length || 1);
  if (xs.length === 0 || m <= 0) return null;
  const v = sum(xs.map((x) => (x - m) ** 2)) / xs.length;
  return Math.sqrt(v) / m;
}
function longestRun(xs: readonly number[]): number {
  let best = 0;
  let cur = 0;
  for (const x of xs) {
    cur = x === 0 ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** The full calendar months the data covers: the first month counts when the
 *  first row is on day 1-3; the last when the data runs to its last day. */
function fullMonths(dates: readonly string[], balanceDates: readonly string[], asOf: string): string[] {
  if (dates.length === 0) return [];
  const first = dates.reduce((a, b) => (b < a ? b : a));
  const last = [...dates, ...balanceDates].reduce((a, b) => (b > a ? b : a));
  const candidates = previousMonths(asOf, 13).slice(1).reverse();
  return candidates.filter((m) => `${m}-03` >= first && lastDayOfMonth(m) <= last);
}

function path(start: number, nets: readonly number[], months: readonly string[]): ForwardPath {
  let bal = start;
  const points = nets.map((n, i) => {
    bal += n;
    return { month: months[i]!, cents: bal };
  });
  const lowest = points.reduce((a, b) => (b.cents < a.cents ? b : a));
  return { points, lowest };
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9 ]+/g, " ");
/** A name or text that marks a company or an invoice. Without one, an
 *  uncategorised incoming payment is not counted as client income. */
const BUSINESS_MARK = /\b(bv|vof|nv|holding|stichting|ltd|gmbh|llc|inc|factuur|invoice|opdracht)\b/;
/** Words of pay that comes from an employer or a benefit. */
const PAY_WORDS = /(salaris|loon|vakantie|eindejaar|13e|dertiende|bonus|uitkering|pensioen|toeslag|gehalt|declaratie|reiskosten)/;
const TAX_OFFICE = /(belastingdienst|omzetbelasting|inkomstenbelasting|voorlopige aanslag)/;

export function computeCashflow(i: PlanInput): CashflowResult | null {
  const t = PLAN_THRESHOLDS.cashflow;
  // Only people who said they freelance or run a business get this card.
  const wantsWork = i.profile.workKinds.some((w) => w === "freelance" || w === "business");
  if (!wantsWork) return null;

  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const dated = view.txs.filter((x) => isIsoDate(x.date) && isEurCurrency(x.currency));
  const clean = cleanTxs(dated, view.accounts, i.rules, scopedOwn(view.accounts, i.own));
  const months = fullMonths(
    dated.map((x) => x.date.slice(0, 10)),
    view.accounts.flatMap((a) => (a.balanceDate ? [a.balanceDate.slice(0, 10)] : [])),
    i.asOf,
  );

  const chargesVat = i.profile.chargesVat;
  const vatSettings = resolveVatSettings({
    entity: "",
    country: "NL",
    ...(i.vatFrequency == null ? {} : { saved: { entity: "", frequency: i.vatFrequency, defaultRatePct: taxPack("NL").vat.defaultRatePct, mixedRates: false, country: "NL" } }),
  });
  const vatRate = vatSettings.defaultRatePct;
  const rawPct = i.preferences.incomeTaxSetAsidePct?.pct ?? null;
  const pct = rawPct === null ? null : Math.min(60, Math.max(0, rawPct));
  const taxPaymentsReplaced = chargesVat !== null && pct !== null;

  /* CLIENT INCOME (the rule is written in the design doc): incoming money in
   * euros, own transfers already removed, that is
   *   - not in a known category: salary and benefits are "Inkomen", refunds
   *     sit in their shop's category, Tikkie and friends in "Tussen personen";
   *   - not from a counterparty that also paid "Inkomen" (the employer: holiday
   *     pay, a 13th month);
   *   - not worded like pay (salaris, vakantiegeld, uitkering ...);
   *   - and marked as a company or an invoice (BV, VOF, factuur ...).
   * Uncategorised money without such a mark is NOT counted. A client that pays
   * every month counts: how regular the payments are plays no part here. */
  const employers = new Set(
    clean
      .filter((x) => x.amount > 0 && categorize(x, i.rules, i.own) === "Inkomen")
      .map((x) => norm(x.counterparty).trim()),
  );
  const isClient = (x: (typeof clean)[number]): boolean => {
    if (x.amount <= 0) return false;
    if (categorize(x, i.rules, i.own) !== "onbekend") return false;
    if (employers.has(norm(x.counterparty).trim())) return false;
    const text = norm(`${x.counterparty} ${x.description}`);
    return !PAY_WORDS.test(text) && BUSINESS_MARK.test(text);
  };

  const idx = new Map(months.map((m, k) => [m, k]));
  const clientPer = months.map(() => 0);
  const otherPer = months.map(() => 0);
  const outPer = months.map(() => 0);
  const clientRows: ClientPayment[] = [];
  const periodRows: { date: string; cents: number }[] = [];
  for (const x of clean) {
    const cents = Math.round(x.amount * 100);
    if (isClient(x)) {
      periodRows.push({ date: x.date.slice(0, 10), cents });
      const k = idx.get(isoMonth(x.date));
      if (k === undefined) continue;
      clientPer[k]! += cents;
      clientRows.push({ date: x.date.slice(0, 10), counterparty: x.counterparty, cents });
      continue;
    }
    const k = idx.get(isoMonth(x.date));
    if (k === undefined) continue;
    if (cents > 0) otherPer[k]! += cents;
    else if (!(taxPaymentsReplaced && TAX_OFFICE.test(norm(`${x.counterparty} ${x.description}`)))) outPer[k]! += -cents;
  }

  const enough = months.length >= t.minMonths;
  const clientDates = clientRows.map((r) => r.date).sort();
  let longestGapDays: number | null = null;
  for (let k = 1; k < clientDates.length; k++) {
    const g = daysBetween(clientDates[k - 1]!, clientDates[k]!);
    if (longestGapDays === null || g > longestGapDays) longestGapDays = g;
  }

  const meanClient = mean(clientPer);
  const steady = median(otherPer);
  const spend = mean(outPer);
  const quietNet = steady - spend;
  // No client payment at all is not a dry stretch, it is no data on clients.
  const dry = clientRows.length === 0 ? 0 : longestRun(clientPer);

  const liquid = (excludeGoalLinked: boolean): { cents: number | null; source: "accounts" | "stated" | null } => {
    const { eur } = liquidAccountBalances(i);
    const goalKeys = new Set(
      excludeGoalLinked
        ? i.profile.goals.flatMap((g) => g.goal.accountRefs.filter((r) => r.kind === "bank").map((r) => r.id))
        : [],
    );
    const used = eur.filter((a) => !goalKeys.has(a.key));
    if (eur.every((a) => a.cents === null) && i.profile.savingsStatedCents !== null)
      return { cents: i.profile.savingsStatedCents, source: "stated" };
    if (used.length === 0 || used.some((a) => a.cents === null)) return { cents: null, source: null };
    return { cents: sum(used.map((a) => a.cents!)), source: "accounts" };
  };
  const { cents: start, source: startSource } = liquid(false);

  const noClientPayments = enough && clientRows.length === 0;
  const vatCents = chargesVat === true && !noClientPayments ? Math.round((meanClient * vatRate) / (100 + vatRate)) : null;
  const taxBase = meanClient - (vatCents ?? 0);
  const taxCents = pct === null || noClientPayments ? null : Math.round((taxBase * pct) / 100);
  const period = chargesVat === true && !noClientPayments ? nextVatPeriod(vatSettings.frequency, i.asOf, "NL") : null;
  const periodCents =
    period === null
      ? null
      : Math.round(
          (sum(periodRows.filter((r) => r.date >= period.periodStart && r.date <= period.periodEnd).map((r) => r.cents)) * vatRate) /
            (100 + vatRate),
        );

  const asOfMonth = isoMonth(i.asOf);
  const horizon = Array.from({ length: t.horizonMonths }, (_, k) => addMonths(`${asOfMonth}-01`, k + 1).slice(0, 7));
  const quietMonths = Math.min(Math.max(1, dry), t.horizonMonths);
  // The set-asides the card recommends are money that is not free to spend.
  const reserved = (vatCents ?? 0) + (taxCents ?? 0);
  const typicalNet = steady + meanClient - reserved - spend;
  let forward: CashflowFigures["forward"] = null;
  const warnings: CashflowWarning[] = [];
  if (enough && start !== null) {
    const typical = path(start, horizon.map(() => typicalNet), horizon);
    const quiet = path(start, horizon.map((_, k) => (k < quietMonths ? quietNet : typicalNet)), horizon);
    forward = { points: t.horizonMonths, quietMonths, typical, quiet };
    if (typical.lowest.cents < 0) warnings.push({ kind: "typical-below-zero", ...typical.lowest });
    if (quiet.lowest.cents < 0) warnings.push({ kind: "quiet-below-zero", ...quiet.lowest });
  }

  const bufferMonths = bufferMonthsFor(dry);
  const fixed = fixedCostsMonthlyCentsOf(i).cents;
  const bufLiquid = liquid(true).cents;
  const targetCents = fixed === null || fixed <= 0 ? null : bufferMonths * fixed;

  const pack = taxPack("NL");
  const figures: CashflowFigures = {
    months,
    enough,
    client: {
      perMonthCents: clientPer,
      meanCents: meanClient,
      medianCents: median(clientPer),
      minCents: clientPer.length === 0 ? 0 : Math.min(...clientPer),
      maxCents: clientPer.length === 0 ? 0 : Math.max(...clientPer),
      emptyMonths: clientPer.filter((c) => c === 0).length,
      longestDryMonths: dry,
      payments: clientRows.length,
      paymentList: [...clientRows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, CLIENT_LIST_MAX),
      longestGapDays,
      variability: cv(clientPer),
    },
    noClientPayments,
    steadyMonthlyCents: steady,
    spendMonthlyCents: spend,
    taxPaymentsReplaced,
    quietNetCents: quietNet,
    startCents: start,
    startSource,
    quietCoverMonths: start !== null && quietNet < 0 ? Math.floor(start / -quietNet) : null,
    forward,
    buffer: {
      months: bufferMonths,
      fixedCents: fixed,
      targetCents,
      liquidCents: bufLiquid,
      gapCents: targetCents === null || bufLiquid === null ? null : Math.max(0, targetCents - bufLiquid),
      ownTargetMonths: i.profile.bufferTargetMonths,
    },
    setAside: {
      incomeTax: { baseCents: taxBase, pct, cents: taxCents },
      vat: {
        chargesVat,
        ratePct: vatRate,
        cents: vatCents,
        periodCents,
        deadline: period === null ? null : period.deadline,
        frequency: vatSettings.frequency,
        rulesAsOf: pack.rulesAsOf,
      },
      leftCents: taxCents === null ? null : meanClient - (vatCents ?? 0) - taxCents,
    },
  };

  const calc: CalcStep[] = [];
  if (enough) {
    calc.push({
      id: "client-income",
      inputs: { months: fig("count", months.length), empty: fig("count", figures.client.emptyMonths), payments: fig("count", clientRows.length) },
      output: fig("cents", meanClient),
    });
    calc.push({
      id: "quiet-month",
      inputs: { steady: fig("cents", steady), spend: fig("cents", spend) },
      output: fig("cents", quietNet),
    });
    if (forward !== null) {
      calc.push({
        id: "forward-typical",
        inputs: {
          start: fig("cents", start),
          per_month: fig("cents", typicalNet),
          reserved: fig("cents", reserved),
          stated: fig("count", startSource === "stated" ? 1 : 0),
        },
        output: fig("cents", forward.typical.lowest.cents),
      });
      calc.push({
        id: "forward-quiet",
        inputs: {
          start: fig("cents", start),
          quiet_months: fig("count", quietMonths),
          per_quiet_month: fig("cents", quietNet),
          stated: fig("count", startSource === "stated" ? 1 : 0),
          points: fig("count", t.horizonMonths),
        },
        output: fig("cents", forward.quiet.lowest.cents),
      });
    }
  }
  calc.push({
    id: "buffer-target",
    inputs: { dry_months: fig("count", dry), base_months: fig("count", t.bufferBaseMonths), fixed: fig("cents", fixed), max_months: fig("count", t.bufferMaxMonths) },
    output: fig("months", bufferMonths),
  });
  calc.push({
    id: "income-tax",
    inputs: { base: fig("cents", taxBase), pct: fig("pct", pct), vat_known: fig("count", chargesVat === null ? 0 : 1) },
    output: fig("cents", taxCents),
  });
  if (vatCents !== null) {
    calc.push({
      id: "vat",
      inputs: { client: fig("cents", meanClient), rate: fig("pct", vatRate), period: fig("cents", periodCents) },
      output: fig("cents", vatCents),
    });
  }

  return { figures, warnings, calc };
}
