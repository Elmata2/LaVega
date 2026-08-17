import { barPercent, niceDomain, smoothPath, type Pt } from "../../chart.js";

/* WeekdayBars — `Modules for homescreen7.png`: a bar per day of the week with a
 * soft trend line running across them.
 *
 * The bars are HTML boxes (the same construction as CategoryBars, for the same
 * reason: labels stay real text at real size on a phone). The trend line is one
 * SVG path over the same 0–100 box, drawn through the bar-group centres, so the
 * line and the bars cannot drift apart when the card is resized.
 *
 * A day with no value renders NO bar and no point on the line. That is not a
 * cosmetic choice: a missing day means the window never contained that weekday,
 * and a zero-height bar would say "that day is free".
 *
 * The peak day gets the reference's little value chip above it — that is the
 * whole message of the chart ("Friday costs you money"), so it is stated rather
 * than left to be read off an axis. No colour is added: the bars are the
 * app's outflow terracotta, the line is the muted hairline grey.
 *
 * ON TREND LINES (backlog B6). The dashed path is a CONNECTOR, not a trend, and
 * no fitted trend was added here — a slope across Monday…Sunday would be an
 * artefact of where you cut the week. Start the axis on Sunday and the same
 * spending "trends" the other way; the ordering is cyclical, so its gradient
 * carries no information. What the block's own sentence does compare against is
 * a normal day, and until now the chart had no mark for it: "Friday is 40% above
 * average" was a claim the picture could not be checked against. That is the
 * `averageValue` reference line — a horizontal baseline at a measured number,
 * drawn only when it was measured. It is not a trend and does not pretend to
 * be. */

export type WeekdayBar = {
  label: string;
  /** null = not measured. */
  value: number | null;
};

export type WeekdayBarsProps = {
  days: WeekdayBar[];
  format: (value: number) => string;
  ariaLabel: string;
  /** Index of the bar that carries the value chip, or -1 for none. */
  peakIndex?: number;
  /** What a normal day costs, as a horizontal reference. `null`/absent = not
   *  measured, and then no line is drawn — a baseline at an assumed number
   *  would be the same lie as a zero-height bar. */
  averageValue?: number | null;
  /** What the reference line is, in the owner's words. */
  averageLabel?: string;
  height?: number;
};

/** A baseline is only worth drawing when there are several days to compare it
 *  against; with one measured day the "average" IS that day and the line would
 *  simply sit on top of its bar, implying a comparison nobody made. */
const MIN_DAYS_FOR_AVERAGE = 3;

export default function WeekdayBars({
  days, format, ariaLabel, peakIndex = -1, averageValue = null, averageLabel = "gemiddelde dag", height = 180,
}: WeekdayBarsProps) {
  if (days.length === 0) return null;

  const known = days.map((d) => d.value).filter((v): v is number => v !== null);
  const domain = niceDomain(0, Math.max(0, ...known), 4);
  const max = domain.max;

  const average =
    averageValue !== null && averageValue > 0 && known.length >= MIN_DAYS_FOR_AVERAGE ? averageValue : null;

  // Bar-group centres in the 0–100 box; the groups share the area equally.
  const centre = (i: number) => Math.round(((i + 0.5) / days.length) * 10_000) / 100;
  const points: Pt[] = days
    .map((d, i) => (d.value === null ? null : { x: centre(i), y: 100 - barPercent(d.value, max) }))
    .filter((p): p is Pt => p !== null);
  const line = points.length >= 2 ? smoothPath(points) : null;
  // The value chip only exists when the peak was actually measured.
  const peak = peakIndex >= 0 ? (days[peakIndex]?.value ?? null) : null;

  return (
    <div className="lv-bars lv-chart-withaxis weekday-bars">
      <div className="lv-bars-plot" style={{ height }} role="img" aria-label={ariaLabel}>
        {domain.ticks.map((t) => (
          <span
            key={`l${t}`}
            className="lv-chart-tick"
            style={{ top: `${100 - barPercent(t, max)}%` }}
            aria-hidden="true"
          >
            {format(t)}
          </span>
        ))}

        <div className="lv-chart-area">
          {domain.ticks.map((t) => (
            <span key={t} className="lv-chart-grid" style={{ top: `${100 - barPercent(t, max)}%` }} aria-hidden="true" />
          ))}

          <div className="lv-bars-groups">
            {days.map((d, i) => (
              <div className="lv-bars-group" key={d.label}>
                {d.value !== null && (
                  <div
                    className={`lv-bar weekday-bar${i === peakIndex ? " weekday-bar-peak" : ""}`}
                    style={{ height: `${barPercent(d.value, max)}%` }}
                    title={`${d.label}: ${format(d.value)}`}
                  />
                )}
              </div>
            ))}
          </div>

          {line && (
            <svg className="lv-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path
                d={line}
                fill="none"
                stroke="var(--muted)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}

          {/* What a normal day costs. Solid, so it does not read as another
              gridline (dashed) or as the connector (dashed, muted). */}
          {average !== null && (
            <span className="weekday-average" style={{ top: `${100 - barPercent(average, max)}%` }}>
              <span className="weekday-average-label">
                {averageLabel} {format(average)}
              </span>
            </span>
          )}

          {peak !== null && (
            <span
              className="weekday-peak-chip"
              style={{ left: `${centre(peakIndex)}%`, top: `${100 - barPercent(peak, max)}%` }}
            >
              {format(peak)}
            </span>
          )}
        </div>
      </div>

      <div className="lv-bars-xaxis">
        {days.map((d, i) => (
          <span key={d.label} className={i === peakIndex ? "weekday-label-peak" : undefined} title={d.label}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
