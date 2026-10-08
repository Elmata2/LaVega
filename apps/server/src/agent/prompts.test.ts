import { expect, test } from "vitest";
import { composePrompt, loadAgentPrompt } from "./prompts.js";

test("the agent files really are on disk — a typo must not silently yield base-only", () => {
  const base = composePrompt("_base.md");
  for (const agent of ["categorize", "facturen-extract", "travel"]) {
    expect(loadAgentPrompt(agent)).not.toBe(base);
  }
  // A missing or malformed name falls back to the shared charter rather than throwing.
  expect(loadAgentPrompt("bestaat-niet")).toBe(base);
  expect(loadAgentPrompt("../../etc/passwd")).toBe(base);
});

test("composePrompt skips missing files and caches per file set", () => {
  expect(composePrompt("_base.md", "", "bestaat-niet.md")).toBe(composePrompt("_base.md"));
  expect(composePrompt("_base.md", "travel.md")).toBe(loadAgentPrompt("travel"));
});

/* THE PRODUCTION FAILURE THESE FILES SHIPPED WITH, found 17 Sep 2026.
 *
 * The Markdown is read at runtime from a directory derived from
 * import.meta.url. The Vercel build bundles the whole server into a single
 * .mjs, so that path resolved to the function directory — and nothing copied
 * the Markdown there. Every readFileSync threw, `read()` returned "", and EVERY
 * agent ran in production with no system prompt at all while still answering
 * plausibly. The first visible symptom was an invoice draft with every field
 * blank, weeks after the feature was called shipped.
 *
 * The tests above pass from source, which is precisely why none of them caught
 * it. The real guard is the assertion in scripts/vercel-build.mjs; what this
 * pins is the other half — that a composition resolving to nothing is now a
 * thrown error rather than a silent empty string that reaches a model. */
test("a composition that resolves to nothing throws instead of returning an empty prompt", () => {
  expect(() => composePrompt("bestaat-niet.md")).toThrow(/agent prompt missing/);
  expect(() => composePrompt("")).toThrow(/agent prompt missing/);
});
