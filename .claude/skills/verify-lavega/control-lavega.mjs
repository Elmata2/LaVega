#!/usr/bin/env node
/**
 * control-lavega — drive the LaVega personal-finance app (apps/server + apps/web)
 * for verification.
 *
 * Two targets, one API surface:
 *   local  @lavega/server started by `up` on its own port, serving the built SPA
 *          from apps/web/dist, guard OPEN (LAVEGA_ALLOW_UNAUTHENTICATED=1), no
 *          DATABASE_URL, no .env — nothing it does can reach Neon or spend a key.
 *   prod   https://www.lavega.dev — same routes behind the better-auth session
 *          guard. Read-only here; write commands refuse --target prod.
 *
 * The personal app is local-first: the vault lives in the browser (IndexedDB),
 * so the server side you can prove from here is the guard, the public feeds,
 * the agent/EB configuration status and the SPA shell. Drive the vault, import
 * and forecast UI with a browser (see SKILL.md → Drive).
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(skillDir, "../../..");
const serverDir = join(repoRoot, "apps/server");
const webDist = join(repoRoot, "apps/web/dist");

const stateRoot = process.env.VERIFY_LAVEGA_DIR || "/tmp/lavega-verify";
const runDir = join(stateRoot, "run"); // torn down by `down` / `cleanup`
const evidenceDir = join(stateRoot, "evidence"); // survives teardown
const pidFile = join(runDir, "local.pid");
const portFile = join(runDir, "local.port");
const logFile = join(runDir, "local.log");

const PROD_BASE = "https://www.lavega.dev";
const DEFAULT_LOCAL_PORT = 8797;

/** Read-only endpoints. `probe` sweeps all of them; none change state. */
const PROBE_ENDPOINTS = [
  "/health",
  "/api/agent/status",
  "/api/eb/status",
  "/api/rates",
  "/api/fx/rate",
  "/api/vault/backup",
  "/app",
  "/privacy",
  "/terms",
];

/* Routes that must answer 401 without a session (the guard is closed by
 * default). Public ones are listed in apps/server/src/apiGuard.ts. */
const GUARDED = [
  ["GET", "/api/vault/backup"],
  ["GET", "/api/eb/accounts"],
  ["GET", "/api/eb/aspsps"],
  ["DELETE", "/api/account/data"],
  ["POST", "/api/agent/chat"],
  ["POST", "/api/agent/categorize"],
  ["POST", "/api/agent/extract-invoice"],
  ["GET", "/api/investing/dashboard"],
];
const PUBLIC = [
  ["GET", "/api/agent/status"],
  ["GET", "/api/eb/status"],
  ["GET", "/api/rates"],
  ["GET", "/api/fx/rate"],
];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function baseUrl(args) {
  if (args.base) return String(args.base).replace(/\/$/, "");
  if (args.target === "prod") return PROD_BASE;
  const port = existsSync(portFile) ? readFileSync(portFile, "utf8").trim() : String(DEFAULT_LOCAL_PORT);
  return `http://127.0.0.1:${port}`;
}

function isProd(args) {
  return args.target === "prod" || (args.base && !/127\.0\.0\.1|localhost/.test(args.base));
}

function refuseWriteOnProd(args, what) {
  if (isProd(args)) {
    console.error(`${what}: refused on a remote target. Verify writes locally, read production.`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- http

async function req(base, method, path, body, headers = {}) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const t0 = Date.now();
  try {
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, ms: Date.now() - t0, text, json, headers: Object.fromEntries(res.headers) };
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, text: String(err), json: null, headers: {} };
  }
}

function excerpt(r) {
  return r.json ? JSON.stringify(r.json).slice(0, 160) : r.text.replace(/\s+/g, " ").slice(0, 120);
}

async function waitFor(base, path, ok, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await req(base, "GET", path);
    if (ok(r)) return r;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// ---------------------------------------------------------------- commands

async function up(args) {
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8"));
    if (pid && alive(pid)) {
      console.log(`already up: pid ${pid}, ${baseUrl({})} — run 'down' first`);
      return;
    }
  }
  if (!existsSync(join(webDist, "index.html"))) {
    console.error(`no ${webDist}/index.html — build the SPA first:\n  pnpm --filter @lavega/web build`);
    process.exit(1);
  }
  const port = Number(args.port) || DEFAULT_LOCAL_PORT;
  mkdirSync(runDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });

  /* A clean environment on purpose: no .env, so a DATABASE_URL or MISTRAL key
   * on the developer's machine can never leak into a verification run. */
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "development",
    PORT: String(port),
    WEB_DIST: webDist,
    LAVEGA_ALLOW_UNAUTHENTICATED: "1",
    INVESTING_MOUNT: "0",
  };
  if (args["with-ai"]) {
    const envFile = join(serverDir, ".env");
    const m = existsSync(envFile) && readFileSync(envFile, "utf8").match(/^MISTRAL_API_KEY=(.+)$/m);
    if (m && m[1].trim()) env.MISTRAL_API_KEY = m[1].trim();
    else console.error("--with-ai: no MISTRAL_API_KEY in apps/server/.env; agents stay dark");
  }

  const log = openSync(logFile, "w");
  const child = spawn(join(serverDir, "node_modules/.bin/tsx"), ["src/index.ts"], {
    cwd: serverDir,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  writeFileSync(portFile, String(port));

  const base = `http://127.0.0.1:${port}`;
  const ready = await waitFor(base, "/health", (r) => r.status === 200 && r.json?.ok === true, 20000);
  if (!ready) {
    console.error(`server did not answer /health within 20s — see ${logFile}`);
    console.error(readFileSync(logFile, "utf8").slice(-1500));
    process.exit(1);
  }
  console.log(`up: pid ${child.pid}, ${base}, log ${logFile}`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function down() {
  if (!existsSync(pidFile)) {
    console.log("not running (no pid file)");
    return;
  }
  const pid = Number(readFileSync(pidFile, "utf8"));
  if (pid && alive(pid)) {
    try {
      process.kill(-pid, "SIGTERM"); // the process group we started, nothing else
    } catch {
      process.kill(pid, "SIGTERM");
    }
    for (let i = 0; i < 20 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    if (alive(pid)) process.kill(pid, "SIGKILL");
    console.log(`stopped pid ${pid}`);
  } else console.log(`pid ${pid} was not running`);
  rmSync(pidFile, { force: true });
  rmSync(portFile, { force: true });
}

async function cleanup() {
  await down();
  rmSync(runDir, { recursive: true, force: true });
  console.log(`removed ${runDir}; kept ${evidenceDir}`);
}

async function doctor(args) {
  const base = baseUrl(args);
  const prod = isProd(args);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const health = await req(base, "GET", "/health");
  add("health answers {ok:true}", health.status === 200 && health.json?.ok === true, `${health.status} ${excerpt(health)}`);

  const shell = await req(base, "GET", "/app");
  add("SPA shell served at /app", shell.status === 200 && /id="root"/.test(shell.text), `${shell.status} ${shell.text.length}b`);

  const agent = await req(base, "GET", "/api/agent/status");
  add("agent status readable", agent.status === 200 && typeof agent.json?.configured === "boolean", `${agent.status} ${excerpt(agent)}`);
  if (agent.json) add(`agents ${agent.json.configured ? "CONFIGURED" : "dark (no MISTRAL_API_KEY)"}`, true, "informational");

  const eb = await req(base, "GET", "/api/eb/status");
  add("enable-banking status readable", eb.status === 200 && typeof eb.json?.configured === "boolean", `${eb.status} ${excerpt(eb)}`);

  const guarded = await req(base, "GET", "/api/vault/backup");
  if (prod) add("guard closed: /api/vault/backup → 401 without session", guarded.status === 401, `${guarded.status}`);
  else add("guard open locally: /api/vault/backup ≠ 401", guarded.status !== 401, `${guarded.status} ${excerpt(guarded)}`);

  const csp = health.headers["content-security-policy"] || shell.headers["content-security-policy"];
  add("security headers present (CSP)", Boolean(csp), csp ? csp.slice(0, 60) + "…" : "missing");

  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}  (${c.detail})`);
  }
  console.log(failed ? `\n${failed} check(s) failed on ${base}` : `\nhealthy: ${base}`);
  process.exit(failed ? 1 : 0);
}

async function probe(args) {
  const base = baseUrl(args);
  const rows = [];
  for (const path of PROBE_ENDPOINTS) {
    const r = await req(base, "GET", path);
    rows.push({ path, status: r.status, ms: r.ms, body: excerpt(r) });
    console.log(`${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${path}  ${excerpt(r)}`);
  }
  if (args.out) {
    mkdirSync(dirname(String(args.out)), { recursive: true });
    writeFileSync(String(args.out), JSON.stringify({ base, at: new Date().toISOString(), rows }, null, 2));
    console.log(`wrote ${args.out}`);
  }
}

/** Prove the guard: every non-public route refuses without a session on a
 *  closed target, and every public route answers. Locally (guard open) the
 *  expectation flips for the guarded set. */
async function guard(args) {
  const base = baseUrl(args);
  const closed = isProd(args) || args.expect === "closed";
  const rows = [];
  let bad = 0;
  for (const [method, path] of GUARDED) {
    const r = await req(base, method, path, method === "GET" || method === "DELETE" ? undefined : {});
    const ok = closed ? r.status === 401 : r.status !== 401;
    if (!ok) bad++;
    rows.push({ kind: "guarded", method, path, status: r.status, ok });
    console.log(`${ok ? "ok  " : "FAIL"} ${method.padEnd(6)} ${path.padEnd(28)} ${r.status}  expected ${closed ? "401" : "not 401"}`);
  }
  for (const [method, path] of PUBLIC) {
    const r = await req(base, method, path);
    const ok = r.status === 200;
    if (!ok) bad++;
    rows.push({ kind: "public", method, path, status: r.status, ok });
    console.log(`${ok ? "ok  " : "FAIL"} ${method.padEnd(6)} ${path.padEnd(28)} ${r.status}  expected 200`);
  }
  if (args.out) {
    mkdirSync(dirname(String(args.out)), { recursive: true });
    writeFileSync(String(args.out), JSON.stringify({ base, closed, at: new Date().toISOString(), rows }, null, 2));
    console.log(`wrote ${args.out}`);
  }
  console.log(bad ? `\n${bad} mismatch(es) on ${base}` : `\nguard posture as expected on ${base} (${closed ? "closed" : "open"})`);
  process.exit(bad ? 1 : 0);
}

async function assets(args) {
  const base = baseUrl(args);
  const shell = await req(base, "GET", "/app");
  console.log(`${shell.status} /app (${shell.text.length}b)`);
  const refs = [...shell.text.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg|png|webmanifest|ico))"/g)].map((m) => m[1]);
  let bad = 0;
  for (const ref of new Set(refs)) {
    const r = await req(base, "GET", ref);
    if (r.status !== 200) bad++;
    console.log(`${r.status} ${ref}`);
  }
  console.log(bad ? `\n${bad} asset(s) failed` : `\nall ${new Set(refs).size} referenced assets served`);
  process.exit(bad ? 1 : 0);
}

async function api(args) {
  const [method, path] = args._.slice(1);
  if (!method || !path) {
    console.error("usage: api <METHOD> </path> [--body '{...}'] [--target prod]");
    process.exit(2);
  }
  if (method.toUpperCase() !== "GET") refuseWriteOnProd(args, `api ${method}`);
  const r = await req(baseUrl(args), method.toUpperCase(), path, args.body);
  console.log(`${r.status} ${r.ms}ms`);
  console.log(r.json ? JSON.stringify(r.json, null, 2) : r.text.slice(0, 2000));
}

function logs(args) {
  if (!existsSync(logFile)) {
    console.log("no log yet");
    return;
  }
  const lines = readFileSync(logFile, "utf8").split("\n");
  console.log(lines.slice(-(Number(args.lines) || 40)).join("\n"));
}

function help() {
  console.log(`control-lavega <command> [--target local|prod] [--base <url>]

  up [--port N] [--with-ai]   start @lavega/server + built SPA, guard open, no .env
  down                        stop what 'up' started
  cleanup                     down + remove ${runDir} (keeps ${evidenceDir})
  doctor                      read-only health: shell, agent/EB status, guard posture, CSP
  probe [--out file]          sweep every read-only endpoint into one report
  guard [--out file] [--expect closed]   prove 401-without-session on every non-public route
  assets                      SPA shell + every asset it references
  api <METHOD> </path> [--body json]      anything not wrapped (writes refuse prod)
  logs [--lines N]            the local instance's stdout/stderr`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const commands = { up, down, cleanup, doctor, probe, guard, assets, api, logs, help };
if (!cmd || !commands[cmd]) {
  help();
  process.exit(cmd ? 2 : 0);
}
await commands[cmd](args);
