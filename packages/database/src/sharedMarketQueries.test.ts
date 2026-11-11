import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/* Issue #307 acceptance 10, updated by #310: after the shared store served a
 * release, the per-user tables were dropped. No source file in this package
 * may name them again, and the erase list no longer deletes from them. */

const sourceDir = dirname(fileURLToPath(import.meta.url));
const source = readdirSync(sourceDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => readFileSync(join(sourceDir, name), "utf8"))
  .join("\n");

/** SQL that names a legacy table. `instrument_price_bars` must not match. */
const LEGACY_QUERY = /(?<!instrument_)investing\.(?:price_bars|price_coverage)\b/g;

test("no query in the database package touches the dropped per-user price tables", () => {
  const hits = source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.match(LEGACY_QUERY) !== null);
  expect(hits).toEqual([]);
});
