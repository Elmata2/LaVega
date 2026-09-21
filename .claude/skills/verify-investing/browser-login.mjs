#!/usr/bin/env node

/* Bridge the CLI session into isolated gstack Chromium. Never prints cookie values. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const stateRoot = "/tmp/lavega-verify-investing";
const cookieFile = `${stateRoot}/run/cookies.txt`;
const browserCookieFile = `${stateRoot}/run/browser-cookies.json`;
const browse = process.env.LAVEGA_BROWSE_BIN || `${process.env.HOME}/.codex/skills/gstack/browse/dist/browse`;
const base = process.env.LAVEGA_VERIFY_BASE || "https://www.lavega.dev";

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(args) {
  const result = spawnSync(browse, args, { stdio: "inherit" });
  if (result.error) fail(`${browse}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(cookieFile))
  fail(`no CLI session; run control-investing.mjs login --target prod first`);
if (!existsSync(browse)) fail(`browse unavailable at ${browse}`);

mkdirSync(`${stateRoot}/run`, { recursive: true });
const cookies = readFileSync(cookieFile, "utf8")
  .split(/;\s*/)
  .filter(Boolean)
  .map((pair) => {
    const separator = pair.indexOf("=");
    if (separator < 1) return null;
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      domain: "lavega.dev",
      path: "/",
      secure: true,
    };
  })
  .filter(Boolean);
if (cookies.length === 0) fail("CLI session cookie jar is empty");
writeFileSync(browserCookieFile, JSON.stringify(cookies), { mode: 0o600 });
try {
  run(["goto", `${base}/investing?verify=1`]);
  run(["cookie-import", browserCookieFile]);
  run(["reload"]);
  run(["wait", "--load"]);
} finally {
  rmSync(browserCookieFile, { force: true });
}
