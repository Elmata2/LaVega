import Anthropic from "@anthropic-ai/sdk";
import { CATEGORY_OPTIONS } from "@lavega/core";

export type CategorizeItem = { id: string; text: string; sign: "in" | "out" };

const MAX_ITEMS = 200;
const MAX_TEXT = 200;

/** THE redaction boundary for bulk categorization: only {id, text, sign} per
 *  item can ever reach Claude — never amounts, balances, account keys, or dates.
 *  Builds a fresh array from allowlisted fields; throws on empty/oversize. */
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
    items.push({ id, text, sign: o.sign === "in" ? "in" : "out" });
  }
  if (items.length === 0) throw new Error("geen geldige items");
  return { items };
}

const CATEGORIZE_TOOL = {
  name: "categorize_transactions",
  description: "Wijs elke transactie een categorie toe uit de toegestane lijst.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            category: { type: "string", enum: [...CATEGORY_OPTIONS] },
          },
          required: ["id", "category"],
        },
      },
    },
    required: ["results"],
  },
} as const;

const VALID = new Set(CATEGORY_OPTIONS);

/** Bulk-categorize transactions via Haiku (forced tool). Returns [{id, category}]
 *  for the ids the model classified, filtered to the allowed taxonomy. The only
 *  place `@anthropic-ai/sdk` is imported for categorization; it only ever sees
 *  the sanitized {id, text, sign} items. */
export async function categorizeTransactions(
  input: { items: CategorizeItem[] },
  apiKey: string,
): Promise<{ id: string; category: string }[]> {
  const client = new Anthropic({ apiKey });
  const list = input.items.map((it) => `${it.id}\t[${it.sign}] ${it.text}`).join("\n");
  const prompt =
    "Je krijgt banktransacties (id, richting in/uit, omschrijving). Wijs elke transactie een categorie " +
    "toe uit de toegestane lijst (zie het tool-schema). Gebruik 'Inkomen' voor inkomende bedragen, " +
    "'Eigen overboeking' of 'Overboekingen' voor overboekingen tussen rekeningen, en laat een id weg " +
    "als je het echt niet kunt bepalen. Transacties:\n" +
    list;
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    tools: [CATEGORIZE_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "categorize_transactions" },
    messages: [{ role: "user", content: prompt }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  const results = (block.input as { results?: unknown }).results;
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
