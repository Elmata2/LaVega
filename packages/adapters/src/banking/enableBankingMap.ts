import type { Account, Tx } from "@lavega/core";

/* Enable Banking -> our domain model (Tx/Account). Pure, I/O-free translation —
 * ported from the clean-room reference server.mjs's `ebMapTx`, `ebAccountKey`,
 * and the balance-pick + account-construction block inside `/api/eb/sync`
 * (server-side JWT signing, HTTP calls, and session/state persistence are a
 * separate task — this module only shapes JSON that's already been fetched). */

/** Raw Enable Banking transaction JSON (subset of fields we read). */
export type EbTransaction = {
  transaction_amount?: { amount?: number | string; currency?: string };
  credit_debit_indicator?: string;
  remittance_information?: string | string[];
  creditor?: { name?: string };
  creditor_account?: { iban?: string };
  debtor?: { name?: string };
  debtor_account?: { iban?: string };
  booking_date?: string;
  value_date?: string;
  bank_transaction_code?: { description?: string };
};

/** Raw Enable Banking balance entry (subset), as returned by GET /accounts/{uid}/balances. */
export type EbBalance = {
  balance_type?: string;
  name?: string;
  balance_amount?: { amount?: number | string; currency?: string };
  credit_debit_indicator?: string;
  /** EB's BalanceResource: "Reference date for the balance", a plain date
   *  (YYYY-MM-DD). Optional in the API — a bank may simply not send it. */
  reference_date?: string;
  /** EB's BalanceResource: "Timestamp of the last change of the balance amount"
   *  (UTC date-time). Typed here because the bank really does send it, NOT
   *  because we use it — pickEbBalanceDate explains why it is refused. */
  last_change_date_time?: string;
};

/** Raw Enable Banking account JSON (subset), plus an optional `aspsp` (bank) display
 * name — the ASPSP/bank name isn't part of the account entity itself in the EB API,
 * it comes from the session/connection; callers merge it in when known. */
export type EbAccount = {
  uid?: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  product?: string;
  currency?: string;
  aspsp?: string;
};

/* Collapse whitespace and trim — deliberately NOT core's `norm` (which lowercases):
 * counterparty/description should keep their original casing, matching the
 * reference's dedicated `ebNorm`. */
function ebNorm(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** EB transaction -> Omit<Tx,"id">. Amount sign: DBIT -> negative, else positive. */
export function mapEbTransaction(
  ebTx: EbTransaction,
  accountKey: string,
  fallbackCurrency?: string,
): Omit<Tx, "id"> {
  const amt = Number(ebTx?.transaction_amount?.amount ?? 0);
  const dbit = String(ebTx?.credit_debit_indicator || "").toUpperCase() === "DBIT";
  const remit = ([] as unknown[])
    .concat(ebTx?.remittance_information ?? [])
    .filter(Boolean)
    .join(" ");
  const cpName = dbit
    ? ebTx?.creditor?.name || ebTx?.creditor_account?.iban || ""
    : ebTx?.debtor?.name || ebTx?.debtor_account?.iban || "";
  const date = String(ebTx?.booking_date || ebTx?.value_date || "").slice(0, 10);

  return {
    accountKey,
    date,
    amount: (dbit ? -1 : 1) * Math.abs(amt),
    currency: ebTx?.transaction_amount?.currency || fallbackCurrency || "EUR",
    counterparty: ebNorm(cpName).slice(0, 80),
    description: ebNorm(remit || ebTx?.bank_transaction_code?.description || "").slice(0, 300),
    category: "",
    manual: false,
  };
}

/** Derives the account key: IBAN if present, else the other-identification scheme, else the EB uid, else 'onbekend'. */
export function ebAccountKey(ebAccount: EbAccount): string {
  return (
    ebAccount?.account_id?.iban ||
    ebAccount?.account_id?.other?.identification ||
    ebAccount?.uid ||
    "onbekend"
  );
}

/* THE ONE PLACE THAT DECIDES WHICH BALANCE ROW WE SPEAK FOR.
 *
 * Both the amount (pickEbBalance) and the date (pickEbBalanceDate) run through
 * here, and that is the entire point of it existing. An account normally
 * carries several rows at once — CLBD (booked), CLAV/ITAV (available), XPCD
 * (expected) — and they do NOT share a reference_date; the expected balance is
 * routinely dated in the future. Reading the amount off one row and the date
 * off another produces a sentence no bank ever said: a booked saldo stamped
 * with tomorrow. `currentBalance` then adds only txs strictly after that date,
 * so every payment already fetched and sitting before it silently stops
 * counting. Two lookups, one row. */
function pickEbBalanceEntry(balances: EbBalance[] | null | undefined): EbBalance | null {
  const list = balances || [];
  return (
    list.find((x) => /CLBD|closingBooked/i.test(x.balance_type || x.name || "")) ?? list[0] ?? null
  );
}

/** Picks a balance from GET /accounts/{uid}/balances: prefers a CLBD/closingBooked
 * entry, else the first entry; DBIT -> negative. No entries -> null. */
export function pickEbBalance(balances: EbBalance[] | null | undefined): number | null {
  const pick = pickEbBalanceEntry(balances);
  if (!pick) return null;
  const v = Number(pick.balance_amount?.amount ?? 0);
  return /DBIT/i.test(pick.credit_debit_indicator || "") ? -Math.abs(v) : v;
}

/** The day the picked balance belongs to: `reference_date` off that same row, or
 *  nothing. Feed it the SAME array you fed pickEbBalance.
 *
 *  WHY NEVER THE DAY WE FETCHED IT. This is the bug the function exists to
 *  close. Rekeningen prints "stand van <datum>" per rekening and says "datum
 *  onbekend" when there is none. Filling in today would turn a saldo the bank
 *  last touched three weeks ago into a saldo of today — and `currentBalance`
 *  would roll nothing forward on top of it, because it only adds txs after
 *  balanceDate. An empty date is a label the UI already has words for; a wrong
 *  date is silent and reads as fresh money.
 *
 *  WHY NOT `last_change_date_time`. It answers a different question. EB
 *  documents it as the timestamp of the last change of the balance AMOUNT, not
 *  the day the balance speaks for, and it is a UTC date-time. Cutting
 *  "2026-08-05T23:30:00Z" down to a day gives 2026-08-05 while the bank booked
 *  that payment on 2026-08-06 Amsterdam time; `currentBalance` then adds the tx
 *  on top of a saldo that already contains it, and the account reads too high
 *  by exactly that payment. A missing date costs a label, a day-off date costs
 *  money — so a bank that sends only last_change_date_time keeps "datum
 *  onbekend", and that is a deliberate refusal, not an oversight.
 *
 *  WHY THE SHAPE IS CHECKED. balanceDate is compared as a plain STRING against
 *  tx dates (`t.date > d`). Anything that is not YYYY-MM-DD — "24-08-2019", a
 *  stray timestamp, an empty string — does not throw, it just makes that
 *  comparison return an arbitrary answer. Malformed goes in the bin. */
export function pickEbBalanceDate(balances: EbBalance[] | null | undefined): string | undefined {
  const raw = String(pickEbBalanceEntry(balances)?.reference_date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

/** EB account JSON + a pre-picked balance (pickEbBalance) and its day
 *  (pickEbBalanceDate) -> Account. `entity` starts "" — assigned later by the
 *  user, same as FileImport-created accounts.
 *
 *  `balanceDate` is left OFF the object unless there is a balance to date, and
 *  stays off when the bank sent no date. A date beside `balance: null` dates
 *  nothing, and mergeImportedAccounts would drop it on the next import anyway
 *  (it only takes the imported date when the imported balance is real) — so
 *  writing it would be a field that cannot survive its own round trip. */
export function mapEbAccount(
  ebAccount: EbAccount,
  balance: number | null,
  balanceDate?: string,
): Account {
  const key = ebAccountKey(ebAccount);
  const iban = ebAccount?.account_id?.iban ?? "";
  const name = ebAccount?.name || ebAccount?.product || key;
  const bank = ebAccount?.aspsp ? ebAccount.aspsp.replace(/\s*\([A-Z]{2}\)\s*$/, "") : "";

  return {
    key,
    iban,
    name,
    bank,
    entity: "",
    currency: ebAccount?.currency || "EUR",
    balance,
    ...(balance !== null && balanceDate ? { balanceDate } : {}),
  };
}
