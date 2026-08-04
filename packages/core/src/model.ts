export type Account = { key: string; iban: string; name: string; bank: string;
  entity: string; currency: string; balance: number | null; balanceDate?: string; type?: string;
  /** Optional annual interest rate (%) for the Optimisatie tab. User-set;
   *  suggested from detected "rente" bijschrijvingen when absent. */
  interestRate?: number };
export type Tx = { id: string; accountKey: string; date: string; amount: number;
  currency: string; counterparty: string; description: string; category: string; manual: boolean };
export type Rule = { id: string; match: string; category: string };

/** A signed, dated future cash movement the forecast can see BEFORE the bank
 *  transaction lands (a VAT set-aside, an expected invoice, a manual plan).
 *  amountCents is a POSITIVE magnitude; `sign` gives direction (1 in / -1 out). */
export type ScheduledFlow = {
  id: string;
  entity: string;
  label: string;
  sign: 1 | -1;
  amountCents: number;
  dueDate: string; // ISO YYYY-MM-DD
  source: "vat" | "invoice" | "manual";
  status: "expected" | "confirmed" | "paid" | "cancelled";
};

/** An incoming (AR: money owed TO you) or outgoing (AP: you owe) invoice. amount
 *  is DECIMAL euros (gross), Tx-convention. An `expected` invoice projects into a
 *  ScheduledFlow; `paid`/`cancelled` do not (so a paid invoice doesn't
 *  double-count with the bank transaction that settled it). */
export type Invoice = {
  id: string;
  entity: string;
  direction: "in" | "out";
  counterparty: string;
  invoiceNumber?: string;
  issueDate: string; // ISO
  dueDate: string;   // ISO
  amount: number;    // decimal euros (gross)
  vatAmount?: number;
  currency: string;
  status: "expected" | "paid" | "cancelled";
  matchedTxId?: string;
  sourceType: "manual" | "csv" | "ubl" | "llm";
  /** For `sourceType: "llm"` drafts: the model's OWN self-reported confidence
   *  (0..1), when it gave one — never a fabricated placeholder. Does not affect
   *  invoice identity (see makeInvoice's id-hash). */
  confidence?: number;
};

/** Per-entity (per-BV) VAT/BTW config for the set-aside estimate. */
export type VatSettings = {
  entity: string;
  frequency: "monthly" | "quarterly" | "yearly";
  defaultRatePct: number; // e.g. 21
  mixedRates: boolean;    // true => don't auto-estimate; manual-only
  manualCents?: number;   // manual override of the amount to set aside this period
};
