import { PLAN_THRESHOLDS } from "../plan/thresholds.js";
import type { PlanResult } from "../plan/compute.js";
import type { AgentMirror } from "./types.js";

/* The one card-offer figure, from a computed plan. Moved here from the web
 * mirror so the daily-message mirror and the assistant's `plan_summary` tool
 * read the same number. Pure: `today` is an argument. */

/** The largest yearly gain the mirror may carry; the server refuses more. */
export const MAX_YEARLY_GAIN_CENTS = 100_000_000;
const FULL_YEAR_MONTHS = 12;

const clip = (value: string, max: number): string => value.slice(0, max);

/** The best other card's gain over the card in use, as a yearly figure. */
export function cardOfferOf(plan: PlanResult | null, today: string): AgentMirror["cardOffer"] {
  if (!plan) return null;
  const f = plan.sections.cards.figures;
  const inUse = f.nets.find((n) => n.cardKey === f.cardInUseKey);
  if (!inUse || inUse.netCents === null) return null;
  let best: { name: string; netCents: number } | null = null;
  for (const n of f.nets) {
    if (n.cardKey === inUse.cardKey || n.netCents === null) continue;
    if (best === null || n.netCents > best.netCents) best = { name: n.name, netCents: n.netCents };
  }
  if (!best) return null;
  // The same margin cards.ts needs before it calls another card better.
  const margin = PLAN_THRESHOLDS.cards.betterCardMargin * Math.abs(inUse.netCents);
  if (best.netCents - inUse.netCents - margin <= 1e-9) return null;
  // The nets cover `horizon` months; the stated-spend case covers a full year.
  const horizon =
    f.cardableSpendCents === 0
      ? FULL_YEAR_MONTHS
      : Math.max(1, Math.min(f.months, FULL_YEAR_MONTHS));
  const yearly = Math.round(((best.netCents - inUse.netCents) * FULL_YEAR_MONTHS) / horizon);
  if (!Number.isInteger(yearly) || yearly <= 0) return null;
  return {
    name: clip(best.name, 200),
    yearlyGainCents: Math.min(yearly, MAX_YEARLY_GAIN_CENTS),
    computedAt: today,
  };
}
