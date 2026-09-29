#!/usr/bin/env node
/**
 * control-investing — drive the LaVega investing app for verification.
 *
 * Two targets, one API surface:
 *   local  standalone @lavega/investing-server (apps/investing-server/src/docker.ts).
 *          Single tenant, no auth, own port and own data files. Safe to drive.
 *   prod   https://www.lavega.dev — @lavega/server mounts the same investing app
 *          behind a better-auth session, so every /api call needs a cookie.
 *
 * The API paths are identical on both targets. Only the SPA path differs:
 * "/" on local, "/investing/" on prod.
 *
 * Built for an agent to drive: every command is declared once in COMMANDS, and
 * that one declaration feeds argument validation, `--help`, `help --json`,
 * `--dry-run` and the production write guard. Output is JSON on stdout; errors
 * are JSON on stderr with a `fix` that says what to run instead.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(skillDir, "../../..");
const SELF = "node .claude/skills/verify-investing/control-investing.mjs";

const stateRoot = process.env.VERIFY_INVESTING_DIR || "/tmp/lavega-verify-investing";
const runDir = join(stateRoot, "run"); // torn down by `down` / `cleanup`
const evidenceDir = join(stateRoot, "evidence"); // survives teardown
/* browse validateOutputPath allows /tmp (after realpath) and the daemon's git
 * root from process start. A state dir outside /tmp is not that root. PNGs
 * then go here, which is under /tmp even when VERIFY_INVESTING_DIR is not. */
const SCREENSHOT_EVIDENCE = "/tmp/lavega-verify-investing/evidence";
const pidFile = join(runDir, "local.pid");
const portFile = join(runDir, "local.port");
const dataFile = join(runDir, "local.data");
const logFile = join(runDir, "local.log");
/* Kept outside runDir so `cleanup` does not delete it, and outside the repo so
 * it can never be committed. The user writes it; this CLI only reads it. */
const credentialsFile = join(stateRoot, "auth.json");
const previewCredentialsFile = join(stateRoot, "auth.preview.json");

const PROD_BASE = "https://www.lavega.dev";
const DEFAULT_LOCAL_PORT = 8799;

/** Read-only endpoints. `probe` sweeps all of them; none of these change state. */
const PROBE_ENDPOINTS = [
  "/health",
  "/api/config/status",
  "/api/investing/dashboard",
  "/api/investing/summary",
  "/api/investing/benchmarks",
  "/api/market-data/consent",
  "/api/brokers/sync/status",
  "/api/brokers/credentials/status",
  "/api/prices/sync/status",
];

/** The reads the dashboard page makes on open; `perf` times these by default. */
const PERF_ENDPOINTS = [
  "/api/investing/dashboard",
  "/api/investing/summary",
  "/api/investing/benchmarks",
];

/* A sync is settled once it is no longer working. "waiting" is a broker rate
 * limit and "running" is mid-run, so both keep a poll going. "paused" is a
 * price run that ran out of host budget: settled for now, resumable by
 * posting again. */
const SETTLED_SYNC = new Set(["idle", "completed", "problem", "paused"]);

// ---------------------------------------------------------------- errors

class CliError extends Error {
  constructor(message, { fix, code = "usage", exitCode = 2 } = {}) {
    super(message);
    this.fix = fix;
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Stop the command. `fix` must say what to run or change, not just restate the problem. */
function fail(message, fix, options = {}) {
  throw new CliError(message, { fix, ...options });
}

function printError(error, command) {
  const body =
    error instanceof CliError
      ? { code: error.code, message: error.message, fix: error.fix }
      : {
          code: "internal",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.split("\n").slice(1, 6) : undefined,
          fix: "this is a bug in control-investing.mjs; fix it or report the stack",
        };
  console.error(JSON.stringify({ ok: false, command: command ?? null, error: body }, null, 2));
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function closest(input, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = candidate.startsWith(input) ? 0 : levenshtein(input, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore <= Math.max(2, Math.floor(input.length / 3)) ? best : null;
}

// ---------------------------------------------------------------- arguments

/**
 * Flags declared `boolean` never take the next token as a value, so
 * `sync --wait --target prod` and `browser click --dry-run @e3` parse the way
 * they read. `--` ends flag parsing; everything after it is positional, which is
 * how `browser raw` passes flags through to browse.
 */
function parseArgs(argv, booleanFlags) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inlineValue] = token.slice(2).split(/=(.*)/s);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
    } else if (!booleanFlags.has(name) && next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

function ensureDirs() {
  mkdirSync(runDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
}

// ---------------------------------------------------------------- targets

function localPort(flags) {
  if (flags.port) return Number(flags.port);
  if (existsSync(portFile)) return Number(readFileSync(portFile, "utf8").trim());
  return DEFAULT_LOCAL_PORT;
}

/** `--base` alone means a preview deploy: the docs always used it that way. */
function targetName(flags) {
  if (flags.target) return String(flags.target);
  return flags.base ? "preview" : "local";
}

function baseUrl(flags) {
  if (flags.base) return String(flags.base).replace(/\/+$/, "");
  const target = targetName(flags);
  if (target === "prod") return PROD_BASE;
  if (target === "local") return `http://127.0.0.1:${localPort(flags)}`;
  if (target === "preview") {
    const preview = process.env.LAVEGA_PREVIEW_URL || pinnedPreview()?.url;
    if (preview) return preview.replace(/\/+$/, "");
    return pinPreview(latestPreview()).url;
  }
  fail(`unknown --target "${target}"`, "use --target local, prod, preview, or --base <url>");
}

// ---------------------------------------------------------------- preview lookup

/* Every deploy gets its own URL, and each host gets its own cookie jar. The
 * first preview command pins the newest deploy, so a login and the commands
 * after it keep talking to the same host even when a newer deploy lands
 * between them. `preview --refresh` moves the pin. */
const previewPinFile = join(runDir, "preview.json");

function pinnedPreview() {
  if (!existsSync(previewPinFile)) return null;
  try {
    return JSON.parse(readFileSync(previewPinFile, "utf8"));
  } catch {
    return null;
  }
}

function pinPreview(deployment) {
  ensureDirs();
  writeFileSync(previewPinFile, JSON.stringify(deployment, null, 2));
  return deployment;
}

/* Worktrees are not Vercel-linked; the main checkout, which owns .vercel/, is
 * the parent of the shared git directory. */
function vercelCwd() {
  if (process.env.LAVEGA_VERCEL_CWD) return process.env.LAVEGA_VERCEL_CWD;
  if (existsSync(join(repoRoot, ".vercel/project.json"))) return repoRoot;
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return common.status === 0 ? dirname(common.stdout.trim()) : repoRoot;
}

/** The newest READY preview deploy, optionally only for one git branch. */
function latestPreview(branch) {
  const bin = process.env.LAVEGA_VERCEL_BIN || "vercel";
  const cwd = vercelCwd();
  const args = ["ls", "--environment", "preview", "--status", "READY", "--format", "json"];
  if (branch) args.push("--meta", `githubCommitRef=${branch}`);
  args.push("--cwd", cwd);
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
  const manual = "or pass --base <url> / export LAVEGA_PREVIEW_URL=<url>";
  if (result.error)
    fail(
      `could not run ${bin}: ${result.error.message}`,
      `install the Vercel CLI (npm i -g vercel), ${manual}`,
      {
        code: "vercel-missing",
        exitCode: 1,
      },
    );
  let listing;
  try {
    listing = JSON.parse(result.stdout);
  } catch {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-2).join(" ");
    fail(
      `vercel ls did not return JSON (exit ${result.status}): ${detail}`,
      `run \`vercel login\` and check ${cwd} is Vercel-linked, ${manual}`,
      { code: "vercel-failed", exitCode: 1 },
    );
  }
  const deployment = listing.deployments?.[0];
  if (!deployment)
    fail(
      branch ? `no READY preview deploy for branch "${branch}"` : "no READY preview deploy found",
      branch
        ? "push the branch and wait for its build, or drop --branch to take the newest preview"
        : `push a branch to get a preview, ${manual}`,
      { code: "preview-not-found", exitCode: 1 },
    );
  return {
    url: `https://${deployment.url}`,
    branch: deployment.meta?.githubCommitRef ?? null,
    commit: deployment.meta?.githubCommitSha?.slice(0, 7) ?? null,
    createdAt: new Date(deployment.createdAt).toISOString(),
  };
}

/** The investing page on a preview host. This is the URL the user opens. */
function previewPage(url) {
  if (!url) return null;
  return `${String(url).replace(/\/+$/, "")}/investing/`;
}

function commandPreview({ flags }) {
  const pinned = pinnedPreview();
  if (!flags.refresh && !flags.branch) {
    const url = process.env.LAVEGA_PREVIEW_URL || pinned?.url || null;
    print({
      pinned,
      env: process.env.LAVEGA_PREVIEW_URL ?? null,
      uses:
        process.env.LAVEGA_PREVIEW_URL ??
        pinned?.url ??
        "the newest preview, looked up on first use",
      page: previewPage(url),
    });
    return 0;
  }
  const deployment = latestPreview(flags.branch ? String(flags.branch) : undefined);
  pinPreview(deployment);
  print({
    pinned: deployment,
    page: previewPage(deployment.url),
    previous: pinned?.url === deployment.url ? undefined : (pinned?.url ?? null),
    note: process.env.LAVEGA_PREVIEW_URL
      ? "LAVEGA_PREVIEW_URL is set and still wins over the pin"
      : undefined,
    next:
      pinned?.url === deployment.url
        ? undefined
        : `new host: run \`${SELF} login --target preview\` before reading`,
  });
  return 0;
}

/** baseUrl without side effects: never runs the preview lookup. */
function tryBaseUrl(flags) {
  const unresolvedPreview =
    targetName(flags) === "preview" &&
    !flags.base &&
    !process.env.LAVEGA_PREVIEW_URL &&
    !pinnedPreview();
  if (unresolvedPreview)
    return {
      base: null,
      baseNote: "not pinned yet; the first preview command pins the newest deploy",
    };
  try {
    return { base: baseUrl(flags) };
  } catch (error) {
    return { base: null, baseError: error.message };
  }
}

/* Only the standalone server serves the SPA at "/". Prod and every preview run
 * the mounted app under /investing/. */
function spaPath(flags) {
  return targetName(flags) === "local" ? "/" : "/investing/";
}

/** Page the user opens in a browser. No `?verify=1`. Always include this in the reply. */
function pageUrl(flags) {
  return `${baseUrl(flags).replace(/\/+$/, "")}${spaPath(flags)}`;
}

function hostSlug(base) {
  return new URL(base).host.replace(/[^a-z0-9.-]/gi, "_");
}

/* One jar per host, so a preview login never overwrites the prod session and a
 * prod cookie is never sent to a preview deploy. */
function cookieFileFor(flags) {
  return join(runDir, `cookies-${hostSlug(baseUrl(flags))}.txt`);
}

/* Prod and preview hold different accounts: preview uses the seeded test user
 * on the Neon `preview` branch, never a real person's login. */
function credentialsFileFor(flags) {
  return targetName(flags) === "preview" ? previewCredentialsFile : credentialsFile;
}

/** Both env vars, as named in the Vercel project Config (Dev, Preview, Prod). */
function envCredentialsReady() {
  return Boolean(process.env.LAVEGA_VERIFY_EMAIL && process.env.LAVEGA_VERIFY_PASSWORD);
}

/** KEY=VALUE lines from `vercel env pull`. Values stay in memory. */
function parseEnvAssignment(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"')
        value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    values[key] = value;
  }
  return values;
}

/* One pull per process. A /tmp auth.preview.json is not a handoff: the next
 * agent sandbox often cannot read the file the previous agent wrote. */
let pulledVerifyCredentials;

function pullVercelVerifyCredentials() {
  if (pulledVerifyCredentials) return pulledVerifyCredentials;
  const bin = process.env.LAVEGA_VERCEL_BIN || "vercel";
  const cwd = vercelCwd();
  const dir = mkdtempSync(join(tmpdir(), "lavega-vercel-env-"));
  const file = join(dir, "pull.env");
  let failure = "vercel env pull did not return LAVEGA_VERIFY_EMAIL and LAVEGA_VERIFY_PASSWORD";
  try {
    for (const environment of ["preview", "development", "production"]) {
      rmSync(file, { force: true });
      const result = spawnSync(
        bin,
        ["env", "pull", file, "--environment", environment, "--yes", "--cwd", cwd],
        { encoding: "utf8", timeout: 60_000 },
      );
      if (result.error) {
        failure = `could not run ${bin}: ${result.error.message}`;
        break;
      }
      if (result.status !== 0 || !existsSync(file)) {
        const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
        failure = detail.split("\n").slice(-2).join(" ").slice(0, 300);
        continue;
      }
      const values = parseEnvAssignment(readFileSync(file, "utf8"));
      const email = values.LAVEGA_VERIFY_EMAIL;
      const password = values.LAVEGA_VERIFY_PASSWORD;
      if (email && password) {
        pulledVerifyCredentials = { email, password, from: "vercel-env", environment };
        return pulledVerifyCredentials;
      }
      failure = `vercel env pull --environment ${environment} has no LAVEGA_VERIFY_EMAIL and LAVEGA_VERIFY_PASSWORD`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  pulledVerifyCredentials = { error: failure };
  return pulledVerifyCredentials;
}

/**
 * `login` / `doctor` stop text. Preview loads the Vercel env pair in-process.
 * Do not tell an agent to write auth.preview.json for a later command.
 */
function credentialsMissingFix(flags) {
  const target = targetName(flags);
  const pullError =
    target === "preview" && pulledVerifyCredentials?.error
      ? ` vercel env pull failed: ${pulledVerifyCredentials.error}.`
      : "";
  const previewRule =
    target === "preview"
      ? `For preview, \`login\` runs \`vercel env pull --environment preview\` and reads LAVEGA_VERIFY_EMAIL and LAVEGA_VERIFY_PASSWORD from that output. Those names are in the Vercel project Config for development, preview, and production. Do not write ${previewCredentialsFile}. A file under /tmp is not shared with the next agent. A readable file or --credentials-file still wins when this process can read it. Do not ask for a personal password. `
      : "";
  return (
    `Credential order: a readable ${credentialsFile} for prod, a readable ${previewCredentialsFile} for preview, ` +
    `then LAVEGA_VERIFY_EMAIL and LAVEGA_VERIFY_PASSWORD in the process, then \`vercel env pull\` on preview, ` +
    `then --email and --password. ` +
    previewRule +
    pullError +
    ` Do not invent an account or sign one up. Then run \`${SELF} login --target ${target}\`. ` +
    `Print the JSON field \`page\` so the user can open the preview. ` +
    `A local doctor pass does not satisfy this check.`
  );
}

/* Write commands reach a real broker, the shared price store, or a real
 * tenant's vault. Prod has one set of tenant rows and nothing to restore them
 * from, so refuse there unless the caller names the risk. */
function guardProdWrite(flags, action) {
  if (targetName(flags) !== "prod" || flags["allow-prod-write"]) return;
  fail(
    `${action} writes to production tenant data`,
    "verify writes on --target local or --target preview; add --allow-prod-write only with the user's go-ahead",
    { code: "prod-write-refused" },
  );
}

// ---------------------------------------------------------------- cookies

function loadCookies(flags) {
  const file = cookieFileFor(flags);
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trim();
}

function saveCookies(flags, response) {
  const raw =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (raw.length === 0) return;
  const jar = new Map();
  for (const pair of loadCookies(flags).split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=");
    jar.set(name, rest.join("="));
  }
  for (const header of raw) {
    const [pair] = header.split(";");
    const [name, ...rest] = pair.split("=");
    jar.set(name.trim(), rest.join("="));
  }
  ensureDirs();
  writeFileSync(
    cookieFileFor(flags),
    [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    { mode: 0o600 },
  );
}

// ---------------------------------------------------------------- requests

async function request(flags, method, path, body) {
  const origin = baseUrl(flags);
  const url = `${origin}${path}`;
  /* better-auth rejects a state-changing request with no Origin header
   * (MISSING_OR_NULL_ORIGIN) — that check is what stops a browser on another
   * site from posting here. A non-browser client has to state its origin. */
  const headers = { accept: "application/json", origin, referer: `${origin}/` };
  const cookies = loadCookies(flags);
  if (cookies) headers.cookie = cookies;
  /* Vercel Deployment Protection answers 401 to every call without this
   * header. Prod has no protection; send it only where a deploy might. */
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass && targetName(flags) === "preview") headers["x-vercel-protection-bypass"] = bypass;
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = Date.now();
  let response;
  try {
    const init = { method, headers, redirect: "manual" };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    response = await fetch(url, init);
  } catch (error) {
    return {
      url,
      method,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? (error.cause?.message ?? error.message) : String(error),
    };
  }
  saveCookies(flags, response);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON — keep the raw body so an HTML error page is still visible
  }
  return {
    url,
    method,
    ok: response.ok,
    status: response.status,
    ms: Date.now() - started,
    contentType: response.headers.get("content-type"),
    json,
    text: json ? undefined : text.slice(0, 400),
  };
}

/** Set by `main` for this process. A remote write records itself; `--out` copies any command. */
let outputPath = null;
let recordEvidence = null;

function evidenceStamp(command) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(evidenceDir, `${command.replace(/\s+/g, "-")}-${stamp}.json`);
}

function print(value) {
  const copies = [];
  if (outputPath) copies.push(outputPath);
  if (recordEvidence) copies.push(evidenceStamp(recordEvidence));
  const payload = copies.length === 0 ? value : { ...value, evidence: copies };
  const text = JSON.stringify(payload, null, 2);
  if (copies.length > 0) {
    for (const file of copies) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${text}\n`);
    }
  }
  console.log(text);
}

/** Problem lists are how this backend reports trouble inside a 200 response. */
function problemsOf(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Array.isArray(payload.problems) ? payload.problems : [];
}

async function waitFor(check, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((done) => setTimeout(done, intervalMs));
  }
  return false;
}

// ---------------------------------------------------------------- local instance

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function recordedPid() {
  return existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : null;
}

function tailLog(lines = 20) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-lines);
}

async function localHealthy(port) {
  const health = await request({ base: `http://127.0.0.1:${port}` }, "GET", "/health");
  return health.ok && health.json?.service === "investing-server";
}

async function startLocal({ port, dataDir }) {
  ensureDirs();
  mkdirSync(dataDir, { recursive: true });

  const distDir = join(repoRoot, "apps/investing-web/dist");
  if (!existsSync(distDir)) {
    fail(
      "apps/investing-web/dist is missing — the SPA has not been built",
      "run: pnpm --filter @lavega/investing-web build",
      { code: "spa-not-built", exitCode: 1 },
    );
  }

  /* Run tsx directly rather than through `pnpm --filter`: pnpm's deps-status
   * check wants a TTY to confirm a modules purge and aborts without one. */
  const tsx = join(repoRoot, "node_modules/.bin/tsx");
  if (!existsSync(tsx))
    fail("node_modules/.bin/tsx is missing", "run: pnpm install", {
      code: "deps-missing",
      exitCode: 1,
    });

  writeFileSync(logFile, "");
  const logFd = openSync(logFile, "a");
  const child = spawn(tsx, ["apps/investing-server/src/docker.ts"], {
    cwd: repoRoot,
    detached: true,
    /* File stdio, not a pipe: `up` exits after /health, and a pipe then
     * EPIPE-kills the child on the first Trading 212 diagnostic log. */
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      PORT: String(port),
      INVESTING_WEB_DIST: distDir,
      INVESTING_PRICE_STORE_FILE: join(dataDir, "prices.json"),
      INVESTING_BENCHMARK_STORE_FILE: join(dataDir, "benchmarks.json"),
      INVESTING_MARKET_DATA_CONSENT_FILE: join(dataDir, "market-data-consent.json"),
      INVESTING_SECTOR_STORE_FILE: join(dataDir, "sectors.json"),
      LAVEGA_VAULT_FILE: join(dataDir, "credentials.json"),
      // No DATABASE_URL: the file stores above own the data, so a verification
      // run never touches the tenant rows behind the deployed dashboard.
      DATABASE_URL: "",
    },
  });
  child.unref();
  closeSync(logFd);

  writeFileSync(pidFile, String(child.pid));
  writeFileSync(portFile, String(port));
  writeFileSync(dataFile, dataDir);

  const ready = await waitFor(() => localHealthy(port), 40_000);
  return { ready, pid: child.pid, port, dataDir };
}

/** Kill only the pid this CLI recorded — never by process name, which would
 *  take down a dev server the user started themselves. */
function stopLocal() {
  const pid = recordedPid();
  if (pid === null) return { stopped: false, reason: "no instance recorded by this CLI" };
  let stopped = false;
  try {
    process.kill(-pid, "SIGTERM");
    stopped = true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      stopped = true;
    } catch {
      /* already gone */
    }
  }
  rmSync(pidFile, { force: true });
  rmSync(portFile, { force: true });
  return { stopped, pid };
}

function recordedDataDir() {
  return existsSync(dataFile) ? readFileSync(dataFile, "utf8").trim() : join(runDir, "data");
}

// ---------------------------------------------------------------- commands: instance

async function commandUp({ flags }) {
  ensureDirs();
  const pid = recordedPid();
  if (pid !== null) {
    if (isAlive(pid)) {
      print({ started: false, reason: "already running", pid, port: localPort(flags) });
      return 0;
    }
    rmSync(pidFile, { force: true });
  }
  const port = flags.port ? Number(flags.port) : DEFAULT_LOCAL_PORT;
  const dataDir = flags.data ? resolve(String(flags.data)) : join(runDir, "data");
  const started = await startLocal({ port, dataDir });
  if (!started.ready) {
    print({
      started: false,
      pid: started.pid,
      port,
      log: logFile,
      tail: tailLog(),
      fix: `read the tail above; \`${SELF} logs --lines 100\` shows more`,
    });
    return 1;
  }
  print({
    started: true,
    pid: started.pid,
    port,
    base: `http://127.0.0.1:${port}`,
    data: dataDir,
    log: logFile,
  });
  return 0;
}

function commandDown() {
  const result = stopLocal();
  print(result.pid ? { ...result, evidenceKept: evidenceDir } : result);
  return 0;
}

function commandCleanup() {
  const stopped = stopLocal();
  rmSync(runDir, { recursive: true, force: true });
  print({ ...stopped, removed: runDir, kept: evidenceDir });
  return 0;
}

async function commandRestart({ flags }) {
  const port = flags.port ? Number(flags.port) : localPort(flags);
  const dataDir = flags.data ? resolve(String(flags.data)) : recordedDataDir();
  const stopped = stopLocal();
  if (stopped.stopped) await waitFor(async () => !isAlive(stopped.pid), 10_000, 200);
  const started = await startLocal({ port, dataDir });
  print({
    restarted: started.ready,
    previousPid: stopped.pid ?? null,
    pid: started.pid,
    port,
    data: dataDir,
    log: logFile,
    tail: started.ready ? undefined : tailLog(),
  });
  return started.ready ? 0 : 1;
}

/**
 * Watch the local instance and emit one JSON line per state change. With
 * --restart, bring it back when it dies — the long-running companion for an
 * agent editing server code while tsx is not watching.
 */
async function commandWatch({ flags }) {
  if (targetName(flags) !== "local")
    fail(
      "watch only follows the local instance this CLI starts",
      `for a deployed target, poll \`${SELF} doctor --target ${targetName(flags)}\` instead`,
    );
  const intervalMs = Number(flags.interval ?? 5_000);
  const deadline = flags.timeout ? Date.now() + Number(flags.timeout) : Infinity;
  const emit = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
  let last = null;
  let restarts = 0;
  while (Date.now() < deadline) {
    const port = localPort(flags);
    const up = await localHealthy(port);
    if (up !== last) emit({ event: up ? "up" : "down", port, pid: recordedPid() });
    last = up;
    if (!up && flags.restart) {
      const started = await startLocal({ port, dataDir: recordedDataDir() });
      restarts += 1;
      emit({
        event: started.ready ? "restarted" : "restart-failed",
        port,
        pid: started.pid,
        tail: started.ready ? undefined : tailLog(10),
      });
      last = started.ready;
    }
    await new Promise((done) => setTimeout(done, Math.min(intervalMs, deadline - Date.now())));
  }
  emit({ event: "timeout", restarts });
  return 0;
}

function commandLogs({ flags }) {
  print({ log: logFile, lines: tailLog(Number(flags.lines ?? 40)) });
  return 0;
}

function commandEvidence() {
  print({ evidenceDir, runDir, note: "cleanup removes runDir and keeps evidenceDir" });
  return 0;
}

/** Everything an agent needs to orient itself, without a network call. */
function commandInfo({ flags }) {
  const pid = recordedPid();
  const sessions = existsSync(runDir)
    ? readdirSync(runDir)
        .filter((name) => name.startsWith("cookies-") && name.endsWith(".txt"))
        .map((name) => name.slice("cookies-".length, -".txt".length))
    : [];
  const browse = browseBin();
  const baseInfo = tryBaseUrl(flags);
  print({
    target: targetName(flags),
    ...baseInfo,
    page: baseInfo.base ? `${baseInfo.base.replace(/\/+$/, "")}${spaPath(flags)}` : null,
    spaPath: spaPath(flags),
    stateRoot,
    runDir,
    evidenceDir,
    local: {
      pid,
      alive: isAlive(pid),
      port: localPort(flags),
      data: recordedDataDir(),
      log: existsSync(logFile) ? logFile : null,
    },
    sessions,
    credentials: {
      prod: credentialsFileReadable(credentialsFile),
      preview: credentialsFileReadable(previewCredentialsFile),
      env: Boolean(process.env.LAVEGA_VERIFY_EMAIL && process.env.LAVEGA_VERIFY_PASSWORD),
    },
    spaBuilt: existsSync(join(repoRoot, "apps/investing-web/dist")),
    browse: {
      bin: browse,
      present: existsSync(browse),
      canonical: browseCanonical(),
      codex: browseLegacy(),
      chromium: chromiumHeadlessPresent(),
      install: `${SELF} browser install`,
    },
    // Presence only: a secret's value never belongs in a transcript.
    env: {
      LAVEGA_PREVIEW_URL: process.env.LAVEGA_PREVIEW_URL ?? null,
      VERCEL_AUTOMATION_BYPASS_SECRET: Boolean(process.env.VERCEL_AUTOMATION_BYPASS_SECRET),
    },
  });
  return 0;
}

// ---------------------------------------------------------------- commands: health

async function commandDoctor({ flags }) {
  const report = { base: baseUrl(flags), page: pageUrl(flags), checks: [], verdict: "ok" };
  const note = (name, ok, detail) => {
    report.checks.push({ name, ok, ...detail });
    if (!ok) report.verdict = "problem";
  };

  /* The mount owns everything outside /api/, so on prod `/health` answers for
   * the personal server and never reaches the investing app. Only the forwarded
   * path proves which app replied. */
  const health = await request(flags, "GET", "/api/investing/health");
  note("health", health.ok && health.json?.service === "investing-server", {
    status: health.status,
    body: health.json ?? health.text,
    error: health.error,
    fix:
      health.status === 0 && targetName(flags) === "local"
        ? `nothing is listening; run \`${SELF} up\``
        : undefined,
  });

  const session = await request(flags, "GET", "/api/auth/get-session");
  const authed = Boolean(session.json?.user);
  const unconfigured = session.status === 503 || session.status === 404;
  report.auth = unconfigured
    ? "unconfigured"
    : authed
      ? `authenticated:${session.json.user.email ?? session.json.user.id}`
      : "anonymous";

  /* Local has no accounts. Preview and prod do. A missing file is a stop when
   * the Vercel env pair is also unset and there is no session — not a prompt
   * to invent a login or ask for a personal password. */
  if (targetName(flags) !== "local") {
    const file = credentialsFileFor(flags);
    const stored = readStoredCredentials(file);
    const fileReady = Boolean(stored?.email);
    let source = fileReady ? "file" : envCredentialsReady() ? "environment" : null;
    if (!source && !authed && targetName(flags) === "preview") {
      const pulled = pullVercelVerifyCredentials();
      if (pulled.email) source = "vercel-env";
    }
    const satisfied = Boolean(source) || authed;
    note("credentialsFile", satisfied, {
      path: file,
      present: fileReady,
      unreadable: stored?.unreadable || undefined,
      env: source === "environment" || source === "vercel-env",
      source: source ?? undefined,
      fix: satisfied ? undefined : credentialsMissingFix(flags),
    });
  }

  const dashboard = await request(flags, "GET", "/api/investing/dashboard");
  if (dashboard.status === 401) {
    note("dashboard", false, {
      status: 401,
      reason: "no session — the mount refuses to guess a tenant",
      fix: `${SELF} login --target ${targetName(flags)}`,
    });
  } else {
    note("dashboard", dashboard.ok, {
      status: dashboard.status,
      problems: problemsOf(dashboard.json),
      positions: dashboard.json?.positions?.length ?? null,
    });
  }

  /* A dashboard that returns 200 with no problems still shows a user nothing if
   * no holding carries a price or a cost basis. That reads as green everywhere
   * else, so name it here. */
  const positions = Array.isArray(dashboard.json?.positions) ? dashboard.json.positions : [];
  if (positions.length > 0) {
    const priced = positions.filter(
      (position) => position.priceStatus === "priced" || position.priceStatus === "forward-filled",
    ).length;
    const withCost = positions.filter(
      (position) => position.returns?.status === "available",
    ).length;
    note("positionsPriced", priced > 0, {
      priced,
      of: positions.length,
      unpricedSample: positions
        .filter((position) => position.priceStatus === "unpriced")
        .slice(0, 5)
        .map((position) => position.symbol),
      fix:
        priced > 0
          ? undefined
          : `unpriced holdings. \`${SELF} consent\`. If accepted is false, \`${SELF} consent --accept\` then \`${SELF} sync --wait\` and \`${SELF} prices sync --wait\`. If accepted is true, skip accept and run those two sync commands. Consent alone fetches nothing.`,
    });
    note("positionsCosted", withCost > 0, {
      withCostBasis: withCost,
      of: positions.length,
      reasons: [
        ...new Set(
          positions
            .map((position) => position.returns?.status)
            .filter((status) => status && status !== "available"),
        ),
      ],
    });
  }

  const config = await request(flags, "GET", "/api/config/status");
  note("config", config.ok, { status: config.status, keys: config.json?.keys });

  const vault = await request(flags, "GET", "/api/brokers/credentials/status");
  note("credentials", vault.ok, { status: vault.status, body: vault.json });

  /* A connected broker with zero positions on a mounted target is the preview
   * false green: the Neon branch lacks a migration, or its
   * LAVEGA_ENCRYPTION_KEY differs from the key that wrote the snapshots, so
   * nothing decrypts and the dashboard still answers 200 with no problems. */
  if (
    targetName(flags) !== "local" &&
    authed &&
    dashboard.ok &&
    positions.length === 0 &&
    vault.json?.status &&
    vault.json.status !== "empty"
  ) {
    note("positionsPresent", false, {
      vault: vault.json.status,
      positions: 0,
      fix: "check the Neon branch has every migration and LAVEGA_ENCRYPTION_KEY matches Production",
    });
  }

  const sync = await request(flags, "GET", "/api/brokers/sync/status");
  note("brokerSync", sync.ok, { status: sync.status, body: sync.json });

  print(report);
  return report.verdict === "ok" ? 0 : 1;
}

/**
 * Sweep every read-only endpoint at once. This is the first command to run when
 * "the dashboard will not load": it separates a transport failure (status 0),
 * an auth failure (401), a backend failure (5xx) and a degraded-but-served
 * dashboard (200 with a problems list) in one output.
 */
async function commandProbe({ flags }) {
  const results = [];
  for (const path of PROBE_ENDPOINTS) {
    const response = await request(flags, "GET", path);
    results.push({
      path,
      status: response.status,
      ms: response.ms,
      ok: response.ok,
      problems: problemsOf(response.json),
      body: flags.verbose || flags.out ? (response.json ?? response.text) : undefined,
      error: response.error,
    });
  }
  const report = {
    base: baseUrl(flags),
    at: new Date().toISOString(),
    unreachable: results.filter((entry) => entry.status === 0).map((entry) => entry.path),
    unauthorized: results.filter((entry) => entry.status === 401).map((entry) => entry.path),
    serverErrors: results.filter((entry) => entry.status >= 500).map((entry) => entry.path),
    degraded: results
      .filter((entry) => entry.ok && entry.problems.length > 0)
      .map((entry) => ({ path: entry.path, problems: entry.problems })),
    results,
  };
  if (flags.out) report.savedTo = resolve(String(flags.out));
  print(report);
  const healthy = report.unreachable.length === 0 && report.serverErrors.length === 0;
  return healthy ? 0 : 1;
}

/**
 * Fetch the SPA shell and every asset it references, and check each asset came
 * back as a real asset. A blank /investing page has one recurring cause: the
 * shell asks for /assets/... instead of /investing/assets/..., and the static
 * fallback answers with index.html at status 200.
 */
async function commandAssets({ flags }) {
  const shellPath = flags.path ? String(flags.path) : spaPath(flags);
  const shell = await request(flags, "GET", shellPath);
  const html = shell.text ?? (typeof shell.json === "string" ? shell.json : "");
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => /\.(js|css)$/.test(reference));
  const checks = [];
  for (const reference of references) {
    const path = reference.startsWith("http")
      ? new URL(reference).pathname
      : reference.startsWith("/")
        ? reference
        : `${shellPath}${reference}`;
    const asset = await request(flags, "GET", path);
    const servedAsHtml = (asset.contentType ?? "").includes("text/html");
    checks.push({
      path,
      status: asset.status,
      contentType: asset.contentType,
      ok: asset.ok && !servedAsHtml,
      note: servedAsHtml
        ? "served index.html instead of the asset — base path mismatch"
        : undefined,
    });
  }
  const report = {
    shell: { path: shellPath, status: shell.status, contentType: shell.contentType },
    references: references.length,
    checks,
    verdict: checks.every((check) => check.ok) && shell.ok ? "ok" : "problem",
  };
  print(report);
  return report.verdict === "ok" ? 0 : 1;
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

/** Time the reads the dashboard makes, so "it feels slow" becomes a number. */
async function commandPerf({ flags }) {
  const runs = Number(flags.runs ?? 5);
  const paths = flags.path ? String(flags.path).split(",") : PERF_ENDPOINTS;
  const results = [];
  for (const path of paths) {
    const timings = [];
    const statuses = new Set();
    for (let run = 0; run < runs; run += 1) {
      const response = await request(flags, "GET", path);
      timings.push(response.ms);
      statuses.add(response.status);
    }
    const sorted = [...timings].sort((a, b) => a - b);
    results.push({
      path,
      runs,
      statuses: [...statuses],
      ms: {
        min: sorted[0],
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.at(-1),
      },
    });
  }
  print({ base: baseUrl(flags), at: new Date().toISOString(), results });
  const allOk = results.every((entry) =>
    entry.statuses.every((status) => status >= 200 && status < 300),
  );
  return allOk ? 0 : 1;
}

// ---------------------------------------------------------------- commands: session

/**
 * Path when this process can read the file. An unreadable /tmp file is not a
 * credential source — the next agent often cannot open what the last one wrote.
 */
function credentialsFileReadable(path) {
  if (!existsSync(path)) return null;
  try {
    readFileSync(path);
    return path;
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    if (code === "EACCES" || code === "EPERM") return null;
    return path;
  }
}

/**
 * Where a password comes from, in order:
 *   1. a readable auth.preview.json (preview) or auth.json (prod), or --credentials-file
 *   2. LAVEGA_VERIFY_EMAIL + LAVEGA_VERIFY_PASSWORD already in the process
 *   3. on preview, `vercel env pull` (those names live in the Vercel project)
 *   4. --email and --password (both)
 * A password passed as an argument is visible in shell history and in any
 * transcript of the run. Do not write auth.preview.json for a later command.
 */
function readStoredCredentials(path) {
  if (!existsSync(path)) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    if (code === "EACCES" || code === "EPERM") return { unreadable: true, path };
    fail(`${path} is not readable (${code ?? "error"})`, credentialsMissingFix({}), {
      code: "credentials-invalid",
    });
  }
  let stored;
  try {
    stored = JSON.parse(text);
  } catch {
    fail(`${path} is not readable JSON`, 'write it as {"email":"...","password":"..."}', {
      code: "credentials-invalid",
    });
  }
  if (stored.email && stored.password)
    return { email: String(stored.email), password: String(stored.password), from: path };
  return null;
}

function resolveCredentials(flags) {
  const path = flags["credentials-file"]
    ? resolve(String(flags["credentials-file"]))
    : credentialsFileFor(flags);
  const stored = readStoredCredentials(path);
  if (stored?.email) return stored;
  if (envCredentialsReady())
    return {
      email: String(process.env.LAVEGA_VERIFY_EMAIL),
      password: String(process.env.LAVEGA_VERIFY_PASSWORD),
      from: "environment",
    };
  if (targetName(flags) === "preview") {
    const pulled = pullVercelVerifyCredentials();
    if (pulled.email) return { email: pulled.email, password: pulled.password, from: "vercel-env" };
  }
  if (flags.email && flags.password)
    return {
      email: String(flags.email),
      password: String(flags.password),
      from: "--email/--password",
    };
  return null;
}

async function commandLogin({ flags }) {
  const credentials = resolveCredentials(flags);
  if (!credentials) {
    fail("no credentials found", credentialsMissingFix(flags), { code: "credentials-missing" });
  }
  const response = await request(flags, "POST", "/api/auth/sign-in/email", {
    email: credentials.email,
    password: credentials.password,
  });
  if (!response.ok) {
    print({
      signedIn: false,
      status: response.status,
      body: response.json ?? response.text,
      credentialsFrom: credentials.from,
      page: pageUrl(flags),
      fix:
        response.status === 0
          ? `the target is unreachable; run \`${SELF} doctor --target ${targetName(flags)}\``
          : "the account or password was rejected. credentialsFrom names the source. Do not print the password. Do not write a new auth.preview.json.",
    });
    return 1;
  }
  const session = await request(flags, "GET", "/api/auth/get-session");
  print({
    signedIn: Boolean(session.json?.user),
    user: session.json?.user ?? null,
    cookieJar: cookieFileFor(flags),
    credentialsFrom: credentials.from,
    page: pageUrl(flags),
  });
  return session.json?.user ? 0 : 1;
}

async function commandWhoami({ flags }) {
  const session = await request(flags, "GET", "/api/auth/get-session");
  /* 503 is better-auth without a DATABASE_URL; 404 is the standalone local
   * server, which has no auth routes at all. Neither is a signed-out user. */
  const unconfigured = session.status === 503 || session.status === 404;
  print({
    status: session.status,
    user: session.json?.user ?? null,
    state: unconfigured ? "unconfigured" : session.json?.user ? "authenticated" : "anonymous",
  });
  return 0;
}

function commandLogout({ flags }) {
  rmSync(cookieFileFor(flags), { force: true });
  print({ cookieJarCleared: cookieFileFor(flags) });
  return 0;
}

// ---------------------------------------------------------------- commands: read

async function commandDashboard({ flags }) {
  const query = flags.symbol ? `?symbol=${encodeURIComponent(String(flags.symbol))}` : "";
  const response = await request(flags, "GET", `/api/investing/dashboard${query}`);
  if (flags.raw) {
    print(response.json ?? response.text);
    return response.ok ? 0 : 1;
  }
  const data = response.json ?? {};
  print({
    status: response.status,
    ms: response.ms,
    problems: problemsOf(data),
    positions: data.positions?.length ?? null,
    pricedPositions:
      data.positions?.filter(
        (position) => position.marketValue !== null && position.marketValue > 0,
      ).length ?? null,
    portfolioPoints: data.portfolio?.All?.length ?? null,
    benchmarks: data.benchmarks?.map((series) => series.symbol ?? series.name) ?? null,
    trades: data.trades?.length ?? null,
    dividends: data.dividends?.length ?? null,
    // An empty-but-valid dashboard is the deliberate degraded shape: the UI
    // stays usable so reconnect and resync remain reachable.
    shape:
      (data.positions?.length ?? 0) === 0 && problemsOf(data).length > 0
        ? "degraded (empty + problems)"
        : "normal",
    fix: response.status === 401 ? `${SELF} login --target ${targetName(flags)}` : undefined,
  });
  return response.ok ? 0 : 1;
}

async function commandSummary({ flags }) {
  const response = await request(flags, "GET", "/api/investing/summary");
  print({ status: response.status, ms: response.ms, body: response.json ?? response.text });
  return response.ok ? 0 : 1;
}

async function commandSyncStatus({ flags }) {
  const [broker, prices, vault] = await Promise.all([
    request(flags, "GET", "/api/brokers/sync/status"),
    request(flags, "GET", "/api/prices/sync/status"),
    request(flags, "GET", "/api/brokers/credentials/status"),
  ]);
  print({
    broker: { status: broker.status, body: broker.json ?? broker.text },
    prices: { status: prices.status, body: prices.json ?? prices.text },
    credentials: { status: vault.status, body: vault.json ?? vault.text },
  });
  return broker.ok && prices.ok && vault.ok ? 0 : 1;
}

/** Poll the sync status routes until every one of them has stopped working. */
async function pollSettled(flags, paths, timeoutMs, intervalMs) {
  const started = Date.now();
  const last = {};
  const settled = await waitFor(
    async () => {
      const responses = await Promise.all(paths.map((path) => request(flags, "GET", path)));
      responses.forEach((response, index) => {
        last[paths[index]] = response.json ?? { status: `http ${response.status}` };
      });
      /* A route that cannot answer will not start answering by waiting, so
       * stop and show it rather than spend the whole timeout. */
      if (responses.some((response) => !response.ok)) return true;
      return responses.every((response) => SETTLED_SYNC.has(response.json?.status));
    },
    timeoutMs,
    intervalMs,
  );
  const allSettled =
    settled && Object.values(last).every((progress) => SETTLED_SYNC.has(progress?.status));
  return { settled: allSettled, waitedMs: Date.now() - started, last };
}

async function commandWaitSettle({ flags }) {
  const paths = [];
  if (!flags.prices) paths.push("/api/brokers/sync/status");
  if (!flags.broker) paths.push("/api/prices/sync/status");
  const result = await pollSettled(
    flags,
    paths,
    Number(flags.timeout ?? 120_000),
    Number(flags.interval ?? 1_000),
  );
  const problem = Object.values(result.last).some((progress) => progress?.status === "problem");
  print({
    settled: result.settled,
    waitedMs: result.waitedMs,
    broker: result.last["/api/brokers/sync/status"],
    prices: result.last["/api/prices/sync/status"],
    fix: result.settled
      ? undefined
      : "still working at timeout; raise --timeout, or read `sync-status` for waitUntil",
  });
  return result.settled && !problem ? 0 : 1;
}

/**
 * Allow Yahoo Finance stores consent, then the SPA POSTs /api/brokers/sync
 * and keeps posting /api/prices/sync while the price run is paused or active.
 * The PUT itself fetches nothing. `next` is that continuation, so a successful
 * accept does not end the drive.
 */
function postAllowNext(accepted) {
  const follow = [
    `${SELF} sync --wait`,
    `${SELF} prices sync --wait`,
    `${SELF} wait-settle --timeout 300000`,
    `${SELF} dashboard`,
  ];
  if (accepted)
    return {
      why: "Consent is stored. Allow Yahoo Finance then POSTs /api/brokers/sync (not --force) and continues POST /api/prices/sync while price status is paused, running, or waiting. The PUT does not fetch bars.",
      commands: follow,
    };
  return {
    why: "Yahoo Finance consent is not accepted. Price sync and benchmark search answer 428 and fetch nothing until it is. Accept, then run the same path the Allow Yahoo Finance button runs.",
    commands: [`${SELF} consent --accept --dry-run`, `${SELF} consent --accept`, ...follow],
  };
}

const CONSENT_REQUIRED_FIX = `Yahoo Finance consent is not accepted. Run \`${SELF} consent\`, then \`${SELF} consent --accept --dry-run\` and \`${SELF} consent --accept\`, then \`${SELF} sync --wait\` and \`${SELF} prices sync --wait\`. Consent alone fetches nothing.`;

async function commandConsent({ flags }) {
  if (!flags.accept) {
    const response = await request(flags, "GET", "/api/market-data/consent");
    const accepted = response.json?.accepted === true;
    print({
      status: response.status,
      body: response.json ?? response.text,
      next: response.ok ? postAllowNext(accepted) : undefined,
    });
    return response.ok ? 0 : 1;
  }
  const response = await request(flags, "PUT", "/api/market-data/consent", {
    accepted: true,
    disclosureVersion: flags.version ? String(flags.version) : undefined,
  });
  print({
    status: response.status,
    body: response.json ?? response.text,
    next: response.ok ? postAllowNext(true) : undefined,
  });
  return response.ok ? 0 : 1;
}

function parseBody(flags) {
  if (flags.body === undefined) return undefined;
  try {
    return JSON.parse(String(flags.body));
  } catch (error) {
    fail(
      `--body is not valid JSON: ${error.message}`,
      `quote it for the shell: --body '{"key":"value"}'`,
      {
        code: "body-invalid",
      },
    );
  }
}

async function commandApi({ flags, args }) {
  const [method, path] = args;
  const response = await request(flags, method.toUpperCase(), path, parseBody(flags));
  print({
    status: response.status,
    ms: response.ms,
    contentType: response.contentType,
    body: response.json ?? response.text,
  });
  return response.ok ? 0 : 1;
}

// ---------------------------------------------------------------- commands: write

async function commandSync({ flags }) {
  const force = flags.force ? "?force=true" : "";
  const response = await request(flags, "POST", `/api/brokers/sync${force}`);
  if (!flags.wait) {
    print({ status: response.status, body: response.json ?? response.text });
    return response.ok ? 0 : 1;
  }
  const result = await pollSettled(
    flags,
    ["/api/brokers/sync/status"],
    Number(flags.timeout ?? 120_000),
    500,
  );
  const progress = result.last["/api/brokers/sync/status"] ?? null;
  print({ started: response.status, settled: result.settled, progress });
  return result.settled && progress?.status !== "problem" ? 0 : 1;
}

async function commandUnlock({ flags }) {
  const response = await request(flags, "POST", "/api/brokers/credentials/unlock", {
    passphrase: String(flags.passphrase),
  });
  print({ status: response.status, body: response.json ?? response.text });
  return response.ok ? 0 : 1;
}

const PRICE_SYNC_ACTIVE = new Set(["running", "waiting"]);
const PRICE_SYNC_DONE = new Set(["completed", "problem"]);

function priceSyncPath(flags) {
  return `/api/prices/sync${flags.force ? "?force=true" : ""}`;
}

function priceSliceNeedsAnotherPost(response) {
  const status = response.json?.status;
  return response.status === 202 || status === "paused" || PRICE_SYNC_ACTIVE.has(status);
}

function consentRequiredResult(response) {
  print({
    status: response.status,
    body: response.json ?? response.text,
    fix: CONSENT_REQUIRED_FIX,
  });
  return 1;
}

async function commandPricesSync({ flags }) {
  const path = priceSyncPath(flags);
  if (!flags.wait) {
    const response = await request(flags, "POST", path);
    if (response.status === 428) return consentRequiredResult(response);
    print({
      status: response.status,
      body: response.json ?? response.text,
      next: priceSliceNeedsAnotherPost(response)
        ? {
            why: "This slice stopped before every symbol was priced. Allow Yahoo Finance posts /api/prices/sync again while status is paused, running, or waiting.",
            commands: [`${SELF} prices sync --wait`],
          }
        : undefined,
    });
    return response.ok ? 0 : 1;
  }

  const deadline = Date.now() + Number(flags.timeout ?? 300_000);
  const maxRounds = Number(flags.rounds ?? 40);
  const rounds = [];
  let last = null;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (Date.now() >= deadline) break;
    const response = await request(flags, "POST", path);
    last = response;
    const progress = response.json ?? null;
    rounds.push({ round, http: response.status, status: progress?.status ?? null });
    if (response.status === 428) return consentRequiredResult(response);
    if (!response.ok && response.status !== 202) {
      print({
        status: response.status,
        rounds,
        body: progress ?? response.text,
        fix:
          response.status === 0 ? `the target did not answer; run \`${SELF} doctor\`` : undefined,
      });
      return 1;
    }
    const state = progress?.status;
    if (PRICE_SYNC_DONE.has(state)) {
      print({
        status: response.status,
        settled: state === "completed",
        rounds,
        body: progress,
      });
      return state === "problem" ? 1 : 0;
    }
    if (PRICE_SYNC_ACTIVE.has(state)) {
      const remaining = Math.max(1_000, deadline - Date.now());
      const polled = await pollSettled(flags, ["/api/prices/sync/status"], remaining, 1_000);
      const polledBody = polled.last["/api/prices/sync/status"] ?? null;
      rounds.push({ round, http: "poll", status: polledBody?.status ?? null });
      if (PRICE_SYNC_DONE.has(polledBody?.status)) {
        print({
          status: response.status,
          settled: polledBody.status === "completed",
          rounds,
          body: polledBody,
        });
        return polledBody.status === "problem" ? 1 : 0;
      }
      if (polledBody?.status === "paused") continue;
      break;
    }
    if (state === "paused") continue;
    print({ status: response.status, settled: true, rounds, body: progress });
    return response.ok ? 0 : 1;
  }
  const lastRound = rounds[rounds.length - 1];
  print({
    settled: false,
    rounds,
    body: last?.json ?? last?.text,
    fix: `price sync is still ${lastRound?.status ?? "unfinished"}. Rerun \`${SELF} prices sync --wait\` or raise --timeout. A paused run resumes on the next POST.`,
  });
  return 1;
}

async function commandPricesPurge({ flags }) {
  if (!flags.yes)
    fail("purge deletes every cached price bar", "rerun with --yes, or --dry-run to preview", {
      code: "confirmation-required",
    });
  const response = await request(flags, "DELETE", "/api/prices/cache");
  print({ status: response.status, body: response.json ?? response.text });
  return response.ok ? 0 : 1;
}

// ---------------------------------------------------------------- browser (gstack browse)

/** One install path. `./setup` in that clone writes `browse/dist/browse`. */
function gstackRoot() {
  return join(process.env.HOME, ".claude/skills/gstack");
}

function browseCanonical() {
  return join(gstackRoot(), "browse/dist/browse");
}

function browseLegacy() {
  return join(process.env.HOME, ".codex/skills/gstack/browse/dist/browse");
}

function browseBin() {
  if (process.env.LAVEGA_BROWSE_BIN) return process.env.LAVEGA_BROWSE_BIN;
  if (existsSync(browseCanonical())) return browseCanonical();
  if (existsSync(browseLegacy())) return browseLegacy();
  return browseCanonical();
}

/** A browse binary that already works. The Codex path alone is enough. */
function existingBrowseBin() {
  const override = process.env.LAVEGA_BROWSE_BIN;
  if (override) return existsSync(override) ? override : null;
  return [browseCanonical(), browseLegacy()].find((path) => existsSync(path)) ?? null;
}

/** Pinned installer. The real `browser install` runs this; dry-run prints it. */
const BUN_INSTALL = 'curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10"';

/** Same command an agent copies. `bun x` is how the CLI runs it after ensuring bun. */
const PLAYWRIGHT_CHROMIUM = "bunx playwright@1.58.2 install chromium";

const BUN_MISSING_FIX = `The pinned installer did not put bun on PATH. Run it yourself (it checks the bun-v1.3.10 checksum): ${BUN_INSTALL}; then \`export PATH="$HOME/.bun/bin:$PATH"\` and rerun \`${SELF} browser install\`. Or set LAVEGA_BROWSE_BIN to an existing browse binary. Or use ${browseLegacy()} when that file exists (the Codex path alone is enough). Do not invent a path. If the installer failed with EPERM or a sandbox refusal, escalate and rerun \`${SELF} browser install\` outside the sandbox.`;

const CHROMIUM_MISSING_FIX = `Playwright's headless shell is still missing. Rerun \`${SELF} browser install\` outside the sandbox so it can run \`${PLAYWRIGHT_CHROMIUM}\`. Visual checks stay verified-unreachable until that command exits 0 and the headless shell is on disk. Do not invent a Chromium path. A browse-sandboxed failure is not this error: escalate and retry, do not reinstall for that.`;

function spawnDetail(result) {
  const raw = result?.error?.message || result?.stderr || result?.stdout || "";
  const text = String(raw).trim();
  if (text) return text.split("\n").slice(-4).join(" ");
  if (result?.status != null) return `exit ${result.status}`;
  return "no output";
}

function bunAvailable() {
  const result = spawnSync("bun", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

function bunHomeBin() {
  if (!process.env.HOME) return null;
  const bin = join(process.env.HOME, ".bun", "bin", "bun");
  return existsSync(bin) ? bin : null;
}

function prependBunPath() {
  const homeBun = bunHomeBin();
  if (!homeBun) return false;
  const dir = dirname(homeBun);
  const current = process.env.PATH ?? "";
  if (!current.split(":").includes(dir)) process.env.PATH = `${dir}:${current}`;
  return true;
}

/** PATH bun, else ~/.bun/bin/bun, else the pinned installer. Does not clone. */
function ensureBun() {
  if (bunAvailable()) return "bun";
  if (prependBunPath() && bunAvailable()) return bunHomeBin();
  const installer = spawnSync("bash", ["-c", BUN_INSTALL], {
    encoding: "utf8",
    timeout: 180_000,
  });
  const ready = prependBunPath() && bunAvailable();
  if (!ready) {
    const detail = spawnDetail(installer);
    if (sandboxRefusedChromium(detail))
      fail(`bun install was refused: ${detail}`, SANDBOX_BROWSE_FIX, {
        code: "browse-sandboxed",
        exitCode: 1,
      });
    fail(
      `bun is required to build the browse binary, and the installer did not produce ${join(process.env.HOME ?? "", ".bun/bin/bun")}: ${detail}`,
      BUN_MISSING_FIX,
      { code: "bun-missing", exitCode: 1 },
    );
  }
  return bunHomeBin() ?? "bun";
}

function playwrightCacheDir() {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override !== "0") return override;
  const home = process.env.HOME;
  if (!home) return null;
  if (process.platform === "darwin") return join(home, "Library/Caches/ms-playwright");
  if (process.platform === "win32") return join(home, "AppData/Local/ms-playwright");
  return join(home, ".cache/ms-playwright");
}

/** True when a Playwright chromium headless shell directory has a browser build in it. */
function chromiumHeadlessPresent() {
  const root = playwrightCacheDir();
  if (!root || !existsSync(root)) return false;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith("chromium_headless_shell-")) return false;
    let nested;
    try {
      nested = readdirSync(join(root, entry.name));
    } catch {
      return false;
    }
    return nested.some((name) => name === "headless_shell" || name.startsWith("chrome-"));
  });
}

function installPlaywrightChromium() {
  if (chromiumHeadlessPresent()) return { present: true, installed: false };
  const bun = ensureBun();
  const result = spawnSync(bun, ["x", "playwright@1.58.2", "install", "chromium"], {
    encoding: "utf8",
    timeout: 600_000,
  });
  const detail = spawnDetail(result);
  if (sandboxRefusedChromium(detail))
    fail(`Playwright Chromium install was refused: ${detail}`, SANDBOX_BROWSE_FIX, {
      code: "browse-sandboxed",
      exitCode: 1,
    });
  if (result.status !== 0 || !chromiumHeadlessPresent())
    fail(
      `Playwright Chromium headless shell is missing after \`${PLAYWRIGHT_CHROMIUM}\`: ${detail}`,
      CHROMIUM_MISSING_FIX,
      { code: "chromium-missing", exitCode: 1 },
    );
  return { present: true, installed: true };
}

function failInstall(detail, fallback) {
  if (sandboxRefusedChromium(detail))
    fail(`browse install was refused: ${detail}`, SANDBOX_BROWSE_FIX, {
      code: "browse-sandboxed",
      exitCode: 1,
    });
  fail(fallback, `read the message above and rerun \`${SELF} browser install\``, {
    code: "browse-install-failed",
    exitCode: 1,
  });
}

/** Clone gstack when needed and run ./setup. Caller has already ensured bun. */
function buildBrowse() {
  const root = gstackRoot();
  const setup = join(root, "setup");
  if (!existsSync(setup)) {
    if (existsSync(root))
      fail(
        `${root} exists but has no setup script`,
        `remove ${root} and rerun \`${SELF} browser install\``,
        { code: "browse-install-failed", exitCode: 1 },
      );
    mkdirSync(dirname(root), { recursive: true });
    const clone = spawnSync(
      "git",
      ["clone", "--depth", "1", "https://github.com/garrytan/gstack.git", root],
      { encoding: "utf8", timeout: 180_000 },
    );
    if (clone.status !== 0)
      failInstall(spawnDetail(clone), `git clone of gstack failed: ${spawnDetail(clone)}`);
  }

  const built = spawnSync(setup, [], { cwd: root, encoding: "utf8", timeout: 600_000 });
  if (built.status !== 0 || !existsSync(browseCanonical()))
    failInstall(
      spawnDetail(built),
      `gstack setup did not produce ${browseCanonical()}: ${spawnDetail(built)}`,
    );
  return browseCanonical();
}

function browseInstallPlan() {
  const existing = existingBrowseBin();
  const bun = bunAvailable() || Boolean(bunHomeBin());
  const chromium = chromiumHeadlessPresent();
  if (existing && chromium) return { already: true, bin: existing, bun, chromium: true, steps: [] };
  const steps = [];
  if (!existing) {
    if (!bun)
      steps.push(
        `${BUN_INSTALL}  # the installer checks the bun-v1.3.10 checksum. Then export PATH="$HOME/.bun/bin:$PATH". The real install runs this. Do not invent a browse path.`,
      );
    const root = gstackRoot();
    if (!existsSync(join(root, "setup")))
      steps.push(`git clone --depth 1 https://github.com/garrytan/gstack.git ${root}`);
    steps.push(`${join(root, "setup")}`);
  }
  if (!chromium)
    steps.push(
      `${PLAYWRIGHT_CHROMIUM}  # only when the Playwright headless shell is missing. Skip on browse-sandboxed.`,
    );
  return {
    already: Boolean(existing),
    bin: existing ?? browseCanonical(),
    bun,
    chromium,
    codex: browseLegacy(),
    steps,
    note:
      !existing && !bun
        ? `The real install runs the bun step, then the clone. If ${browseLegacy()} already exists, that path alone is enough and no build is required.`
        : !chromium
          ? "The real install runs the pinned Playwright command when the headless shell is missing. A browse-sandboxed failure is not a missing browser."
          : undefined,
  };
}

function commandBrowserInstall() {
  const existing = existingBrowseBin();
  let bin = existing;
  if (!bin) {
    ensureBun();
    bin = buildBrowse();
  }
  const chromium = installPlaywrightChromium();
  print({ installed: true, already: Boolean(existing), bin, chromium });
  return 0;
}

/** A preview bypass secret rides in the URL; never let it reach output. */
function redact(value) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? String(value).split(secret).join("<redacted>") : String(value);
}

function runBrowse(args) {
  // The browse binary starts its server by spawning `bun` from PATH. Install
  // puts ~/.bun/bin on PATH only for that process; later browser commands
  // must do it again or open fails with ENOENT even after a successful install.
  prependBunPath();
  const bin = browseBin();
  if (!existsSync(bin))
    fail(
      `browse is not installed at ${bin}`,
      process.env.LAVEGA_BROWSE_BIN
        ? `LAVEGA_BROWSE_BIN points at a missing file. Unset it, or run \`${SELF} browser install\``
        : `run \`${SELF} browser install\` to build ${browseCanonical()}, or use the Codex binary at ${browseLegacy()} (that path alone is enough)`,
      {
        code: "browse-missing",
        exitCode: 1,
      },
    );
  const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    const detail = [result.error.code, result.error.message].filter(Boolean).join(" ");
    if (sandboxRefusedChromium(detail))
      fail(`browse failed to start: ${result.error.message}`, SANDBOX_BROWSE_FIX, {
        code: "browse-sandboxed",
        exitCode: 1,
      });
    fail(
      `browse failed to start: ${result.error.message}`,
      "check LAVEGA_BROWSE_BIN is executable",
      {
        code: "browse-failed",
        exitCode: 1,
      },
    );
  }
  // browse colours its own log lines; colour codes are noise inside JSON.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const clean = (text) =>
    redact(text ?? "")
      .replace(ansi, "")
      .trimEnd();
  const stderr = [clean(result.stderr), result.signal ? `signal ${result.signal}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    args: args.map(redact),
    exitCode: result.status ?? 1,
    output: clean(result.stdout),
    stderr: stderr || undefined,
  };
}

/**
 * Workspace-write sandboxes refuse the Mach-port / process ops Chromium needs.
 * The process then dies with EPERM, PortRendezvous, or a target closed on launch.
 * That is the sandbox, so the fix is to re-run the browser step outside it.
 */
const SANDBOX_BROWSE_FIX =
  "re-run this browser step escalated or unrestricted, outside the sandbox (Codex: escalate or disable the sandbox for this step). Doctor, probe, and API commands can stay sandboxed. Do not reinstall Chromium.";

/** Printed by `browser --help` and every browser subcommand `--help`. */
const BROWSER_SANDBOX_HELP =
  'Under a Codex workspace-write sandbox, or any shell sandbox, escalate or unrestrict before `browser install`, `browser open`, `browser snapshot`, `browser click`, `browser screenshot`, and every other browser subcommand. On PortRendezvous, EPERM, SIGTRAP, Permission denied, or target-closed ("Target page, context or browser has been closed"), that is `browse-sandboxed`: escalate and retry. Do not reinstall Chromium.';

function sandboxRefusedChromium(text) {
  return /EPERM|PortRendezvous|Permission denied|SIGTRAP|Target page, context or browser has been closed/i.test(
    text,
  );
}

function browseOutputText(step) {
  return `${step.output ?? ""}\n${step.stderr ?? ""}`;
}

/* Chromium not installed is the one failure every fresh machine hits. */
function browseFix(step) {
  const text = browseOutputText(step);
  if (/Path must be within/i.test(text)) return PNG_PATH_FIX;
  if (/Executable doesn't exist|playwright install/i.test(text))
    return "install the pinned Chromium once: bunx playwright@1.58.2 install chromium";
  if (/Executable not found in \$PATH:\s*"bun"|ENOENT[\s\S]*spawn bun/i.test(text))
    return `browse starts its server with bun from PATH. This CLI prepends ~/.bun/bin when that file exists. If it is absent, run \`${SELF} browser install\`.`;
  if (sandboxRefusedChromium(text)) return SANDBOX_BROWSE_FIX;
  if (/no (element|match)|not found|timeout/i.test(text))
    return `take a fresh \`${SELF} browser snapshot --interactive\` and use an @e ref from it`;
  return undefined;
}

/** Sandbox deaths go through `error.fix`. A missing binary stays `browse-missing`. */
function failIfSandboxRefused(step) {
  if (step.exitCode === 0) return;
  const text = browseOutputText(step);
  if (/Path must be within|Executable doesn't exist|playwright install/i.test(text)) return;
  if (!sandboxRefusedChromium(text)) return;
  const detail = (step.stderr || step.output || "browse exited non-zero").trim().slice(0, 400);
  fail(`browse failed: ${detail}`, SANDBOX_BROWSE_FIX, {
    code: "browse-sandboxed",
    exitCode: 1,
  });
}

function browseAndPrint(args, extra = {}) {
  const step = runBrowse(args);
  failIfSandboxRefused(step);
  const ok = step.exitCode === 0;
  print({
    ok,
    browse: step.args,
    output: step.output,
    stderr: step.stderr,
    ...extra,
    fix: ok ? undefined : browseFix(step),
  });
  return ok ? 0 : 1;
}

function withQuery(url, query) {
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function browserUrl(flags, path) {
  const base = baseUrl(flags);
  /* Vercel sets its own bypass cookie when the first request carries the
   * secret, so every later navigation in the browser passes Deployment
   * Protection. */
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const bypassQuery =
    bypass && targetName(flags) === "preview"
      ? `x-vercel-protection-bypass=${encodeURIComponent(bypass)}&x-vercel-set-bypass-cookie=true`
      : "";
  return withQuery(`${base}${path}`, bypassQuery);
}

function cookiesForBrowser(flags) {
  const base = baseUrl(flags);
  const host = new URL(base).host;
  return loadCookies(flags)
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
}

/**
 * Open the investing SPA in gstack's Chromium, carrying the CLI session. The
 * `verify=1` query puts the app in verification mode, which stops the
 * app-open effect from starting a broker or price sync. Never prints cookie
 * values.
 */
function commandBrowserOpen({ flags }) {
  const path = flags.path ? String(flags.path) : spaPath(flags);
  const url = browserUrl(flags, withQuery(path, "verify=1"));
  const steps = [];
  const step = (args) => {
    const result = runBrowse(args);
    steps.push({
      browse: result.args,
      exitCode: result.exitCode,
      output: result.output || undefined,
    });
    if (result.exitCode !== 0) {
      failIfSandboxRefused(result);
      print({ ok: false, url: redact(url), steps, stderr: result.stderr, fix: browseFix(result) });
      return false;
    }
    return true;
  };

  let imported = 0;
  if (targetName(flags) !== "local") {
    const cookies = cookiesForBrowser(flags);
    if (cookies.length === 0)
      fail(
        `no CLI session for ${new URL(baseUrl(flags)).host}`,
        `run \`${SELF} login --target ${targetName(flags)}\` first`,
        { code: "session-missing" },
      );
    ensureDirs();
    const cookieFile = join(runDir, "browser-cookies.json");
    writeFileSync(cookieFile, JSON.stringify(cookies), { mode: 0o600 });
    try {
      if (!step(["goto", url]) || !step(["cookie-import", cookieFile]) || !step(["reload"]))
        return 1;
    } finally {
      rmSync(cookieFile, { force: true });
    }
    imported = cookies.length;
  } else if (!step(["goto", url])) {
    return 1;
  }
  if (!step(["wait", "--load"])) return 1;
  print({
    ok: true,
    url: redact(url),
    page: pageUrl(flags),
    cookiesImported: imported,
    steps,
  });
  return 0;
}

function commandBrowserGoto({ flags, args }) {
  return browseAndPrint(["goto", browserUrl(flags, args[0])]);
}

function commandBrowserSnapshot({ flags }) {
  const args = ["snapshot"];
  if (flags.interactive) args.push("-i");
  if (flags.compact) args.push("-c");
  if (flags.diff) args.push("-D");
  if (flags.cursor) args.push("-C");
  if (flags.depth) args.push("-d", String(flags.depth));
  if (flags.selector) args.push("-s", String(flags.selector));
  return browseAndPrint(args);
}

/**
 * browse `validateOutputPath` (gstack browse/src/path-security.ts) allows a
 * write only under realpath(/tmp), under os.tmpdir() when that dir is not
 * `/`, `$HOME`, or a parent of the daemon cwd, or under the daemon cwd. The
 * daemon cwd is the git root from when that process started, not this shell.
 * The check realpaths the parent, and if that is missing, the grandparent
 * only. `/tmp/lavega-verify-investing/evidence/shot.png` is rejected when
 * neither directory exists, even though the path is under /tmp. Agents then
 * retry a file directly in /tmp. Create the parent here, and refuse anything
 * that is not under /tmp, so the first path is one browse accepts.
 */
const PNG_PATH_FIX = `use \`${SELF} browser screenshot --png /tmp/lavega-verify-investing/evidence/<name>.png\`. browse writes a PNG only under /tmp (after realpath) or the daemon git root from when that daemon started — not this shell's cwd, not the repo, not $TMPDIR, and not os.tmpdir() when that is outside /tmp. A path under /tmp is also rejected when its parent directory does not exist, because browse realpaths only one level up. This command creates /tmp/lavega-verify-investing/evidence before it calls browse. Do not retry a different folder.`;

function tmpRootReal() {
  try {
    return realpathSync("/tmp");
  } catch {
    return "/tmp";
  }
}

function pathWithin(child, parent) {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

/** Absolute path after walking to an existing ancestor. Null when not under /tmp. */
function locateUnderTmp(filePath) {
  const absolute = resolve(String(filePath));
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  let real;
  try {
    real = realpathSync(current);
  } catch {
    return null;
  }
  const suffix = absolute.slice(current.length).replace(/^[/\\]/, "");
  const full = suffix ? join(real, suffix) : real;
  if (!pathWithin(full, tmpRootReal())) return null;
  return { absolute, full };
}

/** Evidence dir when it is under /tmp; otherwise the fixed /tmp evidence dir. */
function pngDirectory() {
  return locateUnderTmp(join(evidenceDir, "shot.png")) ? evidenceDir : SCREENSHOT_EVIDENCE;
}

function assertPngPath(filePath) {
  const located = locateUnderTmp(filePath);
  if (!located)
    fail(`screenshot path rejected: ${resolve(String(filePath))}`, PNG_PATH_FIX, {
      code: "path-rejected",
    });
  return located;
}

function preparePngPath(filePath) {
  const located = assertPngPath(filePath);
  mkdirSync(dirname(located.absolute), { recursive: true });
  return located.absolute;
}

/** PNG path. Global `--out` is the JSON dump and must not be this file. */
function screenshotPath(flags) {
  if (flags.png) return resolve(String(flags.png));
  return join(pngDirectory(), `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
}

function commandBrowserScreenshot({ flags }) {
  ensureDirs();
  const out = screenshotPath(flags);
  if (outputPath && resolve(out) === outputPath)
    fail(
      "--png and --out point at the same file",
      "pass --png for the PNG and --out for the JSON dump, as two different paths under /tmp/lavega-verify-investing/evidence",
      { code: "flag-invalid" },
    );
  preparePngPath(out);
  const args = ["screenshot"];
  if (flags.viewport) args.push("--viewport");
  if (flags.selector) args.push(String(flags.selector));
  args.push(out);
  return browseAndPrint(args, { saved: out });
}

/** `browser raw` paths that browse will validate. `mkdir` only on a real run. */
function rawOutputPaths(args, mkdir) {
  const apply = mkdir ? preparePngPath : (file) => assertPngPath(file).absolute;
  const command = args[0];
  if (command === "snapshot") {
    for (let index = 1; index < args.length; index += 1) {
      if (args[index] === "-o" || args[index] === "--output") {
        const file = args[index + 1];
        if (file && !file.startsWith("-")) apply(expandHome(file));
      }
    }
    return;
  }
  if (command !== "screenshot" && command !== "pdf" && command !== "prettyscreenshot") return;
  let skipNext = false;
  for (const arg of args.slice(1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (
      arg === "--selector" ||
      arg === "--clip" ||
      arg === "--scroll-to" ||
      arg === "--hide" ||
      arg === "--width" ||
      arg === "--format"
    ) {
      skipNext = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    const isPath = arg.includes("/") || arg.startsWith("~") || /\.(png|jpe?g|webp|pdf)$/i.test(arg);
    if (!isPath) continue;
    apply(expandHome(arg));
  }
}

function expandHome(filePath) {
  if (filePath === "~") return process.env.HOME ?? filePath;
  if (filePath.startsWith("~/")) return join(process.env.HOME ?? "", filePath.slice(2));
  return filePath;
}

function commandBrowserRaw({ args }) {
  rawOutputPaths(args, true);
  return browseAndPrint(args);
}

function commandBrowserConsole({ flags }) {
  const args = ["console"];
  if (flags.errors) args.push("--errors");
  if (flags.clear) args.push("--clear");
  return browseAndPrint(args);
}

function commandBrowserNetwork({ flags }) {
  return browseAndPrint(flags.clear ? ["network", "--clear"] : ["network"]);
}

function commandBrowserWaitSettle({ flags }) {
  return browseAndPrint(["wait", flags.selector ? String(flags.selector) : "--networkidle"]);
}

// ---------------------------------------------------------------- command registry

const TARGET_FLAGS = {
  target: {
    type: "string",
    values: ["local", "prod", "preview"],
    description:
      "local (default), prod (https://www.lavega.dev), or preview (newest deploy unless --base/LAVEGA_PREVIEW_URL)",
  },
  base: { type: "string", description: "a deploy URL; implies --target preview" },
  port: { type: "number", description: "local port (default: the port `up` recorded, else 8799)" },
};

const GLOBAL_FLAGS = {
  ...TARGET_FLAGS,
  help: { type: "boolean", description: "show help for this command" },
  json: { type: "boolean", description: "with --help: print the help as JSON" },
};

/* What `--dry-run` and the prod guard key off. Every effect gets --dry-run;
 * only `remote-write` is refused on prod without --allow-prod-write. */
const EFFECTS = {
  "remote-write": "writes on the target (broker, vault, price store, or tenant rows)",
  "local-destructive": "stops a process or deletes local state",
  "local-install":
    "installs pinned bun when it is missing, builds the browse binary under the home directory, and installs pinned Playwright Chromium when the headless shell is missing",
  "browser-action": "acts in the page; the app may send writes the way a user click would",
};

const COMMANDS = [
  // Instance
  {
    name: "info",
    group: "Instance",
    summary: "Show target, local instance, sessions and tool paths (no network)",
    run: commandInfo,
    examples: ["info", "info --target prod"],
  },
  {
    name: "preview",
    group: "Instance",
    summary: "Show or move the pinned preview deploy (--refresh, --branch)",
    description:
      "--target preview with no --base and no LAVEGA_PREVIEW_URL uses the pinned deploy. Nothing pinned: the first preview command pins the newest READY preview (vercel ls). --refresh re-pins the newest; --branch pins the newest for that git branch. A new host needs a new login.",
    flags: {
      refresh: { type: "boolean", description: "pin the newest READY preview" },
      branch: { type: "string", description: "pin the newest READY preview of this git branch" },
    },
    run: commandPreview,
    examples: ["preview", "preview --refresh", "preview --branch my-feature"],
  },
  {
    name: "up",
    group: "Instance",
    summary: "Start the local investing-server and wait for /health",
    flags: {
      data: {
        type: "string",
        description: "data directory for the JSON stores (default: run/data)",
      },
    },
    run: commandUp,
    examples: ["up", "up --port 8800 --data /tmp/lavega-verify-investing/run/data-b"],
  },
  {
    name: "down",
    group: "Instance",
    summary: "Stop only the instance this CLI started",
    effect: "local-destructive",
    plan: () => ({ kill: recordedPid(), alive: isAlive(recordedPid()) }),
    run: commandDown,
    examples: ["down --dry-run", "down"],
  },
  {
    name: "restart",
    group: "Instance",
    summary: "Stop and start the local instance on the same port and data",
    flags: { data: { type: "string", description: "data directory (default: the one `up` used)" } },
    effect: "local-destructive",
    plan: ({ flags }) => ({
      kill: recordedPid(),
      start: { port: localPort(flags), data: flags.data ?? recordedDataDir() },
    }),
    run: commandRestart,
    examples: ["restart"],
  },
  {
    name: "cleanup",
    group: "Instance",
    summary: "down, then remove run state; keep evidence",
    effect: "local-destructive",
    plan: () => ({ kill: recordedPid(), remove: runDir, keep: evidenceDir }),
    run: commandCleanup,
    examples: ["cleanup --dry-run", "cleanup"],
  },
  {
    name: "watch",
    group: "Instance",
    summary: "Emit a JSON line per up/down change of the local instance",
    description:
      "Runs until --timeout (forever without it). Run it in the background while editing server code; with --restart it restarts the instance when /health stops answering.",
    flags: {
      restart: { type: "boolean", description: "restart the instance when it goes down" },
      interval: { type: "number", description: "poll interval in ms (default 5000)" },
      timeout: { type: "number", description: "stop after this many ms" },
    },
    run: commandWatch,
    examples: ["watch --restart", "watch --timeout 60000"],
  },
  {
    name: "logs",
    group: "Instance",
    summary: "Tail the local server log",
    flags: { lines: { type: "number", description: "lines to show (default 40)" } },
    run: commandLogs,
    examples: ["logs --lines 100"],
  },
  {
    name: "evidence",
    group: "Instance",
    summary: "Print where proof is kept",
    run: commandEvidence,
  },

  // Health
  {
    name: "doctor",
    group: "Health",
    summary: "Is this instance worth driving? Exits 1 on any failed check",
    run: commandDoctor,
    examples: ["doctor", "doctor --target prod", "doctor --target preview"],
  },
  {
    name: "probe",
    group: "Health",
    summary: "Sweep every read-only endpoint; sort failures by kind",
    flags: {
      verbose: { type: "boolean", description: "include every response body" },
      out: {
        type: "string",
        description: "save the report, including each response body, to this file",
      },
    },
    run: commandProbe,
    examples: ["probe --target prod --out /tmp/lavega-verify-investing/evidence/prod-probe.json"],
  },
  {
    name: "assets",
    group: "Health",
    summary: "Fetch the SPA shell and check every asset it references",
    flags: {
      path: { type: "string", description: "shell path (default: / local, /investing/ mounted)" },
    },
    run: commandAssets,
    examples: ["assets --target prod"],
  },
  {
    name: "perf",
    group: "Health",
    summary: "Time the dashboard reads: min/p50/p95/max per endpoint",
    flags: {
      runs: { type: "number", description: "requests per endpoint (default 5)" },
      path: {
        type: "string",
        description: "comma-separated paths (default: dashboard,summary,benchmarks)",
      },
    },
    run: commandPerf,
    examples: ["perf --target prod --runs 10", "perf --path /api/investing/dashboard"],
  },

  // Session
  {
    name: "login",
    group: "Session",
    summary: "Sign in on prod or preview; stores a cookie jar per host",
    description: `Credential order: a readable ${previewCredentialsFile} (preview) or ${credentialsFile} (prod), then LAVEGA_VERIFY_EMAIL and LAVEGA_VERIFY_PASSWORD already in the process, then on preview \`vercel env pull --environment preview\` (those names are in the Vercel project Config for development, preview, and production), then --email and --password. Do not write auth.preview.json under /tmp. A file there is not shared with the next agent. Do not ask for a personal password. Do not invent an account or sign one up. The JSON field page is the preview URL the user opens.`,
    flags: {
      "credentials-file": {
        type: "string",
        description: 'a JSON file {"email":"...","password":"..."}',
      },
      email: { type: "string", description: "email (prefer the credentials file)" },
      password: {
        type: "string",
        description: "password (lands in shell history; prefer the file)",
      },
    },
    run: commandLogin,
    examples: ["login --target prod", "login --target preview"],
  },
  {
    name: "whoami",
    group: "Session",
    summary: "Show the session user: authenticated, anonymous or unconfigured",
    run: commandWhoami,
    examples: ["whoami --target prod"],
  },
  {
    name: "logout",
    group: "Session",
    summary: "Delete the cookie jar for this target's host",
    effect: "local-destructive",
    plan: ({ flags }) => ({ remove: cookieFileFor(flags) }),
    run: commandLogout,
  },

  // Read
  {
    name: "dashboard",
    group: "Read",
    summary: "Read the dashboard the way the frontend does; summarise its shape",
    flags: {
      symbol: { type: "string", description: "dashboard for one symbol" },
      raw: { type: "boolean", description: "print the full payload" },
    },
    run: commandDashboard,
    examples: ["dashboard --target prod", "dashboard --symbol AAPL --raw"],
  },
  {
    name: "summary",
    group: "Read",
    summary: "Read /api/investing/summary",
    run: commandSummary,
  },
  {
    name: "sync-status",
    group: "Read",
    summary: "Broker sync, price sync and vault status in one call",
    run: commandSyncStatus,
  },
  {
    name: "wait-settle",
    group: "Read",
    summary: "Poll broker and price sync until both stop working",
    flags: {
      broker: { type: "boolean", description: "wait for the broker sync only" },
      prices: { type: "boolean", description: "wait for the price sync only" },
      timeout: { type: "number", description: "give up after this many ms (default 120000)" },
      interval: { type: "number", description: "poll interval in ms (default 1000)" },
    },
    run: commandWaitSettle,
    examples: ["wait-settle --target preview", "wait-settle --prices --timeout 300000"],
  },
  {
    name: "consent",
    group: "Read",
    summary: "Read market-data consent; --accept writes it",
    description:
      "GET reads the decision. --accept PUTs {accepted:true} and stores it. That write does not call Yahoo. The JSON field next is the path the Allow Yahoo Finance button runs after a successful accept: sync --wait, then prices sync --wait, then wait-settle, then dashboard. A 428 from prices sync or benchmark search means consent is still missing.",
    flags: {
      accept: {
        type: "boolean",
        description: "accept consent (lets the server call Yahoo Finance)",
      },
      version: { type: "string", description: "disclosure version to accept" },
    },
    effect: "remote-write",
    effectWhen: ({ flags }) => Boolean(flags.accept),
    plan: ({ flags }) => ({
      method: "PUT",
      url: `${baseUrl(flags)}/api/market-data/consent`,
      body: { accepted: true },
      next: postAllowNext(true),
    }),
    run: commandConsent,
    examples: ["consent", "consent --accept --dry-run", "consent --accept"],
  },
  {
    name: "api",
    group: "Read",
    summary: "Call any route with the session: api <METHOD> <path>",
    description: "The escape hatch for anything not wrapped. Any method but GET is a remote write.",
    args: [
      { name: "method", required: true, values: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { name: "path", required: true, description: "starts with /" },
    ],
    flags: { body: { type: "string", description: "JSON request body" } },
    effect: "remote-write",
    effectWhen: ({ args }) => args[0].toUpperCase() !== "GET",
    plan: ({ flags, args }) => ({
      method: args[0].toUpperCase(),
      url: `${baseUrl(flags)}${args[1]}`,
      body: parseBody(flags),
    }),
    run: commandApi,
    examples: [
      "api GET /api/investing/benchmarks --target prod",
      `api PUT /api/investing/benchmarks --target preview --body '{"symbols":["^GSPC"]}'`,
    ],
  },

  // Write
  {
    name: "sync",
    group: "Write",
    summary: "Start a broker sync; --wait polls until it settles",
    description: "Posts the same route the Start sync button posts to.",
    flags: {
      force: { type: "boolean", description: "sync even if the last run is recent" },
      wait: { type: "boolean", description: "poll sync status until it settles" },
      timeout: {
        type: "number",
        description: "with --wait: give up after this many ms (default 120000)",
      },
    },
    effect: "remote-write",
    plan: ({ flags }) => ({
      method: "POST",
      url: `${baseUrl(flags)}/api/brokers/sync${flags.force ? "?force=true" : ""}`,
      note: "a real sync calls the broker API and writes the vault",
    }),
    run: commandSync,
    examples: ["sync --target preview --force --wait", "sync --dry-run"],
  },
  {
    name: "unlock",
    group: "Write",
    summary: "Unlock the credential vault with the user's passphrase",
    flags: {
      passphrase: {
        type: "string",
        required: true,
        description: "the vault key is derived from it; nothing else opens the vault",
      },
    },
    effect: "remote-write",
    plan: ({ flags }) => ({
      method: "POST",
      url: `${baseUrl(flags)}/api/brokers/credentials/unlock`,
      body: { passphrase: "<redacted>" },
    }),
    run: commandUnlock,
    examples: ["unlock --target preview --passphrase <passphrase>"],
  },
  {
    name: "prices status",
    group: "Write",
    summary: "Same as sync-status",
    run: commandSyncStatus,
  },
  {
    name: "prices sync",
    group: "Write",
    summary: "Fetch prices from Yahoo Finance into the price store",
    description:
      "One POST is one slice. 202 or status paused/running/waiting means symbols remain: run --wait. --wait keeps posting /api/prices/sync until completed or problem (40 rounds, the SPA cap). This is the continuation after consent --accept. 428 means consent is missing; the fix names consent --accept. --force refetches recent bars.",
    flags: {
      force: { type: "boolean", description: "refetch even recent bars" },
      wait: {
        type: "boolean",
        description:
          "keep posting /api/prices/sync while status is paused, running, or waiting (the post-allow continuation)",
      },
      timeout: {
        type: "number",
        description: "with --wait: give up after this many ms (default 300000)",
      },
      rounds: {
        type: "number",
        description: "with --wait: maximum POSTs (default 40, same cap as the SPA)",
      },
    },
    effect: "remote-write",
    plan: ({ flags }) => ({
      method: "POST",
      url: `${baseUrl(flags)}/api/prices/sync${flags.force ? "?force=true" : ""}`,
      repeat: Boolean(flags.wait),
      note: flags.wait
        ? "repeats POST /api/prices/sync while status is paused, running, or waiting. This is the continuation Allow Yahoo Finance starts after consent."
        : "one slice. 202 or paused means run prices sync --wait. 428 means consent is missing.",
    }),
    run: commandPricesSync,
    examples: ["prices sync --dry-run", "prices sync --wait", "prices sync --force"],
  },
  {
    name: "prices purge",
    group: "Write",
    summary: "Delete every cached price bar (needs --yes)",
    flags: { yes: { type: "boolean", description: "confirm the purge" } },
    effect: "remote-write",
    plan: ({ flags }) => ({ method: "DELETE", url: `${baseUrl(flags)}/api/prices/cache` }),
    run: commandPricesPurge,
    examples: ["prices purge --dry-run", "prices purge --yes"],
  },

  // Browser
  {
    name: "browser install",
    group: "Browser",
    summary: "Install bun if needed, ensure a browse binary, then pinned Chromium",
    description:
      'Idempotent. If LAVEGA_BROWSE_BIN, ~/.claude/skills/gstack/browse/dist/browse, or ~/.codex/skills/gstack/browse/dist/browse already exists, already:true and the binary stays. The Codex path alone is enough; install does not create the Claude path in that case. Otherwise it installs bun when bun is missing by running `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10"` (that installer checks the checksum), puts ~/.bun/bin on PATH, clones https://github.com/garrytan/gstack into ~/.claude/skills/gstack, and runs ./setup. Then, only when the Playwright headless shell is missing, it runs `bunx playwright@1.58.2 install chromium`. --dry-run prints those steps and changes nothing. bun-missing means the installer failed (message has the blocker: curl, network, or checksum). chromium-missing means the pinned Playwright command failed. browse-sandboxed means escalate and rerun this command; do not reinstall Chromium for that. Do not invent a path. Visual checks stay verified-unreachable until installed:true and browser open exits 0.',
    effect: "local-install",
    plan: browseInstallPlan,
    run: commandBrowserInstall,
    examples: ["browser install", "browser install --dry-run"],
  },
  {
    name: "browser open",
    group: "Browser",
    summary: "Open the SPA in gstack Chromium with the CLI session, in verify mode",
    flags: {
      path: { type: "string", description: "SPA path (default: / local, /investing/ mounted)" },
    },
    run: commandBrowserOpen,
    examples: ["browser open", "browser open --target prod", "browser open --target preview"],
  },
  {
    name: "browser goto",
    group: "Browser",
    summary: "Navigate to a path on the target origin",
    args: [{ name: "path", required: true, description: "starts with /" }],
    run: commandBrowserGoto,
    examples: ["browser goto /investing/?verify=1 --target prod"],
  },
  {
    name: "browser snapshot",
    group: "Browser",
    summary: "Accessibility tree with @e refs to click",
    flags: {
      interactive: { type: "boolean", description: "interactive elements only" },
      compact: { type: "boolean", description: "compact output" },
      diff: { type: "boolean", description: "diff against the previous snapshot" },
      cursor: { type: "boolean", description: "also find non-ARIA clickables (@c refs)" },
      depth: { type: "number", description: "max tree depth" },
      selector: { type: "string", description: "scope to this CSS selector" },
    },
    run: commandBrowserSnapshot,
    examples: ["browser snapshot --interactive", "browser snapshot --diff"],
  },
  {
    name: "browser screenshot",
    group: "Browser",
    summary: "Save a PNG under /tmp evidence (or --png). --out is the JSON dump",
    description:
      "The PNG must be under /tmp. Default is evidence/screenshot-<time>.png when that evidence directory is under /tmp, and /tmp/lavega-verify-investing/evidence/screenshot-<time>.png when VERIFY_INVESTING_DIR is not. This command creates the directory before browse runs. browse rejects a repo path, this shell's cwd, $TMPDIR, and os.tmpdir() outside /tmp, and it also rejects a /tmp path whose parent directory does not exist (it realpaths only one level). --png sets the image path. --out writes this command's JSON and must be a different path; it does not replace the PNG. browser raw -- screenshot <path> uses the same /tmp rule. Do not retry a different folder.",
    flags: {
      png: {
        type: "string",
        description:
          "PNG path under /tmp (default: /tmp/lavega-verify-investing/evidence/screenshot-<time>.png when the state dir is outside /tmp). Not --out",
      },
      out: {
        type: "string",
        description:
          "write this command's JSON here. Must differ from --png. Does not set the PNG path",
      },
      selector: { type: "string", description: "element or @ref to capture" },
      viewport: { type: "boolean", description: "viewport only, not the full page" },
    },
    run: commandBrowserScreenshot,
    examples: [
      "browser screenshot",
      "browser screenshot --selector @e4 --png /tmp/lavega-verify-investing/evidence/chart.png",
    ],
  },
  {
    name: "browser text",
    group: "Browser",
    summary: "Visible page text",
    run: () => browseAndPrint(["text"]),
  },
  {
    name: "browser console",
    group: "Browser",
    summary: "Console messages since the last clear",
    flags: {
      errors: { type: "boolean", description: "errors only" },
      clear: { type: "boolean", description: "clear after reading" },
    },
    run: commandBrowserConsole,
    examples: ["browser console --errors"],
  },
  {
    name: "browser network",
    group: "Browser",
    summary: "Requests the page made since the last clear",
    flags: { clear: { type: "boolean", description: "clear after reading" } },
    run: commandBrowserNetwork,
  },
  {
    name: "browser perf",
    group: "Browser",
    summary: "Page performance metrics",
    run: () => browseAndPrint(["perf"]),
  },
  {
    name: "browser click",
    group: "Browser",
    summary: "Click a selector or @ref from snapshot",
    args: [{ name: "selector", required: true }],
    effect: "browser-action",
    plan: ({ args }) => ({ browse: ["click", args[0]] }),
    run: ({ args }) => browseAndPrint(["click", args[0]]),
    examples: ["browser click @e3"],
  },
  {
    name: "browser fill",
    group: "Browser",
    summary: "Fill an input",
    args: [
      { name: "selector", required: true },
      { name: "value", required: true },
    ],
    effect: "browser-action",
    plan: ({ args }) => ({ browse: ["fill", args[0], args[1]] }),
    run: ({ args }) => browseAndPrint(["fill", args[0], args[1]]),
    examples: ['browser fill @e4 "AAPL"'],
  },
  {
    name: "browser type",
    group: "Browser",
    summary: "Type text into the focused element",
    args: [{ name: "text", required: true }],
    effect: "browser-action",
    plan: ({ args }) => ({ browse: ["type", args[0]] }),
    run: ({ args }) => browseAndPrint(["type", args[0]]),
  },
  {
    name: "browser press",
    group: "Browser",
    summary: "Press a key (Enter, Escape, Tab, ...)",
    args: [{ name: "key", required: true }],
    effect: "browser-action",
    plan: ({ args }) => ({ browse: ["press", args[0]] }),
    run: ({ args }) => browseAndPrint(["press", args[0]]),
  },
  {
    name: "browser scroll",
    group: "Browser",
    summary: "Scroll the page, or a selector into view",
    args: [{ name: "selector", required: false }],
    run: ({ args }) => browseAndPrint(args[0] ? ["scroll", args[0]] : ["scroll"]),
  },
  {
    name: "browser eval",
    group: "Browser",
    summary: "Evaluate a JavaScript expression in the page",
    args: [{ name: "expression", required: true }],
    effect: "browser-action",
    plan: ({ args }) => ({ browse: ["js", args[0]] }),
    run: ({ args }) => browseAndPrint(["js", args[0]]),
    examples: ['browser eval "document.title"'],
  },
  {
    name: "browser wait-settle",
    group: "Browser",
    summary: "Wait for network idle, or for a selector to appear",
    flags: { selector: { type: "string", description: "wait for this selector instead" } },
    run: commandBrowserWaitSettle,
  },
  {
    name: "browser stop",
    group: "Browser",
    summary: "Stop the browse server",
    effect: "local-destructive",
    plan: () => ({ browse: ["stop"] }),
    run: () => browseAndPrint(["stop"]),
  },
  {
    name: "browser raw",
    group: "Browser",
    summary: "Pass arguments straight to browse: browser raw -- <args>",
    description:
      "The escape hatch for browse commands not wrapped here; run `browse --help` for the list. screenshot, pdf, prettyscreenshot, and snapshot -o paths must be under /tmp. The command creates the parent directory. A repo path or $TMPDIR path is path-rejected before browse runs.",
    args: [{ name: "args", required: true, variadic: true }],
    effect: "browser-action",
    plan: ({ args }) => {
      rawOutputPaths(args, false);
      return { browse: args };
    },
    run: commandBrowserRaw,
    examples: ["browser raw -- is visible @e3", "browser raw -- viewport 390x844"],
  },
];

const COMMAND_BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));
const GROUP_PREFIXES = [
  ...new Set(COMMANDS.filter((c) => c.name.includes(" ")).map((c) => c.name.split(" ")[0])),
];

function flagsOf(command) {
  const flags = { ...GLOBAL_FLAGS, ...command.flags };
  if (!flags.out)
    flags.out = {
      type: "string",
      description: "write this command's JSON to this file as well as stdout",
    };
  if (command.effect)
    flags["dry-run"] = { type: "boolean", description: "print what would happen; change nothing" };
  if (command.effect === "remote-write")
    flags["allow-prod-write"] = {
      type: "boolean",
      description: "permit this write on --target prod (user's go-ahead only)",
    };
  return flags;
}

const BOOLEAN_FLAGS = new Set(
  COMMANDS.flatMap((command) =>
    Object.entries(flagsOf(command))
      .filter(([, spec]) => spec.type === "boolean")
      .map(([name]) => name),
  ),
);

// ---------------------------------------------------------------- help

function usageLine(command) {
  const args = (command.args ?? [])
    .map((arg) => {
      const label = arg.variadic ? `${arg.name}...` : arg.name;
      return arg.required ? `<${label}>` : `[${label}]`;
    })
    .join(" ");
  const flags = Object.entries(command.flags ?? {})
    .map(([name, spec]) => {
      const text =
        spec.type === "boolean"
          ? `--${name}`
          : `--${name} <${spec.type === "number" ? "n" : "value"}>`;
      return spec.required ? text : `[${text}]`;
    })
    .join(" ");
  const effectFlags = command.effect
    ? command.effect === "remote-write"
      ? " [--dry-run] [--allow-prod-write]"
      : " [--dry-run]"
    : "";
  return [command.name, args, flags].filter(Boolean).join(" ") + effectFlags;
}

function browserSandboxJson() {
  return {
    code: "browse-sandboxed",
    escalate: true,
    rule: BROWSER_SANDBOX_HELP,
  };
}

function commandJson(command) {
  return {
    name: command.name,
    group: command.group,
    summary: command.summary,
    description: command.description,
    usage: usageLine(command),
    args: command.args ?? [],
    flags: command.flags ?? {},
    effect: command.effect
      ? {
          kind: command.effect,
          meaning: EFFECTS[command.effect],
          conditional: Boolean(command.effectWhen),
          dryRun: true,
          prodGuard: command.effect === "remote-write",
        }
      : null,
    examples: (command.examples ?? []).map((example) => `${SELF} ${example}`),
    ...(command.group === "Browser" ? { sandbox: browserSandboxJson() } : {}),
  };
}

function helpJson() {
  return {
    name: "control-investing",
    usage: `${SELF} <command> [args] [flags]`,
    targets: TARGET_FLAGS,
    output: "JSON on stdout; errors as {ok:false,error:{code,message,fix}} on stderr",
    exitCodes: { 0: "ok", 1: "a check or request failed", 2: "usage error or refused" },
    effects: EFFECTS,
    stateRoot,
    commands: COMMANDS.map(commandJson),
  };
}

function overviewText() {
  const groups = new Map();
  for (const command of COMMANDS) {
    const prefix = command.name.split(" ")[0];
    const collapsed = GROUP_PREFIXES.includes(prefix) && command.group === "Browser";
    if (collapsed) continue;
    if (!groups.has(command.group)) groups.set(command.group, []);
    groups.get(command.group).push([command.name, command.summary]);
  }
  groups.set("Browser", [
    [
      "browser <subcommand>",
      "drive gstack Chromium: install, open, snapshot, click, screenshot, console, ...",
    ],
  ]);
  const width = Math.max(...[...groups.values()].flat().map(([name]) => name.length)) + 2;
  const sections = [...groups]
    .map(
      ([group, rows]) =>
        `${group}\n${rows.map(([name, summary]) => `  ${name.padEnd(width)}${summary}`).join("\n")}`,
    )
    .join("\n\n");
  return `control-investing — drive the LaVega investing app for verification

Usage: ${SELF} <command> [args] [flags]

${sections}

Targets (every command)
  --target local|prod|preview   default local; preview: --base, LAVEGA_PREVIEW_URL, else the
                                pinned newest deploy (see \`preview --help\`)
  --base <url>                  a preview deploy; implies --target preview
  --port <n>                    local port

Every side effect takes --dry-run. Writes on --target prod need --allow-prod-write.
Output is JSON. Errors are JSON on stderr with a "fix". Exit: 0 ok, 1 check failed, 2 usage/refused.
More: \`<command> --help\`, \`browser --help\`, \`help --json\` (whole surface as JSON).
Evidence lives in ${evidenceDir}; PNG screenshots in ${pngDirectory()}; run state in ${runDir}.
A PNG must be under /tmp. Use /tmp/lavega-verify-investing/evidence/<name>.png.`;
}

function groupText(prefix) {
  const members = COMMANDS.filter((command) => command.name.startsWith(`${prefix} `));
  const width = Math.max(...members.map((command) => command.name.length)) + 2;
  const sandbox = prefix === "browser" ? `\n${BROWSER_SANDBOX_HELP}\n` : "";
  const jsonHint =
    prefix === "browser"
      ? ` \`${prefix} <subcommand> --help --json\` prints that escalate rule as \`sandbox\`.`
      : "";
  return `Usage: ${SELF} ${prefix} <subcommand> [args] [flags]
${sandbox}
${members.map((command) => `  ${command.name.padEnd(width)}${command.summary}`).join("\n")}

Run \`${prefix} <subcommand> --help\` for its flags.${jsonHint}`;
}

function groupJson(prefix) {
  const members = COMMANDS.filter((command) => command.name.startsWith(`${prefix} `));
  return {
    group: prefix,
    usage: `${SELF} ${prefix} <subcommand> [args] [flags]`,
    ...(prefix === "browser" ? { sandbox: browserSandboxJson() } : {}),
    commands: members.map(commandJson),
  };
}

function commandText(command) {
  const flags = flagsOf(command);
  const width = Math.max(...Object.keys(flags).map((name) => name.length)) + 4;
  const lines = [
    `${command.name} — ${command.summary}`,
    "",
    `Usage: ${SELF} ${usageLine(command)}`,
  ];
  if (command.description) lines.push("", command.description);
  if (command.group === "Browser") lines.push("", BROWSER_SANDBOX_HELP);
  if (command.args?.length) {
    lines.push("", "Arguments");
    for (const arg of command.args)
      lines.push(
        `  ${arg.name.padEnd(width)}${[arg.required ? "required" : "optional", arg.values ? `one of ${arg.values.join(", ")}` : null, arg.description].filter(Boolean).join("; ")}`,
      );
  }
  lines.push("", "Flags");
  for (const [name, spec] of Object.entries(flags)) {
    if (name in GLOBAL_FLAGS) continue;
    lines.push(
      `  ${`--${name}`.padEnd(width)}${spec.description}${spec.required ? " (required)" : ""}`,
    );
  }
  lines.push(`  ${"--target/--base/--port".padEnd(width)}see \`help\``);
  if (command.effect) {
    const conditional = command.effectWhen ? " (only in the form that writes)" : "";
    lines.push(
      "",
      `Side effect${conditional}: ${EFFECTS[command.effect]}.`,
      command.effect === "remote-write"
        ? "--dry-run prints the request instead. Refused on --target prod without --allow-prod-write."
        : "--dry-run prints what would happen instead.",
    );
  }
  if (command.examples?.length) {
    lines.push("", "Examples");
    for (const example of command.examples) lines.push(`  ${SELF} ${example}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- dispatch

function resolveCommand(positional) {
  const [first, second, ...rest] = positional;
  if (GROUP_PREFIXES.includes(first)) {
    if (second === undefined) return { group: first };
    const command = COMMAND_BY_NAME.get(`${first} ${second}`);
    if (command) return { command, args: rest };
    const suggestion = closest(
      second,
      COMMANDS.filter((c) => c.name.startsWith(`${first} `)).map((c) =>
        c.name.slice(first.length + 1),
      ),
    );
    fail(
      `unknown ${first} subcommand "${second}"`,
      suggestion
        ? `did you mean \`${first} ${suggestion}\`? \`${first} --help\` lists all`
        : `\`${first} --help\` lists the subcommands`,
      { code: "unknown-command" },
    );
  }
  const command = COMMAND_BY_NAME.get(first);
  if (command) return { command, args: positional.slice(1) };
  const suggestion = closest(first, [...COMMAND_BY_NAME.keys(), ...GROUP_PREFIXES]);
  fail(
    `unknown command "${first}"`,
    suggestion
      ? `did you mean \`${suggestion}\`? \`help\` lists all commands`
      : "`help` lists all commands",
    { code: "unknown-command" },
  );
}

function validate(command, flags, args) {
  const allowed = flagsOf(command);
  for (const [name, value] of Object.entries(flags)) {
    const spec = allowed[name];
    if (!spec) {
      const suggestion = closest(name, Object.keys(allowed));
      fail(
        `${command.name} has no --${name} flag`,
        suggestion
          ? `did you mean --${suggestion}? \`${command.name} --help\` lists its flags`
          : `\`${command.name} --help\` lists its flags`,
        { code: "unknown-flag" },
      );
    }
    if (spec.type !== "boolean" && value === true)
      fail(`--${name} needs a value`, `pass it as --${name} <value> or --${name}=<value>`, {
        code: "flag-value-missing",
      });
    if (spec.type === "number" && !Number.isFinite(Number(value)))
      fail(`--${name} must be a number, got "${value}"`, `example: --${name} 5000`, {
        code: "flag-invalid",
      });
    if (spec.values && !spec.values.includes(String(value)))
      fail(
        `--${name} must be one of ${spec.values.join(", ")}, got "${value}"`,
        `example: --${name} ${spec.values[0]}`,
        { code: "flag-invalid" },
      );
  }
  for (const [name, spec] of Object.entries(allowed)) {
    if (spec.required && flags[name] === undefined)
      fail(`${command.name} needs --${name}`, spec.description, { code: "flag-missing" });
  }
  const declared = command.args ?? [];
  declared.forEach((arg, index) => {
    const value = arg.variadic ? args.slice(index).join(" ") || undefined : args[index];
    if (arg.required && value === undefined)
      fail(
        `${command.name} needs <${arg.name}>`,
        `usage: ${usageLine(command)}; example: ${command.examples?.[0] ?? command.name}`,
        { code: "arg-missing" },
      );
    if (value !== undefined && arg.values && !arg.values.includes(value.toUpperCase()))
      fail(
        `<${arg.name}> must be one of ${arg.values.join(", ")}, got "${value}"`,
        `usage: ${usageLine(command)}`,
        { code: "arg-invalid" },
      );
  });
  const variadic = declared.some((arg) => arg.variadic);
  if (!variadic && args.length > declared.length)
    fail(
      `${command.name} takes ${declared.length ? declared.map((arg) => `<${arg.name}>`).join(" ") : "no arguments"}, got extra "${args.slice(declared.length).join(" ")}"`,
      `usage: ${usageLine(command)}; quote values that contain spaces`,
      { code: "arg-extra" },
    );
}

async function main(argv) {
  const { positional, flags } = parseArgs(argv, BOOLEAN_FLAGS);
  if (positional.length === 0 || positional[0] === "help") {
    const topic = positional.slice(1);
    if (topic.length > 0) {
      const resolved = resolveCommand(topic);
      if (resolved.group) {
        if (flags.json) print(groupJson(resolved.group));
        else console.log(groupText(resolved.group));
      } else if (flags.json) print(commandJson(resolved.command));
      else console.log(commandText(resolved.command));
      return 0;
    }
    if (flags.json) print(helpJson());
    else console.log(overviewText());
    return 0;
  }

  const resolved = resolveCommand(positional);
  if (resolved.group) {
    if (flags.help) {
      if (flags.json) print(groupJson(resolved.group));
      else console.log(groupText(resolved.group));
      return 0;
    }
    fail(`${resolved.group} needs a subcommand`, `\`${resolved.group} --help\` lists them`, {
      code: "arg-missing",
    });
  }
  const { command, args } = resolved;
  commandName = command.name;
  if (flags.help) {
    if (flags.json) print(commandJson(command));
    else console.log(commandText(command));
    return 0;
  }
  validate(command, flags, args);
  const context = { flags, args };
  if (flags.out) outputPath = resolve(String(flags.out));

  const effective = command.effect && (!command.effectWhen || command.effectWhen(context));
  if (effective && flags["dry-run"]) {
    const refused =
      command.effect === "remote-write" &&
      targetName(flags) === "prod" &&
      !flags["allow-prod-write"];
    print({
      dryRun: true,
      command: command.name,
      target: targetName(flags),
      effect: command.effect,
      would: command.plan(context),
      prodGuard: refused ? "a real run is refused without --allow-prod-write" : undefined,
    });
    return 0;
  }
  if (effective && command.effect === "remote-write") {
    guardProdWrite(flags, command.name);
    recordEvidence = command.name;
  }
  return command.run(context);
}

/** Named in the error JSON so a failure says which command raised it. */
let commandName = null;
main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    printError(error, commandName);
    process.exit(error instanceof CliError ? error.exitCode : 1);
  });
