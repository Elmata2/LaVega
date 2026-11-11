import type { Account, ScheduledFlow, Tx } from "./model.js";
import { isEurCurrency } from "./model.js";
import { accountTypeKind } from "./balance.js";
import { magnitudeCents, toCents } from "./money.js";
import { TRANSFER_CATEGORY } from "./transfers.js";
import type { EntityForecast } from "./forecast.js";
import type { TrackedStatus } from "./tracking.js";

/* The "Aandacht" alert-center. Pure + deterministic: derives a ranked list of
 * things worth the owner's attention from the already-computed forecast +
 * accounts. No I/O, no clock (asOf is passed in). The forecast must be built
 * with the user's buffer so `shortfall` reflects it. */

export type AlertSeverity = "critical" | "warning" | "info";

/** The FACTS a rendered alert sentence needs, carrying no prose and no
 *  locale. A view renders `title`/`detail` from a `body` via a `copy/`
 *  module typed `Record<Locale, T>` — see AandachtBlock.tsx and
 *  apps/web/src/copy/money.ts. One variant per alert site below. */
export type AlertBody =
  | { kind: "shortfall"; date: string; balanceCents: number; bufferCents: number }
  | {
      kind: "missed-stream";
      sign: 1 | -1;
      counterparty: string;
      amountCents: number;
      expectedDate: string;
    }
  | { kind: "vat-due"; label: string; dueDate: string; amountCents: number; days: number }
  | {
      kind: "tax-prepayment-due";
      label: string;
      dueDate: string;
      amountCents: number;
      days: number;
    }
  | {
      kind: "tracking-stale";
      label: string;
      unit: string;
      updatedAt: string;
      ageDays: number;
    }
  | { kind: "no-balance"; count: number };

export type Alert = { id: string; severity: AlertSeverity; body: AlertBody };

/** Whole days from ISO `a` to ISO `b` (b - a), via Date.UTC (locale/TZ-safe). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export type ComputeAlertsInput = {
  accounts: Account[];
  forecast: EntityForecast; // consolidated, built with the user's bufferCents
  asOf: string;
  bufferCents: number;
  scheduledFlows?: ScheduledFlow[];
  /** Hand-kept numbers that have gone stale (from `dueTrackers`). The alert
   *  center is LaVega's notification surface, so this is where item 7's
   *  low-trust ask lands: one row per number, carrying its own question. */
  tracking?: TrackedStatus[];
};

/** Ranked alerts (critical → warning → info):
 *  - critical: a forecast shortfall (saldo dips below the buffer)
 *  - warning:  a recurring stream whose next payment is overdue (recently)
 *  - info:     accounts still missing a saldo
 *  Missed-payment detection uses each stream's lastDate: a real arrival would
 *  have extended it. Only flagged when overdue past a grace window and by no
 *  more than two cadence cycles (older ⇒ assume the stream simply ended). */
export function computeAlerts({
  accounts,
  forecast,
  asOf,
  bufferCents,
  scheduledFlows,
  tracking,
}: ComputeAlertsInput): Alert[] {
  const alerts: Alert[] = [];

  if (forecast.shortfall) {
    alerts.push({
      id: "shortfall",
      severity: "critical",
      body: {
        kind: "shortfall",
        date: forecast.shortfall.date,
        balanceCents: forecast.shortfall.balanceCents,
        bufferCents,
      },
    });
  }

  for (const s of forecast.streams) {
    const expectedNext = addDays(s.lastDate, s.cadenceDays);
    const overdueDays = daysBetween(expectedNext, asOf);
    const grace = Math.max(3, Math.round(s.cadenceDays * 0.2));
    if (overdueDays > grace && overdueDays <= s.cadenceDays * 2) {
      alerts.push({
        id: `missed:${s.key}`,
        severity: "warning",
        body: {
          kind: "missed-stream",
          sign: s.sign,
          counterparty: s.counterparty,
          amountCents: s.amountCents,
          expectedDate: expectedNext,
        },
      });
    }
  }

  for (const f of scheduledFlows ?? []) {
    const isVat = f.source === "vat";
    const isPrepayment = f.source === "prepayment";
    if ((!isVat && !isPrepayment) || f.status === "paid" || f.status === "cancelled") continue;
    const days = daysBetween(asOf, f.dueDate); // dueDate - asOf
    if (days < 0 || days > 30) continue;
    const severity: AlertSeverity = days <= 3 ? "critical" : days <= 14 ? "warning" : "info";
    alerts.push({
      id: `${isVat ? "vat" : "tax"}:${f.id}`,
      severity,
      body: isVat
        ? { kind: "vat-due", label: f.label, dueDate: f.dueDate, amountCents: f.amountCents, days }
        : {
            kind: "tax-prepayment-due",
            label: f.label,
            dueDate: f.dueDate,
            amountCents: f.amountCents,
            days,
          },
    });
  }

  // Hand-kept numbers that have gone stale. `warning` once genuinely overdue,
  // `info` while merely due — this must never outrank a real cash problem. The
  // detail IS the question, so answering is one number away.
  for (const t of tracking ?? []) {
    if (t.state !== "due" && t.state !== "overdue") continue;
    alerts.push({
      id: `tracking:${t.source}:${t.id}`,
      severity: t.state === "overdue" ? "warning" : "info",
      body: {
        kind: "tracking-stale",
        label: t.label,
        unit: t.unit,
        updatedAt: t.updatedAt,
        ageDays: t.ageDays,
      },
    });
  }

  const noBalance = accounts.filter((a) => a.balance === null).length;
  if (noBalance > 0) {
    alerts.push({
      id: "no-balance",
      severity: "info",
      body: { kind: "no-balance", count: noBalance },
    });
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ── Insights (WS1.7, issue #284) ─────────────────────────────────────────────
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-10.
 *
 * Sure sources: `app/models/insight/generators/spending_anomaly_generator.rb`,
 * `idle_cash_generator.rb`, `savings_rate_change_generator.rb` — AGPL-3.0. The
 * three formulas LaVega does not already have; the subscription price increase
 * lives in `subscriptions.ts` and the cash-flow warning maps to the existing
 * forecast shortfall alert above.
 *
 * A DIFFERENT SHAPE FROM `Alert`. An alert is a ranked warning the owner must
 * act on; an insight is a derived observation with its arithmetic shown. Each
 * one carries typed `facts` (for `copy/`, no prose here) and a
 * `howCalculated` block: the formula id, the threshold table in force and the
 * exact inputs, so the "how calculated" line is rendered from data instead of
 * being retyped next to the formula. Unknown input SUPPRESSES the insight — it
 * never guesses a baseline, a rate or an idle window (ADR 0011 §8).
 *
 * Money stays in integer cents here; `Tx.amount` is read only through
 * `magnitudeCents`, and only rows in EUR are counted (a foreign pocket has no
 * rate at this point, so it is excluded rather than summed at face value).
 */

/** The threshold table the spending-anomaly insight applies. Values are the
 *  ones Sure's generator states (`spending_anomaly_generator.rb:6-11`), in
 *  LaVega's units: cents and calendars, not currency floats. */
export const SPENDING_ANOMALY_THRESHOLDS = {
  /** Before this many days into the month the pace projection is noise. */
  minElapsedDays: 7,
  /** Ignore a category whose baseline is negligible: €50, Sure's MIN_BASELINE
   *  of 50 currency units. */
  minBaselineCents: 5_000,
  /** Flag at or above this absolute deviation from the trailing median. */
  deviationPct: 25,
  /** "high" at or above this absolute deviation, "medium" below it. */
  highPriorityPct: 50,
  /** Trailing complete months the baseline is the median of (plan §3 WS1.7). */
  baselineMonths: 3,
  /** Keep the ranking short; Sure caps at three. */
  maxInsights: 3,
} as const;

/** Sure `idle_cash_generator.rb:12-14`, in cents. */
export const IDLE_CASH_THRESHOLDS = {
  /** Sure's MIN_BALANCE of 5,000 currency units, in cents. */
  minBalanceCents: 500_000,
  /** No booking on the account inside this many days means idle. */
  idleDays: 60,
  /** Keep the nudge rare; Sure caps at two accounts. */
  maxInsights: 2,
} as const;

/** Sure `savings_rate_change_generator.rb:7-8`, in percentage points. */
export const SAVINGS_RATE_CHANGE_THRESHOLDS = {
  /** Flag at or above this absolute change between the two last full months. */
  thresholdPp: 5,
  /** "high" at or above this change, "medium" below it. */
  highPriorityPp: 10,
} as const;

/** Every insight's thresholds in one table, keyed by kind, so a copy module can
 *  render "how calculated" from the same numbers the formula used. */
export const INSIGHT_THRESHOLDS = {
  "spending-anomaly": SPENDING_ANOMALY_THRESHOLDS,
  "idle-cash": IDLE_CASH_THRESHOLDS,
  "savings-rate-change": SAVINGS_RATE_CHANGE_THRESHOLDS,
} as const;

export type InsightPriority = "high" | "medium" | "low";

export type InsightFormula =
  | "projected-month-vs-trailing-median"
  | "no-activity-window"
  | "savings-rate-difference";

/** The arithmetic behind one insight, as data. `formula` names the shape for
 *  the copy module; `thresholds` is the exported table in force; `inputs` are
 *  the numbers this run used (a null input is what suppressed, not a zero). */
export type InsightHowCalculated = {
  formula: InsightFormula;
  thresholds: Readonly<Record<string, number>>;
  inputs: Readonly<Record<string, number | string | null>>;
};

export type SpendingAnomalyFacts = {
  category: string;
  direction: "above" | "below";
  /** The current month's spend projected to the month's true length. */
  projectedCents: number;
  /** The trailing median the projection is compared against. */
  baselineCents: number;
  /** Absolute deviation, one decimal. */
  deviationPct: number;
};

export type SpendingAnomalyInsight = {
  kind: "spending-anomaly";
  id: string;
  priority: InsightPriority;
  facts: SpendingAnomalyFacts;
  howCalculated: InsightHowCalculated;
};

export type IdleCashFacts = {
  accountKey: string;
  accountName: string;
  balanceCents: number;
  /** Whole days since the last booking; the window size when none exists. */
  idleDays: number;
};

export type IdleCashInsight = {
  kind: "idle-cash";
  id: string;
  priority: InsightPriority;
  facts: IdleCashFacts;
  howCalculated: InsightHowCalculated;
};

export type SavingsRateChangeFacts = {
  /** The last complete month, ISO YYYY-MM. */
  month: string;
  /** Signed percentages; negative means the month spent more than it earned. */
  currentRatePct: number;
  previousRatePct: number;
  /** Absolute change in percentage points, one decimal. */
  changePp: number;
  direction: "up" | "down";
};

export type SavingsRateChangeInsight = {
  kind: "savings-rate-change";
  id: string;
  priority: InsightPriority;
  facts: SavingsRateChangeFacts;
  howCalculated: InsightHowCalculated;
};

export type Insight = SpendingAnomalyInsight | IdleCashInsight | SavingsRateChangeInsight;

/** Categories that move money instead of spending it. Mirrors the web's
 *  `MOVED_CATEGORIES` (statistics.ts) plus the transfer projection: counting a
 *  savings sweep or a credit-card settlement as spending would make the savings
 *  rate and the anomaly baseline lie. */
const INSIGHT_MOVED_CATEGORIES: ReadonlySet<string> = new Set([
  TRANSFER_CATEGORY,
  "Sparen & beleggen",
  "Creditcard afbetaald",
]);

const monthOf = (iso: string): string => iso.slice(0, 7);

/** `month` shifted by `delta` months, ISO YYYY-MM. */
function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** The true length of the month, taken from its start date — the current month
 *  is a partial period, so its own day count is not the divisor. */
function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function earliestTxDate(txs: readonly Tx[]): string | null {
  let earliest: string | null = null;
  for (const tx of txs) {
    if (earliest === null || tx.date < earliest) earliest = tx.date;
  }
  return earliest;
}

/** Spend per category in one month, positive cents, transfer projections and
 *  excluded rows left out. */
function categorySpend(txs: readonly Tx[], month: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    if (!isEurCurrency(tx.currency) || tx.amount >= 0 || tx.excluded === true) continue;
    if (monthOf(tx.date) !== month) continue;
    const category = tx.category ?? "";
    if (!category || INSIGHT_MOVED_CATEGORIES.has(category)) continue;
    totals.set(category, (totals.get(category) ?? 0) + magnitudeCents(tx.amount));
  }
  return totals;
}

/** Median of three monthly totals. A month with no spend in that category is a
 *  real zero, not a missing value — two zero months make the median zero and
 *  the baseline "unknown", which suppresses the insight instead of flagging a
 *  brand-new category against nothing. */
function trailingMedianThrice(values: readonly [number, number, number]): number {
  return [...values].sort((a, b) => a - b)[1];
}

/** Spending anomaly: the current month's projected spend against the trailing
 *  median of the three complete months before it. Sure projects against the
 *  MEAN of the previous three months (`spending_anomaly_generator.rb:47-61`);
 *  the plan asks for the median, which one outlier month cannot pull. */
export function spendingAnomalyInsights(input: {
  txs: readonly Tx[];
  asOf: string;
}): SpendingAnomalyInsight[] {
  const { txs, asOf } = input;
  const month = monthOf(asOf);
  const elapsedDays = Number(asOf.slice(8, 10));
  if (!Number.isInteger(elapsedDays) || elapsedDays < SPENDING_ANOMALY_THRESHOLDS.minElapsedDays) {
    return [];
  }
  const current = categorySpend(txs, month);
  if (current.size === 0) return [];

  const monthDays = daysInMonth(month);
  const paceFactor = monthDays / elapsedDays;
  const baselineMonths = [1, 2, 3].map((back) => shiftMonth(month, -back));
  // The oldest baseline month must be covered by the ledger, or its "zero" is
  // an import gap, not a quiet month. Unknown baseline suppresses.
  const earliest = earliestTxDate(txs);
  if (earliest === null || monthOf(earliest) > baselineMonths[baselineMonths.length - 1]) return [];
  const baselineByMonth = baselineMonths.map((back) => categorySpend(txs, back));

  const anomalies: SpendingAnomalyInsight[] = [];
  for (const [category, currentCents] of current) {
    const monthlyTotals = baselineByMonth.map((totals) => totals.get(category) ?? 0);
    const baselineCents = trailingMedianThrice([
      monthlyTotals[0] ?? 0,
      monthlyTotals[1] ?? 0,
      monthlyTotals[2] ?? 0,
    ]);
    if (baselineCents < SPENDING_ANOMALY_THRESHOLDS.minBaselineCents) continue;

    const projectedCents = Math.round(currentCents * paceFactor);
    const deviationPct = ((projectedCents - baselineCents) / baselineCents) * 100;
    if (Math.abs(deviationPct) < SPENDING_ANOMALY_THRESHOLDS.deviationPct) continue;

    const direction = deviationPct > 0 ? "above" : "below";
    anomalies.push({
      kind: "spending-anomaly",
      id: `spending-anomaly:${category}:${month}`,
      priority:
        Math.abs(deviationPct) >= SPENDING_ANOMALY_THRESHOLDS.highPriorityPct ? "high" : "medium",
      facts: {
        category,
        direction,
        projectedCents,
        baselineCents,
        deviationPct: round1(Math.abs(deviationPct)),
      },
      howCalculated: {
        formula: "projected-month-vs-trailing-median",
        thresholds: SPENDING_ANOMALY_THRESHOLDS,
        inputs: {
          month,
          elapsedDays,
          monthDays,
          paceFactor,
          baselineMonths: baselineMonths.join(","),
          earliestTxDate: earliest,
        },
      },
    });
  }
  return anomalies
    .sort((a, b) => Math.abs(b.facts.deviationPct) - Math.abs(a.facts.deviationPct))
    .slice(0, SPENDING_ANOMALY_THRESHOLDS.maxInsights);
}

/** Idle cash: a sizable cash balance with no booking in the idle window. Sure
 *  restricts to Depository accounts (`idle_cash_generator.rb:36-40`), which in
 *  LaVega's vocabulary is the current and savings account kinds. A null balance
 *  or a non-EUR pocket is unknown and suppresses the insight — the threshold is
 *  in euros, so a foreign balance cannot be compared to it. */
export function idleCashInsights(input: {
  accounts: readonly Account[];
  txs: readonly Tx[];
  asOf: string;
}): IdleCashInsight[] {
  const { accounts, txs, asOf } = input;
  const month = monthOf(asOf);
  const cutoff = addDays(asOf, -IDLE_CASH_THRESHOLDS.idleDays);
  const lastActivity = new Map<string, string>();
  for (const tx of txs) {
    const previous = lastActivity.get(tx.accountKey);
    if (previous === undefined || tx.date > previous) lastActivity.set(tx.accountKey, tx.date);
  }

  const idle: IdleCashInsight[] = [];
  for (const account of accounts) {
    const kind = accountTypeKind(account);
    if (kind !== "current" && kind !== "savings") continue;
    if (!isEurCurrency(account.currency)) continue;
    if (account.balance === null) continue;
    const balanceCents = toCents(account.balance);
    if (balanceCents < IDLE_CASH_THRESHOLDS.minBalanceCents) continue;
    const last = lastActivity.get(account.key) ?? null;
    // Any booking on or after the cutoff (a future-dated one included) means the
    // account was touched inside the window.
    if (last !== null && last >= cutoff) continue;
    idle.push({
      kind: "idle-cash",
      id: `idle-cash:${account.key}:${month}`,
      priority: "low",
      facts: {
        accountKey: account.key,
        accountName: account.name,
        balanceCents,
        idleDays: last === null ? IDLE_CASH_THRESHOLDS.idleDays : daysBetween(last, asOf),
      },
      howCalculated: {
        formula: "no-activity-window",
        thresholds: IDLE_CASH_THRESHOLDS,
        inputs: {
          accountKey: account.key,
          balanceCents,
          lastActivityDate: last,
          cutoffDate: cutoff,
        },
      },
    });
  }
  return idle
    .sort((a, b) => b.facts.balanceCents - a.facts.balanceCents)
    .slice(0, IDLE_CASH_THRESHOLDS.maxInsights);
}

/** Income, spending and savings rate for one complete month. `null` when the
 *  month's income is zero or absent — a rate over a zero denominator is
 *  undefined, never 0% and never 100%. */
function monthlySavingsRate(
  txs: readonly Tx[],
  month: string,
): { ratePct: number; incomeCents: number; spendingCents: number } | null {
  let incomeCents = 0;
  let spendingCents = 0;
  for (const tx of txs) {
    if (!isEurCurrency(tx.currency) || tx.excluded === true) continue;
    if (tx.category && INSIGHT_MOVED_CATEGORIES.has(tx.category)) continue;
    if (monthOf(tx.date) !== month) continue;
    if (tx.amount > 0) incomeCents += magnitudeCents(tx.amount);
    else if (tx.amount < 0) spendingCents += magnitudeCents(tx.amount);
  }
  if (incomeCents <= 0) return null;
  // (income - spending) / income: the same formula as Sure's cash flow
  // statement (`income_statement/cash_flow.rb` in the same commit).
  return {
    ratePct: ((incomeCents - spendingCents) / incomeCents) * 100,
    incomeCents,
    spendingCents,
  };
}

/** Savings-rate change: the two last COMPLETE months, compared in percentage
 *  points. The current partial month is skipped on purpose — income lands early
 *  or late, which makes a mid-month rate meaningless (`savings_rate_change_
 *  generator.rb:1-3`). Unknown income in either month suppresses. */
export function savingsRateChangeInsights(input: {
  txs: readonly Tx[];
  asOf: string;
}): SavingsRateChangeInsight[] {
  const { txs, asOf } = input;
  const currentMonth = shiftMonth(monthOf(asOf), -1); // last complete month
  const previousMonth = shiftMonth(currentMonth, -1);
  // Both complete months must be inside the ledger, or a missing import reads
  // as a month without income.
  const earliest = earliestTxDate(txs);
  if (earliest === null || monthOf(earliest) > previousMonth) return [];
  const current = monthlySavingsRate(txs, currentMonth);
  const previous = monthlySavingsRate(txs, previousMonth);
  if (current === null || previous === null) return [];

  const delta = current.ratePct - previous.ratePct;
  if (Math.abs(delta) < SAVINGS_RATE_CHANGE_THRESHOLDS.thresholdPp) return [];
  return [
    {
      kind: "savings-rate-change",
      id: `savings-rate-change:${currentMonth}`,
      priority:
        Math.abs(delta) >= SAVINGS_RATE_CHANGE_THRESHOLDS.highPriorityPp ? "high" : "medium",
      facts: {
        month: currentMonth,
        currentRatePct: round1(current.ratePct),
        previousRatePct: round1(previous.ratePct),
        changePp: round1(Math.abs(delta)),
        direction: delta > 0 ? "up" : "down",
      },
      howCalculated: {
        formula: "savings-rate-difference",
        thresholds: SAVINGS_RATE_CHANGE_THRESHOLDS,
        inputs: {
          month: currentMonth,
          previousMonth,
          currentIncomeCents: current.incomeCents,
          currentSpendingCents: current.spendingCents,
          previousIncomeCents: previous.incomeCents,
          previousSpendingCents: previous.spendingCents,
          earliestTxDate: earliest,
        },
      },
    },
  ];
}
