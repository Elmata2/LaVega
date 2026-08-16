import { useMemo, useState } from "react";
import type { MonthlyTotal, Tx } from "@lavega/core";
import { monthlyTotals } from "@lavega/core";
import { formatEuro, monthShortNL } from "../../format.js";
import CategoryBars from "../CategoryBars.js";
import Module, { ModulePeriod } from "../Module.js";

/* Statistieken — the reference's wide statistics card: a per-month in/out
 * chart with a period control, and the two averages under it with a coloured
 * delta pill.
 *
 * Everything is derived from the transactions themselves (monthlyTotals); the
 * block holds only the chosen period. */

export type StatPeriod = "6" | "12" | "alle";

export const STAT_PERIODS: { value: StatPeriod; label: string }[] = [
  { value: "6", label: "6 maanden" },
  { value: "12", label: "12 maanden" },
  { value: "alle", label: "Alles" },
];

export type StatSummary = {
  /** The window, oldest month first. */
  rows: MonthlyTotal[];
  /** Mean inflow per month over the window, in euros. */
  avgIn: number;
  /** Mean outflow per month over the window, in euros, positive. */
  avgOut: number;
  /** The newest month in the window, in euros (outflow positive). */
  lastIn: number;
  lastOut: number;
  /** Newest month vs. the window average, in %. Null when the average is 0
   *  (nothing to compare against — never shown as "0%"). */
  deltaInPct: number | null;
  deltaOutPct: number | null;
};

/** Window the monthly totals and summarise them. Pure, so the numbers behind
 *  the chart are testable without a DOM. */
export function statSummary(totals: MonthlyTotal[], period: StatPeriod): StatSummary {
  const rows = period === "alle" ? totals : totals.slice(-Number(period));
  const empty: StatSummary = {
    rows,
    avgIn: 0,
    avgOut: 0,
    lastIn: 0,
    lastOut: 0,
    deltaInPct: null,
    deltaOutPct: null,
  };
  if (rows.length === 0) return empty;

  const avgIn = rows.reduce((s, m) => s + m.in, 0) / rows.length;
  const avgOut = rows.reduce((s, m) => s + Math.abs(m.out), 0) / rows.length;
  const last = rows[rows.length - 1];
  const lastIn = last.in;
  const lastOut = Math.abs(last.out);
  return {
    rows,
    avgIn,
    avgOut,
    lastIn,
    lastOut,
    deltaInPct: avgIn === 0 ? null : ((lastIn - avgIn) / avgIn) * 100,
    deltaOutPct: avgOut === 0 ? null : ((lastOut - avgOut) / avgOut) * 100,
  };
}

/** Inflow (green) next to outflow (terracotta), one pair per month, on a shared
 *  scale so the two are comparable — the shared side-by-side bar chart, same
 *  chrome as the category comparison. */
const STAT_SERIES = [
  { label: "Inkomsten", color: "var(--pos)" },
  { label: "Uitgaven", color: "var(--neg)" },
];

/** Whole euros on the axis; the exact number is in each bar's tooltip. */
const wholeEuro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function MonthlyBars({ rows }: { rows: MonthlyTotal[] }) {
  return (
    <CategoryBars
      groups={rows.map((m) => ({
        label: monthShortNL(m.month),
        title: m.month,
        values: [m.in, Math.abs(m.out)],
      }))}
      series={STAT_SERIES}
      format={(v) => wholeEuro.format(v)}
      ariaLabel="Inkomsten en uitgaven per maand"
      showAxis
      height={176}
    />
  );
}

/** Δ vs. the window average. The caller decides which direction is good, so
 *  more income and more spending are not both green. */
function DeltaPill({ pct, upIsGood }: { pct: number | null; upIsGood: boolean }) {
  if (pct === null) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) return <span className="delta-pill delta-flat">0%</span>;
  const up = rounded > 0;
  const good = up === upIsGood;
  return (
    <span className={`delta-pill ${good ? "delta-up" : "delta-down"}`}>
      {up ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}

type StatistiekBlockProps = {
  txs: Tx[];
};

export default function StatistiekBlock({ txs }: StatistiekBlockProps) {
  const [period, setPeriod] = useState<StatPeriod>("12");
  const totals = useMemo(() => monthlyTotals(txs), [txs]);
  const summary = useMemo(() => statSummary(totals, period), [totals, period]);

  return (
    <Module
      title="Statistieken"
      span={2}
      height="tall"
      period={
        <ModulePeriod
          value={period}
          options={STAT_PERIODS}
          onChange={(v) => setPeriod(v as StatPeriod)}
          label="Periode van de statistieken"
        />
      }
      footer={
        summary.rows.length > 0 ? (
          <>
            Δ = laatste maand ({summary.rows[summary.rows.length - 1].month}) t.o.v. het gemiddelde over{" "}
            {summary.rows.length} maand{summary.rows.length === 1 ? "" : "en"}.
          </>
        ) : undefined
      }
    >
      {summary.rows.length === 0 ? (
        <p className="block-empty">Nog geen transacties — importeer een bestand of koppel een bank.</p>
      ) : (
        <>
          <MonthlyBars rows={summary.rows} />

          <div className="stat-figures">
            <div className="stat-figure">
              <div className="eyebrow">Gem. inkomsten p/m</div>
              <div className="module-figure">
                <span className="module-figure-value">{formatEuro(summary.avgIn)}</span>
                <DeltaPill pct={summary.deltaInPct} upIsGood={true} />
              </div>
            </div>
            <div className="stat-figure">
              <div className="eyebrow">Gem. uitgaven p/m</div>
              <div className="module-figure">
                <span className="module-figure-value">{formatEuro(summary.avgOut)}</span>
                <DeltaPill pct={summary.deltaOutPct} upIsGood={false} />
              </div>
            </div>
          </div>
        </>
      )}
    </Module>
  );
}
