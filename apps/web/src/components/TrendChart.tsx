import {
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { areaPath, bandPath, makeYScale, nearestIndex, niceDomain, smoothPath, type Pt } from "../chart.js";

/* TrendChart — the clean, sleek trend line Alexander asked for (the register of
 * the Hercules weight-trend charts): one smooth curve, a soft fill under it, a
 * few quiet gridlines, an optional dashed target/buffer line, and a readout
 * that names the point you are pointing at.
 *
 * Two deliberate construction choices:
 *
 *  1. The SVG holds ONLY geometry — band, fill, reference line, the curve. It
 *     is drawn in a 0–100 box with preserveAspectRatio="none" so it stretches
 *     to whatever width the module has, and every stroke carries
 *     vector-effect="non-scaling-stroke" so it stays exactly as thick at 320px
 *     as at 900px.
 *  2. Every piece of TEXT and every dot is HTML positioned at left:x% / top:y%
 *     over the same box. Text therefore never scales with the chart — the
 *     failure mode that turned month labels into 6px on a phone.
 *
 * The curve is monotone (see chart.ts): a smoothed cash line must never dip
 * below the lowest value it was given, or it would show a shortfall the
 * forecast did not predict.
 *
 * Colours come from tokens only; the component takes a CSS variable string.
 *
 * ON THE READING (review 2, item 12). The readout already named the point the
 * pointer was on; what it could not do was be reached without a pointer. The
 * hit surface is now a focusable read-only slider: arrow keys walk the series a
 * point at a time, Home and End jump to its ends, and aria-valuetext carries
 * "week 3: € 950" so the announcement names the slice as well as the number. */

export type TrendPoint = {
  /** What the readout calls this point, e.g. "week 4" or "aug 2026". */
  label: string;
  value: number;
};

export type TrendChartProps = {
  points: TrendPoint[];
  /** Uncertainty band drawn behind the line; same length as `points`. */
  band?: { lower: number[]; upper: number[] };
  /** Dashed horizontal line, e.g. the cash buffer. */
  reference?: { value: number; label: string };
  /** Line colour, a token reference such as "var(--pos)". */
  color?: string;
  /** How the readout and the axis print a value. */
  format: (value: number) => string;
  ariaLabel: string;
  /** A point that is always marked, whatever the pointer is doing. */
  mark?: { index: number; color: string } | null;
  /** Plot height in CSS pixels. */
  height?: number;
  /** Print value ticks down the left edge. Off in a narrow module card. */
  showAxis?: boolean;
  /** Eyebrow above the readout value, e.g. "Verwacht saldo". */
  readoutLabel?: string;
};

const PAD = 8; // vertical inset, in the 0–100 box

export default function TrendChart({
  points,
  band,
  reference,
  color = "var(--accent)",
  format,
  ariaLabel,
  mark = null,
  height = 180,
  showAxis = false,
  readoutLabel,
}: TrendChartProps) {
  // Null until the pointer picks one: the readout then shows the LAST point,
  // which is the number the card is actually about.
  const [hover, setHover] = useState<number | null>(null);
  // Unique per instance, so two trend charts on one screen don't share a fill.
  const gradientId = `lv-trend${useId().replace(/:/g, "")}`;

  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  if (band) values.push(...band.lower, ...band.upper);
  if (reference) values.push(reference.value);
  const domain = niceDomain(Math.min(...values), Math.max(...values), showAxis ? 4 : 3);
  const y = makeYScale(domain.min, domain.max, PAD);
  const x = (i: number) =>
    points.length === 1 ? 50 : Math.round((i / (points.length - 1)) * 10_000) / 100;

  const line: Pt[] = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const linePath = smoothPath(line);
  const fillPath = areaPath(line, 100);
  const bandArea = band
    ? bandPath(
        band.upper.map((v, i) => ({ x: x(i), y: y(v) })),
        band.lower.map((v, i) => ({ x: x(i), y: y(v) })),
      )
    : null;

  const activeIndex = hover ?? points.length - 1;
  const active = points[activeIndex];

  function pick(e: ReactPointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    setHover(nearestIndex(points.length, (e.clientX - box.left) / box.width));
  }

  function scrub(e: ReactKeyboardEvent<HTMLDivElement>) {
    const next = keyToIndex(points.length, activeIndex, e.key);
    if (next === null) return; // not ours — leave tabbing and scrolling alone
    e.preventDefault();
    setHover(next);
  }

  return (
    <div className={`lv-chart${showAxis ? " lv-chart-withaxis" : ""}`}>
      <div className="lv-chart-readout">
        <span className="eyebrow">
          {readoutLabel ? `${readoutLabel} · ` : ""}
          {active.label}
        </span>
        <span className="lv-chart-readout-value" style={{ color }}>
          {format(active.value)}
        </span>
      </div>

      {/* role="group", not role="img": an image's contents are presentational,
          which would hide the scrubber inside it from a screen reader. */}
      <div className="lv-chart-plot" style={{ height }} role="group" aria-label={ariaLabel}>
        {showAxis &&
          domain.ticks.map((t) => (
            <span key={`l${t}`} className="lv-chart-tick" style={{ top: `${y(t)}%` }} aria-hidden="true">
              {format(t)}
            </span>
          ))}

        {/* The drawing area. Separate from the plot so the axis labels can sit
            beside it and every left:x% below still means x% of the CHART, not
            x% of the chart plus its axis gutter. */}
        <div className="lv-chart-area">
          {domain.ticks.map((t) => (
            <span key={t} className="lv-chart-grid" style={{ top: `${y(t)}%` }} aria-hidden="true" />
          ))}

          <svg
            className="lv-chart-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {bandArea && <path d={bandArea} fill={color} fillOpacity={0.14} stroke="none" />}
            <path d={fillPath} fill={`url(#${gradientId})`} stroke="none" />
            {reference && (
              <line
                x1={0}
                y1={y(reference.value)}
                x2={100}
                y2={y(reference.value)}
                stroke="var(--warn)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {reference && (
            <span className="lv-chart-reflabel" style={{ top: `${y(reference.value)}%` }} aria-hidden="true">
              {reference.label}
            </span>
          )}

          {mark && mark.index >= 0 && mark.index < points.length && (
            <span
              className="lv-chart-mark"
              style={{ left: `${x(mark.index)}%`, top: `${y(points[mark.index].value)}%`, background: mark.color }}
              aria-hidden="true"
            />
          )}

          <span
            className="lv-chart-cursor"
            style={{ left: `${x(activeIndex)}%` }}
            data-active={hover === null ? "idle" : "on"}
            aria-hidden="true"
          />
          <span
            className="lv-chart-dot"
            style={{ left: `${x(activeIndex)}%`, top: `${y(active.value)}%`, borderColor: color }}
            aria-hidden="true"
          />

          {/* Pointer surface, and the keyboard's way in. onPointerDown makes a
              tap work on a phone; the page still scrolls normally because
              nothing is prevented except the arrow keys we handle.

              role="slider" + aria-valuetext is what makes the reading audible:
              a screen reader announces "week 3: € 950" as the cursor moves.
              aria-readonly says out loud that this moves a cursor, not data. */}
          <div
            className="lv-chart-hit"
            tabIndex={0}
            role="slider"
            aria-label={ariaLabel}
            aria-readonly="true"
            aria-valuemin={0}
            aria-valuemax={points.length - 1}
            aria-valuenow={activeIndex}
            aria-valuetext={`${active.label}: ${format(active.value)}`}
            onKeyDown={scrub}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
          />
        </div>
      </div>

      <div className="lv-chart-xaxis" aria-hidden="true">
        {axisIndices(points.length).map((i) => (
          <span key={i} className="lv-chart-xlabel" style={{ left: `${x(i)}%` }}>
            {points[i].label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Which point a key press moves to, or null when the key is not ours (so Tab
 *  still tabs and PageDown still scrolls). Clamped rather than wrapped: a
 *  cursor that jumps from the last week back to today would read as a jump in
 *  the data. Pure, so the keyboard behaviour is testable without a browser. */
export function keyToIndex(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(current - 1);
    case "ArrowRight":
    case "ArrowUp":
      return clamp(current + 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Which x labels to print. All of them while they still fit; otherwise the
 *  ends plus two inside, so a 14-week axis stays readable on a phone. */
export function axisIndices(count: number): number[] {
  if (count <= 0) return [];
  if (count <= 5) return Array.from({ length: count }, (_, i) => i);
  const last = count - 1;
  const picks = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
  return [...new Set(picks)];
}
