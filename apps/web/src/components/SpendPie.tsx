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

  // Build the gradient as cumulative stops. Rounding each boundary to two
  // decimals keeps the string short without a visible seam.
  let at = 0;
  const stops = shown.map((s, i) => {
    const from = at;
    at += s.share * 100;
    const to = i === shown.length - 1 ? 100 : Math.round(at * 100) / 100;
    return `${sliceColor(i)} ${Math.round(from * 100) / 100}% ${to}%`;
  });

  return (
    <div className="spend-pie">
      <div
        className="spend-pie-ring"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
        role="img"
        aria-label={shown.map((s) => `${s.category} ${Math.round(s.share * 100)}%`).join(", ")}
      >
        <div className="spend-pie-hole">
          <div className="spend-pie-total">{euro(totalCents)}</div>
          <div className="spend-pie-caption">uitgaven</div>
        </div>
      </div>
      <ul className="spend-pie-legend">
        {shown.map((s, i) => (
          <li key={s.category}>
            {/* The whole row is the target, not just the label: a 4%-slice is
                impossible to hit on the ring itself. "Overig" is not clickable —
                it is several categories, so there is nothing to filter to. */}
            {onSelect && s.category !== "Overig" ? (
              <button type="button" className="spend-pie-item" onClick={() => onSelect(s.category)}>
                <span className="spend-pie-swatch" style={{ background: sliceColor(i) }} aria-hidden="true" />
                <span className="spend-pie-name">{s.category}</span>
                <span className="spend-pie-value">{euro(s.cents)}</span>
                <span className="spend-pie-share">{Math.round(s.share * 100)}%</span>
              </button>
            ) : (
              <span className="spend-pie-item">
                <span className="spend-pie-swatch" style={{ background: sliceColor(i) }} aria-hidden="true" />
                <span className="spend-pie-name">{s.category}</span>
                <span className="spend-pie-value">{euro(s.cents)}</span>
                <span className="spend-pie-share">{Math.round(s.share * 100)}%</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
