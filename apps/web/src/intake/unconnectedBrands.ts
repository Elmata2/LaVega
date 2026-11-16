import {
  connectChecklist,
  type Account,
  type AdvisorProfileStore,
  type ConnectItem,
} from "@lavega/core";
import { brandOfCardId } from "./wizard/cardOptions.js";

/** The brands still without a live bank link, from the stated banks plus the
 *  banks the stated cards belong to. */
export function unconnectedItems(
  store: AdvisorProfileStore | null,
  accounts: readonly Pick<Account, "bank" | "linkedAt" | "source">[],
): ConnectItem[] {
  const p = store?.current;
  const implied = [
    ...(p?.statedCards?.value ?? []).map((id) => brandOfCardId(id, "credit")),
    ...(p?.statedDebitCards?.value ?? []).map((id) => brandOfCardId(id, "debit")),
  ].filter((b): b is NonNullable<typeof b> => b !== null);
  return connectChecklist({
    statedBanks: p?.statedBanks?.value ?? [],
    impliedBanks: implied,
    accounts,
  }).filter((i) => !i.connected);
}

/** The brand ids only, for callers that do not care about the route. */
export function unconnectedBrands(
  store: AdvisorProfileStore | null,
  accounts: readonly Pick<Account, "bank" | "linkedAt" | "source">[],
): string[] {
  return unconnectedItems(store, accounts).map((i) => i.brand);
}
