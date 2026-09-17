/* The reference's coloured Δ pill ("↗ 2.03%"), shared by the blocks that show a
 * change.
 *
 * The caller says which direction is good, so more income and more spending are
 * never both green. A null percentage renders NOTHING: there was no earlier
 * figure to compare against, and printing "0%" would claim a measured "no
 * change" that was never measured. */

/* First component on Tailwind (see docs/adr/0005). The 3px/10px padding and the
 * 0.78rem size have no token, so they stay literal rather than being rounded to
 * the nearest one and quietly resizing. The tints come from --pos-tint and
 * --neg-tint; see tokens.css for why not `bg-pos/12`.
 *
 * data-testid, because the tests used to assert on the class name "delta-pill".
 * A test coupled to a class breaks on every restyle and says nothing about
 * behaviour — across 48 components that is the difference between a migration
 * and a rewrite of the suite. The handle is stable; the styling is not. */
const BASE =
  "inline-flex items-center gap-1 rounded-pill px-[10px] py-[3px] " +
  "text-[0.78rem] font-semibold tabular-nums";

type DeltaPillProps = {
  /** Change in percent, or null when there is nothing to compare against. */
  pct: number | null;
  upIsGood: boolean;
};

export default function DeltaPill({ pct, upIsGood }: DeltaPillProps) {
  if (pct === null) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) return (
      <span data-testid="delta-pill" data-delta="flat" className={`${BASE} bg-surface-2 text-muted`}>
        0%
      </span>
    );
  const up = rounded > 0;
  /* Money semantics, not chart semantics: the caller decides which way is good,
   * so a rising balance and a rising cost do not get the same colour. */
  const good = up === upIsGood;
  return (
    <span
      data-testid="delta-pill"
      data-delta={good ? "good" : "bad"}
      className={`${BASE} ${good ? "bg-pos-tint text-pos" : "bg-neg-tint text-neg"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}
