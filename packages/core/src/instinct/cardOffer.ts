import type { PlanResult } from "../plan/compute.js";
import type { AgentMirror } from "./types.js";

/* The one card-offer figure, from a computed plan. The daily-message mirror and
 * the assistant's `plan_summary` tool read the same number, and it is the plan's
 * own card verdict (`figures.advice`), so the Instinct message, "Kaarten en punten"
 * and Optimalisatie never disagree. Pure: `today` is an argument. */

/** The largest yearly gain the mirror may carry; the server refuses more. */
export const MAX_YEARLY_GAIN_CENTS = 100_000_000;
const NAME_MAX = 200;

/** The verdict's better card and its yearly gain over the card in use. */
export function cardOfferOf(plan: PlanResult | null, today: string): AgentMirror["cardOffer"] {
  if (!plan) return null;
  // `advice` is absent on a plan computed before the advice existed: no offer, no throw.
  const advice = plan.sections?.cards?.figures?.advice;
  if (!advice) return null;
  // An unprompted daily message needs a firm figure. A verdict built from wizard
  // answers alone (`basis: "stated"`) is not strong enough, and while card debt is
  // carried the card comparison leaves interest out, so paying off comes first.
  if (advice.verdict.kind !== "switch") return null;
  if (advice.ignoresInterest || advice.basis !== "history") return null;
  // The message text compares with the user's current card ("ten opzichte van je
  // huidige kaart"). A user with no credit card has none to compare with, and a
  // first-card pitch is not sent unasked.
  if (advice.baseline.kind !== "best-held") return null;
  const gain = advice.verdict.gainCents;
  if (!Number.isInteger(gain) || gain <= 0) return null;
  // The server refuses the whole mirror on an empty name, so a nameless card gives no offer.
  const name = advice.verdict.best.name.trim().slice(0, NAME_MAX);
  if (name === "") return null;
  return {
    name,
    yearlyGainCents: Math.min(gain, MAX_YEARLY_GAIN_CENTS),
    computedAt: today,
  };
}
