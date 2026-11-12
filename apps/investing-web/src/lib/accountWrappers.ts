import type { AccountWrapper, AccountWrapperEntry } from "@lavega/core";

/** Account tax-treatment labels (plan §3 WS4.4, #296). The report already
 *  carries every account and its current wrapper, so a save sends the whole
 *  map derived from the report plus the one change. Returns whether the write
 *  reached the server; the caller decides what to show. */
export async function saveAccountWrappers(
  entries: readonly AccountWrapperEntry[],
): Promise<boolean> {
  try {
    const response = await fetch("/api/investing/account-wrappers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function withWrapper(
  entries: readonly AccountWrapperEntry[],
  broker: string,
  account: string,
  wrapper: AccountWrapper,
): AccountWrapperEntry[] {
  const replaced = entries.filter(
    (entry) => !(entry.broker === broker && entry.account === account),
  );
  return [...replaced, { broker, account, wrapper }];
}
