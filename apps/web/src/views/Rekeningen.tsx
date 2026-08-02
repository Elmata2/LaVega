import { useEffect, useState } from "react";
import type { Account, Tx } from "@lavega/core";
import { accountSummaries } from "@lavega/core";

type RekeningenProps = {
  accounts: Account[];
  txs: Tx[];
  busy: boolean;
  onEntityChange: (key: string, newEntity: string) => void;
  onEntityCommit: (account: Account) => void;
  onSaldoCommit: (key: string, value: string) => void;
};

/** Editable current-saldo cell. CSV imports carry no balance, so the owner types
 *  it in from their bankapp; MT940/.STA fills it automatically but can be
 *  overridden. Holds a free-form draft string while typing (so "-", "1," etc.
 *  don't fight a controlled number input) and commits on blur — the parse +
 *  persist happens in App. Blank commits back to "onbekend" (null). */
function SaldoCell({ account, busy, onCommit }: { account: Account; busy: boolean; onCommit: (key: string, value: string) => void }) {
  const [draft, setDraft] = useState(account.balance === null ? "" : String(account.balance));
  // Resync when the balance changes elsewhere (re-import, reset) and we're not editing it.
  useEffect(() => {
    setDraft(account.balance === null ? "" : String(account.balance));
  }, [account.balance]);
  const cls = account.balance === null ? "" : account.balance >= 0 ? " text-pos" : " text-neg";
  return (
    <>
      <span
        className={`dot${account.balance === null ? "" : account.balance >= 0 ? " dot-pos" : " dot-neg"}`}
        aria-hidden="true"
      />{" "}
      <input
        className={`saldo-input${cls}`}
        inputMode="decimal"
        placeholder="onbekend"
        aria-label={`Saldo ${account.name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(account.key, draft)}
        disabled={busy}
      />
    </>
  );
}

export default function Rekeningen({ accounts, txs, busy, onEntityChange, onEntityCommit, onSaldoCommit }: RekeningenProps) {
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
                    <SaldoCell account={account} busy={busy} onCommit={onSaldoCommit} />
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
