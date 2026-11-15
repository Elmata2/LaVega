import { expect, test } from "vitest";
import {
  TOOL_LOOP_FORCED_TEXT_ROUND,
  TOOL_LOOP_MAX_ROUNDS,
  toolLoopStepPolicy,
  toolLoopTurnStatus,
  trimToolHistory,
} from "./toolLoop.js";

/* WS5.6 acceptance (#299): forced text on round 8; pair-safe history trim; a
 * partial turn is failed, never presented as a completed answer. */

test("the loop caps at 8 rounds and the 8th is forced text", () => {
  expect(TOOL_LOOP_MAX_ROUNDS).toBe(8);
  expect(TOOL_LOOP_FORCED_TEXT_ROUND).toBe(8);
  for (let step = 0; step < TOOL_LOOP_MAX_ROUNDS - 1; step += 1) {
    expect(toolLoopStepPolicy(step)).toEqual({
      toolChoice: "auto",
      activeTools: null,
      instruction: null,
    });
  }
  const forced = toolLoopStepPolicy(TOOL_LOOP_MAX_ROUNDS - 1);
  expect(forced.toolChoice).toBe("none");
  expect(forced.activeTools).toEqual([]);
  expect(forced.instruction).toMatch(/last round/i);
});

test("history is trimmed in whole call/result pairs", () => {
  const messages = [
    { role: "user", parts: [{ type: "text", text: "q1" }] },
    { role: "assistant", parts: [{ type: "tool-call", toolName: "get_positions" }] },
    { role: "tool", parts: [{ type: "tool-result", toolName: "get_positions" }] },
    { role: "assistant", parts: [{ type: "text", text: "a1" }] },
    { role: "user", parts: [{ type: "text", text: "q2" }] },
  ];
  const trimmed = trimToolHistory(messages, 3);
  // Slicing the last three would start on the assistant tool call whose result
  // was dropped; the trim moves forward to the user message instead.
  expect(trimmed.map((message) => message.role)).toEqual(["user"]);
  expect((trimmed[0]?.parts?.[0] as { text?: string } | undefined)?.text).toBe("q2");
});

test("history shorter than the limit is returned unchanged", () => {
  const messages = [{ role: "user" }, { role: "assistant" }];
  expect(trimToolHistory(messages, 12)).toEqual(messages);
});

test("a partial turn is failed, never completed", () => {
  expect(toolLoopTurnStatus({ rounds: 8, hasText: false })).toEqual({
    status: "failed",
    rounds: 8,
    reason: "round-cap-without-text",
  });
  expect(toolLoopTurnStatus({ rounds: 3, hasText: false, error: true })).toEqual({
    status: "failed",
    rounds: 3,
    reason: "error",
  });
  expect(toolLoopTurnStatus({ rounds: 2, hasText: false, aborted: true })).toEqual({
    status: "failed",
    rounds: 2,
    reason: "aborted",
  });
  expect(toolLoopTurnStatus({ rounds: 2, hasText: true })).toEqual({
    status: "completed",
    rounds: 2,
  });
});
