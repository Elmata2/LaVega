#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

const NEON_PROJECT_ID = "royal-surf-52181032";
const TARGETS = [
  { branch: "main", vercelEnv: "production" },
  { branch: "preview", vercelEnv: "preview" },
];

function run(cmd, args, env = process.env) {
  return execFileSync(cmd, args, { env, encoding: "utf8" }).trim();
}

function redeployLatest(vercelEnv) {
  const raw = run("vercel", ["ls", "--environment", vercelEnv, "--limit", "1", "--json"]);
  const parsed = JSON.parse(raw);
  const deployments = Array.isArray(parsed) ? parsed : (parsed.deployments ?? []);
  const latest = deployments[0];
  const target = latest?.url ?? latest?.uid;
  if (!target) {
    console.warn(`No ${vercelEnv} Vercel deployment found to redeploy.`);
    return;
  }
  console.log(`Triggering Vercel ${vercelEnv} redeploy for ${target}...`);
  const res = spawnSync("vercel", ["redeploy", target, "--no-wait"], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

for (const { branch, vercelEnv } of TARGETS) {
  console.log(`=== Neon branch: ${branch} ===`);
  const ownerUrl = run("neonctl", [
    "connection-string",
    branch,
    "--project-id",
    NEON_PROJECT_ID,
    "--role-name",
    "lavega_owner",
  ]);
  const res = spawnSync("tsx", ["scripts/migrate.ts", "apply"], {
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
    encoding: "utf8",
  });
  process.stdout.write(res.stdout ?? "");
  process.stderr.write(res.stderr ?? "");
  if (res.status !== 0) process.exit(res.status ?? 1);

  if (/Applied [1-9]\d* migration/.test(res.stdout ?? "")) redeployLatest(vercelEnv);
}
