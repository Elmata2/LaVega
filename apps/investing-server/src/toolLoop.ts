/*
 * Tool-loop hardening for the investing chat (plan §3 WS5.6, #299).
 *
 * Sure source: `app/models/assistant/responder.rb` and
 * `app/models/assistant/history_trimmer.rb` at pinned commit 562fe09. Sure caps
 * the loop, forces a text answer on the last round, trims history in whole
 * call/result pairs and marks a turn that ends partway as failed. This module is
 * the pure policy those rules need; `portfolioChat.ts` applies it to the AI SDK
 * agent and `index.ts` persists the turn status.
 *
 * No clock, no I/O: every function is a pure decision so the tests can prove the
 * round-8 rule and the pair-safe trim without a model.
 */

/** Hard cap on model rounds in one turn. Round 8 is the last one. */
export const TOOL_LOOP_MAX_ROUNDS = 8;

/** The round that must answer in text and call no tool (1-based, matching the
 *  model's own numbering). */
export const TOOL_LOOP_FORCED_TEXT_ROUND = TOOL_LOOP_MAX_ROUNDS;

export type ToolLoopStepPolicy = {
  /** `none` forces the model to answer in text; `auto` leaves the choice. */
  toolChoice: "none" | "auto";
  /** Active tool names for this step; empty means no tool is offered. */
  activeTools: readonly string[] | null;
  /** Extra instruction appended for the forced round. */
  instruction: string | null;
};

const FORCED_TEXT_INSTRUCTION =
  "This is the last round of the turn. Answer the owner in text now with what you already know; do not call a tool.";

/**
 * Per-step policy. `stepNumber` is the AI SDK's zero-based step index, so the
 * eighth round is `stepNumber === TOOL_LOOP_MAX_ROUNDS - 1`.
 *
 * On the forced round the tool set is empty AND `toolChoice` is `none`: an empty
 * `activeTools` alone would let a provider still emit a call against a tool it
 * cached, and `toolChoice: none` alone would leave the schemas in the request.
 */
export function toolLoopStepPolicy(stepNumber: number): ToolLoopStepPolicy {
  if (stepNumber >= TOOL_LOOP_MAX_ROUNDS - 1)
    return { toolChoice: "none", activeTools: [], instruction: FORCED_TEXT_INSTRUCTION };
  return { toolChoice: "auto", activeTools: null, instruction: null };
}

/** The fewest leading messages a turn must keep: the latest user message. */
export const TOOL_HISTORY_MIN_MESSAGES = 2;

export type LoopMessage = { readonly role: string };

/**
 * Pair-safe history trim: keep at most `maxMessages` from the END of the
 * conversation, then move the cut forward until the first kept message does not
 * depend on a dropped tool call.
 *
 * A tool result is only meaningful next to the assistant message that requested
 * it; slicing between them hands the model an orphaned result (or an assistant
 * message with a tool call whose result was dropped). Sure's trimmer never
 * splits that pair, and neither does this.
 */
export function trimToolHistory<M extends LoopMessage>(
  messages: readonly M[],
  maxMessages: number,
): M[] {
  const limit = Math.max(TOOL_HISTORY_MIN_MESSAGES, Math.floor(maxMessages));
  if (messages.length <= limit) return [...messages];
  let start = messages.length - limit;
  /* Never start on a tool result: its assistant call was cut. A result is
   * either role "tool" or a user/assistant message that carries tool parts. */
  while (start < messages.length && isToolResult(messages[start]!)) start += 1;
  /* Never start with an assistant message that has no user question before it
   * in the kept window: the turn would read as the model answering itself. */
  while (start < messages.length && messages[start]!.role !== "user") start += 1;
  const trimmed = messages.slice(start);
  return trimmed.length > 0 ? trimmed : messages.slice(-1);
}

function isToolResult(message: LoopMessage): boolean {
  if (message.role === "tool") return true;
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return false;
  return parts.some(
    (part) =>
      !!part &&
      typeof part === "object" &&
      typeof (part as { type?: unknown }).type === "string" &&
      ((part as { type: string }).type.startsWith("tool-") ||
        (part as { type: string }).type === "dynamic-tool"),
  );
}

export type ToolLoopTurnStatus =
  | { status: "completed"; rounds: number }
  | {
      status: "failed";
      rounds: number;
      reason: "round-cap-without-text" | "error" | "aborted";
    };

/**
 * Classify a finished turn. A turn that ran out of rounds without producing
 * text, threw, or was aborted is FAILED and must be persisted as such — a
 * half-finished answer that looks completed is worse than an honest failure
 * (WS5.6).
 */
export function toolLoopTurnStatus(input: {
  rounds: number;
  hasText: boolean;
  error?: boolean;
  aborted?: boolean;
}): ToolLoopTurnStatus {
  const rounds = Math.max(0, input.rounds);
  if (input.aborted) return { status: "failed", rounds, reason: "aborted" };
  if (input.error) return { status: "failed", rounds, reason: "error" };
  if (!input.hasText) return { status: "failed", rounds, reason: "round-cap-without-text" };
  return { status: "completed", rounds };
}
