import type { AgentMirror as CoreAgentMirror, LegacyRule } from "@lavega/core";
import type { AgentMirror, AgentRule } from "@lavega/database";
import { expectTypeOf, test } from "vitest";

/* @lavega/database cannot import @lavega/core, so AgentRule repeats LegacyRule (the only rule shape the mirror carries). This
 * is where both are importable: if one drifts, tsc fails here. */
test("AgentRule stays identical to core's LegacyRule", () => {
  expectTypeOf<AgentRule>().toEqualTypeOf<LegacyRule>();
});

test("AgentMirror stays identical to core's AgentMirror", () => {
  expectTypeOf<AgentMirror>().toEqualTypeOf<CoreAgentMirror>();
});
