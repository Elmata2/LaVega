import { expect, test } from "vitest";
import { parseBrokerFile } from "./parseBrokerFile.js";

/* The invented DeGiro fixtures that used to live here are gone (#313): they
 * described a semicolon-separated shape with an `Order ID` column that no real
 * DeGiro export produces. The real-format fixtures are in
 * `./__fixtures__/degiro/`; #314 replaces this parser and adds the tests that
 * read them. Until then only the "this is not a broker file" path is asserted. */

test.each(["", "Date;Amount;Currency;Description\n2026-08-14;100;EUR;Deposit"])(
  "parseBrokerFile reports unknown or cashflow-only input: %s",
  (text) => {
    const result = parseBrokerFile("export.csv", text);
    expect(result.positions).toEqual([]);
    expect(result.trades).toEqual([]);
    expect(result.problems.length).toBeGreaterThan(0);
  },
);
