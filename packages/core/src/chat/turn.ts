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
/** Maximum total model invocations per turn: 4 tool rounds + 1 number regen + 1 advice regen. */
export const CHAT_MAX_STEPS = CHAT_MAX_ROUNDS + 2;
export const CHAT_MAX_HISTORY = 8;
export const CHAT_MAX_QUESTION_CHARS = 500;
export const CHAT_NO_MORE_TOOLS = "Geen tools meer; antwoord met wat je hebt.";
export const CHAT_NUMBER_CORRECTION_PREFIX = "Gebruik alleen bedragen uit de resultaten.";
const NO_MORE_TOOLS = CHAT_NO_MORE_TOOLS;

const NUMBER_CORRECTION =
  /^Gebruik alleen bedragen uit de resultaten\. Deze komen er niet in voor: .{0,300}\. Schrijf het antwoord opnieuw, zonder zelf te rekenen\.$/s;
export const CHAT_ADVICE_CORRECTION =
  "Geef geen financieel advies en beveel niets aan of ken niets de beste toe. Schrijf het antwoord opnieuw met alleen feiten uit de resultaten.";

export type LoopUserMessageKind = "nudge" | "number-correction" | "advice-correction";

type MessageLike = { role: string; content?: string; toolCalls?: unknown };

function matchSyntheticKind(
  msg: MessageLike,
  prev: MessageLike | undefined,
): LoopUserMessageKind | null {
  if (msg.role !== "user" || typeof msg.content !== "string" || !prev) return null;
  if (prev.role === "tool" && msg.content === CHAT_NO_MORE_TOOLS) return "nudge";
  if (prev.role === "assistant" && !prev.toolCalls) {
    if (NUMBER_CORRECTION.test(msg.content)) return "number-correction";
    if (msg.content === CHAT_ADVICE_CORRECTION) return "advice-correction";
  }
  return null;
}

/** Classify whether the LAST message is one of the loop's own synthetic user messages.
 *  Replays the turn's message sequence from the last genuine user question so a caller
 *  cannot repeat synthetic corrections indefinitely to bypass the question rate limit:
 *  each turn allows at most one nudge, one number correction, and one advice correction. */
export function classifyLoopUserMessage(
  messages: readonly MessageLike[],
): LoopUserMessageKind | null {
  if (messages.length < 2) return null;
  let seenNudge = false;
  let seenNumber = false;
  let seenAdvice = false;
  let lastKind: LoopUserMessageKind | null = null;

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    if (msg.role !== "user") {
      lastKind = null;
      continue;
    }
    const kind = matchSyntheticKind(msg, messages[i - 1]);
    if (kind === "nudge" && !seenNudge) {
      seenNudge = true;
      lastKind = kind;
    } else if (kind === "number-correction" && !seenNumber) {
      seenNumber = true;
      lastKind = kind;
    } else if (kind === "advice-correction" && !seenAdvice) {
      seenAdvice = true;
      lastKind = kind;
    } else {
      // Genuine user question (or repeated synthetic text beyond its once-per-turn budget).
      seenNudge = false;
      seenNumber = false;
      seenAdvice = false;
      lastKind = null;
    }
  }
  return lastKind;
}

export function isLoopUserMessage(messages: readonly MessageLike[]): boolean {
  return classifyLoopUserMessage(messages) !== null;
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

/** Explicit state machine for a chat turn. Replaces coupled mutable loop flags
 *  with a bounded transition graph (at most CHAT_MAX_ROUNDS + 2 steps). */
export type ChatTurnPhase =
  | {
      readonly kind: "tool_round";
      readonly round: number;
      readonly calls: number;
      readonly toolsClosed: boolean;
      readonly nudged: boolean;
      readonly numberRegenUsed: boolean;
      readonly adviceRegenUsed: boolean;
    }
  | {
      readonly kind: "guard_regen";
      readonly guard: "numbers" | "advice";
      readonly round: number;
      readonly calls: number;
      readonly numberRegenUsed: boolean;
      readonly adviceRegenUsed: boolean;
    }
  | { readonly kind: "done"; readonly outcome: ChatTurnOutcome };

const INITIAL_PHASE: Extract<ChatTurnPhase, { kind: "tool_round" }> = {
  kind: "tool_round",
  round: 0,
  calls: 0,
  toolsClosed: false,
  nudged: false,
  numberRegenUsed: false,
  adviceRegenUsed: false,
};

type ActivePhase = Exclude<ChatTurnPhase, { kind: "done" }>;

function prepareStep(phase: ActivePhase): {
  noTools: boolean;
  shouldNudge: boolean;
  nextPhase: ActivePhase;
} {
  if (phase.kind === "guard_regen") {
    return { noTools: true, shouldNudge: false, nextPhase: phase };
  }
  const round = phase.round + 1;
  const noTools = phase.toolsClosed || round >= CHAT_MAX_ROUNDS;
  const shouldNudge = noTools && !phase.nudged;
  return {
    noTools,
    shouldNudge,
    nextPhase: { ...phase, round, nudged: phase.nudged || shouldNudge },
  };
}

function transitionAnswer(
  phase: ActivePhase,
  text: string,
  checks: {
    numbers: { ok: true } | { ok: false; offending: string[] };
    hasAdvice: boolean;
    results: readonly string[];
  },
): { phase: ChatTurnPhase; appendMessages?: ChatTurnMessage[] } {
  if (text === "") {
    return { phase: { kind: "done", outcome: { kind: "no-answer", reason: "no-answer" } } };
  }
  if (!checks.numbers.ok) {
    if (phase.numberRegenUsed) {
      return { phase: { kind: "done", outcome: { kind: "facts", lines: plainFacts(checks.results) } } };
    }
    return {
      phase: {
        kind: "guard_regen",
        guard: "numbers",
        round: phase.round,
        calls: phase.calls,
        numberRegenUsed: true,
        adviceRegenUsed: phase.adviceRegenUsed,
      },
      appendMessages: [
        { role: "assistant", content: text },
        {
          role: "user",
          content: `${CHAT_NUMBER_CORRECTION_PREFIX} Deze komen er niet in voor: ${checks.numbers.offending.join(", ")}. Schrijf het antwoord opnieuw, zonder zelf te rekenen.`,
        },
      ],
    };
  }
  if (checks.hasAdvice) {
    if (phase.adviceRegenUsed) {
      return { phase: { kind: "done", outcome: { kind: "advice-refusal" } } };
    }
    return {
      phase: {
        kind: "guard_regen",
        guard: "advice",
        round: phase.round,
        calls: phase.calls,
        numberRegenUsed: phase.numberRegenUsed,
        adviceRegenUsed: true,
      },
      appendMessages: [
        { role: "assistant", content: text },
        { role: "user", content: CHAT_ADVICE_CORRECTION },
      ],
    };
  }
  return { phase: { kind: "done", outcome: { kind: "answer", text } } };
}

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
  const usedIds = new Set<string>();

  let phase: ChatTurnPhase = INITIAL_PHASE;

  for (let steps = 0; steps < CHAT_MAX_STEPS && phase.kind !== "done"; steps += 1) {
    const prepared = prepareStep(phase);
    phase = prepared.nextPhase;
    if (prepared.shouldNudge) {
      messages.push({ role: "user", content: NO_MORE_TOOLS });
    }

    const out = await input.step({ messages, noTools: prepared.noTools });

    if (out.type === "tool_calls") {
      if (prepared.noTools || out.calls.length === 0) {
        return { kind: "no-answer", reason: "no-answer" };
      }
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

      let calls = phase.calls;
      let toolsClosed = phase.kind === "tool_round" ? phase.toolsClosed : true;
      for (const c of fresh) {
        if (calls >= CHAT_MAX_CALLS) {
          messages.push({
            role: "tool",
            toolCallId: c.id,
            name: c.name,
            content: JSON.stringify({
              error: "tool_limit",
              hint: "No tool calls left. Answer with what you have.",
            }),
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
      phase = {
        kind: "tool_round",
        round: phase.round,
        calls,
        toolsClosed,
        nudged: phase.kind === "tool_round" ? phase.nudged : true,
        numberRegenUsed: phase.numberRegenUsed,
        adviceRegenUsed: phase.adviceRegenUsed,
      };
      continue;
    }

    const text = out.text.trim();
    const numbers = checkNumbers(text, { results, user: userTexts, earlier: earlierAnswers });
    const hasAdvice = numbers.ok && checkAdvice(text, dataStringsOf(results)).length > 0;
    const transition = transitionAnswer(phase, text, { numbers, hasAdvice, results });
    if (transition.appendMessages) messages.push(...transition.appendMessages);
    phase = transition.phase;
  }

  return phase.kind === "done" ? phase.outcome : { kind: "no-answer", reason: "no-answer" };
}
