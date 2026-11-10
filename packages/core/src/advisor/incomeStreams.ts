import type { Account, Rule, Tx } from "../model.js";
import { detectScheduleStreams, scheduleParty } from "../subscriptions.js";
import { categorize, type OwnAccounts } from "../views.js";
import { isoMonth, monthsBetween } from "./months.js";
import { makeProposal, type DataProposal } from "./proposals.js";
import { cleanTxs, historyCoverage } from "./scopePersonal.js";

export type IncomeData = {
  label: string;
  monthlyCents: number;
  regularity: "regular" | "irregular";
};
export type IncomeProposal = DataProposal<"income", IncomeData>;

export type ProposerOptions = {
  asOf: string;
  rules: Rule[];
  own: OwnAccounts;
  accounts: Account[];
};

/** A stream's cents normalised to a month, the way the detectors do it. */
export const streamMonthlyCents = (amountCents: number, cadenceDays: number): number =>
  Math.round((amountCents * 30) / cadenceDays);

/** Income the data shows. Regular = an incoming schedule stream (cadence bands
 *  as detected, so a 2-occurrence quarterly counts and a 2-occurrence monthly
 *  does not). Irregular = incoming "Inkomen" money from counterparties that
 *  are in no stream, averaged over the calendar months the history covers. */
export function proposeIncomeStreams(txs: readonly Tx[], opts: ProposerOptions): IncomeProposal[] {
  if (!historyCoverage(txs).sufficient) return [];
  const clean = cleanTxs(txs, opts.accounts, opts.rules, opts.own);

  const streams = detectScheduleStreams(clean, { asOf: opts.asOf }).filter((s) => s.sign === 1);
  const regular = streams.map((s) =>
    makeProposal("income", s.txIds, {
      label: s.label,
      monthlyCents: streamMonthlyCents(s.amountCents, s.cadenceDays),
      regularity: "regular" as const,
    }),
  );

  const inStream = new Set(streams.flatMap((s) => s.txIds));
  const byParty = new Map<string, { label: string; ids: string[]; cents: number }>();
  let first = "";
  let last = "";
  for (const t of clean) {
    if (!t.date) continue;
    if (first === "" || t.date < first) first = t.date;
    if (last === "" || t.date > last) last = t.date;
  }
  for (const t of clean) {
    if (t.amount <= 0 || !t.date || inStream.has(t.id)) continue;
    if (categorize(t, opts.rules, opts.own) !== "Inkomen") continue;
    const party = scheduleParty(t.counterparty, t.description);
    if (party.key === "") continue;
    const g = byParty.get(party.key) ?? { label: party.label, ids: [], cents: 0 };
    g.ids.push(t.id);
    g.cents += Math.round(t.amount * 100);
    byParty.set(party.key, g);
  }
  const covered =
    first === "" ? 1 : monthsBetween(`${isoMonth(first)}-01`, `${isoMonth(last)}-01`) + 1;
  const irregular = [...byParty.values()].map((g) =>
    makeProposal("income", g.ids, {
      label: g.label,
      monthlyCents: Math.round(g.cents / covered),
      regularity: "irregular" as const,
    }),
  );

  return [...regular, ...irregular];
}
