import type { Account, EntityForecast, Tx, ScheduledFlow } from "@lavega/core";
import { forecastCashflow } from "@lavega/core";
import type { ConversionMode } from "../settings.js";
import { formatEuroIn } from "../format";
import { useAppLocale, pick } from "../appLocale";
import { moneyCopy } from "../copy/money";
import type { Locale } from "../locale";
import {
  bannerState,
  confidenceLabel,
  hasBand,
  isThinData,
  splitDrivers,
  type BannerState,
} from "../forecast-view";
import TrendChart, { type TrendPoint } from "../components/TrendChart";
import Card, { CardHeader } from "../components/ui/Card.js";

type ForecastProps = {
  txs: Tx[];
  accounts: Account[];
  entityScope: string;
  asOf: string;
  bufferCents: number;
  scheduledFlows: ScheduledFlow[];
  fxHistory: Record<string, Record<string, number>>;
  mode: ConversionMode;
};

// 91 days = 13 weekly points. The buffer is user-set (Overzicht → Aandacht) and
// passed in, so the shortfall line reflects it here too.
const HORIZON_DAYS = 91;

/** Whole-euro number (no currency symbol, no cents) for chart ticks and
 *  driver rows — the mockup's "+€18.400" style is more scannable in a dense
 *  list/axis than formatEuroIn's full "€ 18.400,00". `n` is already in euros. */
function wholeEuroFormat(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function euroNumber(locale: Locale, cents: number): string {
  return wholeEuroFormat(locale, cents / 100);
}

type LowestPoint = {
  columnIndex: number; // index into the chart's 14 columns (0 = "nu")
  weekNumber: number;
  date: string;
  closingCents: number;
  lowerCents: number | null; // null when the engine could not measure a band
};

/** Finds the weekly point with the lowest projected closing balance — used
 *  to annotate the chart and to give the green ("geen tekort") banner a
 *  concrete "krapste punt" callout instead of a bare reassurance. Returns
 *  null when there's no saldo line to search (unknown opening) or no points. */
function findLowestPoint(f: EntityForecast): LowestPoint | null {
  if (f.openingCents === null || f.points.length === 0) return null;
  let best = 0;
  for (let i = 1; i < f.points.length; i++) {
    const c = f.points[i].projectedClosingCents;
    const bestC = f.points[best].projectedClosingCents;
    if (c !== null && bestC !== null && c < bestC) best = i;
  }
  const p = f.points[best];
  if (p.projectedClosingCents === null) return null;
  return {
    columnIndex: best + 1,
    weekNumber: best + 1,
    date: p.date,
    closingCents: p.projectedClosingCents,
    lowerCents: p.lowerCents,
  };
}

function ForecastBanner({
  f,
  state,
  thin,
  lowest,
  bufferCents,
  locale,
}: {
  f: EntityForecast;
  state: BannerState;
  thin: boolean;
  lowest: LowestPoint | null;
  bufferCents: number;
  locale: Locale;
}) {
  const c = moneyCopy[locale].forecast;
  // "insufficient" borrows the neutral treatment: like an unknown opening it is
  // a "we cannot tell you this", not a verdict. There is deliberately no green
  // reassurance behind it.
  const stateClass =
    state === "shortfall"
      ? "forecast-banner-shortfall"
      : state === "none"
        ? "forecast-banner-none"
        : "forecast-banner-unknown";
  const titleClass =
    state === "shortfall" ? "text-neg" : state === "none" ? "text-pos" : "text-muted";
  const atRisk = f.atRisk ?? null;

  return (
    <Card as="section" className={`forecast-banner ${stateClass}`} aria-label={c.tekortSignaleringAria}>
      <div>
        <p className={`forecast-banner-title ${titleClass}`}>
          {state === "shortfall" &&
            f.shortfall &&
            c.shortfallSentence(
              f.shortfall.date,
              formatEuroIn(locale, f.shortfall.balanceCents / 100),
              euroNumber(locale, bufferCents),
            )}
          {state === "unknown" && c.unknownSentence}
          {state === "insufficient" && c.insufficientSentence}
          {state === "none" && c.noneSentence}
        </p>
        {state === "none" && lowest && (
          <p className="forecast-banner-sub">
            {c.krapstePuntBanner(
              lowest.weekNumber,
              euroNumber(locale, lowest.closingCents),
              lowest.lowerCents !== null ? c.lowerSuffix(euroNumber(locale, lowest.lowerCents)) : "",
              euroNumber(locale, bufferCents),
            )}
          </p>
        )}
        {state === "none" && atRisk && (
          <p className="forecast-banner-sub">
            {c.wellRisico(
              atRisk.date,
              formatEuroIn(locale, atRisk.balanceCents / 100),
              euroNumber(locale, bufferCents),
            )}
          </p>
        )}
        {thin && state !== "insufficient" && (
          <p className="forecast-banner-note">{c.geenLopendeStromenNote}</p>
        )}
      </div>
    </Card>
  );
}

/** 13-week cashflow chart: the expected line, the measured band, and a dashed
 *  buffer line, over 14 points ("nu" = asOf/opening, then the 13 weekly points).
 *
 *  Since U3 this is the shared TrendChart — the same component the Overzicht
 *  cashflow module draws, here with the value axis switched on.
 *
 *  The band is drawn only when the engine could MEASURE one. It used to be
 *  filled in from a fallback constant whenever the opening balance was known,
 *  which drew a narrow, confident-looking ribbon around scopes we knew almost
 *  nothing about. No band now means no band on screen — and since the coverage
 *  notes were removed on 20 August, the ABSENCE of the band is the whole signal,
 *  so it must never be drawn from a constant again. It is one standard deviation
 *  of measured variation — not a percentile, despite what this comment used to
 *  call it. */
function ForecastChart({
  f,
  lowest,
  bufferCents,
  locale,
}: {
  f: EntityForecast;
  lowest: LowestPoint | null;
  bufferCents: number;
  locale: Locale;
}) {
  const c = moneyCopy[locale].forecast;
  if (f.openingCents === null) {
    return <p className="forecast-chart-empty">{c.positieOnbekendAlleenStromen}</p>;
  }
  if (f.points.length === 0) {
    return <p className="forecast-chart-empty">{c.onvoldoendeDataGrafiek}</p>;
  }

  const opening = f.openingCents;
  const showBand = hasBand(f);
  const points: TrendPoint[] = [
    { label: c.positieAsOfLabel, value: opening / 100 },
    ...f.points.map((p, i) => ({
      label: `w${i + 1}`,
      value: (p.projectedClosingCents ?? opening) / 100,
    })),
  ];
  const band = showBand
    ? {
        lower: [
          opening / 100,
          ...f.points.map((p) => (p.lowerCents ?? p.projectedClosingCents ?? opening) / 100),
        ],
        upper: [
          opening / 100,
          ...f.points.map((p) => (p.upperCents ?? p.projectedClosingCents ?? opening) / 100),
        ],
      }
    : undefined;
  const lowestIsShortfall =
    lowest !== null && f.shortfall !== null && lowest.date === f.shortfall.date;

  return (
    <>
      <TrendChart
        points={points}
        band={band}
        // "buffer" reads the same in Dutch and English — see Worker B's report.
        reference={{ value: bufferCents / 100, label: `buffer €${euroNumber(locale, bufferCents)}` }}
        color={f.shortfall ? "var(--neg)" : "var(--pos)"}
        format={(v) => `€${wholeEuroFormat(locale, v)}`}
        ariaLabel={c.verwachteKaspositieAria}
        readoutLabel={pick(locale, "Verwacht saldo", "Expected balance")}
        mark={
          lowest
            ? { index: lowest.columnIndex, color: lowestIsShortfall ? "var(--neg)" : "var(--pos)" }
            : null
        }
        height={220}
        showAxis
      />

      <div className="forecast-chart-legend">
        <span className="forecast-chart-legend-item">
          <span
            className="forecast-chart-legend-swatch"
            style={{ background: f.shortfall ? "var(--neg)" : "var(--pos)" }}
            aria-hidden="true"
          />
          {c.verwacht}
        </span>
        {showBand && (
          <span className="forecast-chart-legend-item">
            <span
              className="forecast-chart-legend-swatch forecast-chart-legend-band"
              style={{ background: f.shortfall ? "var(--neg)" : "var(--pos)" }}
              aria-hidden="true"
            />
            {c.gemetenBandbreedte}
          </span>
        )}
        <span className="forecast-chart-legend-item">
          <span
            className="forecast-chart-legend-swatch"
            style={{ background: "var(--warn)" }}
            aria-hidden="true"
          />
          {c.bufferLabel(euroNumber(locale, bufferCents))}
        </span>
        {lowest && (
          <span className="forecast-chart-legend-item">
            {c.krapstePuntLegend(lowest.weekNumber, euroNumber(locale, lowest.closingCents))}
          </span>
        )}
      </div>
    </>
  );
}

export default function Forecast({
  txs,
  accounts,
  entityScope,
  asOf,
  bufferCents,
  scheduledFlows,
  fxHistory,
  mode,
}: ForecastProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].forecast;
  const fc = forecastCashflow(txs, accounts, {
    asOf,
    horizonDays: HORIZON_DAYS,
    bufferCents,
    scheduledFlows,
    fxHistory,
    mode,
  });
  // Honor entityScope, but fall back to the consolidated view if the scope
  // isn't (or is no longer) present in byEntity — App.tsx self-heals a stale
  // entityScope already, but this component stays correct on its own too.
  const scoped = entityScope ? fc.byEntity[entityScope] : undefined;
  const f = scoped ?? fc.consolidated;
  const scopeLabel = scoped ? entityScope : c.scopeLabelAlleBedrijven;

  const state = bannerState(f);
  const thin = isThinData(f);
  const lowest = findLowestPoint(f);
  const { inkomsten, uitgaven } = splitDrivers(f.drivers);
  const ended = f.basis?.endedStreams ?? [];

  return (
    <>
      <ForecastBanner
        f={f}
        state={state}
        thin={thin}
        lowest={lowest}
        bufferCents={bufferCents}
        locale={locale}
      />

      <div className="card-grid forecast-grid">
        <Card as="section" aria-label={c.cashflowForecastAria}>
          <CardHeader>
            <h2>{c.cashflowForecastTitle}</h2>
            <span className="eyebrow">
              {scopeLabel}
              {f.basis && <> · {confidenceLabel(locale, f.basis.confidence)}</>}
            </span>
          </CardHeader>
          <ForecastChart f={f} lowest={lowest} bufferCents={bufferCents} locale={locale} />
        </Card>

        <Card as="section" aria-label={c.driversAria}>
          <h2>{c.driversTitle}</h2>
          {f.drivers.length === 0 ? (
            <p>{c.nogGeenLopendeStromen}</p>
          ) : (
            <>
              <h3 className="drivers-heading">{c.verwachteInkomsten}</h3>
              {inkomsten.length === 0 ? (
                <p className="drivers-empty">{c.geenHerkendeInkomstenstromen}</p>
              ) : (
                <div className="drivers-list">
                  {inkomsten.map((d) => (
                    <div className="driver-row" key={`${d.label}-${d.sign}`}>
                      <span className="driver-label">{d.label}</span>
                      <span className="text-pos driver-amount">
                        +€{euroNumber(locale, d.perWeekCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="drivers-heading">{c.verwachteUitgaven}</h3>
              {uitgaven.length === 0 ? (
                <p className="drivers-empty">{c.geenHerkendeUitgavenstromen}</p>
              ) : (
                <div className="drivers-list">
                  {uitgaven.map((d) => (
                    <div className="driver-row" key={`${d.label}-${d.sign}`}>
                      <span className="driver-label">{d.label}</span>
                      <span className="text-neg driver-amount">
                        −€{euroNumber(locale, Math.abs(d.perWeekCents))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {ended.length > 0 && (
            <>
              <h3 className="drivers-heading">{c.gestoptNietMeegeteld}</h3>
              <div className="drivers-list">
                {ended.map((s) => (
                  <div className="driver-row" key={s.key}>
                    <span className="driver-label text-muted">
                      {s.counterparty} <span className="eyebrow">{c.laatst(s.lastDate)}</span>
                    </span>
                    <span className="text-muted driver-amount">
                      €{euroNumber(locale, s.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* REMOVED 20 Aug (app review 2): the "Waar deze prognose op rust" notes
          and the deterministic-forecast footnote. Both were true, and he has
          read them; on every later visit they were two blocks of prose above a
          chart, explaining rather than showing. `coverageNotes` stays in
          forecast-view.ts — the derivation is right and it is the obvious input
          for a hover later — only the rendering is gone. Do not re-add a
          paragraph here: if the basis needs saying again, say it on the number
          it belongs to. */}
    </>
  );
}
