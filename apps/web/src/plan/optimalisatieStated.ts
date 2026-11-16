import {
  accountType,
  carriesCardDebt,
  type Account,
  type CardAdvice,
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

/** The plan's one answer to "does this person carry card debt". */
export function cardDebtStated(stated: StatedAnswers | undefined): boolean {
  return (
    stated !== undefined &&
    carriesCardDebt({
      cardRepayment: stated.repayment,
      cardBalances: stated.balances,
    })
  );
}

/** Why the person is taken to carry card debt: the repayment answer says they
 *  do not always pay in full, or a stated card holds an unpaid balance. */
export type CardDebtReason = "not-in-full" | "balance";

export function cardDebtReason(stated: StatedAnswers | undefined): CardDebtReason | null {
  if (!cardDebtStated(stated)) return null;
  return stated!.repayment === "sometimes" || stated!.repayment === "rarely"
    ? "not-in-full"
    : "balance";
}

/** The wizard's "Geen creditcard" answer is about CREDIT cards only. The
 *  first-credit-card framing applies when that was answered and no credit card
 *  is held, stated or connected; a debit card or a current account does not
 *  count as one. */
export function firstCreditCardApplies(
  stated: StatedAnswers | undefined,
  accounts: readonly Account[],
): boolean {
  return (
    stated !== undefined &&
    stated.noCards &&
    stated.credit.length === 0 &&
    !accounts.some((a) => accountType(a) === "Creditcard")
  );
}

export type FirstCardOutcome =
  | { kind: "no-spend" }
  | { kind: "too-little" }
  | { kind: "worth-it"; card: string; gainCents: number }
  | { kind: "not-worth-it" }
  | { kind: "none-comparable" };

/** The plan's verdict (`noCardAdvice`) as one outcome for the screen. Fewer
 *  full months than the plan's minimum gives no figure and no verdict. */
export function firstCardOutcome(advice: CardAdvice): FirstCardOutcome {
  if (advice.state === "short-history")
    return advice.spend.months === 0 ? { kind: "no-spend" } : { kind: "too-little" };
  if (advice.state === "no-spend") return { kind: "no-spend" };
  const v = advice.verdict;
  if (v.kind === "switch") return { kind: "worth-it", card: v.best.name, gainCents: v.gainCents };
  return v.kind === "no-card-worth-it" ? { kind: "not-worth-it" } : { kind: "none-comparable" };
}
