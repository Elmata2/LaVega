/**
 * Live smoke tests: the real CLI against the real newest preview deploy, its
 * Neon `preview` branch and the preview test user. Read-only — every write is
 * run with --dry-run, so no broker, price store or tenant row changes.
 *
 * Skips when the preview credentials file is missing. Uses its own state
 * directory, so it never moves the pin or cookie jar an agent is using.
 *
 *   pnpm run test:verify-investing:live
 *   LAVEGA_PREVIEW_URL=https://<deploy>.vercel.app pnpm run test:verify-investing:live
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "control-investing.mjs");
const sharedState = process.env.VERIFY_INVESTING_DIR || "/tmp/lavega-verify-investing";
const credentials = join(sharedState, "auth.preview.json");
function resolveBrowse() {
  if (process.env.LAVEGA_BROWSE_BIN) return process.env.LAVEGA_BROWSE_BIN;
  const home = process.env.HOME;
  const candidates = [
    join(home, ".claude/skills/gstack/browse/dist/browse"),
    join(home, ".codex/skills/gstack/browse/dist/browse"),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

const browse = resolveBrowse();

const skip = existsSync(credentials)
  ? false
  : `no ${credentials}; write it as {"email":"...","password":"..."} for the preview test user`;

let stateDir;

function run(args) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [cli, ...args, "--target", "preview"],
      {
        env: { ...process.env, VERIFY_INVESTING_DIR: stateDir },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
      },
      (error, stdout, stderr) => {
        let json = null;
        try {
          json = JSON.parse(stdout);
        } catch {
          // left null; the assertion that needs it prints stdout
        }
        done({ code: error ? (error.code ?? 1) : 0, stdout, stderr, json });
      },
    );
  });
}

describe("live preview", { skip, concurrency: false }, () => {
  before(() => {
    // Under /tmp, not os.tmpdir(): browse refuses files outside /tmp and its cwd.
    stateDir = mkdtempSync("/tmp/control-investing-live-");
    copyFileSync(credentials, join(stateDir, "auth.preview.json"));
  });

  after(() => rmSync(stateDir, { recursive: true, force: true }));

  test("pins a preview deploy", async () => {
    if (process.env.LAVEGA_PREVIEW_URL) return;
    const result = await run(["preview", "--refresh"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.json.pinned.url, /^https:\/\/.+\.vercel\.app$/);
    console.log(`# preview: ${result.json.pinned.url} (${result.json.pinned.branch})`);
  });

  test("signs in as the preview test user", async () => {
    const result = await run(["login"]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.json.signedIn, true);
  });

  test("doctor passes every check", async () => {
    const result = await run(["doctor"]);
    const failed = result.json?.checks.filter((check) => !check.ok) ?? [];
    assert.deepEqual(failed, [], result.stdout);
    assert.equal(result.json.verdict, "ok");
  });

  /* The false green: 200, no problems, zero positions. Real data must reach the
   * dashboard, or the preview is not worth verifying against. */
  test("the dashboard carries real, priced positions", async () => {
    const result = await run(["dashboard"]);
    assert.equal(result.code, 0, result.stdout);
    assert.ok(
      result.json.positions > 0,
      "no positions: check Neon branch migrations and LAVEGA_ENCRYPTION_KEY",
    );
    assert.ok(result.json.pricedPositions > 0, "positions but none priced");
    assert.ok(result.json.portfolioPoints > 0, "no portfolio history");
    assert.equal(result.json.shape, "normal");
  });

  test("every read-only endpoint answers", async () => {
    const result = await run(["probe"]);
    assert.deepEqual(result.json.unreachable, []);
    assert.deepEqual(result.json.unauthorized, []);
    assert.deepEqual(result.json.serverErrors, []);
  });

  test("the SPA shell and its assets load", async () => {
    const result = await run(["assets"]);
    assert.equal(result.json.verdict, "ok", result.stdout);
  });

  test("the dashboard reads answer within budget", async () => {
    const result = await run(["perf", "--runs", "3"]);
    assert.equal(result.code, 0, result.stdout);
    for (const entry of result.json.results)
      assert.ok(entry.ms.p50 < 10_000, `${entry.path} p50 ${entry.ms.p50}ms`);
  });

  test("a write on preview stays a dry run", async () => {
    const result = await run(["sync", "--force", "--dry-run"]);
    assert.equal(result.code, 0);
    assert.equal(result.json.dryRun, true);
  });

  describe(
    "browser",
    {
      skip: existsSync(browse)
        ? false
        : `no browse at ${browse}; run: node .claude/skills/verify-investing/control-investing.mjs browser install`,
    },
    () => {
      test("opens the dashboard with the CLI session", async () => {
        const result = await run(["browser", "open"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.equal(result.json.cookiesImported > 0, true);
      });

      test("the page shows the overview with a portfolio value", async () => {
        await run(["browser", "wait-settle"]);
        const result = await run(["browser", "text"]);
        assert.match(result.json.output, /Overview/);
        assert.match(result.json.output, /€\s?[\d,]+\.\d{2}/);
      });

      test("the page logs no console errors", async () => {
        const result = await run(["browser", "console", "--errors"]);
        assert.match(result.json.output, /no console errors/);
      });

      test("a screenshot lands in the evidence directory", async () => {
        const result = await run(["browser", "screenshot", "--viewport"]);
        assert.equal(result.code, 0);
        assert.ok(existsSync(result.json.saved));
      });
    },
  );
});
