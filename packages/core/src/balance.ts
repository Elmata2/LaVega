import type { Account, Tx } from "./model.js";

/** A credit-card account: a manually-entered saldo is the amount OWED, so it
 *  counts as NEGATIVE (debt) in the net position while the UI shows the owed
 *  amount as a positive. Detected by bank name for now (Amex is always a card);
 *  extend as more card sources are added. */
export function isCardAccount(a: Account): boolean {
  return a.bank === "American Express";
}

/** Current balance rolled forward to `asOf`: stored balance + the txs that fall
 *  strictly AFTER balanceDate and on/before asOf. A null balance stays null
 *  (unknown). No balanceDate => the balance is already current (returned as-is). */
export function currentBalance(account: Account, txs: Tx[], asOf: string): number | null {
  if (account.balance === null) return null;
  const d = account.balanceDate;
  if (!d) return account.balance;
  let sumCents = 0;
  for (const t of txs) {
    if (t.accountKey === account.key && t.date > d && t.date <= asOf) {
      sumCents += Math.round(t.amount * 100);
    }
  }
  return account.balance + sumCents / 100;
}

/** Map accounts to the same accounts with `balance` replaced by currentBalance,
 *  so consolidate/forecast/display all see the rolled-forward position. */
export function withCurrentBalances(accounts: Account[], txs: Tx[], asOf: string): Account[] {
  return accounts.map((a) => ({ ...a, balance: currentBalance(a, txs, asOf) }));
}
