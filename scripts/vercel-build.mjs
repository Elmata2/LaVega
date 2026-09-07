import { cp, mkdir, rm, writeFile } from "node:fs/promises";
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
await exec("pnpm", [...TYPECHECKED.flatMap((name) => ["--filter", name]), "typecheck"], execOptions);

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
        { handle: "filesystem" },
        { src: "/api/(.*)", dest: "/api/[...route]" },
        { src: "/health", dest: "/api/[...route]" },
        { src: "/privacy", dest: "/api/[...route]" },
        { src: "/terms", dest: "/api/[...route]" },
        { src: "/investing/(.*)", dest: "/investing/index.html" },
        { src: "/investing", dest: "/investing/index.html" },
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
