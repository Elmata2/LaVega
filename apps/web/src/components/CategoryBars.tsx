import { useState, type PointerEvent as ReactPointerEvent } from "react";
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
 * caller decides what "up" means, and picks the colour token per series.
 *
 * ON THE READING (review 2, item 12: "I want to be able to hover over every
 * statistic and see the number specifically in the month"). Each bar used to
 * carry a `title`, which is a feature only a desktop mouse has: a phone never
 * hovers and a keyboard never triggers one. So a bar is now a real <button>
 * carrying a chip of its own, shown on hover, on focus AND on tap. The chip
 * always prints WHICH slice above the number — "€ 412" alone leaves the reader
 * guessing whether that is the month, the window or the average. */

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

/** Above this share of the plot the reading is drawn INSIDE its bar: a chip
 *  floating above a bar that nearly fills the plot would land on the legend. */
const TALL_BAR = 72;

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
  // Which bar was TAPPED. Hover and focus are handled in CSS; this exists for
  // the phones that do not focus a button on tap, where nothing else would ever
  // open the chip. Tapping the same bar again closes it.
  const [tapped, setTapped] = useState<string | null>(null);

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

      {/* role="group", not role="img": an image's contents are presentational,
          which would have hidden every bar button from a screen reader again —
          the exact thing the reading exists to prevent. */}
      <div className="lv-bars-plot" style={{ height }} role="group" aria-label={ariaLabel}>
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
            {groups.map((g, gi) => (
              <div className="lv-bars-group" key={g.label}>
                {g.values.map((v, i) => {
                  const key = `${gi}:${i}`;
                  const pct = barPercent(v, max);
                  // With one series the series name says nothing the legend
                  // does not; with two it is half the answer to "which number
                  // is this?".
                  const when =
                    series.length > 1
                      ? `${g.title ?? g.label} · ${series[i]?.label}`
                      : (g.title ?? g.label);
                  return (
                    <button
                      key={series[i]?.label ?? i}
                      type="button"
                      className="lv-bar"
                      style={{ height: `${pct}%`, background: series[i]?.color }}
                      aria-label={`${when}: ${format(v)}`}
                      data-tip={tapped === key ? "on" : "off"}
                      onClick={() => setTapped((t) => (t === key ? null : key))}
                      onPointerLeave={(e: ReactPointerEvent<HTMLButtonElement>) => {
                        // A touch pointer "leaves" the moment the finger lifts,
                        // which would close the chip before it was read; only a
                        // mouse leaving means "done looking".
                        if (e.pointerType === "mouse") setTapped(null);
                      }}
                      onBlur={() => setTapped((t) => (t === key ? null : t))}
                    >
                      <span
                        className={`lv-tip${pct > TALL_BAR ? " lv-tip-inside" : ""}`}
                        aria-hidden="true"
                      >
                        <span className="lv-tip-when">{when}</span>
                        <span className="lv-tip-value">{format(v)}</span>
                      </span>
                    </button>
                  );
                })}
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
