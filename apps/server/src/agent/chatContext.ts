import { scrubPersonalValues, scrubPersonalValuesDeep } from "@lavega/core";
import { ValidationError } from "./validationError.js";

export const CHAT_TABS = [
  "overview",
  "rekeningen",
  "regels",
  "forecast",
  "optimalisatie",
  "valuta",
  "belasting",
  "facturen",
  "punten",
  "backup",
] as const;
export type ChatTab = (typeof CHAT_TABS)[number];
export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_CONTEXT_CHARS = 60_000;
const MAX_MSG_CHARS = 8_000;
const MAX_MSGS = 20;

/** Per-tab allowlist of top-level context keys the client may send. Nothing
 *  outside this can reach Mistral — the chat redaction boundary.
 *
 *  It is a list of KEY NAMES and says nothing about what a key contains, so it
 *  is only half the boundary; `sanitizeChatContext` also value-scrubs whatever
 *  survives the list. See the note on that function. */
const ALLOW: Record<string, readonly string[]> = {
  overview: ["entities", "categories", "alertCount", "shortfall", "bufferCents"],
  rekeningen: ["accounts"],
  regels: ["rules"],
  forecast: ["summary"],
  optimalisatie: ["subscriptions", "rates", "bestBenchmark"],
  valuta: ["rate", "holdings"],
  // `country` + `rules` carry the active tax pack (which country, its VAT label
  // and rates, its caveats); `prepayments` the profit-tax reservations a country
  // like DE demands; `sheet` only how the owner's spreadsheet is MAPPED (which
  // column holds which figure) and its problems — never its cells.
  belasting: ["vat", "deadlines", "settings", "country", "rules", "prepayments", "sheet"],
  facturen: ["invoices"],
  // `tracking` = which hand-kept balances have gone stale and the question to
  // ask for each (programme, state, days overdue, question text). The question
  // is built value-free in core's `trackingQuestion`, so this key carries no
  // points totals of its own — the numbers stay in `balances`.
  punten: ["balances", "tracking"],
  backup: [],
};

/** The structured half of the chat boundary: keep only the tab's allowlisted
 *  top-level keys, then value-scrub everything inside them.
 *
 *  The scrub is here because the allowlist alone could not see a leak it was
 *  waving through. `forecast` allows exactly one key, `summary`, and that key
 *  carries `drivers[].label`, the raw counterparty of a bank row — which for an
 *  ABN CSV or a /NAME/-less MT940 is the head of the statement line, IBAN
 *  first. The browser's builder is the first line of defence, but this server
 *  is the thing that actually talks to Mistral and it cannot tell whether a
 *  builder was widened, so the value rule has to hold here too. */
export function sanitizeChatContext(tab: string, raw: unknown): Record<string, unknown> {
  const allow = ALLOW[tab] ?? [];
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of allow) if (k in r) out[k] = scrubPersonalValuesDeep(r[k]);
  }
  if (JSON.stringify(out).length > MAX_CONTEXT_CHARS)
    throw new ValidationError("chat-context-too-large", "context te groot");
  return out;
}

/** M5: the owner types this content free-hand (an IBAN pasted into the chat
 *  box, say), so — unlike `sanitizeChatContext`'s structured, allowlisted
 *  fields — it gets the same value-scrub the categorize boundary applies. */
export function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (m && typeof m === "object") {
      const role = (m as Record<string, unknown>).role;
      const content = (m as Record<string, unknown>).content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        // Drop empty/whitespace-only messages: a turn that yields no text
        // leaves an empty-content assistant message in history, which
        // Mistral rejects.
        if (content.trim() === "") continue;
        out.push({ role, content: scrubPersonalValues(content).slice(0, MAX_MSG_CHARS) });
      }
    }
  }
  const capped = out.slice(-MAX_MSGS);
  // Mistral requires the first message to be `user`; the tail slice (or a
  // history that opened mid-turn) can leave a leading `assistant`. Drop any
  // leading assistant turns so the result starts with `user` (or is empty).
  let start = 0;
  while (start < capped.length && capped[start].role === "assistant") start++;
  return capped.slice(start);
}
