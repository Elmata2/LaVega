/**
 * Black-box tests for control-investing.mjs: every test runs the real CLI as a
 * child process against a stub HTTP server and, for browser commands, a fake
 * `browse` binary that records its arguments. Nothing here reaches a real
 * deploy, broker or browser.
 *
 *   node --test .claude/skills/verify-investing/
 */
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "control-investing.mjs");
const loginShim = join(dirname(fileURLToPath(import.meta.url)), "browser-login.mjs");

let server;
let port;
let routes;
let received;
let stateDir;
let browseLog;
let fakeBrowse;

function route(method, path, status, body, headers = {}) {
  routes.set(`${method} ${path}`, { status, body, headers });
}

before(async () => {
  server = createServer((req, res) => {
    received.push({
      method: req.method,
      url: req.url,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
    });
    const hit = routes.get(`${req.method} ${req.url}`);
    if (!hit) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ problems: ["not found"] }));
      return;
    }
    const body = typeof hit.body === "function" ? hit.body() : hit.body;
    const isText = typeof body === "string";
    res.writeHead(hit.status, {
      "content-type": isText ? "text/html" : "application/json",
      ...hit.headers,
    });
    res.end(isText ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  port = server.address().port;
});

after(() => server.close());

afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

beforeEach(() => {
  routes = new Map();
  received = [];
  stateDir = mkdtempSync(join(tmpdir(), "control-investing-test-"));
  browseLog = join(stateDir, "browse.log");
  fakeBrowse = join(stateDir, "browse");
  writeFileSync(
    fakeBrowse,
    `#!/bin/sh\necho "$@" >> "${browseLog}"\nif [ "$1" = "click" ] && [ "$2" = "@missing" ]; then echo "no element matches @missing" >&2; exit 1; fi\necho "browse-ok $1"\n`,
  );
  chmodSync(fakeBrowse, 0o755);
});

/** Run the CLI; resolves (never rejects) with exit code and parsed output. */
function run(args, env = {}) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [cli, ...args],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          VERIFY_INVESTING_DIR: stateDir,
          LAVEGA_BROWSE_BIN: fakeBrowse,
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const parse = (text) => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        };
        done({
          code: error ? (error.code ?? 1) : 0,
          stdout,
          stderr,
          json: parse(stdout),
          error: parse(stderr),
        });
      },
    );
  });
}

const local = () => ["--port", String(port)];
const browseCalls = () =>
  existsSync(browseLog) ? readFileSync(browseLog, "utf8").trim().split("\n") : [];

describe("help", () => {
  test("overview lists every group and exits 0", async () => {
    const result = await run(["help"]);
    assert.equal(result.code, 0);
    for (const word of [
      "Instance",
      "Health",
      "Session",
      "Read",
      "Write",
      "browser <subcommand>",
      "--dry-run",
    ])
      assert.match(result.stdout, new RegExp(word.replace(/[<>-]/g, "\\$&")));
  });

  test("no arguments prints the overview", async () => {
    const result = await run([]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage:/);
  });

  test("help --json describes every command with a summary and usage", async () => {
    const result = await run(["help", "--json"]);
    assert.equal(result.code, 0);
    assert.ok(result.json.commands.length > 30);
    for (const command of result.json.commands) {
      assert.ok(command.summary, `${command.name} has a summary`);
      assert.ok(
        command.usage.startsWith(command.name),
        `${command.name} usage starts with its name`,
      );
    }
    assert.deepEqual(Object.keys(result.json.exitCodes), ["0", "1", "2"]);
  });

  test("every command answers --help without touching the network", async () => {
    const { json } = await run(["help", "--json"]);
    for (const command of json.commands) {
      const result = await run([...command.name.split(" "), "--help"]);
      assert.equal(result.code, 0, `${command.name} --help`);
      assert.match(result.stdout, new RegExp(`^${command.name}`));
    }
    assert.equal(received.length, 0);
  });

  test("every command with a side effect offers --dry-run", async () => {
    const { json } = await run(["help", "--json"]);
    const effectful = json.commands.filter((command) => command.effect);
    assert.ok(effectful.length >= 10);
    for (const command of effectful) {
      assert.match(command.usage, /--dry-run/, command.name);
      if (command.effect.kind === "remote-write")
        assert.match(command.usage, /--allow-prod-write/, command.name);
    }
  });

  test("a group without a subcommand lists its subcommands", async () => {
    const result = await run(["browser", "--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /browser snapshot/);
    assert.match(result.stdout, /browser click/);
  });

  test("help <command> --json returns one command", async () => {
    const result = await run(["help", "sync", "--json"]);
    assert.equal(result.json.name, "sync");
    assert.equal(result.json.effect.kind, "remote-write");
  });
});

describe("errors", () => {
  test("unknown command suggests the closest one", async () => {
    const result = await run(["snyc"]);
    assert.equal(result.code, 2);
    assert.equal(result.error.ok, false);
    assert.equal(result.error.error.code, "unknown-command");
    assert.match(result.error.error.fix, /`sync`/);
  });

  test("unknown subcommand suggests within its group", async () => {
    const result = await run(["browser", "screnshot"]);
    assert.equal(result.code, 2);
    assert.match(result.error.error.fix, /browser screenshot/);
  });

  test("a bare group asks for a subcommand", async () => {
    const result = await run(["prices"]);
    assert.equal(result.code, 2);
    assert.match(result.error.error.fix, /prices --help/);
  });

  test("unknown flag suggests the closest flag", async () => {
    const result = await run(["sync", "--wiat"]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "unknown-flag");
    assert.match(result.error.error.fix, /--wait/);
  });

  test("a numeric flag rejects text", async () => {
    const result = await run(["logs", "--lines", "many"]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "flag-invalid");
  });

  test("--target rejects an unknown target", async () => {
    const result = await run(["doctor", "--target", "staging"]);
    assert.equal(result.code, 2);
    assert.match(result.error.error.message, /local, prod, preview/);
  });

  test("a value flag without a value says so", async () => {
    const result = await run(["probe", "--out"]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "flag-value-missing");
  });

  test("a missing argument shows usage and an example", async () => {
    const result = await run(["api", "POST"]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "arg-missing");
    assert.match(result.error.error.fix, /usage: api <method> <path>/);
  });

  test("an extra argument is refused, not ignored", async () => {
    const result = await run(["doctor", "prod"]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "arg-extra");
  });

  test("an invalid --body names the JSON problem", async () => {
    const result = await run(["api", "PUT", "/x", "--body", "{bad", "--dry-run", ...local()]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "body-invalid");
  });

  test("a required flag is enforced before any request", async () => {
    const result = await run(["unlock", ...local()]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "flag-missing");
    assert.equal(received.length, 0);
  });

  test("preview without a URL says how to find one", async () => {
    const result = await run(["doctor", "--target", "preview"], { LAVEGA_PREVIEW_URL: "" });
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "preview-url-missing");
    assert.match(result.error.error.fix, /vercel ls/);
  });

  test("login without credentials tells the agent to ask the user", async () => {
    const result = await run(["login", "--base", `http://127.0.0.1:${port}`]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "credentials-missing");
    assert.match(result.error.error.fix, /Never sign up/);
  });
});

describe("dry-run and the prod guard", () => {
  const writes = [
    ["sync", "--force"],
    ["prices", "sync"],
    ["prices", "purge"],
    ["consent", "--accept"],
    ["unlock", "--passphrase", "secret-passphrase"],
    ["api", "POST", "/api/investing/benchmarks", "--body", "{}"],
  ];

  for (const write of writes) {
    test(`${write.slice(0, 2).join(" ")} --dry-run sends nothing`, async () => {
      const result = await run([...write, "--dry-run", ...local()]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.json.dryRun, true);
      assert.ok(result.json.would.url.startsWith(`http://127.0.0.1:${port}/`));
      assert.equal(received.length, 0);
    });

    test(`${write.slice(0, 2).join(" ")} is refused on prod without --allow-prod-write`, async () => {
      const result = await run([...write, "--target", "prod"]);
      assert.equal(result.code, 2);
      assert.equal(result.error.error.code, "prod-write-refused");
    });
  }

  test("dry-run on prod says a real run would be refused", async () => {
    const result = await run(["sync", "--dry-run", "--target", "prod"]);
    assert.equal(result.code, 0);
    assert.match(result.json.prodGuard, /--allow-prod-write/);
  });

  test("unlock --dry-run never echoes the passphrase", async () => {
    const result = await run(["unlock", "--passphrase", "hunter2", "--dry-run", ...local()]);
    assert.doesNotMatch(result.stdout, /hunter2/);
  });

  test("api GET is a read, so it runs even on dry-run", async () => {
    route("GET", "/api/investing/benchmarks", 200, { series: [] });
    const result = await run(["api", "GET", "/api/investing/benchmarks", "--dry-run", ...local()]);
    assert.equal(result.code, 0);
    assert.equal(result.json.status, 200);
    assert.equal(received.length, 1);
  });

  test("consent without --accept is a read and runs", async () => {
    route("GET", "/api/market-data/consent", 200, { accepted: false });
    const result = await run(["consent", ...local()]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.body, { accepted: false });
  });

  test("prices purge refuses without --yes", async () => {
    const result = await run(["prices", "purge", ...local()]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "confirmation-required");
    assert.equal(received.length, 0);
  });

  test("prices purge --yes deletes on local", async () => {
    route("DELETE", "/api/prices/cache", 200, { deleted: true });
    const result = await run(["prices", "purge", "--yes", ...local()]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.body, { deleted: true });
  });

  test("local teardown commands dry-run without deleting", async () => {
    mkdirSync(join(stateDir, "run"), { recursive: true });
    writeFileSync(join(stateDir, "run", "keep.txt"), "x");
    for (const command of ["down", "cleanup", "restart", "logout"]) {
      const result = await run([command, "--dry-run", ...local()]);
      assert.equal(result.code, 0, `${command}: ${result.stderr}`);
      assert.equal(result.json.dryRun, true);
    }
    assert.ok(existsSync(join(stateDir, "run", "keep.txt")));
  });

  test("a write sends an Origin header, which better-auth requires", async () => {
    route("POST", "/api/brokers/sync", 202, { status: "running" });
    const result = await run(["sync", ...local()]);
    assert.equal(result.code, 0);
    assert.equal(received[0].origin, `http://127.0.0.1:${port}`);
  });
});

describe("reads", () => {
  test("probe sorts failures by kind", async () => {
    route("GET", "/health", 200, { service: "investing-server" });
    route("GET", "/api/config/status", 500, { error: "boom" });
    route("GET", "/api/investing/dashboard", 200, {
      positions: [],
      problems: ["Broker not connected"],
    });
    route("GET", "/api/investing/summary", 401, { error: "unauthorized" });
    const result = await run(["probe", ...local()]);
    assert.equal(result.code, 1);
    assert.deepEqual(result.json.serverErrors, ["/api/config/status"]);
    assert.deepEqual(result.json.unauthorized, ["/api/investing/summary"]);
    assert.equal(result.json.degraded[0].path, "/api/investing/dashboard");
  });

  test("probe reports status 0 when nothing listens", async () => {
    const result = await run(["probe", "--port", "1"]);
    assert.equal(result.code, 1);
    assert.equal(result.json.unreachable.length, 9);
  });

  test("doctor flags a dashboard where nothing is priced", async () => {
    route("GET", "/api/investing/health", 200, { service: "investing-server" });
    route("GET", "/api/investing/dashboard", 200, {
      positions: [{ symbol: "AAPL", priceStatus: "unpriced", returns: { status: "missing-cost" } }],
    });
    route("GET", "/api/config/status", 200, { keys: {} });
    route("GET", "/api/brokers/credentials/status", 200, { status: "unlocked" });
    route("GET", "/api/brokers/sync/status", 200, { status: "idle" });
    const result = await run(["doctor", ...local()]);
    assert.equal(result.code, 1);
    const priced = result.json.checks.find((check) => check.name === "positionsPriced");
    assert.equal(priced.ok, false);
    assert.deepEqual(priced.unpricedSample, ["AAPL"]);
  });

  test("doctor on a dead local server says to run up", async () => {
    const result = await run(["doctor", "--port", "1"]);
    assert.equal(result.code, 1);
    assert.match(result.json.checks[0].fix, /up/);
  });

  test("dashboard names the degraded shape and a 401 fix", async () => {
    route("GET", "/api/investing/dashboard", 200, { positions: [], problems: ["no broker"] });
    const degraded = await run(["dashboard", ...local()]);
    assert.equal(degraded.json.shape, "degraded (empty + problems)");
    route("GET", "/api/investing/dashboard", 401, { error: "unauthorized" });
    const unauthorized = await run(["dashboard", ...local()]);
    assert.equal(unauthorized.code, 1);
    assert.match(unauthorized.json.fix, /login/);
  });

  test("assets catches index.html served in place of an asset", async () => {
    route("GET", "/", 200, '<script src="/assets/app.js"></script>');
    route("GET", "/assets/app.js", 200, "<html>fallback</html>");
    const result = await run(["assets", ...local()]);
    assert.equal(result.code, 1);
    assert.match(result.json.checks[0].note, /base path mismatch/);
  });

  test("perf reports percentiles per endpoint", async () => {
    route("GET", "/api/investing/dashboard", 200, { positions: [] });
    const result = await run([
      "perf",
      "--runs",
      "3",
      "--path",
      "/api/investing/dashboard",
      ...local(),
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.json.results[0].runs, 3);
    assert.deepEqual(Object.keys(result.json.results[0].ms), ["min", "p50", "p95", "max"]);
    assert.equal(received.length, 3);
  });

  test("perf exits 1 when an endpoint fails", async () => {
    const result = await run(["perf", "--runs", "1", "--path", "/api/missing", ...local()]);
    assert.equal(result.code, 1);
  });

  test("wait-settle returns once both syncs stop working", async () => {
    let polls = 0;
    route("GET", "/api/brokers/sync/status", 200, () => ({
      status: polls++ < 2 ? "running" : "completed",
    }));
    route("GET", "/api/prices/sync/status", 200, { status: "idle" });
    const result = await run(["wait-settle", "--interval", "50", "--timeout", "5000", ...local()]);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json.settled, true);
    assert.equal(result.json.broker.status, "completed");
  });

  test("wait-settle times out on a sync that keeps running", async () => {
    route("GET", "/api/brokers/sync/status", 200, { status: "waiting" });
    route("GET", "/api/prices/sync/status", 200, { status: "idle" });
    const result = await run(["wait-settle", "--interval", "50", "--timeout", "300", ...local()]);
    assert.equal(result.code, 1);
    assert.equal(result.json.settled, false);
    assert.match(result.json.fix, /--timeout/);
  });

  test("wait-settle stops early when a status route fails", async () => {
    route("GET", "/api/prices/sync/status", 200, { status: "running" });
    const result = await run(["wait-settle", "--timeout", "10000", ...local()]);
    assert.equal(result.code, 1);
    assert.ok(result.json.waitedMs < 5000);
  });

  test("sync --wait reports the settled progress", async () => {
    route("POST", "/api/brokers/sync?force=true", 202, { status: "running" });
    route("GET", "/api/brokers/sync/status", 200, { status: "completed", positionsRead: 4 });
    const result = await run(["sync", "--force", "--wait", "--timeout", "3000", ...local()]);
    assert.equal(result.code, 0);
    assert.equal(result.json.progress.positionsRead, 4);
  });

  test("a sync that settles in problem exits 1", async () => {
    route("POST", "/api/brokers/sync", 202, {});
    route("GET", "/api/brokers/sync/status", 200, { status: "problem", message: "rate limited" });
    const result = await run(["sync", "--wait", "--timeout", "3000", ...local()]);
    assert.equal(result.code, 1);
  });
});

describe("session", () => {
  test("login stores cookies per host and sends them back", async () => {
    const base = `http://127.0.0.1:${port}`;
    writeFileSync(
      join(stateDir, "auth.preview.json"),
      JSON.stringify({ email: "t@x", password: "p" }),
    );
    route(
      "POST",
      "/api/auth/sign-in/email",
      200,
      { ok: true },
      { "set-cookie": "session=abc; Path=/; HttpOnly" },
    );
    route("GET", "/api/auth/get-session", 200, { user: { id: "u1", email: "t@x" } });
    const login = await run(["login", "--base", base]);
    assert.equal(login.code, 0, login.stderr);
    assert.equal(login.json.signedIn, true);
    await run(["whoami", "--base", base]);
    assert.equal(received.at(-1).cookie, "session=abc");
  });

  test("whoami on the standalone server reports unconfigured", async () => {
    const result = await run(["whoami", ...local()]);
    assert.equal(result.json.state, "unconfigured");
  });

  test("info works offline and never prints a secret", async () => {
    const result = await run(["info", "--target", "prod"], {
      VERCEL_AUTOMATION_BYPASS_SECRET: "s3cret-value",
    });
    assert.equal(result.code, 0);
    assert.equal(result.json.base, "https://www.lavega.dev");
    assert.equal(result.json.env.VERCEL_AUTOMATION_BYPASS_SECRET, true);
    assert.doesNotMatch(result.stdout, /s3cret-value/);
    assert.equal(received.length, 0);
  });
});

describe("watch", () => {
  test("refuses a deployed target", async () => {
    const result = await run(["watch", "--target", "prod"]);
    assert.equal(result.code, 2);
    assert.match(result.error.error.fix, /doctor/);
  });

  test("emits an up event then times out", async () => {
    route("GET", "/health", 200, { service: "investing-server" });
    const result = await run(["watch", "--interval", "50", "--timeout", "300", ...local()]);
    assert.equal(result.code, 0);
    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).event);
    assert.deepEqual([events[0], events.at(-1)], ["up", "timeout"]);
  });
});

describe("browser", () => {
  test("open on local navigates in verify mode without cookies", async () => {
    const result = await run(["browser", "open", ...local()]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.cookiesImported, 0);
    assert.deepEqual(browseCalls(), [`goto http://127.0.0.1:${port}/?verify=1`, "wait --load"]);
  });

  test("open on a deploy imports the CLI session and removes the cookie file", async () => {
    const base = `http://127.0.0.1:${port}`;
    mkdirSync(join(stateDir, "run"), { recursive: true });
    writeFileSync(join(stateDir, "run", `cookies-127.0.0.1_${port}.txt`), "session=abc");
    const result = await run(["browser", "open", "--base", base]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.cookiesImported, 1);
    assert.doesNotMatch(result.stdout, /abc/);
    const calls = browseCalls();
    assert.equal(calls[0], `goto ${base}/investing/?verify=1`);
    assert.match(calls[1], /^cookie-import /);
    assert.equal(existsSync(join(stateDir, "run", "browser-cookies.json")), false);
  });

  test("open on a deploy without a session says to log in", async () => {
    const result = await run(["browser", "open", "--base", `http://127.0.0.1:${port}`]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "session-missing");
    assert.match(result.error.error.fix, /login --target preview/);
  });

  test("open redacts the preview bypass secret", async () => {
    mkdirSync(join(stateDir, "run"), { recursive: true });
    writeFileSync(join(stateDir, "run", `cookies-127.0.0.1_${port}.txt`), "session=abc");
    const result = await run(["browser", "open", "--base", `http://127.0.0.1:${port}`], {
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret-123",
    });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /bypass-secret-123/);
    assert.match(browseCalls()[0], /bypass-secret-123/);
  });

  test("snapshot maps flags onto browse flags", async () => {
    await run(["browser", "snapshot", "--interactive", "--diff", "--selector", "main"]);
    assert.deepEqual(browseCalls(), ["snapshot -i -D -s main"]);
  });

  test("screenshot defaults into the evidence directory", async () => {
    const result = await run(["browser", "screenshot"]);
    assert.equal(result.code, 0);
    assert.ok(result.json.saved.startsWith(join(stateDir, "evidence")));
  });

  test("click --dry-run does not call browse", async () => {
    const result = await run(["browser", "click", "@e3", "--dry-run"]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.would.browse, ["click", "@e3"]);
    assert.deepEqual(browseCalls(), []);
  });

  test("a failed click exits 1 and points at snapshot", async () => {
    const result = await run(["browser", "click", "@missing"]);
    assert.equal(result.code, 1);
    assert.equal(result.json.ok, false);
    assert.match(result.json.fix, /snapshot --interactive/);
  });

  test("raw passes flags after -- straight through", async () => {
    await run(["browser", "raw", "--", "wait", "--networkidle"]);
    assert.deepEqual(browseCalls(), ["wait --networkidle"]);
  });

  test("a missing browse binary says how to install it", async () => {
    const result = await run(["browser", "text"], { LAVEGA_BROWSE_BIN: join(stateDir, "nope") });
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "browse-missing");
  });

  test("browser-login.mjs still opens prod by default", async () => {
    const result = await new Promise((done) =>
      execFile(
        process.execPath,
        [loginShim],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            VERIFY_INVESTING_DIR: stateDir,
            LAVEGA_BROWSE_BIN: fakeBrowse,
          },
        },
        (error, stdout, stderr) => done({ code: error?.code ?? 0, stderr }),
      ),
    );
    assert.equal(result.code, 2);
    assert.match(result.stderr, /www\.lavega\.dev/);
  });
});
