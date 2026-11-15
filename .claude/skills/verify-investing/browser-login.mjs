#!/usr/bin/env node

/* Kept for old instructions: `browser open` in control-investing.mjs now owns
 * the session bridge. This file keeps its old default of prod when no target is
 * named.
 *
 *   node browser-login.mjs                     prod
 *   node browser-login.mjs --base <preview>    a Vercel preview deploy
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const named = args.some((arg) => /^--(target|base)(=|$)/.test(arg));
const result = spawnSync(
  process.execPath,
  [
    join(dirname(fileURLToPath(import.meta.url)), "control-investing.mjs"),
    "browser",
    "open",
    ...(named ? [] : ["--target", "prod"]),
    ...args,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
