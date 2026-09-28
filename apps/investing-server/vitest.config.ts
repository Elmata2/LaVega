import { defineConfig } from "vitest/config";

export default defineConfig({
  // Zie src/testSetup.ts: zonder dit delen alle tests één `.lavega` in de
  // werkmap, en ruimt de een op wat de ander aan het schrijven is.
  test: {
    setupFiles: ["./src/testSetup.ts"],
    // Default is 5s. A busy runner kills tests that finish in 1–3s when quiet
    // (Actions run 36433231948 vs 36436665892): 210k PBKDF2 plus broker sync,
    // while turbo tests every package at once. 30s still fails a hang inside
    // the 15 minute job cap.
    testTimeout: 30_000,
  },
});
