import { useEffect, useState } from "react";
import type { Account, Tx, DuplicateGroup } from "@lavega/core";
import { accountSummaries, isCardAccount, accountType, ACCOUNT_TYPES } from "@lavega/core";

type RekeningenProps = {
  accounts: Account[];
  txs: Tx[];
  busy: boolean;
  onEntityChange: (key: string, newEntity: string) => void;
  /** Persist one account after an inline edit (entity, bank, name). */
  onAccountCommit: (account: Account) => void;
  /** Patch an account in memory while typing; committed on blur. */
  onAccountFieldChange: (key: string, patch: Partial<Account>) => void;
  onSaldoCommit: (key: string, value: string) => void;
  onTypeCommit: (key: string, type: string) => void;
  /** Open this account's transactions (transactions has no own nav item — it's
   *  reached from here and from the Overzicht category totals). */
  onSelectAccount: (accountKey: string) => void;
  /** Remove the account AND its transactions. Confirmed inline first. */
  onDeleteAccount: (key: string) => void;
  /** Accounts that look like the same real account imported twice. Computed on
   *  the FULL list in App; only groups touching the current scope are shown. */
  duplicateGroups: DuplicateGroup[];
  onMergeDuplicates: (survivorKey: string, duplicateKey: string) => void;
};

/** A destructive action is never one click: the button swaps into a
 *  "Weet je het zeker? Ja / Nee" prompt in place, and only "Ja" fires it. */
function ConfirmAction({ label, question, busy, onConfirm }: { label: string; question: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="card-link card-link-danger" onClick={() => setAsking(true)} disabled={busy}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <span className="confirm-q">{question}</span>
      <button
        type="button"
        className="card-link card-link-danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        disabled={busy}
      >
        Ja
      </button>
      <button type="button" className="card-link" onClick={() => setAsking(false)} disabled={busy}>
        Nee
      </button>
    </span>
  );
}

/** Label an account the way the table does, so the banner names it recognisably. */
function accountLabel(a: Account): string {
  return [a.bank, a.name || a.key].filter(Boolean).join(" ");
}

/** Editable bank + name. Statements don't always carry a bank — the older ING
 *  savings exports came in with the account NUMBER as the name and no bank at
 *  all, which leaves them out of the rate comparison and the travel ranking
 *  (both key on the bank). Same draft-then-commit-on-blur shape as Entiteit:
 *  one write per edit, in order. */
function NameCell({ account, busy, onFieldChange, onCommit }: {
  account: Account;
  busy: boolean;
  onFieldChange: (key: string, patch: Partial<Account>) => void;
  onCommit: (account: Account) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <>
        {account.bank ? (
          <>
            <div style={{ fontWeight: 600 }}>{account.bank}</div>
            <div className="cell-sub">{account.name}</div>
          </>
        ) : (
          <div style={{ fontWeight: 600 }}>{account.name || "—"}</div>
        )}
        <button type="button" className="card-link" onClick={() => setEditing(true)} disabled={busy}>
          {account.bank ? "Hernoem" : "Bank invullen"}
        </button>
      </>
    );
  }
  return (
    <div className="rename-cell">
      <input
        aria-label={`Bank van ${account.name || account.key}`}
        placeholder="Bank, bijv. ING"
        value={account.bank}
        onChange={(e) => onFieldChange(account.key, { bank: e.target.value, renamed: true })}
        onBlur={() => onCommit(account)}
        disabled={busy}
      />
      <input
        aria-label={`Naam van ${account.name || account.key}`}
        placeholder="Naam, bijv. Oranje Spaarrekening"
        value={account.name}
        onChange={(e) => onFieldChange(account.key, { name: e.target.value, renamed: true })}
        onBlur={() => onCommit(account)}
        disabled={busy}
      />
      <button type="button" className="card-link" onClick={() => setEditing(false)} disabled={busy}>
        Klaar
      </button>
    </div>
  );
}

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

export default function Rekeningen({ accounts, txs, busy, onEntityChange, onAccountCommit, onAccountFieldChange, onSaldoCommit, onTypeCommit, onSelectAccount, onDeleteAccount, duplicateGroups, onMergeDuplicates }: RekeningenProps) {
  // Only flag duplicates you can actually see here — a group whose accounts all
  // sit outside the active entity scope would be a banner about nothing.
  const visibleKeys = new Set(accounts.map((a) => a.key));
  const shownGroups = duplicateGroups.filter((g) => g.accounts.some((a) => visibleKeys.has(a.key)));

  return (
    <section className="card" aria-label="Rekeningen">
      <h2>Rekeningen</h2>

      {shownGroups.map((group) => {
        const others = group.accounts.filter((a) => a.key !== group.survivor.key);
        return (
          <div className="dup-banner" key={group.canonicalId}>
            <div>
              <p className="dup-banner-title">
                Deze rekeningen lijken dezelfde rekening: {group.accounts.map(accountLabel).join(", ")}.
              </p>
              <p className="dup-banner-sub">
                LaVega houdt <strong>{accountLabel(group.survivor)}</strong> aan en verplaatst de transacties
                daarheen. Overlappende periodes worden samengevoegd, niet dubbel geteld.
              </p>
            </div>
            <div className="dup-banner-actions">
              {others.map((dup) => (
                <ConfirmAction
                  key={dup.key}
                  label={others.length > 1 ? `Samenvoegen: ${accountLabel(dup)}` : "Samenvoegen"}
                  question={`${accountLabel(dup)} samenvoegen met ${accountLabel(group.survivor)}?`}
                  busy={busy}
                  onConfirm={() => onMergeDuplicates(group.survivor.key, dup.key)}
                />
              ))}
            </div>
          </div>
        );
      })}

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
                <th />
              </tr>
            </thead>
            <tbody>
              {accountSummaries(accounts, txs).map(({ account, txCount }) => {
                const type = accountType(account);
                return (
                  <tr key={account.key}>
                    <td>
                      <NameCell
                        account={account}
                        busy={busy}
                        onFieldChange={onAccountFieldChange}
                        onCommit={onAccountCommit}
                      />
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
                        onBlur={() => void onAccountCommit(account)}
                        disabled={busy}
                      />
                    </td>
                    <td className="num">
                      <SaldoCell account={account} busy={busy} onCommit={onSaldoCommit} />
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="card-link"
                        onClick={() => onSelectAccount(account.key)}
                        title={`Bekijk transacties van ${account.name}`}
                        disabled={txCount === 0}
                      >
                        {txCount}
                      </button>
                    </td>
                    <td className="num">
                      <ConfirmAction
                        label="Verwijder"
                        question={
                          txCount === 0
                            ? `${account.name || account.key} verwijderen?`
                            : `${account.name || account.key} en ${txCount} ${txCount === 1 ? "transactie" : "transacties"} verwijderen?`
                        }
                        busy={busy}
                        onConfirm={() => onDeleteAccount(account.key)}
                      />
                    </td>
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
