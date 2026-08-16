import type { CountryCode, VatFrequency } from "./taxpacks/index.js";

export type Account = { key: string; iban: string; name: string; bank: string;
  entity: string; currency: string; balance: number | null; balanceDate?: string; type?: string;
  /** Optional annual interest rate (%) for the Optimisatie tab. User-set;
   *  suggested from detected "rente" bijschrijvingen when absent. */
  interestRate?: number;
  /** The owner typed this account's bank/name himself. Set by the rename action
   *  in Rekeningen so a re-import can't undo it — while a name that only ever
   *  came from an old parser stays replaceable by a better one. */
  renamed?: boolean };
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
  /** Where the flow came from. `prepayment` is a profit-tax prepayment or
   *  settlement demanded by the owner's country (see `taxpacks/`) — it is
   *  reserved and forecast exactly like a VAT set-aside, because it is the same
   *  problem: money in the account that was never the owner's. */
  source: "vat" | "invoice" | "manual" | "prepayment";
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

/** Per-entity (per-BV) tax config. Named `VatSettings` because that is all it
 *  held at first; it is now the entity's whole tax setup — which country's rules
 *  apply and, where that country prepays profit tax, how to size the
 *  prepayment. Every field after `manualCents` is optional, so a vault written
 *  before the country packs still decrypts and behaves exactly as it did
 *  (no country = NL). */
export type VatSettings = {
  entity: string;
  frequency: VatFrequency;
  defaultRatePct: number; // e.g. 21
  mixedRates: boolean;    // true => don't auto-estimate; manual-only
  manualCents?: number;   // manual override of the amount to set aside this period
  /** Which country's rule pack applies. Absent = "NL". */
  country?: CountryCode;
  /** Override of the pack's indicative profit-tax rate (%), e.g. a known
   *  Gewerbesteuer-Hebesatz or a different legal form. */
  profitTaxRatePct?: number;
  /** The amount the tax office actually assessed for one prepayment period, in
   *  cents. Set this and nothing is estimated — an assessment beats a guess. */
  profitTaxManualCents?: number;
};

/** What `VatSettings` has grown into. Same type, honest name — use this one in
 *  new code; the old name stays because the vault and the web lane use it. */
export type TaxSettings = VatSettings;
