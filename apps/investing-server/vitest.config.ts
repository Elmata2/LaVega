import { defineConfig } from "vitest/config";

export default defineConfig({
  // Zie src/testSetup.ts: zonder dit delen alle tests één `.lavega` in de
  // werkmap, en ruimt de een op wat de ander aan het schrijven is.
  test: { setupFiles: ["./src/testSetup.ts"] },
});
