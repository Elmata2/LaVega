/**
 * Balance series (WS3.2, issue #291).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/balance/base_calculator.rb`,
 * `balance/forward_calculator.rb`, `balance/reverse_calculator.rb`,
 * `balance/materializer.rb`. No Ruby is copied.
 *
 * Sure materializes a daily `Balance` row per account: a FORWARD replay from the
 * opening anchor for manual accounts, and a REVERSE replay from the newest
 * anchor for linked/imported accounts. A valuation is an absolute waypoint, not
 * an interpolation: the day it is dated on takes the amount as-is, and the
 * ledger flows move the series only before/after it.
 *
 * LaVega differences, each deliberate: integer cents everywhere (ADR 0011), no
 * clock (`asOf` is an argument), no persistence (the series is derived on read,
 * so there is nothing to purge or materialize), and an UNKNOWN day is `null` —
 * a gap, never zero (ADR 0011 §8). Sure's holdings/market-value machinery is out
 * of scope: WS3.1 adds asset/liability kinds and dated valuations, not an
 * investment price feed (that lives in the investing lane).
 */
import type { Account, Tx } from "./model.js";
import {
  accountAnchors,
  accountClassification,
  accountTypeKind,
  isDepositoryKind,
  type AccountAnchor,
  type Valuation,
} from "./balance.js";

/** Which way the daily replay runs. Derived from the anchors, not from a
 *  stored strategy flag: an account that knows where it STARTED replays
 *  forward; one that only knows where it is today (a linked/imported balance)
 *  replays backward. No anchor at all is `unknown` — the whole range is a gap. */
export type AccountSeriesStrategy = "forward" | "reverse" | "unknown";

export function accountSeriesStrategy(
  account: Account,
  valuations: readonly Valuation[] | null | undefined,
  asOf: string,
): AccountSeriesStrategy {
  const anchors = accountAnchors(account, valuations, asOf);
  if (anchors.length === 0) return "unknown";
  return anchors.some((anchor) => anchor.kind === "opening") ? "forward" : "reverse";
}

/** One day of one account. `balanceCents: null` is UNKNOWN — no anchor reaches
 *  this day — and is never summed as zero. */
export type AccountDayPoint = {
  date: string;
  balanceCents: number | null;
  /** Cash part; null when the split itself is unknown (an investment account
   *  without a holdings valuation). */
  cashCents: number | null;
  nonCashCents: number | null;
  cashInflowCents: number;
  cashOutflowCents: number;
  nonCashInflowCents: number;
  nonCashOutflowCents: number;
  /** The day's signed value impact: `flowsFactor * (inflow - outflow)`. */
  netFlowCents: number;
  /** Sure's `flows_factor`: 1 for an asset, -1 for a liability. */
  flowsFactor: 1 | -1;
  /** The absolute waypoint applied on this date, when one lands here. */
  anchor: AccountAnchor | null;
  /** Days since the anchor that seeds this value; 0 on an anchor day, null
   *  when the value is unknown. */
  carriedDays: number | null;
};

export type AccountSeriesInput = {
  account: Account;
  txs: readonly Tx[];
  valuations?: readonly Valuation[] | null;
  /** Inclusive ISO range. */
  from: string;
  to: string;
  /** The position date for a balance that carries no `balanceDate`. */
  asOf?: string;
};

const DAY_MS = 86_400_000;

function isoDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

type DayFlows = {
  cashInflowCents: number;
  cashOutflowCents: number;
  nonCashInflowCents: number;
  nonCashOutflowCents: number;
  netFlowCents: number;
};

/** One account's ledger flows per day, in cents, split into the cash and
 *  non-cash sides and signed by the account's classification. LaVega rows carry
 *  a signed euro amount and no trade metadata, so every row is a cash movement
 *  for a depository account and a non-cash movement for every other kind. */
function flowsByDay(account: Account, txs: readonly Tx[]): Map<string, DayFlows> {
  const kind = accountTypeKind(account);
  const depository = isDepositoryKind(kind);
  const factor: 1 | -1 = accountClassification(account) === "asset" ? 1 : -1;
  const out = new Map<string, DayFlows>();
  for (const tx of txs) {
    if (tx.accountKey !== account.key) continue;
    const cents = Math.round(tx.amount * 100);
    const day = out.get(tx.date) ?? {
      cashInflowCents: 0,
      cashOutflowCents: 0,
      nonCashInflowCents: 0,
      nonCashOutflowCents: 0,
      netFlowCents: 0,
    };
    if (depository) {
      if (cents >= 0) day.cashInflowCents += cents;
      else day.cashOutflowCents += -cents;
    } else if (cents >= 0) {
      day.nonCashInflowCents += cents;
    } else {
      day.nonCashOutflowCents += -cents;
    }
    day.netFlowCents += factor * cents;
    out.set(tx.date, day);
  }
  return out;
}

const EMPTY_FLOWS: DayFlows = {
  cashInflowCents: 0,
  cashOutflowCents: 0,
  nonCashInflowCents: 0,
  nonCashOutflowCents: 0,
  netFlowCents: 0,
};

/** The cash/non-cash split of one known total. A depository account is all
 *  cash; an investment account's split is unknown (holdings are not valued
 *  here); every other kind is all non-cash, which is what makes a loan balance
 *  a debt rather than spendable money. */
function splitOf(kind: ReturnType<typeof accountTypeKind>, totalCents: number) {
  if (isDepositoryKind(kind)) return { cashCents: totalCents, nonCashCents: 0 };
  if (kind === "investment") return { cashCents: null, nonCashCents: null };
  return { cashCents: 0, nonCashCents: totalCents };
}

function point(
  account: Account,
  date: string,
  balanceCents: number | null,
  flows: DayFlows,
  anchor: AccountAnchor | null,
  carriedDays: number | null,
): AccountDayPoint {
  const kind = accountTypeKind(account);
  const split =
    balanceCents == null ? { cashCents: null, nonCashCents: null } : splitOf(kind, balanceCents);
  return {
    date,
    balanceCents,
    cashCents: split.cashCents,
    nonCashCents: split.nonCashCents,
    cashInflowCents: flows.cashInflowCents,
    cashOutflowCents: flows.cashOutflowCents,
    nonCashInflowCents: flows.nonCashInflowCents,
    nonCashOutflowCents: flows.nonCashOutflowCents,
    netFlowCents: flows.netFlowCents,
    flowsFactor: accountClassification(account) === "asset" ? 1 : -1,
    anchor,
    carriedDays,
  };
}

/**
 * One account's daily end-of-day series over `[from, to]`.
 *
 * Forward replay: start at the earliest anchor and add each day's flows; a
 * later anchor hard-resets the value on its own date. Reverse replay: start at
 * the newest anchor and subtract the NEXT day's flows walking backwards; an
 * earlier anchor hard-resets on its date. Days no anchor can reach are `null`.
 */
export function accountBalanceSeries(input: AccountSeriesInput): AccountDayPoint[] {
  const { account, txs, from, to } = input;
  const asOf = input.asOf ?? to;
  const anchors = accountAnchors(account, input.valuations, asOf);
  const flows = flowsByDay(account, txs);
  const anchorByDate = new Map(anchors.map((anchor) => [anchor.date, anchor]));
  const days = isoDays(from, to);

  if (anchors.length === 0) {
    return days.map((date) =>
      point(account, date, null, flows.get(date) ?? EMPTY_FLOWS, null, null),
    );
  }

  const first = anchors[0] as AccountAnchor;
  const last = anchors[anchors.length - 1] as AccountAnchor;
  const strategy: AccountSeriesStrategy = anchors.some((a) => a.kind === "opening")
    ? "forward"
    : "reverse";

  if (strategy === "forward") {
    // Seed at the earliest anchor; when it sits before `from`, replay from
    // there so the first requested day already has a value.
    const start = from < first.date ? from : first.date;
    let value: number | null = null;
    let seededOn: string | null = null;
    const out: AccountDayPoint[] = [];
    for (const date of isoDays(start, to)) {
      const dayFlows = flows.get(date) ?? EMPTY_FLOWS;
      const anchor = anchorByDate.get(date) ?? null;
      if (anchor != null) {
        value = anchor.amountCents;
        seededOn = date;
      } else if (value != null) {
        value += dayFlows.netFlowCents;
      }
      if (date < from) continue;
      out.push(
        point(
          account,
          date,
          value,
          dayFlows,
          anchor,
          value == null || seededOn == null ? null : dayDistance(seededOn, date),
        ),
      );
    }
    return out;
  }

  // Reverse: seed at the newest anchor and subtract the NEXT day's flows while
  // walking backwards; an earlier anchor hard-resets on its own date. The
  // replay reaches back only as far as the LEDGER EVIDENCE (the oldest entry)
  // or the earliest anchor — before that a gap is the honest answer, not a
  // value that claims we knew the balance when nothing recorded it. Days after
  // the newest anchor are extended forward from it, so a stale valuation keeps
  // a LABELLED carried value instead of a gap.
  const oldestTx = txs
    .filter((t) => t.accountKey === account.key)
    .reduce<string | null>((min, t) => (min == null || t.date < min ? t.date : min), null);
  const lowerBound = oldestTx != null && oldestTx < first.date ? oldestTx : first.date;
  const end = to > last.date ? to : last.date;
  const byDate = new Map<string, AccountDayPoint>();
  let value: number | null = null;
  let seededOn: string | null = null;
  for (const date of [...isoDays(from, end)].reverse()) {
    const dayFlows = flows.get(date) ?? EMPTY_FLOWS;
    const anchor = anchorByDate.get(date) ?? null;
    if (date > last.date) {
      // Extended below, after the anchor is seeded.
      continue;
    }
    if (date < lowerBound) {
      value = null;
      seededOn = null;
    } else if (anchor != null) {
      value = anchor.amountCents;
      seededOn = date;
    } else if (value != null) {
      value -= (flows.get(nextDay(date)) ?? EMPTY_FLOWS).netFlowCents;
    }
    byDate.set(
      date,
      point(
        account,
        date,
        value,
        dayFlows,
        anchor,
        value == null || seededOn == null ? null : dayDistance(date, seededOn),
      ),
    );
  }
  if (to > last.date) {
    let carried = last.amountCents;
    for (const date of isoDays(nextDay(last.date), to)) {
      const dayFlows = flows.get(date) ?? EMPTY_FLOWS;
      carried += dayFlows.netFlowCents;
      byDate.set(date, point(account, date, carried, dayFlows, null, dayDistance(last.date, date)));
    }
  }
  return isoDays(from, to).map((date) => byDate.get(date) as AccountDayPoint);
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export type NetWorthDayPoint = {
  date: string;
  /** null when ANY included account is unknown that day: an unknown valuation
   *  leaves a gap in the total, never a zero. */
  totalCents: number | null;
  /** The sum of the accounts that ARE known, so a screen can show a partial
   *  figure with the unknown count beside it. */
  knownTotalCents: number;
  assetCents: number | null;
  liabilityCents: number | null;
  cashCents: number | null;
  nonCashCents: number | null;
  /** Accounts whose value is unknown on this date. */
  unknownAccounts: string[];
  /** Accounts whose absolute anchor lands on this date. */
  anchorAccounts: string[];
};

export type NetWorthSeriesInput = {
  accounts: readonly Account[];
  txs: readonly Tx[];
  valuations?: readonly Valuation[] | null;
  from: string;
  to: string;
  asOf?: string;
};

export type NetWorthSeries = {
  days: NetWorthDayPoint[];
  /** Non-EUR accounts, left out rather than summed at a made-up rate. */
  excludedForeignCount: number;
};

/**
 * The household's daily net worth: every EUR account's series summed per day.
 * Assets and liabilities are reported apart and summed signed, so a loan shows
 * as a debt instead of a negative asset. A day where any account is unknown is
 * a GAP (`totalCents: null`) with the unknown keys named.
 */
export function netWorthSeries(input: NetWorthSeriesInput): NetWorthSeries {
  const asOf = input.asOf ?? input.to;
  const included = input.accounts.filter(
    (a) =>
      String(a.currency ?? "")
        .trim()
        .toUpperCase() === "EUR",
  );
  const excludedForeignCount = input.accounts.length - included.length;
  const series = new Map(
    included.map((account) => [
      account.key,
      new Map(
        accountBalanceSeries({
          account,
          txs: input.txs,
          valuations: input.valuations,
          from: input.from,
          to: input.to,
          asOf,
        }).map((p) => [p.date, p]),
      ),
    ]),
  );

  const days: NetWorthDayPoint[] = isoDays(input.from, input.to).map((date) => {
    let knownTotalCents = 0;
    let assets = 0;
    let liabilities = 0;
    let cash = 0;
    let nonCash = 0;
    let cashUnknown = false;
    let nonCashUnknown = false;
    const unknownAccounts: string[] = [];
    const anchorAccounts: string[] = [];
    for (const account of included) {
      const p = series.get(account.key)?.get(date);
      if (p == null || p.balanceCents == null) {
        unknownAccounts.push(account.key);
        continue;
      }
      knownTotalCents += p.balanceCents;
      if (accountClassification(account) === "liability") liabilities += p.balanceCents;
      else assets += p.balanceCents;
      if (p.cashCents == null) cashUnknown = true;
      else cash += p.cashCents;
      if (p.nonCashCents == null) nonCashUnknown = true;
      else nonCash += p.nonCashCents;
      if (p.anchor != null) anchorAccounts.push(account.key);
    }
    const unknown = unknownAccounts.length > 0;
    return {
      date,
      totalCents: unknown ? null : assets + liabilities,
      knownTotalCents,
      assetCents: unknown ? null : assets,
      liabilityCents: unknown ? null : liabilities,
      cashCents: unknown || cashUnknown ? null : cash,
      nonCashCents: unknown || nonCashUnknown ? null : nonCash,
      unknownAccounts,
      anchorAccounts,
    };
  });

  return { days, excludedForeignCount };
}
