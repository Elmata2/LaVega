import type { Account, EntityForecast, Tx, ScheduledFlow } from "@lavega/core";
import { forecastCashflow } from "@lavega/core";
import { formatEuro } from "../format";
import { bannerState, isThinData, splitDrivers, type BannerState } from "../forecast-view";

type ForecastProps = {
  txs: Tx[];
  accounts: Account[];
  entityScope: string;
  asOf: string;
  bufferCents: number;
  scheduledFlows: ScheduledFlow[];
};

// 91 days = 13 weekly points. The buffer is user-set (Overzicht → Aandacht) and
// passed in, so the shortfall line reflects it here too.
const HORIZON_DAYS = 91;

const wholeEuroFormatter = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
/** Whole-euro number (no currency symbol, no cents) for chart ticks and
 *  driver rows — the mockup's "+€18.400" style is more scannable in a dense
 *  list/axis than formatEuro's full "€ 18.400,00". */
function euroNumber(cents: number): string {
  return wholeEuroFormatter.format(Math.round(cents / 100));
}

type LowestPoint = {
  columnIndex: number; // index into the chart's 14 columns (0 = "nu")
  weekNumber: number;
  date: string;
  closingCents: number;
  lowerCents: number;
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
    lowerCents: p.lowerCents ?? p.projectedClosingCents,
  };
}

function ForecastBanner({
  f,
  state,
  thin,
  lowest,
  bufferCents,
}: {
  f: EntityForecast;
  state: BannerState;
  thin: boolean;
  lowest: LowestPoint | null;
  bufferCents: number;
}) {
  const stateClass =
    state === "shortfall" ? "forecast-banner-shortfall" : state === "unknown" ? "forecast-banner-unknown" : "forecast-banner-none";
  const titleClass = state === "shortfall" ? "text-neg" : state === "unknown" ? "text-muted" : "text-pos";

  return (
    <section className={`card forecast-banner ${stateClass}`} aria-label="Tekort-signalering">
      <div>
        <p className={`forecast-banner-title ${titleClass}`}>
          {state === "shortfall" && f.shortfall && (
            <>
              Tekort verwacht rond {f.shortfall.date} — laagste saldo ~{formatEuro(f.shortfall.balanceCents / 100)} (buffer €
              {euroNumber(bufferCents)}).
            </>
          )}
          {state === "unknown" && (
            <>Positie onbekend (alleen CSV-rekeningen zonder saldo) — we tonen de verwachte stromen, geen saldo-lijn.</>
          )}
          {state === "none" && <>Geen tekort verwacht in de komende 13 weken.</>}
        </p>
        {state === "none" && lowest && (
          <p className="forecast-banner-sub">
            Krapste punt: week {lowest.weekNumber} — verwacht €{euroNumber(lowest.closingCents)} (ondergrens €
            {euroNumber(lowest.lowerCents)}), boven je buffer van €{euroNumber(bufferCents)}.
          </p>
        )}
        {thin && (
          <p className="forecast-banner-note">
            Onvoldoende terugkerende historie voor een betrouwbare prognose — voeg meer maanden/rekeningen toe.
          </p>
        )}
      </div>
    </section>
  );
}

const CHART_W = 640;
const CHART_H = 220;
const PAD_L = 56;
const PAD_R = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 30;

/** 13-week cashflow chart: median line + filled P-band + a dashed buffer(0)
 *  line, plotted over 14 columns ("nu" = asOf/opening, then the 13 weekly
 *  points). All scaling below is guarded against NaN/empty input (range and
 *  point-count fallbacks), matching Overzicht's CashflowMiniChart. */
function ForecastChart({ f, lowest, bufferCents }: { f: EntityForecast; lowest: LowestPoint | null; bufferCents: number }) {
  if (f.openingCents === null) {
    return <p className="forecast-chart-empty">Positie onbekend — alleen stromen.</p>;
  }
  if (f.points.length === 0) {
    return <p className="forecast-chart-empty">Onvoldoende data voor een grafiek.</p>;
  }

  const opening = f.openingCents;
  const median = [opening, ...f.points.map((p) => p.projectedClosingCents ?? opening)];
  const lower = [opening, ...f.points.map((p) => p.lowerCents ?? opening)];
  const upper = [opening, ...f.points.map((p) => p.upperCents ?? opening)];
  const n = median.length;

  const allValues = [...median, ...lower, ...upper, bufferCents].filter((v) => Number.isFinite(v));
  const minV = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxV = allValues.length > 0 ? Math.max(...allValues) : 1;
  const range = maxV - minV || 1;

  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const x = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD_TOP + innerH - ((v - minV) / range) * innerH;

  const medianPoints = median.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const bandTop = upper.map((v, i) => `${x(i)},${y(v)}`);
  const bandBottom = lower.map((v, i) => `${x(i)},${y(v)}`).reverse();
  const bandPath = `M ${[...bandTop, ...bandBottom].join(" L ")} Z`;
  const bufferY = y(bufferCents);

  const yTicks = [maxV, (maxV + minV) / 2, minV];
  const xTicks = [
    { i: 0, label: "nu" },
    { i: Math.min(4, n - 1), label: "w4" },
    { i: Math.min(9, n - 1), label: "w9" },
    { i: n - 1, label: "w13" },
  ];

  const lowestX = lowest ? x(lowest.columnIndex) : null;
  const lowestY = lowest ? y(lowest.closingCents) : null;
  const lowestIsShortfall = lowest !== null && f.shortfall !== null && lowest.date === f.shortfall.date;

  return (
    <>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="forecast-chart-svg"
        role="img"
        aria-label="Verwachte kaspositie komende 13 weken"
      >
        {yTicks.map((v, idx) => (
          <text key={idx} x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
            €{euroNumber(v)}
          </text>
        ))}
        <path d={bandPath} fill="rgba(78, 122, 58, 0.13)" stroke="none" />
        <line
          x1={PAD_L}
          y1={bufferY}
          x2={CHART_W - PAD_R}
          y2={bufferY}
          stroke="var(--warn)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <polyline
          points={medianPoints}
          fill="none"
          stroke="var(--pos)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {lowest && lowestX !== null && lowestY !== null && (
          <>
            <circle cx={lowestX} cy={lowestY} r={3.5} fill={lowestIsShortfall ? "var(--neg)" : "var(--pos)"} />
            <text
              x={lowestX}
              y={Math.max(12, lowestY - 10)}
              textAnchor="middle"
              fontSize={10}
              fill={lowestIsShortfall ? "var(--neg)" : "var(--ink)"}
            >
              €{euroNumber(lowest.closingCents)}
            </text>
          </>
        )}
        {xTicks.map((t) => (
          <text key={t.label} x={x(t.i)} y={CHART_H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">
            {t.label}
          </text>
        ))}
      </svg>

      <div className="forecast-chart-legend">
        <span className="forecast-chart-legend-item">
          <span className="forecast-chart-legend-swatch" style={{ background: "var(--pos)" }} aria-hidden="true" />
          Verwacht (mediaan)
        </span>
        <span className="forecast-chart-legend-item">
          <span className="forecast-chart-legend-swatch" style={{ background: "rgba(78, 122, 58, 0.35)" }} aria-hidden="true" />
          Bandbreedte
        </span>
        <span className="forecast-chart-legend-item">
          <span className="forecast-chart-legend-swatch" style={{ background: "var(--warn)" }} aria-hidden="true" />
          Buffer €{euroNumber(bufferCents)}
        </span>
      </div>
    </>
  );
}

export default function Forecast({ txs, accounts, entityScope, asOf, bufferCents, scheduledFlows }: ForecastProps) {
  const fc = forecastCashflow(txs, accounts, { asOf, horizonDays: HORIZON_DAYS, bufferCents, scheduledFlows });
  // Honor entityScope, but fall back to the consolidated view if the scope
  // isn't (or is no longer) present in byEntity — App.tsx self-heals a stale
  // entityScope already, but this component stays correct on its own too.
  const scoped = entityScope ? fc.byEntity[entityScope] : undefined;
  const f = scoped ?? fc.consolidated;
  const scopeLabel = scoped ? entityScope : "alle bedrijven, gesaldeerd";

  const state = bannerState(f);
  const thin = isThinData(f);
  const lowest = findLowestPoint(f);
  const { inkomsten, uitgaven } = splitDrivers(f.drivers);

  return (
    <>
      <ForecastBanner f={f} state={state} thin={thin} lowest={lowest} bufferCents={bufferCents} />

      <div className="card-grid forecast-grid">
        <section className="card" aria-label="13-weeks cashflow-forecast">
          <div className="card-header">
            <h2>13-weeks cashflow-forecast</h2>
            <span className="eyebrow">{scopeLabel}</span>
          </div>
          <ForecastChart f={f} lowest={lowest} bufferCents={bufferCents} />
        </section>

        <section className="card" aria-label="Drivers per week">
          <h2>Drivers · per week (gem.)</h2>
          {f.drivers.length === 0 ? (
            <p>Nog geen terugkerende stromen herkend.</p>
          ) : (
            <>
              <h3 className="drivers-heading">Verwachte inkomsten</h3>
              {inkomsten.length === 0 ? (
                <p className="drivers-empty">Geen herkende inkomstenstromen.</p>
              ) : (
                <div className="drivers-list">
                  {inkomsten.map((d) => (
                    <div className="driver-row" key={`${d.label}-${d.sign}`}>
                      <span className="driver-label">{d.label}</span>
                      <span className="text-pos driver-amount">+€{euroNumber(d.perWeekCents)}</span>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="drivers-heading">Verwachte uitgaven</h3>
              {uitgaven.length === 0 ? (
                <p className="drivers-empty">Geen herkende uitgavenstromen.</p>
              ) : (
                <div className="drivers-list">
                  {uitgaven.map((d) => (
                    <div className="driver-row" key={`${d.label}-${d.sign}`}>
                      <span className="driver-label">{d.label}</span>
                      <span className="text-neg driver-amount">−€{euroNumber(Math.abs(d.perWeekCents))}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <p className="card forecast-footnote">
        Deterministische 13-weeks forecast (herkende terugkerende betalingen + roll-forward). Geen ML. Cijfers indicatief.
      </p>
    </>
  );
}
