import { useMemo } from "react";
import type { Account, OwnAccounts, Rule, Tx } from "@lavega/core";
import { categorize, enrichTxs } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";

/* Recente transacties — the newest transactions with the reference's per-row
 * category chip. The chip is the category LaVega derived (a manual label, a
 * user rule, or a Dutch default), and clicking it filters the transaction
 * list by that category — the same jump the Top uitgaven block makes. */

const ROWS = 7;

type RecenteTransactiesBlockProps = {
  txs: Tx[];
  accounts: Account[];
  rules: Rule[];
  own: OwnAccounts;
  onNavigate: (view: View) => void;
  onSelectCategory: (category: string) => void;
};

export default function RecenteTransactiesBlock({
  txs,
  accounts,
  rules,
  own,
  onNavigate,
  onSelectCategory,
}: RecenteTransactiesBlockProps) {
  const recent = useMemo(
    () =>
      enrichTxs(txs, accounts)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, ROWS)
        .map((t) => ({ tx: t, category: categorize(t, rules, own) })),
    [txs, accounts, rules, own],
  );

  return (
    <Module
      title="Recente transacties"
      span={2}
      height="tall"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("transactions")}>
          Alle →
        </button>
      }
    >
      {recent.length === 0 ? (
        <p className="block-empty">Nog geen transacties.</p>
      ) : (
        <div className="tx-list">
          {recent.map(({ tx, category }) => (
            <div className="tx-row" key={tx.id}>
              <div className="tx-row-info">
                <div className="tx-desc">{tx.description || tx.counterparty}</div>
                <div className="eyebrow">
                  {tx.entity} · {tx.bank} · {tx.date}
                </div>
              </div>
              <div className="tx-row-right">
                <button
                  type="button"
                  className="tx-chip tx-chip-button"
                  title={`Bekijk transacties in ${category}`}
                  onClick={() => onSelectCategory(category)}
                >
                  {category}
                </button>
                <span className={`tx-amount ${tx.amount >= 0 ? "text-pos" : "text-neg"}`}>
                  {formatEuro(tx.amount)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Module>
  );
}
