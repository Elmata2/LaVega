import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CategorySlice } from "./blocks/statistics.js";

/* SpendPie — what a period's spending is made of.
 *
 * A CSS `conic-gradient` rather than an SVG pie, for the same reason CategoryBars
 * is made of HTML boxes: the ring is one element and one background, while the
 * legend — which is where the numbers actually live — is ordinary text at
 * ordinary size at every viewport. An SVG would have needed its labels lifted
 * back out into HTML the moment the grid collapsed to one column.
 *
 * It is a ring rather than a full circle so the total can sit in the middle. On a
 * page about where the money went, the amount is the headline and the shape is
 * the annotation.
 *
 * Colours come from a fixed palette indexed by position, so a category keeps its
 * colour between renders of the same window — a chart that reshuffles its colours
 * on every re-render reads as noise. The palette holds eight; anything past it is
 * already folded into "Overig" by the caller.
 *
 * ON THE READING (review 2, item 12: "hover over every statistic and see the
 * number"). Two things were mouse-only here. The legend rows that could not be
 * filtered were <span>s, so a keyboard could not reach them at all; every row is
 * now a button. And the ring answered nothing — pointing at an arc named no
 * category and no amount. It does now: the pointer's angle picks the slice
 * (sliceAtPoint), the hole prints THAT slice's exact euro and its share of the
 * period, and the other arcs step back so the number in the middle is visibly
 * about one arc. Pointing at the hole is not pointing at an arc, so the total
 * stays put there.
 */

/** Eight tokens, then grey. Chosen to stay distinguishable in both themes and to
 *  avoid green/red, which mean income and expense everywhere else in this app —
 *  a green slice in a spending chart would read as money coming in. */
const SLICE_COLORS = [
  "#4c6ef5",
  "#7950f2",
  "#e8590c",
  "#0c8599",
  "#f08c00",
  "#c2255c",
  "#2b8a3e",
  "#495057",
];

export function sliceColor(i: number): string {
  return SLICE_COLORS[i] ?? "#adb5bd";
}

/** Alpha suffix for the arcs that are NOT being read. The ring sits on the card,
 *  so a translucent stop blends into the card's own colour. */
const DIMMED = "33";

/** How much of the ring's radius the hole takes up — .spend-pie-hole is 108 of
 *  the 168px ring, so the hole ends at 64% of the radius. Kept slightly under
 *  that so the innermost pixels of an arc still answer. */
const HOLE_FRACTION = 0.62;

/** Which slice the point (nx, ny) — both 0–1 inside the ring's box — falls in,
 *  or null for the hole in the middle and for the corners outside the circle.
 *
 *  The angle is measured the way `conic-gradient` draws: 0° at twelve o'clock,
 *  clockwise. Any remainder past the last boundary maps to the last slice,
 *  because shares rounded upstream may sum to slightly under 1 and the gradient
 *  stretches its final stop to 100% for exactly the same reason.
 *
 *  Pure, so the ring's geometry is testable without a layout engine. */
export function sliceAtPoint(shares: readonly number[], nx: number, ny: number): number | null {
  if (shares.length === 0) return null;
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  const dist = Math.hypot(dx, dy) * 2; // 0 in the centre, 1 at the ring's edge
  if (dist < HOLE_FRACTION || dist > 1) return null;
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  let at = 0;
  for (let i = 0; i < shares.length; i++) {
    at += shares[i] * 360;
    if (deg < at) return i;
  }
  return shares.length - 1;
}

export type SpendPieProps = {
  slices: readonly CategorySlice[];
  totalCents: number;
  /** How the caller formats euros — passed in so this file holds no locale. */
  euro: (cents: number) => string;
  /** Slices beyond this are summed into "Overig", so the ring stays readable and
   *  the legend stays short. */
  maxSlices?: number;
  onSelect?: (category: string) => void;
};

export default function SpendPie({ slices, totalCents, euro, maxSlices = 8, onSelect }: SpendPieProps) {
  // Which slice is being asked about — by hover, by focus, or by a tap on the
  // ring. null means nobody asked, and then the hole shows the total.
  const [active, setActive] = useState<number | null>(null);

  if (slices.length === 0 || totalCents <= 0) return null;

  const head = slices.slice(0, maxSlices);
  const tail = slices.slice(maxSlices);
  const shown =
    tail.length > 0
      ? [
          ...head,
          {
            category: "Overig",
            cents: tail.reduce((s, t) => s + t.cents, 0),
            share: tail.reduce((s, t) => s + t.share, 0),
          },
        ]
      : head;

  const reading = active !== null ? (shown[active] ?? null) : null;

  // Build the gradient as cumulative stops. Rounding each boundary to two
  // decimals keeps the string short without a visible seam.
  let at = 0;
  const stops = shown.map((s, i) => {
    const from = at;
    at += s.share * 100;
    const to = i === shown.length - 1 ? 100 : Math.round(at * 100) / 100;
    const colour = reading === null || i === active ? sliceColor(i) : `${sliceColor(i)}${DIMMED}`;
    return `${colour} ${Math.round(from * 100) / 100}% ${to}%`;
  });

  function pickArc(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setActive(
      sliceAtPoint(
        shown.map((s) => s.share),
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      ),
    );
  }

  return (
    <div className="spend-pie">
      <div
        className="spend-pie-ring"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
        role="img"
        aria-label={shown.map((s) => `${s.category} ${Math.round(s.share * 100)}%`).join(", ")}
        data-active={active === null ? "none" : String(active)}
        onPointerMove={pickArc}
        onPointerDown={pickArc}
        onPointerLeave={() => setActive(null)}
      >
        {/* The middle says either what the whole period cost, or — when an arc
            or a row is being read — what THAT slice cost and how much of the
            period it is. A bare euro amount in the middle of a ring would
            otherwise be read as the total it is sitting in. */}
        <div className="spend-pie-hole">
          {reading ? (
            <>
              <div className="spend-pie-slice">{reading.category}</div>
              <div className="spend-pie-total">{euro(reading.cents)}</div>
              {/* "van totaal" and not "van de uitgaven": the phrase has to fit
                  on one line inside a 108px hole, and the caption it replaces
                  already said "uitgaven" one state ago. */}
              <div className="spend-pie-caption spend-pie-share-of">
                {Math.round(reading.share * 100)}% van totaal
              </div>
            </>
          ) : (
            <>
              <div className="spend-pie-total">{euro(totalCents)}</div>
              <div className="spend-pie-caption">uitgaven</div>
            </>
          )}
        </div>
      </div>
      <ul className="spend-pie-legend">
        {shown.map((s, i) => {
          // "Overig" is several categories, so there is nothing to filter to; it
          // is still a button, because reading it — and lighting up its arc —
          // is an action of its own.
          const filters = onSelect !== undefined && s.category !== "Overig";
          return (
            <li key={s.category}>
              {/* The whole row is the target, not just the label: a 4%-slice is
                  impossible to hit on the ring itself. */}
              <button
                type="button"
                className="spend-pie-item"
                data-filter={filters ? "yes" : "no"}
                data-active={active === i ? "on" : "off"}
                onClick={filters ? () => onSelect?.(s.category) : undefined}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={(e: ReactPointerEvent<HTMLButtonElement>) => {
                  if (e.pointerType === "mouse") setActive(null);
                }}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
              >
                <span className="spend-pie-swatch" style={{ background: sliceColor(i) }} aria-hidden="true" />
                <span className="spend-pie-name">{s.category}</span>
                <span className="spend-pie-value">{euro(s.cents)}</span>
                <span className="spend-pie-share">{Math.round(s.share * 100)}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
