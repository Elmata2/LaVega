import type { RoomResult } from "../advisor/room.js";
import { personalView } from "../advisor/scopePersonal.js";
import { accountTypeKind, withCurrentBalances } from "../balance.js";
import { isEurCurrency } from "../model.js";
import type { FigureUnit, FigureValue, PlanInput } from "./types.js";

/* Plan-internal helpers; deliberately not exported from the plan barrel. */

export const fig = (unit: FigureUnit, value: number | string | null): FigureValue => ({
  unit,
  value,
});

/** The middle of the room: the median month for a computed room, the midpoint
 *  of the range for a stated one, null when there is no room. */
export function roomMiddleCents(room: RoomResult): number | null {
  if (room.kind === "computed") return room.middleCents;
  if (room.kind === "stated") return Math.round((room.lowCents + room.highCents) / 2);
  return null;
}

/** The personal-scope savings and current accounts, balances rolled forward.
 *  The ONE source of "which balances count": the buffer subtracts the
 *  goal-linked ones and the goals section adds exactly those back. Foreign
 *  accounts are counted, never summed. `cents` is null for an unknown balance. */
export function liquidAccountBalances(i: PlanInput): {
  eur: { key: string; cents: number | null }[];
  excludedForeignCount: number;
} {
  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const rolled = withCurrentBalances(view.accounts, view.txs, i.asOf);
  const liquid = rolled.filter((a) => {
    const k = accountTypeKind(a);
    return k === "savings" || k === "current";
  });
  const eur = liquid.filter((a) => isEurCurrency(a.currency));
  return {
    eur: eur.map((a) => ({ key: a.key, cents: a.balance === null ? null : Math.round(a.balance * 100) })),
    excludedForeignCount: liquid.length - eur.length,
  };
}
