import {
  type Account,
  type CardBalance,
  type CardRepayment,
  type CatalogueEntryLike,
  type HeldCardInput,
} from "@lavega/core";
import { OTHER_CARD } from "../intake/wizard/cardOptions";
import { statedHeldCard } from "./heldCards";
import { statedCardPlaceholders } from "./statedPlaceholders";

/** What the person told the intake wizard about cards. Optimalisatie reads it
 *  only to mark and explain cards it cannot see; connected data always wins. */
export type StatedAnswers = {
  credit: readonly string[];
  debit: readonly string[];
  repayment: CardRepayment | null;
  balances: readonly CardBalance[];
  noCards: boolean;
  /** When the answers were given; null when unknown. */
  statedAt: string | null;
};

export type StatedHeldRow = {
  id: string;
  kind: "credit" | "debit";
  label: string;
  /** The plan's own held row for this card: cashback is unknown, never zero. */
  card: HeldCardInput;
};

const PAYMENT_KIND = { credit: "creditcard", debit: "betaalpas" } as const;

/** The stated cards no connected account stands in for. Only payment cards:
 *  "other", investment accounts and interest products are left out. The
 *  "still stated" rule is the plan's (`statedCardPlaceholders`), not a copy. */
export function statedHeldRows(
  stated: StatedAnswers,
  accounts: readonly Account[],
  entries: readonly CatalogueEntryLike[],
): StatedHeldRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return statedCardPlaceholders({
    credit: stated.credit,
    debit: stated.debit,
    accounts,
    entries,
    otherLabels: { credit: "", debit: "" },
  }).flatMap((p): StatedHeldRow[] => {
    const entry = byId.get(p.id);
    if (p.id === OTHER_CARD || entry === undefined || entry.kind !== PAYMENT_KIND[p.kind])
      return [];
    return [{ id: p.id, kind: p.kind, label: p.name, card: statedHeldCard(entry) }];
  });
}
