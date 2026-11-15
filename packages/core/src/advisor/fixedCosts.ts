import type { Tx } from "../model.js";
import { detectScheduleStreams, detectSubscriptions } from "../subscriptions.js";
import { indexTxs, streamIsDebt, txsAreDebt } from "./debts.js";
import { proposeHousing } from "./housingProposal.js";
import { streamMonthlyCents, type ProposerOptions } from "./incomeStreams.js";
import { looksLikeLender } from "./lenders.js";
import { makeProposal, type DataProposal } from "./proposals.js";
import { cleanTxs, historyCoverage } from "./scopePersonal.js";

export type FixedCostData = {
  label: string;
  monthlyCents: number;
  origin: "housing" | "stream" | "subscription";
};
export type FixedCostProposal = DataProposal<"housing" | "fixedCost", FixedCostData>;

const overlaps = (ids: readonly string[], used: ReadonlySet<string>): boolean =>
  ids.some((id) => used.has(id));

/** THE fixed-costs definition: the housing line, plus recurring outgoing
 *  streams, plus subscriptions. Debt repayments are not in it, and no
 *  transaction backs two lines (housing first, then streams, then the
 *  subscriptions no stream already covers). */
export function proposeFixedCosts(txs: readonly Tx[], opts: ProposerOptions): FixedCostProposal[] {
  if (!historyCoverage(txs).sufficient) return [];
  const clean = cleanTxs(txs, opts.accounts, opts.rules, opts.own);
  const byId = indexTxs(clean);
  const used = new Set<string>();
  const out: FixedCostProposal[] = [];

  const housing = proposeHousing(clean, opts.rules, opts.own);
  if (housing !== null) {
    for (const id of housing.evidence) used.add(id);
    out.push(
      makeProposal("housing", housing.evidence, {
        label: housing.data.counterparty,
        monthlyCents: housing.data.monthlyCents,
        origin: "housing" as const,
      }),
    );
  }

  for (const s of detectScheduleStreams(clean, { asOf: opts.asOf })) {
    if (s.sign !== -1 || streamIsDebt(s, byId) || overlaps(s.txIds, used)) continue;
    for (const id of s.txIds) used.add(id);
    out.push(
      makeProposal("fixedCost", s.txIds, {
        label: s.label,
        monthlyCents: streamMonthlyCents(s.amountCents, s.cadenceDays),
        origin: "stream" as const,
      }),
    );
  }

  for (const sub of detectSubscriptions(clean, { asOf: opts.asOf })) {
    if (overlaps(sub.txIds, used) || looksLikeLender(sub.name) || txsAreDebt(sub.txIds, byId))
      continue;
    for (const id of sub.txIds) used.add(id);
    out.push(
      makeProposal("fixedCost", sub.txIds, {
        label: sub.name,
        monthlyCents: sub.monthlyCents,
        origin: "subscription" as const,
      }),
    );
  }
  return out;
}
