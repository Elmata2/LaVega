import { useMemo } from "react";
import type { OwnAccounts, Rule, Tx } from "@lavega/core";
import { categoryComparison } from "@lavega/core";
import { formatEuro, monthLabelNL } from "../../format.js";
import Module from "../Module.js";

/* Top uitgaven — where the latest month's money went, biggest category first:
 * its share of the month's spend, the amount, and the change vs. the month
 * before. Own transfers are excluded by categoryComparison (moving money
 * between your own accounts isn't spending).
 *
 * "vs. gem." hands the question to the LaVega assistant, which is the only
 * place a Dutch household average can come from — LaVega holds no benchmark. */

const ROWS = 6;

/** Change vs. last month. For an expense, up = spending more (terracotta),
 *  down = spending less (green); a brand-new category shows "nieuw". */
function CategoryDelta({ changePct }: { changePct: number | null }) {
  if (changePct === null) return <span className="cat-delta flat">nieuw</span>;
  const rounded = Math.round(changePct);
  if (rounded === 0) return <span className="cat-delta flat">0%</span>;
  const up = rounded > 0;
  return (
    <span className={`cat-delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}

type TopUitgavenBlockProps = {
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  onSelectCategory: (category: string) => void;
  /** Push a pre-filled question into the LaVega assistant. */
  onAsk: (text: string) => void;
};

export default function TopUitgavenBlock({ txs, rules, own, onSelectCategory, onAsk }: TopUitgavenBlockProps) {
  const comparison = useMemo(() => categoryComparison(txs, rules, own), [txs, rules, own]);
  const rows = comparison.rows.slice(0, ROWS);

  return (
    <Module
      title="Top uitgaven"
      height="tall"
      footer={
        rows.length > 0 ? (
          <>
            {monthLabelNL(comparison.month)} · aandeel &amp; Δ t.o.v. {monthLabelNL(comparison.prevMonth)}
          </>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="block-empty">Nog geen uitgaven deze maand.</p>
      ) : (
        <div className="cat-list">
          {rows.map((r) => (
            <div className="cat-row" key={r.category}>
              <div className="cat-row-top">
                <button
                  type="button"
                  className="card-link"
                  onClick={() => onSelectCategory(r.category)}
                  title={`Bekijk transacties in ${r.category}`}
                >
                  {r.category}
                </button>
                <span className="cat-fig">
                  <span className="cat-share">{r.sharePct.toFixed(0)}%</span>
                  <span className="cat-amt">{formatEuro(r.out)}</span>
                  <CategoryDelta changePct={r.changePct} />
                  <button
                    type="button"
                    className="cat-compare"
                    title={`Vergelijk "${r.category}" met het Nederlandse gemiddelde (via de assistent)`}
                    onClick={() =>
                      onAsk(
                        `Geef ik meer of minder uit aan "${r.category}" dan een gemiddeld Nederlands huishouden? ` +
                          `Mijn uitgave in ${monthLabelNL(comparison.month)}: ${formatEuro(r.out)}. ` +
                          `Zoek een actueel gemiddelde op (bijv. Nibud of CBS), vergelijk het met mijn bedrag en noem het verschil in %.`,
                      )
                    }
                  >
                    vs. gem.
                  </button>
                </span>
              </div>
              <div className="cat-bar">
                <div className="cat-bar-fill" style={{ width: `${Math.min(100, r.sharePct)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Module>
  );
}
