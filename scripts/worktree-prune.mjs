#!/usr/bin/env node
/**
 * Safely prune merged, clean agent worktrees under `.agents/worktrees` and
 * `.claude/worktrees`. Dry-run by default; pass `--apply` to remove them.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
if (commonDir.status !== 0) {
  console.error("worktree:prune must run inside a git repository.");
  process.exit(1);
}
const mainRoot = resolve(commonDir.stdout.trim(), "..");
const managedPrefixes = [
  resolve(mainRoot, ".agents/worktrees") + "/",
  resolve(mainRoot, ".claude/worktrees") + "/",
];

const list = git(["worktree", "list", "--porcelain"], mainRoot);
if (list.status !== 0) {
  console.error(list.stderr.trim());
  process.exit(1);
}

const entries = [];
let current = {};
for (const line of list.stdout.split("\n")) {
  if (!line.trim()) {
    if (current.path) entries.push(current);
    current = {};
    continue;
  }
  const [key, ...rest] = line.split(" ");
  const value = rest.join(" ");
  if (key === "worktree") current.path = value;
  else if (key === "HEAD") current.head = value;
  else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
  else if (key === "prunable") current.prunable = true;
}
if (current.path) entries.push(current);

const removable = [];
const kept = [];
let prunableCount = 0;

for (const entry of entries) {
  if (entry.prunable || !existsSync(entry.path)) {
    prunableCount += 1;
    continue;
  }
  const abs = resolve(entry.path);
  if (!managedPrefixes.some((prefix) => abs.startsWith(prefix))) continue;

  const dirty = git(["status", "--porcelain"], abs);
  if (dirty.status !== 0 || dirty.stdout.trim().length > 0) {
    kept.push({ ...entry, reason: "dirty" });
    continue;
  }

  const merged = git(["merge-base", "--is-ancestor", entry.head, "master"], mainRoot);
  if (merged.status !== 0) {
    kept.push({ ...entry, reason: "unmerged" });
    continue;
  }

  removable.push(entry);
}

console.log(
  `Managed worktrees: ${removable.length} clean+merged, ${kept.length} kept (dirty/unmerged), ${prunableCount} prunable.`,
);

for (const entry of removable) {
  const label = entry.branch ? `[${entry.branch}]` : `(detached ${entry.head.slice(0, 7)})`;
  if (apply) {
    const res = git(["worktree", "remove", entry.path], mainRoot);
    if (res.status === 0) {
      console.log(`removed  ${entry.path} ${label}`);
    } else {
      console.error(`failed   ${entry.path}: ${res.stderr.trim()}`);
    }
  } else {
    console.log(`would remove  ${entry.path} ${label}`);
  }
}

for (const entry of kept) {
  const label = entry.branch ? `[${entry.branch}]` : `(detached ${entry.head.slice(0, 7)})`;
  console.log(`keep (${entry.reason})  ${entry.path} ${label}`);
}

if (apply) {
  git(["worktree", "prune"], mainRoot);
  console.log("Ran `git worktree prune`.");
} else if (removable.length > 0 || prunableCount > 0) {
  console.log("\nDry run only. Re-run with `--apply` to remove clean+merged worktrees.");
}
