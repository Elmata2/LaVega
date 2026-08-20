import { useMemo, useState } from "react";
import type { OwnAccounts, Rule, Tx } from "@lavega/core";
import { formatEuro } from "../../format.js";
import CategoryBars from "../CategoryBars.js";
import Module, { ModulePeriod } from "../Module.js";
import WeekdayBars from "./WeekdayBars.js";
import { dayLabelYearNL, rangeLabelNL } from "./dates.js";
import { monthLabelNL } from "../../format.js";
import SpendPie from "../SpendPie.js";
import {
  categoryGrowth,
  categoryShare,
  categoryPerWindow,
  MIN_WEEKDAY_DAYS,
  newestTxDate,
  presetWindow,
  weekdaySpend,
  windowTotals,
  type StatPreset,
  type StatWindow,
} from "./statistics.js";

/* Statistieken — the major block on the homescreen, and the one Alexander says
 * the value is in.
 *
 * Two views, both taken from his references:
 *
 *   "Categorieën"  `Modules for homescreen5.png` — grouped bars, one group per
 *                  bucket, one bar per major category. This ABSORBS the old
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
 * The period filter is `1 week · 1 maand · 3 maanden · 6 maanden · 12 maanden ·
 * Aangepast`. "Aangepast" is a REAL range — two dates the owner picks — not a
 * seventh preset in disguise; everything below it consumes a `StatWindow`, so a
 * preset and a hand-picked range travel the same path (statistics.ts).
 *
 * The block states the window it is showing in one line and then never repeats
 * itself: the old footer explaining what Δ meant is gone (it earned nothing),
 * and the two figures under the chart are the window's own totals rather than a
 * per-month average that a one-week window could not support.
 *
 * Every number is derived from the transactions; the block holds only the
 * chosen view and period. Nothing is defaulted — an unmeasured weekday shows no
 * bar, and a period the data does not reach into says so. */

export type StatPeriod = StatPreset | "aangepast";

export const STAT_PERIODS: { value: StatPeriod; label: string }[] = [
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 maand" },
  { value: "3m", label: "3 maanden" },
  { value: "6m", label: "6 maanden" },
  { value: "12m", label: "12 maanden" },
  { value: "aangepast", label: "Aangepast" },
];

export type StatView = "categorie" | "verdeling" | "gegroeid" | "weekdag";

export const STAT_VIEWS: { value: StatView; label: string }[] = [
  { value: "categorie", label: "Categorieën" },
  /* Two views added 20 August. "Categorieën" shows levels per bucket, which lets a
   * careful reader infer a trend by eye; these two state it outright — what the
   * spending is made OF, and what is climbing. All three consume the same window
   * and the same category split, so they cannot disagree about a period. */
  { value: "verdeling", label: "Verdeling" },
  { value: "gegroeid", label: "Gegroeid" },
  { value: "weekdag", label: "Weekdagen" },
];

/** The chart's cap, not a judgement about relevance: beyond four bars the
 *  groups become hairlines and the chart stops being readable. WHICH categories
 *  are big enough to draw is core's per-window threshold, not this number. */
const TOP_CATEGORIES = 4;

/** One token per category slot. Cycled, never invented. */
const CATEGORY_COLORS = ["var(--accent)", "var(--chart-teal)", "var(--chart-purple)", "var(--warn)"];

/** Whole euros on the axis; the exact number is in each bar's tooltip. */
const wholeEuro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** The typed range, or null when it is not (yet) a range: an empty field, or an
 *  end before its start. Null renders as an instruction, never as a window. */
export function customWindow(start: string, end: string): StatWindow | null {
  if (start === "" || end === "") return null;
  if (start > end) return null;
  return { start, end };
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
  const [period, setPeriod] = useState<StatPeriod>("12m");
  const [view, setView] = useState<StatView>("categorie");
  const [custom, setCustom] = useState<{ start: string; end: string }>({ start: "", end: "" });

  // Every window ends at the newest transaction, never at the clock: an
  // imported historical statement charts itself instead of showing an empty
  // "this month".
  const anchor = useMemo(() => newestTxDate(txs), [txs]);

  const range = useMemo<StatWindow | null>(
    () =>
      period === "aangepast"
        ? customWindow(custom.start, custom.end)
        : anchor === null
          ? null
          : presetWindow(period, anchor),
    [period, custom.start, custom.end, anchor],
  );

  /** Switching to "Aangepast" opens on the window that was showing, so the
   *  owner adjusts a range rather than starting from two empty fields. */
  function choosePeriod(next: StatPeriod) {
    if (next === "aangepast" && period !== "aangepast" && anchor !== null && custom.start === "" && custom.end === "") {
      setCustom(presetWindow(period, anchor));
    }
    setPeriod(next);
  }

  const perCategory = useMemo(
    () => (range === null ? null : categoryPerWindow(txs, rules, own, range, TOP_CATEGORIES)),
    [txs, rules, own, range],
  );
  const weekdays = useMemo(
    () => (range === null ? null : weekdaySpend(txs, rules, own, range)),
    [txs, rules, own, range],
  );
  const share = useMemo(
    () => (range === null ? { slices: [], totalCents: 0, covered: null } : categoryShare(txs, rules, own, range)),
    [txs, rules, own, range],
  );
  const growth = useMemo(
    () => (range === null ? { rows: [], before: { start: "", end: "" } } : categoryGrowth(txs, rules, own, range)),
    [txs, rules, own, range],
  );
  const windowDays = useMemo(
    () =>
      range === null
        ? 0
        : Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1,
    [range],
  );
  /* Only the movers, and both directions. A category that did not budge says
     nothing and would crowd out the ones that did; a FALL is as worth seeing as a
     rise, which is why this is not filtered to increases only. The threshold is a
     euro, not a percentage: a 300% rise on € 2 is noise. */
  const growthGroups = useMemo(
    () =>
      growth.rows
        .filter((r) => Math.abs(r.deltaCents) >= 500)
        .slice(0, TOP_CATEGORIES)
        .map((r) => ({
          label: r.category,
          values: [r.deltaCents / 100],
          title: `${r.category}: ${r.beforeCents / 100} → ${r.nowCents / 100}`,
        })),
    [growth],
  );
  const totals = useMemo(
    () => (range === null ? null : windowTotals(txs, rules, own, range)),
    [txs, rules, own, range],
  );

  const categorySeries = (perCategory?.categories ?? []).map((c, i) => ({
    label: c,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const peak = weekdays?.peak ?? null;
  const enoughWeekdayHistory = (weekdays?.spanDays ?? 0) >= MIN_WEEKDAY_DAYS;

  // Month buckets with no data at all are left out of the chart entirely.
  // Drawing them would put bars of zero on the axis, which reads as "you spent
  // nothing that month" when the truth is that no statement was imported for
  // it. They are named instead, so the gap is stated rather than hidden.
  const emptyMonths =
    perCategory && perCategory.unit === "maand" ? perCategory.buckets.filter((b) => !b.hasData) : [];
  const drawn = (perCategory?.buckets ?? [])
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => perCategory?.unit !== "maand" || b.hasData);

  // Core folds a category away for one of two reasons, and they are not the
  // same sentence: it fell under the window-relative floor, or it simply did
  // not fit the chart's cap.
  const hidden = perCategory?.selection?.hidden ?? [];
  const small = hidden.filter((h) => h.belowThreshold);
  const capped = hidden.filter((h) => !h.belowThreshold);
  const smallOut = small.reduce((s, h) => s + h.out, 0);

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
            onChange={(v) => choosePeriod(v as StatPeriod)}
            label="Periode van de statistieken"
          />
          {period === "aangepast" && (
            <span className="stat-range">
              <input
                type="date"
                className="stat-date"
                aria-label="Begindatum"
                value={custom.start}
                max={custom.end || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
              />
              <span className="stat-range-sep" aria-hidden="true">
                –
              </span>
              <input
                type="date"
                className="stat-date"
                aria-label="Einddatum"
                value={custom.end}
                min={custom.start || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
              />
            </span>
          )}
        </>
      }
    >
      {txs.length === 0 ? (
        <p className="block-empty">Nog geen transacties — importeer een bestand of koppel een bank.</p>
      ) : range === null ? (
        <p className="block-empty">
          {period !== "aangepast"
            ? "Nog geen transactie met een datum om een periode uit te halen."
            : custom.start !== "" && custom.end !== "" && custom.start > custom.end
              ? "De einddatum ligt vóór de begindatum — draai ze om."
              : "Kies een begindatum en een einddatum."}
        </p>
      ) : (
        <>
          {/* The window, in words. Every figure in this block is "in deze
              periode", so the period is stated once, up front, instead of in a
              footnote under each number. */}
          <p className="stat-window">
            {rangeLabelNL(range.start, range.end)}
            {perCategory?.covered && perCategory.covered.start > range.start && (
              <> · gegevens vanaf {dayLabelYearNL(perCategory.covered.start)}</>
            )}
          </p>

          {view === "categorie" ? (
            !perCategory || perCategory.categories.length === 0 ? (
              // "No spending" and "only spending too small to chart against
              // this window" are different facts, and the second one must not
              // be reported as the first.
              <p className="block-empty">
                {small.length > 0
                  ? `Alleen kleine uitgaven in deze periode: ${small.length} categorie${small.length === 1 ? "" : "ën"}, samen ${formatEuro(smallOut)} — elk onder ${formatEuro(perCategory?.selection?.thresholdOut ?? 0)} over deze ${perCategory?.windowDays} dagen. Kies een kortere periode om ze te zien.`
                  : "Geen uitgaven in deze periode — kies een langere periode of importeer meer transacties."}
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
                    groups={drawn.map(({ b, i }) => ({
                      label: b.label,
                      title: b.title,
                      values: perCategory.values[i],
                    }))}
                    series={categorySeries}
                    format={(v) => wholeEuro.format(v)}
                    ariaLabel={`Uitgaven per categorie per ${perCategory.unit}`}
                    showAxis
                    height={196}
                  />
                </div>
                {emptyMonths.length > 0 && (
                  <p className="cell-sub">
                    Niet getoond: {emptyMonths.map((b) => monthLabelNL(b.key)).join(", ")} — daar is geen afschrift van
                    geïmporteerd. Een lege maand is geen maand zonder uitgaven.
                  </p>
                )}
                {/* What was folded away, split the way core splits it: too
                    small against THIS window (the floor scales with the window,
                    so the sentence names the window and the floor), or simply
                    past the chart's cap. Two different facts, two sentences. */}
                {small.length > 0 && perCategory.covered && (
                  <p className="cell-sub">
                    {small.length} kleinere categorie{small.length === 1 ? "" : "ën"} niet getoond in{" "}
                    {rangeLabelNL(perCategory.covered.start, perCategory.covered.end)}: samen {formatEuro(smallOut)},
                    elk onder {formatEuro(perCategory.selection?.thresholdOut ?? 0)} over deze{" "}
                    {perCategory.windowDays} dagen. Een kortere periode legt die grens lager.
                  </p>
                )}
                {capped.length > 0 && (
                  <p className="cell-sub">
                    Nog {capped.length} categorie{capped.length === 1 ? "" : "ën"} buiten de grafiek:{" "}
                    {capped.map((h) => h.category).join(", ")}.
                  </p>
                )}
              </>
            )
          ) : view === "verdeling" ? (
            share.slices.length === 0 ? (
              <p className="block-empty">Geen uitgaven in deze periode — kies een langere periode.</p>
            ) : (
              <SpendPie slices={share.slices} totalCents={share.totalCents} euro={formatEuro} />
            )
          ) : view === "gegroeid" ? (
            growth.rows.length === 0 ? (
              <p className="block-empty">Nog niets om te vergelijken — kies een langere periode.</p>
            ) : (
              <>
                <p className="stat-insight">
                  {/* The sentence carries the finding; the bars are the evidence.
                      Naming the comparison window matters: "gestegen" is
                      meaningless without saying against what. */}
                  {growth.rows[0].deltaCents > 0 ? (
                    <>
                      <strong>{growth.rows[0].category}</strong> steeg het hardst:{" "}
                      {formatEuro(growth.rows[0].deltaCents)} meer dan de {windowDays} dagen ervoor
                      {growth.rows[0].deltaPct !== null ? <> ({Math.round(growth.rows[0].deltaPct * 100)}%)</> : <> (nieuw)</>}.
                    </>
                  ) : (
                    <>Niets is gestegen tegenover de {windowDays} dagen ervoor.</>
                  )}
                </p>
                <CategoryBars
                  series={[{ label: "Verschil", color: "var(--neg)" }]}
                  groups={growthGroups}
                  format={formatEuro}
                  ariaLabel={`Verschil per categorie tegenover de ${windowDays} dagen ervoor`}
                />
                <p className="cell-sub">
                  Vergeleken met {dayLabelYearNL(growth.before.start)} — {dayLabelYearNL(growth.before.end)},
                  dezelfde lengte als de gekozen periode. Alleen uitgaven; eigen overboekingen tellen niet mee.
                </p>
              </>
            )
          ) : !enoughWeekdayHistory ? (
            <p className="block-empty">
              {(weekdays?.spanDays ?? 0) === 0
                ? "Nog geen uitgaven om een weekpatroon uit te halen."
                : `Pas ${weekdays?.spanDays} dag${weekdays?.spanDays === 1 ? "" : "en"} geschiedenis in deze periode — een weekdagpatroon vraagt minstens ${MIN_WEEKDAY_DAYS} dagen, anders is elk gemiddelde één waarneming.`}
            </p>
          ) : (
            <>
              <p className="stat-insight">
                {peak === null ? (
                  "Geen enkele weekdag springt eruit — er zijn nog geen uitgaven gemeten."
                ) : (
                  <>
                    <strong>{peak.label}</strong> kost je gemiddeld <strong>{formatEuro(peak.average)}</strong>
                    {peak.pctVsAverage !== null && peak.pctVsAverage > 0 && (
                      <>
                        {" — "}
                        {Math.round(peak.pctVsAverage)}% meer dan een gewone dag
                      </>
                    )}
                    {". "}
                    {/* What "gemiddeld" means, in the sentence itself rather
                        than in a footnote: per OCCURRENCE of that weekday, so
                        the day that happened most often does not win by
                        happening. */}
                    <span className="stat-insight-basis">
                      Gemeten over {weekdays?.spanDays} dagen — elk voorkomen van die weekdag telt mee, ook de dagen
                      zonder transactie.
                    </span>
                  </>
                )}
              </p>
              {/* B6, decided rather than decorated: no fitted trend line here.
                  Monday…Sunday is a cycle, not a time axis, so a slope across
                  it only says where the week was cut — start on Sunday and the
                  same data "trends" the other way. What the sentence above DOES
                  compare against is a normal day, and the chart had no mark for
                  it, so that comparison could not be checked by eye. This is
                  that baseline: a measured number, absent when unmeasured. */}
              <WeekdayBars
                days={(weekdays?.rows ?? []).map((r) => ({ label: r.short, value: r.average }))}
                format={(v) => wholeEuro.format(v)}
                ariaLabel="Gemiddelde uitgaven per weekdag"
                peakIndex={peak?.index ?? -1}
                averageValue={weekdays?.dayAverage ?? null}
                averageLabel="gewone dag"
                height={196}
              />
            </>
          )}

          {/* Totals over the window, not a monthly average: with a one-week
              window a "per maand" figure would be an extrapolation. */}
          {totals && (
            <div className="stat-figures" title="Overboekingen tussen je eigen rekeningen tellen niet mee.">
              <div className="stat-figure">
                <div className="eyebrow">Inkomsten in deze periode</div>
                <div className="module-figure">
                  <span className="module-figure-value">{formatEuro(totals.inTotal)}</span>
                </div>
              </div>
              <div className="stat-figure">
                <div className="eyebrow">Uitgaven in deze periode</div>
                <div className="module-figure">
                  <span className="module-figure-value">{formatEuro(totals.outTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Module>
  );
}
