#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const forceTsc = process.env.LAVEGA_TYPECHECK === "tsc";

function hasBunCheck() {
  if (forceTsc) return false;
  const probe = spawnSync("bun", ["check", "--no-script", "--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return probe.status === 0 && probe.stdout.includes("Type check");
}

const extra = process.argv.slice(2);
const [cmd, args] = hasBunCheck()
  ? ["bun", ["check", "--no-script", ...extra]]
  : ["tsc", ["--noEmit", ...extra]];
const result = spawnSync(cmd, args, { stdio: "inherit" });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
