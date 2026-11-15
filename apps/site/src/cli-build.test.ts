import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function run(extra: string[]) {
  const root = mkdtempSync(join(tmpdir(), "site-cli-"));
  dirs.push(root);
  const content = join(root, "content");
  const out = join(root, "out");
  mkdirSync(content, { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "app.js"), "web app");
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "src/cli-build.ts", "--content", content, "--out", out, ...extra],
    { cwd: join(__dirname, ".."), encoding: "utf8" },
  );
  return { r, kept: existsSync(join(out, "app.js")) };
}

describe("cli-build --no-clean", () => {
  it("keeps files already in the output dir", () => {
    const { r, kept } = run(["--no-clean"]);
    expect(r.status, r.stderr).toBe(0);
    expect(kept).toBe(true);
  }, 60_000);

  it("cleans the output dir by default", () => {
    const { r, kept } = run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(kept).toBe(false);
  }, 60_000);
});
