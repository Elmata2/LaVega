import type { Tx, CategoryDecision } from "@lavega/core";
import type { CategorizeItem } from "./api.js";

/** Max transactions to send per AI-categorize batch — matches the server's
 *  MAX_ITEMS cap in `agent/categorize.ts`. The view slices onbekend txs to this. */
export const MAX_CATEGORIZE_BATCH = 200;

/** Build the redacted {id, text, sign} items for the AI-categorize proxy.
 *  `text` = counterparty + description, trimmed to 200 chars (the server's
 *  MAX_TEXT); `sign` is derived from the amount's direction. This is the
 *  privacy boundary in the browser: NO amount, balance, account key, or date
 *  is ever put on an item (the server re-enforces the same allowlist). */
export function buildCategorizeItems(txs: Tx[]): CategorizeItem[] {
  return txs.map((t) => ({
    id: t.id,
    text: `${t.counterparty} ${t.description}`.trim().slice(0, 200),
    sign: t.amount >= 0 ? "in" : "out",
  }));
}

/** Turn the reviewed rows into confirmed decisions, dropping any the owner left
 *  on "Sla over" (empty category). */
export function toDecisions(rows: { id: string; category: string }[]): CategoryDecision[] {
  return rows.filter((r) => r.category).map((r) => ({ id: r.id, category: r.category }));
}
