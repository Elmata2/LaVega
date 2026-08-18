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
type SourceModule = { file: string; imports: ImportEdge[] };

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

async function collectModules(): Promise<SourceModule[]> {
  const files = (await Promise.all(SOURCE_ROOTS.map((root) => collectSourceFiles(join(REPOSITORY_ROOT, root))))).flat();
  const modules: SourceModule[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports: ImportEdge[] = [];
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      imports.push({
        file: relative(REPOSITORY_ROOT, file),
        specifier: match[1] ?? match[2] ?? "",
      });
    }
    modules.push({ file: relative(REPOSITORY_ROOT, file), imports });
  }
  return modules;
}

function collectImports(modules: SourceModule[]): ImportEdge[] {
  return modules.flatMap(({ imports }) => imports);
}

function resolveLocalImport(file: string, specifier: string, files: Set<string>): string | undefined {
  const packageRoots: Record<string, string> = {
    "@lavega/adapters": "packages/adapters/src/index.ts",
    "@lavega/core": "packages/core/src/index.ts",
  };
  if (specifier in packageRoots) return packageRoots[specifier];
  if (!specifier.startsWith(".")) return undefined;

  const base = resolve(REPOSITORY_ROOT, dirname(file), specifier.replace(/\.js$/, ""));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.map((candidate) => relative(REPOSITORY_ROOT, candidate)).find((candidate) => files.has(candidate));
}

function isInvestingServerEntry(file: string): boolean {
  return file === "apps/investing-server/src/index.ts";
}

function findInvestingServerNodeImports(modules: SourceModule[]): ImportEdge[] {
  const modulesByFile = new Map(modules.map((module) => [module.file, module]));
  const files = new Set(modulesByFile.keys());
  const queue = ["apps/investing-server/src/index.ts"];
  const visited = new Set<string>();
  const violations: ImportEdge[] = [];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const module = modulesByFile.get(file);
    if (!module) continue;

    for (const edge of module.imports) {
      if (isNodeBuiltinOrIo(edge.specifier)) {
        violations.push(edge);
        continue;
      }
      // The Node server adapter is the only Node entry dependency. Its import
      // is allowed here; request-path modules remain Workers-portable.
      if (isInvestingServerEntry(file) && edge.specifier === "@hono/node-server") continue;
      const target = resolveLocalImport(file, edge.specifier, files);
      if (target) queue.push(target);
    }
  }
  return violations;
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
    const violations = collectImports(await collectModules()).filter(({ file, specifier }) => {
      if (!isCoreFile(file)) return false;
      return specifier === "@lavega/adapters"
        || specifier.startsWith("@lavega/adapters/")
        || isNodeBuiltinOrIo(specifier);
    });

    expect(violations).toEqual([]);
  });

  test("investing server request path does not import Node builtins transitively", async () => {
    const violations = findInvestingServerNodeImports(await collectModules());

    expect(violations).toEqual([]);
  });

  test("transitive Node builtin imports fail boundary check", () => {
    const fixture: SourceModule[] = [
      {
        file: "apps/investing-server/src/index.ts",
        imports: [{ file: "apps/investing-server/src/index.ts", specifier: "./app.js" }],
      },
      {
        file: "apps/investing-server/src/app.ts",
        imports: [{ file: "apps/investing-server/src/app.ts", specifier: "@lavega/adapters" }],
      },
      {
        file: "packages/adapters/src/index.ts",
        imports: [{ file: "packages/adapters/src/index.ts", specifier: "./node-only.ts" }],
      },
      {
        file: "packages/adapters/src/node-only.ts",
        imports: [{ file: "packages/adapters/src/node-only.ts", specifier: "node:fs" }],
      },
    ];

    expect(findInvestingServerNodeImports(fixture)).toEqual([
      { file: "packages/adapters/src/node-only.ts", specifier: "node:fs" },
    ]);
  });

  test("entry adapter exemption does not allow Node builtins in entry", () => {
    const fixture: SourceModule[] = [
      {
        file: "apps/investing-server/src/index.ts",
        imports: [
          { file: "apps/investing-server/src/index.ts", specifier: "@hono/node-server" },
          { file: "apps/investing-server/src/index.ts", specifier: "node:fs" },
        ],
      },
    ];

    expect(findInvestingServerNodeImports(fixture)).toEqual([
      { file: "apps/investing-server/src/index.ts", specifier: "node:fs" },
    ]);
  });

  test("unreachable server modules do not affect request-path portability", () => {
    const fixture: SourceModule[] = [
      { file: "apps/investing-server/src/index.ts", imports: [] },
      {
        file: "apps/investing-server/src/unreachable.ts",
        imports: [{ file: "apps/investing-server/src/unreachable.ts", specifier: "node:fs" }],
      },
    ];

    expect(findInvestingServerNodeImports(fixture)).toEqual([]);
  });

  test("concrete storage implementations stay inside storage adapter", async () => {
    const violations = collectImports(await collectModules()).filter(({ file, specifier }) => {
      if (isStorageAdapterFile(file)) return false;
      return /(?:^|\/)storage\/(?:indexeddb|encryptedStorage)(?:\.js)?$/.test(specifier);
    });

    expect(violations).toEqual([]);
  });
});
