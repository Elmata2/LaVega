import { useMemo, useState } from "react";
import { categorize, categorySpendPercentiles } from "@lavega/core";
import type {
  CategoryPercentile,
  OwnAccounts,
  Rule,
  SpendPercentiles,
  SpendRow,
  Tx,
} from "@lavega/core";
import { formatEuro } from "../../format.js";
import CategoryBars from "../CategoryBars.js";
import Module, { ModulePeriod } from "../Module.js";
import WeekdayBars from "./WeekdayBars.js";
import { dayLabelYearNL, rangeLabelNL } from "./dates.js";
import { monthLabelNL } from "../../format.js";
import SpendPie from "../SpendPie.js";
import ToonMeer from "../ToonMeer.js";
import {
  categoryGrowth,
  categoryShare,
  categoryPerWindow,
  isMovedCategory,
  MIN_AVERAGE_UNITS,
  MIN_WEEKDAY_DAYS,
  movedTotals,
  newestTxDate,
  periodAverages,
  presetWindow,
  unitPluralNL,
  weekdaySpend,
  windowTotals,
  type AverageRefusal,
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
 * and the two figures under the chart are the window's own totals.
 *
 * Onder elk van die twee staat sinds deze ronde het GEMIDDELDE. Dat is niet de
 * terugkeer van het maandbedrag dat hier ooit weg is gehaald: dat middelde over
 * een eenheid die het venster niet droeg ("per maand" bij een week is
 * extrapolatie). `periodAverages` kiest de eenheid uit het venster, middelt
 * alleen over HELE eenheden, zet die eenheid op het scherm en weigert als er
 * niets te middelen valt. De drie regels eromheen staan boven die functie.
 *
 * Every number is derived from the transactions; the block holds only the
 * chosen view and period. Nothing is defaulted — an unmeasured weekday shows no
 * bar, and a period the data does not reach into says so.
 *
 * WHAT AN EXPENSE IS, decided once (review 3, item 1). Money that only changed
 * place — between his own accounts, or into his own savings and investments — is
 * not spending, and every view here leaves it out; the rule and its price are
 * written down at MOVED_CATEGORIES in statistics.ts. It is left out VISIBLY: one
 * line under the chart names the amount, the category and the reason, in every
 * view, because a diagram that quietly drops € 20.000 is worse than one that
 * mis-sorts it. */

/* SAMENVATTING VOORAAN, ONDERBOUWING OPGEVOUWEN (review 4, punten 2 en 3).
 * "The usual should be just the graphs and the numbers, and all the text below
 * it should be a show more." Dat is hier uitgevoerd met ToonMeer, en de
 * scheidslijn ligt niet bij "lange tekst" maar bij WAT DE ZIN IS:
 *
 *   BLIJFT STAAN  de uitkomst zelf. De piekdagzin, de grootste stijger, de
 *                 percentiellijst ("hoger dan 8 van je laatste 10 maanden"), de
 *                 twee totalen — en elke WEIGERING ("te weinig maanden om dit
 *                 te kunnen zeggen", "nog geen uitgaven in deze periode"). Een
 *                 weigering opvouwen laat het scherm leeg lijken terwijl er
 *                 iets te zeggen valt; dat is een leugen met minder letters.
 *   VOUWT OP      de onderbouwing: waartegen vergeleken is, welke dagen naast
 *                 welke liggen, waarom een categorie niet in de grafiek staat.
 *
 * En wat opgevouwen wordt, wordt niet gewist: het label van elke regel draagt
 * de FEITEN mee die je zonder hem zou missen — hoeveel categorieën weggelaten
 * zijn, hoeveel maanden zonder afschrift, welk bedrag buiten de cijfers is
 * gehouden. Zo staat het cijfer op de voorgrond en is de herkomst één klik weg
 * in plaats van zoek. Vandaar ook dat geen enkel label "meer informatie" heet:
 * een regel die niets belooft is een regel waar niemand op klikt, en dan is de
 * onderbouwing niet opgevouwen maar kwijt. */

/** Het label van de opgevouwen regel onder de categoriegrafiek: wat er buiten
 *  de grafiek is gebleven, geteld, met de uitleg erachter.
 *
 *  De TELLINGEN staan met opzet in het label en niet in het paneel. Drie
 *  weggelaten categorieën en twee maanden zonder afschrift zijn geen
 *  onderbouwing maar een gat in het beeld; wie de regel dichtlaat moet nog
 *  steeds weten dát het er is. Puur en geëxporteerd, zodat de telling los van
 *  een render te controleren is.
 *
 *  Geeft `null` terug als er niets weggelaten is — dan hoort er ook geen regel
 *  te staan die belooft dat er iets te zien valt. */
export function weggelatenLabelNL(counts: {
  maanden: number;
  klein: number;
  gecapt: number;
}): string | null {
  const delen: string[] = [];
  if (counts.maanden > 0)
    delen.push(`${counts.maanden} maand${counts.maanden === 1 ? "" : "en"} zonder afschrift`);
  if (counts.klein > 0)
    delen.push(`${counts.klein} kleinere categorie${counts.klein === 1 ? "" : "ën"}`);
  if (counts.gecapt > 0)
    delen.push(`${counts.gecapt} categorie${counts.gecapt === 1 ? "" : "ën"} buiten de grafiek`);
  return delen.length === 0 ? null : `Wat hier niet in staat: ${delen.join(" · ")}`;
}

/** De regel die er staat als er NIETS te middelen valt.
 *
 *  Dit is een weigering en geen onderbouwing, dus hij vouwt niet op: een lege
 *  plek onder de twee totalen laat het scherm leeg lijken terwijl er iets te
 *  zeggen valt, en dat is een leugen met minder letters.
 *
 *  `meerBuitenVenster` bestaat omdat het ADVIES anders niet klopt in de toestand
 *  waarin het verschijnt. Ligt er afschrift buiten het gekozen venster, dan
 *  helpt een langere periode en is dat de zin. Is dit alles wat er is, dan
 *  helpt een langere periode niet — dan laat je hem klikken tot hij het opgeeft,
 *  en is importeren het enige dat werkt. Puur en geëxporteerd, zodat beide
 *  takken los van een render te controleren zijn. */
export function gemiddeldeWeigeringNL(
  reason: AverageRefusal,
  coveredDays: number,
  meerBuitenVenster: boolean,
): string {
  const advies = meerBuitenVenster
    ? "Een langere periode pakt de rest van je afschriften mee."
    : "Oudere afschriften importeren vult dit aan.";
  if (reason === "geen-gegevens") {
    return `Nog geen gemiddelde: in deze periode staat geen enkele transactie. ${advies}`;
  }
  return `Nog geen gemiddelde: deze periode bevat ${coveredDays} dag${
    coveredDays === 1 ? "" : "en"
  } afschrift, en middelen vraagt er minstens ${MIN_AVERAGE_UNITS}. ${advies}`;
}

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
const CATEGORY_COLORS = [
  "var(--accent)",
  "var(--chart-teal)",
  "var(--chart-purple)",
  "var(--warn)",
];

/** Everything that comes out of statistics.ts as a SHARE or a DELTA is in
 *  CENTS; `formatEuro` takes euros. Feeding one to the other is what printed
 *  € 2.033.540 over € 20.335 — a hundredfold, on the very figure he read first.
 *  One named function, used everywhere a cents figure is shown, so the two units
 *  cannot meet again by accident. */
const euroFromCents = (cents: number): string => formatEuro(cents / 100);

/** Whole euros on the axis; the exact number is in each bar's tooltip. */
const wholeEuro = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** The typed range, or null when it is not (yet) a range: an empty field, or an
 *  end before its start. Null renders as an instruction, never as a window. */
export function customWindow(start: string, end: string): StatWindow | null {
  if (start === "" || end === "") return null;
  if (start > end) return null;
  return { start, end };
}

/* ── Percentiel per categorie ─────────────────────────────────────────────
 *
 * "Waar ligt wat ik deze maand aan boodschappen uitgaf, in wat ik er in eerdere
 * maanden aan uitgaf." Het rekenwerk staat in packages/core/src/spendPercentile.ts
 * — inclusief de drie manieren waarop zo'n cijfer kan liegen, en wat elk ervan
 * tegenhoudt. Hier staat alleen hoe de uitkomst in woorden komt.
 *
 * Geen "P80" en geen balkje. Een percentiel is een plaats in een rij, geen
 * cijfer op een rapport, dus het blok noemt de rij: "hoger dan 8 van je laatste
 * 10 maanden" is na te tellen tegen de staven erboven, "80e percentiel" niet.
 *
 * De vergelijking loopt per KALENDERMAAND, ook wanneer de grafiek erboven op
 * een andere periode staat. Huur, salaris, verzekering en elk abonnement lopen
 * per maand, en de gekozen periode is een keuze over de gráfiek — niet over de
 * lengte waarin zijn uitgaven zich herhalen. Welke dagen er precies naast welke
 * zijn gelegd, staat in de regel erboven; stil vergelijken mag niet.
 *
 * Een vergelijking met het Nederlandse gemiddelde stond hier NIET tegenover: die
 * is onderzocht en afgewezen (docs/research/2026-08-20-categorie-gemiddelden.md).
 * Het CBS deelt in naar product waar LaVega naar tegenpartij deelt, het nieuwste
 * cijfer per categorie is van 2020, en er wordt alleen een gemiddelde met een
 * betrouwbaarheidsinterval gepubliceerd — geen verdeling, dus daar valt sowieso
 * geen percentiel uit te halen. */

/** De positie van één categorie, in woorden. Elke tak is een letterlijke
 *  telling of een reden — geen enkele tak verzint een cijfer, en geen enkele
 *  toont een streepje dat als nul te lezen is. */
function positionNL(r: CategoryPercentile): string {
  const n = r.historyCents.length;
  switch (r.reason) {
    case "geen-gegevens":
      return "deze maand is nog niet gemeten";
    case "te-weinig-geschiedenis":
      return "te weinig eerdere maanden om in te plaatsen";
    case "nieuwe-categorie":
      // Nadrukkelijk geen "hoogste ooit": vóór deze maand bestond de categorie
      // niet, en die nullen zijn geen maanden waarin hij niets uitgaf.
      return "nieuw — geen eerdere maand met deze categorie";
    case "te-kort-bekend":
      return `pas ${n} ${n === 1 ? "maand" : "maanden"} bekend, te weinig om in te plaatsen`;
    case "geen-verschil":
      return r.currentCents === 0
        ? `hier geen uitgaven, in je laatste ${n} maanden ook niet`
        : `even hoog als in al je laatste ${n} maanden`;
    default:
      if (r.higher === n) return `hoger dan al je laatste ${n} maanden`;
      if (r.lower === n) return `lager dan al je laatste ${n} maanden`;
      // Gelijke maanden staan bewust in geen van beide tellingen: ze optellen
      // bij "hoger" of bij "lager" is precies hoe dezelfde reeks als 0% én als
      // 100% gerapporteerd wordt. De kant met de meeste maanden is de kant die
      // iets zegt.
      return r.higher >= r.lower
        ? `hoger dan ${r.higher} van je laatste ${n} maanden`
        : `lager dan ${r.lower} van je laatste ${n} maanden`;
  }
}

/** De lijst onder de grafiek: per getekende categorie het bedrag van deze maand
 *  en waar dat ligt in zijn eigen eerdere maanden. */
function PercentielLijst({
  result,
  categories,
}: {
  result: SpendPercentiles;
  categories: string[];
}) {
  // De volgorde van de grafiek, niet die van core: de lijst leest als bijschrift
  // bij de staven erboven.
  const rows = categories
    .map((c) => result.rows.find((r) => r.category === c))
    .filter((r): r is CategoryPercentile => r !== undefined);
  if (rows.length === 0) return null;

  const month = monthLabelNL(result.current.start.slice(0, 7));
  const through = result.measuredThrough;
  const n = result.compared.length;

  // Te weinig maanden om ook maar één categorie in te plaatsen. Dan wordt de
  // lijst vier keer dezelfde zin, dus staat er één regel die de echte oorzaak
  // noemt — en alleen advies dat in déze toestand ook werkt.
  if (through === null || n < result.minHistory) {
    return (
      <p className="cell-sub">
        {through === null
          ? `Nog geen vergelijking met je eigen maanden — er staat nog geen transactie in ${month}.`
          : `Nog geen vergelijking met je eigen maanden: ${
              n === 0
                ? `er is geen volledige maand vóór ${month}`
                : n === 1
                  ? `er is 1 volledige maand vóór ${month}`
                  : `er zijn ${n} volledige maanden vóór ${month}`
            } geïmporteerd, en een plaats in je eigen geschiedenis vraagt er minstens ${result.minHistory}. Oudere afschriften importeren vult dit aan.`}
      </p>
    );
  }

  return (
    <div className="lv-percentiel">
      {/* De KOP blijft staan, de telling gaat achter het ⓘ. Welke maand met
          welke maanden vergeleken wordt, mag niet opvouwen — "hoger dan 8 van
          je laatste 10 maanden" is zonder die noemer een zwevende bewering, en
          stil vergelijken was hier vanaf het begin verboden. Wát er precies
          naast gelegd is (de eerste 14 dagen van elke maand, welke maanden
          afvielen) is de onderbouwing daarvan en die vouwt wel op. */}
      <ToonMeer
        variant="info"
        className="lv-percentiel-basis"
        heading={<strong>{month} tegenover je eerdere maanden.</strong>}
        summary="Welke dagen naast welke zijn gelegd"
      >
        <p>
          {result.comparedDays === null
            ? `De hele maand, naast de ${n} volledige maanden ervoor.`
            : `Deze maand loopt nog: ${rangeLabelNL(result.current.start, through)} is ${result.comparedDays} dagen, en daar liggen dezelfde eerste ${result.comparedDays} dagen van de ${n} maanden ervoor naast.`}
          {result.shortPeriods > 0 &&
            ` ${result.shortPeriods} ${result.shortPeriods === 1 ? "maand telt" : "maanden tellen"} niet mee — korter dan ${result.comparedDays} dagen.`}
        </p>
      </ToonMeer>
      <ul className="lv-percentiel-lijst">
        {rows.map((r) => (
          <li key={r.category} className="lv-percentiel-rij">
            <span className="lv-percentiel-naam">{r.category}</span>
            <span className="lv-percentiel-bedrag">{euroFromCents(r.currentCents)}</span>
            {/* "geen-verschil" telt hier als een gewoon antwoord: er is geen
                percentiel, maar "even hoog als al je laatste 10 maanden" is een
                meting en geen weigering. */}
            <span
              className="lv-percentiel-positie"
              data-onbekend={r.reason !== null && r.reason !== "geen-verschil" ? "ja" : undefined}
            >
              {positionNL(r)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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

export default function StatistiekBlock({
  txs,
  rules,
  own,
  onSelectCategory,
}: StatistiekBlockProps) {
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
    if (
      next === "aangepast" &&
      period !== "aangepast" &&
      anchor !== null &&
      custom.start === "" &&
      custom.end === ""
    ) {
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
    () =>
      range === null
        ? { slices: [], totalCents: 0, covered: null }
        : categoryShare(txs, rules, own, range),
    [txs, rules, own, range],
  );
  const growth = useMemo(
    () =>
      range === null
        ? { rows: [], before: { start: "", end: "" } }
        : categoryGrowth(txs, rules, own, range),
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
          title: `${r.category}: ${euroFromCents(r.beforeCents)} → ${euroFromCents(r.nowCents)}`,
        })),
    [growth],
  );
  const totals = useMemo(
    () => (range === null ? null : windowTotals(txs, rules, own, range)),
    [txs, rules, own, range],
  );
  /* De twee totalen zeggen wat er in deze periode gebeurde; deze zeggen wat een
     periode HEM normaal kost en oplevert. Twee cijfers uit dezelfde bron dus, en
     bewust uit dezelfde functie: `periodAverages` deelt door `windowTotals`
     heen, zodat de gemiddelden geen tweede definitie van "uitgave" kunnen
     krijgen. Over welke eenheid gemiddeld wordt is een keuze van het venster —
     zie de kop boven `periodAverages`. */
  const averages = useMemo(
    () => (range === null ? null : periodAverages(txs, rules, own, range)),
    [txs, rules, own, range],
  );
  /* What every figure in this block deliberately leaves out. Money moving
     between his own accounts — or into his own savings and investments — is not
     spending, but it IS his money leaving a bank account, so it has to be named
     rather than silently dropped: he has to be able to see that something is
     outside the diagram, and why. See MOVED_CATEGORIES in statistics.ts. */
  const moved = useMemo(
    () => (range === null ? [] : movedTotals(txs, rules, own, range)),
    [txs, rules, own, range],
  );

  /* De rijen waar het percentiel op rust: uitgaven, en zonder het geld dat
     alleen van plek veranderde — exact dezelfde definitie als de rest van dit
     blok hanteert (MOVED_CATEGORIES in statistics.ts), want twee definities van
     "uitgave" op één scherm is een blok dat het met zichzelf oneens is.
     Bewust over de HELE geschiedenis en niet over de gekozen periode: de
     verdeling waar deze maand in geplaatst wordt ligt per definitie buiten het
     venster van de grafiek. */
  const spendRows = useMemo<SpendRow[]>(() => {
    const rows: SpendRow[] = [];
    for (const t of txs) {
      if (!t.date || t.amount >= 0) continue;
      const category = categorize(t, rules, own);
      if (isMovedCategory(category)) continue;
      rows.push({ date: t.date, category, cents: Math.round(-t.amount * 100) });
    }
    return rows;
  }, [txs, rules, own]);

  /* Wat er aan gegevens ÍS, gemeten over alle transacties en niet alleen over de
     uitgaven: een maand met alleen salaris erin is een gemeten maand waarin niets
     is uitgegeven, en die telt als waarneming. Zou dit uit `spendRows` komen, dan
     verdween zo'n maand uit de vergelijking in plaats van er een nul in te zijn. */
  const coverage = useMemo(() => {
    let start: string | null = null;
    let end: string | null = null;
    for (const t of txs) {
      if (!t.date) continue;
      if (start === null || t.date < start) start = t.date;
      if (end === null || t.date > end) end = t.date;
    }
    return start === null || end === null ? null : { start, end };
  }, [txs]);

  /* Peildatum is de nieuwste transactie, net als bij elk ander venster in dit
     blok: op de klok kijken zou van een geïmporteerd historisch afschrift een
     lege maand maken en dat als "niets uitgegeven" laten lezen. */
  const percentiles = useMemo(
    () =>
      anchor === null ? null : categorySpendPercentiles(spendRows, { asOf: anchor, coverage }),
    [spendRows, coverage, anchor],
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
    perCategory && perCategory.unit === "maand"
      ? perCategory.buckets.filter((b) => !b.hasData)
      : [];
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

  /* Het label van de opgevouwen regel onder de categoriegrafiek. De telling van
     de kleine categorieën staat er alleen in als de zin eronder ook echt komt:
     die zin noemt het venster waarvoor de grens geldt, en zonder `covered` is er
     geen venster om te noemen — dan zou het label iets beloven wat het paneel
     niet levert. Dezelfde voorwaarde dus als bij de <p> zelf. */
  const weggelaten = weggelatenLabelNL({
    maanden: emptyMonths.length,
    klein: perCategory?.covered ? small.length : 0,
    gecapt: capped.length,
  });

  /* Wat er in totaal buiten elk cijfer in dit blok is gebleven. Dit bedrag hoort
     op de voorgrond en niet in het paneel: de reden dat deze regel bestaat is
     dat een ring die stil € 20.000 laat vallen erger is dan een die het
     verkeerd sorteert, en dat blijft waar als je de reden opvouwt. Opgevouwen
     wordt dus alleen het WAAROM, niet het HOEVEEL. */
  const movedOut = moved.reduce((sum, m) => sum + m.outCents, 0);

  /* Uit elkaar getrokken in plaats van in de JSX vertakt, zodat TypeScript de
     unie hier één keer uitpakt: `gemiddeld.inAverage` bestaat alleen op de tak
     die er ook een heeft, en op de andere is er niets om per ongeluk als nul te
     lezen. Zie de unie bij PeriodAverages. */
  const gemiddeld = averages !== null && averages.kind === "gemiddeld" ? averages : null;
  const geenGemiddelde = averages !== null && averages.kind === "geen" ? averages : null;
  /* Of een langere periode nog iets zou toevoegen. Alleen als er afschrift
     BUITEN het gekozen venster ligt is dat waar; anders is "kies een langere
     periode" advies dat in deze toestand niet werkt. */
  const meerBuitenVenster =
    coverage !== null &&
    range !== null &&
    (coverage.start < range.start || coverage.end > range.end);

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
        <p className="block-empty">
          Nog geen transacties — importeer een bestand of koppel een bank.
        </p>
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
                {/* Drie notities die alle drie hetzelfde zeggen — "dit zie je
                    niet in de grafiek" — dus één regel, met de telling in het
                    label en de reden erachter. Los van elkaar opvouwen zou drie
                    regels onder de grafiek zetten en dat is precies de drukte
                    waar dit vanaf moest. In het paneel houden ze wél hun eigen
                    zin: te klein tegen DIT venster (de grens schaalt mee, dus de
                    zin noemt het venster en de grens), voorbij de cap van de
                    grafiek, en een maand waar geen afschrift van is — drie
                    verschillende feiten, drie zinnen, één regel. */}
                {weggelaten !== null && (
                  <ToonMeer summary={weggelaten}>
                    {emptyMonths.length > 0 && (
                      <p className="cell-sub">
                        Niet getoond: {emptyMonths.map((b) => monthLabelNL(b.key)).join(", ")} —
                        daar is geen afschrift van geïmporteerd. Een lege maand is geen maand zonder
                        uitgaven.
                      </p>
                    )}
                    {small.length > 0 && perCategory.covered && (
                      <p className="cell-sub">
                        {small.length} kleinere categorie{small.length === 1 ? "" : "ën"} niet
                        getoond in{" "}
                        {rangeLabelNL(perCategory.covered.start, perCategory.covered.end)}: samen{" "}
                        {formatEuro(smallOut)}, elk onder{" "}
                        {formatEuro(perCategory.selection?.thresholdOut ?? 0)} over deze{" "}
                        {perCategory.windowDays} dagen. Een kortere periode legt die grens lager.
                      </p>
                    )}
                    {capped.length > 0 && (
                      <p className="cell-sub">
                        Nog {capped.length} categorie{capped.length === 1 ? "" : "ën"} buiten de
                        grafiek: {capped.map((h) => h.category).join(", ")}.
                      </p>
                    )}
                  </ToonMeer>
                )}
                {/* Waar deze maand ligt in zijn eigen eerdere maanden. Alleen in
                    deze weergave: hier staan de maanden al als staven, dus de
                    lijst is het bijschrift bij wat hij ziet. */}
                {percentiles && (
                  <PercentielLijst result={percentiles} categories={perCategory.categories} />
                )}
              </>
            )
          ) : view === "verdeling" ? (
            share.slices.length === 0 ? (
              <p className="block-empty">
                Geen uitgaven in deze periode — kies een langere periode.
              </p>
            ) : (
              <SpendPie
                slices={share.slices}
                totalCents={share.totalCents}
                euro={euroFromCents}
                onSelect={onSelectCategory}
              />
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
                      {euroFromCents(growth.rows[0].deltaCents)} meer dan de {windowDays} dagen
                      ervoor
                      {growth.rows[0].deltaPct !== null ? (
                        <> ({Math.round(growth.rows[0].deltaPct * 100)}%)</>
                      ) : (
                        <> (nieuw)</>
                      )}
                      .
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
                {/* De zin boven de staven zegt WAT er gestegen is en met
                    hoeveel; dit zegt welke dagen dat "ervoor" precies zijn en
                    dat alleen uitgaven meetellen. Dat tweede is de onderbouwing
                    van het eerste, dus het staat eronder en het staat dicht. */}
                <ToonMeer summary="Welke periode ernaast ligt, en wat er meetelt">
                  <p className="cell-sub">
                    Vergeleken met {dayLabelYearNL(growth.before.start)} —{" "}
                    {dayLabelYearNL(growth.before.end)}, dezelfde lengte als de gekozen periode.
                    Alleen uitgaven.
                  </p>
                </ToonMeer>
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
                    <strong>{peak.label}</strong> kost je gemiddeld{" "}
                    <strong>{formatEuro(peak.average)}</strong>
                    {peak.pctVsAverage !== null && peak.pctVsAverage > 0 && (
                      <>
                        {" — "}
                        {Math.round(peak.pctVsAverage)}% meer dan een gewone dag
                      </>
                    )}
                    {"."}
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
              {/* Wat "gemiddeld" hier betekent: per VOORKOMEN van die weekdag,
                  zodat de dag die het vaakst langskwam niet wint door langs te
                  komen. Dat is de definitie van het getal en niet het getal
                  zelf, dus het zakt achter de regel — met het aantal dagen in
                  het label, want dat is waar de betrouwbaarheid van het
                  gemiddelde aan af te lezen is. Alleen als er een piek IS: bij
                  "geen enkele weekdag springt eruit" valt er niets te
                  onderbouwen. */}
              {peak !== null && (
                <ToonMeer summary={`Waarop dit gemiddelde rust: ${weekdays?.spanDays} dagen`}>
                  <p className="stat-insight-basis">
                    Gemeten over {weekdays?.spanDays} dagen — elk voorkomen van die weekdag telt
                    mee, ook de dagen zonder transactie.
                  </p>
                </ToonMeer>
              )}
            </>
          )}

          {/* WHAT IS NOT IN ANY OF THE ABOVE. One line for the whole block, in
              every view, because the exclusion is the same in every view: the
              ring, the bars, the weekdays and the two totals all treat moved
              money as neither spending nor income. Amount first — it is the
              number he was looking for — then the reason. */}
          {moved.length > 0 && (
            <ToonMeer
              className="stat-moved"
              /* Het BEDRAG staat in het label en niet in het paneel. Dit is de
                 regel die bestaat omdat € 20.000 ooit stil uit de ring viel; als
                 het bedrag mee naar binnen zou vouwen, valt het opnieuw stil weg
                 en is er niets gewonnen behalve rust. Wat wél opvouwt is de
                 verdeling over de categorieën, de reden per categorie en het
                 deel dat weer terugkwam. */
              summary={`Buiten deze cijfers gehouden: ${euroFromCents(movedOut)}`}
            >
              <p className="cell-sub">
                {moved.map((m, i) => (
                  <span key={m.category}>
                    {i > 0 && " · "}
                    {euroFromCents(m.outCents)} aan {m.category} — {m.why}
                    {m.inCents > 0 && <> (waarvan {euroFromCents(m.inCents)} weer terugkwam)</>}
                  </span>
                ))}
                . Dat is geen uitgave: het is dezelfde euro op een andere plek.
              </p>
            </ToonMeer>
          )}

          {/* Totals over the window, not a monthly average: with a one-week
              window a "per maand" figure would be an extrapolation. No title
              attribute on them any more either: what they leave out is said out
              loud in the line above, and a mouse-only tooltip repeating half of
              it was the version he could not see. */}
          {totals && (
            <>
              <div className="stat-figures">
                <div className="stat-figure">
                  <div className="eyebrow">Inkomsten in deze periode</div>
                  <div className="module-figure">
                    <span className="module-figure-value">{formatEuro(totals.inTotal)}</span>
                  </div>
                  {/* Het gemiddelde staat ONDER zijn eigen totaal en niet in een
                      eigen tegel: het is hetzelfde geld, anders gedeeld, en twee
                      tegels ernaast zouden lezen als vier losse metingen. De
                      eenheid staat er altijd bij — "gemiddeld € 283,39" zonder
                      "per week" is geen cijfer maar een raadsel, en bij een
                      venster van een week zou "per maand" er een verzinsel van
                      maken. */}
                  {gemiddeld && (
                    <p className="module-figure-label">
                      gemiddeld {formatEuro(gemiddeld.inAverage)} per {gemiddeld.unit}
                    </p>
                  )}
                </div>
                <div className="stat-figure">
                  <div className="eyebrow">Uitgaven in deze periode</div>
                  <div className="module-figure">
                    <span className="module-figure-value">{formatEuro(totals.outTotal)}</span>
                  </div>
                  {gemiddeld && (
                    <p className="module-figure-label">
                      gemiddeld {formatEuro(gemiddeld.outAverage)} per {gemiddeld.unit}
                    </p>
                  )}
                </div>
              </div>

              {/* De WEIGERING is de uitkomst zelf en vouwt dus niet op; de
                  onderbouwing van een gemiddelde dat er wél is, wel. */}
              {geenGemiddelde && (
                <p className="stat-insight-basis">
                  {gemiddeldeWeigeringNL(
                    geenGemiddelde.reason,
                    geenGemiddelde.coveredDays,
                    meerBuitenVenster,
                  )}
                </p>
              )}
              {gemiddeld && (
                <ToonMeer
                  /* Het AANTAL eenheden staat in het label en niet in het paneel:
                     daaraan leest hij af hoeveel een gemiddelde waard is, en dat
                     is geen onderbouwing maar de helft van het cijfer. Zelfde
                     afweging als bij het weekdaggemiddelde erboven.
                     "deze twee" en niet "dit": in de weekdagweergave staat er al
                     een regel over EEN gemiddelde ("Waarop dit gemiddelde rust"),
                     en twee bijna gelijke labels op één scherm laten de lezer de
                     verkeerde opendoen. */
                  summary={`Waarover deze twee gemiddelden gaan: ${gemiddeld.units} hele ${unitPluralNL(
                    gemiddeld.unit,
                    gemiddeld.units,
                  )}`}
                >
                  <p className="cell-sub">
                    Gedeeld door {gemiddeld.units} hele{" "}
                    {unitPluralNL(gemiddeld.unit, gemiddeld.units)}:{" "}
                    {rangeLabelNL(gemiddeld.span.start, gemiddeld.span.end)}. Geld dat alleen van
                    plaats veranderde telt er niet in mee, net als in de rest van dit blok.
                  </p>
                  {gemiddeld.restDays > 0 && (
                    <p className="cell-sub">
                      {gemiddeld.restDays} dag{gemiddeld.restDays === 1 ? "" : "en"} aan de randen
                      tellen niet mee — een aangebroken {gemiddeld.unit} is geen {gemiddeld.unit}.
                      Zouden ze meetellen, dan hing dit gemiddelde ervan af of een vaste
                      afschrijving nog net vóór het einde van de periode viel.
                    </p>
                  )}
                  {gemiddeld.unit !== gemiddeld.askedUnit && (
                    <p className="cell-sub">
                      Niet per {gemiddeld.askedUnit}: deze periode bevat er geen {MIN_AVERAGE_UNITS}{" "}
                      hele. Over één {gemiddeld.askedUnit} middelen levert dat {gemiddeld.askedUnit}
                      bedrag zelf op.
                    </p>
                  )}
                </ToonMeer>
              )}
            </>
          )}
        </>
      )}
    </Module>
  );
}
