import { connectChecklist, type Account, type AdvisorProfileStore } from "@lavega/core";
import { brandOfCardId } from "./wizard/cardOptions.js";

/** The brands still without a live bank link, from the stated banks plus the
 *  banks the stated cards belong to. */
export function unconnectedBrands(
  store: AdvisorProfileStore | null,
  accounts: readonly Pick<Account, "bank" | "linkedAt">[],
): string[] {
  const p = store?.current;
  const implied = [
    ...(p?.statedCards?.value ?? []).map((id) => brandOfCardId(id, "credit")),
    ...(p?.statedDebitCards?.value ?? []).map((id) => brandOfCardId(id, "debit")),
  ].filter((b): b is NonNullable<typeof b> => b !== null);
  return connectChecklist({
    statedBanks: p?.statedBanks?.value ?? [],
    impliedBanks: implied,
    accounts,
  })
    .filter((i) => !i.connected)
    .map((i) => i.brand);
}
