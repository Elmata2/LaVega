import { signedBalanceFor, type Account } from "@lavega/core";

/** Store the balance the user typed for one account, as of `asOf`. Accepts a Dutch
 *  comma or a dot decimal; blank clears it back to unknown. The write comes FIRST:
 *  it returns the stored account only after `putAccounts` resolved, and a failed
 *  write rejects, so the caller never shows a value that was not saved. Returns
 *  null for unreadable input (nothing is written). */
export async function saveBalance(
  store: { putAccounts(a: Account[]): Promise<void> },
  account: Account,
  value: string,
  asOf: string,
): Promise<Account | null> {
  const trimmed = value.trim().replace(",", ".");
  const raw = trimmed === "" ? null : Number(trimmed);
  if (raw !== null && !Number.isFinite(raw)) return null;
  const balance = signedBalanceFor(account, raw);
  const changed: Account = {
    ...account,
    balance,
    balanceDate: balance === null ? undefined : asOf,
  };
  await store.putAccounts([changed]);
  return changed;
}
