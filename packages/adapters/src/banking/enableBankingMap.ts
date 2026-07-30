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
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** EB transaction -> Omit<Tx,"id">. Amount sign: DBIT -> negative, else positive. */
export function mapEbTransaction(
  ebTx: EbTransaction,
  accountKey: string,
  fallbackCurrency?: string,
): Omit<Tx, "id"> {
  const amt = Number(ebTx?.transaction_amount?.amount ?? 0);
  const dbit = String(ebTx?.credit_debit_indicator || "").toUpperCase() === "DBIT";
  const remit = ([] as unknown[]).concat(ebTx?.remittance_information ?? []).filter(Boolean).join(" ");
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

/** Picks a balance from GET /accounts/{uid}/balances: prefers a CLBD/closingBooked
 * entry, else the first entry; DBIT -> negative. No entries -> null. */
export function pickEbBalance(balances: EbBalance[] | null | undefined): number | null {
  const list = balances || [];
  const pick = list.find((x) => /CLBD|closingBooked/i.test(x.balance_type || x.name || "")) ?? list[0];
  if (!pick) return null;
  const v = Number(pick.balance_amount?.amount ?? 0);
  return /DBIT/i.test(pick.credit_debit_indicator || "") ? -Math.abs(v) : v;
}

/** EB account JSON + a pre-picked balance (see pickEbBalance) -> Account. `entity`
 * starts "" — assigned later by the user, same as FileImport-created accounts. */
export function mapEbAccount(ebAccount: EbAccount, balance: number | null): Account {
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
  };
}
