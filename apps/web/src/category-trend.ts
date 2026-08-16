import type { OwnAccounts, Rule, Tx } from "@lavega/core";
import { categorize } from "@lavega/core";
import { monthLabelNL } from "./format.js";

/* "Changes in major categories" (BACKLOG item 6) as a pure derivation.
 *
 * Core already has categoryComparison(), but it answers a different question:
 * the latest month's categories with a Δ printed as text. A side-by-side bar
 * chart needs two comparable numbers per category, and needs to work over a
 * quarter as well as a month — so the windowing lives here, in the web app,
 * built on core's categorize(). packages/core is not touched.
 *
 * The window always ends at the newest transaction in the data, never at
 * today's clock: an imported historical statement then charts itself instead of
 * showing an empty "this month". Same rule core's categoryComparison uses. */

export type TrendPeriod = "maand" | "kwartaal";

export const TREND_PERIODS: { value: TrendPeriod; label: string }[] = [
  { value: "maand", label: "Per maand" },
  { value: "kwartaal", label: "Per kwartaal" },
];

export type CategoryTrendRow = {
  category: string;
  /** Spend in the current window, positive euros. */
  current: number;
  /** Spend in the window before it, positive euros. */
  previous: number;
  /** Change vs. the previous window; null when there was no earlier spend. */
  changePct: number | null;
};

export type CategoryTrend = {
  /** Human label for the current window, e.g. "aug 2026" or "jun – aug 2026". */
  currentLabel: string;
  previousLabel: string;
  rows: CategoryTrendRow[];
};

/** Transfers between the owner's own accounts are not spending. */
const TRANSFER_CATEGORY = "Eigen overboeking";

const monthOf = (date: string): string => date.slice(0, 7);

/** Step a "YYYY-MM" back by n months. */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The `length` months ending at `end`, oldest first. */
function monthsEndingAt(end: string, length: number): string[] {
  return Array.from({ length }, (_, i) => shiftMonth(end, length - 1 - i));
}

function windowLabel(months: string[]): string {
  if (months.length === 0) return "";
  if (months.length === 1) return monthLabelNL(months[0]);
  return `${monthLabelNL(months[0])} – ${monthLabelNL(months[months.length - 1])}`;
}

/** Spend per category over two adjacent windows, biggest current spend first.
 *  `topN` caps the rows — a bar chart with twenty categories is unreadable, and
 *  the question is about the MAJOR ones. */
export function categoryTrend(
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  period: TrendPeriod,
  topN: number,
): CategoryTrend {
  const dates = txs.map((t) => t.date).filter(Boolean);
  if (dates.length === 0) return { currentLabel: "", previousLabel: "", rows: [] };

  const length = period === "kwartaal" ? 3 : 1;
  const end = monthOf(dates.reduce((a, b) => (a > b ? a : b)));
  const currentMonths = monthsEndingAt(end, length);
  const previousMonths = monthsEndingAt(shiftMonth(end, length), length);
  const inCurrent = new Set(currentMonths);
  const inPrevious = new Set(previousMonths);

  const cur: Record<string, number> = {};
  const prev: Record<string, number> = {};
  for (const t of txs) {
    if (t.amount >= 0) continue; // spend only
    const c = categorize(t, rules, own);
    if (c === TRANSFER_CATEGORY) continue;
    const mo = monthOf(t.date);
    const spend = -t.amount;
    if (inCurrent.has(mo)) cur[c] = (cur[c] ?? 0) + spend;
    else if (inPrevious.has(mo)) prev[c] = (prev[c] ?? 0) + spend;
  }

  // A category that was spent on in the previous window but not in the current
  // one is exactly the change worth seeing, so both sides seed the row list.
  const categories = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  const rows: CategoryTrendRow[] = [...categories]
    .map((category) => {
      const current = cur[category] ?? 0;
      const previous = prev[category] ?? 0;
      return {
        category,
        current,
        previous,
        changePct: previous > 0 ? ((current - previous) / previous) * 100 : null,
      };
    })
    .sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous))
    .slice(0, topN);

  return {
    currentLabel: windowLabel(currentMonths),
    previousLabel: windowLabel(previousMonths),
    rows,
  };
}

/** A short label for a bar-chart slot. Full names are long ("Kleding &
 *  winkelen"); the chart keeps the full text in the bar's title attribute. */
export function shortCategory(category: string, max = 12): string {
  if (category.length <= max) return category;
  return `${category.slice(0, max - 1).trimEnd()}…`;
}
