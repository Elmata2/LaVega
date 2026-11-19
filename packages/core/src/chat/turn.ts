import type { AgentToolDefinition } from "../agentTools.js";
import { scrubIdentifiers } from "../categorize.js";
import { checkAdvice, checkNumbers, dataStringsOf, plainFacts } from "./guards.js";
import { runChatTool } from "./tools.js";

/* The assistant chat's turn loop: one user question, the tool rounds, the guards.
 * It is pure of transport. `step` is injected: in the browser it posts the
 * messages to our stateless proxy route; in a test it is a script; a later
 * WhatsApp path could call the provider directly.
 *
 * Caps per question: 4 rounds (model calls while tools are possible; the last
 * one is answer-only) and 6 tool calls. Guard regenerations are extra,
 * answer-only calls: at most one for a figure check, one for the advice check.
 * Tool results and the user's vault text are DATA: they travel in the `tool`
 * role and never as instructions. */

export const CHAT_MAX_ROUNDS = 4;
export const CHAT_MAX_CALLS = 6;
export const CHAT_MAX_HISTORY = 8;
export const CHAT_MAX_QUESTION_CHARS = 500;
export const CHAT_NO_MORE_TOOLS = "Geen tools meer; antwoord met wat je hebt.";
export const CHAT_NUMBER_CORRECTION_PREFIX = "Gebruik alleen bedragen uit de resultaten.";
const NO_MORE_TOOLS = CHAT_NO_MORE_TOOLS;

const NUMBER_CORRECTION =
  /^Gebruik alleen bedragen uit de resultaten\. Deze komen er niet in voor: .{0,300}\. Schrijf het antwoord opnieuw, zonder zelf te rekenen\.$/s;
export const CHAT_ADVICE_CORRECTION =
  "Geef geen financieel advies en beveel niets aan of ken niets de beste toe. Schrijf het antwoord opnieuw met alleen feiten uit de resultaten.";

/** Is the LAST message one the loop added itself (the nudge, or a correction)? Decided by
 *  position as well as text, because the client controls both: the nudge must follow tool
 *  results and equal the fixed text; a correction must follow a plain assistant answer and
 *  match its fixed shape. A question that merely starts with such text is a question. */
export function isLoopUserMessage(
  messages: readonly { role: string; content?: string; toolCalls?: unknown }[],
): boolean {
  const last = messages[messages.length - 1];
  const before = messages[messages.length - 2];
  if (!last || last.role !== "user" || typeof last.content !== "string" || !before) return false;
  if (before.role === "tool") return last.content === CHAT_NO_MORE_TOOLS;
  if (before.role === "assistant" && !before.toolCalls)
    return NUMBER_CORRECTION.test(last.content) || last.content === CHAT_ADVICE_CORRECTION;
  return false;
}

const VALID_ID = /^[A-Za-z0-9_-]{1,40}$/;

export type ChatToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ChatTurnMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ChatToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ChatStepResult =
  | { type: "tool_calls"; calls: ChatToolCall[] }
  | { type: "answer"; text: string };

/** One model call. `noTools` asks the proxy to withhold the tools for this call. */
export type ChatStep = (request: {
  messages: ChatTurnMessage[];
  noTools: boolean;
}) => Promise<ChatStepResult>;

export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

export type ChatTurnOutcome =
  | { kind: "answer"; text: string }
  /** The figures could not be checked twice: show these plain lines instead. */
  | { kind: "facts"; lines: string[] }
  /** Advice language twice: the fixed refusal. */
  | { kind: "advice-refusal" }
  /** `no-answer`: no usable answer within the caps (bad tool calls come back to the model
   *  with a hint until then). `lookup-failed` is kept for callers that map it. */
  | { kind: "no-answer"; reason: "lookup-failed" | "no-answer" };

export async function runChatTurn(input: {
  question: string;
  history: readonly ChatHistoryMessage[];
  tools: readonly AgentToolDefinition[];
  step: ChatStep;
  /** Called once per round that asks for tools, with the tool names only. */
  onRound?: (toolNames: string[]) => void;
}): Promise<ChatTurnOutcome> {
  const question = scrubIdentifiers(input.question).slice(0, CHAT_MAX_QUESTION_CHARS);
  const earlier = input.history.slice(-CHAT_MAX_HISTORY);
  const messages: ChatTurnMessage[] = [
    ...earlier.map((m): ChatTurnMessage => ({
      role: m.role,
      content: scrubIdentifiers(m.content),
    })),
    { role: "user", content: question },
  ];
  const userTexts = [question, ...earlier.filter((m) => m.role === "user").map((m) => m.content)];
  const earlierAnswers = earlier.filter((m) => m.role === "assistant").map((m) => m.content);
  const results: string[] = [];

  let rounds = 0;
  let calls = 0;
  let nudged = false;
  let numberRegens = 0;
  let adviceRegens = 0;
  let toolsClosed = false;
  const usedIds = new Set<string>();

  const nudge = () => {
    if (nudged) return;
    nudged = true;
    messages.push({ role: "user", content: NO_MORE_TOOLS });
  };

  for (;;) {
    const regenerating = numberRegens + adviceRegens > 0 && rounds > 0 && toolsClosed;
    if (!regenerating) rounds += 1;
    const lastRound = rounds >= CHAT_MAX_ROUNDS;
    const noTools = toolsClosed || lastRound;
    if (noTools && !regenerating) nudge();

    const out = await input.step({ messages, noTools });

    if (out.type === "tool_calls") {
      if (noTools || out.calls.length === 0) return { kind: "no-answer", reason: "no-answer" };
      /* Ids must be unique across the whole question or the server refuses the body. */
      const fresh = out.calls.map((c): ChatToolCall => {
        let id = VALID_ID.test(c.id) ? c.id : `call${usedIds.size + 1}`;
        for (let n = 2; usedIds.has(id); n += 1)
          id = `${c.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30) || "call"}-${n}`;
        usedIds.add(id);
        return { ...c, id };
      });
      input.onRound?.(fresh.map((c) => c.name));
      messages.push({ role: "assistant", content: "", toolCalls: fresh });
      for (const c of fresh) {
        if (calls >= CHAT_MAX_CALLS) {
          const error = {
            error: "tool_limit",
            hint: "No tool calls left. Answer with what you have.",
          };
          messages.push({
            role: "tool",
            toolCallId: c.id,
            name: c.name,
            content: JSON.stringify(error),
          });
          toolsClosed = true;
          continue;
        }
        calls += 1;
        const run = await runChatTool(input.tools, c.name, c.args);
        if (run.ok) results.push(run.content);
        messages.push({ role: "tool", toolCallId: c.id, name: c.name, content: run.content });
      }
      if (calls >= CHAT_MAX_CALLS) toolsClosed = true;
      continue;
    }

    const text = out.text.trim();
    if (text === "") return { kind: "no-answer", reason: "no-answer" };

    const numbers = checkNumbers(text, { results, user: userTexts, earlier: earlierAnswers });
    if (!numbers.ok) {
      if (numberRegens > 0) return { kind: "facts", lines: plainFacts(results) };
      numberRegens += 1;
      toolsClosed = true;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `${CHAT_NUMBER_CORRECTION_PREFIX} Deze komen er niet in voor: ${numbers.offending.join(", ")}. Schrijf het antwoord opnieuw, zonder zelf te rekenen.`,
      });
      continue;
    }

    if (checkAdvice(text, dataStringsOf(results)).length > 0) {
      if (adviceRegens > 0) return { kind: "advice-refusal" };
      adviceRegens += 1;
      toolsClosed = true;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: CHAT_ADVICE_CORRECTION,
      });
      continue;
    }

    return { kind: "answer", text };
  }
}
