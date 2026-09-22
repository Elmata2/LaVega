import { useState } from "react";
import type { Account, AccountSummary, Tx, DuplicateGroup } from "@lavega/core";
import {
  accountSummaries,
  isCardAccount,
  accountType,
  accountTypeKind,
  accountTypeKindOf,
  ACCOUNT_TYPES,
  type AccountTypeKind,
} from "@lavega/core";
import { formatEuroIn } from "../format";
import { useAppLocale } from "../appLocale";
import { moneyCopy } from "../copy/money";
import type { MoneyCopy } from "../copy/money";
import type { Locale } from "../locale";
import Badge from "../components/ui/Badge.js";
import Card, { CardHeader } from "../components/ui/Card.js";
import CardLink from "../components/ui/CardLink.js";
import Pill from "../components/ui/Pill.js";
import SaldoInput from "../components/ui/SaldoInput.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";
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
  /** Hoeveel van de OPGETELDE saldi geen `balanceDate` hebben. De kop is de enige
   *  plek die je dichtgeklapt ziet, en juist daar staat een euro-totaal dat als
   *  "nu" leest. Eén woord erbij is genoeg om dat te stoppen; de uitleg staat in
   *  het paneel, één klik verder. */
  undatedCount: number;
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
    let undatedCount = 0;
    let txCount = 0;
    for (const r of sorted) {
      txCount += r.txCount;
      if (r.account.balance !== null) {
        cents += Math.round(r.account.balance * 100);
        knownCount += 1;
        if (!r.account.balanceDate) undatedCount += 1;
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
      undatedCount,
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
  const words = bank
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0];
  return (w.length <= 3 ? w : w.slice(0, 2)).toUpperCase();
}

/** Bank names and account keys carry spaces and punctuation; an id attribute
 *  may not. Only used to wire a tab to its panel. */
const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-") || "geen";

const tabId = (groupId: string, accountKey: string): string =>
  `bank-tab-${slug(groupId)}-${slug(accountKey)}`;

/** Tile colour for a bank's tone letter (was `.bank-mark-a`..`.bank-mark-x` in
 *  views.css). Each branch names its own background AND text colour rather than
 *  relying on a shared base to be overridden, so there is never a second utility
 *  competing for the same CSS property. */
function bankMarkClass(tone: string): string {
  switch (tone) {
    case "a":
      return "bg-accent text-on-ink";
    case "b":
      return "bg-ink text-on-ink";
    case "c":
      return "bg-chart-blue text-on-ink";
    case "d":
      return "bg-chart-purple text-on-ink";
    case "e":
      return "bg-chart-teal text-on-ink";
    default:
      return "bg-surface-2 border border-dashed border-line text-muted";
  }
}

/** Border colour of a bank group's card: accented while its panel is open (was
 *  `.bank-group-open` in views.css). */
function bankGroupBorderClass(open: boolean): string {
  return open ? "border-accent" : "border-line";
}

/* ------------------------------------------------------------------------- */

/** A destructive action is never one click: the button swaps into a
 *  "Weet je het zeker? Ja / Nee" prompt in place, and only "Ja" fires it. */
function ConfirmAction({
  label,
  question,
  busy,
  onConfirm,
  locale,
}: {
  label: string;
  question: string;
  busy: boolean;
  onConfirm: () => void;
  locale: Locale;
}) {
  const c = moneyCopy[locale].rekeningen;
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <CardLink variant="danger" onClick={() => setAsking(true)} disabled={busy}>
        {label}
      </CardLink>
    );
  }
  return (
    <span className="confirm-inline">
      <span className="confirm-q">{question}</span>
      <CardLink
        variant="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        disabled={busy}
      >
        {c.ja}
      </CardLink>
      <CardLink onClick={() => setAsking(false)} disabled={busy}>
        {c.nee}
      </CardLink>
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
function NameCell({
  account,
  busy,
  onFieldChange,
  onCommit,
  onEditingChange,
  locale,
}: {
  account: Account;
  busy: boolean;
  onFieldChange: (key: string, patch: Partial<Account>) => void;
  onCommit: (account: Account) => void;
  onEditingChange?: (editing: boolean) => void;
  locale: Locale;
}) {
  const c = moneyCopy[locale].rekeningen;
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
        <CardLink onClick={() => setEdit(true)} disabled={busy}>
          {account.bank ? c.hernoem : c.bankInvullen}
        </CardLink>
      </>
    );
  }
  return (
    <div className="rename-cell [@media(max-width:620px)]:items-end">
      <input
        aria-label={c.bankVanLabel(account.name || account.key)}
        placeholder={c.bankPlaceholder}
        value={account.bank}
        onChange={(e) => onFieldChange(account.key, { bank: e.target.value, renamed: true })}
        onBlur={() => onCommit(account)}
        disabled={busy}
      />
      <input
        aria-label={c.naamVanLabel(account.name || account.key)}
        placeholder={c.naamPlaceholder}
        value={account.name}
        onChange={(e) => onFieldChange(account.key, { name: e.target.value, renamed: true })}
        onBlur={() => onCommit(account)}
        disabled={busy}
      />
      <CardLink onClick={() => setEdit(false)} disabled={busy}>
        {c.klaar}
      </CardLink>
    </div>
  );
}

/** Editable current-saldo cell. CSV imports carry no balance, so the owner types
 *  it in from their bankapp; MT940/.STA fills it automatically but can be
 *  overridden. Holds a free-form draft string while typing (so "-", "1," etc.
 *  don't fight a controlled number input) and commits on blur — the parse +
 *  persist happens in App. Blank commits back to "onbekend" (null). */
function SaldoCell({
  account,
  busy,
  onCommit,
  locale,
}: {
  account: Account;
  busy: boolean;
  onCommit: (key: string, value: string) => void;
  locale: Locale;
}) {
  const c = moneyCopy[locale].rekeningen;
  // A credit card stores a NEGATIVE balance (debt) but the user types/reads the
  // amount OWED as a positive — show the absolute value in the field for cards.
  const card = isCardAccount(account);
  const shown = (b: number) => (card ? Math.abs(b) : b);
  const [draft, setDraft] = useState(
    account.balance === null ? "" : String(shown(account.balance)),
  );
  // Resync when the balance changes elsewhere (re-import, reset) and we're not editing it.
  const balanceKey = account.balance;
  const [prevBalance, setPrevBalance] = useState(balanceKey);
  if (balanceKey !== prevBalance) {
    setPrevBalance(balanceKey);
    setDraft(balanceKey === null ? "" : String(card ? Math.abs(balanceKey) : balanceKey));
  }
  const cls = account.balance === null ? "" : account.balance >= 0 ? " text-pos" : " text-neg";
  return (
    <>
      <span
        className={`dot${account.balance === null ? "" : account.balance >= 0 ? " dot-pos" : " dot-neg"}`}
        aria-hidden="true"
      />{" "}
      <SaldoInput
        className={cls}
        inputMode="decimal"
        placeholder={c.saldoOnbekendPlaceholder}
        aria-label={card ? c.openstaandBedragVanLabel(account.name) : c.saldoVanLabel(account.name)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(account.key, draft)}
        disabled={busy}
      />
      {card && <span className="eyebrow"> {c.schuld}</span>}
    </>
  );
}

/** Exhaustive by switch, so a new AccountTypeKind fails the build here instead
 *  of rendering nothing. */
function typeOptionLabel(c: MoneyCopy["accountTypes"], kind: AccountTypeKind): string {
  switch (kind) {
    case "current":
      return c.current;
    case "savings":
      return c.savings;
    case "credit":
      return c.credit;
    case "investment":
      return c.investment;
    case "other":
      return c.other;
  }
}

/** Type of an account as an editable select — the same control in the table and
 *  in the per-bank panel. */
function TypeSelect({
  account,
  busy,
  onTypeCommit,
  locale,
}: {
  account: Account;
  busy: boolean;
  onTypeCommit: (key: string, type: string) => void;
  locale: Locale;
}) {
  const c = moneyCopy[locale].rekeningen;
  const type = accountType(account);
  return (
    <select
      aria-label={c.typeVanLabel(account.name)}
      value={type}
      onChange={(e) => onTypeCommit(account.key, e.target.value)}
      disabled={busy}
    >
      {!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number]) && (
        <option value={type}>{type}</option>
      )}
      {ACCOUNT_TYPES.map((t) => (
        <option key={t} value={t}>
          {typeOptionLabel(moneyCopy[locale].accountTypes, accountTypeKindOf(t))}
        </option>
      ))}
    </select>
  );
}

function deleteQuestion(account: Account, txCount: number, locale: Locale): string {
  const name = account.name || account.key;
  return moneyCopy[locale].rekeningen.deleteQuestion(name, txCount);
}

/** Everything you can do to one account, laid out as fields instead of a table
 *  row. Same controls, same handlers — the grouping is presentation only. */
function AccountPanel({
  row,
  busy,
  labelledBy,
  latestTx,
  onEntityChange,
  onAccountCommit,
  onAccountFieldChange,
  onSaldoCommit,
  onTypeCommit,
  onSelectAccount,
  onDeleteAccount,
  onRenameOpen,
  locale,
}: {
  row: AccountSummary;
  busy: boolean;
  labelledBy?: string;
  /** Nieuwste transactiedatum van deze rekening, of null. Zie SaldoAgeNote. */
  latestTx: string | null;
  onRenameOpen: (account: Account, editing: boolean) => void;
  locale: Locale;
} & Pick<
  RekeningenProps,
  | "onEntityChange"
  | "onAccountCommit"
  | "onAccountFieldChange"
  | "onSaldoCommit"
  | "onTypeCommit"
  | "onSelectAccount"
  | "onDeleteAccount"
>) {
  const c = moneyCopy[locale].rekeningen;
  const { account, txCount } = row;
  const age = saldoAge(account, latestTx);
  const linked = linkedMoment(account);
  return (
    <div
      className="border border-line rounded-sm bg-surface p-4"
      data-testid="bank-panel"
      role="tabpanel"
      aria-labelledby={labelledBy}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <div
          className="flex flex-col gap-1 min-w-0 [&_input]:max-w-full [&_select]:max-w-full"
          data-testid="bank-field"
        >
          <span className="eyebrow">{c.bankNaam}</span>
          <div>
            <NameCell
              account={account}
              busy={busy}
              onFieldChange={onAccountFieldChange}
              onCommit={onAccountCommit}
              onEditingChange={(editing) => onRenameOpen(account, editing)}
              locale={locale}
            />
          </div>
        </div>
        <div
          className="flex flex-col gap-1 min-w-0 [&_input]:max-w-full [&_select]:max-w-full"
          data-testid="bank-field"
        >
          <span className="eyebrow">{c.type}</span>
          <div>
            <TypeSelect account={account} busy={busy} onTypeCommit={onTypeCommit} locale={locale} />
          </div>
        </div>
        <div
          className="flex flex-col gap-1 min-w-0 [&_input]:max-w-full [&_select]:max-w-full"
          data-testid="bank-field"
        >
          <span className="eyebrow">{c.entiteit}</span>
          <div>
            <input
              aria-label={c.entiteitVanLabel(account.name || account.key)}
              value={account.entity}
              placeholder="—"
              onChange={(e) => onEntityChange(account.key, e.target.value)}
              onBlur={() => void onAccountCommit(account)}
              disabled={busy}
            />
          </div>
        </div>
        <div
          className="flex flex-col gap-1 min-w-0 [&_input]:max-w-full [&_select]:max-w-full"
          data-testid="bank-field"
        >
          <span className="eyebrow">{isCardAccount(account) ? c.openstaand : c.saldo}</span>
          <div>
            <SaldoCell account={account} busy={busy} onCommit={onSaldoCommit} locale={locale} />
          </div>
          <span className="cell-sub">{saldoAgeShort(age, locale)}</span>
        </div>
        {/* NA het saldoveld, en dat is geen volgorde-toeval: het bedrag is waar
            hij voor komt, het koppelmoment is de context eromheen. Een veld met
            een datum vóór het saldo zou als de datum van dat saldo lezen — de
            verwisseling die dit veld juist moet opheffen. */}
        <div
          className="flex flex-col gap-1 min-w-0 [&_input]:max-w-full [&_select]:max-w-full"
          data-testid="bank-field"
        >
          <span className="eyebrow">{c.gekoppeld}</span>
          <div className="cell-sub">{linkedShort(linked, locale)}</div>
        </div>
      </div>

      <SaldoAgeNote age={age} locale={locale} />
      <LinkedNote moment={linked} locale={locale} />

      {account.iban ? (
        <p className="mt-3 mb-0 font-mono text-[0.8rem] text-muted">{account.iban}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-t-line">
        {txCount === 0 ? (
          <span className="cell-sub">{c.nogGeenTransactiesGeimporteerd}</span>
        ) : (
          <CardLink
            onClick={() => onSelectAccount(account.key)}
            title={c.bekijkTransactiesVan(account.name)}
          >
            {c.transactiesBekijken(txCount)}
          </CardLink>
        )}
        <ConfirmAction
          label={c.verwijder}
          question={deleteQuestion(account, txCount, locale)}
          busy={busy}
          onConfirm={() => onDeleteAccount(account.key)}
          locale={locale}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * WANNEER KWAM DIT CIJFER BINNEN — de gevaarlijkste vraag op deze pagina.
 *
 * Een bankkoppeling ververst NIET. De server heeft vier routes (aspsps, auth,
 * callback, accounts), geen refresh-route en geen interval, en `mapEbAccount`
 * levert een Account zonder `balanceDate` af. Gevolg: `withCurrentBalances`
 * leest zo'n saldo als "al actueel" (geen balanceDate => ongewijzigd terug), en
 * een stand van het koppelmoment staat op het scherm alsof hij van vandaag is.
 * Het cijfer is dan niet fout — de betekenis is fout, en dat is precies het
 * soort fout dat je niet ziet gebeuren.
 *
 * Wat we per rekening ECHT weten:
 *   - `balanceDate`: gezet door de CSV/MT940-parsers (de afsluitdatum van het
 *     afschrift) en door een saldo dat de eigenaar zelf typt (App zet dan asOf).
 *     Dit is de dag waarop het bedrag gold.
 *   - géén `balanceDate`: een bankkoppeling, en zeldzaam een MT940-blok zonder
 *     :61:-regels. Dan is er geen dag. Er staat hier dan ook geen dag — een
 *     "vandaag" invullen zou het probleem juist maken.
 *   - de nieuwste transactie die we van de rekening hebben. Dat is een feit over
 *     de TRANSACTIES, en zo staat het er ook: het is géén bewijs over de
 *     ouderdom van het saldo. Bij een koppeling komen saldo en transacties uit
 *     dezelfde fetch, maar bewijzen kan ik dat per rekening niet, dus claim ik
 *     het niet.
 *
 * Wat er NIET staat is het moment van binnenkomen zelf. Niets slaat dat op:
 * geen veld op Account, geen importlog. Daarom heet het label "stand van" en
 * niet "bijgewerkt op", hoe verleidelijk dat laatste ook is: balanceDate is de
 * dag waarop het BEDRAG gold, niet de dag waarop het binnenkwam. Die twee door
 * elkaar halen zou hier de verkeerde zekerheid geven — precies de fout die dit
 * blok moet stoppen. Zolang er geen veld voor het ophaalmoment is, blijft dat
 * moment onbekend en zegt de tekst dat.
 *
 * En de melding stelt niets voor wat hier niet kan. "Koppel opnieuw" staat er
 * NIET: de knop daarvoor (BankLink) zit in het Importeren-blok in Profiel, niet
 * op deze pagina, en een advies dat naar een knop wijst die je hier niet hebt is
 * geen advies. Het saldoveld staat er wel — twee regels hoger — dus dat mag de
 * tekst wel noemen.
 * ------------------------------------------------------------------------- */

const DAYS_NL = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

/** "2026-07-31" -> "31 juli 2026"; een onleesbare waarde komt ongewijzigd terug.
 *
 *  Eigen kopie in plaats van iets uit format.ts: die file is deze run van een
 *  andere lane, en een maandnaam-formatter is te klein om er een eigendomsruzie
 *  over te hebben. Staat het er ooit gedeeld, dan mag deze weg.
 *
 *  Kept single-argument and Dutch-only: exported and called directly (without a
 *  locale) by Punten.test.tsx, owned by another lane. `dayFullIn` below adds
 *  English without touching this signature. */
export function dayNL(iso: string): string {
  const [y, m, d] = (iso ?? "").split("-").map(Number);
  return DAYS_NL[m - 1] && d ? `${d} ${DAYS_NL[m - 1]} ${y}` : iso;
}

const MONTHS_EN_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `dayNL`, but locale-aware: "31 July 2026" in English. format.ts's own
 *  `formatDate` uses SHORT month names ("31 jul 2026"), which is not the
 *  wording already on this screen — kept local for the same reason as `dayNL`. */
function dayFullIn(locale: Locale, iso: string): string {
  if (locale === "nl") return dayNL(iso);
  const [y, m, d] = (iso ?? "").split("-").map(Number);
  return MONTHS_EN_FULL[m - 1] && d ? `${d} ${MONTHS_EN_FULL[m - 1]} ${y}` : iso;
}

/** Nieuwste transactiedatum per accountKey. ISO-datums vergelijken als string,
 *  dus geen Date nodig — en dus ook geen tijdzone die er een dag naast zit. */
export function latestTxDates(txs: readonly Tx[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of txs) {
    if (!t.date) continue;
    const cur = out.get(t.accountKey);
    if (cur === undefined || t.date > cur) out.set(t.accountKey, t.date);
  }
  return out;
}

/** De drie toestanden waarin een saldo kan staan. `laterTx` is alleen gezet als
 *  er transacties NA de saldodatum liggen — dan is de stand aantoonbaar niet de
 *  huidige positie. `latestTx` is de nieuwste transactie die we hebben, of null.
 *
 *  `linkedAt` hangt aan de ONGEDATEERDE tak en nergens anders, want daar zei de
 *  uitleg tot vandaag: "wat hier staat is de stand van het moment waarop je
 *  autoriseerde. Welk moment dat was, weet LaVega niet." Dat was waar zolang
 *  niemand het opschreef; sinds `Account.linkedAt` bestaat kan het pertinent
 *  onwaar zijn, en dan staat de app zichzelf twee regels verder tegen te
 *  spreken. De tekst moet dus weten of dat moment bekend is. */
export type SaldoAge =
  | { kind: "dated"; date: string; laterTx: string | null }
  | {
      kind: "undated";
      latestTx: string | null;
      linkedAt: string | null;
      /** Wanneer WIJ het saldo laatst ophaalden. Gaat vóór `linkedAt`: het is
       *  het recentere en het preciezere feit over dit bedrag. */
      fetchedAt: string | null;
    }
  | { kind: "none"; latestTx: string | null };

export function saldoAge(account: Account, latestTx: string | null): SaldoAge {
  if (account.balance === null) return { kind: "none", latestTx };
  const date = account.balanceDate;
  if (!date)
    return {
      kind: "undated",
      latestTx,
      linkedAt: account.linkedAt ?? null,
      fetchedAt: account.balanceFetchedAt ?? null,
    };
  return { kind: "dated", date, laterTx: latestTx !== null && latestTx > date ? latestTx : null };
}

/** Het korte label naast het bedrag. Bij een onbekende dag staat er GEEN datum
 *  en ook geen streepje dat voor een datum kan doorgaan, maar het woord zelf. */
export function saldoAgeShort(age: SaldoAge, locale: Locale): string {
  const c = moneyCopy[locale].rekeningen;
  if (age.kind === "dated") return c.standVan(dayFullIn(locale, age.date));
  if (age.kind === "undated")
    return age.fetchedAt ? c.opgehaaldOp(dayFullIn(locale, age.fetchedAt)) : c.datumOnbekend;
  return c.geenSaldo;
}

/** De uitleg eronder: eerst wat het cijfer is, dan waarom het niet meebeweegt,
 *  dan — alleen als het waar is — wat je hier zelf kunt doen. */
export function saldoAgeNote(age: SaldoAge, locale: Locale): string {
  const c = moneyCopy[locale].rekeningen;
  if (age.kind === "dated") {
    const later = age.laterTx ? c.saldoAgeDatedLater(dayFullIn(locale, age.laterTx)) : "";
    return c.saldoAgeDatedIntro(dayFullIn(locale, age.date)) + later + c.saldoAgeDatedInvite;
  }
  if (age.kind === "undated") {
    const tx = age.latestTx ? c.saldoAgeUndatedTx(dayFullIn(locale, age.latestTx)) : "";
    const invite = c.saldoAgeUndatedInvite;
    /* IS HET KOPPELMOMENT BEKEND, dan mag de oude zin hier niet meer staan.
     *
     * Die zin luidde: "wat hier staat is de stand van het moment waarop je
     * autoriseerde. Welk moment dat was, weet LaVega niet." Met `linkedAt` op de
     * rekening staat dat moment een regel verderop op ditzelfde scherm — de
     * uitleg zou dus ontkennen wat er naast staat, en van de twee zinnen is er
     * dan altijd één fout.
     *
     * Wat er in plaats daarvan NIET staat, is een uitspraak over de ouderdom van
     * het bedrag. De verleiding is groot: "het bedrag is opgehaald op of ná de
     * koppeling, dus ouder is het niet." Voor een bankkoppeling klopt dat, maar
     * dit veld staat ook op geïmporteerde rekeningen, en een afschrift van juni
     * dat in augustus wordt ingelezen heeft een saldo dat wél ouder is dan het
     * koppelmoment. Eén regel die voor beide bronnen waar moet zijn, kan die
     * grens dus niet trekken — dus trekt hij hem niet, en wijst hij naar de
     * regel eronder die over de koppeling gaat en over niets anders. */
    /* HET OPHAALMOMENT GAAT VOOR. Sinds een bankkoppeling zichzelf ververst is
       * het koppelmoment niet langer het beste wat we over dit bedrag weten:
       * een rekening van vorige maand kan een saldo van vanochtend dragen, en
       * "gekoppeld op <toen>" leest dan als een uitspraak over het bedrag. */
    if (age.fetchedAt) return c.saldoAgeUndatedFetched + tx + invite;
    if (age.linkedAt) return c.saldoAgeUndatedLinked + tx + invite;
    return c.saldoAgeUndatedUnlinked + tx + invite;
  }
  const tx = age.latestTx ? c.saldoAgeNoneTx(dayFullIn(locale, age.latestTx)) : "";
  return c.saldoAgeNoneIntro + tx + c.saldoAgeNoneInvite;
}

/** Het blokje onder het saldoveld. Eén korte regel bij het bedrag en de uitleg
 *  eronder — de uitleg staat er altijd, want de misleiding (een oude stand die
 *  als de huidige leest) zit in élk saldo, niet alleen in een oud saldo. */
function SaldoAgeNote({ age, locale }: { age: SaldoAge; locale: Locale }) {
  return (
    <p
      className="mt-3 mb-0 py-3 px-4 border-t border-r border-b border-t-line border-r-line border-b-line border-l-[3px] border-l-accent rounded-sm bg-surface-2 text-muted text-[0.85rem]"
      data-testid="bank-panel-age"
    >
      <strong className="text-ink">{saldoAgeShort(age, locale)}</strong> —{" "}
      {saldoAgeNote(age, locale)}
    </p>
  );
}

/* ---------------------------------------------------------------------------
 * HOE OUD IS DE KOPPELING — de tweede vraag, en niet dezelfde als hierboven.
 *
 * Het blok hiervoor gaat over de ouderdom van het BEDRAG. Dit gaat over de
 * ouderdom van de KOPPELING: wanneer deze rekening in LaVega kwam. Dat waren
 * altijd twee vragen, maar er was maar één antwoord — `balanceDate` — en dus
 * werd dat antwoord voor allebei gelezen. Bij een bankkoppeling stuurt de bank
 * vaak geen saldodag mee; er stond dan "datum onbekend", en de bovenstaande
 * uitleg moest schrijven "wat hier staat is de stand van het moment waarop je
 * autoriseerde. Welk moment dat was, weet LaVega niet." Dat laatste hoeft nu
 * niet meer waar te zijn: `Account.linkedAt` legt dat moment vast bij het
 * aanmaken van de rekening.
 *
 * De twee blijven WEL uit elkaar op het scherm, in twee zinnen en twee labels.
 * Ze samenvoegen tot één "bijgewerkt op" is precies hoe ze eerder door elkaar
 * gingen lopen: een koppelmoment van vandaag zegt niets over een saldo van
 * vorige maand, en andersom net zo min.
 *
 * En voor rekeningen die er al stonden blijft het antwoord "onbekend". Zie
 * `withLinkedAt` in core: niet met terugwerkende kracht invullen. Er staat hier
 * dus geen datum en ook geen advies om iets opnieuw te importeren — dat zou een
 * advies zijn dat niet werkt, want een her-import van een rekening die er al is
 * verschuift het koppelmoment niet en máákt er ook geen.
 *
 * ALLEEN IN HET PANEEL, niet in de platte tabel. Die tabel heeft één saldokolom
 * met één regel eronder; daar een tweede datum bij zetten levert twee datums in
 * één cel op, en dan staan ze weer naast elkaar te lijken op hetzelfde ding. Een
 * eigen kolom zou het wel scheiden maar maakt de rij op een telefoon onleesbaar.
 * Het paneel is de plek waar één rekening wordt uitgelegd; daar hoort dit thuis.
 * ------------------------------------------------------------------------- */

export type LinkedMoment = { kind: "known"; date: string } | { kind: "unknown" };

export function linkedMoment(account: Account): LinkedMoment {
  const at = account.linkedAt;
  return at ? { kind: "known", date: at } : { kind: "unknown" };
}

/** Het korte label. Bij onbekend staat er geen cijfer — geen jaartal, geen
 *  streepje op een datumplek — om dezelfde reden als bij `saldoAgeShort`: alles
 *  wat op een datum lijkt, wordt als de datum gelezen. */
export function linkedShort(m: LinkedMoment, locale: Locale): string {
  const c = moneyCopy[locale].rekeningen;
  return m.kind === "known" ? c.gekoppeldOp(dayFullIn(locale, m.date)) : c.koppelmomentOnbekend;
}

/** De uitleg eronder. Bij een bekend moment één zin die zegt wat het WEL en wat
 *  het NIET is; bij een onbekend moment de echte oorzaak, zonder handeling
 *  erbij, want er is er geen die dit gat vult. */
export function linkedNote(m: LinkedMoment, locale: Locale): string {
  const c = moneyCopy[locale].rekeningen;
  return m.kind === "known" ? c.linkedNoteKnown(dayFullIn(locale, m.date)) : c.linkedNoteUnknown;
}

/** Eén regel plus uitleg, in dezelfde vorm als `SaldoAgeNote` en er bewust naast
 *  in plaats van erin: twee vragen, twee alinea's. */
function LinkedNote({ moment, locale }: { moment: LinkedMoment; locale: Locale }) {
  return (
    <p
      className="mt-3 mb-0 py-3 px-4 border-t border-r border-b border-t-line border-r-line border-b-line border-l-[3px] border-l-accent rounded-sm bg-surface-2 text-muted text-[0.85rem]"
      data-testid="bank-panel-linked"
    >
      <strong className="text-ink">{linkedShort(moment, locale)}</strong> —{" "}
      {linkedNote(moment, locale)}
    </p>
  );
}

/** The bank's saldo line. Three different sentences, because the three cases are
 *  genuinely different: everything known (a real total), some known (a total
 *  that is explicitly PART of the group), nothing known (no figure at all —
 *  never a zero standing in for "we don't know"). */
function GroupSaldo({ group, locale }: { group: BankGroup; locale: Locale }) {
  const c = moneyCopy[locale].rekeningen;
  if (group.total === null) {
    return (
      <span
        className="flex items-center gap-2 flex-none font-semibold tabular-nums"
        data-testid="bank-group-saldo"
      >
        <span className="text-muted font-normal text-[0.85rem]" data-testid="bank-group-unknown">
          {c.saldoOnbekend}
        </span>
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-2 flex-none font-semibold tabular-nums"
      data-testid="bank-group-saldo"
    >
      <span className={group.total >= 0 ? "text-pos" : "text-neg"}>
        {formatEuroIn(locale, group.total)}
      </span>
      {group.unknownCount > 0 && (
        <Badge>{c.vanKnownVanTotal(group.knownCount, group.rows.length)}</Badge>
      )}
      {/* Niet "verouderd" en geen datum: we weten van deze bedragen niet op welke
          dag ze gelden. Zie SaldoAgeNote — het totaal blijft staan, want het is
          wél de som van wat we hebben. */}
      {group.undatedCount > 0 && <Badge>{c.dagOnbekend}</Badge>}
    </span>
  );
}

export default function Rekeningen({
  accounts,
  txs,
  busy,
  onEntityChange,
  onAccountCommit,
  onAccountFieldChange,
  onSaldoCommit,
  onTypeCommit,
  onSelectAccount,
  onDeleteAccount,
  duplicateGroups,
  onMergeDuplicates,
}: RekeningenProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].rekeningen;
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
  const groups = groupAccountsByBank(rows, (a) =>
    rename && rename.key === a.key ? rename.bank : a.bank,
  );
  // Eén doorloop over de transacties voor de hele pagina; per rekening opnieuw
  // filteren maakte hier O(rekeningen x transacties) van iets dat O(n) is.
  const latest = latestTxDates(txs);

  return (
    <Card as="section" aria-label={c.heading}>
      <CardHeader>
        <h2>{c.heading}</h2>
        {accounts.length > 0 && (
          <div
            className="flex gap-2"
            data-testid="bank-modes"
            role="group"
            aria-label={c.weergaveGroepAria}
          >
            <Pill
              active={mode === "bank"}
              aria-pressed={mode === "bank"}
              onClick={() => setMode("bank")}
            >
              {c.perBank}
            </Pill>
            <Pill
              active={mode === "lijst"}
              aria-pressed={mode === "lijst"}
              onClick={() => setMode("lijst")}
            >
              {c.alleRekeningen}
            </Pill>
          </div>
        )}
      </CardHeader>

      {shownGroups.map((group) => {
        const others = group.accounts.filter((a) => a.key !== group.survivor.key);
        return (
          <div className="dup-banner" key={group.canonicalId}>
            <div>
              <p className="dup-banner-title">
                {c.dupBannerTitle(group.accounts.map(accountLabel).join(", "))}
              </p>
              <p className="dup-banner-sub">
                {c.dupBannerSubBefore}
                <strong>{accountLabel(group.survivor)}</strong>
                {c.dupBannerSubAfter}
              </p>
            </div>
            <div className="dup-banner-actions">
              {others.map((dup) => (
                <ConfirmAction
                  key={dup.key}
                  label={c.samenvoegenLabel(others.length > 1, accountLabel(dup))}
                  question={c.samenvoegenQuestion(accountLabel(dup), accountLabel(group.survivor))}
                  busy={busy}
                  onConfirm={() => onMergeDuplicates(group.survivor.key, dup.key)}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        );
      })}

      {accounts.length === 0 ? (
        <p>{c.geenRekeningen}</p>
      ) : mode === "bank" ? (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const open = openBank === g.id;
            const keys = g.rows.map((r) => r.account.key);
            const chosen = selected[g.id];
            const activeKey = chosen && keys.includes(chosen) ? chosen : keys[0];
            const activeRow = g.rows.find((r) => r.account.key === activeKey) ?? g.rows[0];
            return (
              <div
                className={`border rounded bg-surface overflow-hidden ${bankGroupBorderClass(open)}`}
                data-testid="bank-group"
                key={g.id}
              >
                <button
                  type="button"
                  className="flex items-center gap-4 w-full py-3 px-4 [border:0] bg-transparent text-left cursor-pointer [font:inherit] text-ink hover:bg-surface-2 [@media(max-width:640px)]:flex-wrap"
                  data-testid="bank-group-head"
                  aria-expanded={open}
                  onClick={() => setOpenBank(open ? null : g.id)}
                >
                  <span
                    className={`inline-flex items-center justify-center flex-none w-11 h-11 rounded-sm font-display text-[1.05rem] font-semibold tracking-[0.02em] ${bankMarkClass(bankTone(g.named ? g.label : ""))}`}
                    aria-hidden="true"
                  >
                    {bankInitials(g.named ? g.label : "")}
                  </span>
                  <span className="flex-auto min-w-0">
                    <span className="block font-display text-[1.2rem] font-semibold text-ink [overflow-wrap:anywhere]">
                      {g.named ? g.label : c.zonderBank}
                    </span>
                    <span className="block text-[0.8rem] text-muted">
                      {g.rows.length} {c.rekeningWoord(g.rows.length)} · {g.txCount}{" "}
                      {c.transactieWoord(g.txCount)}
                    </span>
                  </span>
                  <GroupSaldo group={g} locale={locale} />
                  <span className="flex items-center gap-1 flex-none text-accent text-[0.85rem] [@media(max-width:640px)]:w-full">
                    {open ? c.verbergen : g.rows.length === 1 ? c.rekeningTonen : c.rekeningenTonen}
                    <span
                      className={`inline-block [transition:transform_0.15s_ease] ${open ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="border-t border-t-line p-4 bg-surface-2">
                    {g.rows.length > 1 && (
                      <div
                        className="flex flex-wrap gap-2 mb-4"
                        role="tablist"
                        aria-label={c.rekeningenBijBankAria(g.named ? g.label : c.zonderBank)}
                      >
                        {g.rows.map((r) => {
                          const isActive = r.account.key === activeKey;
                          // bg-surface only while NOT active, passed as `className` rather
                          // than baked into a variant: Pill's `active` variant already covers
                          // the accent-soft background for the active tab, and `cn()`'s
                          // `twMerge` keeps this `bg-surface` over the variant's own
                          // `bg-transparent` only when both are present — passing it
                          // unconditionally would win over the active tab's accent-soft
                          // background too (trap 7, docs/adr/0005).
                          return (
                            <Pill
                              key={r.account.key}
                              role="tab"
                              id={tabId(g.id, r.account.key)}
                              active={isActive}
                              className={isActive ? undefined : "bg-surface"}
                              aria-selected={isActive}
                              onClick={() => setSelected((s) => ({ ...s, [g.id]: r.account.key }))}
                            >
                              <span
                                className={`dot${r.account.balance === null ? "" : r.account.balance >= 0 ? " dot-pos" : " dot-neg"}`}
                                aria-hidden="true"
                              />
                              {rowLabel(r)}
                              <span className="text-muted text-[0.75rem]">
                                {typeOptionLabel(
                                  moneyCopy[locale].accountTypes,
                                  accountTypeKind(r.account),
                                )}
                              </span>
                            </Pill>
                          );
                        })}
                      </div>
                    )}
                    <AccountPanel
                      key={activeRow.account.key}
                      row={activeRow}
                      busy={busy}
                      latestTx={latest.get(activeRow.account.key) ?? null}
                      labelledBy={
                        g.rows.length > 1 ? tabId(g.id, activeRow.account.key) : undefined
                      }
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
                      locale={locale}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <TableWrap>
          <Table cards>
            <thead>
              <tr>
                <Th>{c.tabelBank}</Th>
                <Th>{c.tabelType}</Th>
                <Th>{c.tabelEntiteit}</Th>
                <Th numeric>{c.tabelSaldo}</Th>
                <Th numeric>{c.tabelTransacties}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, txCount }) => (
                <tr key={account.key}>
                  <Td data-label={c.tabelBank}>
                    <NameCell
                      account={account}
                      busy={busy}
                      onFieldChange={onAccountFieldChange}
                      onCommit={onAccountCommit}
                      locale={locale}
                    />
                  </Td>
                  <Td data-label={c.tabelType}>
                    <TypeSelect
                      account={account}
                      busy={busy}
                      onTypeCommit={onTypeCommit}
                      locale={locale}
                    />
                  </Td>
                  <Td data-label={c.tabelEntiteit}>
                    <input
                      value={account.entity}
                      placeholder="—"
                      onChange={(e) => onEntityChange(account.key, e.target.value)}
                      onBlur={() => void onAccountCommit(account)}
                      disabled={busy}
                    />
                  </Td>
                  <Td numeric data-label={c.tabelSaldo}>
                    <SaldoCell
                      account={account}
                      busy={busy}
                      onCommit={onSaldoCommit}
                      locale={locale}
                    />
                    {/* Dezelfde waarschuwing als in het paneel, maar de tabel
                        heeft geen ruimte voor de uitleg: hier alleen de dag (of
                        het woord "onbekend"), de uitleg staat per rekening in
                        "Per bank". Een datum verzinnen om de kolom te vullen is
                        het probleem dat deze regel juist oplost. */}
                    <div className="cell-sub">
                      {saldoAgeShort(saldoAge(account, latest.get(account.key) ?? null), locale)}
                    </div>
                  </Td>
                  <Td numeric data-label={c.tabelTransacties}>
                    <CardLink
                      onClick={() => onSelectAccount(account.key)}
                      title={c.bekijkTransactiesVan(account.name)}
                      disabled={txCount === 0}
                    >
                      {txCount}
                    </CardLink>
                  </Td>
                  <Td numeric data-label="">
                    <ConfirmAction
                      label={c.verwijder}
                      question={deleteQuestion(account, txCount, locale)}
                      busy={busy}
                      onConfirm={() => onDeleteAccount(account.key)}
                      locale={locale}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
