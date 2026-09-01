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

await exec(esbuild, [
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
], execOptions);

/* Nothing is left external: the function ships no node_modules of its own, so
 * anything not inlined here would only fail at runtime. */
await writeFile(`${functionDir}/package.json`, JSON.stringify({ type: "module" }, null, 2));
await writeFile(`${functionDir}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs24.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: true,
  /* Trading 212 order history is 6 req/min. A first sync is ~40 pages and
   * cannot finish inside the 10s/15s default. 300s is the Pro ceiling that
   * still lets the adapter stop on INVESTING_SYNC_BUDGET_MS and persist a
   * resume cursor instead of dying mid-history. */
  maxDuration: 300,
}, null, 2));

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
await writeFile(`${output}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { handle: "filesystem" },
    { src: "/api/(.*)", dest: "/api/[...route]" },
    { src: "/health", dest: "/api/[...route]" },
    { src: "/privacy", dest: "/api/[...route]" },
    { src: "/terms", dest: "/api/[...route]" },
    { src: "/investing/(.*)", dest: "/investing/index.html" },
    { src: "/investing", dest: "/investing/index.html" },
    { src: "/app/(.*)", dest: "/index.html" },
    { src: "/app", dest: "/index.html" },
  ],
}, null, 2));

// Kept so a local `pnpm build`-style check still has something to look at.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp(staticDir, "dist", { recursive: true });
