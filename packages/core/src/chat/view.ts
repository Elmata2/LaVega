import type { Account, Rule, ScheduledFlow, Tx } from "../model.js";
import type { Bill, BillOccurrence } from "../bills/model.js";
import type { PlanResult } from "../plan/compute.js";

export type ChatLocale = "nl" | "en";

/** Everything a chat tool may read: the unlocked vault, as loaded in the browser.
 *  Tools never write and never reach past this view. `plan` is null when the
 *  owner has no computed plan. `asOf` is the user's calendar day, never a clock. */
export type VaultView = {
  asOf: string;
  locale: ChatLocale;
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  bills: Bill[];
  occurrences: BillOccurrence[];
  flows: ScheduledFlow[];
  plan: PlanResult | null;
  /** Which half of the money the lists above are about ("persoonlijk", "zakelijk" ...),
   *  as the owner has it selected. Echoed in every result so the answer can say so. */
  scope?: string;
};
