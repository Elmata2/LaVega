import { useEffect, useState } from "react";
import type { Account, AccountSummary, Tx, DuplicateGroup } from "@lavega/core";
import { accountSummaries, isCardAccount, accountType, ACCOUNT_TYPES } from "@lavega/core";
import { formatEuro } from "../format";
import "../styles/views.css";

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

/* ---------------------------------------------------------------------------
 * Grouping accounts under their bank — pure, so it is tested without a DOM.
 * ------------------------------------------------------------------------- */

/** Accounts whose statement never named a bank. Named, not hidden: they are the
 *  ones that fall out of the rate comparison and the travel ranking, so the
 *  group is also the prompt to fill the bank in. */
export const UNKNOWN_BANK = "Zonder bank";

export type BankGroup = {
  /** Normalised grouping key — the lowercased bank, "" when there is none. */
  id: string;
  /** What to print: the bank as the owner typed it, or UNKNOWN_BANK. */
  label: string;
  /** False for the "Zonder bank" group. */
  named: boolean;
  rows: AccountSummary[];
  /** Sum of the balances we actually hold, in euros. **Null when not one
   *  account in the group has a balance** — an unknown saldo is never summed as
   *  a zero, so a bank with nothing known shows no figure at all. */
  total: number | null;
  knownCount: number;
  unknownCount: number;
  txCount: number;
};

const rowLabel = (r: AccountSummary): string => r.account.name || r.account.key;

/** Group the account summaries under their bank.
 *
 *  `bankOf` exists for one reason: while the owner is typing a bank name into a
 *  row, `account.bank` changes on every keystroke, and grouping on it directly
 *  would move that row to a different group per letter — losing focus mid-word.
 *  The view therefore feeds a frozen reading of the bank while a rename is open.
 *
 *  Named banks come first, alphabetically; "Zonder bank" is always last.
 *  Balances are summed in integer cents to keep the euro total exact. */
export function groupAccountsByBank(
  rows: AccountSummary[],
  bankOf: (a: Account) => string = (a) => a.bank,
): BankGroup[] {
  const byId = new Map<string, { label: string; rows: AccountSummary[] }>();
  for (const r of rows) {
    const raw = (bankOf(r.account) ?? "").trim();
    const id = raw.toLowerCase();
    const g = byId.get(id) ?? { label: raw, rows: [] };
    g.rows.push(r);
    byId.set(id, g);
  }

  const groups: BankGroup[] = [...byId.entries()].map(([id, g]) => {
    const sorted = [...g.rows].sort((a, b) => rowLabel(a).localeCompare(rowLabel(b), "nl"));
    let cents = 0;
    let knownCount = 0;
    let txCount = 0;
    for (const r of sorted) {
      txCount += r.txCount;
      if (r.account.balance !== null) {
        cents += Math.round(r.account.balance * 100);
        knownCount += 1;
      }
    }
    return {
      id,
      label: id === "" ? UNKNOWN_BANK : g.label,
      named: id !== "",
      rows: sorted,
      total: knownCount === 0 ? null : cents / 100,
      knownCount,
      unknownCount: sorted.length - knownCount,
      txCount,
    };
  });

  return groups.sort((a, b) =>
    a.named === b.named ? a.label.localeCompare(b.label, "nl") : a.named ? -1 : 1,
  );
}

/* ---------------------------------------------------------------------------
 * The bank's mark. DRAWN HERE, NEVER FETCHED.
 *
 * A real logo would have to come off the bank's own server, and that request
 * tells that server which banks the owner holds — the whole local-first promise
 * traded for a decoration. So the identity is made from what we already have:
 * the bank's own name as a wordmark in the display face, over a tile whose tone
 * is picked deterministically from the existing token palette. It is LaVega's
 * mark for that bank, not the bank's brand: same bank, same tile, every time,
 * with nothing leaving the machine.
 *
 * The tones are the non-semantic tokens only. --pos/--neg/--warn are reserved
 * for money in / money out / attention, and a bank tile in "money out" red
 * would read as a judgement about that bank.
 * ------------------------------------------------------------------------- */

const MARK_TONES = ["a", "b", "c", "d", "e"] as const;

/** Stable tone class suffix for a bank name; "x" (neutral) when there is none. */
export function bankTone(bank: string): string {
  const s = bank.trim().toLowerCase();
  if (!s) return "x";
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return MARK_TONES[(h >>> 0) % MARK_TONES.length];
}

/** The letters on the tile: initials of the first two words ("ABN AMRO" → "AA"),
 *  a short single word whole ("ING"), otherwise its first two letters
 *  ("Rabobank" → "RA"). "—" when the bank is unknown. */
export function bankInitials(bank: string): string {
  const words = bank.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0];
  return (w.length <= 3 ? w : w.slice(0, 2)).toUpperCase();
}

/** Bank names and account keys carry spaces and punctuation; an id attribute
 *  may not. Only used to wire a tab to its panel. */
const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-") || "geen";

const tabId = (groupId: string, accountKey: string): string => `bank-tab-${slug(groupId)}-${slug(accountKey)}`;

/* ------------------------------------------------------------------------- */

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
 *  one write per edit, in order.
 *
 *  `onEditingChange` reports the open/closed edit to the view, which freezes
 *  this account's group membership while the bank name is half-typed. */
function NameCell({ account, busy, onFieldChange, onCommit, onEditingChange }: {
  account: Account;
  busy: boolean;
  onFieldChange: (key: string, patch: Partial<Account>) => void;
  onCommit: (account: Account) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const setEdit = (next: boolean) => {
    setEditing(next);
    onEditingChange?.(next);
  };

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
        <button type="button" className="card-link" onClick={() => setEdit(true)} disabled={busy}>
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
      <button type="button" className="card-link" onClick={() => setEdit(false)} disabled={busy}>
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

/** Type of an account as an editable select — the same control in the table and
 *  in the per-bank panel. */
function TypeSelect({ account, busy, onTypeCommit }: { account: Account; busy: boolean; onTypeCommit: (key: string, type: string) => void }) {
  const type = accountType(account);
  return (
    <select
      aria-label={`Type ${account.name}`}
      value={type}
      onChange={(e) => onTypeCommit(account.key, e.target.value)}
      disabled={busy}
    >
      {!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number]) && <option value={type}>{type}</option>}
      {ACCOUNT_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

function deleteQuestion(account: Account, txCount: number): string {
  const name = account.name || account.key;
  return txCount === 0
    ? `${name} verwijderen?`
    : `${name} en ${txCount} ${txCount === 1 ? "transactie" : "transacties"} verwijderen?`;
}

/** Everything you can do to one account, laid out as fields instead of a table
 *  row. Same controls, same handlers — the grouping is presentation only. */
function AccountPanel({
  row, busy, labelledBy, onEntityChange, onAccountCommit, onAccountFieldChange, onSaldoCommit, onTypeCommit,
  onSelectAccount, onDeleteAccount, onRenameOpen,
}: {
  row: AccountSummary;
  busy: boolean;
  labelledBy?: string;
  onRenameOpen: (account: Account, editing: boolean) => void;
} & Pick<RekeningenProps, "onEntityChange" | "onAccountCommit" | "onAccountFieldChange" | "onSaldoCommit" | "onTypeCommit" | "onSelectAccount" | "onDeleteAccount">) {
  const { account, txCount } = row;
  return (
    <div className="bank-panel" role="tabpanel" aria-labelledby={labelledBy}>
      <div className="bank-fields">
        <div className="bank-field">
          <span className="eyebrow">Bank &amp; naam</span>
          <div>
            <NameCell
              account={account}
              busy={busy}
              onFieldChange={onAccountFieldChange}
              onCommit={onAccountCommit}
              onEditingChange={(editing) => onRenameOpen(account, editing)}
            />
          </div>
        </div>
        <div className="bank-field">
          <span className="eyebrow">Type</span>
          <div>
            <TypeSelect account={account} busy={busy} onTypeCommit={onTypeCommit} />
          </div>
        </div>
        <div className="bank-field">
          <span className="eyebrow">Entiteit</span>
          <div>
            <input
              aria-label={`Entiteit ${account.name || account.key}`}
              value={account.entity}
              placeholder="—"
              onChange={(e) => onEntityChange(account.key, e.target.value)}
              onBlur={() => void onAccountCommit(account)}
              disabled={busy}
            />
          </div>
        </div>
        <div className="bank-field">
          <span className="eyebrow">{isCardAccount(account) ? "Openstaand" : "Saldo"}</span>
          <div>
            <SaldoCell account={account} busy={busy} onCommit={onSaldoCommit} />
          </div>
        </div>
      </div>

      {account.iban ? <p className="bank-panel-iban">{account.iban}</p> : null}

      <div className="bank-panel-actions">
        {txCount === 0 ? (
          <span className="cell-sub">Nog geen transacties geïmporteerd</span>
        ) : (
          <button
            type="button"
            className="card-link"
            onClick={() => onSelectAccount(account.key)}
            title={`Bekijk transacties van ${account.name}`}
          >
            {txCount} {txCount === 1 ? "transactie" : "transacties"} bekijken
          </button>
        )}
        <ConfirmAction
          label="Verwijder"
          question={deleteQuestion(account, txCount)}
          busy={busy}
          onConfirm={() => onDeleteAccount(account.key)}
        />
      </div>
    </div>
  );
}

/** The bank's saldo line. Three different sentences, because the three cases are
 *  genuinely different: everything known (a real total), some known (a total
 *  that is explicitly PART of the group), nothing known (no figure at all —
 *  never a zero standing in for "we don't know"). */
function GroupSaldo({ group }: { group: BankGroup }) {
  if (group.total === null) {
    return (
      <span className="bank-group-saldo">
        <span className="bank-group-unknown">saldo onbekend</span>
      </span>
    );
  }
  return (
    <span className="bank-group-saldo">
      <span className={group.total >= 0 ? "text-pos" : "text-neg"}>{formatEuro(group.total)}</span>
      {group.unknownCount > 0 && (
        <span className="badge">
          van {group.knownCount} van {group.rows.length}
        </span>
      )}
    </span>
  );
}

export default function Rekeningen({ accounts, txs, busy, onEntityChange, onAccountCommit, onAccountFieldChange, onSaldoCommit, onTypeCommit, onSelectAccount, onDeleteAccount, duplicateGroups, onMergeDuplicates }: RekeningenProps) {
  // Only flag duplicates you can actually see here — a group whose accounts all
  // sit outside the active entity scope would be a banner about nothing.
  const visibleKeys = new Set(accounts.map((a) => a.key));
  const shownGroups = duplicateGroups.filter((g) => g.accounts.some((a) => visibleKeys.has(a.key)));

  // "Per bank" is the new default; the flat table stays one click away so the
  // two can be judged against each other rather than described.
  const [mode, setMode] = useState<"bank" | "lijst">("bank");
  const [openBank, setOpenBank] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  // The bank a half-typed rename belongs to — see groupAccountsByBank.
  const [rename, setRename] = useState<{ key: string; bank: string } | null>(null);

  const rows = accountSummaries(accounts, txs);
  const groups = groupAccountsByBank(rows, (a) => (rename && rename.key === a.key ? rename.bank : a.bank));

  return (
    <section className="card" aria-label="Rekeningen">
      <div className="card-header">
        <h2>Rekeningen</h2>
        {accounts.length > 0 && (
          <div className="bank-modes" role="group" aria-label="Weergave">
            <button
              type="button"
              className={`pill${mode === "bank" ? " pill-active" : ""}`}
              aria-pressed={mode === "bank"}
              onClick={() => setMode("bank")}
            >
              Per bank
            </button>
            <button
              type="button"
              className={`pill${mode === "lijst" ? " pill-active" : ""}`}
              aria-pressed={mode === "lijst"}
              onClick={() => setMode("lijst")}
            >
              Alle rekeningen
            </button>
          </div>
        )}
      </div>

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
      ) : mode === "bank" ? (
        <div className="bank-groups">
          {groups.map((g) => {
            const open = openBank === g.id;
            const keys = g.rows.map((r) => r.account.key);
            const chosen = selected[g.id];
            const activeKey = chosen && keys.includes(chosen) ? chosen : keys[0];
            const activeRow = g.rows.find((r) => r.account.key === activeKey) ?? g.rows[0];
            return (
              <div className={`bank-group${open ? " bank-group-open" : ""}`} key={g.id}>
                <button
                  type="button"
                  className="bank-group-head"
                  aria-expanded={open}
                  onClick={() => setOpenBank(open ? null : g.id)}
                >
                  <span className={`bank-mark bank-mark-${bankTone(g.named ? g.label : "")}`} aria-hidden="true">
                    {bankInitials(g.named ? g.label : "")}
                  </span>
                  <span className="bank-group-id">
                    <span className="bank-group-name">{g.label}</span>
                    <span className="bank-group-meta">
                      {g.rows.length} {g.rows.length === 1 ? "rekening" : "rekeningen"} · {g.txCount}{" "}
                      {g.txCount === 1 ? "transactie" : "transacties"}
                    </span>
                  </span>
                  <GroupSaldo group={g} />
                  <span className="bank-group-toggle">
                    {open ? "Verbergen" : g.rows.length === 1 ? "Rekening tonen" : "Rekeningen tonen"}
                    <span className="bank-chevron" aria-hidden="true">
                      ▾
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="bank-group-body">
                    {g.rows.length > 1 && (
                      <div className="bank-tabs" role="tablist" aria-label={`Rekeningen bij ${g.label}`}>
                        {g.rows.map((r) => {
                          const isActive = r.account.key === activeKey;
                          return (
                            <button
                              key={r.account.key}
                              type="button"
                              role="tab"
                              id={tabId(g.id, r.account.key)}
                              className={`pill bank-tab${isActive ? " pill-active" : ""}`}
                              aria-selected={isActive}
                              onClick={() => setSelected((s) => ({ ...s, [g.id]: r.account.key }))}
                            >
                              <span
                                className={`dot${r.account.balance === null ? "" : r.account.balance >= 0 ? " dot-pos" : " dot-neg"}`}
                                aria-hidden="true"
                              />
                              {rowLabel(r)}
                              <span className="bank-tab-type">{accountType(r.account)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <AccountPanel
                      key={activeRow.account.key}
                      row={activeRow}
                      busy={busy}
                      labelledBy={g.rows.length > 1 ? tabId(g.id, activeRow.account.key) : undefined}
                      onEntityChange={onEntityChange}
                      onAccountCommit={onAccountCommit}
                      onAccountFieldChange={onAccountFieldChange}
                      onSaldoCommit={onSaldoCommit}
                      onTypeCommit={onTypeCommit}
                      onSelectAccount={onSelectAccount}
                      onDeleteAccount={onDeleteAccount}
                      onRenameOpen={(account, editing) =>
                        setRename(editing ? { key: account.key, bank: account.bank } : null)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap table-cards">
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
              {rows.map(({ account, txCount }) => (
                <tr key={account.key}>
                  <td data-label="Bank">
                    <NameCell
                      account={account}
                      busy={busy}
                      onFieldChange={onAccountFieldChange}
                      onCommit={onAccountCommit}
                    />
                  </td>
                  <td data-label="Type">
                    <TypeSelect account={account} busy={busy} onTypeCommit={onTypeCommit} />
                  </td>
                  <td data-label="Entiteit">
                    <input
                      value={account.entity}
                      placeholder="—"
                      onChange={(e) => onEntityChange(account.key, e.target.value)}
                      onBlur={() => void onAccountCommit(account)}
                      disabled={busy}
                    />
                  </td>
                  <td className="num" data-label="Saldo">
                    <SaldoCell account={account} busy={busy} onCommit={onSaldoCommit} />
                  </td>
                  <td className="num" data-label="Transacties">
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
                  <td className="num" data-label="">
                    <ConfirmAction
                      label="Verwijder"
                      question={deleteQuestion(account, txCount)}
                      busy={busy}
                      onConfirm={() => onDeleteAccount(account.key)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
