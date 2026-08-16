import { useMemo, useState } from "react";
import type { MonthlyTotal, OwnAccounts, Rule, Tx } from "@lavega/core";
import { monthlyTotals } from "@lavega/core";
import { formatEuro, monthLabelNL, monthShortNL } from "../../format.js";
import CategoryBars from "../CategoryBars.js";
import Module, { ModulePeriod } from "../Module.js";
import DeltaPill from "./DeltaPill.js";
import WeekdayBars from "./WeekdayBars.js";
import { categoryPerMonth, MIN_WEEKDAY_DAYS, weekdaySpend } from "./statistics.js";

/* Statistieken — the major block on the homescreen, and the one Alexander says
 * the value is in.
 *
 * Two views, both taken from his references:
 *
 *   "Categorieën"  `Modules for homescreen5.png` — grouped bars, one group per
 *                  month, one bar per major category. This ABSORBS the old
 *                  "Verandering per categorie" block: that showed two windows
 *                  side by side, this shows the whole run, which answers the
 *                  same question ("is this category climbing?") without asking
 *                  it twice on one page.
 *   "Weekdagen"    `Modules for homescreen7.png` — what each day of the week
 *                  costs on average, with the trend line across the week. The
 *                  point is to know that Friday is expensive BEFORE Friday, so
 *                  the block leads with that sentence rather than leaving it to
 *                  be read off the bars.
 *
 * The two averages under the chart (the reference's "Average Income / Average
 * Expenses") stay on both views: they are the same window, and they are the
 * figures that make the bars mean something.
 *
 * Every number is derived from the transactions; the block holds only the
 * chosen view and period. Nothing is defaulted — an unmeasured weekday shows no
 * bar and a Δ with no earlier figure shows no pill. */

export type StatPeriod = "6" | "12" | "alle";

export const STAT_PERIODS: { value: StatPeriod; label: string }[] = [
  { value: "6", label: "6 maanden" },
  { value: "12", label: "12 maanden" },
  { value: "alle", label: "Alles" },
];

export type StatView = "categorie" | "weekdag";

export const STAT_VIEWS: { value: StatView; label: string }[] = [
  { value: "categorie", label: "Categorieën" },
  { value: "weekdag", label: "Weekdagen" },
];

/** How many categories the grouped bars show. Beyond four the groups become
 *  hairlines and the chart stops being readable — the reference uses three. */
const TOP_CATEGORIES = 4;

/** One token per category slot. Cycled, never invented. */
const CATEGORY_COLORS = ["var(--accent)", "var(--chart-teal)", "var(--chart-purple)", "var(--warn)"];

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

/** Whole euros on the axis; the exact number is in each bar's tooltip. */
const wholeEuro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** "aug" inside a year, "aug '25" once the window is longer than twelve months
 *  — both so the label stays short and so it stays UNIQUE (CategoryBars keys
 *  its groups by the label). */
export function monthAxisLabel(month: string, windowLength: number): string {
  return windowLength > 12 ? `${monthShortNL(month)} '${month.slice(2, 4)}` : monthShortNL(month);
}

/** The reference's segmented view switch, in the module's control slot. */
function ViewTabs({ value, onChange }: { value: StatView; onChange: (v: StatView) => void }) {
  return (
    <div className="module-tabs" role="tablist" aria-label="Weergave van de statistieken">
      {STAT_VIEWS.map((v) => (
        <button
          key={v.value}
          type="button"
          role="tab"
          aria-selected={value === v.value}
          className={`module-tab${value === v.value ? " module-tab-on" : ""}`}
          onClick={() => onChange(v.value)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

type StatistiekBlockProps = {
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  /** Open a category's transactions — the jump the legend offers. */
  onSelectCategory: (category: string) => void;
};

export default function StatistiekBlock({ txs, rules, own, onSelectCategory }: StatistiekBlockProps) {
  const [period, setPeriod] = useState<StatPeriod>("12");
  const [view, setView] = useState<StatView>("categorie");

  const monthCount: number | "alle" = period === "alle" ? "alle" : Number(period);
  const totals = useMemo(() => monthlyTotals(txs), [txs]);
  const summary = useMemo(() => statSummary(totals, period), [totals, period]);
  const perCategory = useMemo(
    () => categoryPerMonth(txs, rules, own, monthCount, TOP_CATEGORIES),
    [txs, rules, own, monthCount],
  );
  const weekdays = useMemo(() => weekdaySpend(txs, rules, own, monthCount), [txs, rules, own, monthCount]);

  const categorySeries = perCategory.categories.map((c, i) => ({
    label: c,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const peak = weekdays.peak;
  const enoughWeekdayHistory = weekdays.spanDays >= MIN_WEEKDAY_DAYS;

  // The Δ pills under the chart are the same in both views, so their
  // explanation belongs in the footer next to whatever the chart is showing.
  const deltaNote =
    summary.rows.length > 0 ? (
      <>
        {" · Δ = "}
        {monthLabelNL(summary.rows[summary.rows.length - 1].month)} t.o.v. het gemiddelde over {summary.rows.length}{" "}
        maand{summary.rows.length === 1 ? "" : "en"}
      </>
    ) : null;

  const footer =
    view === "categorie" ? (
      perCategory.months.length > 0 ? (
        <>
          Uitgaven per maand, {monthLabelNL(perCategory.months[0])} –{" "}
          {monthLabelNL(perCategory.months[perCategory.months.length - 1])}
          {perCategory.otherCount > 0 && ` · ${perCategory.otherCount} kleinere categorieën niet getoond`}
          {deltaNote}
        </>
      ) : undefined
    ) : enoughWeekdayHistory ? (
      <>
        Gemiddelde uitgave per weekdag over {weekdays.spanDays} dagen — elk voorkomen van die dag telt mee, ook de
        dagen zonder transactie{deltaNote}
      </>
    ) : undefined;

  return (
    <Module
      title="Statistieken"
      span={3}
      height="tall"
      period={
        <>
          <ViewTabs value={view} onChange={setView} />
          <ModulePeriod
            value={period}
            options={STAT_PERIODS}
            onChange={(v) => setPeriod(v as StatPeriod)}
            label="Periode van de statistieken"
          />
        </>
      }
      footer={footer}
    >
      {txs.length === 0 ? (
        <p className="block-empty">Nog geen transacties — importeer een bestand of koppel een bank.</p>
      ) : (
        <>
          {view === "categorie" ? (
            perCategory.categories.length === 0 ? (
              <p className="block-empty">
                Nog geen uitgaven in deze periode — kies een langere periode of importeer meer transacties.
              </p>
            ) : (
              <>
                <div className="stat-legend-jump">
                  {perCategory.categories.map((c, i) => (
                    <button
                      key={c}
                      type="button"
                      className="stat-legend-button"
                      title={`Bekijk transacties in ${c}`}
                      onClick={() => onSelectCategory(c)}
                    >
                      <span
                        className="lv-chart-swatch"
                        style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                        aria-hidden="true"
                      />
                      {c}
                    </button>
                  ))}
                </div>
                {/* The wrapper hides CategoryBars' own legend (blocks.css):
                    the clickable one above says the same thing and also jumps
                    into Transacties, so printing both was the same list twice. */}
                <div className="stat-chart">
                <CategoryBars
                  groups={perCategory.months
                    .map((m, i) => ({ m, i }))
                    // A month with NO data is left out entirely. Drawing it
                    // would put bars of zero on the axis, which reads as "you
                    // spent nothing that month" when the truth is that no
                    // statement was imported for it. The note under the chart
                    // names what is missing, so the gap is stated, not hidden.
                    .filter(({ i }) => perCategory.hasData[i])
                    .map(({ m, i }) => ({
                      // CategoryBars keys a group by its label, so a window
                      // longer than a year has to carry the year or two "aug"s
                      // would collide.
                      label: monthAxisLabel(m, perCategory.months.length),
                      title: monthLabelNL(m),
                      values: perCategory.values[i],
                    }))}
                  series={categorySeries}
                  format={(v) => wholeEuro.format(v)}
                  ariaLabel="Uitgaven per categorie per maand"
                  showAxis
                  height={196}
                />
                </div>
                {perCategory.hasData.some((k) => !k) && (
                  <p className="cell-sub">
                    Niet getoond:{" "}
                    {perCategory.months.filter((_, i) => !perCategory.hasData[i]).map(monthLabelNL).join(", ")}
                    {" "}— daar is geen afschrift van geïmporteerd. Een lege maand is geen maand zonder uitgaven.
                  </p>
                )}
              </>
            )
          ) : !enoughWeekdayHistory ? (
            <p className="block-empty">
              {weekdays.spanDays === 0
                ? "Nog geen uitgaven om een weekpatroon uit te halen."
                : `Pas ${weekdays.spanDays} dag${weekdays.spanDays === 1 ? "" : "en"} geschiedenis — een weekdagpatroon vraagt minstens ${MIN_WEEKDAY_DAYS} dagen, anders is elk gemiddelde één waarneming.`}
            </p>
          ) : (
            <>
              <p className="stat-insight">
                {peak === null ? (
                  "Geen enkele weekdag springt eruit — er zijn nog geen uitgaven gemeten."
                ) : (
                  <>
                    <strong>{peak.label}</strong> kost je gemiddeld{" "}
                    <strong>{formatEuro(peak.average)}</strong>
                    {peak.pctVsAverage !== null && peak.pctVsAverage > 0 && (
                      <>
                        {" — "}
                        {Math.round(peak.pctVsAverage)}% meer dan een gewone dag
                      </>
                    )}
                    .
                  </>
                )}
              </p>
              <WeekdayBars
                days={weekdays.rows.map((r) => ({ label: r.short, value: r.average }))}
                format={(v) => wholeEuro.format(v)}
                ariaLabel="Gemiddelde uitgaven per weekdag"
                peakIndex={peak?.index ?? -1}
                height={196}
              />
            </>
          )}

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
