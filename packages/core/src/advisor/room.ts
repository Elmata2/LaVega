import { DateTime } from "effect";
import type { Account, Rule, Tx } from "../model.js";
import type { EntityProfile } from "../entities.js";
import { toEur, type ConversionMode } from "../fx.js";
import { ownAccounts, type OwnAccounts } from "../views.js";
import { isIsoDate, isoMonth, previousMonths } from "./months.js";
import { cleanTxs, personalView } from "./scopePersonal.js";

export type RoomMonth = {
  month: string;
  incomingCents: number;
  outgoingCents: number;
  netCents: number;
};

/** Why an account stops a month from counting: "stale" = its data ends before
 *  the month does; "short" = its first transaction is after the month starts
 *  (`since` is the YYYY-MM of that first transaction). */
export type BlockingAccount = { id: string; reason: "stale" | "short"; since?: string };

export type RoomResult =
  | {
      kind: "computed";
      months: RoomMonth[];
      middleCents: number;
      /** Income of the median-net month; the denominator for capacity shares. */
      middleIncomeCents: number;
      lowCents: number;
      highCents: number;
      /** Fewer than three full months were available. */
      partial: boolean;
      excludedForeignCount: number;
      /** Accounts whose data does not cover one of the three most recent full
       *  months. Empty when none blocks. */
      blockingAccounts: BlockingAccount[];
    }
  | { kind: "none"; reason: "no-data" }
  | { kind: "none"; reason: "no-full-month"; blockingAccounts: BlockingAccount[] }
  | {
      kind: "stated";
      lowCents: number;
      highCents: number;
      /** Midpoint of the stated income range: the denominator for capacity shares. */
      incomeMidCents: number;
    };

export type RoomInput = {
  txs: Tx[];
  accounts: Account[];
  profiles: EntityProfile[];
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  mode: ConversionMode;
  fxHistory: Record<string, Record<string, number>>;
};

const isEur = (c: string): boolean => c.trim().toUpperCase() === "EUR";

const parse = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso) as DateTime.Utc;

/** The last calendar day of a YYYY-MM, as YYYY-MM-DD. */
function lastDayOf(month: string): string {
  const start = parse(`${month}-01`);
  const last = DateTime.subtract(DateTime.add(start, { months: 1 }), { days: 1 });
  return DateTime.formatIso(last).slice(0, 10);
}

/** A month counts only if every in-scope account that HAS transactions covers
 *  it: its first tx falls on or before day 3 of that month (a later first tx
 *  means the account was linked later and is not in scope that month) and its
 *  data runs to the last day (last tx or balanceDate). An account without txs
 *  is ignored. */
function monthCovered(
  month: string,
  spans: ReadonlyArray<{ first: string; last: string }>,
): boolean {
  const lastDay = lastDayOf(month);
  const day3 = `${month}-03`;
  return spans.every((s) => s.first <= day3 && s.last >= lastDay);
}

function accountSpans(accounts: readonly Account[], txs: readonly Tx[]) {
  const byKey = new Map<string, { first: string; last: string }>();
  for (const t of txs) {
    if (!t.date) continue;
    const cur = byKey.get(t.accountKey);
    if (!cur) byKey.set(t.accountKey, { first: t.date, last: t.date });
    else {
      if (t.date < cur.first) cur.first = t.date;
      if (t.date > cur.last) cur.last = t.date;
    }
  }
  for (const a of accounts) {
    const s = byKey.get(a.key);
    const bd = a.balanceDate?.slice(0, 10);
    if (s && bd && bd > s.last) s.last = bd;
  }
  return byKey;
}

/** Accounts that fail to cover at least one of the given months. */
function blockers(
  months: readonly string[],
  spans: ReadonlyMap<string, { first: string; last: string }>,
): BlockingAccount[] {
  const out: BlockingAccount[] = [];
  for (const [id, s] of spans) {
    const stale = months.some((m) => s.last < lastDayOf(m));
    const short = months.some((m) => s.first > `${m}-03`);
    if (stale) out.push({ id, reason: "stale" });
    else if (short) out.push({ id, reason: "short", since: s.first.slice(0, 7) });
  }
  return out;
}

/** Own-account identifiers for the personal accounts only, keeping the owner's
 *  typed names (user data the caller supplies). Also used by block-1 inference. */
export function scopedOwn(personalAccounts: Account[], own: OwnAccounts): OwnAccounts {
  return own.names === undefined
    ? ownAccounts(personalAccounts)
    : { ...ownAccounts(personalAccounts), names: own.names };
}

/** "Your room each month" (spec 10.2): the middle of the net of the last full
 *  months, with the lowest and highest as the range. Personal scope only. */
export function computeRoom(input: RoomInput): RoomResult {
  const view = personalView(input.accounts, input.txs, input.profiles);
  const dated = view.txs.filter((t) => isIsoDate(t.date));
  if (dated.length === 0) return { kind: "none", reason: "no-data" };

  const spans = accountSpans(view.accounts, dated);
  // 6 earlier months; asOf's own (partial) month is dropped.
  const candidates = previousMonths(input.asOf, 7).slice(1);
  const spanList = [...spans.values()];
  const kept = candidates.filter((m) => monthCovered(m, spanList)).slice(0, 3);
  const blockingAccounts = blockers(candidates.slice(0, 3), spans);
  if (kept.length === 0) return { kind: "none", reason: "no-full-month", blockingAccounts };

  // Only transfers between PERSONAL accounts cancel: a business account is out
  // of scope, so its salary transfer into a personal account is real income.
  const personalOwn = scopedOwn(view.accounts, input.own);
  const cleaned = cleanTxs(dated, view.accounts, input.rules, personalOwn);
  const byMonth = new Map<string, { inc: number; out: number }>(
    kept.map((m) => [m, { inc: 0, out: 0 }]),
  );
  let excludedForeignCount = 0;
  for (const t of cleaned) {
    const bucket = byMonth.get(isoMonth(t.date));
    if (!bucket) continue;
    let eur: number | null;
    if (isEur(t.currency)) eur = t.amount;
    else if (input.mode === "separate") eur = null;
    else eur = toEur(t.amount, t.currency, t.date, input.fxHistory);
    if (eur === null) {
      excludedForeignCount += 1;
      continue;
    }
    // One rounding per tx, then integer sums.
    const cents = Math.round(eur * 100);
    if (cents > 0) bucket.inc += cents;
    else if (cents < 0) bucket.out += -cents;
  }

  const months: RoomMonth[] = kept.map((month) => {
    const b = byMonth.get(month)!;
    return { month, incomingCents: b.inc, outgoingCents: b.out, netCents: b.inc - b.out };
  });
  const sorted = [...months].sort((a, b) => a.netCents - b.netCents);
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;

  let middleCents: number;
  let middleIncomeCents: number;
  if (sorted.length === 3) {
    middleCents = sorted[1]!.netCents;
    middleIncomeCents = sorted[1]!.incomingCents;
  } else if (sorted.length === 2) {
    // No true median of two: the mean, rounded to a whole cent.
    middleCents = Math.round((low.netCents + high.netCents) / 2);
    middleIncomeCents = Math.round((low.incomingCents + high.incomingCents) / 2);
  } else {
    middleCents = low.netCents;
    middleIncomeCents = low.incomingCents;
  }

  return {
    kind: "computed",
    months,
    middleCents,
    middleIncomeCents,
    lowCents: low.netCents,
    highCents: high.netCents,
    partial: months.length < 3,
    excludedForeignCount,
    blockingAccounts,
  };
}

/** Room from the user's own stated income and spend ranges (no transactions). */
export function roomFromStated(
  income: { lowCents: number; highCents: number },
  spend: { lowCents: number; highCents: number },
): RoomResult {
  return {
    kind: "stated",
    lowCents: income.lowCents - spend.highCents,
    highCents: income.highCents - spend.lowCents,
    incomeMidCents: Math.round((income.lowCents + income.highCents) / 2),
  };
}
