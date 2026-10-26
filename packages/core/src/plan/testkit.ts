import { emptyPlanPreferences } from "./preferences.js";
import { planProfileOf, type PlanProfile } from "./profileView.js";
import type { PlanInput } from "./types.js";
import { ownAccounts } from "../views.js";

export const AS_OF = "2026-10-24";

/** A PlanInput with nothing in it; tests override what they need. `own` is
 *  derived from `accounts` unless given. */
export function planInput(
  over: Partial<Omit<PlanInput, "profile">> & { profile?: Partial<PlanProfile> } = {},
): PlanInput {
  const { profile, ...rest } = over;
  const accounts = rest.accounts ?? [];
  return {
    profile: { ...planProfileOf(null), ...profile },
    txs: [],
    accounts,
    entityProfiles: [],
    rules: [],
    own: ownAccounts(accounts),
    rewards: [],
    catalogue: [],
    rates: [],
    heldCards: [],
    preferences: emptyPlanPreferences(),
    events: [],
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    asOf: AS_OF,
    ...rest,
  };
}

/** ceil(target / months), the 0% required monthly saving (test oracle). */
export const goalRequiredMonthly0 = (targetCents: number, months: number): number =>
  Math.ceil(targetCents / months);
