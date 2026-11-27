import { defineConfig } from "vitest/config";

/**
 * Vitest config used only by the mutation pilot (`stryker run`).
 *
 * Stryker copies just this package into its sandbox, so tests that read files
 * from the repo root (`../../../docs/...`) cannot resolve there and would fail
 * the dry run before any mutant is tested. They do not cover the files in the
 * pilot's mutate list, so they are excluded here instead of widening the
 * sandbox copy to the whole monorepo.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/metrics.test.ts",
      "src/plan/cardAdvice.test.ts",
      "src/plan/cardVerdictAgreement.test.ts",
      "src/n8n/codeNodes.test.ts",
      "src/catalogArtifact.test.ts",
    ],
  },
});
