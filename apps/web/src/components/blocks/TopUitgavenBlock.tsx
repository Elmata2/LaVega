import { useMemo } from "react";
import type { CategoryComparison, OwnAccounts, Rule, Tx } from "@lavega/core";
import { categoryComparison } from "@lavega/core";
import { formatEuroIn, monthLabel } from "../../format.js";
import Module from "../Module.js";
import { useAppLocale } from "../../appLocale.js";
import { moneyCopy } from "../../copy/money.js";

/* Top uitgaven — where the latest month's money went, biggest category first:
 * its share of the month's spend, the amount, and — only when the two months
 * can honestly be compared — the change vs. the month before. Own transfers are
 * excluded by categoryComparison (moving money between your own accounts isn't
 * spending).
 *
 * The comparison is why this block was rewritten. A month-on-month percentage
 * silently assumes both months cover the same accounts. Import ABN for Jan–Aug
 * and Amex for August only, and August carries a whole extra card that July
 * never had: a large, entirely fictional "increase" that reads as a fact. That
 * is the ~€24.000 rise Alexander did not believe, and he was right.
 *
 * Deciding whether the two months are comparable is packages/core's job — it
 * holds the transactions and their accounts, and a second implementation here
 * would be a second answer to the same question. This block consumes core's
 * `coverage` (which accounts cover BOTH months, what was left out) and its
 * `current` / `previous` month coverage (how much of each month was observed),
 * and renders them:
 *
 *   comparable: false  → no percentages at all, and the reason in words.
 *   accounts excluded  → the delta stands, with what it leaves out named.
 *   current.partial    → the delta stands, with "11 van 31 dagen" beside it.
 *
 * Nothing here recomputes any of that. */

const ROWS = 6;

/** Change vs. last month. For an expense, up = spending more (terracotta),
 *  down = spending less (green); a brand-new category shows "nieuw". Only ever
 *  rendered when core says the two months are comparable. */
function CategoryDelta({ changePct }: { changePct: number | null }) {
  const [locale] = useAppLocale();
  if (changePct === null)
    return <span className="cat-delta flat">{moneyCopy[locale].topUitgaven.nieuwDelta}</span>;
  const rounded = Math.round(changePct);
  if (rounded === 0) return <span className="cat-delta flat">0%</span>;
  const up = rounded > 0;
  return (
    <span className={`cat-delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}

type TopUitgavenViewProps = {
  comparison: CategoryComparison;
  onSelectCategory: (category: string) => void;
};

/** The block's rendering, given a comparison. Split out so core's verdict can
 *  be handed straight in — including the verdict "these two months cannot be
 *  compared", which is the case the block exists to get right. */
export function TopUitgavenView({ comparison, onSelectCategory }: TopUitgavenViewProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].topUitgaven;
  const { coverage, current } = comparison;
  const rows = comparison.rows.slice(0, ROWS);
  const month = monthLabel(locale, comparison.month);
  const prev = monthLabel(locale, comparison.prevMonth);
  const excluded = coverage.excludedAccountKeys.length;
  const excludedOut = coverage.excludedOut.current + coverage.excludedOut.previous;

  // Nothing imported at all — not a comparison problem, an empty vault.
  if (comparison.month === "") {
    return (
      <Module title={c.title} height="tall">
        <p className="block-empty">{c.nogGeenUitgavenDezeMaand}</p>
      </Module>
    );
  }

  if (!coverage.comparable) {
    // Core found no account with data in both months, so it returned no rows:
    // there is no like-for-like figure to print, and an approximate one would
    // be read as an exact one.
    return (
      <Module title={c.title} height="tall" footer={<>{c.maandTOvPrev(month, prev)}</>}>
        <p className="cat-nocompare">
          {c.nietVergelijkbaar(month, prev)}
          {excludedOut > 0 && <>{c.erStaatWelUitgaven(formatEuroIn(locale, excludedOut))}</>}
        </p>
        <p className="block-empty">{c.importeerBeideMaanden}</p>
      </Module>
    );
  }

  return (
    <Module
      title={c.title}
      height="tall"
      footer={rows.length > 0 ? <>{c.aandeelEnDeltaTOv(month, prev)}</> : undefined}
    >
      {rows.length === 0 ? (
        <p className="block-empty">{c.nogGeenUitgavenDezeMaand}</p>
      ) : (
        <>
          {(current.partial || excluded > 0) && (
            // The comparison holds, but not without qualification — and the
            // qualification is stated next to it, not left for him to guess.
            <p className="cat-nocompare">
              {current.partial && (
                <>{c.telDagenTotNuToe(month, current.daysObserved, current.daysInMonth)}</>
              )}
              {current.partial && excluded > 0 && " "}
              {excluded > 0 && (
                <>{c.rekeningenBuitenVergelijking(excluded, formatEuroIn(locale, excludedOut))}</>
              )}
            </p>
          )}
          <div className="cat-list">
            {rows.map((r) => (
              <div className="cat-row" key={r.category}>
                <div className="cat-row-top">
                  <button
                    type="button"
                    className="card-link"
                    onClick={() => onSelectCategory(r.category)}
                    title={c.bekijkTransactiesIn(r.category)}
                  >
                    {r.category}
                  </button>
                  <span className="cat-fig">
                    <span className="cat-share">{r.sharePct.toFixed(0)}%</span>
                    <span className="cat-amt">{formatEuroIn(locale, r.out)}</span>
                    <CategoryDelta changePct={r.changePct} />
                  </span>
                </div>
                <div className="cat-bar">
                  <div
                    className="cat-bar-fill"
                    style={{ width: `${Math.min(100, r.sharePct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Module>
  );
}

type TopUitgavenBlockProps = {
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  onSelectCategory: (category: string) => void;
};

export default function TopUitgavenBlock({
  txs,
  rules,
  own,
  onSelectCategory,
}: TopUitgavenBlockProps) {
  const comparison = useMemo(() => categoryComparison(txs, rules, own), [txs, rules, own]);
  return <TopUitgavenView comparison={comparison} onSelectCategory={onSelectCategory} />;
}
