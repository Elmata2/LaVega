import { addMonths } from "../advisor/months.js";
import { looksLikeLender } from "../advisor/lenders.js";
import { personalView } from "../advisor/scopePersonal.js";
import { accountTypeKind } from "../balance.js";
import { matchNorm } from "../categories.js";
import { hash } from "../hash.js";
import { isEurCurrency } from "../model.js";
import { resolveAccountRate } from "../interest.js";
import { fig } from "./internal.js";
import type {
  CalcStep,
  FigureValue,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** Every key this section puts in `flat` (the change log labels each one). */
export const DEBTS_FLAT_IDS = [
  "debt_count",
  "debt_interest_year_total",
  "savings_interest_pct",
] as const;
export type DebtsFlatId = (typeof DEBTS_FLAT_IDS)[number];

export const DEBTS_CALC_IDS = [
  "interest-per-year",
  "payoff",
  "extra-payment",
  "savings-rate",
] as const;
export type DebtsCalcId = (typeof DEBTS_CALC_IDS)[number];

export type DebtRow = {
  id: string;
  lender: string;
  balanceCents: number | null;
  ratePct: number | null;
  rateSource: "stated" | "detected" | null;
  monthlyCents: number;
  interestPerYearCents: number | null;
  payoffMonths: number | null;
  payoffDate: string | null;
  /** Why payoffMonths is null; null when it is known. */
  payoffReason: "payment-below-interest" | "no-balance" | "no-rate" | null;
  withExtra: {
    extraCents: number;
    payoffMonths: number | null;
    monthsEarlier: number | null;
    interestSavedCents: number | null;
  } | null;
  /** DUO rows carry no rule text: DUO's rules are unverified (spec 15.6). */
  kind: "consumer" | "duo" | "other";
};

export type DebtFigures = {
  rows: DebtRow[];
  totalInterestPerYearCents: number | null;
  savingsRatePct: number | null;
  /** Absence of visible debt is never "debt-free": the screen always says so. */
  invisibleDebtNotice: true;
};

/** Hard stop for the month loop: 100 years. */
export const AMORTISE_MAX_MONTHS = 1200;

/** Monthly compounding at ratePct/12, payment at month end, interest rounded to
 *  a whole cent each month. `months` is null when the payment does not cover
 *  the first month's interest (the balance never falls) or the loop would pass
 *  1200 months. `interestCents` is the interest paid up to the payoff (or up to
 *  the cap when `months` is null). */
export function amortise(i: {
  balanceCents: number;
  ratePct: number;
  paymentCents: number;
  extraCents?: number;
}): { months: number | null; interestCents: number } {
  const payment = i.paymentCents + (i.extraCents ?? 0);
  const r = i.ratePct / 100 / 12;
  let balance = Math.max(0, Math.round(i.balanceCents));
  if (balance === 0) return { months: 0, interestCents: 0 };
  if (!Number.isFinite(payment) || !Number.isFinite(r) || payment <= 0)
    return { months: null, interestCents: 0 };
  // The same rounded interest the loop uses, so a sub-euro balance cannot stall it.
  if (payment <= Math.round(balance * r)) return { months: null, interestCents: 0 };
  let interest = 0;
  for (let m = 1; m <= AMORTISE_MAX_MONTHS; m++) {
    const monthInterest = Math.round(balance * r);
    interest += monthInterest;
    balance += monthInterest;
    if (payment >= balance) return { months: m, interestCents: interest };
    balance -= payment;
  }
  return { months: null, interestCents: interest };
}

const DUO_WORDS = ["duo", "dienst uitvoering onderwijs", "studieschuld"];
function kindOf(lender: string): DebtRow["kind"] {
  const h = ` ${matchNorm(lender)} `;
  if (DUO_WORDS.some((w) => h.includes(` ${w} `))) return "duo";
  return looksLikeLender(lender) ? "consumer" : "other";
}

const FACT_SAFE = /^[a-z0-9_-]+$/;
const baseIdPart = (id: string): string => (FACT_SAFE.test(id) ? id : `h${hash(id)}`);

export function computeDebts(i: PlanInput): SectionResult<DebtFigures> {
  const calc: CalcStep[] = [];
  const missing: Missing[] = [];
  const facts: PlanFact[] = [];
  const fact = (f: Omit<PlanFact, "section" | "polarity" | "mustMention"> & Partial<PlanFact>) =>
    facts.push({ section: "debts", polarity: "neutral", mustMention: false, ...f });

  // Two debts with the same id must not produce the same fact id.
  const usedKeys = new Set<string>();
  const idPart = (id: string): string => {
    const base = baseIdPart(id);
    let key = base;
    for (let n = 2; usedKeys.has(key); n++) key = `${base}-${n}`;
    usedKeys.add(key);
    return key;
  };

  const rows: DebtRow[] = i.profile.debts.map((d) => {
    const balanceCents = d.balanceCents ?? null;
    // A negative rate is not a rate: treated as not entered.
    const ratePct = d.ratePct !== undefined && d.ratePct >= 0 ? d.ratePct : null;
    const row: DebtRow = {
      id: d.id,
      lender: d.lender,
      balanceCents,
      ratePct,
      rateSource: ratePct === null ? null : d.source === "derived" ? "detected" : "stated",
      monthlyCents: d.monthlyCents,
      interestPerYearCents: null,
      payoffMonths: null,
      payoffDate: null,
      payoffReason: ratePct === null ? "no-rate" : balanceCents === null ? "no-balance" : null,
      withExtra: null,
      kind: kindOf(d.lender),
    };
    const key = idPart(d.id);
    if (ratePct === null) {
      missing.push({ kind: "debt-rate", action: "enter-figure", ref: d.id });
      return row;
    }
    if (balanceCents === null) {
      missing.push({ kind: "debt-balance", action: "enter-figure", ref: d.id });
      return row;
    }

    row.interestPerYearCents = Math.round((balanceCents * ratePct) / 100);
    calc.push({
      id: "interest-per-year",
      inputs: { balance: fig("cents", balanceCents), rate: fig("pct", ratePct) },
      output: fig("cents", row.interestPerYearCents),
    });
    fact({ factId: `debt_interest_year:${key}`, exact: row.interestPerYearCents, unit: "cents" });

    const base = amortise({ balanceCents, ratePct, paymentCents: d.monthlyCents });
    row.payoffMonths = base.months;
    row.payoffReason = base.months === null ? "payment-below-interest" : null;
    row.payoffDate = base.months === null ? null : addMonths(i.asOf, base.months);
    calc.push({
      id: "payoff",
      inputs: {
        balance: fig("cents", balanceCents),
        rate: fig("pct", ratePct),
        payment: fig("cents", d.monthlyCents),
      },
      output: fig("months", base.months),
    });
    if (base.months !== null)
      fact({ factId: `debt_payoff_months:${key}`, exact: base.months, unit: "months" });

    const extra = i.preferences.extraDebtPayment[d.id]?.cents;
    if (extra !== undefined) {
      const withExtra = amortise({
        balanceCents,
        ratePct,
        paymentCents: d.monthlyCents,
        extraCents: extra,
      });
      const earlier =
        base.months !== null && withExtra.months !== null ? base.months - withExtra.months : null;
      const saved =
        base.months !== null && withExtra.months !== null
          ? base.interestCents - withExtra.interestCents
          : null;
      row.withExtra = {
        extraCents: extra,
        payoffMonths: withExtra.months,
        monthsEarlier: earlier,
        interestSavedCents: saved,
      };
      calc.push({
        id: "extra-payment",
        inputs: { extra: fig("cents", extra), base_months: fig("months", base.months) },
        output: fig("months", withExtra.months),
      });
      if (saved !== null) fact({ factId: `debt_extra_saving:${key}`, exact: saved, unit: "cents" });
    }
    return row;
  });

  // A total over some of the debts would read as the total: null unless all are known.
  const totalInterestPerYearCents =
    rows.length === 0 || rows.some((r) => r.interestPerYearCents === null)
      ? null
      : rows.reduce((s, r) => s + r.interestPerYearCents!, 0);

  // The user's own kept rate: the biggest personal savings account whose rate is known.
  let savingsRatePct: number | null = null;
  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const savers = view.accounts
    .filter((a) => accountTypeKind(a) === "savings" && isEurCurrency(a.currency))
    .map((a) => ({ a, rate: resolveAccountRate(a, view.txs, i.asOf, i.rates) }))
    .filter((x) => x.rate.ratePct !== null)
    .sort((x, y) => (y.a.balance ?? 0) - (x.a.balance ?? 0));
  if (savers.length > 0) {
    savingsRatePct = savers[0]!.rate.ratePct;
    calc.push({
      id: "savings-rate",
      inputs: { balance: fig("cents", Math.round((savers[0]!.a.balance ?? 0) * 100)) },
      output: fig("pct", savingsRatePct),
    });
    fact({ factId: "savings_interest_pct", exact: savingsRatePct!, unit: "pct" });
  }

  let status: SectionResult<DebtFigures>["status"];
  let statusReason: StatusReason;
  // "No debt" is a fact only after the intake asked (block 2 types debts in).
  if (rows.length === 0 && i.profile.intakeBlocksDone < 2) {
    status = "not-enough-data";
    statusReason = { key: "debts-not-asked" };
    missing.push({ kind: "debts", action: "intake-question", ref: "debts" });
  } else if (rows.some((r) => r.ratePct === null)) {
    status = "not-enough-data";
    statusReason = { key: "debt-rate-missing" };
  } else if (rows.some((r) => r.monthlyCents > 0 && r.payoffReason === "payment-below-interest")) {
    // Attention only for a payment that does not cover its own interest.
    status = "attention";
    statusReason = { key: "debt-payment-below-interest" };
  } else if (rows.some((r) => r.monthlyCents > 0)) {
    status = "on-track";
    statusReason = { key: "debt-payments" };
  } else {
    // No debts, or debts listed with no monthly payment: nothing to act on.
    status = "on-track";
    statusReason = { key: rows.length === 0 ? "no-debt" : "debt-no-payments" };
  }

  const flat: Record<DebtsFlatId, FigureValue> = {
    debt_count: fig("count", rows.length),
    debt_interest_year_total: fig("cents", totalInterestPerYearCents),
    savings_interest_pct: fig("pct", savingsRatePct),
  };

  return {
    section: "debts",
    figures: {
      rows,
      totalInterestPerYearCents,
      savingsRatePct,
      invisibleDebtNotice: true,
    },
    flat,
    headline: fig("cents", totalInterestPerYearCents),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}
