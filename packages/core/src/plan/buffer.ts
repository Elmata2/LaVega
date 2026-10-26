import { bufferMonths } from "../advisor/capacity.js";
import { fig, liquidAccountBalances, roomMiddleCents } from "./internal.js";
import { fixedCostsMonthlyCentsOf, type MonthFigures } from "./month.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type {
  CalcStep,
  FigureValue,
  FigureUnit,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** Every key this section puts in `flat` (the change log labels each one). */
export const BUFFER_FLAT_IDS = ["buffer_months", "buffer_gap_cents"] as const;
export type BufferFlatId = (typeof BUFFER_FLAT_IDS)[number];

export const BUFFER_CALC_IDS = [
  "liquid-savings",
  "buffer-months",
  "buffer-gap",
  "close-months",
  "object-buffer",
] as const;
export type BufferCalcId = (typeof BUFFER_CALC_IDS)[number];

export type BufferFigures = {
  liquidSavingsCents: number | null;
  fixedCostsMonthlyCents: number | null;
  incomeBufferMonths: number | null;
  targetMonths: number | null;
  gapCents: number | null;
  gapMonths: number | null;
  closeMonths: { low: number; high: number } | "not-reachable" | null;
  /** The room per month the closing time is worked out from (lowest and highest). */
  closeRoom: { lowCents: number; highCents: number } | null;
  /** Goals whose typed saved amount may be counted again in a stated savings
   *  total: the buffer fell back on the stated total and the goal has a typed
   *  amount and no account of its own. 0 otherwise. */
  statedOverlapGoalCount: number;
  objectBufferCents: number | null;
  objectShareOfSavings: number | null;
  excludedForeignCount: number;
  goalLinkedExcludedCents: number;
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
/** Guards float noise before a ceiling. */
const ceil = (x: number): number => Math.ceil(x - 1e-9);

export function computeBuffer(
  i: PlanInput,
  month: SectionResult<MonthFigures>,
): SectionResult<BufferFigures> {
  const { eur, excludedForeignCount } = liquidAccountBalances(i);
  const withBalance = eur.filter((a) => a.cents !== null);

  const goalKeys = new Set(
    i.profile.goals.flatMap((g) =>
      g.goal.accountRefs.filter((r) => r.kind === "bank").map((r) => r.id),
    ),
  );
  let gross = 0;
  let goalLinkedExcludedCents = 0;
  for (const a of withBalance) {
    const cents = a.cents!;
    if (goalKeys.has(a.key)) goalLinkedExcludedCents += cents;
    else gross += cents;
  }
  // A goal-linked account never counted toward the buffer, so its unknown
  // balance cannot blank it; the goals row counts it as excluded.
  const unknown = eur.filter((a) => a.cents === null && !goalKeys.has(a.key));
  // An unknown balance among known ones would understate the buffer: say so.
  let liquid: number | null = withBalance.length === 0 ? null : unknown.length > 0 ? null : gross;
  let statedSource = false;
  if (withBalance.length === 0 && i.profile.savingsStatedCents !== null) {
    liquid = i.profile.savingsStatedCents;
    statedSource = true;
  }

  const fixed = fixedCostsMonthlyCentsOf(i).cents;
  const target = i.profile.bufferTargetMonths;
  const raw = liquid !== null && fixed !== null ? bufferMonths(liquid, fixed) : null;
  // Floored so the shown figure never reaches the target while the status says below.
  const months = raw === null ? null : Math.floor(raw * 100 + 1e-9) / 100;

  const calc: CalcStep[] = [];
  const missing: Missing[] = [];
  if (liquid !== null) {
    calc.push({
      id: "liquid-savings",
      inputs: {
        accounts: fig("count", withBalance.length),
        goal_linked_excluded: fig("cents", goalLinkedExcludedCents),
        foreign_excluded: fig("count", excludedForeignCount),
        ...(statedSource ? { source: fig("count", "stated") } : {}),
      },
      output: fig("cents", liquid),
    });
  } else if (unknown.length > 0) {
    for (const a of unknown)
      missing.push({ kind: "savings-balance", action: "import", ref: a.key });
  } else missing.push({ kind: "savings-balance", action: "connect-bank" });
  if (fixed === null || fixed <= 0)
    missing.push({ kind: "fixed-costs", action: "intake-question" });
  if (target === null) missing.push({ kind: "buffer-target", action: "enter-figure" });
  if (months !== null) {
    calc.push({
      id: "buffer-months",
      inputs: { liquid: fig("cents", liquid), fixed: fig("cents", fixed) },
      output: fig("months", months),
    });
  }

  // Gap against the user's own target only; never against a default.
  let gapCents: number | null = null;
  let gapMonths: number | null = null;
  if (liquid !== null && fixed !== null && fixed > 0 && target !== null) {
    gapCents = Math.max(0, Math.round(target * fixed - liquid));
    gapMonths = round2(gapCents / fixed);
    calc.push({
      id: "buffer-gap",
      inputs: {
        target_months: fig("months", target),
        fixed: fig("cents", fixed),
        liquid: fig("cents", liquid),
      },
      output: fig("cents", gapCents),
    });
  }

  // Time to close the gap: gap over the room range, no date.
  let closeMonths: BufferFigures["closeMonths"] = null;
  let closeRoom: BufferFigures["closeRoom"] = null;
  const room = month.figures.room;
  const roomMiddle = roomMiddleCents(room);
  // A stale room (the month section says data-stale) is not an example to
  // count a closing time from.
  const roomStale = month.statusReason.key === "data-stale";
  if (
    gapCents !== null &&
    gapCents > 0 &&
    room.kind !== "none" &&
    roomMiddle !== null &&
    !roomStale
  ) {
    const high = room.lowCents > 0 ? ceil(gapCents / room.lowCents) : Infinity;
    if (room.lowCents <= 0 || roomMiddle <= 0 || high > PLAN_THRESHOLDS.buffer.maxCloseMonths)
      closeMonths = "not-reachable";
    else {
      closeMonths = { low: ceil(gapCents / room.highCents), high };
      closeRoom = { lowCents: room.lowCents, highCents: room.highCents };
      calc.push({
        id: "close-months",
        inputs: {
          gap: fig("cents", gapCents),
          room_low: fig("cents", room.lowCents),
          room_high: fig("cents", room.highCents),
        },
        output: fig("months", closeMonths.high),
      });
    }
  }

  // Object buffer: the typed Nibud result and its share of savings.
  const objectBufferCents = i.preferences.nibudBufferResult?.cents ?? null;
  const objectShareOfSavings =
    objectBufferCents !== null && liquid !== null && liquid > 0 ? objectBufferCents / liquid : null;
  if (objectShareOfSavings !== null) {
    calc.push({
      id: "object-buffer",
      inputs: { typed: fig("cents", objectBufferCents), liquid: fig("cents", liquid) },
      output: fig("ratio", objectShareOfSavings),
    });
  }

  let status: SectionResult<BufferFigures>["status"];
  let statusReason: StatusReason;
  if (fixed === null || fixed <= 0) {
    status = "not-enough-data";
    statusReason = { key: "no-fixed-costs" };
  } else if (liquid === null) {
    status = "not-enough-data";
    statusReason = { key: "no-savings" };
  } else if (target === null) {
    status = "not-enough-data";
    statusReason = { key: "no-target" };
  } else if (liquid >= target * fixed) {
    status = "on-track";
    statusReason = { key: "at-target" };
  } else {
    status = "attention";
    statusReason = { key: "below-target" };
  }

  const flat: Record<BufferFlatId, FigureValue> = {
    buffer_months: fig("months", months),
    buffer_gap_cents: fig("cents", gapCents),
  };

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
      section: "buffer",
      exact,
      unit,
      polarity: "neutral",
      mustMention: false,
      ...extra,
    });
  };
  add("buffer_months", months, "months");
  add("buffer_gap", gapCents, "cents", {
    polarity: gapCents !== null && gapCents > 0 ? "negative" : "neutral",
  });
  add("buffer_gap_months", gapMonths, "months", { derivedFrom: ["buffer_gap"] });
  if (i.profile.incomeStreams.some((s) => !s.regular)) {
    add("buffer_irregular_income", 1, "count");
  }

  return {
    section: "buffer",
    figures: {
      liquidSavingsCents: liquid,
      fixedCostsMonthlyCents: fixed,
      incomeBufferMonths: months,
      targetMonths: target,
      gapCents,
      gapMonths,
      closeMonths,
      closeRoom,
      statedOverlapGoalCount: statedSource
        ? i.profile.goals.filter(
            ({ goal: g }) =>
              (g.startingBalanceCents ?? 0) > 0 && !g.accountRefs.some((r) => r.kind === "bank"),
          ).length
        : 0,
      objectBufferCents,
      objectShareOfSavings,
      excludedForeignCount,
      goalLinkedExcludedCents,
    },
    flat,
    headline: months === null ? null : fig("months", months),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}
