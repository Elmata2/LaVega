import type { Account, Tx } from "@lavega/core";
import { accountSummaries } from "@lavega/core";
import { formatEuro } from "../format";

type RekeningenProps = {
  accounts: Account[];
  txs: Tx[];
  busy: boolean;
  onEntityChange: (key: string, newEntity: string) => void;
  onEntityCommit: (account: Account) => void;
};

export default function Rekeningen({ accounts, txs, busy, onEntityChange, onEntityCommit }: RekeningenProps) {
  return (
    <section className="card" aria-label="Rekeningen">
      <h2>Rekeningen</h2>
      {accounts.length === 0 ? (
        <p>Nog geen rekeningen — importeer eerst een bestand.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bank</th>
                <th>Rekening</th>
                <th>Entiteit</th>
                <th>Saldo</th>
                <th>Transacties</th>
              </tr>
            </thead>
            <tbody>
              {accountSummaries(accounts, txs).map(({ account, txCount }) => (
                <tr key={account.key}>
                  <td>{account.bank}</td>
                  <td>{account.name}</td>
                  <td>
                    <input
                      value={account.entity}
                      onChange={(e) => onEntityChange(account.key, e.target.value)}
                      onBlur={() => void onEntityCommit(account)}
                      disabled={busy}
                    />
                  </td>
                  <td>
                    <span
                      className={`dot${account.balance === null ? "" : account.balance >= 0 ? " dot-pos" : " dot-neg"}`}
                      aria-hidden="true"
                    />{" "}
                    <span className={account.balance === null ? "" : account.balance >= 0 ? "text-pos" : "text-neg"}>
                      {account.balance === null ? "onbekend" : formatEuro(account.balance)}
                    </span>
                  </td>
                  <td>{txCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
