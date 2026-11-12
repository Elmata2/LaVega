import { Schema } from "effect";
import type { Account } from "../model.js";
import { isInvestmentAccount } from "../transfers.js";
import type { PortfolioValuePoint } from "./portfolio.js";
import type { DeepMutable } from "./schema.js";
import { ProvenanceCitationSchema } from "../provenance.js";

/** One day's opted-in Personal total, as apps/server's
 *  personal.net_worth_totals row reports it. */
export const PersonalNetWorthTotalSchema = Schema.Struct({
  date: Schema.String,
  totalCents: Schema.Number,
  /* The agent-path citation for a valuation (#300, WS5.5). Absent on rows the
   * browser's own share flow wrote, which cites nothing because the owner is
   * looking at their own number. */
  provenance: Schema.optional(ProvenanceCitationSchema),
});

export type PersonalNetWorthTotal = DeepMutable<
  Schema.Schema.Type<typeof PersonalNetWorthTotalSchema>
>;

/** The read-model payload `/api/investing/personal-net-worth` answers with. */
export const PersonalNetWorthTotalsSchema = Schema.Struct({
  totals: Schema.Array(PersonalNetWorthTotalSchema),
});

/** The most recent stored total, which is the one whose citation the net worth
 *  page can show. Ties keep the later entry (the store lists oldest first). */
export function latestPersonalNetWorthTotal(
  totals: readonly PersonalNetWorthTotal[],
): PersonalNetWorthTotal | null {
  let latest: PersonalNetWorthTotal | null = null;
  for (const total of totals) if (!latest || total.date >= latest.date) latest = total;
  return latest;
}

export type NetWorthPoint = PortfolioValuePoint & {
  /** Personal's total in EUR, carried forward from the latest total on or
   *  before this date. Null on every date before the owner's first shared
   *  total, or when nothing has ever been shared — never a guessed 0. */
  personalValue: number | null;
  /** `value` (portfolio) and `personalValue` (Personal) added together,
   *  whichever of the two are known — the same "sum what's known, null only
   *  when nothing is" rule `computePortfolioValueSeries` already applies to
   *  positions and cash. This field exists only for the net worth chart;
   *  returns, risk and allocation must keep reading `value`, which this
   *  function never touches. */
  netWorth: number | null;
};

/** The accounts whose balances the Personal share may add to the net-worth
 *  bridge. Investment accounts are Investing's own figure: the portfolio series
 *  counts them, so adding their Personal balance too would count the same euro
 *  twice. A confirmed contribution moves money between the two sets, so this
 *  filter is also what keeps a contribution from reading as money lost.
 *
 *  The rule is the same `isInvestmentAccount` the transfer classification uses
 *  (WS4.7, #298), so the two sides cannot drift: what Personal excludes from
 *  the bridge is exactly what a transfer into it counts as a contribution. */
export function personalShareAccounts<T extends Account>(accounts: readonly T[]): T[] {
  return accounts.filter((account) => !isInvestmentAccount(account));
}

/**
 * Folds the owner's opted-in Personal totals into a portfolio value series,
 * for LaVega Investing's net worth chart only (packages/investing-web's
 * NetWorthChart/NetWorthPage). `points` and `totals` need not be sorted; ties
 * are broken by processing totals oldest first.
 *
 * `points` itself is returned unchanged in every other respect: this is an
 * additive read, not a rebuild of the portfolio series, so a caller that
 * still wants portfolio-only figures (returns, risk, allocation) keeps
 * reading `value`/`positionsValue`/`cashValue` off the same objects.
 *
 * The contract with the Personal sender (WS4.7): the total is bank money only
 * — `personalShareAccounts` excluded the investment accounts, because Investing
 * reports those. A contribution therefore lowers `personalValue` and raises the
 * portfolio `value` by the same cents, and `netWorth` is unchanged: the same
 * euro counted once, never lost.
 */
export function mergeInPersonalNetWorth(
  points: readonly PortfolioValuePoint[],
  totals: readonly PersonalNetWorthTotal[],
): { points: NetWorthPoint[]; latestPersonalDate: string | null } {
  const sortedTotals = [...totals].sort((a, b) => a.date.localeCompare(b.date));
  const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));

  let cursor = 0;
  let carried: number | null = null;
  const merged = sortedPoints.map((point) => {
    while (cursor < sortedTotals.length && sortedTotals[cursor]!.date <= point.date) {
      carried = sortedTotals[cursor]!.totalCents / 100;
      cursor += 1;
    }
    const reachable = [point.value, carried].filter((v): v is number => v !== null);
    return {
      ...point,
      personalValue: carried,
      netWorth: reachable.length === 0 ? null : reachable.reduce((sum, v) => sum + v, 0),
    };
  });

  return {
    points: merged,
    latestPersonalDate: sortedTotals.at(-1)?.date ?? null,
  };
}
