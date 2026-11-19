import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { ChatStep, ChatStepResult } from "@lavega/core";
import { EVAL_CASES, runEvalCase } from "./assistantEval.js";

/* CI half of the Assistent chat evaluation: the model's step results recorded from
 * a real run (scripts/assistant-chat-eval.ts --record) are replayed through the
 * real turn loop, tools and guards, and each case's expectations are checked. A
 * change to a tool, a guard, the fixture vault or a check that breaks an answer
 * fails here without the network. It does NOT test the model: re-record to do that. */

type Recording = {
  model: string;
  recordedAt: string;
  cases: Record<string, { steps: ChatStepResult[]; failures: string[] }>;
};
const recording = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "assistantEval.recorded.json"),
    "utf8",
  ),
) as Recording;

const replay = (steps: ChatStepResult[]): ChatStep => {
  const queue = [...steps];
  return async () => {
    const next = queue.shift();
    if (!next)
      throw new Error(
        "the recording ran out: the turn loop asked for more steps than the model gave",
      );
    return next;
  };
};

test("every case has a recording", () => {
  expect(
    Object.keys(recording.cases)
      .map(Number)
      .sort((a, b) => a - b),
  ).toEqual(EVAL_CASES.map((c) => c.id));
});

for (const c of EVAL_CASES) {
  test(`case ${c.id} (${c.label}): replaying the recording gives the live verdict`, async () => {
    const steps = recording.cases[String(c.id)]!.steps;
    const run = await runEvalCase(c, replay(steps));
    /* Cases the live model failed stay recorded as failures: the replay must reproduce that
     * verdict exactly, so neither a regression nor a silently changed check hides. */
    expect(c.check(run), `${c.question}\n> ${run.text}`).toEqual(
      recording.cases[String(c.id)]!.failures,
    );
  });
}

test("the harness fails an invented figure instead of passing it", async () => {
  const c = EVAL_CASES[0]!;
  const steps = structuredClone(recording.cases[String(c.id)]!.steps);
  const last = steps[steps.length - 1]!;
  if (last.type !== "answer") throw new Error("expected the last recorded step to be the answer");
  last.text = "Je gaf gisteren € 99,99 uit.";
  const run = await runEvalCase(
    c,
    replay([...steps, { type: "answer", text: "Je gaf gisteren € 98,98 uit." }]),
  );
  expect(run.outcome.kind).not.toBe("answer");
  expect(c.check(run).length).toBeGreaterThan(0);
});
