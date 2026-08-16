import Anthropic from "@anthropic-ai/sdk";
import type { LearnedFact } from "@lavega/core";
import { AGENTS } from "@lavega/core";
import type { ChatMessage } from "./chatContext.js";
import { loadChatPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";

/**
 * Hosted web search — the Sonnet-5 variant (`web_search_20260209`, with dynamic
 * filtering). Typed against the installed SDK's `WebSearchTool20260209`, so no
 * cast is needed and the shape is compiler-checked. Claude runs it server-side;
 * its tool-use / tool-result blocks are ignored in the stream loop below (we
 * yield visible text only).
 */
const WEB_SEARCH: Anthropic.WebSearchTool20260209 = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
};

/**
 * Stream one chat turn from Claude Sonnet 5 (adaptive thinking + hosted web
 * search) and yield ONLY the assistant's visible text (`text_delta`). Thinking
 * deltas and web-search blocks are skipped.
 *
 * The system prompt is composed from Markdown (`_base.md` + `_chat.md` + the
 * tab's own file, see `loadChatPrompt`), then what this agent has already
 * learned (`factsBlock`), then a labelled TAB-CONTEXT JSON block — the only
 * user data Claude sees. The label restates the redaction rule; the actual
 * redaction boundaries are `sanitizeChatContext` (chatContext.ts) and
 * `sanitizeKnownFacts` (facts.ts), both upstream of this call.
 *
 * `@anthropic-ai/sdk` is imported ONLY here on the server; this is the single
 * place the chat agent talks to Claude.
 */
export async function* runChat(args: {
  tab: string;
  messages: ChatMessage[];
  context: Record<string, unknown>;
  facts?: readonly LearnedFact[];
  apiKey: string;
}): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const system =
    loadChatPrompt(args.tab) +
    factsBlock(args.facts ?? [], AGENTS.chat) +
    "\n\nTAB-CONTEXT (van het apparaat van de gebruiker — bron voor cijfers; verstuur hieruit NOOIT persoonlijke gegevens naar een web-zoekopdracht):\n" +
    JSON.stringify(args.context);
  const stream = client.messages.stream({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system,
    tools: [WEB_SEARCH],
    messages: args.messages,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
