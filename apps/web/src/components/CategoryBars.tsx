import { barPercent, niceDomain } from "../chart.js";

/* CategoryBars — the side-by-side bar chart from Alexander's module
 * references: one slot per group (a month, or a spending category), two or
 * three bars inside it, an uppercase legend above and quiet dashed gridlines
 * behind.
 *
 * Built from HTML boxes, not SVG <rect>s, on purpose. Bars are rectangles with
 * a rounded top and a percentage height — everything CSS already does — and
 * doing it in HTML means the group labels, the legend and the axis ticks are
 * ordinary text at their ordinary size at every viewport. The SVG version of
 * this chart had to move its month labels out into HTML anyway once the grid
 * collapsed to one column; this removes the split.
 *
 * Every value is expected already sign-normalised (positive = bigger bar); the
 * caller decides what "up" means, and picks the colour token per series. */

export type BarSeries = {
  label: string;
  /** A token reference, e.g. "var(--pos)". */
  color: string;
};

export type BarGroup = {
  label: string;
  /** One value per series, in the same order. */
  values: number[];
  /** Optional longer name for the tooltip/title (labels are truncated). */
  title?: string;
};

/** Above this many groups, a phone-width axis prints every other label.
 *  Measured: twelve months in a one-column card leave ~17px per label, and
 *  "sep" needs 18. */
const MANY_GROUPS = 7;

export type CategoryBarsProps = {
  groups: BarGroup[];
  series: BarSeries[];
  format: (value: number) => string;
  ariaLabel: string;
  /** Plot height in CSS pixels. */
  height?: number;
  /** Print value ticks down the left edge. */
  showAxis?: boolean;
};

export default function CategoryBars({
  groups,
  series,
  format,
  ariaLabel,
  height = 176,
  showAxis = false,
}: CategoryBarsProps) {
  if (groups.length === 0) return null;

  const all = groups.flatMap((g) => g.values).filter((v) => Number.isFinite(v));
  // The bars share one scale so the two series stay comparable by eye — the
  // whole point of putting them side by side.
  const domain = niceDomain(0, Math.max(0, ...all), 4);
  const max = domain.max;

  return (
    <div className={`lv-bars${showAxis ? " lv-chart-withaxis" : ""}`}>
      <div className="lv-chart-legend">
        {series.map((s) => (
          <span className="lv-chart-legend-item" key={s.label}>
            <span className="lv-chart-swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <div className="lv-bars-plot" style={{ height }} role="img" aria-label={ariaLabel}>
        {showAxis &&
          domain.ticks.map((t) => (
            <span
              key={`l${t}`}
              className="lv-chart-tick"
              style={{ top: `${100 - barPercent(t, max)}%` }}
              aria-hidden="true"
            >
              {format(t)}
            </span>
          ))}

        {/* The drawing area, so the axis gutter never shifts the bars' slots. */}
        <div className="lv-chart-area">
          {domain.ticks.map((t) => (
            <span
              key={t}
              className="lv-chart-grid"
              style={{ top: `${100 - barPercent(t, max)}%` }}
              aria-hidden="true"
            />
          ))}

          <div className="lv-bars-groups">
            {groups.map((g) => (
              <div className="lv-bars-group" key={g.label}>
                {g.values.map((v, i) => (
                  <div
                    key={series[i]?.label ?? i}
                    className="lv-bar"
                    style={{ height: `${barPercent(v, max)}%`, background: series[i]?.color }}
                    title={`${g.title ?? g.label} · ${series[i]?.label}: ${format(v)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Every group keeps a label cell so the row stays aligned with the bars;
          with many groups on a narrow screen charts.css hides every other one
          rather than letting twelve month names ellipsise to "s…". */}
      <div className={`lv-bars-xaxis${groups.length > MANY_GROUPS ? " lv-bars-many" : ""}`}>
        {groups.map((g) => (
          <span key={g.label} title={g.title ?? g.label}>
            {g.label}
          </span>
        ))}
      </div>
    </div>
  );
}
