import type { Account, Rule, Tx } from "../model.js";
import { accountType, currentBalance } from "../balance.js";
import { isEurCurrency } from "../model.js";
import { detectScheduleStreams, type ScheduleStream } from "../subscriptions.js";
import { looksLikeLender } from "./lenders.js";
import { streamMonthlyCents, type ProposerOptions } from "./incomeStreams.js";
import { makeProposal, type DataProposal } from "./proposals.js";
import { cleanTxs, historyCoverage } from "./scopePersonal.js";

export type DebtData = {
  lender: string;
  /** null for a card: the repayment is not a fixed figure. */
  monthlyCents: number | null;
  balanceCents?: number;
  origin: "stream" | "creditCard";
};
export type DebtProposal = DataProposal<"debt", DebtData>;

/** True when any of these member transactions names a lender, in counterparty
 *  or description. The one debt test: streams and subscriptions both use it. */
export function txsAreDebt(ids: readonly string[], byId: ReadonlyMap<string, Tx>): boolean {
  return ids.some((id) => {
    const t = byId.get(id);
    return t !== undefined && looksLikeLender(`${t.counterparty} ${t.description}`);
  });
}

/** True when the stream's label or any of its member transactions name a lender. */
export function streamIsDebt(s: ScheduleStream, byId: ReadonlyMap<string, Tx>): boolean {
  if (s.sign !== -1) return false;
  return looksLikeLender(s.label) || txsAreDebt(s.txIds, byId);
}

export const indexTxs = (txs: readonly Tx[]): Map<string, Tx> => new Map(txs.map((t) => [t.id, t]));

/** Debts the data shows: outgoing streams to a known lender, and credit-card
 *  accounts that stand negative (EUR only). A card's evidence is the account
 *  itself (`account:<key>`) so a new swipe does not revive a removed card. */
export function proposeDebts(
  txs: readonly Tx[],
  accounts: readonly Account[],
  opts: Omit<ProposerOptions, "accounts">,
): DebtProposal[] {
  if (!historyCoverage(txs).sufficient) return [];
  const clean = cleanTxs(txs, [...accounts], opts.rules as Rule[], opts.own);
  const byId = indexTxs(clean);

  const fromStreams = detectScheduleStreams(clean, { asOf: opts.asOf })
    .filter((s) => streamIsDebt(s, byId))
    .map((s) =>
      makeProposal("debt", s.txIds, {
        lender: s.label,
        monthlyCents: streamMonthlyCents(s.amountCents, s.cadenceDays),
        origin: "stream" as const,
      }),
    );

  const fromCards: DebtProposal[] = [];
  for (const a of accounts) {
    if (accountType(a) !== "Creditcard" || !isEurCurrency(a.currency)) continue;
    const bal = currentBalance(a, [...txs], opts.asOf);
    if (bal === null || bal >= 0) continue;
    const p = makeProposal("debt", [`account:${a.key}`], {
      // Never empty (Id min length): the key is the last resort; the UI relabels it.
      lender: a.name || a.bank || a.key,
      monthlyCents: null,
      balanceCents: Math.round(-bal * 100),
      origin: "creditCard" as const,
    });
    fromCards.push({ ...p, confidence: "enough" });
  }
  return [...fromStreams, ...fromCards];
}
