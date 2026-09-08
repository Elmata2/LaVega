import { AGENTS, CATEGORY_OPTIONS, scrubPersonalValues, type LearnedFact } from "@lavega/core";
import { loadAgentPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";
import { createMistralProvider } from "./mistral.js";

export type CategorizeItem = { id: string; text: string; sign: "in" | "out" };

const MAX_ITEMS = 200;
const MAX_TEXT = 200;

/** THE redaction boundary for bulk categorization: only {id, text, sign} per
 *  item can ever reach Mistral — never amounts, balances, account keys, or dates.
 *  Builds a fresh array from allowlisted fields; throws on empty/oversize.
 *
 *  M5: an allowlist on field names says nothing about what sits inside `text`
 *  — the browser's own scrub could be stale, bypassed, or simply wrong. So
 *  `text` is run through `scrubPersonalValues` again here, server-side, before
 *  it is trusted. Defence in depth, not a replacement for the browser pass. */
export function sanitizeCategorizeInput(raw: unknown): { items: CategorizeItem[] } {
  if (!raw || typeof raw !== "object") throw new Error("ongeldige invoer");
  const rawItems = (raw as Record<string, unknown>).items;
  if (!Array.isArray(rawItems)) throw new Error("geen items");
  if (rawItems.length > MAX_ITEMS) throw new Error("te veel items");
  const items: CategorizeItem[] = [];
  for (const r of rawItems) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = o.id;
    const text = o.text;
    if (typeof id !== "string" || typeof text !== "string") continue;
    if (text.length > MAX_TEXT) throw new Error("tekst te lang");
    items.push({ id, text: scrubPersonalValues(text), sign: o.sign === "in" ? "in" : "out" });
  }
  if (items.length === 0) throw new Error("geen geldige items");
  return { items };
}

const VALID = new Set(CATEGORY_OPTIONS);

/** Bulk-categorize transactions via the Mistral provider (JSON mode). Returns
 *  [{id, category}] for the ids the model classified, filtered to the allowed
 *  taxonomy. It only ever sees the sanitized {id, text, sign} items.
 *
 *  Its behaviour lives in `prompts/categorize.md` (composed with `_base.md`),
 *  not in this file — plus what it has learned about how the owner re-files its
 *  suggestions, which is what stops him correcting the same category twice. */
export async function categorizeTransactions(
  input: { items: CategorizeItem[] },
  apiKey: string,
  facts: readonly LearnedFact[] = [],
): Promise<{ id: string; category: string }[]> {
  const provider = createMistralProvider(apiKey, "mistral-small-latest");
  const list = input.items.map((it) => `${it.id}\t[${it.sign}] ${it.text}`).join("\n");
  const res = await provider.complete({
    system: loadAgentPrompt("categorize") + factsBlock(facts, AGENTS.categorize),
    user: `Transacties:\n${list}`,
    json: true,
    // Headroom for a full MAX_ITEMS (200) batch: ~200 × {id,category} objects
    // land well under this, so the JSON won't truncate mid-array.
    maxTokens: 8192,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return [];
  }
  const results = (parsed as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: { id: string; category: string }[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const id = (r as Record<string, unknown>).id;
    const category = (r as Record<string, unknown>).category;
    if (typeof id === "string" && typeof category === "string" && VALID.has(category)) {
      out.push({ id, category });
    }
  }
  return out;
}
