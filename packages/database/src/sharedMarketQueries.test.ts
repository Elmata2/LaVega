import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/* Issue #307 acceptance 10, updated by #310: after the shared store served a
 * release, the per-user tables were dropped. No query in the database package
 * may name them again, and the erase list no longer deletes from them. */

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

/** SQL that names a legacy table. `instrument_price_bars` must not match. */
const LEGACY_QUERY = /(?<!instrument_)investing\.(?:price_bars|price_coverage)\b/g;

test("no query in the database package touches the dropped per-user price tables", () => {
  const lines = source.split("\n");
  const hits = lines
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.match(LEGACY_QUERY) !== null);
  expect(hits).toEqual([]);
});
