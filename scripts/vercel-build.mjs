import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/*
 * Builds straight into Vercel's Build Output API (.vercel/output).
 *
 * The API function is generated here — esbuild bundles the Hono app and the
 * workspace TypeScript it imports. That is why zero-config cannot ship it:
 * Vercel scans for an `api/` directory in the SOURCE, before this script runs,
 * so on a git deploy it finds nothing and the deployment goes out with static
 * files and no backend. It looked fine because `vercel deploy` from a laptop
 * uploads a locally-built `api/` and hides the whole problem.
 *
 * Writing the output layout ourselves removes the guessing: the function is
 * declared, and so are the routes that reach it.
 */

const exec = promisify(execFile);
const root = process.cwd();
const execOptions = { cwd: root, env: { ...process.env, CI: "true" } };
const esbuild = `${root}/node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild`;
const output = `${root}/.vercel/output`;
const functionDir = `${output}/functions/api/[...route].func`;

/*
 * REFUSE TO DEPLOY CODE THE DATABASE IS NOT READY FOR.
 *
 * 0006_broker_sync_lease.sql was committed, merged and deployed while the ALTER
 * was never run against Neon, so the Brokers page failed with `column
 * "credential_generation" does not exist` — in production, on a page that had
 * passed every test, because the tests bring their own database. A deploy is
 * the last moment where that difference is still cheap to notice.
 *
 * This only reads the ledger; applying stays a deliberate act by the schema
 * owner (`pnpm db:migrate`). A build that applies DDL on its own would let a
 * rolled-back deploy leave the schema ahead of the code that ran it.
 *
 * Without DATABASE_URL there is no database to be behind — a build for the file
 * stores, or a fork's preview — so the check reports that and moves on.
 */
if (process.env.DATABASE_URL?.trim()) {
  try {
    const { stdout } = await exec("pnpm", ["db:migrate:check"], execOptions);
    process.stdout.write(stdout);
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? "");
    throw new Error(
      "vercel-build: the database is missing a migration in db/migrations. " +
        "Apply it as the schema owner (pnpm db:migrate), then redeploy.",
    );
  }
} else {
  console.log("vercel-build: no DATABASE_URL, skipping the migration check");
}

await rm(output, { recursive: true, force: true });
await mkdir(functionDir, { recursive: true });

await exec(
  esbuild,
  [
    "scripts/vercel-api.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    /* Some dependencies are CommonJS and call require() for Node builtins at load
     * time. In an ESM bundle there is no require, and esbuild's shim throws
     * "Dynamic require of \"path\" is not supported" the moment the function is
     * imported. Giving the module a real one is what lets them be inlined at all. */
    "--banner:js=import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    `--outfile=${functionDir}/index.mjs`,
    "--alias:@lavega/core=./packages/core/src/index.ts",
    "--alias:@lavega/adapters=./packages/adapters/src/index.ts",
    "--alias:@lavega/investing-server=./apps/investing-server",
  ],
  execOptions,
);

/* THE AGENT PROMPTS ARE DATA, AND esbuild DOES NOT SHIP DATA.
 *
 * Every agent's instructions live in Markdown next to prompts.ts, which reads
 * them at runtime with readFileSync against a directory derived from
 * import.meta.url. Bundled, that resolves to this function directory — and
 * nothing was putting the Markdown here, so every readFileSync threw, prompts.ts
 * swallowed it (`catch { return "" }`) and EVERY agent in production ran with an
 * empty system prompt. Invoice extraction, chat, categorize, travel.
 *
 * It was invisible from every angle that gets checked: local dev runs from
 * source so the files are always there, the unit tests read the same source
 * tree, and the failure produces a plausible-looking answer rather than an
 * error. Found 17 Sep 2026 when an invoice extraction came back with every
 * field blank.
 *
 * The assertion below is the point, not the copy: if this ever stops landing,
 * the build fails here instead of the agents quietly going stupid. */
await cp(`${root}/apps/server/src/agent/prompts`, `${functionDir}/prompts`, { recursive: true });
{
  const shipped = (await readdir(`${functionDir}/prompts`)).filter((f) => f.endsWith(".md"));
  if (shipped.length === 0) throw new Error("vercel-build: no agent prompts shipped");
  for (const required of ["_base.md", "facturen-extract.md"])
    if (!shipped.includes(required))
      throw new Error(`vercel-build: ${required} did not ship into the function`);
}

/* Nothing is left external: the function ships no node_modules of its own, so
 * anything not inlined here would only fail at runtime. */
await writeFile(`${functionDir}/package.json`, JSON.stringify({ type: "module" }, null, 2));
await writeFile(
  `${functionDir}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: "nodejs24.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
      /* Trading 212 order history is 6 req/min. A first sync is ~40 pages and
       * cannot finish inside the 10s/15s default. 300s is the Pro ceiling that
       * still lets the adapter stop on INVESTING_SYNC_BUDGET_MS and persist a
       * resume cursor instead of dying mid-history. */
      maxDuration: 300,
    },
    null,
    2,
  ),
);

/*
 * Typecheck before building — but only the packages we own.
 *
 * esbuild bundles the API function above, and esbuild STRIPS types without
 * checking them. Nothing else in this pipeline runs `tsc`, so until now a type
 * error could reach production and only show up as a runtime TypeError. Railway
 * used to catch that by accident, as the one place that ran `pnpm build`; it is
 * gone, so the check has to live where the deploys happen.
 *
 * `@lavega/investing-web` and `@lavega/investing-server` are deliberately NOT in
 * this list. They belong to the investing side and are typechecked there; adding
 * them here would let a failure in that tree block the personal app's deploys.
 * `@lavega/server` IS checked, and checking it also checks the investing tree:
 * its `investing-mount.ts` imports `@lavega/investing-server/src/index.js`
 * directly, so `tsc` cannot look at ours without looking at theirs. That was
 * briefly a reason to leave it out — the investing side had a type error we did
 * not own, and including it would have blocked our deploys on someone else's
 * fix. That error is gone, so the coupling now works in our favour: one command
 * covers both trees.
 */
const TYPECHECKED = [
  "@lavega/core",
  "@lavega/adapters",
  "@lavega/database",
  "@lavega/server",
  "@lavega/web",
  "@lavega/email-worker",
];
await exec(
  "pnpm",
  [...TYPECHECKED.flatMap((name) => ["--filter", name]), "typecheck"],
  execOptions,
);

await exec("pnpm", ["--filter", "@lavega/web", "build"], execOptions);
await exec("pnpm", ["--filter", "@lavega/investing-web", "build"], {
  cwd: root,
  env: { ...process.env, CI: "true", VITE_INVESTING_BASE: "/investing/" },
});

const staticDir = `${output}/static`;
await mkdir(`${staticDir}/investing`, { recursive: true });
await cp("apps/web/dist", staticDir, { recursive: true });
await cp("apps/investing-web/dist", `${staticDir}/investing`, { recursive: true });

/* Routing. `handle: filesystem` serves anything that really exists first; what
 * is left is either an API path or an SPA view. The SPA fallbacks come last so
 * a missing asset 404s instead of being answered with index.html — that is how
 * a blank /investing page hid behind green probes once before. */
/*
 * Security headers for everything the CDN serves.
 *
 * `secureHeaders()` in apps/server only covers requests that reach the Hono
 * function. On Vercel the static build is served by the CDN and never touches
 * it, so /, /app and /en — the pages that actually run our JavaScript and hold
 * the vault — came back with no CSP and no clickjacking protection, while
 * /health and /privacy had both. Exactly backwards.
 *
 * Kept deliberately identical to the server's policy: two policies that drift
 * are worse than one, because whichever is laxer is the one that decides.
 */
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

await writeFile(
  `${output}/config.json`,
  JSON.stringify(
    {
      version: 3,
      crons: [{ path: "/api/cron/investing-sync", schedule: "0 4 * * *" }],
      routes: [
        /* Applied to every response, then `continue` so routing carries on and
         * the filesystem handler still serves the file. */
        { src: "/(.*)", headers: SECURITY_HEADERS, continue: true },
        /* Locale redirect for the landing page: an English-device visitor to
         * `/` goes to `/en`, unless a `lavega_locale` cookie already picked a
         * locale. Keep these two routes in sync with the pure implementation
         * at packages/core/src/localeRedirect.ts and its parity test at
         * packages/core/src/localeRedirect.vercelParity.test.ts, which embeds
         * its own literal copy of these exact objects. */
        {
          src: "/",
          has: [{ type: "cookie", key: "lavega_locale", value: "^en$" }],
          status: 302,
          headers: { Location: "/en", Vary: "Accept-Language, Cookie" },
        },
        {
          src: "/",
          missing: [{ type: "cookie", key: "lavega_locale" }],
          has: [{ type: "header", key: "accept-language", value: "^[Ee][Nn].*" }],
          status: 302,
          headers: { Location: "/en", Vary: "Accept-Language, Cookie" },
        },
        { handle: "filesystem" },
        { src: "/api/(.*)", dest: "/api/[...route]" },
        { src: "/health", dest: "/api/[...route]" },
        { src: "/privacy", dest: "/api/[...route]" },
        { src: "/terms", dest: "/api/[...route]" },
        { src: "/investing/(.*)", dest: "/investing/index.html" },
        { src: "/investing", dest: "/investing/index.html" },
        /* Layer 2 (edge) of the /app session gate — see apps/web/src/Root.tsx
         * for layer 1 (the one that actually closes the hole; a hash route
         * like `#app` never reaches here at all) and requireAppSession in
         * apps/server/src/index.ts for layer 3 (Docker/Railway/`pnpm dev`,
         * where the Hono function runs and this static routing table does
         * not apply). This layer checks cookie PRESENCE only, not validity —
         * a funnel gate ahead of the CDN-served static shell below, not an
         * auth check; /api/* still verifies for real. Ordered ahead of the
         * static /app routes so a request with no session cookie never
         * reaches them; a request that DOES carry the cookie falls through
         * to those routes unchanged, so a signed-in visitor keeps the CDN
         * HIT and costs no function invocation. The cookie name is
         * better-auth 1.7.1's emitted name for an https baseURL — true for
         * every Vercel deployment, preview or production, since VERCEL_URL
         * is always https — proved empirically against its getCookies() with
         * apps/server/src/auth.ts's exact options; see the comment and the
         * parity test at apps/server/src/appGateCookie.vercelParity.test.ts,
         * which reads this literal array and fails if the two diverge. */
        // APP_GATE_ROUTES_START
        {
          src: "/app/(.*)",
          missing: [{ type: "cookie", key: "__Secure-better-auth.session_token" }],
          status: 302,
          headers: { Location: "/", Vary: "Cookie", "Cache-Control": "private, no-store" },
        },
        {
          src: "/app",
          missing: [{ type: "cookie", key: "__Secure-better-auth.session_token" }],
          status: 302,
          headers: { Location: "/", Vary: "Cookie", "Cache-Control": "private, no-store" },
        },
        // APP_GATE_ROUTES_END
        { src: "/app/(.*)", dest: "/index.html" },
        { src: "/app", dest: "/index.html" },
        /* The English landing page. Same SPA; `Root` reads the locale off the
         * path, so this only needs to reach index.html like any other view. */
        { src: "/en", dest: "/index.html" },
        { src: "/en/", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

// Kept so a local `pnpm build`-style check still has something to look at.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp(staticDir, "dist", { recursive: true });
