import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/* Issue #307 acceptance 10: after the switch, no query in the database package
 * reads or writes the old per-user price tables. They stay in place unread for
 * one release, and the erase list keeps deleting them; everything else goes
 * through the shared instrument-keyed tables. */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8",
);

/** SQL that names a legacy table. `instrument_price_bars` must not match. */
const LEGACY_QUERY = /(?<!instrument_)investing\.(?:price_bars|price_coverage)\b/g;

test("no query in the database package touches the old per-user price tables", () => {
  const lines = source.split("\n");
  const hits = lines
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.match(LEGACY_QUERY) !== null)
    // The erase list names them so "Erase all data" still clears the old rows
    // until the follow-up drops the tables.
    .filter(({ line }) => !line.startsWith('"investing.price_'));
  expect(hits).toEqual([]);
});

test("the erase list still names both old tables", () => {
  expect(source).toContain('"investing.price_bars"');
  expect(source).toContain('"investing.price_coverage"');
});
