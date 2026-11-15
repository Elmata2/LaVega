import type { Rule, Tx } from "../model.js";
import { proposeHousingCost, type HousingKind } from "../housing.js";
import type { OwnAccounts } from "../views.js";
import { makeProposal, type DataProposal } from "./proposals.js";
import { historyCoverage } from "./scopePersonal.js";

export type HousingData = {
  housingKind: HousingKind;
  counterparty: string;
  monthlyCents: number;
};
export type HousingProposalCard = DataProposal<"housing", HousingData>;

/** Same band `detectRecurringStreams` accepts around the median amount. */
const AMOUNT_TOLERANCE = 0.25;

/** Callers must pass cleaned txs (`cleanTxs`): own transfers and card settlements out.
 *  `proposeHousingCost` plus the ids of the payments behind it: outflows to the
 *  chosen counterparty within the stream's amount tolerance. */
export function proposeHousing(
  txs: readonly Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
): HousingProposalCard | null {
  if (!historyCoverage(txs).sufficient) return null;
  const p = proposeHousingCost([...txs], rules, own);
  if (p === null) return null;
  const centre = (p.monthlyCents * 30) / p.cadenceDays;
  const evidence = txs
    .filter(
      (t) =>
        t.amount < 0 &&
        t.counterparty === p.counterparty &&
        Math.abs(Math.abs(t.amount) * 100 - centre) <= centre * AMOUNT_TOLERANCE,
    )
    .map((t) => t.id);
  if (evidence.length === 0) return null;
  return makeProposal("housing", evidence, {
    housingKind: p.kind,
    counterparty: p.counterparty,
    monthlyCents: p.monthlyCents,
  });
}
