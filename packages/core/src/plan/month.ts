import { historyCoverage, personalView } from "../advisor/scopePersonal.js";
import { computeRoom, scopedOwn, type RoomResult } from "../advisor/room.js";
import { resolveRoomRanges } from "../advisor/resolve.js";
import { previousMonths } from "../advisor/months.js";
import { isEurCurrency } from "../model.js";
import { accountTypeKind } from "../balance.js";
import { categorize, ownAccountNamed } from "../views.js";
import { fig, roomMiddleCents } from "./internal.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type {
  CalcStep,
  FigureMap,
  FigureValue,
  FigureUnit,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** Every key this section puts in `flat` (the change log labels each one). */
export const MONTH_FLAT_IDS = [
  "room_middle",
  "room_low",
  "room_high",
  "income_middle",
  "fixed_share",
  "savings_rate",
] as const;
export type MonthFlatId = (typeof MONTH_FLAT_IDS)[number];

export const MONTH_CALC_IDS = [
  "room-median",
  "fixed-costs",
  "variable-split",
  "variable-floor",
  "savings-moved",
  "savings-rate",
] as const;
export type MonthCalcId = (typeof MONTH_CALC_IDS)[number];

export type MonthFigures = {
  room: RoomResult;
  incomeMiddleCents: number | null;
  fixedCents: number | null;
  fixedShare: number | null;
  variableCents: number | null;
  variableShare: number | null;
  savingsRate: number | null;
  savingsMovedCents: number | null;
  nibudGuidanceFactId: "nibud-save-10pct";
};

/** Fixed costs as the profile holds them: the same figure About-you shows.
 *  Null when the profile has neither housing nor a confirmed fixed cost. The
 *  profile keeps only the housing line and the total, so the other fixed costs
 *  come back as one line. */
export function fixedCostsMonthlyCentsOf(i: PlanInput): {
  cents: number | null;
  lines: { id: string; cents: number }[];
} {
  const total = i.profile.fixedCostsMonthlyCents;
  if (total === null) return { cents: null, lines: [] };
  const housing = i.profile.housingMonthlyCents;
  const lines: { id: string; cents: number }[] = [];
  if (housing !== null) lines.push({ id: "housing", cents: housing });
  const rest = total - (housing ?? 0);
  if (rest !== 0) lines.push({ id: "fixed-costs", cents: rest });
  return { cents: total, lines };
}

const ratio = (num: number, den: number): number | null =>
  den > 0 && Number.isFinite(num / den) ? num / den : null;

/** 0.10 as an integer test: middle * 10 >= income, exact in cents. */
const ON_TRACK_DENOMINATOR = Math.round(1 / PLAN_THRESHOLDS.month.roomShareOnTrack);

type Scoped = ReturnType<typeof personalView>;

/** Cents moved out of personal accounts into the user's own personal savings
 *  accounts, per month. Foreign-currency rows are not converted here. */
function movedToSavings(
  i: PlanInput,
  view: Scoped,
  months: readonly string[],
): Map<string, number> {
  const own = scopedOwn(view.accounts, i.own);
  const kindOf = new Map(view.accounts.map((a) => [a.key, accountTypeKind(a)]));
  const savingsIds = new Set<string>();
  for (const a of view.accounts) {
    if (accountTypeKind(a) !== "savings") continue;
    for (const id of own.byKey.get(a.key) ?? []) savingsIds.add(id);
  }
  const out = new Map<string, number>(months.map((m) => [m, 0]));
  for (const t of view.txs) {
    const m = t.date.slice(0, 7);
    if (!out.has(m) || t.amount >= 0 || !isEurCurrency(t.currency)) continue;
    // Savings to savings keeps the money in savings: only a current account moves it.
    if (kindOf.get(t.accountKey) !== "current") continue;
    if (categorize(t, i.rules, own) !== "Eigen overboeking") continue;
    const id = ownAccountNamed(t, own);
    if (id === null || !savingsIds.has(id)) continue;
    out.set(m, out.get(m)! + Math.round(-t.amount * 100));
  }
  return out;
}

export function computeMonth(i: PlanInput): SectionResult<MonthFigures> {
  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const computed = computeRoom({
    txs: i.txs,
    accounts: i.accounts,
    profiles: i.entityProfiles,
    rules: i.rules,
    own: i.own,
    asOf: i.asOf,
    mode: i.mode,
    fxHistory: i.fxHistory,
  });
  const days = historyCoverage(view.txs).days;
  const inc = i.profile.incomeStatedRange;
  const spd = i.profile.spendStatedRange;
  // Under 60 days of history resolveRoomRanges swaps in the stated ranges when
  // both exist (the one rule every caller shares); otherwise a computed room is
  // kept and labelled short.
  const shortHistory = days < PLAN_THRESHOLDS.month.history.minDays;
  const room = resolveRoomRanges(computed, inc, spd).room;
  const middle = roomMiddleCents(room);
  const incomeMiddle =
    room.kind === "computed"
      ? room.middleIncomeCents
      : room.kind === "stated"
        ? room.incomeMidCents
        : null;

  const calc: CalcStep[] = [];
  const missing: Missing[] = [];

  // Fixed versus variable: a split by detection, not a category taxonomy.
  const fixed = fixedCostsMonthlyCentsOf(i);
  let variableCents: number | null = null;
  if (fixed.cents === null) {
    missing.push({ kind: "fixed-costs", action: "intake-question" });
  } else {
    calc.push({
      id: "fixed-costs",
      inputs: Object.fromEntries(
        fixed.lines.map((l) => [l.id.replace(/[^a-z0-9]+/gi, "_"), fig("cents", l.cents)]),
      ),
      output: fig("cents", fixed.cents),
    });
  }
  if (fixed.cents !== null && middle !== null && incomeMiddle !== null) {
    const outgoing = incomeMiddle - middle;
    const raw = outgoing - fixed.cents;
    variableCents = Math.max(0, raw);
    calc.push({
      id: "variable-split",
      inputs: {
        median_month_outgoing: fig("cents", outgoing),
        fixed: fig("cents", fixed.cents),
      },
      output: fig("cents", variableCents),
    });
    if (raw < 0) {
      calc.push({
        id: "variable-floor",
        inputs: { before_floor: fig("cents", raw) },
        output: fig("cents", 0),
      });
    }
  }
  const fixedShare =
    fixed.cents !== null && incomeMiddle !== null ? ratio(fixed.cents, incomeMiddle) : null;
  const variableShare =
    variableCents !== null && incomeMiddle !== null ? ratio(variableCents, incomeMiddle) : null;

  // Savings rate: the room net over income, mean of the months. The amount moved
  // to own savings is reported beside it, never added again.
  let savingsRate: number | null = null;
  let savingsMovedCents: number | null = null;
  if (room.kind === "computed") {
    const moved = movedToSavings(
      i,
      view,
      room.months.map((m) => m.month),
    );
    const rates: number[] = [];
    let movedSum = 0;
    const rateInputs: FigureMap = {};
    for (const m of room.months) {
      movedSum += moved.get(m.month) ?? 0;
      // Transfers to the user's own savings are already inside the room net
      // (cleaned out of both sides), so the rate is net over income.
      const r = ratio(m.netCents, m.incomingCents);
      if (r !== null) {
        rates.push(r);
        rateInputs[`rate_${m.month.replace("-", "_")}`] = fig("ratio", r);
      }
    }
    savingsMovedCents = Math.round(movedSum / room.months.length);
    calc.push({
      id: "savings-moved",
      inputs: { months: fig("count", room.months.length) },
      output: fig("cents", savingsMovedCents),
    });
    if (rates.length > 0) {
      savingsRate = rates.reduce((s, r) => s + r, 0) / rates.length;
      calc.push({
        id: "savings-rate",
        inputs: rateInputs,
        output: fig("ratio", savingsRate),
      });
    }
  }

  // Status.
  const newestRoomMonth =
    room.kind === "computed"
      ? (room.months
          .map((m) => m.month)
          .sort()
          .at(-1) ?? null)
      : null;
  const staleRoom = newestRoomMonth !== null && newestRoomMonth !== previousMonths(i.asOf, 2)[1];
  const anyNegativeMonth = room.kind === "computed" && room.months.some((m) => m.netCents < 0);
  let status: SectionResult<MonthFigures>["status"];
  let statusReason: StatusReason;
  if (room.kind === "none") {
    status = "not-enough-data";
    statusReason = { key: "history-short" };
    missing.push(
      room.reason === "no-data"
        ? { kind: "bank-data", action: "connect-bank" }
        : { kind: "history-60d", action: "connect-bank" },
    );
  } else if (room.kind === "computed" && shortHistory) {
    status = "not-enough-data";
    statusReason = { key: "history-short" };
    missing.push({ kind: "history-60d", action: "connect-bank" });
  } else if (room.kind === "computed" && staleRoom) {
    // Same rule as spending: the figures rest on months that are not the latest.
    status = "not-enough-data";
    statusReason = { key: "data-stale" };
    const stale = room.blockingAccounts.filter((b) => b.reason === "stale");
    for (const b of stale)
      missing.push({ kind: "account-stale", action: "connect-bank", ref: b.id });
    if (stale.length === 0) missing.push({ kind: "bank-data", action: "connect-bank" });
  } else if (anyNegativeMonth) {
    status = "attention";
    statusReason = { key: "month-negative" };
  } else if (
    middle !== null &&
    incomeMiddle !== null &&
    incomeMiddle > 0 &&
    middle * ON_TRACK_DENOMINATOR >= incomeMiddle
  ) {
    status = "on-track";
    statusReason = { key: "room-ok" };
  } else {
    status = "attention";
    statusReason = { key: middle !== null && middle < 0 ? "month-negative" : "room-low" };
  }

  if (room.kind !== "none") {
    calc.unshift({
      id: "room-median",
      inputs: {
        low: fig("cents", room.lowCents),
        high: fig("cents", room.highCents),
        ...(incomeMiddle === null ? {} : { income: fig("cents", incomeMiddle) }),
      },
      output: fig("cents", middle),
    });
  }

  const flat: Record<MonthFlatId, FigureValue> = {
    room_middle: fig("cents", middle),
    room_low: fig("cents", room.kind === "none" ? null : room.lowCents),
    room_high: fig("cents", room.kind === "none" ? null : room.highCents),
    income_middle: fig("cents", incomeMiddle),
    fixed_share: fig("ratio", fixedShare),
    savings_rate: fig("ratio", savingsRate),
  };

  // Facts.
  const facts: PlanFact[] = [];
  const add = (
    factId: string,
    exact: number | null,
    unit: FigureUnit,
    extra: Partial<PlanFact> = {},
  ): void => {
    if (exact === null || !Number.isFinite(exact)) return;
    facts.push({
      factId,
      section: "month",
      exact,
      unit,
      polarity: "neutral",
      mustMention: false,
      ...extra,
    });
  };
  const negative = (v: number | null): { polarity: "negative" | "neutral" } => ({
    polarity: v !== null && v < 0 ? "negative" : "neutral",
  });
  if (middle !== null && room.kind !== "none") {
    add("room_month", middle, "cents", {
      ...negative(middle),
      mustMention: middle < 0,
      range: { low: room.lowCents, expected: middle, high: room.highCents, horizon: "month" },
    });
    add("room_low", room.lowCents, "cents", negative(room.lowCents));
    add("room_high", room.highCents, "cents", negative(room.highCents));
    add("room_year", middle * 12, "cents", { ...negative(middle), derivedFrom: ["room_month"] });
  }
  add("fixed_share", fixedShare, "ratio");
  add("savings_rate", savingsRate, "ratio");

  return {
    section: "month",
    figures: {
      room,
      incomeMiddleCents: incomeMiddle,
      fixedCents: fixed.cents,
      fixedShare,
      variableCents,
      variableShare,
      savingsRate,
      savingsMovedCents,
      nibudGuidanceFactId: "nibud-save-10pct",
    },
    flat,
    headline: middle === null ? null : fig("cents", middle),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}
