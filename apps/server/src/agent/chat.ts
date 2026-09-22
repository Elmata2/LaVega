import type { LearnedFact } from "@lavega/core";
import { AGENTS } from "@lavega/core";
import type { ChatMessage } from "./chatContext.js";
import { loadChatPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";
import { createMistralProvider } from "./mistral.js";
import { MISTRAL_MEDIUM } from "./models.js";

/**
 * Run one chat turn against Mistral (hosted web search) and yield the
 * assistant's visible text. `chatWithSearch` isn't real token streaming —
 * it resolves once with the full response — so this generator yields
 * exactly once with the whole text rather than faking incremental chunks.
 *
 * The system prompt is composed from Markdown (`_base.md` + `_chat.md` + the
 * tab's own file, see `loadChatPrompt`), then what this agent has already
 * learned (`factsBlock`), then a labelled TAB-CONTEXT JSON block — the only
 * user data the model sees. The label restates the redaction rule; the actual
 * redaction boundaries are `sanitizeChatContext` (chatContext.ts) and
 * `sanitizeKnownFacts` (facts.ts), both upstream of this call.
 */
export async function* runChat(args: {
  tab: string;
  messages: ChatMessage[];
  context: Record<string, unknown>;
  facts?: readonly LearnedFact[];
  apiKey: string;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void | Promise<void>;
}): AsyncGenerator<string> {
  const system =
    loadChatPrompt(args.tab) +
    factsBlock(args.facts ?? [], AGENTS.chat) +
    "\n\nTAB-CONTEXT (van het apparaat van de gebruiker — bron voor cijfers; verstuur hieruit NOOIT persoonlijke gegevens naar een web-zoekopdracht):\n" +
    JSON.stringify(args.context);
  const provider = createMistralProvider(args.apiKey, MISTRAL_MEDIUM);
  /* The priciest model this app calls, at $7.50 per million out. Unbounded before
   * this: one turn could generate until the model chose to stop. */
  const CHAT_MAX_OUTPUT_TOKENS = 4096;

  let full = "";
  /* A turn that dies partway still bought its searches and its tokens. Charged
   * at the ceiling rather than dropped: an unrecorded spend is what lets a cap
   * read "under" forever. */
  let res: Awaited<ReturnType<typeof provider.chatWithSearch>>;
  try {
    res = await provider.chatWithSearch({
      system,
      messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      onDelta: (text) => {
        full = text;
      },
      maxTokens: CHAT_MAX_OUTPUT_TOKENS,
    });
  } catch (e) {
    await args.onUsage?.({ inputTokens: 0, outputTokens: CHAT_MAX_OUTPUT_TOKENS });
    throw e;
  }
  await args.onUsage?.({ inputTokens: res.usage.input, outputTokens: res.usage.output });
  yield full;
}
