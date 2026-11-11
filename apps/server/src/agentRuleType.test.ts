import type { AgentMirror as CoreAgentMirror, Rule } from "@lavega/core";
import type { AgentMirror, AgentRule } from "@lavega/database";
import { expectTypeOf, test } from "vitest";

/* @lavega/database cannot import @lavega/core, so AgentRule repeats Rule. This
 * is where both are importable: if one drifts, tsc fails here. */
test("AgentRule stays identical to core's Rule", () => {
  expectTypeOf<AgentRule>().toEqualTypeOf<Rule>();
});

test("AgentMirror stays identical to core's AgentMirror", () => {
  expectTypeOf<AgentMirror>().toEqualTypeOf<CoreAgentMirror>();
});
