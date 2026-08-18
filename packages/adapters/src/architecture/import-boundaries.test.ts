import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// Reimplemented from gloomberb's MIT-licensed import-boundary test
// (commit 0dafb31). Bun APIs were replaced with Node/Vitest APIs, and the
// rule list was adapted to LaVega's package seams.
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const SOURCE_ROOTS = ["packages", "apps"];
const RUNTIME_EXTENSIONS = new Set([".ts", ".tsx"]);
const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;
const NODE_BUILTIN_OR_IO_SPECIFIERS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

type ImportEdge = { file: string; specifier: string };

function isRuntimeSource(path: string): boolean {
  if (path.includes(".test.") || path.includes("__snapshots__")) return false;
  return [...RUNTIME_EXTENSIONS].some((extension) => path.endsWith(extension));
}

async function collectSourceFiles(directory: string, result: string[] = []): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "vendor") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(path, result);
    } else if (entry.isFile() && isRuntimeSource(path)) {
      result.push(path);
    }
  }
  return result;
}

async function collectImports(): Promise<ImportEdge[]> {
  const files = (await Promise.all(SOURCE_ROOTS.map((root) => collectSourceFiles(join(REPOSITORY_ROOT, root))))).flat();
  const imports: ImportEdge[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      imports.push({
        file: relative(REPOSITORY_ROOT, file),
        specifier: match[1] ?? match[2] ?? "",
      });
    }
  }
  return imports;
}

function isCoreFile(file: string): boolean {
  return file.startsWith("packages/core/");
}

function isStorageAdapterFile(file: string): boolean {
  return file === "packages/adapters/src/index.ts" || file.startsWith("packages/adapters/src/storage/");
}

function isNodeBuiltinOrIo(specifier: string): boolean {
  const normalized = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  const rootSpecifier = normalized.split("/", 1)[0];
  return NODE_BUILTIN_OR_IO_SPECIFIERS.has(rootSpecifier);
}

describe("import boundaries", () => {
  test("core does not import adapters or I/O", async () => {
    const violations = (await collectImports()).filter(({ file, specifier }) => {
      if (!isCoreFile(file)) return false;
      return specifier === "@lavega/adapters"
        || specifier.startsWith("@lavega/adapters/")
        || isNodeBuiltinOrIo(specifier);
    });

    expect(violations).toEqual([]);
  });

  test("concrete storage implementations stay inside storage adapter", async () => {
    const violations = (await collectImports()).filter(({ file, specifier }) => {
      if (isStorageAdapterFile(file)) return false;
      return /(?:^|\/)storage\/(?:indexeddb|encryptedStorage)(?:\.js)?$/.test(specifier);
    });

    expect(violations).toEqual([]);
  });
});
