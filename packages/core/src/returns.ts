import type { Account, Rule, Tx } from "./model.js";
import { categorize, ownAccounts, type OwnAccounts } from "./views.js";
import { accountType } from "./balance.js";
import type { LearnedFact } from "./facts.js";
import { factNumber } from "./facts.js";
import { resolveAccountRate, type RateBenchmark, type RateSource } from "./interest.js";
import { isSpendable, productOf, TRAVEL_AGENT } from "./travel.js";

/** Money moved between the owner's own accounts is not spending. Same category
 *  the forecast excludes, for the same reason: a €50k sweep to savings is not
 *  €50k of consumption, and treating it as such invents a number. */
const TRANSFER_CATEGORY = "Eigen overboeking";

/** Below this much history an annualised figure is a guess dressed as a
 *  measurement. Matches the forecast's own floor for the same judgement. */
export const MIN_SPEND_DAYS = 60;

/** Below half a year, an annualised figure is a multiplication rather than an
 *  observation: 61 days scales by six, and one holiday booking inside it
 *  becomes six holidays. Above this the seasonal error is small enough to
 *  state plainly. */
export const CONFIDENT_SPEND_DAYS = 180;

/** How long an account may be silent before its history stops describing what
 *  it spends NOW. Measured from the last transaction to `asOf`, not from the
 *  window: six months of real spending that ended two years ago still divides
 *  out to a confident euro figure, and that figure would win a ranking against
 *  an account he actually uses. Three months covers an ordinary import lag
 *  (monthly or quarterly export) and catches dormancy. Past it the base is
 *  unknown - not zero, and not the old number carried forward. */
export const MAX_SPEND_GAP_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 *  Note what this does NOT answer: how well the annual total is known. `kind`
 *  is about WHICH outflows count; `extrapolated` is about how much data they
 *  were measured over. Conflating the two let a credit card with 61 days of
 *  history print a 6x extrapolation with no hedge at all.
 *
 *  `exact`       a credit card: every outflow on it IS card spend
 *  `upper-bound` a payment account: the bank export does not reliably say
 *                whether an outflow was a card payment or a direct debit, so
 *                this is the most it could be
 *  `unknown`     too little history, nothing spent, or silent for longer than
 *                MAX_SPEND_GAP_DAYS
 */
export type SpendKind = "exact" | "upper-bound" | "unknown";

export type SpendBase = {
  /** Annualised card spending in cents, or null when it cannot be measured. */
  perYearCents: number | null;
  kind: SpendKind;
  /** Days between the first and last transaction we hold for this account. */
  observedDays: number;
  /** The annual figure was multiplied up from well under a year, so it carries
   *  whatever seasonality and one-offs that window happened to hold. A single
   *  holiday booking inside 61 days becomes six of them a year. True here means
   *  the UI must hedge even when `kind` is "exact". */
  extrapolated: boolean;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** What this account spends in a year, as the base cashback multiplies. */
export function annualSpendCents(
  account: Account,
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  asOf: string,
): SpendBase {
  const mine = txs.filter((t) => t.accountKey === account.key && t.date <= asOf);
  if (mine.length === 0)
    return { perYearCents: null, kind: "unknown", observedDays: 0, extrapolated: false };

  const dates = mine.map((t) => t.date).sort();
  const lastDate = dates[dates.length - 1];
  const observedDays = daysBetween(dates[0], lastDate);

  // Silent too long: the history is real but it is no longer about today.
  if (daysBetween(lastDate, asOf) > MAX_SPEND_GAP_DAYS) {
    return { perYearCents: null, kind: "unknown", observedDays, extrapolated: false };
  }

  let outCents = 0;
  for (const t of mine) {
    if (t.amount >= 0) continue; // money in is not spending
    if (categorize(t, rules, own) === TRANSFER_CATEGORY) continue;
    outCents += Math.round(-t.amount * 100);
  }

  if (observedDays < MIN_SPEND_DAYS || outCents === 0) {
    return { perYearCents: null, kind: "unknown", observedDays, extrapolated: false };
  }
  return {
    perYearCents: Math.round((outCents * 365) / observedDays),
    kind: accountType(account) === "Creditcard" ? "exact" : "upper-bound",
    observedDays,
    extrapolated: observedDays < CONFIDENT_SPEND_DAYS,
  };
}

/** What one account he already holds earns and returns.
 *
 *  Two rates on two DIFFERENT bases, deliberately kept apart: savings earns on
 *  the balance sitting there, cashback returns on what is spent. Adding them
 *  into one percentage would read well and mean nothing. */
export type AccountReturn = {
  account: Account;
  savingsPct: number | null;
  savingsSource: RateSource;
  cashbackPct: number | null;
  balanceCents: number;
  spend: SpendBase;
};

export function accountReturns(
  accounts: Account[],
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  facts: readonly LearnedFact[],
  rates: readonly RateBenchmark[],
  asOf: string,
): AccountReturn[] {
  // A caller with no own-accounts set does not mean "he has none": these ARE
  // his accounts, so build it from them rather than counting a sweep to his own
  // savings as spending. A set passed in wins - it may cover accounts outside
  // this (entity-scoped) list, and a wider set excludes more, never less.
  const mine = own ?? ownAccounts(accounts);

  return accounts.map((account) => {
    const { ratePct, source } = resolveAccountRate(account, txs, asOf, rates);
    // Cashback belongs to the PRODUCT, so it is keyed the same way the travel
    // agent keys it — one correction moves both surfaces at once.
    const product = productOf(account);
    return {
      account,
      savingsPct: ratePct,
      savingsSource: source,
      cashbackPct: product ? factNumber(facts, TRAVEL_AGENT, product, "cashbackPct") : null,
      balanceCents: account.balance === null ? 0 : Math.round(account.balance * 100),
      spend: annualSpendCents(account, txs, rules, mine, asOf),
    };
  });
}

/** One concrete thing he can do, with the arithmetic attached so the UI never
 *  has to invent any. */
export type ReturnAction = {
  kind: "move-balance" | "route-spending";
  from: Account;
  to: Account;
  fromPct: number;
  toPct: number;
  /** Where each percentage CAME FROM. Carried because `resolveAccountRate`
   *  assumes 0% for a payment account nobody typed a rate into, and estimates a
   *  savings rate from the bank's public tariff - both are numbers nobody
   *  stated about this account, and a renderer that cannot see the source would
   *  print them as measured. Always `manual` on a rate he typed in himself.
   *  On a route-spending action both are the cashback fact's own source. */
  fromSource: RateSource;
  toSource: RateSource;
  /** The euros the difference applies to: a balance, or a year of spending. */
  baseCents: number;
  gainPerYearCents: number;
  /** The base is an upper bound (a payment account), so the UI must say "tot". */
  approximate: boolean;
};

/** A comparison we could not make, and what would fix it. Reported rather than
 *  silently skipped: a missing figure is a question, and the owner is the one
 *  who can answer it. */
export type ReturnGap = {
  /** The exact fact key a cashback correction must land on - `productOf()`, the
   *  same key the travel agent writes. Meaningful for `cashbackPct` only: a
   *  savings rate belongs to the ACCOUNT, not to a product, so name that gap
   *  with `accountLabel(account)` instead. */
  product: string;
  /** The account the gap was found on. */
  account: Account;
  missing: "cashbackPct" | "savingsPct";
};

/** Below this the advice is noise. Same threshold `analyzeInterest` uses. */
const MARGIN_PCT = 0.1;

export function optimiseReturns(returns: readonly AccountReturn[]): {
  actions: ReturnAction[];
  gaps: ReturnGap[];
} {
  const actions: ReturnAction[] = [];
  const gaps: ReturnGap[] = [];

  // One question, asked once. A cashback fact belongs to the PRODUCT, so
  // answering it once moves every account at that bank - printing it per
  // account prints the same question twice. A rate belongs to the account.
  const asked = new Set<string>();
  const ask = (g: ReturnGap) => {
    const key = g.missing === "cashbackPct" ? `c|${g.product}` : `s|${g.account.key}`;
    if (asked.has(key)) return;
    asked.add(key);
    gaps.push(g);
  };

  const currencyOf = (a: Account) =>
    String(a.currency ?? "")
      .trim()
      .toUpperCase();

  /** The best rate you could move THIS money to without converting it. A
   *  conversion sits between the balance and the rate, costs a spread nothing
   *  here prices, and leaves a gain nobody can redo against a statement - so a
   *  balance is only ever compared with accounts in its own currency. */
  const bestSavingsIn = (currency: string) =>
    returns
      .filter((r) => r.savingsPct !== null && currencyOf(r.account) === currency)
      .sort((a, b) => (b.savingsPct as number) - (a.savingsPct as number))[0];

  // Only things you can actually pay with may win the cashback ranking. See
  // `isSpendable`: without it a Spaarrekening inherits its bank's card fact.
  const bestCashback = returns
    .filter((r) => r.cashbackPct !== null && isSpendable(r.account))
    .sort((a, b) => (b.cashbackPct as number) - (a.cashbackPct as number))[0];

  for (const r of returns) {
    const product = productOf(r.account);
    const bestSavings = bestSavingsIn(currencyOf(r.account));
    if (r.savingsPct === null) {
      ask({ product, account: r.account, missing: "savingsPct" });
    } else if (bestSavings && r.account.key !== bestSavings.account.key && r.balanceCents > 0) {
      const delta = (bestSavings.savingsPct as number) - r.savingsPct;
      if (delta > MARGIN_PCT) {
        actions.push({
          kind: "move-balance",
          from: r.account,
          to: bestSavings.account,
          fromPct: r.savingsPct,
          toPct: bestSavings.savingsPct as number,
          fromSource: r.savingsSource,
          toSource: bestSavings.savingsSource,
          baseCents: r.balanceCents,
          gainPerYearCents: Math.round((r.balanceCents * delta) / 100),
          approximate: false,
        });
      }
    }

    // Cashback is a question about a card. A savings or investment account has
    // none, so asking what its cashback is invents a product he does not hold.
    if (!isSpendable(r.account)) continue;

    if (r.cashbackPct === null) {
      if (product) ask({ product, account: r.account, missing: "cashbackPct" });
      continue;
    }
    // No spend base means no honest multiplication. Skip rather than assume.
    if (r.spend.perYearCents === null) continue;
    if (!bestCashback || r.account.key === bestCashback.account.key) continue;
    const delta = (bestCashback.cashbackPct as number) - r.cashbackPct;
    if (delta <= MARGIN_PCT) continue;
    actions.push({
      kind: "route-spending",
      from: r.account,
      to: bestCashback.account,
      fromPct: r.cashbackPct,
      toPct: bestCashback.cashbackPct as number,
      // A cashback figure is a stated fact or it is null; it is never assumed.
      fromSource: "manual",
      toSource: "manual",
      baseCents: r.spend.perYearCents,
      gainPerYearCents: Math.round((r.spend.perYearCents * delta) / 100),
      // EITHER axis forces the hedge. An exact-kind figure stretched from two
      // months is still a guess about a year, and printing it bare is the
      // claim-more-than-you-know failure this codebase exists to avoid.
      approximate: r.spend.kind === "upper-bound" || r.spend.extrapolated,
    });
  }

  return { actions: actions.sort((a, b) => b.gainPerYearCents - a.gainPerYearCents), gaps };
}
