#!/usr/bin/env node

/* Bridge the CLI session into isolated gstack Chromium. Never prints cookie values.
 *
 *   node browser-login.mjs                     prod
 *   node browser-login.mjs --base <preview>    a Vercel preview deploy
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const stateRoot = process.env.VERIFY_INVESTING_DIR || "/tmp/lavega-verify-investing";
const browserCookieFile = `${stateRoot}/run/browser-cookies.json`;
const browse =
  process.env.LAVEGA_BROWSE_BIN || `${process.env.HOME}/.codex/skills/gstack/browse/dist/browse`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function flagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/* Same resolution as control-investing.mjs, so the browser opens the origin
 * the CLI logged in to. */
const target = flagValue("target") || (flagValue("base") ? "preview" : "prod");
const base = (
  flagValue("base") ||
  (target === "preview" ? process.env.LAVEGA_PREVIEW_URL : undefined) ||
  process.env.LAVEGA_VERIFY_BASE ||
  "https://www.lavega.dev"
).replace(/\/+$/, "");
const host = new URL(base).host;
// Must match cookieFileFor() in control-investing.mjs.
const cookieFile = `${stateRoot}/run/cookies-${host.replace(/[^a-z0-9.-]/gi, "_")}.txt`;

function run(args) {
  const result = spawnSync(browse, args, { stdio: "inherit" });
  if (result.error) fail(`${browse}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(cookieFile))
  fail(`no CLI session for ${host}; run control-investing.mjs login --base ${base} first`);
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
      domain: host,
      path: "/",
      secure: base.startsWith("https:"),
    };
  })
  .filter(Boolean);
if (cookies.length === 0) fail("CLI session cookie jar is empty");

/* Vercel sets its own bypass cookie when the first request carries the secret,
 * so every later navigation in the browser passes Deployment Protection. */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const bypassQuery =
  bypass && target === "preview"
    ? `&x-vercel-protection-bypass=${encodeURIComponent(bypass)}&x-vercel-set-bypass-cookie=true`
    : "";

writeFileSync(browserCookieFile, JSON.stringify(cookies), { mode: 0o600 });
try {
  run(["goto", `${base}/investing?verify=1${bypassQuery}`]);
  run(["cookie-import", browserCookieFile]);
  run(["reload"]);
  run(["wait", "--load"]);
} finally {
  rmSync(browserCookieFile, { force: true });
}
