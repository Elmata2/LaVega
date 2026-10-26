import {
  childSignal,
  cleanTxs,
  historyCoverage,
  isSuppressed,
  makeProposal,
  personalView,
  proposeDebts,
  proposeFixedCosts,
  proposeHousing,
  proposeIncomeStreams,
  proposeSavings,
  scopedOwn,
  type Account,
  type AdvisorProfile,
  type ChildSignal,
  type DebtProposal,
  type EntityProfile,
  type FixedCostProposal,
  type HistoryCoverage,
  type HousingProposalCard,
  type IncomeProposal,
  type OwnAccounts,
  type Rule,
  type Tx,
} from "@lavega/core";
import type { SavingsCard } from "./state.js";

export type Block1Inference = {
  coverage: HistoryCoverage;
  hasTxs: boolean;
  income: IncomeProposal[];
  housing: HousingProposalCard | null;
  fixed: FixedCostProposal[];
  debts: DebtProposal[];
  savings: SavingsCard | null;
  child: ChildSignal | null;
};

export type InferenceInput = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  profiles: EntityProfile[];
  asOf: string;
  profile: AdvisorProfile;
};

/** Everything block 1 can propose, from the personal scope only (spec 10.1).
 *  Proposals the user removed ("Not mine") stay out until the evidence changes.
 *  Every proposer returns nothing below 60 days of history. */
export function inferBlock1(i: InferenceInput): Block1Inference {
  const view = personalView(i.accounts, i.txs, i.profiles);
  const coverage = historyCoverage(view.txs);
  const keep = <T extends { fingerprint: string }>(xs: T[]): T[] =>
    xs.filter((x) => !isSuppressed(i.profile, x.fingerprint));
  // Only personal-to-personal transfers cancel; a business account's salary
  // transfer into a personal account is income (the owner's names are kept).
  const own = scopedOwn(view.accounts, i.own);
  const opts = { asOf: i.asOf, rules: i.rules, own, accounts: view.accounts };

  const income = keep(proposeIncomeStreams(view.txs, opts));
  const clean = cleanTxs(view.txs, view.accounts, i.rules, own);
  const housingRaw = proposeHousing(clean, i.rules, i.own);
  const housing = housingRaw !== null && keep([housingRaw]).length > 0 ? housingRaw : null;
  const fixed = keep(proposeFixedCosts(view.txs, opts)).filter((f) => f.data.origin !== "housing");
  // A mortgage payment is housing, never also a debt ("aflossing" is a lender word).
  const housingEvidence = new Set(housing?.evidence ?? []);
  const debts = keep(
    proposeDebts(view.txs, view.accounts, { asOf: i.asOf, rules: i.rules, own }),
  ).filter((d) => !d.evidence.some((e) => housingEvidence.has(e)));

  const s = proposeSavings(view.accounts);
  const savingsRaw: SavingsCard | null =
    s.totalCents > 0
      ? makeProposal(
          "savings",
          s.accountKeys.map((k) => `account:${k}`),
          { totalCents: s.totalCents, excluded: s.excluded },
        )
      : null;
  const savings = savingsRaw !== null && keep([savingsRaw]).length > 0 ? savingsRaw : null;

  return {
    coverage,
    hasTxs: view.txs.length > 0,
    income,
    housing,
    fixed,
    debts,
    savings,
    child: childSignal(view.txs, i.rules, own),
  };
}

/** A card debt whose account has neither name nor bank carries the account KEY
 *  as its lender (core stays free of prose). The UI swaps in a generic label so
 *  a key such as a file name is never shown or stored as a lender. */
export function withLenderLabel(
  proposal: DebtProposal,
  accounts: readonly Account[],
  fallback: string,
): DebtProposal {
  if (proposal.data.origin !== "creditCard") return proposal;
  const a = accounts.find((x) => x.key === proposal.data.lender);
  if (a === undefined || (a.name ?? "").trim() !== "" || (a.bank ?? "").trim() !== "")
    return proposal;
  return { ...proposal, data: { ...proposal.data, lender: fallback } };
}
