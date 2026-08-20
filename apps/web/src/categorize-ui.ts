import type { Tx, CategoryDecision } from "@lavega/core";
import type { CategorizeItem } from "./api.js";

/** Max transactions to send per AI-categorize batch — matches the server's
 *  MAX_ITEMS cap in `agent/categorize.ts`. The view slices onbekend txs to this. */
export const MAX_CATEGORIZE_BATCH = 200;

/* THE REDACTION USED TO LIVE HERE and no longer does. Its IBAN pattern could hop
 * across whitespace one character at a time, so it deleted the merchant name along
 * with the IBAN — on the owner's real data that blanked 747 of 1.394 onbekend rows,
 * and the model could only ever answer those with silence.
 *
 * The fixed implementation is packages/core/src/categorize.ts → aiCategorizeItems,
 * which is where it belongs: it is a pure transform and the core is where the tests
 * that guard the consent promise ("geen IBANs, bedragen of datums") should sit.
 *
 * The old copy is deleted rather than left unused, because a second redaction
 * function with the old bug in it is exactly the thing someone reaches for next.
 * Do not re-add one here — import from the core. */

export function toDecisions(rows: { id: string; category: string }[]): CategoryDecision[] {
  return rows.filter((r) => r.category).map((r) => ({ id: r.id, category: r.category }));
}
