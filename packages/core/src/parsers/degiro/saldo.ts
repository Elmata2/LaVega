import type { CurrencyAmount } from "./read.js";

/* The account statement's `Saldo` walk (#315).
 *
 * `Saldo` is the running balance of the row's currency after that row, and the
 * file is newest first. Per currency, walking the file in reverse gives
 * `Saldo[n] = Saldo[n-1] + Mutatie[n]`. That walk is the only evidence the
 * import has for `status: "complete"` coverage (#317), so a break must name the
 * row a user can find in the export, never just a boolean.
 *
 * The caller has already removed the rows that stay out of the walk: the
 * `Degiro Cash Sweep Transfer` (its `Saldo` is the flatex-bank leg) and every
 * row with an empty `Mutatie`. This module therefore does pure arithmetic and
 * never guesses which rows should have been dropped.
 */

/** One row that takes part in the walk, in FILE order (newest first). */
export type SaldoRow = {
  /** 1-based source line, for the problem text. */
  line: number;
  /** The row's `Mutatie`: its currency and signed amount. */
  change: CurrencyAmount;
  /** The row's `Saldo`: the running balance after the row. */
  balance: CurrencyAmount;
};

export type SaldoWalk = {
  /** True when every step held for every currency. */
  ok: boolean;
  /** One entry per failed step, in file order; empty when `ok`. */
  problems: string[];
  /** Closing balance per currency: the newest reported balance for it. */
  closing: Map<string, number>;
};

/** Inclusive cents rounding: the files report two decimals, so a step may be off by half a cent. */
export const SALDO_TOLERANCE = 0.005;

/** Trim floating noise for problem text; the files report at most two decimals. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Prove the running balance per currency against the `Mutatie` amounts.
 *
 * The given order is reversed, never sorted: a trade, its commission row and
 * its AutoFX legs share one `Datum`+`Tijd`, so only file order is the true
 * chronological order. The first row a currency shows has no predecessor, which
 * is not a failure: the file proves only the window it covers.
 *
 * A failed step adopts the reported balance as the new running total, so one
 * rounding difference does not cascade into a problem on every later row. A row
 * whose `Mutatie` and `Saldo` currencies disagree proves nothing and is treated
 * as a reset of its `Saldo` currency; the two currencies never share a total.
 * Never throws.
 */
export function walkSaldo(rows: readonly SaldoRow[]): SaldoWalk {
  const problems: string[] = [];
  const running = new Map<string, number>();
  const closing = new Map<string, number>();

  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    const change = row.change;
    const reported = row.balance.amount;

    if (change.currency !== row.balance.currency) {
      problems.push(
        `rij ${row.line}: mutatie in ${change.currency} maar saldo in ${row.balance.currency}`,
      );
      running.set(row.balance.currency, reported);
      closing.set(row.balance.currency, reported);
      continue;
    }

    const previous = running.get(change.currency);
    if (previous === undefined) {
      running.set(change.currency, reported);
      closing.set(change.currency, reported);
      continue;
    }

    const expected = previous + change.amount;
    if (Math.abs(expected - reported) > SALDO_TOLERANCE) {
      problems.push(
        `rij ${row.line}: saldo ${change.currency} is ${round2(reported)}, ` +
          `verwacht ${round2(expected)} (${round2(previous)} + ${round2(change.amount)})`,
      );
    }

    // Adopt the reported balance either way, so a single bad row stops there.
    running.set(change.currency, reported);
    closing.set(change.currency, reported);
  }

  /* The walk visits oldest first; the file reads newest first. Flip the log so
   * the caller shows problems top-to-bottom of the export, as the API promises. */
  problems.reverse();
  return { ok: problems.length === 0, problems, closing };
}
