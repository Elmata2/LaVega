#!/usr/bin/env node
/**
 * Attribution gate for the Sure adoption program (WS6.2, issue #302).
 *
 * The provenance record has three parts that must agree with reality:
 *  1. every ported module carries the standard Sure header (upstream project,
 *     pinned commit, AGPL-3.0, "independently reimplemented for LaVega", change
 *     date);
 *  2. Appendix A of the plan lists every ported module, and every row points at
 *     a file that exists and is ported (no dead rows);
 *  3. NOTICE carries the upstream URL, the pinned commit, the licence, the
 *     non-affiliation statement and the source offer.
 *
 * Runs read-only: no writes, no network, no build. Exits non-zero on any
 * mismatch, printing each one. Run with `node scripts/check-attribution.mjs`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = "docs/superpowers/specs/2026-11-10-sure-adoption-plan.md";
const README = "docs/research/sure/README.md";
const NOTICE = "NOTICE";
const SOURCE_ROOTS = ["packages", "apps"];
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-ssr", "vendor", ".next", "build", "coverage"]);

const failures = [];
const fail = (message) => failures.push(message);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry === "repos") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.") && !path.includes("__fixtures__")) {
      out.push(relative(ROOT, path));
    }
  }
  return out;
}

const plan = readFileSync(join(ROOT, PLAN), "utf8");
const appendixStart = plan.indexOf("## Appendix A");
const appendixEnd = plan.indexOf("## Appendix B");
if (appendixStart < 0 || appendixEnd < 0) {
  fail(`${PLAN}: Appendix A/B not found`);
}
const appendix = plan.slice(appendixStart, appendixEnd);

/** Expand `dir/{a,b}.ts` and plain `path.ts` into real file paths. */
function expandLedgerPaths(cell) {
  const paths = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const raw = match[1];
    if (!raw.includes("/")) continue;
    const brace = raw.match(/^(.*)\{([^}]+)\}(.*)$/);
    if (brace) {
      for (const part of brace[2].split(",")) paths.push(`${brace[1]}${part.trim()}${brace[3]}`);
    } else {
      paths.push(raw);
    }
  }
  return paths;
}

const ledgerRows = appendix
  .split("\n")
  .filter((line) => line.startsWith("| `"))
  .map((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    return { raw: line, paths: expandLedgerPaths(cells[1] ?? "") };
  });

const ledgerPaths = new Set();
for (const row of ledgerRows) {
  if (row.paths.length === 0) fail(`ledger row has no file path: ${row.raw.slice(0, 120)}`);
  for (const path of row.paths) {
    if (!existsSync(join(ROOT, path))) fail(`dead ledger row: ${path} does not exist`);
    if (ledgerPaths.has(path)) fail(`ledger lists ${path} more than once`);
    ledgerPaths.add(path);
  }
}

const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root)));
const portedFiles = [];
for (const file of sourceFiles) {
  const head = readFileSync(join(ROOT, file), "utf8").slice(0, 2500);
  if (/\bPorted from Sure\b/i.test(head)) portedFiles.push(file);
}

const REQUIRED_HEADER = [
  ["upstream project", /we-promise\/sure/i],
  ["pinned commit", /562fe09/],
  ["licence", /AGPL-3\.0/i],
  ["independent reimplementation", /independently reimplemented for LaVega/i],
  ["change date", /changed 20\d\d-\d\d-\d\d/],
];
for (const file of portedFiles) {
  // Header sentences wrap across lines ("independently\n * reimplemented"), so
  // the check reads a whitespace-collapsed head; the header is prose, not code.
  const head = readFileSync(join(ROOT, file), "utf8")
    .slice(0, 2500)
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ");
  for (const [label, pattern] of REQUIRED_HEADER) {
    if (!pattern.test(head)) fail(`${file}: header misses ${label}`);
  }
  if (!ledgerPaths.has(file)) fail(`${file}: ported file has no Appendix A row`);
}
for (const path of ledgerPaths) {
  if (!portedFiles.includes(path)) fail(`ledger row points at a file without a Sure header: ${path}`);
}

const notice = readFileSync(join(ROOT, NOTICE), "utf8");
for (const [label, pattern] of [
  ["upstream URL", /github\.com\/we-promise\/sure/],
  ["pinned commit", /562fe096d149cb4d1fb1e6d3446527572c1ec7f6/],
  ["licence", /AGPL-3\.0/],
  ["scope", /independently reimplemented/i],
  ["non-affiliation", /not affiliated/i],
  ["source offer", /source/i],
]) {
  if (!pattern.test(notice)) fail(`NOTICE misses ${label}`);
}

const readme = existsSync(join(ROOT, README)) ? readFileSync(join(ROOT, README), "utf8") : "";
for (const [label, pattern] of [
  ["pinned commit", /562fe09/],
  ["upstream repository", /we-promise\/sure/],
  ["reference script mention", /fetch-sure-reference\.sh/],
]) {
  if (!pattern.test(readme)) fail(`${README} misses ${label}`);
}

if (failures.length > 0) {
  console.error(`attribution check FAILED (${failures.length}):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(
  `attribution check ok: ${portedFiles.length} ported files, ${ledgerRows.length} ledger rows, NOTICE and research README consistent`,
);
