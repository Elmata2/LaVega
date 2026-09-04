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

const stateRoot = process.env.VERIFY_INVESTING_DIR || "/tmp/lavega-verify-investing";
const runDir = join(stateRoot, "run"); // torn down by `down` / `cleanup`
const evidenceDir = join(stateRoot, "evidence"); // survives teardown
const pidFile = join(runDir, "local.pid");
const portFile = join(runDir, "local.port");
const logFile = join(runDir, "local.log");
const cookieFile = join(runDir, "cookies.txt");
/* Kept outside runDir so `cleanup` does not delete it, and outside the repo so
 * it can never be committed. The user writes it; this CLI only reads it. */
const credentialsFile = join(stateRoot, "auth.json");

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

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inlineValue] = token.slice(2).split(/=(.*)/s);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

function fail(message, hint) {
  console.error(`error: ${message}`);
  if (hint) console.error(`hint:  ${hint}`);
  process.exit(1);
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

function baseUrl(flags) {
  if (flags.base) return String(flags.base).replace(/\/+$/, "");
  const target = flags.target || "local";
  if (target === "prod") return PROD_BASE;
  if (target === "local") return `http://127.0.0.1:${localPort(flags)}`;
  fail(`unknown --target "${target}"`, "use --target local, --target prod, or --base <url>");
}

function spaPath(flags) {
  const target = flags.target || (flags.base ? "custom" : "local");
  return target === "prod" ? "/investing/" : "/";
}

// ---------------------------------------------------------------- cookies

function loadCookies() {
  if (!existsSync(cookieFile)) return "";
  return readFileSync(cookieFile, "utf8").trim();
}

function saveCookies(response) {
  const raw =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (raw.length === 0) return;
  const jar = new Map();
  for (const pair of loadCookies().split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=");
    jar.set(name, rest.join("="));
  }
  for (const header of raw) {
    const [pair] = header.split(";");
    const [name, ...rest] = pair.split("=");
    jar.set(name.trim(), rest.join("="));
  }
  ensureDirs();
  writeFileSync(cookieFile, [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
}

// ---------------------------------------------------------------- requests

async function request(flags, method, path, body) {
  const origin = baseUrl(flags);
  const url = `${origin}${path}`;
  /* better-auth rejects a state-changing request with no Origin header
   * (MISSING_OR_NULL_ORIGIN) — that check is what stops a browser on another
   * site from posting here. A non-browser client has to state its origin. */
  const headers = { accept: "application/json", origin, referer: `${origin}/` };
  const cookies = loadCookies();
  if (cookies) headers.cookie = cookies;
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
      error: error instanceof Error ? error.message : String(error),
    };
  }
  saveCookies(response);
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

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

/** Problem lists are how this backend reports trouble inside a 200 response. */
function problemsOf(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Array.isArray(payload.problems) ? payload.problems : [];
}

// ---------------------------------------------------------------- commands

async function commandUp(flags) {
  ensureDirs();
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (isAlive(pid)) {
      print({ started: false, reason: "already running", pid, port: localPort(flags) });
      return 0;
    }
    rmSync(pidFile, { force: true });
  }
  const port = flags.port ? Number(flags.port) : DEFAULT_LOCAL_PORT;
  const dataDir = flags.data ? resolve(String(flags.data)) : join(runDir, "data");
  mkdirSync(dataDir, { recursive: true });

  const distDir = join(repoRoot, "apps/investing-web/dist");
  if (!existsSync(distDir)) {
    fail(
      "apps/investing-web/dist is missing — the SPA has not been built",
      "run: pnpm --filter @lavega/investing-web build",
    );
  }

  /* Run tsx directly rather than through `pnpm --filter`: pnpm's deps-status
   * check wants a TTY to confirm a modules purge and aborts without one. */
  const tsx = join(repoRoot, "node_modules/.bin/tsx");
  if (!existsSync(tsx)) fail("node_modules/.bin/tsx is missing", "run: pnpm install");

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

  const ready = await waitFor(async () => {
    const health = await request({ base: `http://127.0.0.1:${port}` }, "GET", "/health");
    return health.ok && health.json?.service === "investing-server";
  }, 40_000);

  if (!ready) {
    print({ started: false, pid: child.pid, port, log: logFile, tail: tailLog() });
    return 1;
  }
  print({
    started: true,
    pid: child.pid,
    port,
    base: `http://127.0.0.1:${port}`,
    data: dataDir,
    log: logFile,
  });
  return 0;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tailLog(lines = 20) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-lines);
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

function commandDown(flags) {
  if (!existsSync(pidFile)) {
    print({ stopped: false, reason: "no instance recorded by this CLI" });
    return 0;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (flags["dry-run"]) {
    print({ dryRun: true, wouldKill: pid, alive: isAlive(pid) });
    return 0;
  }
  // Kill only the pid this CLI recorded — never by process name, which would
  // take down a dev server the user started themselves.
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
  print({ stopped, pid, evidenceKept: evidenceDir });
  return 0;
}

function commandCleanup(flags) {
  commandDown(flags);
  if (flags["dry-run"]) {
    print({ dryRun: true, wouldRemove: runDir, wouldKeep: evidenceDir });
    return 0;
  }
  rmSync(runDir, { recursive: true, force: true });
  print({ removed: runDir, kept: evidenceDir });
  return 0;
}

async function commandDoctor(flags) {
  const report = { base: baseUrl(flags), checks: [], verdict: "ok" };
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
  });

  const session = await request(flags, "GET", "/api/auth/get-session");
  const authed = Boolean(session.json?.user);
  const unconfigured = session.status === 503 || session.status === 404;
  report.auth = unconfigured
    ? "unconfigured"
    : authed
      ? `authenticated:${session.json.user.email ?? session.json.user.id}`
      : "anonymous";

  const dashboard = await request(flags, "GET", "/api/investing/dashboard");
  if (dashboard.status === 401) {
    note("dashboard", false, {
      status: 401,
      reason: "no session — the mount refuses to guess a tenant",
      fix: "control-investing.mjs login --target prod --email <you> --password <pw>",
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

  const sync = await request(flags, "GET", "/api/brokers/sync/status");
  note("brokerSync", sync.ok, { status: sync.status, body: sync.json });

  print(report);
  return report.verdict === "ok" ? 0 : 1;
}

/**
 * Where a password comes from, in order: a credentials file, the environment,
 * then a flag. The file is the intended path — a password passed as an argument
 * is visible in shell history and in any transcript of the run.
 */
function resolveCredentials(flags) {
  const path = flags["credentials-file"]
    ? resolve(String(flags["credentials-file"]))
    : credentialsFile;
  if (existsSync(path)) {
    try {
      const stored = JSON.parse(readFileSync(path, "utf8"));
      if (stored.email && stored.password)
        return { email: String(stored.email), password: String(stored.password), from: path };
    } catch {
      fail(`${path} is not readable JSON`, 'expected: {"email":"...","password":"..."}');
    }
  }
  const email = flags.email ?? process.env.LAVEGA_VERIFY_EMAIL;
  const password = flags.password ?? process.env.LAVEGA_VERIFY_PASSWORD;
  if (email && password)
    return {
      email: String(email),
      password: String(password),
      from: flags.password ? "--password flag" : "environment",
    };
  return null;
}

async function commandLogin(flags) {
  const credentials = resolveCredentials(flags);
  if (!credentials) {
    fail(
      "no credentials found",
      `write ${credentialsFile} as {"email":"...","password":"..."} (chmod 600), or set LAVEGA_VERIFY_EMAIL and LAVEGA_VERIFY_PASSWORD`,
    );
  }
  const response = await request(flags, "POST", "/api/auth/sign-in/email", {
    email: credentials.email,
    password: credentials.password,
  });
  if (!response.ok) {
    print({ signedIn: false, status: response.status, body: response.json ?? response.text });
    return 1;
  }
  const session = await request(flags, "GET", "/api/auth/get-session");
  print({
    signedIn: Boolean(session.json?.user),
    user: session.json?.user ?? null,
    cookieJar: cookieFile,
    credentialsFrom: credentials.from,
  });
  return session.json?.user ? 0 : 1;
}

async function commandWhoami(flags) {
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

function commandLogout() {
  rmSync(cookieFile, { force: true });
  print({ cookieJarCleared: cookieFile });
  return 0;
}

async function commandDashboard(flags) {
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
  });
  return response.ok ? 0 : 1;
}

async function commandSummary(flags) {
  const response = await request(flags, "GET", "/api/investing/summary");
  print({ status: response.status, ms: response.ms, body: response.json ?? response.text });
  return response.ok ? 0 : 1;
}

async function commandSyncStatus(flags) {
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

async function commandSync(flags) {
  const force = flags.force ? "?force=true" : "";
  if (flags["dry-run"]) {
    print({
      dryRun: true,
      wouldPost: `${baseUrl(flags)}/api/brokers/sync${force}`,
      note: "a real sync calls the broker API and writes the vault",
    });
    return 0;
  }
  const response = await request(flags, "POST", `/api/brokers/sync${force}`);
  if (!flags.wait) {
    print({ status: response.status, body: response.json ?? response.text });
    return response.ok ? 0 : 1;
  }
  const timeoutMs = Number(flags.timeout ?? 120_000);
  let last = null;
  const settled = await waitFor(async () => {
    const progress = await request(flags, "GET", "/api/brokers/sync/status");
    last = progress.json;
    return last?.status === "completed" || last?.status === "problem" || last?.status === "idle";
  }, timeoutMs);
  print({ started: response.status, settled, progress: last });
  return settled && last?.status !== "problem" ? 0 : 1;
}

async function commandUnlock(flags) {
  if (!flags.passphrase)
    fail(
      "unlock needs --passphrase",
      "the vault key is derived from it; nothing else can open the vault",
    );
  const response = await request(flags, "POST", "/api/brokers/credentials/unlock", {
    passphrase: String(flags.passphrase),
  });
  print({ status: response.status, body: response.json ?? response.text });
  return response.ok ? 0 : 1;
}

async function commandConsent(flags) {
  if (!flags.accept) {
    const response = await request(flags, "GET", "/api/market-data/consent");
    print({ status: response.status, body: response.json ?? response.text });
    return response.ok ? 0 : 1;
  }
  if (flags["dry-run"]) {
    print({
      dryRun: true,
      wouldPut: "/api/market-data/consent",
      note: "accepting consent lets the server call Yahoo Finance",
    });
    return 0;
  }
  const response = await request(flags, "PUT", "/api/market-data/consent", {
    accepted: true,
    disclosureVersion: flags.version ? String(flags.version) : undefined,
  });
  print({ status: response.status, body: response.json ?? response.text });
  return response.ok ? 0 : 1;
}

async function commandPrices(flags, sub) {
  if (sub === "status") return commandSyncStatus(flags);
  if (sub === "sync") {
    if (flags["dry-run"]) {
      print({
        dryRun: true,
        wouldPost: "/api/prices/sync",
        note: "a real price sync calls Yahoo Finance and writes the price store",
      });
      return 0;
    }
    const response = await request(
      flags,
      "POST",
      `/api/prices/sync${flags.force ? "?force=true" : ""}`,
    );
    print({ status: response.status, body: response.json ?? response.text });
    return response.ok ? 0 : 1;
  }
  if (sub === "purge") {
    if (!flags.yes) {
      print({ refused: true, reason: "purge deletes every cached price bar", rerunWith: "--yes" });
      return 1;
    }
    const response = await request(flags, "DELETE", "/api/prices/cache");
    print({ status: response.status, body: response.json ?? response.text });
    return response.ok ? 0 : 1;
  }
  fail(
    `unknown prices subcommand "${sub}"`,
    "use: prices status | prices sync | prices purge --yes",
  );
}

/**
 * Sweep every read-only endpoint at once. This is the first command to run when
 * "the dashboard will not load": it separates a transport failure (status 0),
 * an auth failure (401), a backend failure (5xx) and a degraded-but-served
 * dashboard (200 with a problems list) in one output.
 */
async function commandProbe(flags) {
  const results = [];
  for (const path of PROBE_ENDPOINTS) {
    const response = await request(flags, "GET", path);
    results.push({
      path,
      status: response.status,
      ms: response.ms,
      ok: response.ok,
      problems: problemsOf(response.json),
      body: flags.verbose ? (response.json ?? response.text) : undefined,
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
  if (flags.out) {
    ensureDirs();
    const out = resolve(String(flags.out));
    writeFileSync(out, JSON.stringify(report, null, 2));
    report.savedTo = out;
  }
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
async function commandAssets(flags) {
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

async function commandApi(flags, positional) {
  const [method, path] = positional;
  if (!method || !path)
    fail("api needs a method and a path", "example: api GET /api/investing/benchmarks");
  const body = flags.body ? JSON.parse(String(flags.body)) : undefined;
  const response = await request(flags, method.toUpperCase(), path, body);
  print({
    status: response.status,
    ms: response.ms,
    contentType: response.contentType,
    body: response.json ?? response.text,
  });
  return response.ok ? 0 : 1;
}

function commandLogs(flags) {
  print({ log: logFile, lines: tailLog(Number(flags.lines ?? 40)) });
  return 0;
}

function commandEvidence() {
  print({ evidenceDir, runDir, note: "cleanup removes runDir and keeps evidenceDir" });
  return 0;
}

const HELP = `control-investing — drive the LaVega investing app for verification

Usage: node .claude/skills/verify-investing/control-investing.mjs <command> [options]

Targets
  --target local        standalone investing-server this CLI starts (default)
  --target prod         https://www.lavega.dev (needs \`login\`)
  --base <url>          any other origin

Instance
  up [--port N] [--data DIR]   start the local server, wait for /health
  down [--dry-run]             stop only the instance this CLI started
  cleanup [--dry-run]          down + remove run state, keep evidence
  logs [--lines N]             tail the local server log
  evidence                     print where proof is kept

Health
  doctor                       is this instance worth driving?
  probe [--verbose] [--out F]  sweep every read-only endpoint, one report
  assets [--path P]            shell + every asset it references

Session (prod)
  login                        reads ${credentialsFile}
  login --credentials-file F   or LAVEGA_VERIFY_EMAIL / LAVEGA_VERIFY_PASSWORD
  whoami
  logout

Read
  dashboard [--symbol S] [--raw]
  summary
  sync-status
  consent
  api <METHOD> <path> [--body '<json>']

Write
  sync [--force] [--wait] [--timeout MS] [--dry-run]
  prices sync [--force] [--dry-run] | prices purge --yes | prices status
  unlock --passphrase P
  consent --accept [--dry-run]

Evidence lives in ${evidenceDir}; run state in ${runDir}.
`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  if (!command || flags.help || command === "help") {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case "up":
      return commandUp(flags);
    case "down":
      return commandDown(flags);
    case "cleanup":
      return commandCleanup(flags);
    case "logs":
      return commandLogs(flags);
    case "evidence":
      return commandEvidence();
    case "doctor":
      return commandDoctor(flags);
    case "probe":
      return commandProbe(flags);
    case "assets":
      return commandAssets(flags);
    case "login":
      return commandLogin(flags);
    case "whoami":
      return commandWhoami(flags);
    case "logout":
      return commandLogout();
    case "dashboard":
      return commandDashboard(flags);
    case "summary":
      return commandSummary(flags);
    case "sync-status":
      return commandSyncStatus(flags);
    case "sync":
      return commandSync(flags);
    case "unlock":
      return commandUnlock(flags);
    case "consent":
      return commandConsent(flags);
    case "prices":
      return commandPrices(flags, rest[0]);
    case "api":
      return commandApi(flags, rest);
    default:
      fail(`unknown command "${command}"`, "run with --help for the command list");
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
