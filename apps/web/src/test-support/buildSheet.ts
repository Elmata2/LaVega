import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* A fresh worktree has no dist/, and these suites read the BUILT stylesheet
 * because that is the only place Tailwind's utility rules exist (see
 * resolveStyle.ts). Without it the resolver falls back to the hand-written
 * source CSS and eight layout assertions fail on classes that only the build
 * generates.
 *
 * `pnpm test` at the root hides that: turbo gives `@lavega/web#test` its own
 * build first (turbo.json). Running the package directly does not, and that is
 * exactly what a fresh worktree or a single-package run does. So build once
 * here, only when the sheet is missing. On CI and in an installed tree turbo
 * has already built it, this returns immediately. */

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const assets = fileURLToPath(new URL("../../dist/assets/", import.meta.url));

function sheetPresent(): boolean {
  return existsSync(assets) && readdirSync(assets).some((file) => file.endsWith(".css"));
}

export default function setup(): void {
  if (process.env.LAVEGA_SKIP_WEB_BUILD === "1") return;
  if (sheetPresent()) return;
  console.log("web tests: no built stylesheet, building apps/web once (resolveStyle reads dist)");
  execFileSync("pnpm", ["exec", "vite", "build"], { cwd: appRoot, stdio: "inherit" });
  if (!sheetPresent()) throw new Error("web tests: vite build produced no CSS in dist/assets");
}
