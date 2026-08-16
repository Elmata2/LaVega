import { useMemo, useState } from "react";
import type { OwnAccounts, Rule, Tx } from "@lavega/core";
import { categoryTrend, shortCategory, TREND_PERIODS, type TrendPeriod } from "../../category-trend.js";
import { formatEuro } from "../../format.js";
import CategoryBars from "../CategoryBars.js";
import Module, { ModulePeriod } from "../Module.js";

/* Verandering per categorie — "show changes in major categories, side-by-side
 * bar charts" (BACKLOG item 6).
 *
 * Top Uitgaven answers "where did this month's money go" as a ranked list.
 * This answers the different question Alexander asked for: is a category going
 * UP or DOWN, and by how much — which needs the two periods next to each other
 * rather than a percentage in small type.
 *
 * The period control switches the whole comparison between month-vs-month and
 * quarter-vs-quarter; a quarter is what makes a lumpy category (insurance,
 * tax advice) readable at all. */

const ROWS = 6;

const SERIES = [
  { label: "Vorige periode", color: "var(--muted)" },
  { label: "Deze periode", color: "var(--accent)" },
];

/** Whole euros — a bar-chart axis with cents is noise. */
const wholeEuro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type CategorieTrendBlockProps = {
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  /** Open the transactions of a category the user clicks in the summary. */
  onSelectCategory: (category: string) => void;
};

export default function CategorieTrendBlock({ txs, rules, own, onSelectCategory }: CategorieTrendBlockProps) {
  const [period, setPeriod] = useState<TrendPeriod>("maand");
  const trend = useMemo(() => categoryTrend(txs, rules, own, period, ROWS), [txs, rules, own, period]);

  // The one number that answers "did I spend more or less": the movement of
  // the whole top set, not of a single category.
  const totals = trend.rows.reduce(
    (acc, r) => ({ current: acc.current + r.current, previous: acc.previous + r.previous }),
    { current: 0, previous: 0 },
  );
  const totalChangePct = totals.previous > 0 ? ((totals.current - totals.previous) / totals.previous) * 100 : null;

  const groups = trend.rows.map((r) => ({
    label: shortCategory(r.category),
    title: r.category,
    values: [r.previous, r.current],
  }));

  // Biggest mover in absolute euros — the line a CFO would open with.
  const mover = trend.rows.reduce<null | { category: string; delta: number }>((best, r) => {
    const delta = r.current - r.previous;
    return best === null || Math.abs(delta) > Math.abs(best.delta) ? { category: r.category, delta } : best;
  }, null);

  return (
    <Module
      title="Verandering per categorie"
      span={2}
      height="tall"
      period={
        <ModulePeriod
          value={period}
          options={TREND_PERIODS}
          onChange={(v) => setPeriod(v as TrendPeriod)}
          label="Periode van de categorievergelijking"
        />
      }
      footer={
        trend.rows.length > 0 ? (
          <>
            {trend.currentLabel} t.o.v. {trend.previousLabel}
            {mover && mover.delta !== 0 && (
              <>
                {" · grootste verschuiving: "}
                <button
                  type="button"
                  className="card-link"
                  onClick={() => onSelectCategory(mover.category)}
                  title={`Bekijk transacties in ${mover.category}`}
                >
                  {mover.category}
                </button>{" "}
                <span className={mover.delta > 0 ? "text-neg" : "text-pos"}>
                  {mover.delta > 0 ? "+" : "−"}
                  {formatEuro(Math.abs(mover.delta))}
                </span>
              </>
            )}
          </>
        ) : undefined
      }
    >
      {trend.rows.length === 0 ? (
        <p className="block-empty">Nog geen uitgaven om te vergelijken — importeer eerst transacties.</p>
      ) : (
        <>
          <div className="module-figure">
            <span className="module-figure-value">{formatEuro(totals.current)}</span>
            {totalChangePct !== null && (
              <span className={`delta-pill ${totalChangePct > 0 ? "delta-down" : totalChangePct < 0 ? "delta-up" : "delta-flat"}`}>
                {totalChangePct > 0 ? "▲" : totalChangePct < 0 ? "▼" : ""} {Math.abs(Math.round(totalChangePct))}%
              </span>
            )}
          </div>
          <p className="module-figure-label">Top {trend.rows.length} categorieën, {trend.currentLabel}</p>

          <CategoryBars
            groups={groups}
            series={SERIES}
            format={(v) => wholeEuro.format(v)}
            ariaLabel={`Uitgaven per categorie, ${trend.currentLabel} naast ${trend.previousLabel}`}
            showAxis
            height={168}
          />
        </>
      )}
    </Module>
  );
}
