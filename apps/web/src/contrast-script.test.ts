import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("the contrast script exits 0 and prints all three themes", () => {
  const script = resolve(__dirname, "../scripts/check-midnight-contrast.mjs");
  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
  expect(run.stdout + run.stderr).not.toMatch(/FAIL/);
  expect(run.status).toBe(0);
  for (const theme of ["dark ", "light", "mono "]) expect(run.stdout).toContain(`ok   ${theme}`);
});
