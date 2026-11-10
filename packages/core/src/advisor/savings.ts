import type { Account } from "../model.js";
import { isEurCurrency } from "../model.js";
import { accountTypeKind } from "../balance.js";

export type SavingsProposal = {
  totalCents: number;
  accountKeys: string[];
  /** Positive savings balances left out because they are not in euros. */
  excluded: number;
};

/** Positive EUR balances on savings accounts. A foreign pocket is counted in
 *  `excluded`, never added at face value. */
export function proposeSavings(accounts: readonly Account[]): SavingsProposal {
  let totalCents = 0;
  let excluded = 0;
  const accountKeys: string[] = [];
  for (const a of accounts) {
    if (accountTypeKind(a) !== "savings" || a.balance === null || a.balance <= 0) continue;
    if (!isEurCurrency(a.currency)) {
      excluded += 1;
      continue;
    }
    totalCents += Math.round(a.balance * 100);
    accountKeys.push(a.key);
  }
  return { totalCents, accountKeys, excluded };
}
