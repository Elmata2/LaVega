import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const execOptions = { cwd: root, env: { ...process.env, CI: "true" } };
const esbuild = `${root}/node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild`;

await exec(esbuild, [
  "scripts/vercel-api.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  "--outfile=api/[...route].js",
  "--external:@anthropic-ai/sdk",
  "--external:@vercel/oidc",
  "--alias:@lavega/core=./packages/core/src/index.ts",
  "--alias:@lavega/adapters=./packages/adapters/src/index.ts",
  "--alias:@lavega/investing-server=./apps/investing-server",
], execOptions);

await exec("pnpm", ["--filter", "@lavega/web", "build"], execOptions);
await exec("pnpm", ["--filter", "@lavega/investing-web", "build"], {
  cwd: root,
  env: { ...process.env, CI: "true", VITE_INVESTING_BASE: "/investing/" },
});
await rm("dist", { recursive: true, force: true });
await mkdir("dist/investing", { recursive: true });
await cp("apps/web/dist", "dist", { recursive: true });
await cp("apps/investing-web/dist", "dist/investing", { recursive: true });
