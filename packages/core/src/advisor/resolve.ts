import type { AdvisorProfile } from "./profile.js";
import {
  capacityInputs,
  debtPaymentsMonthly,
  scoreCapacity,
  type CapacityScore,
} from "./capacity.js";
import { roomFromStated, type RoomResult } from "./room.js";
import { MIN_HISTORY_DAYS } from "./scopePersonal.js";

type Range = { lowCents: number; highCents: number };

/** Fixed costs as the profile holds them: the confirmed housing line plus the
 *  confirmed fixed costs. A guess nobody confirmed is not counted. */
export const fixedCostsMonthlyCents = (p: AdvisorProfile): number =>
  (p.housing?.value.monthlyCents ?? 0) +
  (p.fixedCosts ?? []).reduce((s, f) => s + f.value.monthlyCents, 0);

/** What capacity reads, apart from the room. The plan holds these as plain
 *  figures; the intake holds them inside an AdvisorProfile. */
export type CapacityParts = {
  /** null: no savings figure, so the buffer part is left out. */
  savingsCents: number | null;
  fixedCostsMonthlyCents: number;
  debtMonthlyCents: readonly number[];
  goals: readonly { targetDate: string }[];
};

/** The one capacity computation (About-you and the plan both call it). */
export function capacityForParts(parts: CapacityParts, room: RoomResult, asOf: string): CapacityScore {
  const inputs = capacityInputs({
    savingsCents: parts.savingsCents ?? 0,
    fixedCostsMonthlyCents: parts.fixedCostsMonthlyCents,
    room,
    debtPaymentsMonthlyCents: debtPaymentsMonthly([], parts.debtMonthlyCents),
    goals: parts.goals,
    asOf,
  });
  return scoreCapacity({
    ...inputs,
    bufferMonths: parts.savingsCents === null ? null : inputs.bufferMonths,
  });
}

/** Capacity from what the profile holds plus the room. Never stored. */
export function capacityFor(p: AdvisorProfile, room: RoomResult, asOf: string): CapacityScore {
  return capacityForParts(
    {
      savingsCents: p.savings?.value.totalCents ?? null,
      fixedCostsMonthlyCents: fixedCostsMonthlyCents(p),
      debtMonthlyCents: (p.debts ?? []).map((d) => d.monthlyCents),
      goals: (p.goals ?? []).map((g) => g.value),
    },
    room,
    asOf,
  );
}

/** The room to show, from the two stated ranges directly (the plan holds them
 *  outside an AdvisorProfile): the computed room when it is one with enough
 *  history, else the room worked out from the ranges when both exist, else the
 *  computed result. Under MIN_HISTORY_DAYS of history the stated ranges replace
 *  a computed room for every caller (About-you, home card, intake, plan). */
export function resolveRoomRanges(
  computed: RoomResult,
  income: Range | null | undefined,
  spend: Range | null | undefined,
): { room: RoomResult; statedInputs?: { income: Range; spend: Range } } {
  if (income == null || spend == null) return { room: computed };
  const short = computed.kind === "computed" && (computed.coverageDays ?? MIN_HISTORY_DAYS) < MIN_HISTORY_DAYS;
  if (computed.kind === "computed" && !short) return { room: computed };
  return { room: roomFromStated(income, spend), statedInputs: { income, spend } };
}

/** The room to show: the computed one when transactions allow it, else the one
 *  worked out from the user's own ranges, else the computed "none". */
export function resolveRoom(
  computed: RoomResult,
  profile: AdvisorProfile,
): { room: RoomResult; statedInputs?: { income: Range; spend: Range } } {
  const r = profile.statedRanges?.value;
  return resolveRoomRanges(computed, r?.income, r?.spend);
}
