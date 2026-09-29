import type { Account, ConversionMode, Tx } from "@lavega/core";
import { isEurCurrency, toEur } from "@lavega/core";
import { daysBetween, shiftDate } from "./components/blocks/dates.js";

/* Totale positie — the most important number on the homescreen (SaldoBlock),
 * and the same figure netWorthShare.ts sends to LaVega Investing when the
 * owner opts in. Moved out of SaldoBlock.tsx (a UI component) so a non-UI
 * caller can import the computation without also pulling in React and every
 * Module/CardLink/TrendChart dependency that file carries; SaldoBlock.tsx
 * re-exports everything here unchanged, so nothing that already imports from
 * it needs to change.
 *
 * The number is the sum of the balances LaVega actually knows. The graph is
 * that number walked BACKWARDS through the transactions of those same
 * accounts: the closing position on day d is today's position minus everything
 * that landed after d. That makes the line exact for every day the transaction
 * history covers — and undefined before it.
 *
 * The undefined part is the whole reason this is careful. Walking back
 * past the oldest transaction we hold would draw a perfectly flat line, and a
 * flat line reads as "your position did not move", which is a claim about
 * money we cannot make. So the series STOPS at the oldest transaction, the
 * week/month comparisons are null rather than 0% when the history is shorter
 * than the period they name, and the card says so in words.
 *
 * Accounts without a saldo are excluded from BOTH the number and the walk, so
 * the two can never disagree; the card names how many were left out. */

/** How far back the graph draws, at most. A month is the longest comparison
 *  the card makes, so there is nothing to gain from a longer line. */
export const POSITION_WINDOW_DAYS = 30;

export type PositionPoint = { date: string; value: number };

export type PositionSeries = {
  /** Daily closing positions, oldest first. Empty when there is no history. */
  points: PositionPoint[];
  /** The position now, in euros: the sum of the KNOWN balances. */
  current: number;
  /** The position exactly 7 / 30 days ago, or null when the transaction
   *  history does not reach that far back. Never 0 as a stand-in. */
  weekAgo: number | null;
  monthAgo: number | null;
  /** How far back EVERY contributing account has history — not the union.
   *  Rolling the position back past the shortest-covered account treats a
   *  newly imported balance as if it had been constant all along, which is how
   *  a comparison invents a change nobody made. */
  coverageDays: number;
  /** Accounts whose history is what limits `coverageDays`, so the card can say
   *  which import would unlock the comparison instead of just refusing it. */
  limitedBy: string[];
  /** Accounts left out because their saldo is unknown, OR because it is in a
   *  currency other than EUR (see `isEurCurrency`) — a balance LaVega cannot
   *  fold into this total honestly, so it stays out instead of being added at
   *  face value. */
  excluded: number;
  /** Of `excluded`, the ones WITH a known balance that is simply not in EUR —
   *  named separately so the card can say "vreemde valuta" instead of the
   *  misleading "zonder saldo" it would otherwise print for them. */
  excludedCurrencyKeys: string[];
};

/** The total position over time, derived from the transactions alone. Pure, so
 *  the numbers under the graph are testable without a DOM. */
export function positionSeries(
  accounts: Account[],
  txs: Tx[],
  asOf: string,
  windowDays: number = POSITION_WINDOW_DAYS,
  conversion: { fxHistory: Record<string, Record<string, number>>; mode: ConversionMode },
): PositionSeries {
  const eurBalanceOf = (a: Account): number | null => {
    if (a.balance === null) return null;
    if (isEurCurrency(a.currency)) return a.balance;
    return conversion.mode === "convert"
      ? toEur(a.balance, a.currency, asOf, conversion.fxHistory)
      : null;
  };
  const known = accounts.filter((a) => eurBalanceOf(a) !== null);
  const keys = new Set(known.map((a) => a.key));
  // Integer cents throughout the walk: a 30-step float subtraction over a
  // six-figure position drifts into visible cents.
  const currentCents = known.reduce((s, a) => s + Math.round((eurBalanceOf(a) as number) * 100), 0);
  const excluded = accounts.length - known.length;
  // An account that DID convert is no longer "excluded" — the kept-out line
  // is only for a balance that stayed unresolved into EUR.
  const excludedCurrencyKeys = accounts
    .filter((a) => a.balance !== null && !isEurCurrency(a.currency) && eurBalanceOf(a) === null)
    .map((a) => a.key);
  const base = { current: currentCents / 100, excluded, excludedCurrencyKeys };

  const relevant = txs.filter((t) => keys.has(t.accountKey) && t.date <= asOf);
  if (relevant.length === 0) {
    return {
      ...base,
      points: [],
      weekAgo: null,
      monthAgo: null,
      coverageDays: 0,
      limitedBy: known.map((a) => a.key),
    };
  }

  // Coverage is the SHORTEST-covered account, never the union. If ABN reaches
  // back a year and a card was imported yesterday, the position is only known
  // as far back as yesterday: before that, that card's balance is assumed
  // rather than derived. An account with a balance and no transactions at all
  // limits coverage to nothing, because "no movements" and "not imported" are
  // indistinguishable from here — and guessing between them is exactly the
  // mistake the month comparison was just fixed for.
  const startByKey = new Map<string, string>();
  for (const t of relevant) {
    const prev = startByKey.get(t.accountKey);
    if (prev === undefined || t.date < prev) startByKey.set(t.accountKey, t.date);
  }
  const noHistory = known.filter((a) => !startByKey.has(a.key));
  const latestStart = [...startByKey.values()].reduce((a, b) => (a > b ? a : b));
  const earliest = relevant.reduce((a, t) => (t.date < a ? t.date : a), relevant[0].date);
  const coverageDays = noHistory.length > 0 ? 0 : Math.max(0, daysBetween(latestStart, asOf));
  const limitedBy =
    noHistory.length > 0
      ? noHistory.map((a) => a.key)
      : known.filter((a) => startByKey.get(a.key) === latestStart).map((a) => a.key);

  const net = new Map<string, number>();
  for (const t of relevant) {
    const eurAmount = isEurCurrency(t.currency)
      ? t.amount
      : conversion.mode === "convert"
        ? (toEur(t.amount, t.currency, t.date, conversion.fxHistory) ?? 0)
        : 0;
    // A missing single-day rate falls back to 0 rather than breaking the
    // walk: it only smears the SHAPE of the historical line for that one
    // day, not the current total (which comes from eurBalanceOf, not this
    // loop), and rateOn's own 10-day walk-back makes an actual gap rare.
    net.set(t.date, (net.get(t.date) ?? 0) + Math.round(eurAmount * 100));
  }

  // Never earlier than the oldest transaction: before it the position is not
  // known, it is merely unrecorded.
  const start =
    coverageDays >= windowDays
      ? shiftDate(asOf, -windowDays)
      : coverageDays > 0
        ? latestStart
        : earliest;
  const back: PositionPoint[] = [{ date: asOf, value: currentCents / 100 }];
  let cents = currentCents;
  for (let d = shiftDate(asOf, -1); d >= start; d = shiftDate(d, -1)) {
    // Closing on d = closing on d+1 minus what moved on d+1.
    cents -= net.get(shiftDate(d, 1)) ?? 0;
    back.push({ date: d, value: cents / 100 });
  }
  const points = back.reverse();

  const at = (date: string): number | null => points.find((p) => p.date === date)?.value ?? null;
  return {
    ...base,
    points,
    coverageDays,
    limitedBy,
    weekAgo: coverageDays >= 7 ? at(shiftDate(asOf, -7)) : null,
    monthAgo: coverageDays >= 30 ? at(shiftDate(asOf, -30)) : null,
  };
}
