/* The reference's coloured Δ pill ("↗ 2.03%"), shared by the blocks that show a
 * change.
 *
 * The caller says which direction is good, so more income and more spending are
 * never both green. A null percentage renders NOTHING: there was no earlier
 * figure to compare against, and printing "0%" would claim a measured "no
 * change" that was never measured. */

type DeltaPillProps = {
  /** Change in percent, or null when there is nothing to compare against. */
  pct: number | null;
  upIsGood: boolean;
};

export default function DeltaPill({ pct, upIsGood }: DeltaPillProps) {
  if (pct === null) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) return <span className="delta-pill delta-flat">0%</span>;
  const up = rounded > 0;
  const good = up === upIsGood;
  return (
    <span className={`delta-pill ${good ? "delta-up" : "delta-down"}`}>
      {up ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}
