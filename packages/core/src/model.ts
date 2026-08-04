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

/** Per-entity (per-BV) VAT/BTW config for the set-aside estimate. */
export type VatSettings = {
  entity: string;
  frequency: "monthly" | "quarterly" | "yearly";
  defaultRatePct: number; // e.g. 21
  mixedRates: boolean;    // true => don't auto-estimate; manual-only
  manualCents?: number;   // manual override of the amount to set aside this period
};
