import { useMemo } from "react";
import type { Account, Rule, Tx } from "@lavega/core";
import { enrichTxs, filterTxs, categorize } from "@lavega/core";
import { formatEuro } from "../format";

type TransactiesProps = {
  accounts: Account[];
  scopedTxs: Tx[];
  rules: Rule[];
  entityOptions: string[];
  entityScope: string;
  fEntity: string;
  onFEntityChange: (entity: string) => void;
  fAccount: string;
  onFAccountChange: (accountKey: string) => void;
  fSearch: string;
  onFSearchChange: (search: string) => void;
  fFrom: string;
  onFFromChange: (from: string) => void;
  fTo: string;
  onFToChange: (to: string) => void;
};

export default function Transacties({
  accounts,
  scopedTxs,
  rules,
  entityOptions,
  entityScope,
  fEntity,
  onFEntityChange,
  fAccount,
  onFAccountChange,
  fSearch,
  onFSearchChange,
  fFrom,
  onFFromChange,
  fTo,
  onFToChange,
}: TransactiesProps) {
  const rows = useMemo(
    () =>
      filterTxs(enrichTxs(scopedTxs, accounts), {
        entity: fEntity || undefined,
        accountKey: fAccount || undefined,
        search: fSearch || undefined,
        from: fFrom || undefined,
        to: fTo || undefined,
      })
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [scopedTxs, accounts, fEntity, fAccount, fSearch, fFrom, fTo],
  );

  return (
    <section className="card" aria-label="Transacties">
      <h2>Transacties</h2>
      {/* Task-1 scope fix: with a top-bar entity scope active, this dropdown
          used to list ALL entities — picking an out-of-scope one silently
          yielded 0 rows with no explanation. The scope pill already constrains
          to that entity, so hide this filter while scoped; show it only for
          "Alle bedrijven" (entityScope === ""). */}
      {entityScope === "" && (
        <label>
          Entiteit{" "}
          <select value={fEntity} onChange={(e) => onFEntityChange(e.target.value)}>
            <option value="">Alle entiteiten</option>
            {entityOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      )}
      {" "}
      <label>
        Rekening{" "}
        <select value={fAccount} onChange={(e) => onFAccountChange(e.target.value)}>
          <option value="">Alle rekeningen</option>
          {accounts.map((a) => (
            <option key={a.key} value={a.key}>
              {a.bank} · {a.key}
            </option>
          ))}
        </select>
      </label>
      {" "}
      <label>
        Zoeken{" "}
        <input
          value={fSearch}
          onChange={(e) => onFSearchChange(e.target.value)}
          placeholder="Tegenpartij of omschrijving"
        />
      </label>
      {" "}
      <label>
        Van{" "}
        <input type="date" value={fFrom} onChange={(e) => onFFromChange(e.target.value)} />
      </label>
      {" "}
      <label>
        Tot{" "}
        <input type="date" value={fTo} onChange={(e) => onFToChange(e.target.value)} />
      </label>

      <p>{rows.length} transacties</p>

      {rows.length === 0 ? (
        <p>Geen transacties.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Tegenpartij</th>
                <th>Omschrijving</th>
                <th>Rekening</th>
                <th>Bedrag</th>
                <th>Entiteit</th>
                <th>Categorie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.counterparty}</td>
                  <td>{t.description}</td>
                  <td>{t.bank} · {t.accountKey}</td>
                  <td>
                    <span className={t.amount >= 0 ? "text-pos" : "text-neg"}>
                      {formatEuro(t.amount)}
                    </span>
                  </td>
                  <td>{t.entity}</td>
                  <td>{categorize(t, rules)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
