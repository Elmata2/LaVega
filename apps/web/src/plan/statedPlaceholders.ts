import { bankMatchesBrand, type Account, type CatalogueEntryLike } from "@lavega/core";
import { OTHER_CARD, brandOfCardId, cardLabel, type CardBrand } from "../intake/wizard/cardOptions";
import { heldCatalogueIds } from "./heldCards";

export type StatedPlaceholder = {
  id: string;
  kind: "credit" | "debit";
  name: string;
  brand: CardBrand | null;
};

type PlaceholderInput = {
  credit: readonly string[];
  debit: readonly string[];
  accounts: readonly Account[];
  entries: readonly CatalogueEntryLike[];
  /** Names for the "another card" choice; the caller passes the copy. */
  otherLabels: { credit: string; debit: string };
};

/** The cards the person said they have that no real account stands in for yet:
 *  a credit card until the bank data holds its catalogue id, a debit card until
 *  a live bank link (not a file import) carries its bank. */
export function statedCardPlaceholders(i: PlaceholderInput): StatedPlaceholder[] {
  const other = i.otherLabels;
  const held = heldCatalogueIds(i.accounts, i.entries);
  const byId = new Map(i.entries.map((e) => [e.id, e]));
  const linked = i.accounts.filter((a) => a.linkedAt !== undefined);
  const out: StatedPlaceholder[] = [];
  for (const kind of ["credit", "debit"] as const) {
    for (const id of new Set(kind === "credit" ? i.credit : i.debit)) {
      const brand = id === OTHER_CARD ? null : brandOfCardId(id, kind);
      if (kind === "credit" && held.has(id)) continue;
      if (kind === "debit" && brand !== null && linked.some((a) => bankMatchesBrand(a.bank, brand)))
        continue;
      const picked = cardLabel(id, other[kind], kind);
      const name =
        id === OTHER_CARD ? other[kind] : picked === id ? (byId.get(id)?.product ?? id) : picked;
      out.push({ id, kind, name, brand });
    }
  }
  return out;
}
