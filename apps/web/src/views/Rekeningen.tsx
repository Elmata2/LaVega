import { useEffect, useState } from "react";
import type { Account, Tx } from "@lavega/core";
import { accountSummaries, isCardAccount, accountType, ACCOUNT_TYPES } from "@lavega/core";

type RekeningenProps = {
  accounts: Account[];
  txs: Tx[];
  busy: boolean;
  onEntityChange: (key: string, newEntity: string) => void;
  onEntityCommit: (account: Account) => void;
  onSaldoCommit: (key: string, value: string) => void;
  onTypeCommit: (key: string, type: string) => void;
};

/** Editable current-saldo cell. CSV imports carry no balance, so the owner types
 *  it in from their bankapp; MT940/.STA fills it automatically but can be
 *  overridden. Holds a free-form draft string while typing (so "-", "1," etc.
 *  don't fight a controlled number input) and commits on blur — the parse +
 *  persist happens in App. Blank commits back to "onbekend" (null). */
function SaldoCell({ account, busy, onCommit }: { account: Account; busy: boolean; onCommit: (key: string, value: string) => void }) {
  // A credit card stores a NEGATIVE balance (debt) but the user types/reads the
  // amount OWED as a positive — show the absolute value in the field for cards.
  const card = isCardAccount(account);
  const shown = (b: number) => (card ? Math.abs(b) : b);
  const [draft, setDraft] = useState(account.balance === null ? "" : String(shown(account.balance)));
  // Resync when the balance changes elsewhere (re-import, reset) and we're not editing it.
  useEffect(() => {
    setDraft(account.balance === null ? "" : String(card ? Math.abs(account.balance) : account.balance));
  }, [account.balance, card]);
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
        aria-label={card ? `Openstaand bedrag ${account.name}` : `Saldo ${account.name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(account.key, draft)}
        disabled={busy}
      />
      {card && <span className="eyebrow"> schuld</span>}
    </>
  );
}

export default function Rekeningen({ accounts, txs, busy, onEntityChange, onEntityCommit, onSaldoCommit, onTypeCommit }: RekeningenProps) {
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
                <th>Type</th>
                <th>Entiteit</th>
                <th className="num">Saldo</th>
                <th className="num">Transacties</th>
              </tr>
            </thead>
            <tbody>
              {accountSummaries(accounts, txs).map(({ account, txCount }) => {
                const type = accountType(account);
                return (
                  <tr key={account.key}>
                    <td>
                      {account.bank ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{account.bank}</div>
                          <div className="cell-sub">{account.name}</div>
                        </>
                      ) : (
                        <div style={{ fontWeight: 600 }}>{account.name || "—"}</div>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label={`Type ${account.name}`}
                        value={type}
                        onChange={(e) => onTypeCommit(account.key, e.target.value)}
                        disabled={busy}
                      >
                        {!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number]) && (
                          <option value={type}>{type}</option>
                        )}
                        {ACCOUNT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={account.entity}
                        placeholder="—"
                        onChange={(e) => onEntityChange(account.key, e.target.value)}
                        onBlur={() => void onEntityCommit(account)}
                        disabled={busy}
                      />
                    </td>
                    <td className="num">
                      <SaldoCell account={account} busy={busy} onCommit={onSaldoCommit} />
                    </td>
                    <td className="num">{txCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
