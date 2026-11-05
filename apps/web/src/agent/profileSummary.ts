import type { AdvisorProfile, ProfileSummary } from "@lavega/core";
import { sanitizeProfileSummary } from "@lavega/core";

/** The profile as the AI chat may see it: enum answers only (see
 *  `ProfileSummary`). Reads each field's `.value` and nothing else, so birth
 *  year, banks, cards, amounts and the free-text `worries` cannot be picked up
 *  by accident; `sanitizeProfileSummary` then drops anything not a known enum. */
export function profileSummaryOf(p: AdvisorProfile): ProfileSummary {
  return sanitizeProfileSummary({
    priorities: p.priorities?.value,
    cutTargets: p.cutTargets?.value,
    checkInCadence: p.checkInCadence?.value,
    confidence: p.confidence?.value,
    household: p.household?.value.kind,
    moneySharing: p.household?.value.moneySharing,
    incomeRegularity: p.incomeRegularity?.value,
    spendMix: p.spendMix?.value,
    cardRepayment: p.cardRepayment?.value,
    pointsGoal: p.pointsGoal?.value,
  });
}
