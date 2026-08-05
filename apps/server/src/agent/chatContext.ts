export const CHAT_TABS = ["overview","rekeningen","regels","forecast","optimalisatie","valuta","belasting","facturen","punten","backup"] as const;
export type ChatTab = (typeof CHAT_TABS)[number];
export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_CONTEXT_CHARS = 60_000;
const MAX_MSG_CHARS = 8_000;
const MAX_MSGS = 20;

/** Per-tab allowlist of top-level context keys the client may send. Nothing
 *  outside this can reach Claude — the chat redaction boundary. */
const ALLOW: Record<string, readonly string[]> = {
  overview: ["entities", "categories", "alertCount", "shortfall", "bufferCents"],
  rekeningen: ["accounts"],
  regels: ["rules"],
  forecast: ["summary"],
  optimalisatie: ["subscriptions", "rates", "bestBenchmark"],
  valuta: ["rate", "holdings"],
  belasting: ["vat", "deadlines", "settings"],
  facturen: ["invoices"],
  punten: ["balances"],
  backup: [],
};

export function sanitizeChatContext(tab: string, raw: unknown): Record<string, unknown> {
  const allow = ALLOW[tab] ?? [];
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of allow) if (k in r) out[k] = r[k];
  }
  if (JSON.stringify(out).length > MAX_CONTEXT_CHARS) throw new Error("context te groot");
  return out;
}

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
        // Anthropic rejects.
        if (content.trim() === "") continue;
        out.push({ role, content: content.slice(0, MAX_MSG_CHARS) });
      }
    }
  }
  const capped = out.slice(-MAX_MSGS);
  // Anthropic requires the first message to be `user`; the tail slice (or a
  // history that opened mid-turn) can leave a leading `assistant`. Drop any
  // leading assistant turns so the result starts with `user` (or is empty).
  let start = 0;
  while (start < capped.length && capped[start].role === "assistant") start++;
  return capped.slice(start);
}
