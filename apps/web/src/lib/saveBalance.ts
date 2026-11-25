import { signedBalanceFor, type Account } from "@lavega/core";

/** The fields a typed balance sets on `account`, as of `asOf`; null for unreadable
 *  input. Blank clears the balance and its date. */
export function balancePatch(
  account: Account,
  value: string,
  asOf: string,
): Pick<Account, "balance" | "balanceDate"> | null {
  const trimmed = value.trim().replace(",", ".");
  const raw = trimmed === "" ? null : Number(trimmed);
  if (raw !== null && !Number.isFinite(raw)) return null;
  const balance = signedBalanceFor(account, raw);
  return { balance, balanceDate: balance === null ? undefined : asOf };
}

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
  const patch = balancePatch(account, value, asOf);
  if (patch === null) return null;
  const changed: Account = { ...account, ...patch };
  await store.putAccounts([changed]);
  return changed;
}
