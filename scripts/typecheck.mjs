#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const forceTsc = process.env.LAVEGA_TYPECHECK === "tsc";

function hasBun() {
  if (forceTsc) return false;
  const probe = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return probe.status === 0;
}

const extra = process.argv.slice(2);
const [cmd, args] = hasBun()
  ? ["bun", ["check", "--no-script", ...extra]]
  : ["tsc", ["--noEmit", ...extra]];
const result = spawnSync(cmd, args, { stdio: "inherit" });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
