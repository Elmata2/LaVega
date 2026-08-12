import type { Tx, CategoryDecision } from "@lavega/core";
import type { CategorizeItem } from "./api.js";

/** Max transactions to send per AI-categorize batch — matches the server's
 *  MAX_ITEMS cap in `agent/categorize.ts`. The view slices onbekend txs to this. */
export const MAX_CATEGORIZE_BATCH = 200;

/** Best-effort scrub of sensitive numeric content from the free-text BEFORE it
 *  leaves the browser: IBANs, dates, money amounts, and any long digit run
 *  (account/card fragments, payment references). Merchant names are alphabetic,
 *  so they survive — this is what lets the field be free-text while keeping the
 *  consent promise ("geen IBANs, bedragen of datums"). Privacy over recall:
 *  over-scrubbing a city or a store number is acceptable. */
export function scrubSensitive(text: string): string {
  return text
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){8,30}\b/gi, " ") // IBANs (with or without spaces)
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ") // ISO-ish dates: 2026-08-01
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, " ") // 01-08-2026 / 1/8/26
    .replace(/(?:€|eur)\s?\d[\d.,]*/gi, " ") // € 45 / EUR 45,00
    .replace(/\b\d{1,3}(?:[.\s]\d{3})+[,.]\d{2}\b/g, " ") // grouped amounts: 1.234,56
    .replace(/\b\d+[,.]\d{2}\b/g, " ") // plain amounts: 45,00 / 45.00
    .replace(/\b\d{4,}\b/g, " ") // long digit runs (account/card/ref fragments)
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the redacted {id, text, sign} items for the AI-categorize proxy.
 *  `text` = scrubbed counterparty + description, trimmed to 200 chars (the
 *  server's MAX_TEXT); `sign` is derived from the amount's direction. This is
 *  the privacy boundary in the browser: NO amount, balance, account key, or
 *  date field is ever put on an item, and `scrubSensitive` strips IBANs/amounts/
 *  dates that can hide inside the free-text (the server re-enforces the field
 *  allowlist + size cap). */
export function buildCategorizeItems(txs: Tx[]): CategorizeItem[] {
  return txs.map((t) => ({
    id: t.id,
    text: scrubSensitive(`${t.counterparty} ${t.description}`).slice(0, 200),
    sign: t.amount >= 0 ? "in" : "out",
  }));
}

/** Turn the reviewed rows into confirmed decisions, dropping any the owner left
 *  on "Sla over" (empty category). */
export function toDecisions(rows: { id: string; category: string }[]): CategoryDecision[] {
  return rows.filter((r) => r.category).map((r) => ({ id: r.id, category: r.category }));
}
