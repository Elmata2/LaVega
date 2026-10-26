import { indexTxs, txsAreDebt } from "../advisor/debts.js";
import { proposeFixedCosts } from "../advisor/fixedCosts.js";
import { looksLikeLender } from "../advisor/lenders.js";
import { isIsoDate, isoMonth, monthsBetween, previousMonths } from "../advisor/months.js"; // month math only via months.ts
import { fingerprint } from "../advisor/evidence.js";
import { scopedOwn } from "../advisor/room.js";
import { cleanTxs, personalView } from "../advisor/scopePersonal.js";
import { hash } from "../hash.js";
import { isEurCurrency, type Tx } from "../model.js";
import type { VaultEvent } from "../advisor/vaultSections.js";
import {
  PRICE_INCREASE_MIN_CENTS,
  PRICE_INCREASE_MIN_PCT,
  detectSubscriptions,
  subscriptionCoverage,
  subscriptionOverlaps,
  subscriptionPriceIncreases,
  type Subscription,
} from "../subscriptions.js";
import { fig } from "./internal.js";
import { subscriptionStateOf } from "./preferences.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type {
  CalcStep,
  FigureValue,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** Every key this section puts in `flat` (the change log labels each one). */
export const SUBS_FLAT_IDS = [
  "sub_count",
  "sub_total_month",
  "sub_total_year",
  "sub_whatif_year",
  "sub_coverage_days",
  "sub_foreign_excluded",
] as const;
export type SubsFlatId = (typeof SUBS_FLAT_IDS)[number];

export const SUBS_CALC_IDS = [
  "sub-detect",
  "sub-totals",
  "price-change",
  "overlap",
  "cost-per-use",
  "what-if-cancel",
] as const;
export type SubsCalcId = (typeof SUBS_CALC_IDS)[number];

export type PriceChange = {
  changeDate: string;
  fromCents: number;
  toCents: number;
  /** Fraction (0.18 = 18%) of the step reported, not of the whole history. */
  changePct: number;
};

export type SubRow = {
  key: string;
  name: string;
  function: string;
  monthlyCents: number;
  yearlyCents: number;
  /** Calendar months (by month label) from the first charge to the last, both counted. */
  monthsActive: number;
  priceChange: PriceChange | null;
  overlapGroup: string | null;
  overlapCombinedMonthlyCents: number | null;
  skippedCycles: number;
  usage: "unknown" | { loggedMonths: number; lastLoggedMonth: string; costPerUseCents: number };
  decision: "keep" | "review" | "cancel" | null;
  facts: ("price-up" | "overlap" | "no-use-logged" | "missed-payment")[];
};

export type SubsFigures = {
  rows: SubRow[];
  totalMonthlyCents: number;
  totalYearlyCents: number;
  whatIfCancelMonthlyCents: number;
  whatIfCancelYearlyCents: number;
  coverageDays: number;
  /** Streams left out because a charge is not in euros (no conversion here). */
  excludedForeignCount: number;
};

const cents = (t: Tx): number => Math.round(Math.abs(t.amount) * 100);

const passes = (from: number, to: number, pct: number): boolean =>
  pct >= PRICE_INCREASE_MIN_PCT && to - from >= PRICE_INCREASE_MIN_CENTS;

/** The last price step of the stream: the first charge at the current price
 *  (`sub.lastAmountCents`), after the repeating amount that preceded it.
 *  Charges whose amount never repeats in the stream are one-offs and skipped,
 *  as the detector does. Gated by the thresholds of `subscriptionPriceIncreases`
 *  (which is asked first). When that last step is not itself a qualifying rise
 *  (a rise that was later partly reversed) the detector's whole-history change
 *  is reported instead, dated at the first charge that left the first price. */
export function priceChange(sub: Subscription, txs: readonly Tx[]): PriceChange | null {
  const inc = subscriptionPriceIncreases([sub])[0];
  if (inc === undefined) return null;
  const ids = new Set(sub.txIds);
  const own = txs
    .filter((t) => ids.has(t.id) && isIsoDate(t.date))
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
  const cs = own.map(cents);
  const times = new Map<number, number>();
  for (const c of cs) times.set(c, (times.get(c) ?? 0) + 1);
  const repeats = (c: number): boolean => (times.get(c) ?? 0) >= 2;

  let j = cs.lastIndexOf(inc.toCents);
  while (j >= 0 && (cs[j] === inc.toCents || !repeats(cs[j]!))) j -= 1;
  if (j >= 0) {
    const from = cs[j]!;
    const k = cs.findIndex((c, idx) => idx > j && c === inc.toCents);
    const pct = Math.round(((inc.toCents - from) / from) * 1000) / 1000;
    if (k >= 0 && passes(from, inc.toCents, pct))
      return {
        changeDate: own[k]!.date.slice(0, 10),
        fromCents: from,
        toCents: inc.toCents,
        changePct: pct,
      };
  }
  const f = cs.findIndex((c) => c === inc.fromCents);
  const k = cs.findIndex((c, idx) => idx > f && c !== inc.fromCents && repeats(c));
  if (f < 0 || k < 0) return null;
  return {
    changeDate: own[k]!.date.slice(0, 10),
    fromCents: inc.fromCents,
    toCents: inc.toCents,
    changePct: inc.changePct,
  };
}

export function computeSubscriptions(i: PlanInput): SectionResult<SubsFigures> {
  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const own = scopedOwn(view.accounts, i.own);
  const clean = cleanTxs(view.txs, view.accounts, i.rules, own);
  const byId = indexTxs(clean);
  // "Not mine": the intake stores only evidence fingerprints. Its fixed-cost
  // proposals (housing, schedule streams, subscriptions) claim tx ids in that
  // order, so a removed STREAM card hides a subscription's txs too. Recompute
  // the proposals the way the intake does and drop every subscription that
  // shares a tx with a removed one. The removal lapses when new charges change
  // the fingerprint, exactly when the intake card returns.
  const removed = new Set(i.profile.removed);
  const removedIds = new Set(
    removed.size === 0
      ? []
      : proposeFixedCosts(view.txs, {
          asOf: i.asOf,
          rules: i.rules,
          own,
          accounts: view.accounts,
        })
          .filter((p) => removed.has(p.fingerprint))
          .flatMap((p) => p.evidence),
  );
  const detected = detectSubscriptions(clean, { asOf: i.asOf }).filter(
    (s) =>
      !removed.has(fingerprint(s.txIds)) &&
      !s.txIds.some((id) => removedIds.has(id)) &&
      !looksLikeLender(s.name) &&
      !txsAreDebt(s.txIds, byId),
  );
  const isForeign = (s: Subscription): boolean =>
    s.txIds.some((id) => {
      const t = byId.get(id);
      return t !== undefined && !isEurCurrency(t.currency);
    });
  const subs = detected.filter((s) => !isForeign(s));
  const excludedForeignCount = detected.length - subs.length;
  const coverageDays = subscriptionCoverage(clean).historyDays;

  // A price change moves the key (`merchant|out|price`). State logged under an
  // old key is adopted by the one current row at that merchant; with two
  // streams at a merchant nothing is adopted.
  const rowKeys = new Set(subs.map((s) => s.key));
  const remap = new Map<string, string>();
  for (const e of i.events) {
    if (e.kind === "goal-anchor") continue;
    const k = e.streamKey;
    if (k === "" || rowKeys.has(k) || remap.has(k) || !k.includes("|out|")) continue;
    const at = subs.filter((s) => s.merchant === k.split("|out|")[0]);
    if (at.length === 1) remap.set(k, at[0]!.key);
  }
  const events: readonly VaultEvent[] = i.events.map((e) => {
    if (e.kind === "goal-anchor") return e;
    const to = remap.get(e.streamKey);
    return to === undefined ? e : { ...e, streamKey: to };
  });
  const state = subscriptionStateOf(events);
  const window12 = new Set(previousMonths(i.asOf, 12));
  const logged12 = (key: string): string[] =>
    (state.get(key)?.usedMonths ?? []).filter((m) => window12.has(m));
  const usageKeys = new Set(subs.filter((s) => logged12(s.key).length > 0).map((s) => s.key));

  const overlapOf = new Map<string, { fn: string; combined: number }>();
  const overlaps = subscriptionOverlaps(subs);
  for (const o of overlaps)
    for (const s of o.subs) overlapOf.set(s.key, { fn: o.function, combined: o.monthlyCents });

  const byTime = (a: string): number => monthsBetween(a, i.asOf);
  const rows: SubRow[] = subs.map((s) => {
    const change = priceChange(s, clean);
    const recent = change !== null && byTime(change.changeDate) < 12;
    const months = logged12(s.key);
    const yearlyCents = s.monthlyCents * 12;
    const ov = overlapOf.get(s.key);
    const otherLogged = [...usageKeys].some((k) => k !== s.key);
    const ids = new Set(s.txIds);
    let firstDate = s.lastDate;
    for (const id of ids) {
      const t = byId.get(id);
      if (t !== undefined && isIsoDate(t.date) && t.date < firstDate) firstDate = t.date;
    }
    const flags: SubRow["facts"] = [];
    if (recent) flags.push("price-up");
    if (ov !== undefined) flags.push("overlap");
    if (months.length === 0 && otherLogged) flags.push("no-use-logged");
    if (s.skippedCycles > 0) flags.push("missed-payment");
    return {
      key: s.key,
      name: s.name,
      function: s.function,
      monthlyCents: s.monthlyCents,
      yearlyCents,
      monthsActive: monthsBetween(`${isoMonth(firstDate)}-01`, `${isoMonth(s.lastDate)}-01`) + 1,
      priceChange: change,
      overlapGroup: ov?.fn ?? null,
      overlapCombinedMonthlyCents: ov?.combined ?? null,
      skippedCycles: s.skippedCycles,
      usage:
        months.length === 0
          ? "unknown"
          : {
              loggedMonths: months.length,
              lastLoggedMonth: months[months.length - 1]!,
              costPerUseCents: Math.round(yearlyCents / months.length),
            },
      decision: state.get(s.key)?.decision ?? null,
      facts: flags,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  const sum = (xs: readonly SubRow[], f: (r: SubRow) => number): number =>
    xs.reduce((n, r) => n + f(r), 0);
  const cancelled = rows.filter((r) => r.decision === "cancel");
  const figures: SubsFigures = {
    rows,
    totalMonthlyCents: sum(rows, (r) => r.monthlyCents),
    totalYearlyCents: sum(rows, (r) => r.yearlyCents),
    whatIfCancelMonthlyCents: sum(cancelled, (r) => r.monthlyCents),
    whatIfCancelYearlyCents: sum(cancelled, (r) => r.yearlyCents),
    coverageDays,
    excludedForeignCount,
  };

  const flagged = (k: SubRow["facts"][number]): SubRow[] => rows.filter((r) => r.facts.includes(k));
  const priceUps = flagged("price-up");
  const missing: Missing[] = [];
  let status: SectionResult<SubsFigures>["status"];
  let statusReason: StatusReason;
  if (rows.length === 0 && coverageDays < PLAN_THRESHOLDS.subscriptions.minDays) {
    status = "not-enough-data";
    statusReason = { key: "none-short-history" };
    missing.push({ kind: "history-90d", action: "connect-bank" });
  } else if (priceUps.length > 0) {
    status = "attention";
    statusReason = { key: "price-increase" };
  } else if (overlaps.length > 0) {
    status = "attention";
    statusReason = { key: "overlap" };
  } else {
    status = "on-track";
    statusReason = { key: "clean" };
  }

  const calc: CalcStep[] = [
    {
      id: "sub-detect",
      inputs: {
        history_days: fig("count", coverageDays),
        foreign_excluded: fig("count", excludedForeignCount),
      },
      output: fig("count", rows.length),
    },
  ];
  if (rows.length > 0)
    calc.push({
      id: "sub-totals",
      inputs: { monthly: fig("cents", figures.totalMonthlyCents), months: fig("count", 12) },
      output: fig("cents", figures.totalYearlyCents),
    });
  for (const r of priceUps)
    calc.push({
      id: "price-change",
      inputs: {
        from: fig("cents", r.priceChange!.fromCents),
        to: fig("cents", r.priceChange!.toCents),
        change_date: fig("date", r.priceChange!.changeDate),
      },
      output: fig("cents", r.priceChange!.toCents - r.priceChange!.fromCents),
    });
  for (const o of overlaps)
    calc.push({
      id: "overlap",
      inputs: { streams: fig("count", o.subs.length) },
      output: fig("cents", o.monthlyCents),
    });
  for (const r of rows)
    if (r.usage !== "unknown")
      calc.push({
        id: "cost-per-use",
        inputs: {
          yearly: fig("cents", r.yearlyCents),
          logged_months: fig("count", r.usage.loggedMonths),
        },
        output: fig("cents", r.usage.costPerUseCents),
      });
  if (cancelled.length > 0)
    calc.push({
      id: "what-if-cancel",
      inputs: { marked: fig("count", cancelled.length) },
      output: fig("cents", figures.whatIfCancelYearlyCents),
    });

  const flat: Record<SubsFlatId, FigureValue> = {
    sub_count: fig("count", rows.length),
    sub_total_month: fig("cents", figures.totalMonthlyCents),
    sub_total_year: fig("cents", figures.totalYearlyCents),
    sub_whatif_year: fig("cents", figures.whatIfCancelYearlyCents),
    sub_coverage_days: fig("count", coverageDays),
    sub_foreign_excluded: fig("count", excludedForeignCount),
  };

  const facts: PlanFact[] = [];
  const used = new Set<string>();
  const fact = (
    id: string,
    f: Omit<PlanFact, "factId" | "section" | "polarity" | "mustMention"> &
      Partial<Pick<PlanFact, "polarity" | "mustMention">>,
  ): void => {
    let factId = id;
    for (let n = 2; used.has(factId); n++) factId = `${id}-${n}`;
    used.add(factId);
    facts.push({ section: "subscriptions", polarity: "neutral", mustMention: false, ...f, factId });
  };
  if (rows.length > 0) fact("sub_total_year", { exact: figures.totalYearlyCents, unit: "cents" });
  for (const r of rows) {
    const h = hash(r.key);
    if (r.facts.includes("price-up"))
      fact(`sub_price_up:${h}`, {
        exact: r.priceChange!.toCents - r.priceChange!.fromCents,
        unit: "cents",
        polarity: "negative",
        trend: { direction: "up", vs: "previous-price" },
      });
    if (r.facts.includes("missed-payment"))
      fact(`sub_missed_payment:${h}`, {
        exact: r.skippedCycles,
        unit: "count",
        polarity: "negative",
        mustMention: true,
      });
    if (r.facts.includes("no-use-logged"))
      fact(`sub_no_use:${h}`, { exact: r.yearlyCents, unit: "cents" });
  }
  for (const o of overlaps)
    fact(`sub_overlap:${hash(o.function)}`, { exact: o.monthlyCents, unit: "cents" });

  return {
    section: "subscriptions",
    figures,
    flat,
    headline: status === "not-enough-data" ? null : fig("cents", figures.totalYearlyCents),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}
