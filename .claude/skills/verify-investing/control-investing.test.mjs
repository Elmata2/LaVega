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
let fakeVercel;
let vercelLog;
let vercelReply;

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
    const status = typeof hit.status === "function" ? hit.status() : hit.status;
    const body = typeof hit.body === "function" ? hit.body() : hit.body;
    const isText = typeof body === "string";
    res.writeHead(status, {
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
  vercelLog = join(stateDir, "vercel.log");
  vercelReply = join(stateDir, "vercel.json");
  fakeVercel = join(stateDir, "vercel");
  writeFileSync(
    fakeVercel,
    `#!/bin/sh
echo "$@" >> "${vercelLog}"
if [ "$1" = "env" ] && [ "$2" = "pull" ]; then
  if [ -n "$LAVEGA_TEST_ENV_PULL" ]; then
    cp "$LAVEGA_TEST_ENV_PULL" "$3"
    exit 0
  fi
  echo "not linked" >&2
  exit 1
fi
cat "${vercelReply}"
`,
  );
  chmodSync(fakeVercel, 0o755);
  vercelDeployments([{ url: "lavega-newest.vercel.app", ref: "feature-a", sha: "abcdef123" }]);
  const shell = join(stateDir, "ms-playwright", "chromium_headless_shell-1208", "chrome-linux");
  mkdirSync(shell, { recursive: true });
  writeFileSync(join(shell, "headless_shell"), "");
});

function vercelDeployments(list) {
  writeFileSync(
    vercelReply,
    JSON.stringify({
      deployments: list.map((entry, index) => ({
        url: entry.url,
        state: "READY",
        createdAt: 1_790_000_000_000 - index,
        meta: { githubCommitRef: entry.ref, githubCommitSha: entry.sha },
      })),
    }),
  );
}

const vercelCalls = () =>
  existsSync(vercelLog) ? readFileSync(vercelLog, "utf8").trim().split("\n") : [];

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
          PLAYWRIGHT_BROWSERS_PATH: join(stateDir, "ms-playwright"),
          LAVEGA_VERCEL_BIN: fakeVercel,
          LAVEGA_VERCEL_CWD: stateDir,
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
    assert.match(result.stdout, /browser install/);
  });

  test("browser <cmd> --help --json carries the escalate rule", async () => {
    for (const name of ["install", "open", "snapshot", "click", "screenshot"]) {
      const result = await run(["browser", name, "--help", "--json"]);
      assert.equal(result.code, 0, `${name} ${result.stderr}`);
      assert.equal(result.json.sandbox.code, "browse-sandboxed");
      assert.equal(result.json.sandbox.escalate, true);
      assert.match(result.json.sandbox.rule, /escalat/);
      assert.match(result.json.sandbox.rule, /unrestrict/);
      assert.match(result.json.sandbox.rule, /PortRendezvous/);
      assert.match(result.json.sandbox.rule, /EPERM/);
      assert.match(result.json.sandbox.rule, /SIGTRAP/);
      assert.match(result.json.sandbox.rule, /target-closed/);
      assert.match(result.json.sandbox.rule, /Do not reinstall Chromium/);
    }
    const group = await run(["browser", "--help", "--json"]);
    assert.equal(group.code, 0, group.stderr);
    assert.equal(group.json.sandbox.escalate, true);
    assert.match(group.json.sandbox.rule, /browse-sandboxed/);
    const viaHelp = await run(["help", "browser", "screenshot", "--json"]);
    assert.equal(viaHelp.json.sandbox.code, "browse-sandboxed");
    const sync = await run(["sync", "--help", "--json"]);
    assert.equal(sync.json.sandbox, undefined);
  });

  test("browser --help says to escalate outside the sandbox", async () => {
    const result = await run(["browser", "--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /escalat/);
    assert.match(result.stdout, /unrestrict/);
    assert.match(result.stdout, /workspace-write/);
    assert.match(result.stdout, /PortRendezvous/);
    assert.match(result.stdout, /EPERM/);
    assert.match(result.stdout, /SIGTRAP/);
    assert.match(result.stdout, /target-closed/);
    assert.match(result.stdout, /browse-sandboxed/);
    assert.match(result.stdout, /Do not reinstall Chromium/);
    for (const name of ["install", "open", "snapshot", "click", "screenshot"])
      assert.match(result.stdout, new RegExp(`browser ${name}`));
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

  test("login without credentials names the vercel env pull, not a /tmp handoff", async () => {
    const result = await run(["login", "--base", `http://127.0.0.1:${port}`]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "credentials-missing");
    assert.match(result.error.error.fix, /auth\.preview\.json/);
    assert.match(result.error.error.fix, /Do not write/);
    assert.match(result.error.error.fix, /vercel env pull/);
    assert.match(result.error.error.fix, /LAVEGA_VERIFY_EMAIL/);
    assert.match(result.error.error.fix, /LAVEGA_VERIFY_PASSWORD/);
    assert.match(result.error.error.fix, /Do not ask for a personal password/);
    assert.match(result.error.error.fix, /Do not invent an account/);
    assert.match(result.error.error.fix, /page/);
    assert.match(vercelCalls()[0], /^env pull /);
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
    assert.match(result.json.next.commands.join("\n"), /consent --accept/);
    assert.match(result.json.next.commands.join("\n"), /prices sync --wait/);
  });

  test("consent read when already accepted still names the price continuation", async () => {
    route("GET", "/api/market-data/consent", 200, {
      accepted: true,
      disclosureVersion: "yahoo-finance-v1",
    });
    const result = await run(["consent", ...local()]);
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.json.next.commands.join("\n"), /consent --accept/);
    assert.match(result.json.next.commands[0], /sync --wait$/);
    assert.match(result.json.next.commands.join("\n"), /prices sync --wait/);
  });

  test("prices sync 428 names consent then the continuation", async () => {
    route("POST", "/api/prices/sync", 428, {
      consentRequired: true,
      problems: ["Yahoo Finance consent required"],
    });
    const result = await run(["prices", "sync", ...local()]);
    assert.equal(result.code, 1);
    assert.match(result.json.fix, /consent --accept/);
    assert.match(result.json.fix, /prices sync --wait/);
    assert.equal(received.length, 1);
  });

  test("prices sync --wait posts again while the run is paused", async () => {
    let posts = 0;
    route(
      "POST",
      "/api/prices/sync",
      () => (posts === 0 ? 202 : 200),
      () => {
        posts += 1;
        return posts === 1
          ? { status: "paused", remainingSymbols: ["AAPL"] }
          : { status: "completed", problems: [] };
      },
    );
    const result = await run(["prices", "sync", "--wait", ...local()]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.settled, true);
    assert.equal(posts, 2);
    assert.equal(result.json.body.status, "completed");
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

  test("consent --accept --dry-run does not write evidence", async () => {
    const result = await run(["consent", "--accept", "--dry-run", ...local()]);
    assert.equal(result.code, 0);
    assert.equal(result.json.evidence, undefined);
    assert.equal(existsSync(join(stateDir, "evidence")), false);
    assert.match(result.json.would.next.commands.join("\n"), /prices sync --wait/);
  });

  test("a remote write saves its JSON under evidence, and cleanup keeps it", async () => {
    route("PUT", "/api/market-data/consent", 200, {
      accepted: true,
      disclosureVersion: "yahoo-finance-v1",
    });
    const result = await run(["consent", "--accept", ...local()]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.body.accepted, true);
    assert.match(result.json.next.why, /does not fetch bars/);
    assert.match(result.json.next.commands.join("\n"), /sync --wait/);
    assert.match(result.json.next.commands.join("\n"), /prices sync --wait/);
    assert.equal(result.json.evidence.length, 1);
    const saved = JSON.parse(readFileSync(result.json.evidence[0], "utf8"));
    assert.equal(saved.body.accepted, true);
    const cleanup = await run(["cleanup", ...local()]);
    assert.equal(cleanup.code, 0, cleanup.stderr);
    assert.equal(existsSync(result.json.evidence[0]), true);
    assert.equal(existsSync(join(stateDir, "run")), false);
  });

  test("--out saves a read, and probe --out includes response bodies", async () => {
    route("GET", "/api/market-data/consent", 200, { accepted: false });
    const before = join(stateDir, "evidence", "before.json");
    const read = await run(["consent", "--out", before, ...local()]);
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(read.json.evidence, [before]);
    assert.deepEqual(JSON.parse(readFileSync(before, "utf8")).body, { accepted: false });

    route("GET", "/api/market-data/consent", 200, { accepted: true });
    const probeOut = join(stateDir, "evidence", "probe.json");
    const probe = await run(["probe", "--out", probeOut, ...local()]);
    const saved = JSON.parse(readFileSync(probeOut, "utf8"));
    const consent = saved.results.find((entry) => entry.path === "/api/market-data/consent");
    assert.deepEqual(consent.body, { accepted: true });
    assert.equal(saved.savedTo, probeOut);
    assert.deepEqual(probe.json.evidence, [probeOut]);
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
    assert.equal(
      result.json.checks.find((check) => check.name === "credentialsFile"),
      undefined,
    );
    const priced = result.json.checks.find((check) => check.name === "positionsPriced");
    assert.equal(priced.ok, false);
    assert.deepEqual(priced.unpricedSample, ["AAPL"]);
    assert.match(priced.fix, /consent --accept/);
    assert.match(priced.fix, /prices sync --wait/);
    assert.match(priced.fix, /Consent alone fetches nothing/);
  });

  test("doctor on a dead local server says to run up", async () => {
    const result = await run(["doctor", "--port", "1"]);
    assert.equal(result.code, 1);
    assert.match(result.json.checks[0].fix, /up/);
  });

  test("doctor on preview fails when the credentials file is missing", async () => {
    route("GET", "/api/investing/health", 200, { service: "investing-server" });
    route("GET", "/api/auth/get-session", 200, {});
    route("GET", "/api/investing/dashboard", 401, {});
    route("GET", "/api/config/status", 200, { keys: {} });
    route("GET", "/api/brokers/credentials/status", 200, { status: "empty" });
    route("GET", "/api/brokers/sync/status", 200, { status: "idle" });
    const result = await run(["doctor", "--base", `http://127.0.0.1:${port}`]);
    assert.equal(result.code, 1);
    const check = result.json.checks.find((item) => item.name === "credentialsFile");
    assert.equal(check.ok, false);
    assert.equal(check.env, false);
    assert.match(check.path, /auth\.preview\.json$/);
    assert.match(check.fix, /Do not write/);
    assert.match(check.fix, /vercel env pull/);
    assert.match(check.fix, /LAVEGA_VERIFY_EMAIL/);
    assert.match(check.fix, /LAVEGA_VERIFY_PASSWORD/);
    assert.match(check.fix, /Do not ask for a personal password/);
    assert.match(check.fix, /Do not invent an account/);
    assert.equal(result.json.page, `http://127.0.0.1:${port}/investing/`);
  });

  test("doctor on preview accepts the Vercel env pair without a credentials file", async () => {
    route("GET", "/api/investing/health", 200, { service: "investing-server" });
    route("GET", "/api/auth/get-session", 200, {});
    route("GET", "/api/investing/dashboard", 401, {});
    route("GET", "/api/config/status", 200, { keys: {} });
    route("GET", "/api/brokers/credentials/status", 200, { status: "empty" });
    route("GET", "/api/brokers/sync/status", 200, { status: "idle" });
    const result = await run(["doctor", "--base", `http://127.0.0.1:${port}`], {
      LAVEGA_VERIFY_EMAIL: "preview@x",
      LAVEGA_VERIFY_PASSWORD: "env-secret",
    });
    const check = result.json.checks.find((item) => item.name === "credentialsFile");
    assert.equal(check.ok, true);
    assert.equal(check.present, false);
    assert.equal(check.env, true);
    assert.equal(check.fix, undefined);
    assert.doesNotMatch(result.stdout, /env-secret/);
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
  test("login resolves the file, then the env pair, then the flags", async () => {
    const base = `http://127.0.0.1:${port}`;
    const file = join(stateDir, "auth.preview.json");
    route("POST", "/api/auth/sign-in/email", 200, { ok: true });
    route("GET", "/api/auth/get-session", 200, { user: { id: "u1", email: "file@x" } });
    writeFileSync(file, JSON.stringify({ email: "file@x", password: "file-secret" }));
    const fromFile = await run(
      ["login", "--base", base, "--email", "flag@x", "--password", "flag-secret"],
      { LAVEGA_VERIFY_EMAIL: "env@x", LAVEGA_VERIFY_PASSWORD: "env-secret" },
    );
    assert.equal(fromFile.code, 0, fromFile.stderr);
    assert.equal(fromFile.json.credentialsFrom, file);
    assert.doesNotMatch(fromFile.stdout, /file-secret|env-secret|flag-secret/);

    rmSync(file);
    const fromEnv = await run(
      ["login", "--base", base, "--email", "flag@x", "--password", "flag-secret"],
      { LAVEGA_VERIFY_EMAIL: "env@x", LAVEGA_VERIFY_PASSWORD: "env-secret" },
    );
    assert.equal(fromEnv.code, 0, fromEnv.stderr);
    assert.equal(fromEnv.json.credentialsFrom, "environment");
    assert.doesNotMatch(fromEnv.stdout, /env-secret|flag-secret/);

    const fromFlags = await run([
      "login",
      "--base",
      base,
      "--email",
      "flag@x",
      "--password",
      "flag-secret",
    ]);
    assert.equal(fromFlags.code, 0, fromFlags.stderr);
    assert.equal(fromFlags.json.credentialsFrom, "--email/--password");
    assert.doesNotMatch(fromFlags.stdout, /flag-secret/);
    assert.equal(fromFlags.json.page, `${base}/investing/`);
  });

  test("login pulls LAVEGA_VERIFY_* from vercel when no file is readable", async () => {
    const base = `http://127.0.0.1:${port}`;
    const pullFile = join(stateDir, "pull.env");
    writeFileSync(
      pullFile,
      'LAVEGA_VERIFY_EMAIL="preview@x"\nLAVEGA_VERIFY_PASSWORD="pull-secret"\n',
    );
    route("POST", "/api/auth/sign-in/email", 200, { ok: true });
    route("GET", "/api/auth/get-session", 200, { user: { id: "u1", email: "preview@x" } });
    const result = await run(["login", "--base", base], { LAVEGA_TEST_ENV_PULL: pullFile });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.credentialsFrom, "vercel-env");
    assert.equal(result.json.signedIn, true);
    assert.equal(result.json.page, `${base}/investing/`);
    assert.doesNotMatch(result.stdout, /pull-secret/);
    assert.match(vercelCalls()[0], /^env pull /);
    assert.match(vercelCalls()[0], /--environment preview/);
  });

  test("an unreadable auth.preview.json falls through to the vercel pull", async () => {
    const base = `http://127.0.0.1:${port}`;
    const hidden = join(stateDir, "auth.preview.json");
    writeFileSync(hidden, JSON.stringify({ email: "hidden@x", password: "hidden-secret" }));
    chmodSync(hidden, 0);
    const pullFile = join(stateDir, "pull.env");
    writeFileSync(
      pullFile,
      'LAVEGA_VERIFY_EMAIL="preview@x"\nLAVEGA_VERIFY_PASSWORD="pull-secret"\n',
    );
    route("POST", "/api/auth/sign-in/email", 200, { ok: true });
    route("GET", "/api/auth/get-session", 200, { user: { id: "u1", email: "preview@x" } });
    const result = await run(["login", "--base", base], { LAVEGA_TEST_ENV_PULL: pullFile });
    chmodSync(hidden, 0o600);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.credentialsFrom, "vercel-env");
    assert.doesNotMatch(result.stdout, /hidden-secret|pull-secret/);
  });

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

describe("preview lookup", () => {
  const previewEnv = { LAVEGA_PREVIEW_URL: "" };

  test("--target preview with no URL pins the newest READY deploy", async () => {
    const result = await run(["sync", "--dry-run", "--target", "preview"], previewEnv);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.would.url, "https://lavega-newest.vercel.app/api/brokers/sync");
    assert.match(vercelCalls()[0], /^ls --environment preview --status READY --format json --cwd /);
  });

  test("the pin holds even after a newer deploy lands", async () => {
    await run(["sync", "--dry-run", "--target", "preview"], previewEnv);
    vercelDeployments([{ url: "lavega-newer.vercel.app", ref: "feature-b" }]);
    const result = await run(["sync", "--dry-run", "--target", "preview"], previewEnv);
    assert.match(result.json.would.url, /lavega-newest/);
    assert.equal(vercelCalls().length, 1);
  });

  test("preview --refresh moves the pin and says to log in again", async () => {
    await run(["sync", "--dry-run", "--target", "preview"], previewEnv);
    vercelDeployments([{ url: "lavega-newer.vercel.app", ref: "feature-b" }]);
    const result = await run(["preview", "--refresh"], previewEnv);
    assert.equal(result.code, 0);
    assert.equal(result.json.pinned.url, "https://lavega-newer.vercel.app");
    assert.equal(result.json.page, "https://lavega-newer.vercel.app/investing/");
    assert.equal(result.json.previous, "https://lavega-newest.vercel.app");
    assert.match(result.json.next, /login --target preview/);
  });

  test("preview --branch filters on the branch", async () => {
    const result = await run(["preview", "--branch", "feature-a"], previewEnv);
    assert.equal(result.code, 0);
    assert.equal(result.json.pinned.branch, "feature-a");
    assert.equal(result.json.pinned.commit, "abcdef1");
    assert.match(vercelCalls()[0], /--meta githubCommitRef=feature-a/);
  });

  test("no matching deploy says what to do", async () => {
    vercelDeployments([]);
    const result = await run(["preview", "--branch", "nope"], previewEnv);
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "preview-not-found");
    assert.match(result.error.error.fix, /push the branch/);
  });

  test("vercel output that is not JSON names vercel login", async () => {
    writeFileSync(vercelReply, "Error: not authorized");
    const result = await run(["doctor", "--target", "preview"], previewEnv);
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "vercel-failed");
    assert.match(result.error.error.fix, /vercel login/);
  });

  test("a missing vercel CLI says how to install it or pass a URL", async () => {
    const result = await run(["doctor", "--target", "preview"], {
      ...previewEnv,
      LAVEGA_VERCEL_BIN: join(stateDir, "no-vercel"),
    });
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "vercel-missing");
    assert.match(result.error.error.fix, /--base/);
  });

  test("LAVEGA_PREVIEW_URL and --base win over the lookup", async () => {
    const env = await run(["sync", "--dry-run", "--target", "preview"], {
      LAVEGA_PREVIEW_URL: "https://from-env.vercel.app",
    });
    assert.match(env.json.would.url, /from-env/);
    const base = await run(
      ["sync", "--dry-run", "--base", "https://from-flag.vercel.app"],
      previewEnv,
    );
    assert.match(base.json.would.url, /from-flag/);
    assert.deepEqual(vercelCalls(), []);
  });

  test("info never runs the lookup", async () => {
    const result = await run(["info", "--target", "preview"], previewEnv);
    assert.equal(result.code, 0);
    assert.equal(result.json.base, null);
    assert.match(result.json.baseNote, /not pinned/);
    assert.deepEqual(vercelCalls(), []);
  });

  test("preview with no flags shows the pin without a lookup", async () => {
    const result = await run(["preview"], previewEnv);
    assert.equal(result.json.pinned, null);
    assert.deepEqual(vercelCalls(), []);
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

  /** Writes a real PNG at the path browse was given, so a JSON --out cannot hide a clobber. */
  function pngBrowse() {
    writeFileSync(
      fakeBrowse,
      `#!/bin/sh
echo "$@" >> "${browseLog}"
out=""
for arg in "$@"; do out="$arg"; done
if [ "$1" = "screenshot" ]; then
  printf '\\211PNG\\r\\n\\032\\n' > "$out"
fi
echo "browse-ok $1"
`,
    );
    chmodSync(fakeBrowse, 0o755);
  }

  test("browser screenshot --help repeats the sandbox rule", async () => {
    const result = await run(["browser", "screenshot", "--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /browse-sandboxed/);
    assert.match(result.stdout, /escalat/);
    assert.match(result.stdout, /Do not reinstall Chromium/);
    assert.match(result.stdout, /target-closed/);
  });

  test("screenshot defaults into the evidence directory", async () => {
    const result = await run(["browser", "screenshot"]);
    assert.equal(result.code, 0);
    assert.ok(result.json.saved.startsWith(join(stateDir, "evidence")));
    assert.ok(result.json.saved.endsWith(".png"));
  });

  test("screenshot --png is a PNG and --out is JSON on a different path", async () => {
    pngBrowse();
    const png = join(stateDir, "shot.png");
    const jsonOut = join(stateDir, "shot.json");
    const result = await run(["browser", "screenshot", "--png", png, "--out", jsonOut]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.saved, png);
    const pngBytes = readFileSync(png);
    assert.equal(pngBytes[0], 0x89);
    assert.equal(pngBytes.subarray(1, 4).toString(), "PNG");
    const dumped = JSON.parse(readFileSync(jsonOut, "utf8"));
    assert.equal(dumped.saved, png);
    assert.deepEqual(dumped.evidence, [jsonOut]);
    assert.equal(readFileSync(jsonOut)[0], 0x7b);
    assert.ok(browseCalls()[0].endsWith(png));
    assert.equal(browseCalls()[0].includes(jsonOut), false);
  });

  test("screenshot --out alone does not use that path as the PNG", async () => {
    pngBrowse();
    const jsonOut = join(stateDir, "clobber.png");
    const result = await run(["browser", "screenshot", "--out", jsonOut]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.json.saved.endsWith(".png"));
    assert.notEqual(result.json.saved, jsonOut);
    const pngBytes = readFileSync(result.json.saved);
    assert.equal(pngBytes[0], 0x89);
    assert.equal(pngBytes.subarray(1, 4).toString(), "PNG");
    const dumped = JSON.parse(readFileSync(jsonOut, "utf8"));
    assert.equal(dumped.saved, result.json.saved);
    assert.equal(browseCalls()[0].includes(jsonOut), false);
  });

  test("screenshot refuses when --png and --out are the same path", async () => {
    const same = join(stateDir, "same.png");
    const result = await run(["browser", "screenshot", "--png", same, "--out", same]);
    assert.equal(result.code, 2);
    assert.equal(result.error.error.code, "flag-invalid");
    assert.match(result.error.error.fix, /--png/);
    assert.equal(existsSync(same), false);
    assert.deepEqual(browseCalls(), []);
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
    assert.match(result.error.error.fix, /browser install/);
  });

  /** Codex workspace-write sandbox: Chromium dies on Mach ports, browse exits. */
  function sandboxBrowse() {
    writeFileSync(
      fakeBrowse,
      `#!/bin/sh\necho "$@" >> "${browseLog}"\necho "PortRendezvousServer: Permission denied (EPERM)" >&2\necho "Target page, context or browser has been closed" >&2\nexit 1\n`,
    );
    chmodSync(fakeBrowse, 0o755);
  }

  test("browser commands prepend ~/.bun/bin so browse can spawn bun", async () => {
    const home = join(stateDir, "home-browse-bun");
    const bunDir = join(home, ".bun/bin");
    mkdirSync(bunDir, { recursive: true });
    writeFileSync(join(bunDir, "bun"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bunDir, "bun"), 0o755);
    const pathLog = join(stateDir, "browse-path.log");
    const bin = join(stateDir, "path-browse");
    writeFileSync(bin, `#!/bin/sh\necho "$PATH" > "${pathLog}"\nexit 0\n`);
    chmodSync(bin, 0o755);
    const result = await run(["browser", "open", ...local()], {
      HOME: home,
      PATH: "/usr/bin:/bin",
      LAVEGA_BROWSE_BIN: bin,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(readFileSync(pathLog, "utf8"), new RegExp(bunDir));
  });

  test("browser open sandbox refusal says to escalate, not to install", async () => {
    sandboxBrowse();
    const result = await run(["browser", "open", ...local()]);
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "browse-sandboxed");
    assert.match(result.error.error.fix, /escalat/);
    assert.match(result.error.error.fix, /unrestricted|outside the sandbox/);
    assert.doesNotMatch(result.error.error.fix, /browser install/);
    assert.doesNotMatch(
      `${result.error.error.message}\n${result.error.error.fix}`,
      /macOS|System Settings|Chromium permission/i,
    );
    assert.notEqual(result.error.error.code, "browse-missing");
  });

  test("a later browser step with the same refusal also says to escalate", async () => {
    sandboxBrowse();
    const result = await run(["browser", "screenshot"]);
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "browse-sandboxed");
    assert.match(result.error.error.fix, /escalat/);
    assert.doesNotMatch(result.error.error.fix, /browser install/);
  });

  test("browser install --dry-run prints the clone and does not run it", async () => {
    const result = await run(["browser", "install", "--dry-run"], {
      HOME: stateDir,
      LAVEGA_BROWSE_BIN: "",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.dryRun, true);
    assert.equal(result.json.effect, "local-install");
    assert.match(result.json.would.bin, /[/]browse[/]dist[/]browse$/);
    const clone = result.json.would.steps.find((step) => step.startsWith("git clone"));
    assert.match(clone, /git clone --depth 1 https:\/\/github.com\/garrytan\/gstack\.git/);
    if (result.json.would.bun === false) {
      assert.match(result.json.would.steps[0], /bun\.sh\/install/);
      assert.match(result.json.would.steps[0], /bun-v1\.3\.10/);
      assert.match(result.json.would.note, /Codex path alone is enough|that path alone is enough/);
    }
    assert.equal(existsSync(join(stateDir, ".claude")), false);
  });

  test("browser install without bun does not clone", async () => {
    const result = await run(["browser", "install"], {
      HOME: stateDir,
      PATH: join(stateDir, "no-such-path"),
      LAVEGA_BROWSE_BIN: "",
    });
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "bun-missing");
    assert.match(result.error.error.fix, /bun\.sh\/install/);
    assert.match(result.error.error.fix, /bun-v1\.3\.10/);
    assert.match(result.error.error.fix, /LAVEGA_BROWSE_BIN/);
    assert.match(result.error.error.fix, /\.codex\/skills\/gstack\/browse\/dist\/browse/);
    assert.match(result.error.error.fix, /Do not invent a path/);
    assert.match(result.error.error.message, /installer did not produce/);
    assert.equal(existsSync(join(stateDir, ".claude")), false);
  });

  test("browser install runs the pinned bun installer, then clone", async () => {
    const home = join(stateDir, "home-bun");
    const binDir = join(stateDir, "bin-bun");
    mkdirSync(home);
    mkdirSync(binDir);
    const log = join(stateDir, "bun-install.log");
    writeFileSync(
      join(binDir, "bash"),
      `#!/bin/sh
echo "$@" >> "${log}"
mkdir -p "$HOME/.bun/bin"
cat > "$HOME/.bun/bin/bun" << 'END'
#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 1.3.10
  exit 0
fi
exit 1
END
chmod +x "$HOME/.bun/bin/bun"
exit 0
`,
    );
    writeFileSync(
      join(binDir, "git"),
      `#!/bin/sh
echo "git $*" >> "${log}"
exit 1
`,
    );
    chmodSync(join(binDir, "bash"), 0o755);
    chmodSync(join(binDir, "git"), 0o755);
    const result = await run(["browser", "install"], {
      HOME: home,
      PATH: `${binDir}:/usr/bin:/bin`,
      LAVEGA_BROWSE_BIN: "",
    });
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "browse-install-failed");
    const text = readFileSync(log, "utf8");
    assert.match(text, /curl -fsSL https:\/\/bun\.sh\/install \| bash -s "bun-v1\.3\.10"/);
    assert.match(text, /git clone --depth 1 https:\/\/github.com\/garrytan\/gstack\.git/);
    assert.equal(existsSync(join(home, ".claude/skills/gstack/browse/dist/browse")), false);
  });

  test("browser install treats an EPERM bun installer as the sandbox", async () => {
    const home = join(stateDir, "home-eperm");
    const binDir = join(stateDir, "bin-eperm");
    mkdirSync(home);
    mkdirSync(binDir);
    writeFileSync(
      join(binDir, "bash"),
      "#!/bin/sh\necho 'Permission denied (EPERM)' >&2\nexit 1\n",
    );
    chmodSync(join(binDir, "bash"), 0o755);
    const result = await run(["browser", "install"], {
      HOME: home,
      PATH: binDir,
      LAVEGA_BROWSE_BIN: "",
    });
    assert.equal(result.code, 1);
    assert.equal(result.error.error.code, "browse-sandboxed");
    assert.match(result.error.error.fix, /escalat/);
    assert.match(result.error.error.fix, /Do not reinstall Chromium/);
    assert.equal(existsSync(join(home, ".claude")), false);
  });

  test("browser install leaves an existing binary in place", async () => {
    const result = await run(["browser", "install"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.already, true);
    assert.equal(result.json.bin, fakeBrowse);
    assert.equal(result.json.chromium.present, true);
    assert.equal(result.json.chromium.installed, false);
  });

  test("browser install treats a Codex browse binary as enough", async () => {
    const home = join(stateDir, "home");
    const codex = join(home, ".codex/skills/gstack/browse/dist/browse");
    const canonical = join(home, ".claude/skills/gstack/browse/dist/browse");
    mkdirSync(dirname(codex), { recursive: true });
    writeFileSync(codex, "#!/bin/sh\nexit 0\n");
    chmodSync(codex, 0o755);
    const result = await run(["browser", "install"], { HOME: home, LAVEGA_BROWSE_BIN: "" });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.already, true);
    assert.equal(result.json.bin, codex);
    assert.equal(existsSync(canonical), false);
    const help = await run(["browser", "install", "--help"]);
    assert.match(help.stdout, /Codex path alone is enough/);
  });

  test("browser install --dry-run with a Codex binary does not plan a clone", async () => {
    const home = join(stateDir, "home");
    const codex = join(home, ".codex/skills/gstack/browse/dist/browse");
    mkdirSync(dirname(codex), { recursive: true });
    writeFileSync(codex, "#!/bin/sh\nexit 0\n");
    chmodSync(codex, 0o755);
    const result = await run(["browser", "install", "--dry-run"], {
      HOME: home,
      LAVEGA_BROWSE_BIN: "",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.would.already, true);
    assert.equal(result.json.would.bin, codex);
    assert.deepEqual(result.json.would.steps, []);
    assert.equal(existsSync(join(home, ".claude")), false);
  });

  test("browser install --dry-run lists pinned chromium when the shell is missing", async () => {
    const empty = join(stateDir, "no-browsers");
    mkdirSync(empty);
    const result = await run(["browser", "install", "--dry-run"], {
      HOME: stateDir,
      LAVEGA_BROWSE_BIN: "",
      PLAYWRIGHT_BROWSERS_PATH: empty,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.would.chromium, false);
    const chromium = result.json.would.steps.find((step) => step.startsWith("bunx playwright@"));
    assert.match(chromium, /bunx playwright@1\.58\.2 install chromium/);
  });

  test("browser install runs pinned chromium when the headless shell is missing", async () => {
    const browsers = join(stateDir, "empty-browsers");
    mkdirSync(browsers);
    const binDir = join(stateDir, "bin-chromium");
    mkdirSync(binDir);
    const log = join(stateDir, "chromium.log");
    writeFileSync(
      join(binDir, "bun"),
      `#!/bin/sh
echo "bun $*" >> "${log}"
if [ "$1" = "--version" ]; then
  echo 1.3.10
  exit 0
fi
if [ "$1" = "x" ]; then
  mkdir -p "${browsers}/chromium_headless_shell-1208/chrome-linux"
  exit 0
fi
exit 1
`,
    );
    chmodSync(join(binDir, "bun"), 0o755);
    const result = await run(["browser", "install"], {
      PATH: `${binDir}:${process.env.PATH}`,
      PLAYWRIGHT_BROWSERS_PATH: browsers,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.already, true);
    assert.equal(result.json.bin, fakeBrowse);
    assert.equal(result.json.chromium.installed, true);
    assert.match(readFileSync(log, "utf8"), /x playwright@1\.58\.2 install chromium/);
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
