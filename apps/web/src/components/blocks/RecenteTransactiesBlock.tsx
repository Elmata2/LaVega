import { useMemo, useState } from "react";
import type { Account, OwnAccounts, Rule, Tx } from "@lavega/core";
import { categorize, enrichTxs } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";
import { dayLabelNL } from "./dates.js";

/* Recente transacties — `desktop homeview inspo.png`: the counterparty, the
 * date, our category chip, a search, and "bekijk alles".
 *
 * Two deliberate departures from the reference:
 *
 *  - NO merchant logo, and no monogram standing in for one. A real logo means a
 *    remote image request per merchant, which tells whoever hosts those images
 *    exactly who Alexander pays, every time he opens the homescreen — refused
 *    on principle, not on effort. The monogram that stood in for it is gone
 *    too: two letters derived from the counterparty carry nothing the name
 *    printed beside them does not already carry, so it was decoration that cost
 *    a column. The name gets that column.
 *  - The reference prints a TIME per row ("07 Feb, 11:18 AM"). Bank exports
 *    (MT940, CAMT.053, every CSV profile) carry a booking DATE and no clock
 *    time, so LaVega does not know it and prints the date alone — never an
 *    invented "00:00".
 *
 * The chip is the category LaVega derived (a manual label, a user rule, or a
 * Dutch default); clicking it filters the transaction list by that category. */

const ROWS = 7;

/** Does this row match what was typed? Counterparty, description and the
 *  derived category, case-insensitively. */
export function matchesSearch(
  row: { counterparty: string; description: string; category: string },
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  return `${row.counterparty} ${row.description} ${row.category}`.toLowerCase().includes(needle);
}

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
  const [query, setQuery] = useState("");

  const all = useMemo(
    () =>
      enrichTxs(txs, accounts)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((t) => ({ tx: t, category: categorize(t, rules, own) })),
    [txs, accounts, rules, own],
  );

  const matched = useMemo(
    () => all.filter(({ tx, category }) => matchesSearch({ ...tx, category }, query)),
    [all, query],
  );
  const recent = matched.slice(0, ROWS);

  return (
    <Module
      title="Recente transacties"
      span={2}
      height="tall"
      period={
        <input
          type="search"
          className="tx-search"
          placeholder="Zoek op naam of categorie"
          aria-label="Zoek in recente transacties"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("transactions")}>
          Bekijk alles →
        </button>
      }
    >
      {all.length === 0 ? (
        <p className="block-empty">Nog geen transacties.</p>
      ) : recent.length === 0 ? (
        <p className="block-empty">Geen transactie gevonden voor “{query.trim()}”.</p>
      ) : (
        <div className="tx-list">
          {recent.map(({ tx, category }) => {
            const name = tx.counterparty || tx.description || "Onbekende tegenpartij";
            return (
              <div className="tx-row" key={tx.id}>
                <div className="tx-row-info">
                  <div className="tx-desc">{name}</div>
                  <div className="eyebrow tx-meta">
                    {dayLabelNL(tx.date)}
                    {/* Where the account sits is context, not identity. On a
                        phone it is what gives way so the merchant name and the
                        amount keep their line. */}
                    <span className="tx-meta-extra">
                      {" · "}
                      {tx.entity} · {tx.bank}
                    </span>
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
            );
          })}
        </div>
      )}
    </Module>
  );
}
