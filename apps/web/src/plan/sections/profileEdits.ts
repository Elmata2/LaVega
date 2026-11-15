import { AdvisorProfile, type Goal } from "@lavega/core";
import type { PlanCtx } from "./types.js";

/** One goal changed by the person: stored as a confirmed fact dated `asOf`. */
export const applyGoalEdit = (
  p: AdvisorProfile,
  goalId: string,
  edit: (g: Goal) => Goal,
  asOf: string,
): AdvisorProfile =>
  new AdvisorProfile({
    ...p,
    goals: (p.goals ?? []).map((f) =>
      f.value.id === goalId ? { value: edit(f.value), source: "confirmed" as const, at: asOf } : f,
    ),
  });

/** One debt's rate or balance filled in by the person: stored as a confirmed
 *  edit dated `asOf`. Evidence from a detected debt is kept. */
export const applyDebtEdit = (
  p: AdvisorProfile,
  debtId: string,
  change: { ratePct?: number; balanceCents?: number },
  asOf: string,
): AdvisorProfile =>
  new AdvisorProfile({
    ...p,
    debts: (p.debts ?? []).map((d) =>
      d.id === debtId ? { ...d, ...change, source: "confirmed" as const, at: asOf } : d,
    ),
  });

/** A copy of `o` without `key` (optional schema keys cannot hold undefined). */
export function dropKey<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const { [key]: _gone, ...rest } = o;
  return rest;
}

/** Run a profile change and fail loudly when it was not stored, so the input
 *  that asked for it can say so instead of showing a figure that is not kept. */
export async function saveProfile(
  ctx: PlanCtx,
  change: (p: AdvisorProfile) => AdvisorProfile,
): Promise<void> {
  if (!(await ctx.profile.update(change))) throw new Error("the profile was not stored");
}
